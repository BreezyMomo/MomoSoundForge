import { describe, it, expect } from "vitest";
import { fromPreset } from "../src/presets";
import { renderProject } from "../src/engine";
import {
  assertProjectLimits,
  encodeSamples,
  makeComposition,
  makeLayer,
  parseProject,
  projectForSave,
  resolveProjectPath,
  updateProjectAtPath,
  wrapProject,
  MAX_COMPOSITION_DEPTH,
  MAX_ASSET_BYTES,
  type Project,
} from "../src/model";
const sound = () => fromPreset("deny", "source", (key) => key);
const empty = (name = "parent"): Project => ({
  ...sound(),
  name,
  duration: 2,
  master: 1,
  echo: 0,
  inputs: [],
  assets: {},
});
const difference = (a: Float32Array, b: Float32Array) => {
  let delta = 0;
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++)
    delta = Math.max(delta, Math.abs(a[i] - b[i]));
  return delta;
};
describe("editable audio compositions", () => {
  it("fades the mixed group in both channels without changing child envelopes", () => {
    const child = sound();
    const wrapped = wrapProject(child);
    const baseline = renderProject(wrapped);
    const group = wrapped.inputs[0];
    const savedChild = JSON.stringify(group.player.mix);
    group.player.attack = child.duration * 0.4;
    group.player.release = child.duration * 0.4;
    const actual = renderProject(parseProject(JSON.parse(JSON.stringify(projectForSave(wrapped)))));
    let audible = 0;
    for (let i = 0; i < baseline.left.length; i++) {
      const time = i / 48000;
      const fade = Math.min(1, time / group.player.attack) *
        Math.max(0, Math.min(1, (child.duration - time) / group.player.release));
      expect(actual.left[i]).toBeCloseTo(baseline.left[i] * fade, 6);
      expect(actual.right[i]).toBeCloseTo(baseline.right[i] * fade, 6);
      if (Math.abs(baseline.left[i]) > 0.001 && fade < 0.9) audible++;
    }
    expect(audible).toBeGreaterThan(100);
    expect(JSON.stringify(group.player.mix)).toBe(savedChild);
  });

  it("wraps a tuned sound without losing parameters, timing, master effects or stereo", () => {
    const original = fromPreset("ice", "ice", (key) => key);
    original.inputs[1].pan = 0.7;
    const before = JSON.stringify(original);
    const wrapped = wrapProject(original),
      expected = renderProject(original),
      actual = renderProject(wrapped);
    expect(wrapped.inputs).toHaveLength(1);
    expect(wrapped.inputs[0].player.type).toBe("composition");
    expect(wrapped.inputs[0].player.mix).toEqual(original);
    expect(wrapped.master).toBe(1);
    expect(wrapped.echo).toBe(0);
    expect(
      difference(expected.left.slice(64, -64), actual.left.slice(64, -64)),
    ).toBeLessThan(1e-6);
    expect(
      difference(expected.right.slice(64, -64), actual.right.slice(64, -64)),
    ).toBeLessThan(1e-6);
    expect(JSON.stringify(original)).toBe(before);
  });
  it("offsets a composition as a whole while retaining internal relative timing", () => {
    const child = sound(),
      layer = makeComposition(child, { id: "nested", start: 0.4 }),
      parent = { ...empty(), inputs: [layer] };
    const expected = renderProject(child),
      actual = renderProject(parent),
      offset = Math.round(0.4 * 48000);
    expect(actual.left.slice(0, offset).every((x) => x === 0)).toBe(true);
    expect(
      difference(
        expected.left,
        actual.left.slice(offset, offset + expected.left.length),
      ),
    ).toBeLessThan(1e-6);
    expect(actual.inputs.nested.length).toBe(
      Math.round(child.duration * 48000),
    );
    layer.muted = true;
    expect(renderProject(parent).peak).toBe(0);
  });
  it("updates only the edited instance, leaving a duplicated composition independent", () => {
    const first = makeComposition(sound(), { id: "first" }),
      second = { ...first, id: "second" },
      root = { ...empty(), inputs: [first, second] };
    const changed = updateProjectAtPath(root, ["second"], (p) => ({
      ...p,
      master: 0,
    }));
    expect(changed.inputs[0]).toBe(first);
    expect(changed.inputs[0].player.mix!.master).toBe(0.8);
    expect(changed.inputs[1].player.mix!.master).toBe(0);
    expect(root.inputs[1].player.mix!.master).toBe(0.8);
    expect(resolveProjectPath(changed, ["second"]).project.master).toBe(0);
    expect(resolveProjectPath(root, ["second", "missing"]).path).toEqual([
      "second",
    ]);
    expect(
      resolveProjectPath({ ...root, inputs: [first] }, ["second"]).path,
    ).toEqual([]);
  });
  it("follows child duration changes for untrimmed wrappers and preserves custom windows", () => {
    const child = sound(),
      root = {
        ...empty(),
        duration: 0.5,
        inputs: [makeComposition(child, { id: "child" })],
      };
    const changed = updateProjectAtPath(root, ["child"], (p) => ({
      ...p,
      duration: 1.2,
    }));
    expect(changed.inputs[0].duration).toBe(1.2);
    expect(changed.duration).toBe(1.2);
    root.inputs[0] = { ...root.inputs[0], duration: 0.3 };
    expect(
      updateProjectAtPath(root, ["child"], (p) => ({ ...p, duration: 1.2 }))
        .inputs[0].duration,
    ).toBe(0.3);
  });
  it("round-trips nested samples with scoped IDs and prunes unused assets recursively", () => {
    const makeSample = (frequency: number) => {
      const p = empty(`sample-${frequency}`),
        data = Float32Array.from(
          { length: 2400 },
          (_, i) => Math.sin((i / 8000) * frequency * Math.PI * 2) * 0.5,
        );
      p.duration = 0.3;
      p.assets = {
        shared: {
          id: "shared",
          name: "source.wav",
          sampleRate: 8000,
          channels: [encodeSamples(data)],
        },
      };
      p.assets.unused = { ...p.assets.shared, id: "unused" };
      p.inputs = [
        makeLayer({
          id: "sample",
          type: "sample",
          assetId: "shared",
          frequency: 440,
          endFrequency: 440,
          duration: 0.3,
          decay: 0,
        }),
      ];
      return p;
    };
    const root = {
      ...empty(),
      inputs: [
        makeComposition(makeSample(200), { id: "a", pan: -1 }),
        makeComposition(makeSample(700), { id: "b", start: 0.4, pan: 1 }),
      ],
    };
    const saved = projectForSave(root);
    expect(Object.keys(saved.inputs[0].player.mix!.assets)).toEqual([
      "shared",
    ]);
    const restored = parseProject(JSON.parse(JSON.stringify(saved))),
      expected = renderProject(root),
      actual = renderProject(restored);
    expect(actual.left).toEqual(expected.left);
    expect(actual.right).toEqual(expected.right);
    expect(actual.left.slice(0, 14000).some((x) => Math.abs(x) > 0.01)).toBe(
      true,
    );
    expect(actual.right.slice(0, 14000).every((x) => Math.abs(x) < 1e-7)).toBe(
      true,
    );
  });
  it("rejects old projects, missing children, cycles and excessive depth", () => {
    expect(() =>
      parseProject({ ...sound(), schema: "momo.soundforge/v1" }),
    ).toThrow();
    expect(() =>
      parseProject({
        ...empty(),
        inputs: [makeLayer({ type: "composition" })],
      }),
    ).toThrow();
    const cycle = empty();
    cycle.inputs = [makeLayer({ type: "composition", mix: cycle })];
    expect(() => parseProject(cycle)).toThrow();
    expect(() => renderProject(cycle)).toThrow();
    expect(() => assertProjectLimits(cycle)).toThrow();
    let deep = sound();
    for (let i = 0; i < MAX_COMPOSITION_DEPTH; i++) deep = wrapProject(deep);
    expect(
      renderProject(parseProject(JSON.parse(JSON.stringify(deep)))).peak,
    ).toBeGreaterThan(0.01);
    expect(() => wrapProject(deep)).toThrow();
  });
  it("enforces total layer and sample budgets across all nested scopes", () => {
    const child = {
      ...sound(),
      inputs: Array.from({ length: 16 }, (_, i) =>
        makeLayer({ id: `voice-${i}` }),
      ),
    };
    const tooMany = {
      ...empty(),
      inputs: Array.from({ length: 8 }, (_, i) =>
        makeComposition(child, { id: `group-${i}` }),
      ),
    };
    expect(() => assertProjectLimits(tooMany)).toThrow();
    expect(() => parseProject(tooMany)).toThrow();
    const data = "A".repeat(Math.ceil((MAX_ASSET_BYTES * 0.7) / 0.75));
    const withData = {
      ...sound(),
      assets: {
        fake: { id: "fake", name: "fake", sampleRate: 48000, channels: [data] },
      },
    };
    const assetGroup = makeLayer({ type: "composition", mix: withData });
    expect(() =>
      assertProjectLimits({
        ...empty(),
        inputs: [assetGroup, { ...assetGroup, id: "another" }],
      }),
    ).toThrow("error.budget");
  });
});
