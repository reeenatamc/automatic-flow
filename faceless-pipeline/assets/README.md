# 🎧🎬 Biblioteca de assets reutilizable

Deja tus archivos aquí para reusarlos en cualquier video. Hay **3 tipos de efectos**:

| Tipo | ¿Se baja? | Va en | Ejemplos |
|------|-----------|-------|----------|
| **Código** | ❌ los programo yo | (nada) | zoom-punch, shake, flash, viñeta, chromatic, aberración |
| **SFX (sonidos)** | ✅ descargables | `sfx/` | whoosh, golpe, riser, tensión, ambiente |
| **Overlays visuales** | ✅ descargables | `overlays/` | light leaks, grano de film, polvo, glitch, transiciones |
| **Música** | ✅ descargable | `music/` | pistas de fondo |

## 📥 Dónde descargar (gratis, licencia comercial)

**Música + SFX:**
| Sitio | Qué | Atribución |
|---|---|---|
| Pixabay — pixabay.com/music · /sound-effects | Música + SFX | ❌ no requiere |
| Mixkit — mixkit.co | Música + SFX | ❌ no requiere |
| Freesound — freesound.org | SFX (enorme) | ⚠️ filtra por **CC0** |

**Overlays visuales (video/PNG para poner encima):**
| Sitio | Qué | Nota |
|---|---|---|
| Pixabay — pixabay.com/videos (busca "light leak", "film grain", "dust overlay") | Video overlays | libre, sin atribución |
| Mixkit — mixkit.co/free-stock-video | Video overlays + transiciones | libre |
| Videezy / Motion Array (free) | Light leaks, glitch, partículas | revisar licencia |

> Los overlays se ponen en modo **screen/add** encima del video (los negros desaparecen, las luces se suman). Yo los compongo en Remotion.

## Cómo se usan
- **Música:** `"music": "assets/music/x.mp3"` en el config (ver FORMATO.md §11).
- **SFX / Overlays:** déjalos en su carpeta y pídeme conectarlos por escena/emoción (ej. un *whoosh* en cada card, un *light leak* en los momentos de tensión).

## Requisito
Revisa la licencia de cada archivo. **Pixabay** y **Mixkit** = sin líos de atribución.
