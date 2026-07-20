# 🎬 Formato de escenas (el "diccionario" imagen → tiempo)

Para que cada imagen caiga **exacta** en su momento de la narración, el pipeline
necesita saber, por capítulo, qué imagen se muestra y en qué tiempo. Ese diccionario
lo genera tu IA a partir de los **timestamps** (`data/timestamps/moises.md`).

## Formato (JSON)

```json
{
  "cap1": [
    { "file": "cap1-01.png", "start": 0.0, "end": 8.6 },
    { "file": "cap1-02.png", "start": 8.6, "end": 11.8 }
  ],
  "cap2": [
    { "file": "cap2-01.png", "start": 0.0, "end": 4.4 }
  ]
}
```

**Reglas:**
- `file` = nombre de la imagen (`cap1-01.png`…).
- `start` / `end` = segundos (copiados de los timestamps). *También vale* `"duration": 8.6`.
- Las imágenes van **en orden** y deben **cubrir todo el audio del capítulo sin huecos**
  (cap1 ≈ 48.8 s · cap2 ≈ 68.8 s).
- **Opcional** (para efectos, más adelante): `"camera"` (zoom-in/zoom-out/pan-left/pan-right/static),
  `"effect"` (vignette/grain/shake/flash…), `"emotion"` (tension/impact…), `"subtitle"`.

## 📋 Prompt para tu IA (pégalo tal cual)

> Tienes los timestamps de una narración (escena · inicio · fin · texto):
> ```
> [PEGA AQUÍ el contenido de data/timestamps/moises.md]
> ```
> Y estas imágenes por capítulo, EN ORDEN:
> - cap1: cap1-01.png … cap1-08.png
> - cap2: cap2-01.png … cap2-08.png
>
> Agrupa las escenas consecutivas en las imágenes disponibles (cada imagen cubre 1 o
> más escenas seguidas, según lo que muestra) y devuélveme SOLO un JSON con este
> formato EXACTO:
> ```json
> { "cap1": [ {"file":"cap1-01.png","start":0.0,"end":8.6}, ... ], "cap2": [ ... ] }
> ```
> Los tiempos van en orden y cubren todo el audio de cada capítulo (cap1≈48.8s, cap2≈68.8s) SIN huecos ni solapes.

## Ejemplo (cap1 con sus 8 imágenes reales)

```json
{
  "cap1": [
    { "file": "cap1-01.png", "start": 0.0,  "end": 8.6  },
    { "file": "cap1-02.png", "start": 8.6,  "end": 11.8 },
    { "file": "cap1-03.png", "start": 11.8, "end": 15.9 },
    { "file": "cap1-04.png", "start": 15.9, "end": 21.2 },
    { "file": "cap1-05.png", "start": 21.2, "end": 25.6 },
    { "file": "cap1-06.png", "start": 25.6, "end": 30.5 },
    { "file": "cap1-07.png", "start": 30.5, "end": 40.2 },
    { "file": "cap1-08.png", "start": 40.2, "end": 48.8 }
  ]
}
```

## Cómo lo uso
Cuando me pases ese JSON, lo meto en los `blocks` de `projects.config.json` (cada lista
de capítulo = las `images` de ese bloque) y ya cada imagen queda clavada en su tiempo.

## ¿No quieres pedírselo a la IA?
Dime **"reparte parejo"** y yo distribuyo las imágenes por igual sobre cada audio
(cap1: 8 imgs ÷ 48.8s ≈ 6.1s c/u). Cero trabajo, un poco menos preciso.
