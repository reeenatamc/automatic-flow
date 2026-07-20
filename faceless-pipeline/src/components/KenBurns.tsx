import React from "react";
import { AbsoluteFill, Img, interpolate, Easing, useCurrentFrame, staticFile } from "remotion";
import type { VideoFormat } from "../types";

/**
 * Imagen con efecto Ken Burns (zoom + paneo lento y suave).
 * La variacion es DETERMINISTA segun el indice: alterna zoom-in/zoom-out y la
 * direccion del paneo, para que se vea variado pero reproducible en cada render.
 */
const OVERSCAN = 1.06; // escala base: evita que se vean bordes negros al panear
const ZOOM = 0.12; // cuanto zoom extra durante la escena
const PAN = 2.5; // % de paneo maximo

interface KenBurnsProps {
  src: string; // ya resuelto con staticFile
  durationInFrames: number;
  index: number;
  style?: React.CSSProperties;
}

const KenBurnsImage: React.FC<KenBurnsProps> = ({ src, durationInFrames, index, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });

  const zoomIn = index % 2 === 0;
  const scale = OVERSCAN + ZOOM * (zoomIn ? p : 1 - p);

  const dir = index % 4; // 0:izq 1:der 2:arriba 3:abajo
  const px = (dir === 0 ? -1 : dir === 1 ? 1 : 0) * PAN * p;
  const py = (dir === 2 ? -1 : dir === 3 ? 1 : 0) * PAN * p;

  return (
    <Img
      src={src}
      style={{
        ...style,
        transform: `scale(${scale}) translate(${px}%, ${py}%)`,
        willChange: "transform",
      }}
    />
  );
};

/**
 * Escena = una imagen encuadrada segun el formato.
 *  - horizontal: la imagen cubre todo el frame.
 *  - vertical (Shorts): fondo difuminado de la misma imagen + imagen nitida
 *    centrada a lo ancho (look tipico de canal faceless).
 */
export const Scene: React.FC<{
  src: string; // ruta relativa dentro de public/
  durationInFrames: number;
  index: number;
  format: VideoFormat;
}> = ({ src, durationInFrames, index, format }) => {
  const url = staticFile(src);

  if (format === "vertical") {
    return (
      <AbsoluteFill>
        <AbsoluteFill>
          <Img
            src={url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scale(1.1)",
              filter: "blur(45px) brightness(0.45)",
            }}
          />
        </AbsoluteFill>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <KenBurnsImage
            src={url}
            durationInFrames={durationInFrames}
            index={index}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // horizontal
  return (
    <AbsoluteFill>
      <KenBurnsImage
        src={url}
        durationInFrames={durationInFrames}
        index={index}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
};
