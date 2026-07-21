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
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { applyLook } from "./lib/looks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG = join(ROOT, "projects.config.json");
const PUBLIC = join(ROOT, "public");
const BIN_DIR = join(ROOT, "bin");

// Real-ESRGAN se distribuye como un binario por sistema operativo.
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const REAL_ESRGAN = join(BIN_DIR, IS_WIN ? "realesrgan-ncnn-vulkan.exe" : "realesrgan-ncnn-vulkan");
const ESRGAN_ZIP_URL = (() => {
  const base = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424";
  if (IS_WIN) return `${base}-windows.zip`;
  if (IS_MAC) return `${base}-macos.zip`;
  return `${base}-ubuntu.zip`;
})();
const MODEL = "realesrgan-x4plus";
const MAX_WIDTH = 3840;
const FORCE = process.argv.includes("--force");
const FORCE_FILMIC = process.argv.includes("--filmic");
const REUPSCALE = process.argv.includes("--reupscale");
const CACHE_DIR = join(BIN_DIR, "upscale-cache"); // guarda el upscale IA (sin grade) para iterar el look rápido

const pad = (n) => String(n).padStart(2, "0");

let sharp = null;
try { sharp = (await import("sharp")).default; } catch {}

// Descomprime un .zip sin depender de `unzip` (que no existe en Windows).
function unzipTo(zipAbs, destDir) {
  if (IS_WIN) {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipAbs}' -DestinationPath '${destDir}' -Force`],
      { stdio: "inherit" }
    );
  } else {
    execFileSync("unzip", ["-o", "-q", zipAbs, "-d", destDir], { stdio: "inherit" });
  }
}

async function ensureUpscaler() {
  if (existsSync(REAL_ESRGAN)) return true;
  console.log("⬇️  Descargando Real-ESRGAN (solo la primera vez, ~30 MB)...");
  try {
    mkdirSync(BIN_DIR, { recursive: true });
    const zip = join(BIN_DIR, "realesrgan.zip");
    // fetch nativo (Node 18+): sin curl, igual en todos los sistemas.
    const res = await fetch(ESRGAN_ZIP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} al bajar ${ESRGAN_ZIP_URL}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    unzipTo(zip, BIN_DIR);
    rmSync(zip, { force: true });
    if (IS_MAC) {
      // macOS pone en cuarentena lo descargado y no lo deja ejecutar.
      try { execFileSync("xattr", ["-dr", "com.apple.quarantine", BIN_DIR]); } catch {}
    }
    if (!IS_WIN) {
      try { execFileSync("chmod", ["+x", REAL_ESRGAN]); } catch {}
    }
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

// ¿el archivo de origen es más nuevo que su caché? (imagen reemplazada) Si no se
// puede leer, asumimos que sí (reprocesar) para nunca traer una versión vieja.
function srcIsNewer(srcAbs, cacheAbs) {
  try { return statSync(srcAbs).mtimeMs > statSync(cacheAbs).mtimeMs; } catch { return true; }
}

// Real-ESRGAN 4x -> normaliza a MAX_WIDTH (sin grade) -> cachea. Reusa SOLO si el
// caché es igual o más nuevo que el origen (si subiste una imagen nueva con el
// mismo nombre, el origen es más reciente → se re-ampliá, no trae la vieja).
async function upscaleToCache(srcAbs, cacheKey) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cached = join(CACHE_DIR, `${cacheKey}.png`);
  if (existsSync(cached) && !REUPSCALE && !srcIsNewer(srcAbs, cached)) return { path: cached, fresh: false };
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

// sharp: resize (ya viene normalizado) + look del preset + re-encode (borra metadatos)
async function finalize(inputAbs, outAbs, look) {
  const meta = await sharp(inputAbs, { failOn: "none", limitInputPixels: false }).metadata();
  const w = meta.width, h = meta.height; // el input ya viene normalizado a MAX_WIDTH
  let pipe = sharp(inputAbs, { failOn: "none", limitInputPixels: false });
  pipe = await applyLook(sharp, pipe, look, w, h); // presets en lib/looks.mjs
  await pipe.png({ compressionLevel: 9 }).toFile(outAbs); // re-encode => sin metadatos de origen
}

// Ultimo recurso si sharp no esta disponible. `sips` solo existe en macOS;
// en el resto copiamos la imagen tal cual (sin escalar) para no romper el flujo.
function basicFallback(srcAbs, outAbs) {
  copyFileSync(srcAbs, outAbs);
  if (IS_MAC) {
    execFileSync("sips", ["-Z", String(MAX_WIDTH), outAbs], { stdio: "ignore" });
  } else {
    console.warn(`   ⚠️  copiada sin escalar (instala sharp: npm install sharp)`);
  }
}

async function processImage(srcAbs, outAbs, look, cacheKey) {
  if (!sharp) { basicFallback(srcAbs, outAbs); return "básico (sin sharp: sin look ni strip)"; }
  let normalized, how;
  if (useReal) {
    const r = await upscaleToCache(srcAbs, cacheKey);
    normalized = r.path;
    how = r.fresh ? "IA" : "cache";
  } else {
    mkdirSync(CACHE_DIR, { recursive: true });
    normalized = join(CACHE_DIR, `${cacheKey}.png`);
    if (!existsSync(normalized) || REUPSCALE || srcIsNewer(srcAbs, normalized)) {
      await sharp(srcAbs, { failOn: "none", limitInputPixels: false })
        .resize({ width: MAX_WIDTH, kernel: "lanczos3", withoutEnlargement: false })
        .png({ compressionLevel: 6 })
        .toFile(normalized);
    }
    how = "sharp";
  }
  await finalize(normalized, outAbs, look);
  return `${how} + reencode (${look})`;
}

// ---- main ----
const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const useReal = await ensureUpscaler();
console.log(useReal ? "✨ Upscale con Real-ESRGAN (IA)." : sharp ? "↩️  Sin Real-ESRGAN: escalo con sharp (lanczos)." : "↩️  Sin sharp ni IA: escalado básico del sistema.");
if (!sharp) console.warn("⚠️  sharp no está instalado: no habrá re-encode/strip ni filmic. Corre: npm install sharp");

// Procesa TODAS las imágenes de la carpeta de origen (no solo las que ya están
// en un bloque), para que aparezcan en el constructor de escenas aunque todavía
// no las hayas acomodado. La salida siempre es .png.
const plan = config.projects.map((project) => {
  const srcDir = resolve(ROOT, project.sourceImagesDir);
  let files = [];
  try { files = readdirSync(srcDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort(); } catch {}
  return { project, srcDir, files };
});
const total = plan.reduce((a, p) => a + p.files.length, 0);
let count = 0;

for (const { project, srcDir, files } of plan) {
  const outDir = join(PUBLIC, "projects", project.id, "images");
  mkdirSync(outDir, { recursive: true });
  const look = FORCE_FILMIC ? "filmic" : (project.look || "none");
  console.log(`🎞  ${project.id}: look = ${look} · ${files.length} imágenes`);

  for (const file of files) {
    const srcAbs = join(srcDir, file);
    const outFile = file.replace(/\.[^.]+$/, ".png"); // normaliza extensión a .png
    const outAbs = join(outDir, outFile);
    const cacheKey = `${project.id}__${file.replace(/\.[^.]+$/, "")}`;
    count++;
    const tag = `(${pad(count)}/${pad(total)})`;

    // salta solo si ya está procesada Y el origen no cambió (si la reemplazaste,
    // el origen es más nuevo → se reprocesa, no deja la vieja).
    if (existsSync(outAbs) && !FORCE && !srcIsNewer(srcAbs, outAbs)) { console.log(`${tag} ⏭  ya existe ${basename(outAbs)}`); continue; }

    process.stdout.write(`${tag} 🖼  ${file} → ${basename(outAbs)} ... `);
    try {
      const how = await processImage(srcAbs, outAbs, look, cacheKey);
      console.log(how);
    } catch (e) {
      console.log("falló → " + (e.message || "").split("\n")[0]);
      try { basicFallback(srcAbs, outAbs); console.log(`${tag}    ↳ ok (fallback)`); } catch {}
    }
  }
  // limpia de public/ las imágenes que ya no están en la carpeta de origen
  try {
    const keep = new Set(files.map((f) => f.replace(/\.[^.]+$/, ".png")));
    for (const f of readdirSync(outDir)) if (/\.(png|jpe?g)$/i.test(f) && !keep.has(f)) rmSync(join(outDir, f), { force: true });
  } catch {}
}
console.log(`\n✅ Listo. ${total} imagen(es) en public/projects/<id>/images/`);
