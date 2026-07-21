#!/usr/bin/env node
/**
 * timestamps-md.mjs
 * -----------------
 * Transcribe cada audio del proyecto con Groq (nube) y genera un MARKDOWN con
 * los TIMESTAMPS por frase. Ese .md es el que usas (o le pasas a la otra IA) para
 * pedir la generación de imágenes por escena y para armar los subtítulos.
 *
 * Requiere GROQ_API_KEY (o OPENAI_API_KEY) en faceless-pipeline/.env
 *
 * Uso:  node scripts/timestamps-md.mjs [--project=moises]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const OUT_DIR = join(ROOT, "data", "timestamps");
const PROJECT = (process.argv.find((a) => a.startsWith("--project=")) || "").split("=")[1] || null;
const SCENE_SEC = parseFloat((process.argv.find((a) => a.startsWith("--scene=")) || "").split("=")[1] || "4");

function loadEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
loadEnv();

function provider() {
  if (process.env.GROQ_API_KEY)
    return { name: "Groq", base: "https://api.groq.com/openai/v1", key: process.env.GROQ_API_KEY, model: process.env.WHISPER_MODEL || "whisper-large-v3-turbo" };
  if (process.env.OPENAI_API_KEY)
    return { name: "OpenAI", base: "https://api.openai.com/v1", key: process.env.OPENAI_API_KEY, model: process.env.WHISPER_MODEL || "whisper-1" };
  return null;
}

const fmt = (sec) => {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
};

// Agrupa palabras (con start/end) en ESCENAS de ~targetSec, cortando en frases.
function sceneChunks(words, targetSec) {
  const scenes = [];
  let cur = { text: "", start: null, end: null };
  const push = () => { if (cur.text) scenes.push(cur); cur = { text: "", start: null, end: null }; };
  for (const w of words) {
    const wt = (w.word ?? w.text ?? "").trim();
    if (!wt) continue;
    if (cur.start === null) cur.start = w.start;
    cur.text = cur.text ? cur.text + " " + wt : wt;
    cur.end = w.end;
    const dur = cur.end - cur.start;
    const endsSentence = /[.!?…]$/.test(wt);
    const endsClause = /[,;:]$/.test(wt);
    if ((endsSentence && dur >= targetSec * 0.6) || dur >= targetSec * 1.5 || (endsClause && dur >= targetSec)) push();
  }
  push();
  return scenes;
}

async function transcribe(prov, filePath) {
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), "audio.mp3");
  form.append("model", prov.model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  const res = await fetch(`${prov.base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${prov.key}` }, body: form });
  if (!res.ok) throw new Error(`${prov.name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const prov = provider();
if (!prov) {
  console.error("❌ Falta GROQ_API_KEY (o OPENAI_API_KEY) en faceless-pipeline/.env");
  process.exit(1);
}

const AUDIO = (process.argv.find((a) => a.startsWith("--audio=")) || "").split("=")[1] || null;
const NAME = (process.argv.find((a) => a.startsWith("--name=")) || "").split("=")[1] || null;

mkdirSync(OUT_DIR, { recursive: true });

// Construye la sección MD (tabla de escenas) para un audio.
async function sectionFor(label, audioPath) {
  const srcAudio = resolve(ROOT, audioPath);
  if (!existsSync(srcAudio)) { console.warn(`⚠️  no existe: ${srcAudio}`); return ""; }
  process.stdout.write(`🎙  ${label} → Groq... `);
  const json = await transcribe(prov, srcAudio);
  const words = json.words ?? [];
  const segments = json.segments ?? [];
  const dur = json.duration ?? (segments.at(-1)?.end ?? words.at(-1)?.end ?? 0);
  const scenes = words.length ? sceneChunks(words, SCENE_SEC) : segments.map((s) => ({ text: s.text, start: s.start, end: s.end }));
  console.log(`ok (${scenes.length} escenas, ${dur.toFixed(1)}s)`);
  let md = `## Audio: \`${label}\` — ${dur.toFixed(1)}s · idioma: ${json.language ?? "?"} · ${scenes.length} escenas (~${SCENE_SEC}s c/u)\n\n`;
  md += `| Escena | Inicio | Fin | Dur | Narración (para imagen + subtítulo) |\n|--------|--------|-----|-----|-----------|\n`;
  scenes.forEach((s, i) => {
    md += `| ${i + 1} | ${fmt(s.start)} | ${fmt(s.end)} | ${(s.end - s.start).toFixed(1)}s | ${s.text.trim().replace(/\|/g, "\\|")} |\n`;
  });
  return md + "\n";
}

const header = (title) => `# ⏱ Timestamps — ${title}\n\n> Generado con ${prov.name} (${prov.model}). Úsalo para pedir imágenes por escena y para subtítulos.\n\n`;

// Modo 1: un audio suelto (antes de tener config/imágenes)
if (AUDIO) {
  const label = NAME || AUDIO.split("/").pop().replace(/\.[^.]+$/, "");
  const md = header(label) + (await sectionFor(label, AUDIO));
  const outPath = join(OUT_DIR, `${label}.md`);
  writeFileSync(outPath, md);
  console.log(`✅ ${outPath}`);
  process.exit(0);
}

// Modo 2: AUDIO-FIRST — descubre los audios en proyectos/<id>/audio/, NO solo
// los que ya son tanda. Así sacas los timestamps ANTES de crear las tandas
// (que es el flujo documentado: audios → timestamps → imágenes → tandas).
const config = JSON.parse(readFileSync(CONFIG, "utf8"));
for (const project of config.projects) {
  if (PROJECT && project.id !== PROJECT) continue;

  const audioDir = resolve(ROOT, `../proyectos/${project.id}/audio`);
  let files = [];
  try { files = readdirSync(audioDir).filter((f) => /\.(mp3|wav|m4a|aac)$/i.test(f)).sort(); } catch {}

  // por si algún bloque referencia un audio fuera de esa carpeta, lo incluimos también
  const known = new Set(files);
  const extra = (project.blocks ?? [])
    .filter((b) => b.audio && !known.has(basename(b.audio)))
    .map((b) => b.audio);

  if (files.length === 0 && extra.length === 0) {
    console.warn(`⚠️  ${project.id}: no hay audios en ${audioDir}`);
    continue;
  }

  let md = header(project.title ?? project.id);
  for (const f of files) md += await sectionFor(f.replace(/\.[^.]+$/, ""), join(audioDir, f));
  for (const a of extra) md += await sectionFor(basename(a).replace(/\.[^.]+$/, ""), resolve(ROOT, a));

  const outPath = join(OUT_DIR, `${project.id}.md`);
  writeFileSync(outPath, md);
  console.log(`✅ ${outPath}\n`);
}
