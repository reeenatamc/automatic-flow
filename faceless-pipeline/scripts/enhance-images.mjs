#!/usr/bin/env node
/**
 * enhance-images.mjs
 * -------------------
 * Procesa las imágenes en 3 pasos y las deja en public/projects/<id>/images/:
 *   1) UPSCALE con Real-ESRGAN (IA, agrega detalle). Fallback a sharp/sips.
 *   2) RE-ENCODE con sharp → normaliza a 3840px y BORRA los metadatos de origen
 *      (quita huella de "creado por IA"; entra ruido de foto real).
 *   3) LOOK "filmic" (opcional): color grade + grano de film + viñeta, para que
 *      no se vea "cara de IA" y tenga estética de cine.
 *
 * Filmic se activa con --filmic o con "look": "filmic" en el proyecto (config).
 * Idempotente: no re-procesa lo hecho salvo --force.
 *
 * Uso:  node scripts/enhance-images.mjs [--force] [--filmic]
 */
import { readFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const PUBLIC = join(ROOT, "public");
const BIN_DIR = join(ROOT, "bin");
const REAL_ESRGAN = join(BIN_DIR, "realesrgan-ncnn-vulkan");
const MODEL = "realesrgan-x4plus";
const MAX_WIDTH = 3840;
const FORCE = process.argv.includes("--force");
const FORCE_FILMIC = process.argv.includes("--filmic");
const REUPSCALE = process.argv.includes("--reupscale");
const CACHE_DIR = join(BIN_DIR, "upscale-cache"); // guarda el upscale IA (sin grade) para iterar el look rápido

const imgName = (blockId, i) => `${blockId}-${String(i + 1).padStart(2, "0")}.png`;
const pad = (n) => String(n).padStart(2, "0");

let sharp = null;
try { sharp = (await import("sharp")).default; } catch {}

function ensureUpscaler() {
  if (existsSync(REAL_ESRGAN)) return true;
  console.log("⬇️  Descargando Real-ESRGAN (solo la primera vez, ~30 MB)...");
  try {
    mkdirSync(BIN_DIR, { recursive: true });
    const url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip";
    const zip = join(BIN_DIR, "realesrgan.zip");
    execFileSync("curl", ["-L", "--fail", "--silent", "--show-error", "-o", zip, url], { stdio: "inherit" });
    execFileSync("unzip", ["-o", "-q", zip, "-d", BIN_DIR], { stdio: "inherit" });
    rmSync(zip, { force: true });
    try { execFileSync("xattr", ["-dr", "com.apple.quarantine", BIN_DIR]); } catch {}
    try { execFileSync("chmod", ["+x", REAL_ESRGAN]); } catch {}
    return existsSync(REAL_ESRGAN);
  } catch (e) {
    console.warn("⚠️  No pude instalar Real-ESRGAN:", (e.message || "").split("\n")[0]);
    return false;
  }
}

function realesrgan4x(srcAbs) {
  const tmp = join(BIN_DIR, `tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
  execFileSync(REAL_ESRGAN, ["-i", srcAbs, "-o", tmp, "-n", MODEL, "-s", "4", "-f", "png"], {
    stdio: ["ignore", "ignore", "ignore"],
    cwd: BIN_DIR,
  });
  return tmp;
}

// Real-ESRGAN 4x -> normaliza a MAX_WIDTH (sin grade) -> cachea. Reusa si ya existe.
async function upscaleToCache(srcAbs, cacheKey) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cached = join(CACHE_DIR, `${cacheKey}.png`);
  if (existsSync(cached) && !REUPSCALE) return { path: cached, fresh: false };
  const tmp = realesrgan4x(srcAbs);
  try {
    await sharp(tmp, { failOn: "none", limitInputPixels: false })
      .resize({ width: MAX_WIDTH, kernel: "lanczos3", withoutEnlargement: false })
      .png({ compressionLevel: 6 })
      .toFile(cached);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { path: cached, fresh: true };
}

// ruido monocromo suave (grano)
function noiseBuffer(w, h) {
  const buf = Buffer.allocUnsafe(w * h);
  for (let i = 0; i < buf.length; i++) buf[i] = 118 + Math.floor(Math.random() * 20); // ~128 ±10
  return buf;
}

// sharp: resize a MAX_WIDTH + (filmic) grade/grano/viñeta + re-encode (borra metadatos)
async function finalize(inputAbs, outAbs, filmic) {
  const meta = await sharp(inputAbs, { failOn: "none", limitInputPixels: false }).metadata();
  const w = meta.width, h = meta.height; // el input ya viene normalizado a MAX_WIDTH

  let pipe = sharp(inputAbs, { failOn: "none", limitInputPixels: false });

  if (filmic) {
    // grade: desatura leve + sube brillo + contraste SUAVE (sin crushear sombras)
    pipe = pipe.modulate({ saturation: 0.92, brightness: 1.05 }).linear(1.05, -3);
    const nw = Math.round(w / 2), nh = Math.round(h / 2);
    const grain = await sharp(noiseBuffer(nw, nh), { raw: { width: nw, height: nh, channels: 1 } }).resize(w, h).png().toBuffer();
    // viñeta más suave (esquinas menos oscuras)
    const vignette = Buffer.from(
      `<svg width="${w}" height="${h}"><defs><radialGradient id="v" cx="50%" cy="50%" r="78%">` +
        `<stop offset="62%" stop-color="#ffffff"/><stop offset="100%" stop-color="#c6c6c6"/></radialGradient></defs>` +
        `<rect width="100%" height="100%" fill="url(#v)"/></svg>`
    );
    pipe = pipe.composite([
      { input: grain, blend: "overlay" },
      { input: vignette, blend: "multiply" },
    ]);
  }

  await pipe.png({ compressionLevel: 9 }).toFile(outAbs); // re-encode => sin metadatos de origen
}

function sipsFallback(srcAbs, outAbs) {
  copyFileSync(srcAbs, outAbs);
  execFileSync("sips", ["-Z", String(MAX_WIDTH), outAbs], { stdio: "ignore" });
}

async function processImage(srcAbs, outAbs, filmic, cacheKey) {
  if (!sharp) { sipsFallback(srcAbs, outAbs); return "sips (sin sharp: sin filmic ni strip)"; }
  let normalized, how;
  if (useReal) {
    const r = await upscaleToCache(srcAbs, cacheKey);
    normalized = r.path;
    how = r.fresh ? "IA" : "cache";
  } else {
    mkdirSync(CACHE_DIR, { recursive: true });
    normalized = join(CACHE_DIR, `${cacheKey}.png`);
    if (!existsSync(normalized) || REUPSCALE) {
      await sharp(srcAbs, { failOn: "none", limitInputPixels: false })
        .resize({ width: MAX_WIDTH, kernel: "lanczos3", withoutEnlargement: false })
        .png({ compressionLevel: 6 })
        .toFile(normalized);
    }
    how = "sharp";
  }
  await finalize(normalized, outAbs, filmic);
  return `${how} + reencode${filmic ? " + filmic" : ""}`;
}

// ---- main ----
const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const useReal = ensureUpscaler();
console.log(useReal ? "✨ Upscale con Real-ESRGAN (IA)." : sharp ? "↩️  Sin Real-ESRGAN: escalo con sharp (lanczos)." : "↩️  Sin sharp ni IA: sips básico.");
if (!sharp) console.warn("⚠️  sharp no está instalado: no habrá re-encode/strip ni filmic. Corre: npm install sharp");

let total = 0;
for (const p of config.projects) for (const b of p.blocks) total += b.images?.length ?? 0;
let count = 0;

for (const project of config.projects) {
  const srcDir = resolve(ROOT, project.sourceImagesDir);
  const outDir = join(PUBLIC, "projects", project.id, "images");
  mkdirSync(outDir, { recursive: true });
  const filmic = FORCE_FILMIC || project.look === "filmic";
  if (filmic) console.log(`🎞  ${project.id}: look FILMIC activado (grade + grano + viñeta)`);

  for (const block of project.blocks) {
    if (block.card !== undefined) continue;
    const items = block.images ?? [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const file = typeof item === "string" ? item : item.file;
      const srcAbs = join(srcDir, file);
      const outAbs = join(outDir, file);
      const cacheKey = `${project.id}__${file.replace(/\.[^.]+$/, "")}`;
      count++;
      const tag = `(${pad(count)}/${pad(total)})`;

      if (!existsSync(srcAbs)) { console.warn(`${tag} ⚠️  no existe: ${srcAbs}`); continue; }
      if (existsSync(outAbs) && !FORCE) { console.log(`${tag} ⏭  ya existe ${basename(outAbs)}`); continue; }

      process.stdout.write(`${tag} 🖼  ${file} → ${basename(outAbs)} ... `);
      try {
        const how = await processImage(srcAbs, outAbs, filmic, cacheKey);
        console.log(how);
      } catch (e) {
        console.log("falló → " + (e.message || "").split("\n")[0]);
        try { sipsFallback(srcAbs, outAbs); console.log(`${tag}    ↳ ok (sips)`); } catch {}
      }
    }
  }
}
console.log(`\n✅ Listo. Imágenes en public/projects/<id>/images/`);
