#!/usr/bin/env node
/**
 * transcribe-cloud.mjs
 * --------------------
 * Saca los SUBTITULOS directo del AUDIO, con timestamps por palabra, usando una
 * API de Whisper en la NUBE (Groq u OpenAI). La IA corre en SUS servidores: tu
 * equipo no hace nada. Groq tiene plan gratis.
 *
 * NO necesitas el guion: transcribe el mp3 tal cual y agrupa las palabras en
 * lineas cortas (con su tiempo exacto). Escribe data/captions/<proj>__<block>.json,
 * el mismo formato que consume build-manifest.
 *
 * Configura tu key (una vez) en faceless-pipeline/.env:
 *     GROQ_API_KEY=gsk_xxxxx           (recomendado, gratis: https://console.groq.com/keys)
 *   o OPENAI_API_KEY=sk-xxxxx
 *
 * Uso:  node scripts/transcribe-cloud.mjs [--force] [--lang=es] [--max=28]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const CAP_DIR = join(ROOT, "data", "captions");

const FORCE = process.argv.includes("--force");
const LANG = (process.argv.find((a) => a.startsWith("--lang=")) || "").split("=")[1] || null;
const MAX_CHARS = parseInt((process.argv.find((a) => a.startsWith("--max=")) || "").split("=")[1] || "28", 10);

// carga variables de faceless-pipeline/.env (sin dependencias)
function loadEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
loadEnv();

// elige proveedor segun la key disponible
function provider() {
  if (process.env.GROQ_API_KEY) {
    return { name: "Groq", base: "https://api.groq.com/openai/v1", key: process.env.GROQ_API_KEY, model: process.env.WHISPER_MODEL || "whisper-large-v3-turbo" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: "OpenAI", base: "https://api.openai.com/v1", key: process.env.OPENAI_API_KEY, model: process.env.WHISPER_MODEL || "whisper-1" };
  }
  return null;
}

// agrupa palabras (con start/end en segundos) en lineas cortas de subtitulo
function groupWords(words, maxChars) {
  const lines = [];
  let cur = { text: "", startMs: null, endMs: null, words: [] };
  const push = () => {
    if (cur.words.length) lines.push({ text: cur.text, startMs: cur.startMs, endMs: cur.endMs, words: cur.words });
    cur = { text: "", startMs: null, endMs: null, words: [] };
  };
  for (const w of words) {
    const wt = (w.word ?? w.text ?? "").trim();
    if (!wt) continue;
    const s = Math.round(w.start * 1000), e = Math.round(w.end * 1000);
    const tentative = cur.text ? cur.text + " " + wt : wt;
    if (tentative.length > maxChars && cur.text) {
      push();
      cur = { text: wt, startMs: s, endMs: e, words: [{ text: wt, startMs: s, endMs: e }] };
    } else {
      if (cur.startMs === null) cur.startMs = s;
      cur.text = tentative;
      cur.endMs = e;
      cur.words.push({ text: wt, startMs: s, endMs: e });
    }
    if (/[.!?…]$/.test(wt) && cur.text.length >= maxChars * 0.4) push();
  }
  push();
  return lines;
}

async function transcribeFile(prov, filePath) {
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), "audio.mp3");
  form.append("model", prov.model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  if (LANG) form.append("language", LANG);

  const res = await fetch(`${prov.base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${prov.key}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${prov.name} respondio ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  // word-level si viene; si no, cae a segmentos
  if (json.words && json.words.length) return { words: json.words };
  if (json.segments && json.segments.length)
    return { words: json.segments.map((s) => ({ word: s.text, start: s.start, end: s.end })) };
  return { words: [{ word: json.text ?? "", start: 0, end: 0 }] };
}

// ---- main ----
const prov = provider();
if (!prov) {
  // No-fatal: así `npm run build` no se rompe por falta de key. Los subtítulos
  // pueden venir del guion (captions-from-script) o generarse luego con la key.
  console.warn("⚠️  Sin API key de Whisper (GROQ_API_KEY / OPENAI_API_KEY en faceless-pipeline/.env).");
  console.warn("     Salto la transcripción por audio. Key gratis de Groq: https://console.groq.com/keys");
  process.exit(0);
}

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const projects = config.projects.filter((p) => p.captions);
if (projects.length === 0) {
  console.log("Ningun proyecto tiene 'captions': true. Nada que transcribir.");
  process.exit(0);
}
mkdirSync(CAP_DIR, { recursive: true });
console.log(`☁️  Transcribiendo en la nube con ${prov.name} (${prov.model}). Tu equipo no corre IA.`);

for (const project of projects) {
  const maxChars = project.captionMaxChars ?? MAX_CHARS;
  for (const block of project.blocks) {
    if (block.card !== undefined) continue; // los separadores no llevan subtítulos
    const out = join(CAP_DIR, `${project.id}__${block.id}.json`);
    if (existsSync(out) && !FORCE) { console.log(`⏭  ya existe: ${project.id}/${block.id} (--force para rehacer)`); continue; }
    const srcAudio = resolve(ROOT, block.audio);
    if (!existsSync(srcAudio)) { console.warn(`⚠️  no existe el audio: ${srcAudio}`); continue; }

    process.stdout.write(`🎙  ${project.id}/${block.id} → subiendo audio... `);
    try {
      const { words } = await transcribeFile(prov, srcAudio);
      const captions = groupWords(words, maxChars);
      writeFileSync(out, JSON.stringify({ source: prov.name.toLowerCase(), captions }, null, 2));
      console.log(`ok (${captions.length} líneas, palabra por palabra)`);
      if (captions.length) console.log("   ej: " + captions.slice(0, 3).map((c) => `"${c.text}"`).join("  /  "));
    } catch (e) {
      console.log("falló");
      console.error("   " + e.message);
    }
  }
}
console.log("\n✅ Listo. Corre `npm run manifest` para incrustar los subtítulos.");
