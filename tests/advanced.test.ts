import { describe, it, expect } from "vitest";
import {
  makeLayer,
  parseProject,
  projectForSave,
  wrapProject,
  createLayerPreviewProject,
  type Project,
} from "../src/model";
import { renderProject } from "../src/engine";
import {
  resolveControls,
  validateAdvanced,
  reconcileAdvanced,
  curveValue,
  DEFAULT_EFFECTS,
  type Macro,
} from "../src/advanced";
import {
  audioResult,
  makeLoop,
  prepareExport,
  exportWav,
  DEFAULT_EXPORT,
  parseExportSettings,
  seamPreview,
} from "../src/exportAudio";
import { boundedSelection, snapTime } from "../src/timeline";
const fixture = (): Project => ({
  schema: "momo.soundforge/v2",
  name: "test",
  seed: 1,
  duration: 1,
  master: 0.5,
  echo: 0,
  assets: {},
  layers: [
    makeLayer({
      id: "a",
      duration: 0.5,
      start: 0.1,
      frequency: 220,
      endFrequency: 220,
      attack: 0,
      release: 0,
      decay: 0,
      gain: 0.4,
    }),
  ],
});
const macro = (): Macro => ({
  id: "m",
  name: "Power",
  min: 0,
  max: 100,
  defaultValue: 50,
  mappings: [{ layerId: "a", parameter: "gain", low: 0, high: 1 }],
});
describe("composition controls", () => {
  it("maps linear, reversed and logarithmic targets without mutating the source", () => {
    const p = fixture();
    p.controls = [
      {
        ...macro(),
        mappings: [
          { layerId: "a", parameter: "gain", low: 1, high: 0 },
          {
            layerId: "a",
            parameter: "frequency",
            low: 100,
            high: 10000,
            logarithmic: true,
          },
        ],
      },
    ];
    const resolved = resolveControls(p);
    expect(resolved.layers[0].gain).toBe(0.5);
    expect(resolved.layers[0].frequency).toBe(1000);
    expect(p.layers[0].gain).toBe(0.4);
  });
  it("preserves nested defaults and independent instance overrides across save/load", () => {
    const child = fixture();
    child.controls = [macro()];
    child.controlValues = { m: 80 };
    const p = fixture();
    p.layers = [
      makeLayer({
        id: "child1",
        type: "composition",
        project: child,
        controlValues: { m: 10 },
      }),
      makeLayer({
        id: "child2",
        type: "composition",
        project: child,
        controlValues: { m: 90 },
      }),
    ];
    p.controls = [
      {
        ...macro(),
        mappings: [
          {
            layerId: "child1",
            parameter: "control",
            controlId: "m",
            low: 0,
            high: 100,
          },
        ],
      },
    ];
    const saved = parseProject(projectForSave(p));
    expect(resolveControls(saved).layers[0].controlValues?.m).toBe(50);
    expect(saved.layers[1].controlValues?.m).toBe(90);
    expect(resolveControls(child, {}).layers[0].gain).toBe(0.8);
    expect(renderProject(saved, 4000).left).toEqual(
      renderProject(saved, 4000).left,
    );
  });
  it("moves effects and controls inside a new composition exactly once", () => {
    const p = fixture();
    p.controls = [macro()];
    p.effects = { ...DEFAULT_EFFECTS, delayWet: 0.4 };
    const wrapped = wrapProject(p);
    expect(wrapped.effects).toBeUndefined();
    expect(wrapped.controls).toBeUndefined();
    expect(wrapped.layers[0].project?.effects).toEqual(p.effects);
    expect(() => parseProject(projectForSave(wrapped))).not.toThrow();
    const a = renderProject(p, 4000),
      b = renderProject(wrapped, 4000);
    for (let i = 64; i < a.left.length - 64; i++)
      expect(b.left[i]).toBeCloseTo(a.left[i], 4);
  });
  it("auditions a controlled delayed layer from zero using the effective values", () => {
    const p = fixture();
    p.controls = [
      {
        ...macro(),
        mappings: [
          { layerId: "a", parameter: "start", low: 0.5, high: 0.9 },
          { layerId: "a", parameter: "gain", low: 0, high: 1 },
        ],
      },
    ];
    const preview = createLayerPreviewProject(p, "a");
    expect(preview.layers[0].start).toBe(0);
    expect(preview.layers[0].gain).toBe(0.5);
    expect(preview.controls).toBeUndefined();
  });
  it("rejects duplicate drivers, unknown targets, invalid ranges and macro/curve conflicts", () => {
    for (const change of [
      (p: Project) => p.controls!.push({ ...macro(), id: "other" }),
      (p: Project) => (p.controls![0].mappings[0].layerId = "missing"),
      (p: Project) => (p.controls![0].min = 100),
      (p: Project) =>
        (p.layers[0].automation = { gain: [{ time: 0, value: 0.1 }] }),
    ]) {
      const p = fixture();
      p.controls = [macro()];
      change(p);
      expect(() => parseProject(p)).toThrow();
    }
  });
  it("removes obsolete references and clamps parent bindings when editing child controls", () => {
    const child = fixture();
    child.controls = [macro()];
    const p = fixture();
    p.layers = [
      makeLayer({
        id: "child",
        type: "composition",
        project: child,
        controlValues: { m: 90 },
      }),
    ];
    p.controls = [
      {
        ...macro(),
        mappings: [
          {
            layerId: "child",
            parameter: "control",
            controlId: "m",
            low: 0,
            high: 100,
          },
        ],
      },
    ];
    child.controls[0].max = 60;
    const repaired = reconcileAdvanced(p);
    expect(repaired.layers[0].controlValues?.m).toBe(60);
    expect(repaired.controls![0].mappings[0].high).toBe(60);
    child.controls = [];
    expect(reconcileAdvanced(p).controls![0].mappings).toEqual([]);
    expect(() => parseProject(projectForSave(repaired))).not.toThrow();
  });
});
it("rejects prototype-name control IDs in imported projects", () => {
  for (const id of ["__proto__", "toString", "constructor"]) {
    const p = fixture();
    p.controls = [{ ...macro(), id }];
    expect(() => parseProject(p)).toThrow();
  }
});
describe("automation and processing", () => {
  it("interpolates curves and holds endpoints", () => {
    expect(
      curveValue(
        [
          { time: 0.2, value: 0 },
          { time: 0.8, value: 1 },
        ],
        0.5,
        3,
      ),
    ).toBeCloseTo(0.5);
    expect(curveValue([{ time: 0.2, value: 2 }], 0, 3)).toBe(2);
    expect(
      curveValue(
        [
          { time: 0, value: 100 },
          { time: 1, value: 10000 },
        ],
        0.5,
        3,
        true,
      ),
    ).toBe(1000);
  });
  it("renders stereo pan and gain curves deterministically, and preserves full previews through crop", () => {
    const p = fixture();
    p.layers[0].automation = {
      gain: [
        { time: 0, value: 0 },
        { time: 1, value: 1 },
      ],
      pan: [
        { time: 0, value: -1 },
        { time: 1, value: 1 },
      ],
      cutoff: [
        { time: 0, value: 100 },
        { time: 1, value: 2000 },
      ],
    };
    const before = renderProject(p, 4000);
    expect(before.left).toEqual(renderProject(p, 4000).left);
    expect(before.left).not.toEqual(before.right);
    p.layers[0].cropStart = 0.5;
    const cropped = renderProject(p, 4000);
    expect(cropped.layers.a).toEqual(before.layers.a);
    expect(cropped.left.slice(0, 1400).every((x) => x === 0)).toBe(true);
    expect(() => parseProject(projectForSave(p))).not.toThrow();
  });
  it("keeps delay and reverb tails and respects limiter ceiling", () => {
    const p = fixture();
    p.layers[0].duration = 0.1;
    p.effects = {
      ...DEFAULT_EFFECTS,
      delayTime: 0.2,
      delayWet: 1,
      delayFeedback: 0.6,
      reverb: 0.5,
      low: 6,
      mid: -3,
      high: 2,
      ceiling: -6,
    };
    const dry = renderProject({ ...p, effects: undefined }, 4000),
      wet = renderProject(p, 4000);
    expect(dry.left.slice(1200).every((x) => x === 0)).toBe(true);
    expect(wet.left.slice(1200).some((x) => Math.abs(x) > 0.001)).toBe(true);
    expect(wet.peak).toBeLessThanOrEqual(10 ** (-6 / 20) + 1e-6);
    expect(wet.left.every(Number.isFinite)).toBe(true);
  });
  it("rejects malformed curves, invalid processing and loop regions", () => {
    for (const patch of [
      {
        automation: {
          gain: [
            { time: 0.5, value: 0 },
            { time: 0.5, value: 1 },
          ],
        },
      },
      { automation: { pan: [{ time: 0, value: 2 }] } },
      { automation: { cutoff: [{ time: NaN, value: 400 }] } },
    ]) {
      const p = fixture();
      Object.assign(p.layers[0], patch);
      expect(() => parseProject(p)).toThrow();
    }
    expect(() =>
      validateAdvanced({
        ...fixture(),
        effects: { ...DEFAULT_EFFECTS, delayFeedback: 1 },
      }),
    ).toThrow();
    expect(() =>
      validateAdvanced({
        ...fixture(),
        loopRegion: { start: 0, end: 2, crossfade: 0 },
      }),
    ).toThrow();
  });
});
describe("loop and export", () => {
  const input = () =>
    audioResult(
      Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.02) * 0.2),
      Float32Array.from({ length: 1000 }, (_, i) => Math.cos(i * 0.02) * 0.1),
      1000,
    );
  it("crossfades the seam, shortens overlap once and previews the actual output seam", () => {
    const result = input(),
      loop = makeLoop(result, { start: 0.1, end: 0.9, crossfade: 0.1 });
    expect(loop.left.length).toBe(700);
    expect(loop.left[0]).toBe(result.left[800]);
    expect(loop.left[99]).toBe(result.left[199]);
    expect(loop.left[100]).toBe(result.left[200]);
    expect(loop.left[699]).toBe(result.left[799]);
    expect(seamPreview(loop).left[249]).toBe(loop.left[699]);
    expect(seamPreview(loop).left[250]).toBe(loop.left[0]);
  });
  it("validates locally stored export preferences", () => {
    expect(parseExportSettings(null)).toEqual(DEFAULT_EXPORT);
    expect(
      parseExportSettings({
        sampleRate: 1,
        tail: Infinity,
        targetRms: NaN,
        mono: "yes",
      }),
    ).toEqual(DEFAULT_EXPORT);
    expect(
      parseExportSettings({ ...DEFAULT_EXPORT, sampleRate: 22050, mono: true }),
    ).toMatchObject({ sampleRate: 22050, mono: true });
  });
  it("writes correct PCM16 mono and stereo WAV rates, sizes and samples", () => {
    for (const mono of [true, false]) {
      const output = prepareExport(input(), {
        ...DEFAULT_EXPORT,
        sampleRate: 22050,
        mono,
      });
      const wav = exportWav(output, mono),
        v = new DataView(wav);
      expect(v.getUint16(22, true)).toBe(mono ? 1 : 2);
      expect(v.getUint32(24, true)).toBe(22050);
      expect(wav.byteLength).toBe(44 + 22050 * (mono ? 2 : 4));
      if (mono) expect(output.left).toEqual(output.right);
    }
  });
  it("suppresses above-Nyquist energy when downsampling", () => {
    const tone = (hz: number) => {
      const x = Float32Array.from(
        { length: 4800 },
        (_, i) => 0.3 * Math.sin((2 * Math.PI * hz * i) / 48000),
      );
      return prepareExport(audioResult(x, x, 48000), {
        ...DEFAULT_EXPORT,
        sampleRate: 22050,
      }).rms;
    };
    expect(tone(16000)).toBeLessThan(tone(1000) * 0.04);
  });
  it("trims silence and normalizes RMS without exceeding peak protection", () => {
    const l = new Float32Array(1000);
    l.fill(0.1, 100, 800);
    const output = prepareExport(audioResult(l, l, 1000), {
      ...DEFAULT_EXPORT,
      sampleRate: 22050,
      trimSilence: true,
      normalize: true,
      targetRms: -12,
    });
    expect(output.left.length).toBe(15435);
    expect(20 * Math.log10(output.rms)).toBeCloseTo(-12, 3);
    const spiky = new Float32Array(1000);
    spiky[500] = 1;
    const limited = prepareExport(audioResult(spiky, spiky, 1000), {
      ...DEFAULT_EXPORT,
      sampleRate: 22050,
      normalize: true,
      targetRms: -6,
    });
    expect(limited.peak).toBeLessThanOrEqual(0.980001);
    expect(limited.gainReduction).toBeLessThan(1);
  });
  it("keeps loop-region silence despite trim preference and handles complete silence", () => {
    const z = new Float32Array(1000),
      r = audioResult(z, z, 1000);
    expect(
      prepareExport(
        r,
        {
          ...DEFAULT_EXPORT,
          loopOnly: true,
          trimSilence: true,
          sampleRate: 22050,
        },
        { start: 0.1, end: 0.9, crossfade: 0.1 },
      ).left.length,
    ).toBe(15435);
    expect(
      prepareExport(r, {
        ...DEFAULT_EXPORT,
        trimSilence: true,
        normalize: true,
      }).left.every((x) => x === 0),
    ).toBe(true);
  });
});
describe("multi-layer timeline", () => {
  const layers = () => [
    makeLayer({
      id: "a",
      start: 0.1,
      duration: 0.2,
      cropStart: 0.1,
      cropEnd: 0.9,
    }),
    makeLayer({ id: "b", start: 0.4, duration: 0.1 }),
  ];
  it("moves, scales from the active edge, and preserves non-destructive crops", () => {
    const ls = layers(),
      moved = boundedSelection(ls, ["a", "b"], ls[0], { start: 0.3 }, 1);
    expect(moved[1].start).toBeCloseTo(0.6);
    const scaled = boundedSelection(
      ls,
      ["a", "b"],
      ls[0],
      { duration: 0.4 },
      1,
    );
    expect(scaled[1].start).toBeCloseTo(0.7);
    expect(scaled[1].duration).toBe(0.2);
    expect(scaled[0].sourceDuration).toBe(0.2);
    expect(scaled[0].cropStart).toBe(0.1);
    expect(
      boundedSelection(ls, ["a"], ls[0], { duration: 0.4 }, 1)[0]
        .sourceDuration,
    ).toBe(0.2);
  });
  it("rejects out-of-bounds groups and edits crop/fade only on the active clip", () => {
    const ls = layers();
    expect(boundedSelection(ls, ["a", "b"], ls[0], { start: 0.8 }, 1)).toBe(ls);
    const edited = boundedSelection(
      ls,
      ["a", "b"],
      ls[0],
      { cropStart: 0.2, attack: 0.1 },
      1,
    );
    expect(edited[0].cropStart).toBe(0.2);
    expect(edited[1]).toBe(ls[1]);
  });
  it("snaps to the closest boundary within tolerance", () => {
    expect(snapTime(0.298, [0.2, 0.3, 0.5], 0.01)).toBe(0.3);
    expect(snapTime(0.28, [0.2, 0.3], 0.01)).toBe(0.28);
  });
});
