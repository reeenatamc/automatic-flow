export type VideoFormat = "horizontal" | "vertical";
export type BlockKind = "media" | "card";

export interface ImageManifest {
  src: string; // ruta dentro de public/ (para staticFile)
  file: string; // nombre del archivo original
  startFrame: number; // frame global donde empieza (en el video completo)
  durationInFrames: number;
}

export interface CaptionWord {
  text: string;
  startFrame: number; // relativo al inicio del bloque
  durationInFrames: number;
}

export interface CaptionCue {
  text: string;
  startFrame: number; // relativo al inicio del bloque
  durationInFrames: number;
  words?: CaptionWord[]; // para karaoke (resaltar palabra activa)
}

export interface BlockManifest {
  id: string;
  kind: BlockKind;
  startFrame: number; // global
  audioDurationInFrames: number; // duracion del bloque en frames (audio para media, duracion para card)
  // --- media ---
  audio?: string; // ruta dentro de public/
  audioStartFromFrame?: number; // recorta el audio: empieza a reproducir desde este frame (para hooks con ventana)
  images?: ImageManifest[];
  captions?: CaptionCue[]; // subtitulos (relativos al bloque)
  // --- card (separador) ---
  text?: string;
  subtitle?: string;
  // --- efecto de sonido al iniciar el bloque (opcional) ---
  sfx?: { src: string; volume: number };
}

export interface HookDef {
  id: string;
  label: string;
  segment: string[]; // ids de bloques (reales o sinteticos __hook_*) que forman el gancho, ya resueltos
}

export interface ProjectMusic {
  src: string; // ruta dentro de public/
  volume: number; // 0..1
}

export interface ProjectManifest {
  id: string;
  title: string;
  fps: number;
  totalFrames: number;
  captions: boolean; // subtitulos en verticales
  music?: ProjectMusic | null; // musica de fondo (opcional)
  blocks: BlockManifest[];
  hookBlocks?: BlockManifest[]; // bloques sinteticos (recortes) que usan los hooks con ventana; NO entran al video completo ni a los clips
  hooks: HookDef[];
}

export interface Manifest {
  projects: Record<string, ProjectManifest>;
}

// ---- tipos derivados para render por segmento ----
export interface RebasedImage extends ImageManifest {
  localStartFrame: number; // relativo al inicio del segmento
}
export interface RebasedBlock extends BlockManifest {
  localStartFrame: number;
  images?: RebasedImage[];
}
