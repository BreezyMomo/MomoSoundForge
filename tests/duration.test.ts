import { describe, expect, it } from "vitest";
import { makeProject, makeLayer, parseProject, projectForSave, encodeSamples } from "../src/model";
import { renderProject, encodeWav } from "../src/engine";
import { groupNodes, moveNodes } from "../src/nodeTree";
import { adjustClipTiming, rulerTicks } from "../src/timeline";
import { validateVideoReference } from "../src/videoReference";
import { emptyScore } from "../src/instruments";

describe("user-defined work duration", () => {
  it("adds readable intermediate ruler ticks when zoomed, with bounded DOM work", () => {
    const fit = rulerTicks(150, 300), zoomed = rulerTicks(150, 3000);
    expect(zoomed.length).toBeGreaterThan(fit.length);
    expect(zoomed).toContain(65);
    expect(zoomed.at(-1)).toBe(150);
    expect(rulerTicks(150, 1e8).length).toBeLessThanOrEqual(1001);
  });
  it("defaults new work to ten seconds, but round-trips long clips, sources and notes", () => {
    const p = makeProject("long");
    expect(p.duration).toBe(10);
    p.duration = 120;
    p.inputs = [makeLayer({ start: 61, duration: 30, sourceEnd: 45, speed: 1.5, player: { duration: 45 } }),
      makeLayer({ type: "instrument", duration: 120, score: { ...emptyScore(), notes: [
        { id: "note", instrumentId: "unassigned", midi: 60, velocity: 80, start: 122, duration: 80, articulation: "sustain" },
      ] } })];
    expect(parseProject(projectForSave(p))).toEqual(p);
    expect(validateVideoReference({ name: "long.mp4", size: 1000, duration: 600, start: 100, end: 400, markers: [{ id: "hit", name: "hit", time: 150 }] }).end).toBe(400);
  });
  it("groups and moves sounds beyond ten seconds without changing their timing", () => {
    const p = { ...makeProject("long"), duration: 120, inputs: [
      makeLayer({ id: "a", start: 30, duration: 20 }), makeLayer({ id: "b", start: 70, duration: 15 }),
    ] };
    const g = groupNodes(p, [], ["a", "b"], "group");
    expect(g.root.inputs[0].duration).toBe(55);
    const moved = moveNodes(g.root, [g.id], ["b"], []);
    expect(moved.inputs.find(l => l.id === "b")?.start).toBe(70);
    expect(adjustClipTiming({ start: 15, duration: 4 }, "end", 30, 120).duration).toBe(34);
    expect(adjustClipTiming({ start: 15, duration: 20 }, "start", -15, 120)).toEqual({ start: 0, duration: 35 });
  });
  it("renders and exports two minutes, preserving sounds beyond the old forty-second horizon", () => {
    const p = { ...makeProject("long"), duration: 120, inputs: [makeLayer({ start: 65, duration: .5 })] };
    const r = renderProject(p, 8000);
    expect(r.left.length).toBe(960000);
    expect(r.left.slice(65 * 8000, 66 * 8000).some(x => Math.abs(x) > .01)).toBe(true);
    expect(encodeWav(r).byteLength).toBe(44 + 960000 * 4);
    const short = renderProject({ ...p, duration: 10 }, 8000);
    expect(short.left.length).toBe(80000);
    expect(short.peak).toBe(0);
    expect(p.inputs[0].start).toBe(65);
    expect(renderProject(p, 8000).left).toEqual(r.left);
  });
  it("uses allocation budgets rather than a fixed number of seconds", () => {
    const p = { ...makeProject("long"), duration: 1200 };
    expect(parseProject(p).duration).toBe(1200);
    expect(renderProject(p, 100).left.length).toBe(120000);
    expect(() => renderProject(p, 192000)).toThrow("error.renderBudget");
    expect(() => renderProject({ ...p, duration: Number.MAX_VALUE })).toThrow("error.renderBudget");
    expect(() => renderProject({ ...makeProject("bad source"), inputs: [makeLayer({ player: { duration: 1e20 } })] })).toThrow("error.renderBudget");
  });
  it("accepts recordings beyond thirty seconds within the decoded asset budget", () => {
    const p = makeProject("recording");
    p.assets.sample = { id: "sample", name: "recording", sampleRate: 8000, channels: [encodeSamples(new Float32Array(45 * 8000))] };
    p.inputs = [makeLayer({ type: "sample", assetId: "sample", duration: 45 })];
    expect(parseProject(p).inputs[0].duration).toBe(45);
  });
});
