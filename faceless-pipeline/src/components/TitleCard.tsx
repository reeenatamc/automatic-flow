import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/ComicNeue";
import type { VideoFormat } from "../types";

const { fontFamily } = loadFont();

/**
 * Separador de capítulo: fondo BLANCO, minimal, fuente estilo Comic Sans (Comic Neue).
 * Fade-in/out + pop suave. Se usa como bloque tipo "card" en el timeline.
 */
export const TitleCard: React.FC<{
  text: string;
  subtitle?: string;
  format: VideoFormat;
  durationInFrames: number;
}> = ({ text, subtitle, format, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = Math.round(fps * 0.35);

  const opacity = Math.min(
    interpolate(frame, [0, fade], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [durationInFrames - fade, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  );
  const pop = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 22 });
  const scale = interpolate(pop, [0, 1], [0.9, 1]);
  const vertical = format === "vertical";

  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff", justifyContent: "center", alignItems: "center", padding: "10%" }}>
      <div style={{ opacity, transform: `scale(${scale})`, textAlign: "center" }}>
        <div style={{ color: "#1a1a1a", fontFamily, fontWeight: 700, fontSize: vertical ? 104 : 92, lineHeight: 1.12 }}>
          {text}
        </div>
        {subtitle ? (
          <div style={{ color: "#9a9a9a", fontFamily, fontWeight: 400, fontSize: vertical ? 44 : 38, marginTop: 18 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
