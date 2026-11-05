import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { BUILTIN_SOUNDS, builtinSoundName, builtinSoundDescription, createBuiltinLoader, type BuiltinSound } from "../src/builtinLibrary";
import { catalogs } from "../src/i18n";
import { SOUND_CATEGORIES } from "../src/libraryPreferences";
import { encodeSamples, makeLayer, type Project } from "../src/model";
import { renderProject } from "../src/engine";

const fixture = (): Project => ({
  schema: "momo.soundforge/v2", name: "Factory piano", seed: 2048, duration: .1, master: 1, echo: 0,
  layers: [makeLayer({ id: "note", type: "sample", assetId: "sample", frequency: 440, duration: .1, attack: 0, release: .01, decay: 0 })],
  assets: { sample: { id: "sample", name: "piano.wav", sampleRate: 8000, channels: [encodeSamples(Float32Array.from({ length: 800 }, (_, i) => Math.sin(i * .2) * .3))] } },
});
function resource(raw: unknown = fixture()) {
  const json = Buffer.from(JSON.stringify(raw)), bytes = gzipSync(json);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sound: BuiltinSound = { ...BUILTIN_SOUNDS[0], id: "fixture", sha256, file: `${sha256}.soundforge.bin`, compressedBytes: bytes.length, projectBytes: json.length };
  return { bytes, sound, response: () => new Response(Uint8Array.from(bytes).buffer) };
}
it("indexes all collected samples and examples with matching categories, semantic names and final-render thumbnails", () => {
  expect(BUILTIN_SOUNDS).toHaveLength(162);
  expect(new Set(BUILTIN_SOUNDS.map(x => x.id)).size).toBe(162);
  expect(BUILTIN_SOUNDS.filter(x => x.kind === "instrument")).toHaveLength(106);
  expect(BUILTIN_SOUNDS.filter(x => x.kind === "sample")).toHaveLength(40);
  expect(BUILTIN_SOUNDS.filter(x => x.kind === "example")).toHaveLength(16);
  for (const sound of BUILTIN_SOUNDS) {
    expect(SOUND_CATEGORIES).toContain(sound.category);
    expect(sound.duration).toBeGreaterThanOrEqual(.1);
    expect(Number.isFinite(sound.duration)).toBe(true);
    expect(sound.waveform).toHaveLength(160);
    expect(sound.waveform.every(x => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(true);
    expect(sound.file).toBe(`${sound.sha256}.soundforge.bin`);
    expect(catalogs["zh-CN"]).toHaveProperty(sound.nameKey);
    expect(catalogs.en).toHaveProperty(sound.nameKey);
  }
});
it("uses translated built-in labels while names of opened independent projects remain document data", async () => {
  const { sound, response } = resource();
  const fetcher = vi.fn(async () => response());
  const load = createBuiltinLoader([sound], fetcher, "/nested/");
  expect(fetcher).not.toHaveBeenCalled();
  const opened = await load(sound.id, "我的钢琴");
  opened.layers[0].gain = 0;
  opened.assets.sample.name = "changed.wav";
  const pristine = await load(sound.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(`/nested/sound-library/${sound.file}`);
  expect(pristine.name).toBe("Factory piano");
  expect(pristine.assets.sample.name).toBe("piano.wav");
  expect(pristine.layers[0].gain).not.toBe(0);
  expect(renderProject(pristine).left).toEqual(renderProject(fixture()).left);
  expect(opened.name).toBe("我的钢琴");
  const instrument = BUILTIN_SOUNDS.find(x => x.kind === "instrument")!;
  const translate = (key: string, ...args: unknown[]) => `${key}:${args.join("|")}`;
  expect(builtinSoundName(instrument, translate)).toContain("builtin.instrumentVariant");
  expect(builtinSoundDescription(instrument, translate)).toContain("builtin.instrumentDetails");
});
it("rejects unknown identities and paths before making a request", async () => {
  const { sound, response } = resource();
  const fetcher = vi.fn(async () => response());
  await expect(createBuiltinLoader([sound], fetcher)("missing")).rejects.toThrow("library.builtinLoadError");
  await expect(createBuiltinLoader([{ ...sound, file: "../private.json" }], fetcher)(sound.id)).rejects.toThrow("library.builtinLoadError");
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not cache failures and supports retry after a missing deployment resource", async () => {
  const { sound, response } = resource();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 })).mockImplementation(async () => response());
  const load = createBuiltinLoader([sound], fetcher);
  await expect(load(sound.id)).rejects.toThrow("library.builtinLoadError");
  expect((await load(sound.id)).layers[0].assetId).toBe("sample");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("bounds compressed and expanded data and validates the decoded project schema", async () => {
  const { sound, response } = resource();
  await expect(createBuiltinLoader([{ ...sound, compressedBytes: sound.compressedBytes - 1 }], async () => response())(sound.id)).rejects.toThrow("library.builtinLoadError");
  await expect(createBuiltinLoader([{ ...sound, projectBytes: 16 }], async () => response())(sound.id)).rejects.toThrow("library.builtinLoadError");
  const invalid = resource({ ...fixture(), schema: "future-version" });
  await expect(createBuiltinLoader([invalid.sound], async () => invalid.response())(invalid.sound.id)).rejects.toThrow("library.builtinLoadError");
});
it("deduplicates concurrent downloads without sharing mutable project state", async () => {
  const { sound, response } = resource();
  const fetcher = vi.fn(async () => response());
  const load = createBuiltinLoader([sound], fetcher);
  const [a, b] = await Promise.all([load(sound.id), load(sound.id)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  a.assets.sample.channels[0] = "corrupt";
  expect(b.assets.sample.channels[0]).not.toBe("corrupt");
});
