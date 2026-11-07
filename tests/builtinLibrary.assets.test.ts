import { projectFromGraph } from './helpers/resourceGraph';
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
function resource(raw: unknown = fixture()) {
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

it("ships audible defaults for timpani, harp and low flute", async () => {
  for (const id of [
    "instrument-17-timpani-2-Cs3-single-hit",
    "instrument-06-harp-1-C3-single-hit",
    "tone-flute-sustain-60-70",
  ]) {
    const sound = BUILTIN_SOUNDS.find((s) => s.id === id)!;
    const project = await createSamplePreparer(async url => new Response(readFileSync(`public${url}`)), '/')(await projectFromGraph(JSON.parse(
        gunzipSync(
          readFileSync(`public/sound-library/${sound.file}`),
        ).toString(),
      )));
    const rendered = renderProject(project);
    expect(rendered.peak, id).toBeGreaterThan(0.03);
    expect(rendered.sourcePeak, id).toBeLessThan(1);
    const template = fixture();
    template.inputs = [];
    template.assets = {};
    const inserted = parseProject(
      appendInstrumentNode(template, project, "checked-instrument"),
    );
    // Calibration also survives adding the instrument to a user project.
    expect(renderProject(inserted).peak, id).toBeCloseTo(rendered.peak, 5);
  }
}, 20000);

it("can add and reopen every single-instrument example, including boosted piano", async () => {
  const checked: string[] = [];
  for (const sound of BUILTIN_SOUNDS.filter((s) => s.kind === "example")) {
    const raw = await projectFromGraph(JSON.parse(gunzipSync(
      readFileSync(`public/sound-library/${sound.file}`)).toString()));
    if (raw.inputs.length !== 1 || raw.inputs[0].player.type !== "instrument") continue;
    const project = parseProject(raw);
    const parent = { ...fixture(), inputs: [], assets: {} };
    const added = appendInstrumentNode(parent, project, "example");
    expect(() => parseProject(projectForSave(added)), sound.id).not.toThrow();
    checked.push(sound.id);
  }
  expect(checked).toContain("example-expanded-piano");
}, 20000);

it("inserts a complete piano and a range as independent editable instruments and reopens portably", async () => {
  const read = async (id: string) => {
    const sound = BUILTIN_SOUNDS.find(
      (s) => (s.tone || s.completeInstrument) && s.nameKey === id && s.keyLow! <= 60 && s.keyHigh! >= 60,
    )!;
    return await projectFromGraph(JSON.parse(
        gunzipSync(
          readFileSync(`public/sound-library/${sound.file}`),
        ).toString(),
      ));
  };
  const piano = await read("builtin.instrument.vcsl-kawai"),
    flute = await read("builtin.instrument.flute");
  const instrument = piano.inputs[0].player.score!.instruments[0];
  const note = piano.inputs[0].player.score!.notes[0];
  const soft = selectRegion(
    instrument,
    { ...note, velocity: 35 },
    piano.seed,
    new Map(),
  );
  const loud = selectRegion(
    instrument,
    { ...note, velocity: 115 },
    piano.seed,
    new Map(),
  );
  expect(soft).toBeTruthy();
  expect(loud).toBeTruthy();
  expect(soft!.assetId).not.toBe(loud!.assetId);
  const prepare = createSamplePreparer(async url => new Response(readFileSync(`public${url}`)), "/");
  const appended = await prepare(parseProject(appendInstrumentNode(piano, flute, "added-flute")));
  expect(appended.inputs).toHaveLength(2);
  const reopened = parseProject(
    JSON.parse(JSON.stringify(projectForSave(appended))),
  );
  expect(renderProject(reopened).left).toEqual(renderProject(appended).left);
  expect(renderProject(reopened).peak).toBeGreaterThan(0);
}, 20000);

it("ships the original mapped regions in every range without including quarantined takes", async () => {
  const manifest = JSON.parse(
    readFileSync("samples/orchestra-expanded-20261105/manifest.json", "utf8"),
  );
  const sources = new Map<
    string,
    {
      rootMidi: number;
      keyLow: number;
      keyHigh: number;
      velocityLow: number;
      velocityHigh: number;
    }
  >(manifest.samples.filter((s: {instrumentId:string}) => s.instrumentId !== "upright-piano").map((s: { id: string }) => [s.id, s]));
  const shipped = new Set<string>();
  for (const tone of BUILTIN_SOUNDS.filter((s) => s.tone)) {
    const project: Project = await projectFromGraph(JSON.parse(
      gunzipSync(readFileSync(`public/sound-library/${tone.file}`)).toString(),
    ));
    const bytes = Object.values(project.assets).reduce(
      (n, a) =>
        n +
        a.channels.reduce((sum, c) => sum + Buffer.from(c, "base64").length, 0),
      0,
    );
    expect(bytes).toBeLessThanOrEqual(10 * 1024 * 1024);
    const score = project.inputs[0].player.score!;
    expect(
      scoreIssues(score, project.assets, project.duration, project.seed),
      tone.id,
    ).toEqual([]);
    for (const region of score.instruments[0].regions) {
      const originalId = region.id.replace(/-velocity-\d+-\d+$/, "");
      const source = sources.get(originalId);
      expect(source).toBeTruthy();
      expect(region).toMatchObject({
        rootMidi: source!.rootMidi,
        keyLow: source!.keyLow,
        keyHigh: source!.keyHigh,
      });
      const fragments = score.instruments[0].regions.filter(r => r.id.replace(/-velocity-\d+-\d+$/, "") === originalId)
        .sort((a, b) => a.velocityLow - b.velocityLow);
      expect(fragments[0].velocityLow).toBe(Math.max(1, source!.velocityLow));
      expect(fragments.at(-1)!.velocityHigh).toBe(source!.velocityHigh);
      fragments.slice(1).forEach((r, i) => expect(r.velocityLow).toBe(fragments[i].velocityHigh + 1));
      expect(region.loop).toBeUndefined();
      shipped.add(originalId);
    }
  }
  expect(shipped).toEqual(new Set(sources.keys()));
}, 60000);
