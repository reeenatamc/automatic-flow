#!/usr/bin/env node
/**
 * captions-from-script.mjs
 * ------------------------
 * Genera subtitulos SIN IA, a partir del GUION que tú ya tienes (la narracion
 * salio de ese texto). Parte el texto en lineas cortas y las reparte sobre la
 * duracion del audio (ponderado por largo + pausas de puntuacion). Como la voz
 * TTS va a ritmo parejo, la sincronizacion queda muy decente.
 *
 * De dónde saca el texto de cada bloque (en projects.config.json):
 *   "script": "texto de la narracion..."      (inline)
 *   "scriptFile": "../carpeta/narracion.txt"    (archivo .txt — recomendado)
 *
 * Escribe data/captions/<proyecto>__<bloque>.json (mismo formato que usaria
 * whisper), listo para que `build-manifest.mjs` lo incruste.
 *
 * Uso:  node scripts/captions-from-script.mjs [--max=28]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audioDurationMs } from "./lib/audio.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const CAP_DIR = join(ROOT, "data", "captions");

const MAX_CHARS = parseInt((process.argv.find((a) => a.startsWith("--max=")) || "").split("=")[1] || "28", 10);

// Parte el texto en lineas cortas (respeta puntuacion, corta por nº de chars).
function chunk(text, maxChars) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const tentative = cur ? cur + " " + w : w;
    if (tentative.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = tentative;
    }
    // corta despues de puntuacion fuerte para respetar frases
    if (/[.!?…]$/.test(w) && cur.length >= Math.floor(maxChars * 0.4)) {
      lines.push(cur);
      cur = "";
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Peso de cada linea = largo + bonus por pausa de puntuacion (la voz se detiene).
function weight(line) {
  let w = line.length;
  if (/[.!?…]$/.test(line)) w += 8;
  else if (/[,;:]$/.test(line)) w += 4;
  return Math.max(1, w);
}

function timeLines(lines, totalMs) {
  const weights = lines.map(weight);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = 0;
  return lines.map((text, i) => {
    const startMs = Math.round(cursor);
    cursor += (weights[i] / sum) * totalMs;
    const endMs = i === lines.length - 1 ? Math.round(totalMs) : Math.round(cursor);
    return { text, startMs, endMs };
  });
}

function getScript(ROOT, block) {
  if (typeof block.script === "string" && block.script.trim()) return block.script;
  if (block.scriptFile) {
    const p = resolve(ROOT, block.scriptFile);
    if (existsSync(p)) return readFileSync(p, "utf8");
    console.warn(`⚠️  no existe el guion: ${p}`);
  }
  return null;
}

// ---- main ----
const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const projects = config.projects.filter((p) => p.captions);
if (projects.length === 0) {
  console.log("Ningun proyecto tiene 'captions': true. Nada que generar.");
  process.exit(0);
}
mkdirSync(CAP_DIR, { recursive: true });

let generated = 0,
  missing = 0;
for (const project of projects) {
  const maxChars = project.captionMaxChars ?? MAX_CHARS;
  for (const block of project.blocks) {
    if (block.card !== undefined) continue; // los separadores no llevan subtítulos
    const text = getScript(ROOT, block);
    if (!text) {
      console.warn(`⚠️  ${project.id}/${block.id}: sin guion (agrega "script" o "scriptFile"). Sin subtítulos.`);
      missing++;
      continue;
    }
    const srcAudio = resolve(ROOT, block.audio);
    const totalMs = audioDurationMs(srcAudio);
    const lines = chunk(text, maxChars);
    const captions = timeLines(lines, totalMs);
    const out = join(CAP_DIR, `${project.id}__${block.id}.json`);
    writeFileSync(out, JSON.stringify({ source: "script", captions }, null, 2));
    generated++;
    console.log(`✅ ${project.id}/${block.id}: ${captions.length} subtítulos desde el guion (${(totalMs / 1000).toFixed(1)}s)`);
    console.log("   ej: " + captions.slice(0, 3).map((c) => `"${c.text}"`).join("  /  "));
  }
}
console.log(`\n${generated} bloque(s) con subtítulos${missing ? `, ${missing} sin guion` : ""}. Corre \`npm run manifest\` para incrustarlos.`);
