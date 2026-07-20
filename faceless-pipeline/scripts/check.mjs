#!/usr/bin/env node
/**
 * check.mjs — valida projects.config.json ANTES de gastar tiempo renderizando.
 * -----------------------------------------------------------------------------
 * Revisa, por proyecto y bloque:
 *   • que existan los archivos (imagenes de origen + audio de cada bloque)
 *   • el timeline: huecos, solapes y orden de los `start`/`end`
 *   • que las imagenes cubran el audio (sin quedarse cortas ni pasarse)
 *   • que los `hooks` apunten a bloques que existen
 *   • cards bien formadas y subtitulos disponibles si captions:true
 *
 * ERRORES (rojo) = algo que romperia el render → sale con codigo 1.
 * AVISOS (amarillo) = algo raro pero no fatal → sale con codigo 0.
 *
 * Uso:  npm run check   [--project=moises]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audioDurationSeconds } from "./lib/audio.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const projectFilter = (process.argv.find((a) => a.startsWith("--project=")) || "").split("=")[1] || null;

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

if (!existsSync(CONFIG)) {
  console.error("❌ No existe projects.config.json");
  process.exit(1);
}
const config = JSON.parse(readFileSync(CONFIG, "utf8"));

for (const project of config.projects ?? []) {
  if (projectFilter && project.id !== projectFilter) continue;
  const tag = `[${project.id}]`;
  const fps = project.fps ?? 30;
  const srcDir = resolve(ROOT, project.sourceImagesDir ?? ".");

  if (!project.id) err(`${tag} el proyecto no tiene "id"`);
  if (project.sourceImagesDir && !existsSync(srcDir))
    warn(`${tag} sourceImagesDir no existe: ${project.sourceImagesDir} (necesario para 'npm run enhance')`);

  const blockIds = new Set();

  for (const block of project.blocks ?? []) {
    const bt = `${tag} ${block.id ?? "(sin id)"}`;
    if (!block.id) err(`${tag} hay un bloque sin "id"`);
    else if (blockIds.has(block.id)) err(`${bt}: id de bloque repetido`);
    blockIds.add(block.id);

    // --- CARD ---
    if (block.card !== undefined) {
      if (typeof block.card !== "string" || !block.card.trim()) err(`${bt}: card sin texto`);
      if (block.seconds != null && !(block.seconds > 0)) err(`${bt}: seconds debe ser > 0`);
      continue;
    }

    // --- MEDIA: audio ---
    if (!block.audio) { err(`${bt}: bloque de media sin "audio"`); continue; }
    const audioAbs = resolve(ROOT, block.audio);
    let durSec = null;
    if (!existsSync(audioAbs)) {
      err(`${bt}: no existe el audio → ${block.audio}`);
    } else {
      try { durSec = await audioDurationSeconds(audioAbs); }
      catch { warn(`${bt}: no pude medir la duracion del audio`); }
    }

    // --- MEDIA: imagenes ---
    const imgs = (block.images ?? []).map((it) => (typeof it === "string" ? { file: it } : it));
    if (imgs.length === 0) { warn(`${bt}: bloque sin imagenes (saldra en negro)`); continue; }

    for (const im of imgs) {
      if (!im.file) { err(`${bt}: hay una imagen sin "file"`); continue; }
      if (project.sourceImagesDir && !existsSync(join(srcDir, im.file)))
        err(`${bt}: falta la imagen → ${im.file} (en ${project.sourceImagesDir})`);
    }

    // --- MEDIA: timeline (solo si todas traen start) ---
    const timed = imgs.every((im) => im.start != null);
    if (timed) {
      let prevEnd = null;
      imgs.forEach((im, i) => {
        const s = im.start, e = im.end ?? (im.duration != null ? s + im.duration : null);
        if (i > 0 && s < (imgs[i - 1].start ?? 0)) err(`${bt}: ${im.file} arranca (${s}s) antes que la imagen anterior — estan desordenadas`);
        if (e != null && e < s) err(`${bt}: ${im.file} termina (${e}s) antes de empezar (${s}s)`);
        if (prevEnd != null) {
          const d = s - prevEnd;
          if (d > 0.05) warn(`${bt}: HUECO de ${d.toFixed(2)}s antes de ${im.file} (${prevEnd}s → ${s}s)`);
          if (d < -0.05) warn(`${bt}: SOLAPE de ${(-d).toFixed(2)}s antes de ${im.file} (${prevEnd}s → ${s}s)`);
        }
        prevEnd = e ?? prevEnd;
      });
      // cobertura vs audio
      const lastEnd = imgs[imgs.length - 1].end;
      if (durSec != null && lastEnd != null) {
        const diff = lastEnd - durSec;
        if (diff < -0.4) warn(`${bt}: las imagenes cubren ${lastEnd}s pero el audio dura ${durSec.toFixed(1)}s (faltan ${(-diff).toFixed(1)}s → la ultima se estira)`);
        if (diff > 0.4) warn(`${bt}: las imagenes cubren ${lastEnd}s, MAS que el audio (${durSec.toFixed(1)}s) → se recorta el final`);
      }
    } else if (imgs.some((im) => im.start != null)) {
      err(`${bt}: mezcla imagenes con y sin "start". Usa start/end en TODAS o en NINGUNA.`);
    }

    // --- subtitulos ---
    if (project.captions) {
      const capFile = join(ROOT, "data", "captions", `${project.id}__${block.id}.json`);
      const hasScript = block.script || block.scriptFile;
      if (!existsSync(capFile) && !hasScript)
        warn(`${bt}: captions:true pero sin subtitulos (corre 'npm run transcribe:cloud' o agrega "scriptFile")`);
    }
  }

  // --- hooks (bloques enteros o ventana de tiempo) ---
  for (const h of project.hooks ?? []) {
    if (!h.id) err(`${tag} hay un hook sin "id"`);
    const isWindow = h.block != null && (h.start != null || h.end != null);
    if (isWindow) {
      if (!blockIds.has(h.block)) err(`${tag} hook '${h.id}': el bloque '${h.block}' no existe`);
      const s = h.start ?? 0, e = h.end;
      if (e != null && e <= s) err(`${tag} hook '${h.id}': end (${e}s) debe ser mayor que start (${s}s)`);
      if (e != null && e - s < 3) warn(`${tag} hook '${h.id}': dura ${(e - s).toFixed(1)}s (los ganchos rinden mejor entre ~10-25s)`);
      if (e != null && e - s > 40) warn(`${tag} hook '${h.id}': dura ${(e - s).toFixed(1)}s (muy largo para un short; apunta a ~10-25s)`);
    } else {
      const bad = (h.blocks ?? []).filter((id) => !blockIds.has(id));
      if (bad.length) err(`${tag} hook '${h.id}' apunta a bloques que no existen: ${bad.join(", ")}`);
      if (!(h.blocks ?? []).length) warn(`${tag} hook '${h.id}' no tiene "blocks" ni "block"+start/end`);
    }
  }
}

// --- reporte ---
console.log("");
for (const w of warns) console.log(`⚠️  ${w}`);
for (const e of errors) console.log(`❌ ${e}`);
console.log("");
if (errors.length) {
  console.log(`❌ ${errors.length} error(es)${warns.length ? ` y ${warns.length} aviso(s)` : ""}. Arregla los errores antes de renderizar.`);
  process.exit(1);
}
console.log(warns.length ? `✅ Sin errores (${warns.length} aviso[s] revisables arriba). Listo para 'npm run build && npm run render'.` : "✅ Todo en orden. Listo para 'npm run build && npm run render'.");
