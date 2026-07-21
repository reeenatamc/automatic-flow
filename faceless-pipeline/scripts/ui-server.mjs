#!/usr/bin/env node
/**
 * ui-server.mjs — Interfaz web local para manejar el pipeline con botones.
 * Corre: npm run ui   (abre http://localhost:4599)
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream, readdirSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { audioDurationSeconds } from "./lib/audio.mjs";
import { LOOKS, applyLook } from "./lib/looks.mjs";
let sharp = null;
try { sharp = (await import("sharp")).default; } catch {}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = 4599;

// --- abrir cosas del sistema, multiplataforma (antes solo `open` de macOS) ---
// Abre una carpeta, un archivo o una URL con el programa por defecto del sistema.
function openInSystem(target) {
  if (process.platform === "win32") return spawn("cmd", ["/c", "start", "", target], { detached: true });
  if (process.platform === "darwin") return spawn("open", [target], { detached: true });
  return spawn("xdg-open", [target], { detached: true }); // linux
}
// Abre el explorador con el archivo YA SELECCIONADO (resaltado).
function revealInSystem(file) {
  if (process.platform === "win32") return spawn("explorer", [`/select,${file}`], { detached: true });
  if (process.platform === "darwin") return spawn("open", ["-R", file], { detached: true });
  return spawn("xdg-open", [dirname(file)], { detached: true }); // linux: no hay "select", abre la carpeta
}
const CONFIG = join(ROOT, "projects.config.json");
const HTML = join(__dirname, "ui.html");
const OUT = join(ROOT, "out");

// comandos permitidos (allowlist)
const COMMANDS = {
  check: "node scripts/check.mjs",
  timestamps: "node scripts/timestamps-md.mjs",
  enhance: "node scripts/enhance-images.mjs",
  "enhance-force": "node scripts/enhance-images.mjs --force",
  transcribe: "node scripts/transcribe-cloud.mjs",
  manifest: "node scripts/build-manifest.mjs",
  master: "node scripts/master-audio.mjs",
  captions: "node scripts/captions-from-script.mjs",
  prepare: "node scripts/enhance-images.mjs && node scripts/master-audio.mjs && node scripts/transcribe-cloud.mjs && node scripts/build-manifest.mjs",
  build: "node scripts/check.mjs && node scripts/enhance-images.mjs && node scripts/captions-from-script.mjs && node scripts/build-manifest.mjs",
  "render-full": "node scripts/render.mjs --full",
  "render-clips": "node scripts/render.mjs --clips",
  "render-hooks": "node scripts/render.mjs --hooks",
  "render-all": "node scripts/render.mjs",
};

let currentChild = null; // comando en curso (para poder detenerlo)

const json = (res, obj, code = 200) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

function getState() {
  let projects = [];
  try {
    const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
    projects = (cfg.projects || []).map((p) => ({
      id: p.id,
      title: p.title || p.id,
      blocks: (p.blocks || []).length,
      look: p.look || null,
      captions: !!p.captions,
    }));
  } catch {}
  let videos = [];
  try {
    videos = readdirSync(OUT)
      .filter((f) => f.endsWith(".mp4"))
      .map((f) => ({ name: f, size: (statSync(join(OUT, f)).size / 1048576).toFixed(1) + " MB" }));
  } catch {}
  return { projects, videos };
}

function serveVideo(req, res, filePath) {
  const stat = statSync(filePath);
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": "video/mp4",
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": stat.size, "Content-Type": "video/mp4", "Accept-Ranges": "bytes" });
    createReadStream(filePath).pipe(res);
  }
}

// Al renombrar imágenes, actualiza sus referencias en el config (block.images)
// para que las escenas ya acomodadas no se rompan. `map` = { viejo: nuevo }.
function updateImageRefs(project, map) {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
    const p = (cfg.projects || []).find((x) => x.id === project);
    if (!p) return;
    let changed = false;
    for (const b of p.blocks || []) {
      if (!Array.isArray(b.images)) continue;
      b.images = b.images.map((im) => {
        const file = typeof im === "string" ? im : im.file;
        if (map[file]) { changed = true; return typeof im === "string" ? map[file] : { ...im, file: map[file] }; }
        return im;
      });
    }
    if (changed) writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  } catch {}
}

// Quita del config las imágenes borradas (fileset = Set de nombres).
function removeImageRefs(project, fileset) {
  try {
    const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
    const p = (cfg.projects || []).find((x) => x.id === project);
    if (!p) return;
    let changed = false;
    for (const b of p.blocks || []) {
      if (!Array.isArray(b.images)) continue;
      const before = b.images.length;
      b.images = b.images.filter((im) => !fileset.has(typeof im === "string" ? im : im.file));
      if (b.images.length !== before) changed = true;
    }
    if (changed) writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  } catch {}
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === "/" || path === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(HTML));
    return;
  }

  if (path === "/api/state") return json(res, getState());

  if (path === "/api/config") {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          JSON.parse(body);
          writeFileSync(CONFIG, body);
          json(res, { ok: true });
        } catch (e) {
          json(res, { ok: false, error: e.message }, 400);
        }
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(readFileSync(CONFIG, "utf8"));
    return;
  }

  if (path === "/api/open") {
    const what = url.searchParams.get("what");
    const project = url.searchParams.get("project") || "";
    let target = OUT;
    if (what === "audio") target = resolve(ROOT, `../proyectos/${project}/audio`);
    else if (what === "imagenes") target = resolve(ROOT, `../proyectos/${project}/imagenes`);
    else if (what === "timestamps") target = join(ROOT, "data", "timestamps");
    openInSystem(target);
    return json(res, { ok: true });
  }

  if (path === "/api/studio") {
    // shell:true → en Windows resuelve npx.cmd; en unix usa /bin/sh. Sin esto, ENOENT en Windows.
    const child = spawn("npx remotion studio src/index.ts", { cwd: ROOT, detached: true, stdio: "ignore", shell: true });
    child.unref();
    return json(res, { ok: true, url: "http://localhost:3000" });
  }

  if (path === "/api/run") {
    const cmdKey = url.searchParams.get("cmd");
    const project = url.searchParams.get("project") || "";
    let cmd = COMMANDS[cmdKey];
    if (!cmd) {
      res.writeHead(400);
      res.end("comando no permitido");
      return;
    }
    if (project && (cmdKey.startsWith("render") || cmdKey === "timestamps")) cmd += ` --project=${project}`;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: $ ${cmd}\n\n`);
    // shell:true corre el string tal cual: cmd.exe en Windows (soporta &&), sh en unix.
    // Antes era spawn("sh", ...) que no existe en Windows.
    const child = spawn(cmd, { cwd: ROOT, shell: true });
    currentChild = child;
    const send = (buf) =>
      buf
        .toString()
        .split("\n")
        .forEach((l) => {
          const line = l.replace(/\r/g, "");
          if (line.trim()) res.write(`data: ${line}\n\n`);
        });
    child.stdout.on("data", send);
    child.stderr.on("data", send);
    child.on("close", (code) => {
      if (currentChild === child) currentChild = null;
      res.write(`event: done\ndata: ${code}\n\n`);
      res.end();
    });
    // no matamos el proceso si se cierra la pestaña: el render sigue en background
    return;
  }

  if (path === "/api/stop") {
    if (currentChild) {
      if (process.platform === "win32") {
        // mata el arbol completo (cmd + node + chrome del render)
        try { spawn("taskkill", ["/pid", String(currentChild.pid), "/T", "/F"]); } catch {}
      } else {
        try { process.kill(-currentChild.pid, "SIGTERM"); } catch { try { currentChild.kill("SIGTERM"); } catch {} }
      }
    }
    return json(res, { ok: true });
  }

  if (path === "/api/timestamps") {
    const project = url.searchParams.get("project") || "";
    const f = join(ROOT, "data", "timestamps", `${project}.md`);
    if (existsSync(f)) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(readFileSync(f));
    } else {
      res.writeHead(404);
      res.end("");
    }
    return;
  }

  if (path === "/api/reveal") {
    const file = join(OUT, url.searchParams.get("file") || "");
    if (file.startsWith(OUT) && existsSync(file)) revealInSystem(file);
    return json(res, { ok: true });
  }

  if (path === "/api/health") {
    let groq = false;
    try {
      groq = /^[\t ]*(GROQ|OPENAI)_API_KEY[\t ]*=[\t ]*.+/m.test(readFileSync(join(ROOT, ".env"), "utf8"));
    } catch {}
    let images = 0, cache = 0;
    try {
      const imgRoot = join(ROOT, "public", "projects");
      for (const p of readdirSync(imgRoot)) {
        try { images += readdirSync(join(imgRoot, p, "images")).filter((f) => /\.(png|jpe?g)$/i.test(f)).length; } catch {}
      }
    } catch {}
    try { cache = readdirSync(join(ROOT, "bin", "upscale-cache")).filter((f) => f.endsWith(".png")).length; } catch {}
    return json(res, { groq, images, cache });
  }

  if (path === "/api/timestamps-json") {
    const project = url.searchParams.get("project") || "";
    const f = join(ROOT, "data", "timestamps", `${project}.md`);
    if (!existsSync(f)) return json(res, { chapters: [] });
    const md = readFileSync(f, "utf8");
    const chapters = [];
    for (const sec of md.split(/^## Audio:/m).slice(1)) {
      const bm = sec.match(/`[^`/]*\/([^`]+)`/) || sec.match(/`([^`]+)`/);
      const block = bm ? bm[1] : "?";
      const scenes = [];
      const toSec = (t) => { const p = t.split(":"); return parseInt(p[0], 10) * 60 + parseFloat(p[1]); };
      const rowRe = /^\|\s*\d+\s*\|\s*([\d:.]+)\s*\|\s*([\d:.]+)\s*\|[^|]*\|\s*(.*?)\s*\|/gm;
      let m;
      while ((m = rowRe.exec(sec))) scenes.push({ start: toSec(m[1]), end: toSec(m[2]), text: m[3].replace(/\\\|/g, "|") });
      if (scenes.length) chapters.push({ block, scenes });
    }
    return json(res, { chapters });
  }

  if (path === "/api/images") {
    const project = url.searchParams.get("project") || "";
    let images = [];
    try { images = readdirSync(join(ROOT, "public", "projects", project, "images")).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort(); } catch {}
    return json(res, { images });
  }

  if (path.startsWith("/img/")) {
    const parts = decodeURIComponent(path.slice(5)).split("/");
    const base = join(ROOT, "public", "projects");
    const file = join(base, parts[0] || "", "images", parts[1] || "");
    if (file.startsWith(base) && existsSync(file)) {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=120" });
      createReadStream(file).pipe(res);
    } else { res.writeHead(404); res.end(); }
    return;
  }

  // imágenes de ORIGEN (proyectos/<id>/imagenes/): TODAS, incluidas las crudas
  // sin procesar (ej. "ChatGPT Image ....png"), con la tanda a la que pertenecen.
  if (path === "/api/source-images") {
    const project = (url.searchParams.get("project") || "").replace(/[^\w-]/g, "");
    const dir = resolve(ROOT, `../proyectos/${project}/imagenes`);
    let files = [];
    try { files = readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort(); } catch {}
    let blockIds = [];
    try { const cfg = JSON.parse(readFileSync(CONFIG, "utf8")); const p = (cfg.projects || []).find((x) => x.id === project); blockIds = (p?.blocks || []).filter((b) => b.audio).map((b) => b.id); } catch {}
    // qué imágenes ya están procesadas (existe su versión .png en public/)
    let processed = new Set();
    try { processed = new Set(readdirSync(join(ROOT, "public", "projects", project, "images"))); } catch {}
    const images = files.map((f) => {
      const m = f.match(/^([\w-]+)-\d+\.[^.]+$/);
      return { file: f, tanda: m && blockIds.includes(m[1]) ? m[1] : null, processed: processed.has(f.replace(/\.[^.]+$/, ".png")) };
    });
    return json(res, { images });
  }

  // servir una imagen de origen (para la galería de organización)
  if (path.startsWith("/srcimg/")) {
    const parts = decodeURIComponent(path.slice(8)).split("/");
    const proj = (parts[0] || "").replace(/[^\w-]/g, "");
    const base = resolve(ROOT, "../proyectos");
    const file = join(base, proj, "imagenes", basename(parts[1] || ""));
    if (file.startsWith(base) && existsSync(file)) {
      res.writeHead(200, { "Content-Type": /\.png$/i.test(file) ? "image/png" : "image/jpeg", "Cache-Control": "max-age=60" });
      createReadStream(file).pipe(res);
    } else { res.writeHead(404); res.end(); }
    return;
  }

  // asignar imágenes de origen a una tanda: las renombra <prefix>-NN en el orden dado
  if (path === "/api/assign-images") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, prefix, files } = JSON.parse(body);
        const pfx = (prefix || "").replace(/[^\w-]/g, "");
        const proj = (project || "").replace(/[^\w-]/g, "");
        if (!pfx || !proj || !Array.isArray(files) || !files.length) return json(res, { ok: false, error: "faltan tanda o imágenes" }, 400);
        const dir = resolve(ROOT, `../proyectos/${proj}/imagenes`);
        let max = 0;
        try { for (const f of readdirSync(dir)) { const m = f.match(new RegExp("^" + pfx + "-(\\d+)\\.", "i")); if (m) max = Math.max(max, parseInt(m[1], 10)); } } catch {}
        const names = [], refMap = {};
        files.forEach((raw) => {
          const rawName = basename(raw);
          const src = join(dir, rawName);
          if (!existsSync(src)) return;
          let ext = (raw.match(/\.(png|jpe?g)$/i) || [".png"])[0].toLowerCase();
          if (ext === ".jpeg") ext = ".jpg";
          max += 1;
          const nn = `${pfx}-${String(max).padStart(2, "0")}${ext}`;
          renameSync(src, join(dir, nn));
          names.push(nn);
          refMap[rawName] = nn;
        });
        updateImageRefs(proj, refMap);
        json(res, { ok: true, count: names.length, names });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // ELIMINAR imágenes: las mueve a imagenes/_papelera/ (NO borrado permanente,
  // por si te equivocas), borra su versión procesada y quita sus referencias.
  if (path === "/api/delete-images") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, files } = JSON.parse(body);
        const proj = (project || "").replace(/[^\w-]/g, "");
        if (!proj || !Array.isArray(files) || !files.length) return json(res, { ok: false, error: "faltan imágenes" }, 400);
        const srcDir = resolve(ROOT, `../proyectos/${proj}/imagenes`);
        const trashDir = join(srcDir, "_papelera");
        const pubDir = join(ROOT, "public", "projects", proj, "images");
        mkdirSync(trashDir, { recursive: true });
        let n = 0; const del = new Set();
        for (const raw of files) {
          const name = basename(raw);
          const src = join(srcDir, name);
          if (!existsSync(src)) continue;
          // a la papelera (con sufijo si ya existe una con ese nombre)
          let dest = join(trashDir, name);
          if (existsSync(dest)) dest = join(trashDir, name.replace(/(\.[^.]+)$/, `-${Date.now()}$1`));
          renameSync(src, dest);
          n++; del.add(name);
          // borra la versión procesada en public/ (regenerable)
          try { const pub = join(pubDir, name.replace(/\.[^.]+$/, ".png")); if (existsSync(pub)) rmSync(pub, { force: true }); } catch {}
          // borra el caché de upscale (si no, al re-subir con el mismo nombre traería la vieja)
          try { const cache = join(ROOT, "bin", "upscale-cache", `${proj}__${name.replace(/\.[^.]+$/, "")}.png`); if (existsSync(cache)) rmSync(cache, { force: true }); } catch {}
        }
        removeImageRefs(proj, del);
        json(res, { ok: true, count: n });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // QUITAR imágenes de su tanda (des-asignar): las renombra a un nombre neutro
  // "libre-NN" para que vuelvan a salir como "sin asignar" y puedas reasignarlas.
  if (path === "/api/unassign-images") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, files } = JSON.parse(body);
        const proj = (project || "").replace(/[^\w-]/g, "");
        if (!proj || !Array.isArray(files) || !files.length) return json(res, { ok: false, error: "faltan imágenes" }, 400);
        const dir = resolve(ROOT, `../proyectos/${proj}/imagenes`);
        let max = 0;
        try { for (const f of readdirSync(dir)) { const m = f.match(/^libre-(\d+)\./i); if (m) max = Math.max(max, parseInt(m[1], 10)); } } catch {}
        const names = [], refMap = {};
        files.forEach((raw) => {
          const rawName = basename(raw);
          const src = join(dir, rawName);
          if (!existsSync(src)) return;
          let ext = (rawName.match(/\.(png|jpe?g)$/i) || [".png"])[0].toLowerCase();
          if (ext === ".jpeg") ext = ".jpg";
          max += 1;
          const nn = `libre-${String(max).padStart(2, "0")}${ext}`;
          renameSync(src, join(dir, nn));
          names.push(nn);
          refMap[rawName] = nn;
        });
        updateImageRefs(proj, refMap);
        json(res, { ok: true, count: names.length, names });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  if (path === "/api/apply-scenes") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, block, images } = JSON.parse(body);
        const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
        const p = cfg.projects.find((x) => x.id === project);
        const b = p && p.blocks.find((x) => x.id === block);
        if (!b) return json(res, { ok: false, error: "bloque no encontrado" }, 404);
        b.images = images;
        writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
        json(res, { ok: true });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // detalle de un proyecto para el editor de hooks: bloques de media con la
  // línea de subtítulos (texto + tiempos) para elegir la ventana del gancho.
  if (path === "/api/project-detail") {
    const project = url.searchParams.get("project") || "";
    let cfg;
    try { cfg = JSON.parse(readFileSync(CONFIG, "utf8")); } catch { return json(res, { blocks: [], hooks: [] }); }
    const p = (cfg.projects || []).find((x) => x.id === project);
    if (!p) return json(res, { blocks: [], hooks: [] });
    const blocks = [];
    for (const b of p.blocks || []) {
      if (b.card !== undefined) continue; // los separadores no sirven de hook
      // subtítulos (fuente más fresca del contenido): data/captions/<proj>__<block>.json
      let cues = [], duration = 0;
      try {
        const capData = JSON.parse(readFileSync(join(ROOT, "data", "captions", `${project}__${b.id}.json`), "utf8"));
        cues = (capData.captions || []).map((c) => ({ start: (c.startMs ?? 0) / 1000, end: (c.endMs ?? 0) / 1000, text: c.text }));
        if (cues.length) duration = cues[cues.length - 1].end;
      } catch {}
      // duración de respaldo: último end de las imágenes del config
      if (!duration && Array.isArray(b.images) && b.images.length) {
        const last = b.images[b.images.length - 1];
        duration = typeof last === "object" ? (last.end ?? 0) : 0;
      }
      blocks.push({ id: b.id, duration: Math.round(duration * 10) / 10, cues });
    }
    return json(res, { blocks, hooks: p.hooks || [] });
  }

  // lista de presets de look disponibles
  if (path === "/api/looks") {
    return json(res, { looks: LOOKS.map((l) => ({ id: l.id, label: l.label, desc: l.desc })) });
  }

  // preview de un look sobre UNA imagen del proyecto: devuelve original + con-look
  // + un encuadre VERTICAL (para ver que la imagen encaja sin irse de largo).
  if (path === "/api/preview-look") {
    const project = url.searchParams.get("project") || "";
    const look = url.searchParams.get("look") || "filmic";
    if (!sharp) return json(res, { ok: false, error: "sharp no está instalado" }, 500);
    // toma la primera imagen del cache de upscale del proyecto (ya reescalada, sin grade)
    let cacheFile = null;
    try {
      const cacheDir = join(ROOT, "bin", "upscale-cache");
      const hit = readdirSync(cacheDir).filter((f) => f.startsWith(`${project}__`) && f.endsWith(".png")).sort()[0];
      if (hit) cacheFile = join(cacheDir, hit);
    } catch {}
    // respaldo: una imagen ya procesada en public/
    if (!cacheFile) {
      try {
        const imgDir = join(ROOT, "public", "projects", project, "images");
        const hit = readdirSync(imgDir).filter((f) => /\.png$/i.test(f)).sort()[0];
        if (hit) cacheFile = join(imgDir, hit);
      } catch {}
    }
    if (!cacheFile) return json(res, { ok: false, error: "no hay imágenes; corre 'Mejorar imágenes' primero" }, 404);
    try {
      const PREV_W = 900;
      const base = await sharp(cacheFile, { failOn: "none", limitInputPixels: false }).resize({ width: PREV_W }).toBuffer();
      const meta = await sharp(base).metadata();
      const original = await sharp(base).png().toBuffer();
      const graded = await (await applyLook(sharp, sharp(base), look, meta.width, meta.height)).png().toBuffer();
      // encuadre vertical 9:16: fondo difuminado + imagen centrada "contain" (como en el video)
      const VW = 405, VH = 720;
      const bg = await sharp(graded).resize({ width: VW, height: VH, fit: "cover" }).blur(28).modulate({ brightness: 0.6 }).toBuffer();
      const fg = await sharp(graded).resize({ width: VW, height: VH, fit: "inside" }).toBuffer();
      const fgMeta = await sharp(fg).metadata();
      const vertical = await sharp(bg)
        .composite([{ input: fg, left: Math.round((VW - fgMeta.width) / 2), top: Math.round((VH - fgMeta.height) / 2) }])
        .png().toBuffer();
      const b64 = (b) => "data:image/png;base64," + b.toString("base64");
      return json(res, { ok: true, look, original: b64(original), graded: b64(graded), vertical: b64(vertical) });
    } catch (e) { return json(res, { ok: false, error: e.message }, 500); }
  }

  // aplicar un look a TODO el proyecto: lo guarda en el config y reprocesa (--force)
  if (path === "/api/apply-look") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, look } = JSON.parse(body);
        const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
        const p = (cfg.projects || []).find((x) => x.id === project);
        if (!p) return json(res, { ok: false, error: "proyecto no encontrado" }, 404);
        p.look = look;
        writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
        json(res, { ok: true });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // guion completo (texto crudo) del proyecto: proyectos/<id>/guion.txt
  if (path === "/api/guion") {
    const project = url.searchParams.get("project") || "";
    const guionPath = resolve(ROOT, `../proyectos/${project}/guion.txt`);
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try { writeFileSync(guionPath, body); json(res, { ok: true }); }
        catch (e) { json(res, { ok: false, error: e.message }, 400); }
      });
      return;
    }
    let text = "";
    try { text = readFileSync(guionPath, "utf8"); } catch {}
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(text);
  }

  // listar los audios de origen de un proyecto (proyectos/<id>/audio/) con su
  // estado: ¿ya es una tanda?, ¿masterizado?, ¿transcrito?
  if (path === "/api/audios") {
    const project = url.searchParams.get("project") || "";
    const audioDir = resolve(ROOT, `../proyectos/${project}/audio`);
    let cfg = { projects: [] };
    try { cfg = JSON.parse(readFileSync(CONFIG, "utf8")); } catch {}
    const p = (cfg.projects || []).find((x) => x.id === project);
    const blocks = (p?.blocks || []).filter((b) => b.audio);
    let files = [];
    try { files = readdirSync(audioDir).filter((f) => /\.(mp3|wav|m4a|aac)$/i.test(f)).sort(); } catch {}
    const out = [];
    for (const f of files) {
      const block = blocks.find((b) => basename(b.audio) === f);
      let duration = 0;
      try { duration = Math.round(await audioDurationSeconds(join(audioDir, f))); } catch {}
      const bid = block?.id;
      out.push({
        file: f,
        duration,
        blockId: bid || null,
        mastered: bid ? existsSync(join(ROOT, "data", "mastered", `${project}__${bid}.mp3`)) : false,
        transcribed: bid ? existsSync(join(ROOT, "data", "captions", `${project}__${bid}.json`)) : false,
        images: bid ? (block.images || []).length : 0,
      });
    }
    return json(res, { audios: out });
  }

  // subir un archivo (audio o imagen) a las carpetas de fuentes del proyecto.
  // El cuerpo es el binario crudo; el nombre/tipo van por query.
  if (path === "/api/upload") {
    const project = (url.searchParams.get("project") || "").replace(/[^\w-]/g, "");
    const kind = url.searchParams.get("kind"); // "audio" | "image"
    const prefix = (url.searchParams.get("prefix") || "").replace(/[^\w-]/g, ""); // tanda → renombra en secuencia
    let name = basename(url.searchParams.get("name") || "");
    const okExt = kind === "audio" ? /\.(mp3|wav|m4a|aac)$/i : /\.(png|jpe?g)$/i;
    if (!project || !name || !okExt.test(name)) return json(res, { ok: false, error: "nombre o tipo no válido" }, 400);
    const destDir = resolve(ROOT, `../proyectos/${project}/${kind === "audio" ? "audio" : "imagenes"}`);
    mkdirSync(destDir, { recursive: true });
    // imágenes con tanda → nombre en secuencia <prefix>-NN (continúa la numeración existente)
    if (kind === "image" && prefix) {
      let ext = (name.match(/\.(png|jpe?g)$/i) || [".png"])[0].toLowerCase();
      if (ext === ".jpeg") ext = ".jpg";
      let max = 0;
      try { for (const f of readdirSync(destDir)) { const m = f.match(new RegExp("^" + prefix + "-(\\d+)\\.", "i")); if (m) max = Math.max(max, parseInt(m[1], 10)); } } catch {}
      name = prefix + "-" + String(max + 1).padStart(2, "0") + ext;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { writeFileSync(join(destDir, name), Buffer.concat(chunks)); json(res, { ok: true, name }); }
      catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // renombrar en secuencia las imágenes de una tanda: <prefix>-01..NN (arregla huecos/orden)
  if (path === "/api/rename-sequence") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, prefix } = JSON.parse(body);
        const pfx = (prefix || "").replace(/[^\w-]/g, "");
        const proj = (project || "").replace(/[^\w-]/g, "");
        if (!pfx || !proj) return json(res, { ok: false, error: "falta proyecto o tanda" }, 400);
        const dir = resolve(ROOT, `../proyectos/${proj}/imagenes`);
        const files = readdirSync(dir).filter((f) => new RegExp("^" + pfx + "-", "i").test(f) && /\.(png|jpe?g)$/i.test(f)).sort();
        if (!files.length) return json(res, { ok: false, error: `no hay imágenes '${pfx}-*'` }, 404);
        // dos fases (temp → final) para no pisar archivos
        const tmp = files.map((f, i) => ({ from: f, tmp: `__seq${i}__${f}` }));
        for (const t of tmp) renameSync(join(dir, t.from), join(dir, t.tmp));
        const names = [], refMap = {};
        tmp.forEach((t, i) => {
          let ext = (t.from.match(/\.(png|jpe?g)$/i) || [".png"])[0].toLowerCase();
          if (ext === ".jpeg") ext = ".jpg";
          const nn = `${pfx}-${String(i + 1).padStart(2, "0")}${ext}`;
          renameSync(join(dir, t.tmp), join(dir, nn));
          names.push(nn);
          refMap[t.from] = nn;
        });
        updateImageRefs(proj, refMap);
        json(res, { ok: true, count: names.length, names });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // crear un proyecto nuevo: lo agrega al config y crea sus carpetas de fuentes
  if (path === "/api/create-project") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { id, title, fps, look, captions } = JSON.parse(body);
        const pid = (id || "").trim().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
        if (!pid) return json(res, { ok: false, error: "ponle un id (sin espacios)" }, 400);
        const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
        if ((cfg.projects || []).some((p) => p.id === pid)) return json(res, { ok: false, error: "ya existe un proyecto con ese id" }, 400);
        // carpetas de fuentes + LEEME
        const audioDir = resolve(ROOT, `../proyectos/${pid}/audio`);
        const imgDir = resolve(ROOT, `../proyectos/${pid}/imagenes`);
        mkdirSync(audioDir, { recursive: true });
        mkdirSync(imgDir, { recursive: true });
        try { writeFileSync(join(audioDir, "LEEME.txt"), "Deja aquí los audios de narración (cap1.mp3, cap2.mp3…).\n"); } catch {}
        try { writeFileSync(join(imgDir, "LEEME.txt"), "Deja aquí las imágenes por escena (cap1-01.png…).\n"); } catch {}
        (cfg.projects ??= []).push({
          id: pid,
          title: (title || pid).trim(),
          fps: Number(fps) || 30,
          captions: captions !== false,
          look: look || "filmic",
          masterAudio: true,
          music: null,
          sourceImagesDir: `../proyectos/${pid}/imagenes`,
          blocks: [],
          hooks: [],
        });
        writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
        json(res, { ok: true, id: pid });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // crear una tanda (bloque de media) a partir de un audio suelto
  if (path === "/api/create-block") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, file, id } = JSON.parse(body);
        const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
        const p = (cfg.projects || []).find((x) => x.id === project);
        if (!p) return json(res, { ok: false, error: "proyecto no encontrado" }, 404);
        const blockId = (id || basename(file, extname(file))).trim().replace(/\s+/g, "-");
        if ((p.blocks || []).some((b) => b.id === blockId)) return json(res, { ok: false, error: "ya existe una tanda con ese id" }, 400);
        (p.blocks ??= []).push({ id: blockId, audio: `../proyectos/${project}/audio/${file}`, images: [] });
        writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
        json(res, { ok: true, blockId });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // listar TODOS los bloques (tandas + cards) en orden, para manejarlos
  if (path === "/api/blocks") {
    const project = url.searchParams.get("project") || "";
    let cfg; try { cfg = JSON.parse(readFileSync(CONFIG, "utf8")); } catch { return json(res, { blocks: [] }); }
    const p = (cfg.projects || []).find((x) => x.id === project);
    if (!p) return json(res, { blocks: [] });
    const blocks = (p.blocks || []).map((b) =>
      b.card !== undefined
        ? { id: b.id, kind: "card", card: b.card, subtitle: b.subtitle || "", seconds: b.seconds ?? 2 }
        : { id: b.id, kind: "media", audio: basename(b.audio || ""), images: (b.images || []).length }
    );
    return json(res, { blocks });
  }

  // operar sobre los bloques: borrar, mover, o agregar un separador (card)
  if (path === "/api/block-op") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, op, id, card, subtitle, seconds } = JSON.parse(body);
        const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
        const p = (cfg.projects || []).find((x) => x.id === project);
        if (!p) return json(res, { ok: false, error: "proyecto no encontrado" }, 404);
        const blocks = p.blocks || (p.blocks = []);
        const idx = blocks.findIndex((b) => b.id === id);
        if (op === "delete") {
          if (idx < 0) return json(res, { ok: false, error: "bloque no encontrado" }, 404);
          blocks.splice(idx, 1);
          // limpia hooks que apuntaban a ese bloque (ventana o bloques enteros)
          p.hooks = (p.hooks || []).filter((h) => h.block !== id && !(h.blocks || []).includes(id));
        } else if (op === "up" || op === "down") {
          const j = op === "up" ? idx - 1 : idx + 1;
          if (idx < 0 || j < 0 || j >= blocks.length) return json(res, { ok: false, error: "no se puede mover" }, 400);
          [blocks[idx], blocks[j]] = [blocks[j], blocks[idx]];
        } else if (op === "add-card") {
          const cid = (id || card || "card").toString().trim().replace(/\s+/g, "-").replace(/[^\w-]/g, "") || `card${blocks.length}`;
          if (blocks.some((b) => b.id === cid)) return json(res, { ok: false, error: "ya existe un bloque con ese id" }, 400);
          const cb = { id: cid, card: (card || "TÍTULO").toString(), seconds: Number(seconds) || 2 };
          if (subtitle) cb.subtitle = String(subtitle);
          blocks.push(cb);
        } else return json(res, { ok: false, error: "operación desconocida" }, 400);
        writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
        json(res, { ok: true });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // guardar los hooks de un proyecto en el config
  if (path === "/api/save-hooks") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { project, hooks } = JSON.parse(body);
        const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
        const p = (cfg.projects || []).find((x) => x.id === project);
        if (!p) return json(res, { ok: false, error: "proyecto no encontrado" }, 404);
        p.hooks = hooks;
        writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
        json(res, { ok: true });
      } catch (e) { json(res, { ok: false, error: e.message }, 400); }
    });
    return;
  }

  // servir los docs markdown (para el botón "Estrategia")
  if (/^\/(HOOKS|FORMATO|README)\.md$/.test(path)) {
    const file = join(ROOT, path.slice(1));
    if (existsSync(file)) {
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      return res.end(readFileSync(file));
    }
  }

  if (path.startsWith("/out/")) {
    const file = join(OUT, decodeURIComponent(path.slice(5)));
    if (file.startsWith(OUT) && existsSync(file)) return serveVideo(req, res, file);
    res.writeHead(404);
    res.end("not found");
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  const u = `http://localhost:${PORT}`;
  console.log(`\n🎬 Faceless Pipeline UI → ${u}\n   (Ctrl+C para cerrar)\n`);
  openInSystem(u);
});
