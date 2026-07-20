# 📖 FORMATO — Cómo funciona y cómo se corre

Guía completa del pipeline faceless: qué hace, cómo pasar una **tanda**, cómo
correrlo y cómo saca los **clips** y **clips de gancho**. Sin CapCut.

---

## 1. Qué hace, en una frase

Tú das **grupos de imágenes + un audio de narración** (una "tanda") y el sistema:
mejora las imágenes con IA → las monta con zoom/paneo y transiciones → las
sincroniza a la narración → y te **bota** el video completo y los clips (horizontal
+ Shorts verticales), incluidos **clips de gancho** con las mejores partes.

---

## 2. El flujo completo

```
   TÚ PONES                    EL SISTEMA HACE                        SALE
┌──────────────┐   enhance    ┌───────────────┐   render    ┌────────────────────┐
│ imágenes IA  │ ───────────► │ upscale 4x IA │ ──────────► │ video completo H+V │
│ + narración  │              │ Ken Burns     │             │ clip por tanda (V) │
│ (una tanda)  │   manifest   │ crossfades    │             │ clips de gancho (V)│
└──────────────┘ ───────────► │ sincronizado  │             └────────────────────┘
     config                   └───────────────┘                    out/*.mp4
```

Tres comandos:

| Paso | Comando | Qué hace |
|------|---------|----------|
| 1 | `npm run build` | Mejora las imágenes (IA) **y** calcula los tiempos (manifest) |
| 2 | `npm run studio` | *(opcional)* Previsualiza y ajusta en el navegador |
| 3 | `npm run render` | Saca **todo**: video completo + clips + clips de gancho |

---

## 3. Estructura de carpetas

```
FACELESS CHANNEL/
├── faceless danny/            ← TUS ORIGINALES (imágenes de ChatGPT + narración)
│   ├── ChatGPT Image ... (3..8).png
│   └── ElevenLabs_....mp3
└── faceless-pipeline/         ← EL PROYECTO
    ├── projects.config.json   ← 👈 AQUÍ describes tus videos/tandas
    ├── scripts/               ← automatizaciones (enhance, manifest, render)
    ├── src/                   ← el "edit" en Remotion (Ken Burns, crossfades…)
    ├── public/projects/<id>/  ← imágenes mejoradas + audio (lo que usa el video)
    ├── out/                   ← 🎬 los MP4 finales salen aquí
    └── bin/                   ← binarios (Real-ESRGAN, etc.)
```

---

## 4. Cómo pasar una TANDA (lo que más vas a hacer)

Una **tanda** = un grupo de imágenes + **un** audio de narración. En el config es
un **`block`**. Para agregarla:

1. Deja las imágenes + el `.mp3` en una carpeta (ej. `../faceless danny`).
2. Agrega un `block` al proyecto en `projects.config.json`:

```jsonc
{
  "id": "block2",                                  // id único de la tanda
  "audio": "../faceless danny/narracion2.mp3",     // el audio de esta tanda
  "images": [                                       // las imágenes, EN ORDEN
    "img_a.png",
    "img_b.png",
    { "file": "img_c.png", "duration": 6 }          // (opcional) 6s fijos
  ]
}
```

3. Corre `npm run build && npm run render`.

> 💡 También puedes solo decirme *"aquí va la siguiente tanda"* y yo agrego el
> bloque, escalo las imágenes y renderizo.

Cada tanda **saca su propio clip vertical automáticamente** (`danny-clip-block2-short.mp4`),
y todas las tandas juntas forman el **video completo**.

---

## 5. El config a fondo (`projects.config.json`)

```jsonc
{
  "projects": [
    {
      "id": "danny",                  // nombre corto sin espacios (define los archivos de salida)
      "title": "Danny",
      "fps": 30,                        // 30 recomendado (24/60 también sirven)
      "captions": true,                // subtítulos en verticales desde el guion (ver §10)
      "sourceImagesDir": "../faceless danny",   // carpeta de las imágenes originales
      "blocks": [ /* tus tandas — ver sección 4 */ ],
      "hooks": [ /* clips de gancho — ver sección 6 */ ]
    }
  ]
}
```

### Sincronización: manual + automático (en la misma tanda)

- **Automático (parejo):** imagen como texto `"img.png"` → el audio del bloque se
  reparte por igual entre las imágenes automáticas.
  *Ej: audio 21s con 6 imágenes = 3.5s cada una.*
- **Manual:** imagen como `{ "file": "img.png", "duration": 6 }` → esos 6s son fijos.
  El tiempo restante se reparte entre las automáticas.
- Puedes **mezclar** ambas en el mismo bloque.

---

## 6. Clips de gancho (las "mejores partes")

Un **hook** es un clip corto (Short) armado con los mejores bloques, para enganchar
y mandar tráfico al video largo. Se definen en `hooks`:

```jsonc
"hooks": [
  { "id": "intro",  "label": "Gancho de apertura", "blocks": ["block1"] },
  { "id": "climax", "label": "Momento clave",       "blocks": ["block4", "block5"] }
]
```

- `blocks` = qué tandas entran al gancho (se pegan una tras otra, aunque no sean seguidas).
- Cada hook sale como `danny-hook-<id>-short.mp4`.
- **¿Cómo elijo las mejores partes?** Ahora es manual (tú eliges los bloques). Cuando
  haya varias tandas, dime *"sácame los ganchos"* y yo reviso el contenido y propongo
  los `hooks` (apertura, giro, momento clave) por ti.

---

## 7. Todos los comandos

```bash
# --- preparar ---
npm run build        # enhance (mejora imágenes IA) + manifest (tiempos)
npm run enhance      # solo mejorar imágenes
npm run manifest     # solo recalcular tiempos

# --- previsualizar ---
npm run studio       # abre Remotion Studio en el navegador

# --- renderizar ---
npm run render         # TODO: video completo + clips + ganchos   ← el "une todo"
npm run render:full    # solo el video completo (horizontal + vertical)
npm run render:clips   # solo un clip por cada tanda (vertical)
npm run render:hooks   # solo los clips de gancho (vertical)
npm run render:list    # lista qué renderizaría, sin renderizar (dry run)
```

Filtros extra (directo al script):

```bash
node scripts/render.mjs --project=danny   # limita a un proyecto
node scripts/render.mjs --clips --both    # clips también en horizontal
node scripts/render.mjs --hooks --h       # ganchos solo horizontal
```

---

## 8. Qué sale (archivos en `out/`)

| Archivo | Qué es | Formato |
|---------|--------|---------|
| `danny-full-1080p.mp4` | Video completo (todas las tandas) | 1920×1080 |
| `danny-full-short.mp4` | Video completo vertical | 1080×1920 |
| `danny-clip-block1-short.mp4` | Clip de una tanda | 1080×1920 |
| `danny-hook-intro-short.mp4` | Clip de gancho | 1080×1920 |

En **Remotion Studio** cada uno aparece como una composición: `danny-full-h`,
`danny-full-v`, `danny-clip-block1-v`, `danny-hook-intro-v`, etc.

---

## 9. Cómo funciona por dentro

- **"Quitar la IA" / upscale** (`scripts/enhance-images.mjs`): copia cada imagen y la
  escala 4× con **Real-ESRGAN** (IA que agrega detalle real), normalizada a 3840px.
  Respaldo automático a `sips` si el binario falla. Idempotente (no repite lo hecho;
  `--force` para rehacer). Salen a `public/projects/<id>/images/`.
- **Tiempos** (`scripts/build-manifest.mjs`): mide cada narración con `afinfo` y
  reparte los frames por imagen (auto/manual). Escribe `src/manifest.json`.
- **El "edit"** (`src/`): en Remotion, cada imagen lleva **Ken Burns** (zoom + paneo,
  alternando por orden) y **crossfade** de 0.5s con la siguiente. El vertical usa
  fondo difuminado + imagen centrada.
- **Segmentos** (`src/lib/segment.ts`): el video completo, un clip o un gancho son el
  mismo componente con distinto subconjunto de bloques, re-basado a empezar en 0.

### Ajustes rápidos

| Quiero… | Dónde |
|---------|-------|
| Más/menos zoom o paneo | `src/components/KenBurns.tsx` → `ZOOM`, `PAN`, `OVERSCAN` |
| Crossfade más largo/corto | `src/Video.tsx` → `cross` (0.5s por defecto) |
| Otra resolución de upscale | `scripts/enhance-images.mjs` → `MAX_WIDTH` |
| Cambiar duración de una imagen | `duration` en el config (sección 5) |

---

## 10. Subtítulos (desde tu guion, SIN IA) ✅

Los subtítulos se generan del **guion** —el texto que escribiste para la narración—
**sin correr IA, sin internet y sin costo**. Se reparten sobre la duración del audio
(la voz TTS va a ritmo parejo, así que sincroniza bien) y se pintan en los verticales/Shorts.

**Cómo activarlos por bloque:**

1. Pon `"captions": true` en el proyecto.
2. En cada bloque, dale el texto de la narración de una de estas dos formas:
   - `"scriptFile": "../carpeta/narracion-block1.txt"` ← archivo `.txt` (recomendado)
   - o `"script": "texto de la narración..."` ← inline
3. Corre `npm run captions && npm run manifest` (o simplemente `npm run build`).
4. Renderiza. Los subtítulos salen **solos** en los verticales.

**Importante:** el texto debe ser el MISMO que le diste a ElevenLabs. Si cambias el
guion, vuelve a correr `npm run captions && npm run manifest`.

**Ajustes:**

| Quiero… | Dónde |
|---------|-------|
| Líneas más cortas/largas | `"captionMaxChars": 28` en el proyecto (config) |
| Tamaño, color, contorno, posición | `src/components/Captions.tsx` |

### Alternativa: subtítulos automáticos DEL AUDIO (nube, sin guion)

Si no quieres pegar el guion, puedes sacar los subtítulos **directo del audio** con
timestamps por palabra, usando Whisper en la **nube** (la IA corre en servidores, tu
Mac no hace nada). Groq es **gratis**.

1. Saca una key gratis en https://console.groq.com/keys
2. Copia `.env.example` a `.env` y pega: `GROQ_API_KEY=gsk_...`
3. Con `"captions": true` en el proyecto, corre:
   ```bash
   npm run transcribe:cloud    # transcribe el audio en la nube → subtítulos
   npm run manifest            # los incrusta
   npm run render:hooks        # (o render) re-renderiza con subs
   ```

Resumen de métodos de subtítulos:

| Método | Comando | Del audio | Corre en tu Mac | Necesita |
|--------|---------|-----------|-----------------|----------|
| **Desde el guion** | `npm run captions` | ❌ usa tu texto | ✅ instantáneo | el `.txt` |
| **Whisper nube** | `npm run transcribe:cloud` | ✅ palabra x palabra | ❌ (nube) | key gratis Groq |
| Whisper local | `npm run transcribe` | ✅ | ⚠️ no rinde aquí | — |

---

## 11. Música de fondo

Remotion **no trae música** (ni catálogo): tú pones el archivo y él lo mezcla. Suena
en loop por debajo de la narración, con fade-in/out automático.

1. Baja un track (ver fuentes abajo) y déjalo en `assets/music/`.
2. En el proyecto (config):
   ```json
   "music": "assets/music/mi-track.mp3",
   "musicVolume": 0.14
   ```
   `musicVolume` es 0..1 (por defecto 0.14 — bajito para no tapar la voz).
3. `npm run manifest && npm run render`.

**Fuentes gratis (licencia comercial):** Pixabay y Mixkit (sin atribución), Freesound
(SFX, filtra por CC0), YouTube Audio Library. Ver `assets/README.md`.

## 12. Separadores / tarjetas de capítulo

Un **cuadro negro con texto** es un bloque tipo **`card`** en tu timeline. Úsalo de
intro o entre tandas:

```json
"blocks": [
  { "id": "titulo", "card": "LA DECISIÓN", "subtitle": "una historia", "seconds": 2 },
  { "id": "block1", "audio": "...", "images": [ "..." ] },
  { "id": "sep2",   "card": "Capítulo 2", "seconds": 1.5 },
  { "id": "block2", "audio": "...", "images": [ "..." ] }
]
```

- `card` = texto grande · `subtitle` = línea secundaria (opcional) · `seconds` = duración.
- Hace fade-in/out solo, no lleva audio ni subtítulos, y ocupa su tiempo en el video.
- Estilo (tamaño, color): `src/components/TitleCard.tsx`.

## 13. Problemas comunes

| Síntoma | Solución |
|---------|----------|
| El upscale no agrega detalle | Real-ESRGAN falló → usó `sips`. Borra `bin/realesrgan*` y re-corre `npm run enhance` |
| Cambié el orden de imágenes y no se refleja | `npm run enhance -- --force` (re-mapea posiciones) |
| El render se ve lento | Normal en Mac Intel (~1-2 min por video 1080p de 20s) |
| No aparece una composición nueva | Corre `npm run manifest` (regenera la lista) |

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
