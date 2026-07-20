import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import manifestJson from "./manifest.json";
import type { Manifest, VideoFormat } from "./types";
import { Scene } from "./components/KenBurns";
import { Captions } from "./components/Captions";
import { TitleCard } from "./components/TitleCard";
import { resolveSegment } from "./lib/segment";

const manifest = manifestJson as unknown as Manifest;

export type VideoProps = {
  projectId: string;
  format: VideoFormat;
  segment: string[] | null; // null = video completo; si no, ids de bloques
};

export const Video: React.FC<VideoProps> = ({ projectId, format, segment }) => {
  const project = manifest.projects[projectId];
  if (!project) return <AbsoluteFill style={{ backgroundColor: "black" }} />;

  const { blocks } = resolveSegment(project, segment);
  const showCaptions = format === "vertical" && project.captions;
  const cross = Math.round(project.fps * 0.5);
  const mediaBlocks = blocks.filter((b) => b.kind !== "card");
  const cardBlocks = blocks.filter((b) => b.kind === "card");
  const images = mediaBlocks.flatMap((b) => b.images ?? []);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Música de fondo (opcional), por debajo de la narración */}
      {project.music ? <BackgroundMusic src={project.music.src} volume={project.music.volume} /> : null}

      {/* Narración (solo bloques media) */}
      {mediaBlocks.map((b) => (
        <Sequence key={`audio-${b.id}`} from={b.localStartFrame} durationInFrames={b.audioDurationInFrames}>
          {b.audio ? <Audio src={staticFile(b.audio)} /> : null}
        </Sequence>
      ))}

      {/* SFX: suena al iniciar el bloque (cards, escenas…) */}
      {blocks.map((b) =>
        b.sfx ? (
          <Sequence key={`sfx-${b.id}`} from={b.localStartFrame} durationInFrames={Math.round(project.fps * 3)}>
            <Audio src={staticFile(b.sfx.src)} volume={b.sfx.volume} />
          </Sequence>
        ) : null
      )}

      {/* Imágenes con crossfade + Ken Burns */}
      {images.map((img, i) => {
        const pre = i > 0 ? cross : 0;
        const from = Math.max(0, img.localStartFrame - pre);
        const dur = img.durationInFrames + pre;
        return (
          <Sequence key={`img-${i}`} from={from} durationInFrames={dur} style={{ zIndex: i + 1 }}>
            <FadeScene fadeFrames={pre} durationInFrames={dur} index={i} src={img.src} format={format} />
          </Sequence>
        );
      })}

      {/* Separadores / tarjetas de capítulo (cuadro negro con texto) */}
      {cardBlocks.map((b) => (
        <Sequence key={`card-${b.id}`} from={b.localStartFrame} durationInFrames={b.audioDurationInFrames} style={{ zIndex: 500 }}>
          <TitleCard text={b.text ?? ""} subtitle={b.subtitle} format={format} durationInFrames={b.audioDurationInFrames} />
        </Sequence>
      ))}

      {/* Subtítulos: encima de todo (solo sobre media) */}
      {showCaptions &&
        mediaBlocks.map((b) =>
          b.captions && b.captions.length > 0 ? (
            <Sequence key={`cap-${b.id}`} from={b.localStartFrame} durationInFrames={b.audioDurationInFrames} style={{ zIndex: 1000 }}>
              <Captions captions={b.captions} format={format} />
            </Sequence>
          ) : null
        )}
    </AbsoluteFill>
  );
};

const BackgroundMusic: React.FC<{ src: string; volume: number }> = ({ src, volume }) => {
  const { durationInFrames, fps } = useVideoConfig();
  const fade = Math.round(fps * 0.75);
  return (
    <Audio
      src={staticFile(src)}
      loop
      volume={(f) =>
        Math.min(
          interpolate(f, [0, fade], [0, volume], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          interpolate(f, [durationInFrames - fade, durationInFrames], [volume, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        )
      }
    />
  );
};

const FadeScene: React.FC<{
  fadeFrames: number;
  durationInFrames: number;
  index: number;
  src: string;
  format: VideoFormat;
}> = ({ fadeFrames, durationInFrames, index, src, format }) => {
  const frame = useCurrentFrame();
  const opacity =
    fadeFrames > 0
      ? interpolate(frame, [0, fadeFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <Scene src={src} durationInFrames={durationInFrames} index={index} format={format} />
    </AbsoluteFill>
  );
};
