#!/usr/bin/env node
/**
 * transcribe.mjs
 * --------------
 * Genera los SUBTITULOS de cada bloque de narracion usando whisper.cpp (local,
 * gratis, sin API). Guarda un JSON de captions por bloque en data/captions/.
 * Luego `build-manifest.mjs` los incrusta en el manifest y se pintan en los
 * verticales/Shorts.
 *
 * - Convierte el mp3 a wav 16kHz con `afconvert` (nativo de macOS, sin ffmpeg).
 * - whisper.cpp v1.5.5 (compila con `make`, NO necesita cmake).
 * - Idempotente: no re-transcribe salvo --force.
 *
 * Uso:  node scripts/transcribe.mjs [--force] [--lang=es|en|...]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installWhisperCpp, downloadWhisperModel, transcribe, toCaptions } from "@remotion/install-whisper-cpp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const WHISPER_DIR = join(ROOT, "bin", "whisper.cpp");
const WHISPER_VERSION = "1.5.5"; // compila con make (sin cmake)
const MODEL = "base"; // multilingue, buen balance velocidad/calidad
const CAP_DIR = join(ROOT, "data", "captions");
const TMP = join(ROOT, ".tmp");

const FORCE = process.argv.includes("--force");
const LANG = (process.argv.find((a) => a.startsWith("--lang=")) || "").split("=")[1] || null;

const capPath = (pid, bid) => join(CAP_DIR, `${pid}__${bid}.json`);

async function main() {
  const config = JSON.parse(readFileSync(CONFIG, "utf8"));
  const projectsWithCaps = config.projects.filter((p) => p.captions);
  if (projectsWithCaps.length === 0) {
    console.log("Ningun proyecto tiene 'captions': true. Nada que transcribir.");
    return;
  }

  mkdirSync(CAP_DIR, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  console.log(`⬇️  Preparando Whisper (whisper.cpp v${WHISPER_VERSION} + modelo '${MODEL}')...`);
  console.log("   La primera vez clona y compila whisper.cpp y baja el modelo (~1-3 min).");
  await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput: true });
  await downloadWhisperModel({ model: MODEL, folder: WHISPER_DIR, printOutput: true });

  for (const project of projectsWithCaps) {
    for (const block of project.blocks) {
      const out = capPath(project.id, block.id);
      if (existsSync(out) && !FORCE) {
        console.log(`⏭  captions ya existen: ${project.id}/${block.id} (usa --force para rehacer)`);
        continue;
      }
      const srcAudio = resolve(ROOT, block.audio);
      if (!existsSync(srcAudio)) {
        console.warn(`⚠️  no existe el audio: ${srcAudio}`);
        continue;
      }
      const wav = join(TMP, `${project.id}__${block.id}.wav`);
      // mp3/m4a -> wav 16kHz (whisper.cpp exige 16kHz)
      execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", srcAudio, wav], { stdio: "ignore" });

      process.stdout.write(`🎙  transcribiendo ${project.id}/${block.id} ... `);
      const result = await transcribe({
        inputPath: wav,
        whisperPath: WHISPER_DIR,
        whisperCppVersion: WHISPER_VERSION,
        model: MODEL,
        modelFolder: WHISPER_DIR,
        tokenLevelTimestamps: false, // v1.5.5 no soporta --dtw; usamos nivel frase
        language: LANG, // null = auto-detecta idioma
        printOutput: false,
      });
      const { captions } = toCaptions({ whisperCppOutput: result });
      writeFileSync(out, JSON.stringify({ language: LANG, captions }, null, 2));
      rmSync(wav, { force: true });
      console.log(`ok (${captions.length} líneas)`);
      if (captions.length) {
        console.log("   ej: " + captions.slice(0, 3).map((c) => `"${c.text.trim()}"`).join("  /  "));
      }
    }
  }
  console.log("\n✅ Subtítulos en data/captions/. Corre `npm run manifest` para incrustarlos en el video.");
}

main().catch((e) => {
  console.error("\n⚠️  Falló la transcripción:", e.message);
  console.error("   El video se puede renderizar igual SIN subtítulos (quita 'captions' o ignora este paso).");
  process.exit(1);
});
