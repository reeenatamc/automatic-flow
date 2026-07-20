#!/usr/bin/env node
/**
 * build-manifest.mjs
 * ------------------
 * Lee projects.config.json, mide la duracion de cada narracion y calcula los
 * tiempos (frames) de cada imagen. Escribe src/manifest.json que Remotion usa
 * para construir el video. Tambien copia los audios a public/.
 *
 * Sincronizacion HIBRIDA (lo que pediste: manual + automatico):
 *   - Imagen como string            -> reparto automatico parejo.
 *   - Imagen como {file, duration}  -> esos segundos son fijos (manual).
 *   - El tiempo restante del bloque se reparte entre las imagenes "automaticas".
 *
 * Uso:  node scripts/build-manifest.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { audioDurationSeconds } from "./lib/audio.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const PUBLIC = join(ROOT, "public");
const CAP_DIR = join(ROOT, "data", "captions");

const imgName = (blockId, i) => `${blockId}-${String(i + 1).padStart(2, "0")}.png`;

// Carga subtitulos (si existen) y los pasa a frames relativos al bloque.
function loadCaptions(pid, bid, fps) {
  const p = join(CAP_DIR, `${pid}__${bid}.json`);
  if (!existsSync(p)) return undefined;
  try {
    const { captions } = JSON.parse(readFileSync(p, "utf8"));
    return (captions ?? [])
      .map((c) => {
        const startFrame = Math.max(0, Math.round((c.startMs / 1000) * fps));
        const endFrame = Math.round((c.endMs / 1000) * fps);
        const words = (c.words ?? []).map((w) => {
          const ws = Math.max(0, Math.round((w.startMs / 1000) * fps));
          const we = Math.round((w.endMs / 1000) * fps);
          return { text: w.text, startFrame: ws, durationInFrames: Math.max(1, we - ws) };
        });
        return { text: c.text, startFrame, durationInFrames: Math.max(1, endFrame - startFrame), words };
      })
      .filter((c) => c.text && c.text.trim().length > 0);
  } catch (e) {
    console.warn(`⚠️  no pude leer captions de ${pid}/${bid}: ${e.message}`);
    return undefined;
  }
}

// Copia el SFX del bloque (si tiene) a public y devuelve su ruta + volumen.
function resolveSfx(pid, block) {
  if (!block.sfx) return undefined;
  const src = resolve(ROOT, `assets/sfx/${block.sfx}.mp3`);
  if (!existsSync(src)) { console.warn(`⚠️  SFX no existe: assets/sfx/${block.sfx}.mp3`); return undefined; }
  const rel = `projects/${pid}/sfx/${block.sfx}.mp3`;
  mkdirSync(join(PUBLIC, "projects", pid, "sfx"), { recursive: true });
  copyFileSync(src, join(PUBLIC, rel));
  return { src: rel, volume: block.sfxVolume ?? 0.8 };
}

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const manifest = { projects: {} };

for (const project of config.projects) {
  const fps = project.fps ?? 30;
  mkdirSync(join(PUBLIC, "projects", project.id, "audio"), { recursive: true });

  let cursor = 0; // frame global acumulado en todo el video
  const blocks = [];

  for (const block of project.blocks) {
    // --- bloque tipo CARD (separador de capítulo: cuadro negro con texto) ---
    if (block.card !== undefined) {
      const cardFrames = Math.max(1, Math.round((block.seconds ?? 2) * fps));
      blocks.push({
        id: block.id,
        kind: "card",
        startFrame: cursor,
        audioDurationInFrames: cardFrames,
        text: String(block.card),
        subtitle: block.subtitle,
        sfx: resolveSfx(project.id, block),
      });
      cursor += cardFrames;
      continue;
    }

    let srcAudio = resolve(ROOT, block.audio);
    const mastered = join(ROOT, "data", "mastered", `${project.id}__${block.id}.mp3`);
    if (project.masterAudio && existsSync(mastered)) srcAudio = mastered; // voz masterizada + sin metadatos
    if (!existsSync(srcAudio)) throw new Error(`No existe el audio: ${srcAudio}`);

    const audioPublicRel = `projects/${project.id}/audio/${block.id}.mp3`;
    copyFileSync(srcAudio, join(PUBLIC, audioPublicRel));

    const durSec = await audioDurationSeconds(srcAudio);
    const blockFrames = Math.max(1, Math.round(durSec * fps));

    const imgs = (block.images ?? []).map((it) => (typeof it === "string" ? { file: it } : it));

    // bloque con audio pero SIN imágenes todavía (fase de setup): ocupa su duración en negro
    if (imgs.length === 0) {
      blocks.push({ id: block.id, kind: "media", audio: audioPublicRel, startFrame: cursor, audioDurationInFrames: blockFrames, images: [], captions: undefined });
      cursor += blockFrames;
      continue;
    }

    const blockStart = cursor;
    const srcFor = (im) => `projects/${project.id}/images/${im.file}`;
    let framesArr;

    // ── MODO CRONOMETRADO: cada imagen trae `start` (timeline de SCENE-FORMAT) ──
    // Se posiciona cada imagen en su `start` ABSOLUTO. La duracion de una imagen
    // es "hasta que arranca la siguiente" (la ultima, hasta el fin del audio).
    // Asi un hueco o solape NO desincroniza lo que sigue: cada imagen cae en su
    // segundo exacto. (El bug anterior encadenaba end-start y el error se sumaba.)
    if (imgs.every((im) => im.start != null)) {
      const startF = imgs.map((im) => Math.round(im.start * fps));
      framesArr = startF.map((s, i) => {
        const nextS = i < startF.length - 1 ? startF[i + 1] : blockFrames;
        return Math.max(1, nextS - s);
      });
      const images = imgs.map((im, i) => ({
        src: srcFor(im),
        file: im.file,
        startFrame: blockStart + startF[i],
        durationInFrames: framesArr[i],
      }));
      // avisos utiles (no fatales)
      const lastEnd = imgs[imgs.length - 1].end;
      if (startF[0] > 1) console.warn(`   ⚠️  ${block.id}: la 1a imagen arranca en ${imgs[0].start}s (hay negro antes)`);
      if (lastEnd != null && Math.abs(lastEnd * fps - blockFrames) > fps * 0.4)
        console.warn(`   ⚠️  ${block.id}: las imagenes cubren ${lastEnd}s pero el audio dura ${(blockFrames / fps).toFixed(1)}s (la ultima se estira/recorta para cuadrar)`);

      cursor = blockStart + blockFrames;
      blocks.push({
        id: block.id, kind: "media", audio: audioPublicRel, startFrame: blockStart,
        audioDurationInFrames: blockFrames, images,
        captions: project.captions ? loadCaptions(project.id, block.id, fps) : undefined,
        sfx: resolveSfx(project.id, block),
      });
      continue;
    }

    // ── MODO AUTO/DURACION: sin `start` → reparte parejo (+ `duration` fijos) ──
    const manual = imgs.map((im) => {
      const dur = im.duration != null ? im.duration : null;
      return dur != null && dur > 0 ? Math.max(1, Math.round(dur * fps)) : null;
    });
    const autoCount = manual.filter((f) => f === null).length;
    const usedByManual = manual.reduce((a, f) => a + (f ?? 0), 0);
    let remaining = blockFrames - usedByManual;
    if (autoCount > 0 && remaining < autoCount) remaining = autoCount; // cada auto >= 1 frame
    const perAuto = autoCount > 0 ? Math.floor(remaining / autoCount) : 0;

    framesArr = manual.map((f) => (f === null ? perAuto : f));
    // ajustar redondeo: la ultima imagen absorbe la diferencia para cuadrar exacto con el audio
    const sum = framesArr.reduce((a, b) => a + b, 0);
    framesArr[framesArr.length - 1] = Math.max(1, framesArr[framesArr.length - 1] + (blockFrames - sum));

    const images = imgs.map((im, i) => {
      const start = cursor;
      cursor += framesArr[i];
      return {
        src: srcFor(im),
        file: im.file,
        startFrame: start,
        durationInFrames: framesArr[i],
      };
    });

    blocks.push({
      id: block.id,
      kind: "media",
      audio: audioPublicRel,
      startFrame: blockStart,
      audioDurationInFrames: blockFrames,
      images,
      captions: project.captions ? loadCaptions(project.id, block.id, fps) : undefined,
      sfx: resolveSfx(project.id, block),
    });
  }

  // música de fondo (opcional): "music": "assets/music/x.mp3" + "musicVolume": 0.14
  let music = null;
  if (project.music) {
    const musicPath = typeof project.music === "string" ? project.music : project.music.src;
    const vol = typeof project.music === "object" && project.music.volume != null ? project.music.volume : project.musicVolume ?? 0.14;
    const srcMusic = resolve(ROOT, musicPath);
    if (existsSync(srcMusic)) {
      const rel = `projects/${project.id}/music${extname(srcMusic) || ".mp3"}`;
      mkdirSync(join(PUBLIC, "projects", project.id), { recursive: true });
      copyFileSync(srcMusic, join(PUBLIC, rel));
      music = { src: rel, volume: vol };
    } else {
      console.warn(`⚠️  no existe la música: ${srcMusic}`);
    }
  }

  // ── HOOKS (clips de gancho) ──────────────────────────────────────────────
  // Dos formas:
  //   A) BLOQUES ENTEROS:  { "id", "label", "blocks": ["cap1", ...] }
  //   B) VENTANA DE TIEMPO: { "id", "label", "block": "cap1", "start": 0, "end": 13.5 }
  //      → recorta audio + imágenes + subtítulos a esa ventana (un bloque sintético).
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const hookBlocks = [];
  const hooks = [];

  for (const h of project.hooks ?? []) {
    // ---- B) ventana de tiempo ----
    if (h.block != null && (h.start != null || h.end != null)) {
      const sb = blockById.get(h.block);
      if (!sb || sb.kind !== "media") { console.warn(`⚠️  hook '${h.id}': el bloque '${h.block}' no existe o no es de media.`); continue; }
      const startF = Math.max(0, Math.round((h.start ?? 0) * fps));
      const endF = Math.min(sb.audioDurationInFrames, Math.round((h.end ?? sb.audioDurationInFrames / fps) * fps));
      const winLen = endF - startF;
      if (winLen < fps * 0.5) { console.warn(`⚠️  hook '${h.id}': ventana muy corta (${(winLen / fps).toFixed(1)}s), la salto.`); continue; }

      const synthId = `__hook_${h.id}`;
      // imágenes que caen dentro de la ventana, recortadas y re-basadas a 0
      const imgs = (sb.images ?? [])
        .map((im) => {
          const localStart = im.startFrame - sb.startFrame; // relativo al bloque original
          const localEnd = localStart + im.durationInFrames;
          const from = Math.max(localStart, startF);
          const to = Math.min(localEnd, endF);
          if (to <= from) return null; // no solapa la ventana
          return { ...im, startFrame: from - startF, durationInFrames: to - from }; // re-basado al hook
        })
        .filter(Boolean);
      // subtítulos dentro de la ventana, re-basados Y CLAMPEADOS a [0, winLen].
      // Una frase que arranca antes de la ventana se recorta para empezar en 0
      // (si no, saldría con frame negativo y el karaoke se descuadra).
      const caps = (sb.captions ?? [])
        .map((c) => {
          const cStart = c.startFrame, cEnd = c.startFrame + c.durationInFrames;
          if (cEnd <= startF || cStart >= endF) return null;
          const ns = Math.max(0, cStart - startF);
          const nEnd = Math.min(cEnd - startF, winLen);
          if (nEnd - ns <= 0) return null;
          const words = (c.words ?? [])
            .map((w) => ({ ...w, startFrame: Math.max(0, w.startFrame - startF) }))
            .filter((w) => w.startFrame < winLen);
          return { ...c, startFrame: ns, durationInFrames: nEnd - ns, words: words.length ? words : undefined };
        })
        .filter(Boolean);

      hookBlocks.push({
        id: synthId,
        kind: "media",
        startFrame: 0,
        audio: sb.audio,
        audioStartFromFrame: startF, // el audio arranca en este frame del original
        audioDurationInFrames: winLen,
        images: imgs,
        captions: caps.length ? caps : undefined,
      });
      hooks.push({ id: h.id, label: h.label ?? h.id, segment: [synthId] });
      continue;
    }

    // ---- A) bloques enteros ----
    const valid = (h.blocks ?? []).filter((id) => blockById.has(id));
    if (valid.length !== (h.blocks ?? []).length)
      console.warn(`⚠️  hook '${h.id}' referencia bloques inexistentes; uso ${JSON.stringify(valid)}`);
    if (valid.length === 0) { console.warn(`⚠️  hook '${h.id}' sin bloques válidos, lo salto.`); continue; }
    hooks.push({ id: h.id, label: h.label ?? h.id, segment: valid });
  }

  manifest.projects[project.id] = {
    id: project.id,
    title: project.title ?? project.id,
    fps,
    captions: Boolean(project.captions),
    music,
    totalFrames: Math.max(1, cursor),
    blocks,
    hookBlocks,
    hooks,
  };
}

writeFileSync(join(ROOT, "src", "manifest.json"), JSON.stringify(manifest, null, 2));

console.log("✅ manifest generado: src/manifest.json");
for (const p of Object.values(manifest.projects)) {
  const music = p.music ? ` · 🎵 música (vol ${p.music.volume})` : "";
  console.log(`   • ${p.id}: ${p.blocks.length} bloque(s), ${p.totalFrames} frames = ${(p.totalFrames / p.fps).toFixed(1)}s @ ${p.fps}fps${music}`);
  for (const b of p.blocks) {
    if (b.kind === "card") {
      console.log(`     ▪ ${b.id}: [CARD] "${b.text}" (${(b.audioDurationInFrames / p.fps).toFixed(1)}s)`);
      continue;
    }
    const secs = (b.images ?? []).map((im) => (im.durationInFrames / p.fps).toFixed(1) + "s").join(", ");
    const cap = b.captions ? ` · ${b.captions.length} subtítulos` : p.captions ? " · (sin transcribir aún)" : "";
    console.log(`     └ ${b.id}: ${(b.images ?? []).length} imgs [${secs}]${cap}`);
  }
  if (p.hooks.length) {
    const dur = (seg) => seg.reduce((a, id) => a + (([...p.blocks, ...(p.hookBlocks ?? [])].find((b) => b.id === id)?.audioDurationInFrames ?? 0)), 0);
    console.log(`     ⚓ ganchos: ${p.hooks.map((h) => `${h.id} (${(dur(h.segment) / p.fps).toFixed(0)}s)`).join(", ")}`);
  }
}
