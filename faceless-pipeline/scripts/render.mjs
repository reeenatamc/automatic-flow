#!/usr/bin/env node
/**
 * render.mjs — "el que une todo y saca los clips"
 * ------------------------------------------------
 * Un solo comando para renderizar, a partir del manifest:
 *   - el VIDEO COMPLETO (une todas las tandas)      -> horizontal + vertical
 *   - un CLIP por cada tanda (bloque)               -> vertical (Short)
 *   - los CLIPS DE GANCHO (mejores partes)          -> vertical (Short)
 *
 * Uso:
 *   node scripts/render.mjs                 # todo (full + clips + ganchos)
 *   node scripts/render.mjs --full          # solo el video completo
 *   node scripts/render.mjs --clips         # solo los clips por tanda
 *   node scripts/render.mjs --hooks         # solo los clips de gancho
 *   node scripts/render.mjs --project=moises # limita a un proyecto
 *   node scripts/render.mjs --both          # clips/ganchos tambien en horizontal
 *   node scripts/render.mjs --h | --v       # fuerza solo horizontal / vertical
 *   node scripts/render.mjs --list          # solo lista lo que haria (dry run)
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MANIFEST = join(ROOT, "src", "manifest.json");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const projectFilter = (args.find((a) => a.startsWith("--project=")) || "").split("=")[1] || null;
const onlyH = has("--h");
const onlyV = has("--v");
const both = has("--both");
const dryRun = has("--list");

let want = { full: has("--full"), clips: has("--clips"), hooks: has("--hooks") };
if (has("--all") || (!want.full && !want.clips && !want.hooks)) want = { full: true, clips: true, hooks: true };

const fmtName = { h: "1080p", v: "short" };
function formatsFor(kind) {
  if (onlyH) return ["h"];
  if (onlyV) return ["v"];
  if (kind === "full") return ["h", "v"]; // el video completo, ambos formatos
  return both ? ["h", "v"] : ["v"]; // clips y ganchos: vertical (Short) por defecto
}

if (!existsSync(MANIFEST)) {
  console.error("No existe src/manifest.json. Corre primero: npm run build");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const jobs = [];
for (const project of Object.values(manifest.projects)) {
  if (projectFilter && project.id !== projectFilter) continue;
  if (want.full)
    for (const f of formatsFor("full")) jobs.push({ compId: `${project.id}-full-${f}`, out: `out/${project.id}-full-${fmtName[f]}.mp4` });
  if (want.clips)
    for (const b of project.blocks) {
      if (b.kind === "card") continue; // los separadores no son un clip
      for (const f of formatsFor("clip")) jobs.push({ compId: `${project.id}-clip-${b.id}-${f}`, out: `out/${project.id}-clip-${b.id}-${fmtName[f]}.mp4` });
    }
  if (want.hooks)
    for (const h of project.hooks ?? [])
      for (const f of formatsFor("hook")) jobs.push({ compId: `${project.id}-hook-${h.id}-${f}`, out: `out/${project.id}-hook-${h.id}-${fmtName[f]}.mp4` });
}

if (jobs.length === 0) {
  console.log("No hay nada que renderizar con esos filtros.");
  process.exit(0);
}

console.log(`🎬 ${jobs.length} render(s):`);
for (const j of jobs) console.log(`   • ${j.compId}  →  ${j.out}`);
if (dryRun) process.exit(0);

// Llamamos al CLI de Remotion con node directamente, en vez de por `npx`.
// En Windows `npx` es `npx.cmd` y execFileSync no lo resuelve (ENOENT); asi
// funciona igual en Windows, macOS y Linux, y ademas arranca mas rapido.
// El bin sale del package.json de @remotion/cli (su ruta no esta en "exports",
// pero package.json si), para no clavar el nombre del archivo.
const REMOTION_CLI = (() => {
  const req = createRequire(import.meta.url);
  const pkgPath = req.resolve("@remotion/cli/package.json");
  const bin = JSON.parse(readFileSync(pkgPath, "utf8")).bin.remotion;
  return join(dirname(pkgPath), bin);
})();

for (const [i, j] of jobs.entries()) {
  console.log(`\n──────── [${i + 1}/${jobs.length}] ${j.compId} ────────`);
  execFileSync(process.execPath, [REMOTION_CLI, "render", "src/index.ts", j.compId, j.out], {
    stdio: "inherit",
    cwd: ROOT,
  });
}
console.log(`\n✅ Listo. ${jobs.length} video(s) en out/`);
