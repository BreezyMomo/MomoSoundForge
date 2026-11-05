import { describe, expect, it } from "vitest";
import { DEFAULT_EFFECTS } from "../src/advanced";
import { renderProject } from "../src/engine";
import {
  makeLayer,
  encodeSamples,
  varyProject,
  parseProject,
  projectForSave,
  type Project,
} from "../src/model";
import {
  groupNodes,
  moveNodes,
  editNode,
  isolatedNode,
  nodeParent,
} from "../src/nodeTree";
import { beforeSoundPolish, padAudition } from "../src/polishAudition";
import { contentRange } from "../src/exportAudio";
import { stretchClip } from "../src/timeline";
const project = (): Project => ({
  schema: "momo.soundforge/v2",
  name: "tree",
  seed: 21,
  duration: 1,
  master: 1,
  echo: 0,
  assets: {},
  layers: [
    makeLayer({
      id: "a",
      name: "A",
      duration: 0.2,
      start: 0.1,
      wave: "noise",
      gain: 0.2,
    }),
    makeLayer({ id: "b", name: "B", duration: 0.3, start: 0.3, gain: 0.15 }),
    makeLayer({ id: "c", name: "C", duration: 0.4, start: 0.1, gain: 0.2 }),
  ],
});
const distance = (a: Float32Array, b: Float32Array) => {
  expect(a.length).toBe(b.length);
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
};
describe("audio node tree", () => {
  it("neutral grouping preserves timing, random identity and audio, including nested groups", () => {
    const p = project(),
      before = renderProject(p, 8000);
    const one = groupNodes(p, [], ["a", "b"], "one"),
      two = groupNodes(one.root, [], [one.id, "c"], "two");
    expect(
      distance(before.left, renderProject(two.root, 8000).left),
    ).toBeLessThan(1e-6);
    const children = nodeParent(two.root, [two.id, one.id]).layers;
    expect(children.map((l) => l.id)).toEqual(["a", "b"]);
    expect(p.layers.length).toBe(3);
  });
  it("grouping preserves non-grid start times at different export sample rates", () => {
    const p = project();
    p.layers[0].start = 0.100041;
    p.layers[1].start = 0.300072;
    const g = groupNodes(p, [], ["a", "b"], "g");
    for (const rate of [8000, 22050, 48000])
      expect(
        distance(renderProject(p, rate).left, renderProject(g.root, rate).left),
      ).toBeLessThan(1e-6);
  });
  it("groups never normalize their children; final output protects once", () => {
    const p = project();
    p.layers.forEach((l) => (l.gain = 1.5));
    const g = groupNodes(p, [], ["a", "b"], "group");
    expect(
      distance(renderProject(p, 8000).left, renderProject(g.root, 8000).left),
    ).toBeLessThan(1e-6);
    expect(renderProject(g.root, 8000).peak).toBeLessThanOrEqual(0.980001);
  });
  it("child solo remains audible through a non-solo parent and mutes unrelated branches", () => {
    const p = project();
    p.layers[0].solo = true;
    const g = groupNodes(p, [], ["a", "b"], "g");
    expect(
      distance(renderProject(p, 8000).left, renderProject(g.root, 8000).left),
    ).toBeLessThan(1e-6);
    g.root.layers.find((l) => l.id === g.id)!.muted = true;
    // Muting a solo branch removes its solo restriction, allowing unrelated nodes.
    expect(renderProject(g.root, 8000).rms).toBeGreaterThan(0);
  });
  it("moves nodes between groups without changing their absolute start or source seed", () => {
    const p = project(),
      g = groupNodes(p, [], ["a", "b"], "g");
    const moved = moveNodes(g.root, [g.id], ["a"], []);
    expect(moved.layers.find((l) => l.id === "a")!.start).toBeCloseTo(0.1);
    expect(
      distance(renderProject(p, 8000).left, renderProject(moved, 8000).left),
    ).toBeLessThan(1e-6);
    expect(() => moveNodes(g.root, [], [g.id], [g.id])).toThrow();
  });
  it("preserves nested tails while respecting the root work range", () => {
    const p = project();
    p.duration = 0.6;
    p.layers[0].effects = {
      ...DEFAULT_EFFECTS,
      delayTime: 0.2,
      delayWet: 0.7,
      delayFeedback: 0.5,
    };
    const g = groupNodes(p, [], ["a", "b"], "g");
    const group = g.root.layers.find((l) => l.id === g.id)!;
    group.effects = { ...DEFAULT_EFFECTS, reverb: 0.4 };
    const rendered = renderProject(g.root, 8000);
    expect(rendered.left.length / 8000).toBe(0.6);
    expect(renderProject({ ...g.root, duration: 4 }, 8000).left.slice(4800).some(x => Math.abs(x) > .0001)).toBe(true);
    expect(rendered.tails![JSON.stringify([g.id, "a"])]).toBeGreaterThan(0);
    expect(rendered.tails![g.id]).toBeGreaterThan(0);
    expect(group.duration).toBeCloseTo(0.5);
    expect(
      parseProject(projectForSave(g.root)).layers.find((l) => l.id === g.id)!
        .effects,
    ).toEqual(group.effects);
  });
  it("keeps timeline tail samples identical to the extended node mix without squeezing them into the body", () => {
    const p = project();
    p.layers = [p.layers[0]];
    p.duration = 0.3;
    p.layers[0].effects = { ...DEFAULT_EFFECTS, delayTime: 0.15, delayWet: 0.5, delayFeedback: 0.5 };
    const g = groupNodes(p, [], ["a"], "group");
    const root = g.root, group = root.layers[0], key = JSON.stringify([group.id]);
    const rendered = renderProject(root, 8000);
    const frames = Math.round(group.duration * 8000), wave = rendered.processedLayers![key];
    expect(wave.length).toBeGreaterThan(frames);
    expect(wave.slice(frames).some(v => Math.abs(v) > 0.001)).toBe(true);
    const isolated = isolatedNode(root, { path: [], id: group.id });
    const audition = renderProject({ ...isolated, duration: (wave.length + 1) / 8000 }, 8000);
    const peakChannel = Float32Array.from(audition.left, (v, i) => Math.abs(v) >= Math.abs(audition.right[i]) ? v : audition.right[i]);
    expect(distance(wave.slice(0, -1), peakChannel.slice(0, wave.length - 1))).toBeLessThan(1e-6);
    expect(contentRange(root, rendered).tailEnd).toBeCloseTo(group.start + wave.length / 8000);
    expect(contentRange(root, rendered).tailEnd).toBeGreaterThan(root.duration);
  });
  it("uses processed duration for range warnings and excludes muted and non-solo branches", () => {
    const p = project();
    p.layers[0].effects = { ...DEFAULT_EFFECTS, delayTime: 0.2, delayWet: 0.7 };
    p.layers[1].start = 5;
    p.layers[1].muted = true;
    const r = renderProject(p, 8000);
    expect(contentRange(p, r).tailEnd).toBeCloseTo(p.layers[0].start + p.layers[0].duration + r.tails!.a);
    p.layers[1].muted = false;
    p.layers[0].solo = true;
    expect(contentRange(p, renderProject(p, 8000)).tailEnd).toBeCloseTo(contentRange({ ...p, layers: [p.layers[0]] }, r).tailEnd);
  });
  it("node audition skips all ancestors and starts immediately", () => {
    const g = groupNodes(project(), [], ["a", "b"], "g");
    const changed = editNode(
      g.root,
      { path: [], id: g.id },
      { effects: { ...DEFAULT_EFFECTS, low: 20, delayWet: 1 } },
    );
    expect(
      renderProject(isolatedNode(g.root, { path: [g.id], id: "a" }), 8000).left,
    ).toEqual(
      renderProject(isolatedNode(changed, { path: [g.id], id: "a" }), 8000)
        .left,
    );
    expect(
      isolatedNode(changed, { path: [g.id], id: "a" }).layers[0].start,
    ).toBe(0);
  });
  it("comparison bypasses only the selected group while retaining child effects", () => {
    const p = project();
    p.layers[0].effects = { ...DEFAULT_EFFECTS, high: 8 };
    const g = groupNodes(p, [], ["a", "b"], "g");
    const changed = editNode(
      g.root,
      { path: [], id: g.id },
      { effects: { ...DEFAULT_EFFECTS, low: 8 } },
    );
    const bypassed = beforeSoundPolish(changed, { path: [], id: g.id });
    expect(
      distance(
        renderProject(g.root, 8000).left,
        renderProject(bypassed, 8000).left,
      ),
    ).toBeLessThan(1e-6);
    expect(nodeParent(bypassed, [g.id]).layers[0].effects!.high).toBe(8);
  });
  it("groups cannot be stretched via timeline operations", () => {
    const g = groupNodes(project(), [], ["a", "b"], "g").root.layers.find(
      (l) => l.project,
    )!;
    expect(stretchClip(g, { start: 0.2, duration: 4 })).toEqual({ start: 0.2 });
  });
  it("empty groups survive save and reopen after moving their last child", () => {
    const g = groupNodes(project(), [], ["a"], "g");
    const moved = moveNodes(g.root, [g.id], ["a"], []);
    expect(
      parseProject(projectForSave(moved)).layers.find((l) => l.id === g.id)!
        .project!.layers,
    ).toHaveLength(0);
  });
  it("cross-group moves carry samples and resolve asset identifier collisions", () => {
    const p = project();
    p.layers[0].type = "sample";
    p.layers[0].assetId = "sample";
    p.assets.sample = {
      id: "sample",
      name: "original",
      sampleRate: 8000,
      channels: [encodeSamples(new Float32Array(800).fill(0.2))],
    };
    const g = groupNodes(p, [], ["a"], "g");
    g.root.assets.sample = {
      id: "sample",
      name: "different",
      sampleRate: 8000,
      channels: [encodeSamples(new Float32Array(800).fill(0.4))],
    };
    g.root.layers.push(
      makeLayer({ id: "d", type: "sample", assetId: "sample", duration: 0.1 }),
    );
    const moved = moveNodes(g.root, [g.id], ["a"], []);
    const a = moved.layers.find((l) => l.id === "a")!;
    expect(a.assetId).not.toBe("sample");
    expect(moved.assets[a.assetId!].name).toBe("original");
    expect(moved.assets.sample.name).toBe("different");
    expect(parseProject(projectForSave(moved)).layers).toHaveLength(5);
  });
  it("comparison padding preserves samples and aligns the playback horizon", () => {
    const r = renderProject(project(), 8000),
      padded = padAudition(r, 16000);
    expect(padded.left.slice(0, r.left.length)).toEqual(r.left);
    expect(padded.left.length).toBe(16000);
    expect(padded.left.slice(r.left.length).every((x) => x === 0)).toBe(true);
  });
  it("variations recurse into groups and respect child locks", () => {
    const p = project();
    p.layers[0].locked = true;
    const g = groupNodes(p, [], ["a", "b"], "g");
    const a = varyProject(g.root, 333, 0.5),
      b = varyProject(g.root, 333, 0.5);
    expect(a).toEqual(b);
    expect(nodeParent(a, [g.id]).layers[0]).toEqual(
      nodeParent(g.root, [g.id]).layers[0],
    );
    expect(nodeParent(a, [g.id]).layers[1].frequency).not.toBe(
      p.layers[1].frequency,
    );
  });
  it("rejects malformed per-node effects on import", () => {
    const p = project();
    p.layers[0].effects = { ...DEFAULT_EFFECTS, delayFeedback: Infinity };
    expect(() => parseProject(p)).toThrow();
  });
});
