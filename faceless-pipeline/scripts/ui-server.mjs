#!/usr/bin/env node
/**
 * ui-server.mjs — Interfaz web local para manejar el pipeline con botones.
 * Corre: npm run ui   (abre http://localhost:4599)
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { audioDurationSeconds } from "./lib/audio.mjs";

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
