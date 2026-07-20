# Production Script — Moisés

> Plan de edición (humano). De aquí sale el config del pipeline. El pipeline NO lee este archivo.

## Global
- Formato: horizontal 1920×1080 + Shorts 1080×1920
- fps: 30
- Música: `assets/music/<track>.mp3` · volumen 0.14
- Emoción base: <tensión / épico / reflexivo>

## Flujo (audio-first)
1. Dejo los audios en `audio/` → `cap1.mp3`, `cap2.mp3`…
2. `npm run timestamps` → tiempos por escena en `data/timestamps/moises.md`
3. Con esos tiempos genero las imágenes → `imagenes/`
4. Lleno `blocks` en `projects.config.json`
5. `npm run build && npm run render`

## Capítulos
### Cap 1 — <título>
- Card intro: `MOISÉS` · `una historia` · 2s
- Emoción: <...>
- Escenas (pegar desde `data/timestamps/moises.md`):

| Escena | Tiempo | Cámara | Efecto | SFX/Emoción | Imagen (prompt) |
|--------|--------|--------|--------|-------------|-----------------|
| 1 | 00:00–00:04 | zoom-in | vignette | tensión | ... |
| 2 | 00:04–00:09 | pan-left | — | — | ... |
