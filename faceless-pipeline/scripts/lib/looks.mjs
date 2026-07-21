/**
 * lib/looks.mjs — presets de color/grade para las imágenes.
 * ---------------------------------------------------------
 * Cada preset recibe un pipeline de sharp (ya reescalado) y le aplica su
 * "look". Lo usan enhance-images.mjs (al procesar todo) y el ui-server (para
 * la vista previa), así el preview y el resultado final son idénticos.
 *
 * Un preset = { id, label, desc, apply(sharp, pipe, w, h) -> pipe }
 */

// grano monocromo suave (film grain)
function grainBuffer(w, h, amp = 10) {
  const buf = Buffer.allocUnsafe(w * h);
  const base = 128 - amp;
  for (let i = 0; i < buf.length; i++) buf[i] = base + Math.floor(Math.random() * (amp * 2));
  return buf;
}
async function grain(sharp, w, h, amp) {
  const nw = Math.round(w / 2), nh = Math.round(h / 2);
  return sharp(grainBuffer(nw, nh, amp), { raw: { width: nw, height: nh, channels: 1 } }).resize(w, h).png().toBuffer();
}
// viñeta radial: esquinas a `corner` (hex claro = suave, oscuro = fuerte)
function vignette(w, h, { r = 85, start = 72, corner = "#e0e0e0" } = {}) {
  return Buffer.from(
    `<svg width="${w}" height="${h}"><defs><radialGradient id="v" cx="50%" cy="50%" r="${r}%">` +
      `<stop offset="${start}%" stop-color="#ffffff"/><stop offset="100%" stop-color="${corner}"/></radialGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#v)"/></svg>`
  );
}
// tinte de color a pantalla (teal-orange, cálido, frío…) en modo soft-light
function tint(w, h, color, opacity = 0.5) {
  return Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}" opacity="${opacity}"/></svg>`
  );
}

export const LOOKS = [
  {
    id: "none",
    label: "Sin filtro",
    desc: "Solo upscale + limpieza de metadatos. Colores tal cual.",
    async apply(sharp, pipe) { return pipe; },
  },
  {
    id: "filmic",
    label: "Filmic (equilibrado)",
    desc: "Cine suave: desatura leve, sube brillo, grano fino y viñeta muy suave.",
    async apply(sharp, pipe, w, h) {
      pipe = pipe.modulate({ saturation: 0.94, brightness: 1.09 }).linear(1.04, 4);
      return pipe.composite([
        { input: await grain(sharp, w, h, 10), blend: "overlay" },
        { input: vignette(w, h, { corner: "#e0e0e0" }), blend: "multiply" },
      ]);
    },
  },
  {
    id: "soft",
    label: "Suave",
    desc: "Delicado y luminoso: sombras levantadas, poco contraste, sin viñeta. Ideal para caras.",
    async apply(sharp, pipe, w, h) {
      pipe = pipe.modulate({ saturation: 0.97, brightness: 1.12 }).linear(0.94, 10);
      return pipe.composite([{ input: await grain(sharp, w, h, 5), blend: "overlay" }]);
    },
  },
  {
    id: "cinematic",
    label: "Cinemático (teal & orange)",
    desc: "Look de tráiler: sombras frías, más contraste, viñeta marcada y grano.",
    async apply(sharp, pipe, w, h) {
      pipe = pipe.modulate({ saturation: 1.05, brightness: 1.04 }).linear(1.12, -6);
      return pipe.composite([
        { input: tint(w, h, "#0a2a3a", 0.16), blend: "soft-light" }, // frío en sombras/medios
        { input: await grain(sharp, w, h, 12), blend: "overlay" },
        { input: vignette(w, h, { r: 80, start: 60, corner: "#b8b8b8" }), blend: "multiply" },
      ]);
    },
  },
  {
    id: "warm",
    label: "Cálido / dorado",
    desc: "Atardecer: temperatura cálida, dorado suave, viñeta media. Épico/nostálgico.",
    async apply(sharp, pipe, w, h) {
      pipe = pipe.modulate({ saturation: 1.06, brightness: 1.06 }).linear(1.05, 0);
      return pipe.composite([
        { input: tint(w, h, "#c8781e", 0.14), blend: "soft-light" },
        { input: await grain(sharp, w, h, 8), blend: "overlay" },
        { input: vignette(w, h, { corner: "#d2d2d2" }), blend: "multiply" },
      ]);
    },
  },
  {
    id: "bw",
    label: "Blanco y negro",
    desc: "Dramático monocromo: sin color, contraste medio, grano y viñeta.",
    async apply(sharp, pipe, w, h) {
      pipe = pipe.grayscale().linear(1.08, -4);
      return pipe.composite([
        { input: await grain(sharp, w, h, 12), blend: "overlay" },
        { input: vignette(w, h, { r: 82, start: 66, corner: "#c8c8c8" }), blend: "multiply" },
      ]);
    },
  },
];

export const LOOK_IDS = LOOKS.map((l) => l.id);
export const getLook = (id) => LOOKS.find((l) => l.id === id) || LOOKS.find((l) => l.id === "filmic");

/** Aplica un preset a un pipeline de sharp ya reescalado. */
export async function applyLook(sharp, pipe, lookId, w, h) {
  return getLook(lookId).apply(sharp, pipe, w, h);
}
