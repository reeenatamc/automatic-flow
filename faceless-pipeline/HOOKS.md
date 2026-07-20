# ⚓ Estrategia de HOOKS (ganchos para Shorts / Reels / TikTok)

Un **hook** es un clip corto vertical, sacado del video largo, cuyo único trabajo es
**frenar el scroll, retener hasta el final y mandar tráfico al video completo**. No es
un resumen: es el mejor momento, cortado quirúrgicamente.

Aquí NO se pega un bloque entero. Un hook es una **ventana de tiempo** dentro de un
bloque (audio + imágenes + subtítulos recortados y re-sincronizados solos).

---

## 1. Las reglas que mueven retención y monetización

| Principio | Por qué (retención / $$) |
|---|---|
| **Los primeros 3 s deciden todo** | Arranca en la línea de más tensión, sin intro ni build-up. El swipe-away temprano es lo que más te hunde en el algoritmo. |
| **Duración 10-25 s** | Suficiente para contar como view real y sumar watch-time; corto para alta tasa de finalización y **loops**. El loop es oro: reinicia el conteo y sube RPM en Shorts/Reels Play. |
| **Una sola idea por hook** | Un beat emocional (apuestas, giro, revelación). Mezclar dos ideas baja la finalización. |
| **Termina en curiosity gap** | Cierra con una pregunta abierta o cliffhanger → el espectador va al **video largo** (más watch-time long-form = más ingreso por publicidad). |
| **Subtítulos siempre** | ~85% ve en mudo. Ya salen solos (karaoke, palabra por palabra). |
| **Publica varios y mide** | Sacar 2-3 hooks del mismo video y ver cuál rinde es en sí una estrategia. El ganador marca el estilo del próximo. |

---

## 2. Los 4 arquetipos de hook (elige por tipo, no al azar)

1. **STAKES / Cold-open** — planteas un peligro o una cifra enorme en la primera frase.
   *"Dos millones de personas atrapadas… sin escape."*
2. **CURIOSITY GAP / Cliffhanger** — abres una incógnita y NO la resuelves.
   *"…un bebé que nunca debió sobrevivir."*
3. **TWIST / El giro** — el momento en que todo cambia; la decisión o revelación.
   *"…cada niño hebreo debía morir."*
4. **EMOTIONAL PEAK** — el pico de emoción (pérdida, coraje, sacrificio).

> Regla práctica: el **arranque** de tu Short ideal es un STAKES o un TWIST; el
> **cierre** siempre deja un CURIOSITY GAP que apunte al video largo.

---

## 3. Cómo se define un hook (en `projects.config.json`)

```jsonc
"hooks": [
  // ventana de tiempo dentro de un bloque  ← LO RECOMENDADO
  { "id": "apertura", "label": "Cold-open", "block": "cap1", "start": 0.0, "end": 13.5 },

  // (alternativa) uno o más bloques enteros pegados
  { "id": "resumen",  "label": "Intro larga", "blocks": ["cap1"] }
]
```

- `block` + `start`/`end` (segundos) → recorta esa ventana. **Usa esto.**
- `blocks: [...]` → pega bloques completos (para intros largas; rara vez es un buen hook).
- Cada hook sale como `moises-hook-<id>-short.mp4` (1080×1920, con subtítulos).
- El validador (`npm run check`) avisa si un hook dura menos de 3 s o más de 40 s.

---

## 4. Los hooks de *Moisés* (aplicando la estrategia)

| id | Arquetipo | Ventana | La línea | Para qué |
|----|-----------|---------|----------|----------|
| **apertura** | STAKES | cap1 · 0–13.5 s | *"Two million people stood trapped… no escape."* | Cold-open más fuerte. Máxima retención de entrada. |
| **cliffhanger** | CURIOSITY GAP | cap1 · 39.5–49 s | *"…back to a baby who was never supposed to survive."* | Abre la incógnita → clic al video largo. |
| **decreto** | TWIST | cap2 · 50.5–68.5 s | *"…every Hebrew baby boy was to be killed… one mother refused to surrender."* | El giro dramático. El de mayor carga emocional. |

**Plan de publicación sugerido:** sube los 3 en días distintos, cada uno con CTA al
video largo. El que mejor retenga marca el estilo de gancho del próximo video.

---

## 5. Cómo generarlos

```bash
npm run check          # valida las ventanas (duración, que el bloque exista)
npm run manifest       # recalcula (recorta audio/imágenes/subtítulos)
npm run render:hooks   # saca los moises-hook-*-short.mp4 a out/
```

> 💡 También puedes decirme *"proponme los hooks"* y yo leo el contenido y te sugiero
> ventanas nuevas siguiendo esta estrategia.
