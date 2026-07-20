#!/usr/bin/env node
/**
 * generate-sfx.mjs
 * ----------------
 * Genera una paleta de efectos de sonido POR CÓDIGO (síntesis con ffmpeg),
 * sin descargar nada. Salen a assets/sfx/. Úsalos por escena/emoción.
 *
 * Uso:  node scripts/generate-sfx.mjs
 */
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SFX = join(ROOT, "assets", "sfx");
mkdirSync(SFX, { recursive: true });

if (!ffmpegPath || !existsSync(ffmpegPath)) {
  console.error("❌ Falta ffmpeg-static. Corre: npm install ffmpeg-static");
  process.exit(1);
}

// nombre -> [inputs de lavfi] + cadena de filtros
const FX = {
  // transición: ruido filtrado con flanger + envolvente
  whoosh: { src: "anoisesrc=d=0.55:c=pink:a=0.7", af: "highpass=f=300,lowpass=f=7000,flanger,afade=t=in:d=0.08,afade=t=out:st=0.22:d=0.33,volume=1.4" },
  // golpe grave (cambio de escena fuerte, Mar Rojo)
  impact: { src: "sine=frequency=80:duration=0.7", af: "afade=t=out:st=0.04:d=0.66,volume=2.4,alimiter" },
  // riser de tensión (sube antes de un momento clave)
  riser: { src: "aevalsrc=exprs='0.3*sin(2*PI*(150*t+160*t*t))':d=2", af: "afade=t=in:d=1.85,afade=t=out:st=1.88:d=0.12,volume=1.3" },
  // caída grave / sub-drop
  drop: { src: "aevalsrc=exprs='0.5*sin(2*PI*(130*t-48*t*t))':d=1", af: "afade=t=out:st=0.6:d=0.4,volume=1.7,alimiter" },
  // drone de tensión (bed sostenido, loopable)
  drone: { src: "aevalsrc=exprs='0.28*sin(2*PI*55*t)+0.16*sin(2*PI*82.5*t)':d=4", af: "afade=t=in:d=0.7,afade=t=out:st=3.3:d=0.7,volume=1.1" },
  // reveal / shimmer (para descubrir algo, campana)
  reveal: { src: "aevalsrc=exprs='0.28*(sin(2*PI*1046*t)+sin(2*PI*1568*t))':d=1", af: "afade=t=out:st=0.12:d=0.88,volume=1.2" },
  // tick corto (acento sutil)
  tick: { src: "sine=frequency=1800:duration=0.06", af: "afade=t=out:st=0.01:d=0.05,volume=0.9" },
  // ding / notificación (campana brillante con decaimiento natural)
  ding: { src: "aevalsrc=exprs='0.4*exp(-4*t)*(sin(2*PI*1318*t)+0.4*sin(2*PI*2637*t)+0.18*sin(2*PI*3956*t))':d=1.3", af: "afade=t=out:st=1.15:d=0.15,volume=1.25" },

  // --- cinemáticos ---
  boom: { src: "aevalsrc=exprs='0.7*exp(-3*t)*sin(2*PI*45*t)':d=1.2", af: "afade=t=out:st=1.05:d=0.15,volume=1.6,alimiter" },
  braam: { src: "aevalsrc=exprs='0.3*(sin(2*PI*55*t)+sin(2*PI*55.4*t)+sin(2*PI*82.5*t))':d=1.6", af: "afade=t=in:d=0.15,afade=t=out:st=1.35:d=0.25,volume=1.4,alimiter" },
  rumble: { src: "anoisesrc=d=2.5:c=brown:a=0.8", af: "lowpass=f=110,afade=t=in:d=0.5,afade=t=out:st=2:d=0.5,volume=1.5" },
  thunder: { src: "anoisesrc=d=2.5:c=brown:a=0.9", af: "lowpass=f=200,afade=t=in:d=0.05,afade=t=out:st=1.5:d=1,volume=1.7,alimiter" },
  heartbeat: { src: "aevalsrc=exprs='0.7*sin(2*PI*52*t)*exp(-14*mod(t\\,0.75))':d=1.6", af: "volume=1.4,alimiter" },
  // --- transiciones ---
  "swoosh-up": { src: "aevalsrc=exprs='0.3*sin(2*PI*(300*t+400*t*t))':d=0.6", af: "afade=t=in:d=0.1,afade=t=out:st=0.4:d=0.2,volume=1.3" },
  "swoosh-down": { src: "aevalsrc=exprs='0.3*sin(2*PI*(700*t-400*t*t))':d=0.6", af: "afade=t=in:d=0.1,afade=t=out:st=0.4:d=0.2,volume=1.3" },
  glitch: { src: "anoisesrc=d=0.4:c=white:a=0.6", af: "highpass=f=1000,acrusher=bits=4:mode=log,afade=t=out:st=0.2:d=0.2,volume=1.1" },
  // --- acentos ---
  pop: { src: "aevalsrc=exprs='0.6*sin(2*PI*(900-1800*t)*t)*exp(-28*t)':d=0.18", af: "volume=1.3" },
  beep: { src: "sine=frequency=1000:duration=0.18", af: "afade=t=in:d=0.005,afade=t=out:st=0.16:d=0.02,volume=0.9" },
  sparkle: { src: "aevalsrc=exprs='0.25*exp(-5*t)*(sin(2*PI*1568*t)+sin(2*PI*2093*t)+sin(2*PI*3136*t))':d=1.4", af: "afade=t=out:st=1.2:d=0.2,volume=1.2" },
  // --- ambiente ---
  wind: { src: "anoisesrc=d=3:c=pink:a=0.5", af: "bandpass=f=500:width_type=h:w=400,tremolo=f=0.4:d=0.6,afade=t=in:d=0.8,afade=t=out:st=2.2:d=0.8,volume=1.3" },
};

console.log("🔊 Generando SFX por código (ffmpeg)...");
for (const [name, { src, af }] of Object.entries(FX)) {
  const out = join(SFX, `${name}.mp3`);
  try {
    execFileSync(ffmpegPath, ["-y", "-f", "lavfi", "-i", src, "-af", af, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "192k", out], { stdio: ["ignore", "ignore", "ignore"] });
    console.log(`  ✅ ${name}.mp3`);
  } catch (e) {
    console.log(`  ❌ ${name} → ${(e.message || "").split("\n")[0]}`);
  }
}
console.log("\n✅ SFX en assets/sfx/. Escúchalos y dime cuáles usar (yo los cableo por escena/card).");
