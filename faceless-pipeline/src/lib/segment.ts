import type { ProjectManifest, RebasedBlock } from "../types";

/**
 * Resuelve un "segmento" del proyecto (subconjunto de bloques) y lo re-empaqueta
 * empezando en el frame 0, uno tras otro. Sirve igual para el video completo, un
 * clip por tanda o un clip de gancho. Los bloques pueden ser media (audio+imágenes)
 * o card (separador de capítulo); ambos ocupan su duración en el timeline.
 */
export function resolveSegment(
  project: ProjectManifest,
  blockIds: string[] | null
): { blocks: RebasedBlock[]; durationInFrames: number } {
  const selected = blockIds
    ? blockIds.map((id) => project.blocks.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => Boolean(b))
    : project.blocks;

  let cursor = 0;
  const blocks: RebasedBlock[] = selected.map((b) => {
    const localStartFrame = cursor;
    const images = (b.images ?? []).map((im) => ({
      ...im,
      localStartFrame: cursor + (im.startFrame - b.startFrame),
    }));
    cursor += b.audioDurationInFrames;
    return { ...b, localStartFrame, images };
  });

  return { blocks, durationInFrames: Math.max(1, cursor) };
}
