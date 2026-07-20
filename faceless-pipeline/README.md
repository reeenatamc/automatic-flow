# Faceless Pipeline 🎬

Automatiza videos para tu canal faceless **sin CapCut**: mejora las imágenes con IA
(upscale) y monta el video con Remotion (Ken Burns, crossfades, sincronizado a la
narración). Trabaja por **tandas** (grupos de imágenes + un audio) y te saca el
**video completo + clips por tanda + hooks** (horizontal 1080p y Shorts verticales).

Funciona en **Windows, macOS y Linux**.

## Empieza aquí

```bash
npm install         # una sola vez
npm run ui          # 👈 la forma fácil: interfaz web con botones (localhost:4599)
```

O por línea de comandos:

```bash
npm run check       # valida tu config (archivos, tiempos, hooks)
npm run build       # mejora imágenes (IA) + subtítulos + calcula tiempos
npm run render      # saca TODO a out/ (completo + clips + hooks)
npm run studio      # (opcional) previsualiza y ajusta en el navegador
```

## Qué sale (en `out/`)

Con el proyecto de ejemplo `moises`:

| Archivo | Qué es | Formato |
|---|---|---|
| `moises-full-1080p.mp4` | Video completo | 1920×1080 |
| `moises-full-short.mp4` | Video completo vertical | 1080×1920 |
| `moises-clip-<tanda>-short.mp4` | Un clip por tanda | 1080×1920 |
| `moises-hook-<id>-short.mp4` | Clips de gancho (mejores partes) | 1080×1920 |

Los subtítulos salen **solo en los verticales** (los horizontales van limpios).

## 📖 Documentación

- **[`FORMATO.md`](./FORMATO.md)** — la guía completa: cómo pasar una tanda, el
  formato del config, los comandos, cómo funciona por dentro.
- **[`HOOKS.md`](./HOOKS.md)** — estrategia y formato de los clips de gancho.

## Resumen del flujo

1. Dejas tus audios en `../proyectos/<id>/audio/` y tus imágenes en `../proyectos/<id>/imagenes/`.
2. Describes el video en `projects.config.json` (proyecto → tandas → imágenes con sus tiempos).
3. `npm run build` mejora las imágenes con Real-ESRGAN y calcula la sincronización.
4. `npm run render` une todo y bota los MP4 a `out/`.

## Requisitos

- **Node 18+** y **npm**. Nada más (no necesita ffmpeg ni herramientas del sistema).
- Primera vez: se descargan Real-ESRGAN (~30 MB) y un Chrome headless (~150 MB).

> ⚠️ Si copias el proyecto de una máquina a otra (ej. Mac → Windows), reinstala:
> `rm -rf node_modules && npm install`. Las dependencias traen binarios por SO.
