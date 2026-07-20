#!/usr/bin/env node
/**
 * master-audio.mjs
 * ----------------
 * Masteriza la narración (voz): BORRA los metadatos (quita el C2PA "hecho por
 * Eleven Labs") y deja la voz con sonido profesional:
 *   - highpass 80Hz (quita rumble)
 *   - compresión suave (glue)
 *   - EQ: +calidez (200Hz) y de-ess (6.5kHz)
 *   - loudnorm a -14 LUFS (estándar de YouTube)
 *
 * Se activa con "masterAudio": true en el proyecto. Escribe data/mastered/,
 * y build-manifest usa ese audio en vez del original.
 *
 * Uso:  node scripts/master-audio.mjs [--force]
 */
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const OUT = join(ROOT, "data", "mastered");
const FORCE = process.argv.includes("--force");

// cadena de mastering de voz
const CHAIN = [
  "highpass=f=80",
  "acompressor=threshold=-18dB:ratio=3:attack=20:release=200",
  "equalizer=f=200:t=q:w=1:g=1.5",
  "equalizer=f=6500:t=q:w=2:g=-2.5",
  "loudnorm=I=-14:TP=-1.5:LRA=11",
].join(",");

const masteredPath = (pid, bid) => join(OUT, `${pid}__${bid}.mp3`);

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const projects = config.projects.filter((p) => p.masterAudio);
if (!projects.length) {
  console.log("Ningún proyecto tiene 'masterAudio': true. Nada que masterizar.");
  process.exit(0);
}
if (!ffmpegPath || !existsSync(ffmpegPath)) {
  console.error("❌ ffmpeg-static no está. Corre: npm install ffmpeg-static");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
console.log("🎚  Masterizando voz (strip metadatos + compresión + EQ + loudnorm -14 LUFS)...");

for (const project of projects) {
  for (const block of project.blocks) {
    if (!block.audio) continue; // los separadores no tienen audio
    const src = resolve(ROOT, block.audio);
    if (!existsSync(src)) { console.warn(`⚠️  no existe: ${src}`); continue; }
    const out = masteredPath(project.id, block.id);
    if (existsSync(out) && !FORCE) { console.log(`⏭  ya existe ${project.id}/${block.id} (--force para rehacer)`); continue; }
    process.stdout.write(`🎙  ${project.id}/${block.id} ... `);
    try {
      execFileSync(ffmpegPath, ["-y", "-i", src, "-map_metadata", "-1", "-af", CHAIN, "-codec:a", "libmp3lame", "-b:a", "192k", out], { stdio: ["ignore", "ignore", "ignore"] });
      console.log("ok (metadatos borrados + masterizado)");
    } catch (e) {
      console.log("falló → " + (e.message || "").split("\n")[0]);
    }
  }
}
console.log("\n✅ Audio masterizado en data/mastered/. Corre `npm run manifest` (lo usará en vez del original).");
