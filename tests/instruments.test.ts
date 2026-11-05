import { appendInstrumentNode } from "../src/instrumentNode";
import { describe, it, expect } from "vitest";
import {
  encodeSamples,
  makeLayer,
  parseProject,
  projectForSave,
  wrapProject,
  type Project,
  type SampleAsset,
} from "../src/model";
import { renderProject, encodeWav } from "../src/engine";
import {
  emptyScore,
  validateScore,
  selectRegion,
  renderScore,
  scoreIssues,
  importNoteEvents,
  type SampleRegion,
  type Score,
  type NoteEvent,
} from "../src/instruments";
const sr = 8000;
const asset = (id: string, amp = 0.3): SampleAsset => ({
  id,
  name: id,
  sampleRate: sr,
  channels: [
    encodeSamples(
      Float32Array.from(
        { length: sr / 2 },
        (_, i) => amp * Math.sin((i * 2 * Math.PI * 200) / sr),
      ),
    ),
  ],
});
const region = (patch: Partial<SampleRegion> = {}): SampleRegion => ({
  id: "region",
  assetId: "soft",
  rootMidi: 60,
  keyLow: 48,
  keyHigh: 72,
  velocityLow: 1,
  velocityHigh: 127,
  articulation: "sustain",
  roundRobin: 0,
  tuneCents: 0,
  gainDb: 0,
  releaseSeconds: 0.15,
  ...patch,
});
const note = (patch: Partial<NoteEvent> = {}): NoteEvent => ({
  id: "n1",
  instrumentId: "piano",
  midi: 60,
  start: 0,
  duration: 0.7,
  velocity: 80,
  articulation: "sustain",
  ...patch,
});
const score = (): Score => ({
  ...emptyScore(),
  bpm: 60,
  instruments: [
    { id: "piano", name: "Fixture, synthetic", regions: [region()] },
  ],
  notes: [note()],
});
const fixture = (): Project => ({
  schema: "momo.soundforge/v2",
  name: "Instrument fixture",
  seed: 123,
  duration: 1,
  master: 1,
  echo: 0,
  assets: { soft: asset("soft"), hard: asset("hard", 0.6) },
  layers: [
    makeLayer({
      id: "part",
      type: "instrument",
      score: score(),
      duration: 1,
      frequency: 440,
      endFrequency: 440,
      gain: 1,
      attack: 0,
      release: 0,
      decay: 0,
      cutoff: 22000,
    }),
  ],
});
const energy = (a: Float32Array, start: number, end: number) =>
  a
    .slice(Math.round(start * sr), Math.round(end * sr))
    .reduce((s, v) => s + v * v, 0);
it("selects actual velocity and articulation recordings, and rejects uncovered notes", () => {
  const i = score().instruments[0];
  i.regions = [
    region({ id: "soft", velocityHigh: 63 }),
    region({ id: "hard", assetId: "hard", velocityLow: 64 }),
    region({ id: "pluck", articulation: "pizzicato" }),
  ];
  const select = (n: Partial<NoteEvent>) =>
    selectRegion(i, note(n), 1, new Map())?.id;
  expect(select({ velocity: 30 })).toBe("soft");
  expect(select({ velocity: 100 })).toBe("hard");
  expect(select({ articulation: "pizzicato" })).toBe("pluck");
  expect(select({ midi: 90 })).toBeUndefined();
  expect(select({ articulation: "legato" })).toBeUndefined();
});
it("rotates equivalent recordings deterministically and independently of unrelated events", () => {
  const i = score().instruments[0];
  i.regions = [
    region({ id: "a", roundRobin: 1 }),
    region({ id: "b", roundRobin: 2 }),
  ];
  const sequence = () => {
    const c = new Map();
    return Array.from({ length: 6 }, () => selectRegion(i, note(), 42, c)?.id);
  };
  expect(sequence()).toEqual(sequence());
  expect(sequence()[0]).not.toBe(sequence()[1]);
  expect(sequence()[0]).toBe(sequence()[2]);
});
it("chooses nearest root in overlapping mapped ranges", () => {
  const i = score().instruments[0];
  i.regions = [region(), region({ id: "upper", rootMidi: 67, keyLow: 60 })];
  expect(selectRegion(i, note({ midi: 66 }), 0, new Map())?.id).toBe("upper");
});
it("keeps missing coverage silent with actionable notices", () => {
  const s = score();
  s.notes = [note({ midi: 90 })];
  const p = fixture();
  expect(scoreIssues(s, p.assets, 1)[0].key).toBe("score.noRegion");
  expect(energy(renderScore(s, p.assets, 1, sr, 1).left, 0, 1)).toBe(0);
});
it("does not invent sustain for unlooped recordings", () => {
  const p = fixture(),
    s = score();
  expect(
    scoreIssues(s, p.assets, 1).some((i) => i.key === "score.noSustain"),
  ).toBe(true);
  expect(energy(renderScore(s, p.assets, 1, sr, 1).left, 0.55, 0.65)).toBe(0);
});
it("sustains a loop across wraps and fades after note-off without a discontinuity", () => {
  const p = fixture(),
    s = score();
  s.instruments[0].regions[0].loop = {
    start: 400,
    end: 1200,
    crossfade: 40,
    verified: true,
  };
  validateScore(s, p.assets);
  const a = renderScore(s, p.assets, 1, sr, 1).left;
  expect(energy(a, 0.55, 0.65)).toBeGreaterThan(1);
  expect(energy(a, 0.71, 0.78)).toBeGreaterThan(0);
  expect(energy(a, 0.86, 0.95)).toBe(0);
  let max = 0;
  for (let i = 100; i < a.length; i++)
    max = Math.max(max, Math.abs(a[i] - a[i - 1]));
  expect(max).toBeLessThan(0.08);
});
it("plays a recorded release sample at note-off only", () => {
  const p = fixture(),
    s = score();
  p.assets.release = {
    ...asset("release"),
    channels: [encodeSamples(new Float32Array(4000).fill(0.1))],
  };
  s.notes = [note({ duration: 0.1 })];
  s.instruments[0].regions[0].releaseAssetId = "release";
  const a = renderScore(s, p.assets, 1, sr, 1).left;
  expect(energy(a, 0.15, 0.2)).toBeGreaterThan(0);
  expect(energy(a, 0.26, 0.4)).toBe(0);
  const noRelease = structuredClone(s);
  delete noRelease.instruments[0].regions[0].releaseAssetId;
  expect(a).not.toEqual(renderScore(noRelease, p.assets, 1, sr, 1).left);
});
it("roundtrips portable assets and renders identically through nested project, save and export", () => {
  const p = fixture();
  p.assets.unused = asset("unused");
  const saved = projectForSave(p),
    reopened = parseProject(JSON.parse(JSON.stringify(saved)));
  expect(reopened.assets.soft).toBeDefined();
  expect(reopened.assets.unused).toBeUndefined();
  const a = renderProject(p, sr),
    b = renderProject(reopened, sr);
  expect(a.left).toEqual(b.left);
  expect(encodeWav(a)).toEqual(encodeWav(b));
  const nested = wrapProject(reopened);
  expect(
    parseProject(nested).layers[0].project?.layers[0].score?.notes,
  ).toEqual(p.layers[0].score!.notes);
});
it("converts melody-design seconds explicitly to beats", () => {
  const s = score();
  s.bpm = 120;
  const next = importNoteEvents(
    {
      format: "melody-design/recipe-v1",
      notes: [
        { midi: 60, startSeconds: 0.25, durationSeconds: 0.5, velocity: 70 },
      ],
    },
    s,
    "piano",
    "sustain",
  );
  validateScore(next, fixture().assets);
  expect(next.notes[0]).toMatchObject({ start: 0.5, duration: 1 });
});
describe("rejects unsafe scores", () => {
  for (const [name, mutate] of Object.entries({
    "bad BPM": (s: Score): unknown => (s.bpm = 0),
    "bad pitch": (s: Score): unknown => (s.notes[0].midi = 128),
    "negative duration": (s: Score): unknown => (s.notes[0].duration = -1),
    "NaN velocity": (s: Score): unknown => (s.notes[0].velocity = NaN),
    "out of window": (s: Score): unknown => (s.notes[0].start = 11),
    "reversed range": (s: Score): unknown =>
      (s.instruments[0].regions[0].velocityLow = 128),
    "missing asset": (s: Score): unknown =>
      (s.instruments[0].regions[0].assetId = "absent"),
    "loop outside asset": (s: Score): unknown =>
      (s.instruments[0].regions[0].loop = {
        start: 0,
        end: 10000,
        crossfade: 20,
        verified: true,
      }),
    "loop too short": (s: Score): unknown =>
      (s.instruments[0].regions[0].loop = {
        start: 0,
        end: 20,
        crossfade: 20,
        verified: true,
      }),
    "no crossfade": (s: Score): unknown =>
      (s.instruments[0].regions[0].loop = {
        start: 0,
        end: 1000,
        crossfade: 0,
        verified: true,
      }),
    "duplicate note": (s: Score): unknown => s.notes.push(s.notes[0]),
    "excess notes": (s: Score): unknown =>
      (s.notes = Array.from({ length: 257 }, (_, i) =>
        note({ id: String(i) }),
      )),
  }))
    it(name, () => {
      const p = fixture();
      mutate(p.layers[0].score!);
      expect(() => parseProject(p)).toThrow();
    });
});
it("bounds total notes across nested projects", () => {
  let p = fixture();
  p.layers[0].score!.notes = Array.from({ length: 256 }, (_, i) =>
    note({ id: String(i), duration: 0.005 }),
  );
  const child = projectForSave(p);
  p.layers = Array.from({ length: 5 }, (_, i) =>
    makeLayer({ id: String(i), type: "composition", project: child }),
  );
  expect(() => parseProject(p)).toThrow();
});
it("handles source-rate conversion and multiple loop crossings per output frame", () => {
  const p = fixture(),
    s = score();
  s.notes = [note({ midi: 127, duration: 0.1 })];
  const r = s.instruments[0].regions[0];
  r.rootMidi = 0;
  r.keyLow = 0;
  r.keyHigh = 127;
  r.loop = { start: 10, end: 42, crossfade: 16, verified: true };
  validateScore(s, p.assets);
  const a = renderScore(s, p.assets, 0.3, sr, 0).left;
  expect([...a].every(Number.isFinite)).toBe(true);
  expect(energy(a, 0.02, 0.09)).toBeGreaterThan(0);
  expect(energy(a, 0.26, 0.29)).toBe(0);
});
it("reorders notes without changing seeded selection or audio", () => {
  const p = fixture(),
    s = score();
  s.notes = [
    note({ id: "a", start: 0.1, duration: 0.1 }),
    note({ id: "b", start: 0.3, duration: 0.1 }),
  ];
  s.instruments[0].regions.push(
    region({ id: "other", assetId: "hard", roundRobin: 1 }),
  );
  const a = renderScore(s, p.assets, 1, sr, 12);
  s.notes.reverse();
  expect(renderScore(s, p.assets, 1, sr, 12)).toEqual(a);
});
it("preserves stereo and pitch-shifts a root recording by an octave", () => {
  const p = fixture(),
    s = score();
  p.assets.soft.channels.push(encodeSamples(new Float32Array(4000)));
  s.notes = [note({ midi: 72, duration: 0.1 })];
  const a = renderScore(s, p.assets, 1, sr, 0);
  expect(energy(a.right, 0, 1)).toBe(0);
  let crossings = 0;
  for (let i = 80; i < 720; i++)
    if (a.left[i] <= 0 && a.left[i + 1] > 0) crossings++;
  expect(crossings).toBeGreaterThanOrEqual(31);
  expect(crossings).toBeLessThanOrEqual(33);
});
it("preserves recorded release assets during save and reopens them", () => {
  const p = fixture();
  p.layers[0].score!.instruments[0].regions[0].releaseAssetId = "hard";
  expect(parseProject(projectForSave(p)).assets.hard).toBeDefined();
});
it("does not flag nonexistent tails of short unlooped recordings", () => {
  const p = fixture(),
    s = score();
  s.notes = [note({ duration: 0.1 })];
  s.instruments[0].regions[0].releaseSeconds = 3;
  expect(
    scoreIssues(s, p.assets, 1).some((i) => i.key === "score.tailClipped"),
  ).toBe(false);
});
it("rejects reversed loops, missing release assets, unknown schema and excess instruments", () => {
  for (const change of [
    (s: Score): unknown =>
      (s.instruments[0].regions[0].loop = {
        start: 200,
        end: 100,
        crossfade: 16,
        verified: true,
      }),
    (s: Score): unknown =>
      (s.instruments[0].regions[0].releaseAssetId = "missing"),
    (s: Score): unknown => Object.assign(s, { schema: "unknown" }),
    (s: Score): unknown =>
      (s.instruments = Array.from({ length: 9 }, (_, i) => ({
        ...s.instruments[0],
        id: String(i),
      }))),
  ]) {
    const p = fixture();
    change(p.layers[0].score!);
    expect(() => parseProject(p)).toThrow();
  }
});

it("inserts library instruments as independent leaves with portable assets", () => {
  const source = fixture();
  source.layers[0].score!.instruments[0].regions[0].releaseAssetId = "hard";
  const snapshot = structuredClone(source);
  const parent = { ...fixture(), layers: [] };
  const first = appendInstrumentNode(parent, source, "first");
  const second = appendInstrumentNode(first, source, "second");
  expect(second.layers.map(l => l.type)).toEqual(["instrument", "instrument"]);
  const a = second.layers[0].score!.instruments[0].regions[0];
  const b = second.layers[1].score!.instruments[0].regions[0];
  expect(a.assetId).not.toBe(b.assetId);
  expect(a.releaseAssetId).not.toBe(b.releaseAssetId);
  expect(second.assets.soft).toEqual(parent.assets.soft);
  expect(source).toEqual(snapshot);
  const portable = parseProject(projectForSave(first));
  expect(renderProject(portable, sr).left).toEqual(renderProject(source, sr).left);
  second.layers[1].score!.notes[0].midi = 65;
  expect(second.layers[0].score!.notes[0].midi).toBe(60);
});
