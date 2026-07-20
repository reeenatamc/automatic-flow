import React from "react";
import { Composition } from "remotion";
import manifestJson from "./manifest.json";
import type { Manifest, VideoFormat } from "./types";
import { Video } from "./Video";
import { resolveSegment } from "./lib/segment";

const manifest = manifestJson as unknown as Manifest;

const FORMATS: { id: VideoFormat; suffix: string; width: number; height: number }[] = [
  { id: "horizontal", suffix: "h", width: 1920, height: 1080 },
  { id: "vertical", suffix: "v", width: 1080, height: 1920 },
];

type Spec = { id: string; segment: string[] | null };

/**
 * Genera automaticamente las composiciones de cada proyecto:
 *   <id>-full-h / <id>-full-v          -> video completo (une todas las tandas)
 *   <id>-clip-<block>-h / -v           -> un clip por cada tanda
 *   <id>-hook-<hook>-h / -v            -> clips de gancho (mejores partes)
 * Los verticales llevan subtitulos si el proyecto tiene captions: true.
 */
export const RemotionRoot: React.FC = () => {
  const comps: { compId: string; project: (typeof manifest.projects)[string]; segment: string[] | null; fmt: (typeof FORMATS)[number] }[] = [];

  for (const project of Object.values(manifest.projects)) {
    const specs: Spec[] = [{ id: `${project.id}-full`, segment: null }];
    for (const block of project.blocks) specs.push({ id: `${project.id}-clip-${block.id}`, segment: [block.id] });
    for (const hook of project.hooks ?? []) specs.push({ id: `${project.id}-hook-${hook.id}`, segment: hook.segment });

    for (const spec of specs) {
      for (const fmt of FORMATS) {
        comps.push({ compId: `${spec.id}-${fmt.suffix}`, project, segment: spec.segment, fmt });
      }
    }
  }

  return (
    <>
      {comps.map(({ compId, project, segment, fmt }) => {
        const { durationInFrames } = resolveSegment(project, segment);
        return (
          <Composition
            key={compId}
            id={compId}
            component={Video}
            durationInFrames={durationInFrames}
            fps={project.fps}
            width={fmt.width}
            height={fmt.height}
            defaultProps={{ projectId: project.id, format: fmt.id, segment }}
          />
        );
      })}
    </>
  );
};
