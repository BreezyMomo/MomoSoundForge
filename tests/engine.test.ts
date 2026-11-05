import { describe, it, expect } from "vitest";
import { renderProject, encodeWav } from "../src/engine";
import {
  encodeSamples,
  decodeSamples,
  makeLayer,
  parseProject,
  varyProject,
  projectForSave,
  createLayerPreviewProject,
  type Project,
} from "../src/model";
import { PRESETS, fromPreset } from "../src/presets";
const preset = () => fromPreset("ice", "ice", (x) => x);
describe("individual layer audition", () => {
  it("starts a delayed layer immediately and stops at its own duration without editing the project", () => {
    const project = fromPreset("charge", "charge", (x) => x),
      before = JSON.stringify(project);
    const layer = project.layers[2];
    expect(layer.start).toBe(1.9);
    const preview = createLayerPreviewProject(project, layer.id),
      render = renderProject(preview);
    expect(preview.layers).toHaveLength(1);
    expect(preview.layers[0].start).toBe(0);
    expect(preview.duration).toBe(0.35);
    expect(render.left.length).toBe(16800);
    expect(render.left.subarray(0, 480).some((x) => Math.abs(x) > 0.01)).toBe(
      true,
    );
    expect(preview.layers[0].noiseSeed).toBe(layer.noiseSeed);
    expect(preview.master).toBe(1);
    expect(preview.echo).toBe(0);
    expect(JSON.stringify(project)).toBe(before);
  });
  it("auditions a muted layer independently of other solo layers, even outside the project window", () => {
    const project = preset();
    project.layers[0].solo = true;
    project.layers[1] = {
      ...project.layers[1],
      muted: true,
      start: 8,
      duration: 0.45,
    };
    const preview = createLayerPreviewProject(project, project.layers[1].id);
    expect(preview.layers[0].muted).toBe(false);
    expect(preview.layers[0].solo).toBe(false);
    expect(renderProject(preview).peak).toBeGreaterThan(0.01);
    expect(project.layers[1].muted).toBe(true);
    expect(project.layers[0].solo).toBe(true);
    expect(() => createLayerPreviewProject(project, "missing")).toThrow();
  });
});
describe("deterministic rendering and delivery", () => {
  it("renders every preset to finite, non-silent stereo without clipping", () => {
    for (const p of PRESETS) {
      const project = fromPreset(p.id, p.id, (x) => x),
        r = renderProject(project);
      expect(r.left.length).toBe(Math.round(project.duration * 48000));
      expect(r.peak).toBeGreaterThan(0.01);
      expect(r.peak).toBeLessThanOrEqual(0.980001);
      expect(r.rms).toBeGreaterThan(0);
      expect([...r.left, ...r.right].every(Number.isFinite)).toBe(true);
      expect(Math.abs(r.left[0])).toBe(0);
      expect(Math.abs(r.left.at(-1)!)).toBe(0);
    }
  });
  it("reproduces seeded noise and varies only unlocked layers", () => {
    const p = preset();
    p.layers[0].locked = true;
    const a = renderProject(p),
      b = renderProject(p);
    expect(a.left).toEqual(b.left);
    const varied = varyProject(p, 999, 0.5);
    expect(varied.layers[0]).toEqual(p.layers[0]);
    expect(varied.layers[1].duration).not.toBe(p.layers[1].duration);
    expect(varyProject(p, 999, 0.5)).toEqual(varied);
    expect(renderProject(varied).left).not.toEqual(a.left);
  });
  it("honors mute, solo, hard pan and silent projects", () => {
    const p = preset();
    p.layers = p.layers.map((l) => ({ ...l, muted: true }));
    expect(renderProject(p).peak).toBe(0);
    const only = makeLayer({ id: "mono", pan: -1 });
    p.layers = [only];
    p.echo = 0;
    const hardLeft = renderProject(p);
    expect(hardLeft.left.some((x) => Math.abs(x) > 0.01)).toBe(true);
    expect(hardLeft.right.every((x) => Math.abs(x) < 1e-7)).toBe(true);
    const solo = { ...only, solo: true };
    p.layers = [solo, makeLayer({ id: "other", frequency: 800 })];
    expect(renderProject(p).left).toEqual(
      renderProject({ ...p, layers: [solo] }).left,
    );
    expect(renderProject({ ...p, layers: [] }).peak).toBe(0);
  });
  it("writes PCM16 stereo with exact sample rate, length and sample values", () => {
    const r = renderProject(preset()),
      wav = encodeWav(r),
      view = new DataView(wav);
    expect(new TextDecoder().decode(new Uint8Array(wav, 0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(r.left.length * 4);
    expect(wav.byteLength).toBe(44 + r.left.length * 4);
    const i = 400,
      x = r.left[i];
    expect(view.getInt16(44 + i * 4, true)).toBe(
      Math.round(x * (x < 0 ? 32768 : 32767)),
    );
  });
  it("applies linked headroom protection for loud mixed layers", () => {
    const p = preset();
    p.master = 1.5;
    p.layers = Array.from({ length: 10 }, (_, i) =>
      makeLayer({
        id: `loud${i}`,
        frequency: 100,
        endFrequency: 100,
        gain: 1.5,
      }),
    );
    const r = renderProject(p);
    expect(r.sourcePeak).toBeGreaterThan(1);
    expect(r.gainReduction).toBeLessThan(1);
    expect(r.peak).toBeLessThanOrEqual(0.980001);
  });
  it("keeps locked noise identical and zero-amount variations audibly identical", () => {
    const p = preset();
    p.layers[1].locked = true;
    const r = renderProject(p),
      v = renderProject(varyProject(p, 78, 0.8));
    expect(v.layers[p.layers[1].id]).toEqual(r.layers[p.layers[1].id]);
    expect(renderProject(varyProject(p, 78, 0)).left).toEqual(r.left);
  });
});
describe("portable sample projects", () => {
  const sampleProject = (): Project => {
    const p = preset(),
      data = Float32Array.from(
        { length: 8000 },
        (_, i) => Math.sin(i * 0.1) * 0.5,
      );
    p.assets = {
      test: {
        id: "test",
        name: "test.wav",
        sampleRate: 8000,
        channels: [encodeSamples(data)],
      },
    };
    p.layers = [
      makeLayer({
        id: "sample",
        type: "sample",
        assetId: "test",
        frequency: 440,
        endFrequency: 440,
        duration: 1,
        attack: 0,
        release: 0.01,
        decay: 0,
      }),
    ];
    return p;
  };
  it("round-trips samples, project parameters and rendered audio through JSON", () => {
    const p = sampleProject(),
      r = renderProject(p),
      copy = parseProject(JSON.parse(JSON.stringify(p)));
    expect(decodeSamples(p.assets.test.channels[0]).length).toBe(8000);
    expect(renderProject(copy).left).toEqual(r.left);
    expect(r.peak).toBeGreaterThan(0.1);
  });
  it("respects source trimming and reverse playback", () => {
    const p = sampleProject(),
      original = renderProject(p).left;
    p.layers[0].reverse = true;
    expect(renderProject(p).left).not.toEqual(original);
    p.layers[0].trim = 2;
    expect(renderProject(p).peak).toBe(0);
  });
  it("preserves phase-inverted stereo through filtering and draws nonempty layer data", () => {
    const p = sampleProject();
    p.echo = 0;
    const left = decodeSamples(p.assets.test.channels[0]);
    p.assets.test.channels = [
      encodeSamples(left),
      encodeSamples(Float32Array.from(left, (x) => -x)),
    ];
    const r = renderProject(p);
    expect(r.peak).toBeGreaterThan(0.1);
    expect(r.layers.sample.some((x) => Math.abs(x) > 0.1)).toBe(true);
    for (let i = 0; i < r.left.length; i += 71)
      expect(r.left[i]).toBeCloseTo(-r.right[i], 6);
  });
  it("rejects unknown schemas, unsafe numbers, missing assets and inconsistent channels", () => {
    const p = sampleProject();
    expect(() => parseProject({ ...p, schema: "future" })).toThrow();
    expect(() => parseProject({ ...p, master: Infinity })).toThrow();
    expect(() => parseProject({ ...p, duration: 100000 })).toThrow();
    expect(() => parseProject({ ...p, assets: {} })).toThrow();
    expect(() =>
      parseProject({ ...p, layers: [{ ...p.layers[0], gain: NaN }] }),
    ).toThrow();
    expect(() =>
      parseProject({
        ...p,
        assets: {
          test: {
            ...p.assets.test,
            channels: [
              p.assets.test.channels[0],
              encodeSamples(new Float32Array(4)),
            ],
          },
        },
      }),
    ).toThrow();
  });
  it("drops unused samples on save while preserving referenced assets", () => {
    const p = sampleProject();
    p.assets.unused = { ...p.assets.test, id: "unused" };
    expect(Object.keys(projectForSave(p).assets)).toEqual(["test"]);
  });
});
