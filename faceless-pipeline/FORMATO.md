# 📖 FORMATO — Cómo funciona y cómo se corre

Guía completa del pipeline faceless: qué hace, cómo pasar una **tanda**, cómo
correrlo y cómo saca los **clips** y los **hooks**. Sin CapCut. En Windows, macOS o Linux.

> ¿Prefieres botones? Corre `npm run ui` y maneja todo desde el navegador.
> Esta guía es la referencia de fondo (config, comandos, cómo funciona por dentro).

---

## 1. Qué hace, en una frase

Tú das **grupos de imágenes + un audio de narración** (una "tanda") y el sistema:
mejora las imágenes con IA → las monta con zoom/paneo y transiciones → las
sincroniza a la narración → y te **bota** el video completo y los clips (horizontal
+ Shorts verticales), incluidos **hooks** con las mejores partes.

---

## 2. El flujo completo

```
   TÚ PONES                    EL SISTEMA HACE                        SALE
┌──────────────┐   enhance    ┌───────────────┐   render    ┌────────────────────┐
│ imágenes IA  │ ───────────► │ upscale 4x IA │ ──────────► │ video completo H+V │
│ + narración  │              │ Ken Burns     │             │ clip por tanda (V) │
│ (una tanda)  │   manifest   │ crossfades    │             │ hooks (V)          │
└──────────────┘ ───────────► │ sincronizado  │             └────────────────────┘
     config                   └───────────────┘                    out/*.mp4
```

Cuatro comandos:

| Paso | Comando | Qué hace |
|------|---------|----------|
| 1 | `npm run check` | Valida tu config (archivos, tiempos, hooks) — atrapa errores antes de gastar tiempo |
| 2 | `npm run build` | Mejora las imágenes (IA) + subtítulos **y** calcula los tiempos (manifest) |
| 3 | `npm run studio` | *(opcional)* Previsualiza y ajusta en el navegador |
| 4 | `npm run render` | Saca **todo**: video completo + clips + hooks |

`build` corre `check` solo al inicio, así que un config roto no llega al render.

---

## 3. Estructura de carpetas

```
automatic-flow/
├── proyectos/                     ← TUS FUENTES (lo que tú pones)
│   └── moises/
│       ├── audio/                 ← tus narraciones: cap1.mp3, cap2.mp3…
│       ├── imagenes/              ← tus imágenes IA: cap1-01.png, cap1-02.png…
│       ├── guion.txt              ← (opcional) el texto de la narración
│       └── produccion.md          ← (opcional) tu plan de edición humano
└── faceless-pipeline/             ← EL PROYECTO (código)
    ├── projects.config.json       ← 👈 AQUÍ describes tus videos/tandas
    ├── scripts/                   ← automatizaciones (check, enhance, manifest, render)
    ├── src/                       ← el "edit" en Remotion (Ken Burns, crossfades…)
    ├── out/                       ← 🎬 los MP4 finales (GENERADO)
    ├── public/projects/<id>/      ← imágenes mejoradas + audio (GENERADO)
    ├── data/                      ← subtítulos, timestamps, audio masterizado (GENERADO)
    └── bin/                       ← binarios: Real-ESRGAN, etc. (DESCARGADO)
```

> **Convención de nombres:** las carpetas que **tú tocas** están en español
> (`proyectos`, `imagenes`, `audio`, `guion`); lo que **genera el sistema** o es
> código está en inglés (`public`, `images`, `data`, `out`, `src`) porque es el
> estándar de Node/Remotion. Regla simple: **español = tuyo, inglés = generado.**
>
> **Nunca edites** `out/`, `public/`, `data/` ni `bin/`: se regeneran solos y por
> eso están fuera de git (ver `.gitignore`). Lo único irremplazable son tus
> fuentes en `proyectos/`.

---

## 4. Cómo pasar una TANDA (lo que más vas a hacer)

Una **tanda** = un grupo de imágenes + **un** audio de narración. En el config es
un **`block`**. Para agregarla:

1. Deja el `.mp3` en `../proyectos/<id>/audio/` y las imágenes en `../proyectos/<id>/imagenes/`.
2. Agrega un `block` al proyecto en `projects.config.json`:

```jsonc
{
  "id": "cap3",                                    // id único de la tanda
  "audio": "../proyectos/moises/audio/cap3.mp3",   // el audio de esta tanda
  "images": [                                       // las imágenes, EN ORDEN, con su tiempo
    { "file": "cap3-01.png", "start": 0.0,  "end": 5.2 },
    { "file": "cap3-02.png", "start": 5.2,  "end": 9.8 },
    { "file": "cap3-03.png", "start": 9.8,  "end": 14.0 }
  ]
}
```

3. Corre `npm run check && npm run build && npm run render`.

> 💡 También puedes solo decirme *"aquí va la siguiente tanda"* y yo agrego el
> bloque, escalo las imágenes y renderizo.

Cada tanda **saca su propio clip vertical automáticamente** (`moises-clip-cap3-short.mp4`),
y todas las tandas juntas forman el **video completo**.

---

## 5. Sincronización imagen → tiempo

Hay dos formas de decirle a cada imagen cuándo aparece. Puedes elegir por bloque.

### A) Cronometrado (recomendado, preciso) — `start` / `end`

Cada imagen trae su segundo exacto. **La imagen se posiciona en su `start` absoluto**,
así un ajuste en una imagen NO desincroniza las demás.

```jsonc
{ "file": "cap1-01.png", "start": 0.0, "end": 6.0 }
```

- `start` / `end` en segundos (copiados de los timestamps).
- Las imágenes van **en orden** y deberían **cubrir todo el audio del capítulo**.
- Si la última imagen no llega al final del audio, se estira para cuadrar (y `check` te avisa).

### B) Reparto parejo (cero trabajo, menos preciso)

Sin tiempos: pon las imágenes como texto y el audio se reparte por igual.

```jsonc
"images": ["cap1-01.png", "cap1-02.png", { "file": "cap1-03.png", "duration": 5 }]
```

- Texto `"img.png"` → automática (se reparte parejo).
- `{ "file": "img.png", "duration": 5 }` → 5s fijos; el resto se reparte entre las automáticas.

> ⚠️ Dentro de un mismo bloque usa **una** forma: `start`/`end` en TODAS las imágenes,
> o ninguna. `check` te avisa si las mezclas.

### ¿De dónde saco los tiempos? (el "diccionario" escena → tiempo)

`npm run timestamps` mide tu audio y te da los tiempos por escena en
`data/timestamps/moises.md`. Con esos tiempos generas/ordenas tus imágenes.

Si quieres que una IA te agrupe las escenas en tus imágenes, pégale esto:

> Tienes los timestamps de una narración (escena · inicio · fin · texto):
> ```
> [PEGA el contenido de data/timestamps/moises.md]
> ```
> Y estas imágenes por capítulo, EN ORDEN: cap1-01.png … cap1-08.png.
> Agrupa las escenas consecutivas en las imágenes disponibles y devuélveme SOLO un
> JSON `[{"file":"cap1-01.png","start":0.0,"end":8.6}, ...]` que cubra todo el audio
> del capítulo SIN huecos ni solapes.

Ese JSON son las `images` del bloque. También puedes decirme *"reparte parejo"* y yo
distribuyo por igual (forma B).

---

## 6. El config a fondo (`projects.config.json`)

```jsonc
{
  "projects": [
    {
      "id": "moises",                 // nombre corto sin espacios (define los archivos de salida)
      "title": "Moisés",
      "fps": 30,                       // 30 recomendado (24/60 también sirven)
      "captions": true,                // subtítulos en los VERTICALES (los horizontales van limpios)
      "look": "filmic",                // grade cinematográfico (color + grano + viñeta suave)
      "masterAudio": true,             // normaliza la voz si hay data/mastered/<id>__<block>.mp3
      "music": null,                   // música de fondo (ver §11)
      "sourceImagesDir": "../proyectos/moises/imagenes",
      "blocks": [ /* tus tandas — ver §4 y §5 */ ],
      "hooks":  [ /* clips de gancho — ver HOOKS.md */ ]
    }
  ]
}
```

- `captionMaxChars`: (opcional) largo máximo de línea de subtítulo (por defecto 28).

---

## 7. Clips de gancho (hooks)

Un **hook** es un clip corto vertical con el mejor momento, para enganchar y mandar
tráfico al video largo. Se definen en `hooks` y pueden ser una **ventana de tiempo**
dentro de un bloque:

```jsonc
"hooks": [
  { "id": "apertura", "label": "Cold-open", "block": "cap1", "start": 0.0, "end": 13.5 }
]
```

Recorta audio + imágenes + subtítulos a esa ventana y los re-sincroniza solo.
La **estrategia** (qué momentos elegir para retención/monetización) y todo el detalle
están en **[`HOOKS.md`](./HOOKS.md)**.

---

## 8. Separadores / tarjetas de capítulo

Un **cuadro negro con texto** es un bloque tipo **`card`**. Úsalo de intro o entre tandas:

```jsonc
"blocks": [
  { "id": "titulo", "card": "MOISÉS", "subtitle": "una historia", "seconds": 2 },
  { "id": "cap1",   "audio": "...", "images": [ "..." ] },
  { "id": "sep2",   "card": "YEARS EARLIER", "seconds": 1.5, "sfx": "sparkle" }
]
```

- `card` = texto grande · `subtitle` = línea secundaria (opcional) · `seconds` = duración.
- `sfx` (opcional) = un efecto de sonido de `assets/sfx/` al entrar.
- Hace fade-in/out solo, no lleva audio ni subtítulos. Estilo: `src/components/TitleCard.tsx`.

---

## 9. Todos los comandos

```bash
# --- validar y preparar ---
npm run check        # valida el config (no cambia nada)
npm run build        # check + enhance (imágenes IA) + captions + manifest (tiempos)
npm run enhance      # solo mejorar imágenes   ( -- --force  para rehacer)
npm run manifest     # solo recalcular tiempos
npm run timestamps   # tiempos por escena de tu audio → data/timestamps/<id>.md
npm run transcribe:cloud   # subtítulos del audio con Whisper en la nube (Groq, gratis)

# --- previsualizar ---
npm run ui           # interfaz web con botones (localhost:4599)
npm run studio       # Remotion Studio (previsualiza cada composición)

# --- renderizar ---
npm run render         # TODO: completo + clips + hooks
npm run render:full    # solo el video completo (H + V)
npm run render:clips   # solo un clip por cada tanda (V)
npm run render:hooks   # solo los hooks (V)
npm run render:list    # lista qué renderizaría, sin renderizar (dry run)
```

Filtros extra (directo al script):

```bash
node scripts/render.mjs --project=moises   # limita a un proyecto
node scripts/render.mjs --clips --both     # clips también en horizontal
```

---

## 10. Subtítulos

Los subtítulos salen **solo en los verticales/Shorts** (los horizontales van limpios).
Hay dos formas de generarlos:

| Método | Comando | De dónde | Necesita |
|--------|---------|----------|----------|
| **Whisper nube** (recomendado) | `npm run transcribe:cloud` | del audio, palabra x palabra (karaoke) | key gratis de Groq |
| **Desde el guion** | `npm run captions` | de tu texto `.txt` | `scriptFile` o `script` en el bloque |

**Whisper en la nube (Groq, gratis):**
1. Saca una key en https://console.groq.com/keys
2. Copia `.env.example` a `.env` y pega `GROQ_API_KEY=gsk_...`
3. Con `"captions": true`, corre `npm run transcribe:cloud && npm run manifest` y re-renderiza.

Estilo (tamaño, color, contorno, posición): `src/components/Captions.tsx`.

---

## 11. Música de fondo

Remotion no trae música: tú pones el archivo y él lo mezcla (loop, por debajo de la
voz, con fade-in/out).

1. Baja un track y déjalo en `assets/music/`.
2. En el proyecto: `"music": "assets/music/mi-track.mp3"`, `"musicVolume": 0.14` (0..1).
3. `npm run manifest && npm run render`.

Fuentes gratis (licencia comercial): Pixabay, Mixkit, Freesound (CC0). Ver `assets/README.md`.

---

## 12. Cómo funciona por dentro

- **Upscale** (`scripts/enhance-images.mjs`): escala cada imagen 4× con **Real-ESRGAN**
  (IA), la normaliza a 3840px, borra metadatos de origen y aplica el look `filmic`
  (grade + grano + viñeta suave). Idempotente (`--force` para rehacer). El binario se
  descarga según tu SO. Salen a `public/projects/<id>/images/`.
- **Tiempos** (`scripts/build-manifest.mjs`): mide cada narración (con
  `@remotion/media-parser`, JS puro) y posiciona cada imagen en su `start` absoluto.
  Escribe `src/manifest.json`.
- **El "edit"** (`src/`): cada imagen lleva **Ken Burns** (zoom + paneo alternado) y
  **crossfade** de 0.5s. El vertical usa fondo difuminado + imagen centrada.
- **Segmentos** (`src/lib/segment.ts`): el video completo, un clip o un hook son el
  mismo componente con distinto subconjunto de bloques, re-basado a empezar en 0.

### Ajustes rápidos

| Quiero… | Dónde |
|---------|-------|
| Más/menos zoom o paneo | `src/components/KenBurns.tsx` → `ZOOM`, `PAN`, `OVERSCAN` |
| Crossfade más largo/corto | `src/Video.tsx` → `cross` (0.5s por defecto) |
| Filtro más claro/oscuro | `scripts/enhance-images.mjs` → sección `filmic` |
| Otra resolución de upscale | `scripts/enhance-images.mjs` → `MAX_WIDTH` |

---

## 13. Problemas comunes

| Síntoma | Solución |
|---------|----------|
| Cambié de máquina y no arranca | `rm -rf node_modules && npm install` (binarios por SO) |
| `check` marca huecos o solapes | Revisa los `start`/`end` del bloque que menciona |
| No aparece una composición nueva | Corre `npm run manifest` (regenera la lista) |
| Cambié el orden de imágenes | `npm run enhance -- --force` (re-mapea posiciones) |
| El render se ve lento | Normal en equipos sin GPU potente (~1-2 min por video de 20s) |

---

## 14. Requisitos

- **Node 18+** y **npm**.
- **Windows, macOS o Linux.** No hace falta `ffmpeg` (Remotion trae el suyo) ni
  ninguna herramienta del sistema: la duración de los audios se lee con
  `@remotion/media-parser` (JavaScript puro).
- Primera vez: se descarga Real-ESRGAN (~30 MB) y un Chrome headless (~150 MB).

> ⚠️ **Al cambiar de máquina (ej. Mac → Windows), reinstala las dependencias:**
> ```bash
> rm -rf node_modules && npm install
> ```
> `sharp`, `esbuild` y el compositor de Remotion traen binarios distintos por
> sistema operativo. Un `node_modules` copiado de otra máquina no funciona.
