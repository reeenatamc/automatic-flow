/**
 * lib/audio.mjs
 * --------------
 * Duracion de un archivo de audio, multiplataforma.
 *
 * Estrategia (en orden):
 *   1) @remotion/media-parser — JS puro, sin binarios. Funciona en
 *      Windows/macOS/Linux y ya viene con Remotion. Es el camino normal.
 *   2) ffprobe — si esta en el PATH.
 *   3) afinfo — solo macOS, ultimo recurso.
 *
 * Antes esto estaba duplicado en build-manifest.mjs y captions-from-script.mjs,
 * cada uno llamando a `afinfo` (solo macOS) con distinto nivel de fallback.
 */
import { execFileSync } from "node:child_process";

export async function audioDurationSeconds(file) {
  // 1) media-parser (JS puro, multiplataforma)
  try {
    const { parseMedia } = await import("@remotion/media-parser");
    const { nodeReader } = await import("@remotion/media-parser/node");
    const { durationInSeconds } = await parseMedia({
      src: file,
      fields: { durationInSeconds: true },
      reader: nodeReader,
      acknowledgeRemotionLicense: true,
    });
    if (typeof durationInSeconds === "number" && durationInSeconds > 0) {
      return durationInSeconds;
    }
  } catch {}

  // 2) ffprobe, si el usuario lo tiene instalado
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { encoding: "utf8" }
    );
    const d = parseFloat(out.trim());
    if (!Number.isNaN(d) && d > 0) return d;
  } catch {}

  // 3) afinfo (solo macOS)
  if (process.platform === "darwin") {
    try {
      const out = execFileSync("afinfo", [file], { encoding: "utf8" });
      const m = out.match(/estimated duration:\s*([\d.]+)\s*sec/i);
      if (m) return parseFloat(m[1]);
    } catch {}
  }

  throw new Error(
    `No pude leer la duracion del audio: ${file}\n` +
      `  Revisa que el archivo exista y sea un audio valido (mp3/wav/m4a).`
  );
}

/** Igual que audioDurationSeconds pero en milisegundos. */
export async function audioDurationMs(file) {
  return (await audioDurationSeconds(file)) * 1000;
}
