import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  audioResult,
  DEFAULT_EXPORT,
  exportWav,
  parseExportSettings,
} from "../src/exportAudio";
import { codecArguments, encodeAudio } from "../src/encodeAudio";
const require = createRequire(import.meta.url);
let core: any;
beforeAll(async () => {
  vi.stubGlobal("self", { location: { href: "file:///core.js" } });
  core = await require("@ffmpeg/core")({
    wasmBinary: readFileSync(require.resolve("@ffmpeg/core/wasm")),
    locateFile: (p: string) => p,
  });
}, 30000);
afterAll(() => vi.unstubAllGlobals());
it("keeps older preferences compatible and rejects unknown formats", () => {
  expect(parseExportSettings({ sampleRate: 22050 }).format).toBe("wav");
  expect(parseExportSettings({ format: "exe" }).format).toBe("wav");
  expect(parseExportSettings({ format: "flac" }).format).toBe("flac");
});
it("exports WAV without loading the browser encoder", async () => {
  const result = audioResult(
    new Float32Array(100),
    new Float32Array(100),
    48000,
  );
  expect(await encodeAudio(result, DEFAULT_EXPORT)).toEqual(
    new Uint8Array(exportWav(result, false)),
  );
});
describe.each(["ogg", "mp3", "flac"] as const)(
  "%s real codec roundtrip",
  (format) => {
    for (const sampleRate of [22050, 44100, 48000])
      for (const mono of [true, false]) {
        it(`${sampleRate} Hz ${mono ? "mono" : "stereo"}`, () => {
          const left = Float32Array.from(
            { length: Math.round(sampleRate * 0.2) },
            (_, i) => 0.3 * Math.sin((i * 440 * 2 * Math.PI) / sampleRate),
          );
          const right = left.map((v) => v * 0.5);
          const wav = new Uint8Array(
            exportWav(audioResult(left, right, sampleRate), mono),
          );
          core.FS.writeFile("input.wav", wav);
          try {
            expect(
              core.exec(
                "-i",
                "input.wav",
                ...codecArguments(format),
                `out.${format}`,
              ),
            ).toBe(0);
            const encoded = core.FS.readFile(`out.${format}`);
            expect(
              new TextDecoder().decode(
                encoded.slice(0, format === "mp3" ? 3 : 4),
              ),
            ).toBe({ ogg: "OggS", mp3: "ID3", flac: "fLaC" }[format]);
            core.reset();
            expect(
              core.exec("-i", `out.${format}`, "-f", "s16le", "decoded.raw"),
            ).toBe(0);
            const decoded = core.FS.readFile("decoded.raw");
            // Vorbis decoders may expose the final codec block padding.
            const decodedFrames = decoded.length / ((mono ? 1 : 2) * 2);
            if (format === "ogg")
              expect(Math.abs(decodedFrames - left.length)).toBeLessThanOrEqual(
                1024,
              );
            else expect(decodedFrames).toBe(left.length);
            if (format === "flac") expect(decoded).toEqual(wav.slice(44));
          } finally {
            for (const file of ["input.wav", `out.${format}`, "decoded.raw"]) {
              try {
                core.FS.unlink(file);
              } catch {}
            }
            core.reset();
          }
        });
      }
  },
);
