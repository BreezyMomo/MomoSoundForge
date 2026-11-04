import type { RenderResult } from "./model";
import {
  exportWav,
  type ExportSettings,
  type ExportFormat,
} from "./exportAudio";
export const AUDIO_MIME: Record<ExportFormat, string> = {
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  flac: "audio/flac",
};
export function codecArguments(format: Exclude<ExportFormat, "wav">): string[] {
  switch (format) {
    case "ogg":
      return ["-c:a", "libvorbis", "-q:a", "5"];
    case "mp3":
      return ["-c:a", "libmp3lame", "-q:a", "2"];
    case "flac":
      return ["-c:a", "flac", "-compression_level", "5"];
  }
}
// Lazy-loaded local assets: no CDN dependency and no audio leaves the browser.
let core: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | undefined;
let queue: Promise<unknown> = Promise.resolve();
async function getCore(status: (key: string) => void) {
  if (!core) {
    status("export.loadingEncoder");
    core = (async () => {
      const [{ FFmpeg }, { default: coreURL }, { default: wasmURL }] =
        await Promise.all([
          import("@ffmpeg/ffmpeg"),
          import("@ffmpeg/core?url"),
          import("@ffmpeg/core/wasm?url"),
        ]);
      const ffmpeg = new FFmpeg();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ffmpeg.load({
            coreURL: new URL(coreURL, location.href).href,
            wasmURL: new URL(wasmURL, location.href).href,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error("error.encode")), 60000);
          }),
        ]);
        return ffmpeg;
      } catch (error) {
        ffmpeg.terminate();
        core = undefined;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    })().catch((error) => {
      core = undefined;
      throw error;
    });
  }
  return core;
}
export async function encodeAudio(
  result: RenderResult,
  settings: ExportSettings,
  status: (key: string) => void = () => {},
): Promise<Uint8Array<ArrayBuffer>> {
  const wav = new Uint8Array(exportWav(result, settings.mono));
  if (settings.format === "wav") return wav;
  const run = async () => {
    const ffmpeg = await getCore(status),
      output = "output." + settings.format;
    status("export.encoding");
    try {
      await ffmpeg.writeFile("input.wav", wav);
      const code = await ffmpeg.exec(
        [
          "-i",
          "input.wav",
          "-map_metadata",
          "-1",
          ...codecArguments(settings.format as Exclude<ExportFormat, "wav">),
          output,
        ],
        60000,
      );
      if (code !== 0) throw Error("error.encode");
      const data = await ffmpeg.readFile(output);
      if (typeof data === "string" || !data.length) throw Error("error.encode");
      return new Uint8Array(data);
    } finally {
      await Promise.allSettled([
        ffmpeg.deleteFile("input.wav"),
        ffmpeg.deleteFile(output),
      ]);
    }
  };
  const job = queue.then(run, run);
  queue = job.catch(() => {});
  return job;
}
