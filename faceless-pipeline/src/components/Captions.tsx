import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionCue, VideoFormat } from "../types";

/**
 * Subtítulos KARAOKE para los Shorts: muestra la línea activa y resalta la palabra
 * que se está diciendo (amarillo + pop); las ya dichas quedan blancas, las que
 * vienen tenues. Usa los tiempos por palabra de Groq.
 */
export const Captions: React.FC<{ captions: CaptionCue[]; format: VideoFormat }> = ({ captions, format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = captions.find((c) => frame >= c.startFrame && frame < c.startFrame + c.durationInFrames);
  if (!active) return null;

  const vertical = format === "vertical";
  const fontSize = vertical ? 66 : 50;
  const stroke = vertical ? 8 : 6;

  const lineIn = interpolate(frame - active.startFrame, [0, 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const words =
    active.words && active.words.length
      ? active.words
      : [{ text: active.text, startFrame: active.startFrame, durationInFrames: active.durationInFrames }];

  // palabra activa = la última cuyo inicio ya pasó (así siempre hay una iluminada)
  let activeIndex = 0;
  for (let i = 0; i < words.length; i++) if (frame >= words[i].startFrame) activeIndex = i;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: vertical ? "26%" : "8%",
        paddingLeft: "6%",
        paddingRight: "6%",
      }}
    >
      <div
        style={{
          opacity: lineIn,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.18em 0.5em",
          maxWidth: "92%",
          fontFamily: '"Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif',
          fontWeight: 900,
          fontSize,
          lineHeight: 1.15,
          textTransform: "uppercase",
        }}
      >
        {words.map((w, i) => {
          const isActive = i === activeIndex;
          const isPast = i < activeIndex;
          const pop = isActive ? spring({ frame: frame - w.startFrame, fps, config: { damping: 200, mass: 0.4 }, durationInFrames: 7 }) : 1;
          const scale = isActive ? interpolate(pop, [0, 1], [1.0, 1.16]) : 1;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `scale(${scale})`,
                color: isActive ? "#ffe14d" : "#ffffff",
                opacity: isActive || isPast ? 1 : 0.45,
                WebkitTextStroke: `${stroke}px black`,
                paintOrder: "stroke fill",
                textShadow: "0 5px 14px rgba(0,0,0,0.6)",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
