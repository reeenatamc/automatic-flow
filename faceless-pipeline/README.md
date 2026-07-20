# Faceless Pipeline 🎬

Automatiza videos para tu canal faceless **sin CapCut**: mejora las imágenes con IA
(upscale) y monta el video con Remotion (Ken Burns, crossfades, sincronizado a la
narración). Trabaja por **tandas** (grupos de imágenes + un audio) y te saca el
**video completo + clips + clips de gancho** (horizontal y Shorts).

## Empieza aquí

```bash
npm install         # una sola vez
npm run build       # mejora imágenes (IA) + calcula tiempos
npm run render      # saca TODO a out/ (completo + clips + ganchos)
npm run studio      # (opcional) previsualiza y ajusta en el navegador
```

## 📖 Documentación completa

Todo el detalle —cómo pasar una tanda, el formato del config, los clips de gancho,
todos los comandos y cómo funciona por dentro— está en **[`FORMATO.md`](./FORMATO.md)**.

## Resumen ultra-rápido

- **Describes tus videos** en `projects.config.json` (proyectos → tandas/bloques → imágenes).
- **`npm run build`** mejora las imágenes con Real-ESRGAN y calcula la sincronización.
- **`npm run render`** une todo y bota los MP4 a `out/`:
  - `danny-full-1080p.mp4` / `danny-full-short.mp4` — video completo (H y V)
  - `danny-clip-<tanda>-short.mp4` — un clip por tanda
  - `danny-hook-<id>-short.mp4` — clips de gancho (mejores partes)
- **Subtítulos:** desde tu **guion**, sin IA (`captions: true` + `scriptFile`). Ver FORMATO.md §10.
