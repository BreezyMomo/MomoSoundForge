import { sealResource } from '../src/resourceGraph';
import { resourceFromProject } from '../src/soundResources';
import { cacheAudio } from '../src/sharedAudio';
import { createSamplePreparer } from '../src/prepareSamples';
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  BUILTIN_SOUNDS,
  builtinSoundName,
  builtinSoundDescription,
  builtinToneKey,
  builtinToneName,
  builtinChoiceName,
  createBuiltinLoader,
  type BuiltinSound,
} from "../src/builtinLibrary";
import { catalogs } from "../src/i18n";
import { SOUND_CATEGORIES } from "../src/libraryPreferences";
import {
  encodeSamples,
  makeLayer,
  parseProject,
  projectForSave,
  type Project,
} from "../src/model";
import { selectRegion, scoreIssues } from "../src/instruments";
import { appendInstrumentNode } from "../src/instrumentNode";
import { renderProject } from "../src/engine";

const fixture = (): Project => ({
  schema: "momo.soundforge/v4",
  name: "Factory piano",
  seed: 2048,
  duration: 0.1,
  master: 1,
  echo: 0,
  inputs: [
    makeLayer({
      id: "note",
      type: "sample",
      assetId: "sample",
      frequency: 440,
      duration: 0.1,
      attack: 0,
      release: 0.01,
      decay: 0,
    }),
  ],
  assets: {
    sample: {
      id: "sample",
      name: "piano.wav",
      sampleRate: 8000,
      channels: [
        encodeSamples(
          Float32Array.from({ length: 800 }, (_, i) => Math.sin(i * 0.2) * 0.3),
        ),
      ],
    },
  },
});
async function resource(raw: unknown = fixture()) {
  if ((raw as Project).schema === "momo.soundforge/v4") raw=await sealResource(resourceFromProject(raw as Project),async(ref,bytes)=>cacheAudio(ref.audioId,bytes));
  const json = Buffer.from(JSON.stringify(raw)),
    bytes = gzipSync(json);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sound: BuiltinSound = {
    ...BUILTIN_SOUNDS[0],
    id: "fixture",
    sha256,
    file: `${sha256}.soundforge.bin`,
    compressedBytes: bytes.length,
    projectBytes: json.length,
  };
  return {
    bytes,
    sound,
    response: () => new Response(Uint8Array.from(bytes).buffer),
  };
}

it("indexes all collected samples and examples with matching categories, semantic names and final-render thumbnails", () => {
  expect(new Set(BUILTIN_SOUNDS.map((x) => x.id)).size).toBe(
    BUILTIN_SOUNDS.length,
  );
  expect(
    BUILTIN_SOUNDS.filter((x) => x.kind === "instrument" && !x.tone && !x.completeInstrument),
  ).toHaveLength(34);
  for (const [id, recordings] of Object.entries({
    "instrument-vsco-solo-violin": 90,
    "instrument-vsco-clarinet": 97,
    "instrument-vsco-trombone": 86,
  })) {
    const instrument = BUILTIN_SOUNDS.find((sound) => sound.id === id);
    expect(instrument?.completeInstrument, id).toBe(true);
    expect(instrument?.recordingIds, id).toHaveLength(recordings);
  }
  expect(BUILTIN_SOUNDS.filter((x) => x.kind === "sample")).toHaveLength(126);
  expect(BUILTIN_SOUNDS.filter((x) => x.kind === "example")).toHaveLength(30);
  for (const sound of BUILTIN_SOUNDS) {
    expect(SOUND_CATEGORIES).toContain(sound.category);
    expect(sound.duration).toBeGreaterThanOrEqual(0.1);
    expect(Number.isFinite(sound.duration)).toBe(true);
    expect(sound.waveform).toHaveLength(160);
    expect(
      sound.waveform.every((x) => Number.isFinite(x) && Math.abs(x) <= 1),
    ).toBe(true);
    expect(sound.file).toBe(`${sound.sha256}.soundforge.bin`);
    expect(catalogs["zh-CN"]).toHaveProperty(sound.nameKey);
    expect(catalogs.en).toHaveProperty(sound.nameKey);
  }
});

it("makes every usable expanded recording available in articulation/range choices", () => {
  const manifest = JSON.parse(
    readFileSync("samples/orchestra-expanded-20261105/manifest.json", "utf8"),
  );
  const tones = BUILTIN_SOUNDS.filter((s) => s.tone);
  const expected = new Set(
    manifest.samples.filter((s: {instrumentId:string}) => s.instrumentId !== "upright-piano").map((s: { sourcePath: string }) =>
      createHash("sha256").update(s.sourcePath).digest("hex"),
    ),
  );
  expect(new Set(tones.flatMap((s) => s.recordingIds ?? []))).toEqual(expected);
  expect(expected.size).toBe(603);
  expect(new Set(tones.map(builtinToneKey)).size).toBe(19);
  for (const tone of tones) {
    expect(builtinToneName(tone, (key) => catalogs.en[key])).not.toContain(
      "undefined",
    );
    expect(builtinChoiceName(tone)).toContain("–");
    expect(tone.keyLow).toBeLessThanOrEqual(tone.keyHigh!);
  }
});

it("organizes old and new effects by action while retaining every selectable recording", () => {
  const effects = BUILTIN_SOUNDS.filter((s) => s.kind === "sample");
  const starter = JSON.parse(
    readFileSync("samples/cc0-starter-20261104/manifest.json", "utf8"),
  );
  const legacy = effects.filter((s) => s.id.startsWith("fx-"));
  expect(new Set(legacy.map((s) => s.id))).toEqual(
    new Set(starter.samples.map((s: { id: string }) => `fx-${s.id}`)),
  );
  expect(new Set(effects.map(builtinToneKey)).size).toBe(52);
  for (const [key, count] of Object.entries({
    cloth: 4,
    paper: 2,
    swish: 2,
    bubble: 3,
    slime: 4,
    splash: 3,
    bell: 2,
    camera: 2,
    "lock-door": 2,
  })) {
    const choices = legacy.filter((s) => builtinToneKey(s) === `fx-${key}`);
    expect(choices, key).toHaveLength(count);
    expect(new Set(choices.map((s) => s.nameKey)).size).toBe(1);
    expect(new Set(choices.map((s) => s.category)).size).toBe(1);
    expect(choices.map((s) => s.recording)).toEqual(
      Array.from({ length: count }, (_, i) => i + 1),
    );
    expect(new Set(choices.map((s) => builtinChoiceName(s))).size).toBe(count);
  }
  for (const sound of effects) {
    for (const language of ["zh-CN", "en"] as const)
      expect(
        builtinToneName(sound, (key) => catalogs[language][key]),
      ).not.toMatch(/\s\d+$/);
  }
  const keys = (ids: string[]) =>
    new Set(ids.map((id) => builtinToneKey(effects.find((s) => s.id === id)!)));
  expect(
    keys(["fx-15-paper-crush", "fx-16-paper-rip", "fx-17-paper-01"]).size,
  ).toBe(3);
  expect(
    keys(["fx-01-wood-light", "fx-02-wood-medium", "game-wood-heavy-01"]).size,
  ).toBe(3);
  expect(keys(["game-door-open-01", "game-door-close-01"]).size).toBe(2);
});

it("uses translated built-in labels while names of opened independent projects remain document data", async () => {
  const { sound, response } = await resource();
  const fetcher = vi.fn(async () => response());
  const load = createBuiltinLoader([sound], fetcher, "/nested/");
  expect(fetcher).not.toHaveBeenCalled();
  const opened = await load(sound.id, "我的钢琴");
  opened.inputs[0].gain = 0;
  opened.assets.sample.name = "changed.wav";
  const pristine = await load(sound.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(`/nested/sound-library/${sound.file}`);
  expect(pristine.name).toBe("Factory piano");
  expect(pristine.assets.sample.name).toBe("piano.wav");
  expect(pristine.inputs[0].gain).not.toBe(0);
  expect(renderProject(await createSamplePreparer()(pristine)).left).toEqual(renderProject(fixture()).left);
  expect(opened.name).toBe("我的钢琴");
  const instrument = BUILTIN_SOUNDS.find((x) => x.kind === "instrument")!;
  const translate = (key: string, ...args: unknown[]) =>
    `${key}:${args.join("|")}`;
  expect(builtinSoundName(instrument, translate)).toContain(
    "builtin.instrumentVariant",
  );
  expect(builtinSoundDescription(instrument, translate)).toContain(
    "builtin.instrumentDetails",
  );
});

it("rejects unknown identities and paths before making a request", async () => {
  const { sound, response } = await resource();
  const fetcher = vi.fn(async () => response());
  await expect(
    createBuiltinLoader([sound], fetcher)("missing"),
  ).rejects.toThrow("library.builtinLoadError");
  await expect(
    createBuiltinLoader(
      [{ ...sound, file: "../private.json" }],
      fetcher,
    )(sound.id),
  ).rejects.toThrow("library.builtinLoadError");
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not cache failures and supports retry after a missing deployment resource", async () => {
  const { sound, response } = await resource();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("missing", { status: 404 }))
    .mockImplementation(async () => response());
  const load = createBuiltinLoader([sound], fetcher);
  await expect(load(sound.id)).rejects.toThrow("library.builtinLoadError");
  expect((await load(sound.id)).inputs[0].player.assetId).toBe("sample");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("bounds compressed and expanded data and validates the decoded project schema", async () => {
  const { sound, response } = await resource();
  await expect(
    createBuiltinLoader(
      [{ ...sound, compressedBytes: sound.compressedBytes - 1 }],
      async () => response(),
    )(sound.id),
  ).rejects.toThrow("library.builtinLoadError");
  await expect(
    createBuiltinLoader([{ ...sound, projectBytes: 16 }], async () =>
      response(),
    )(sound.id),
  ).rejects.toThrow("library.builtinLoadError");
  const invalid = await resource({ ...fixture(), schema: "future-version" });
  await expect(
    createBuiltinLoader([invalid.sound], async () => invalid.response())(
      invalid.sound.id,
    ),
  ).rejects.toThrow("library.builtinLoadError");
});

it("deduplicates concurrent downloads without sharing mutable project state", async () => {
  const { sound, response } = await resource();
  const fetcher = vi.fn(async () => response());
  const load = createBuiltinLoader([sound], fetcher);
  const [a, b] = await Promise.all([load(sound.id), load(sound.id)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  a.assets.sample.channels[0] = "corrupt";
  expect(b.assets.sample.channels[0]).not.toBe("corrupt");
});
