import { Config } from "@remotion/cli/config";

// Salida de video
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setPixelFormat("yuv420p"); // maxima compatibilidad (YouTube, QuickTime, etc.)
Config.setCodec("h264");
Config.setCrf(18); // calidad alta (menor = mejor, 18 es visualmente sin perdidas)

// En Mac Intel sin GPU dedicada potente, concurrencia moderada evita saturar RAM.
Config.setConcurrency(3);
