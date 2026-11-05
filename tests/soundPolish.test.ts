import { describe, expect, it } from "vitest";
import { DEFAULT_EFFECTS, validateAdvanced } from "../src/advanced";
import { renderProject } from "../src/engine";
import { makeLayer, parseProject, projectForSave, type Project } from "../src/model";
import { beforeSoundPolish } from "../src/polishAudition";
const fixture = (): Project => ({
  schema: "momo.soundforge/v2", name: "polish", seed: 42, duration: .5,
  master: .5, echo: .12, assets: {}, layers: [makeLayer({ duration: .1, frequency: 440 })],
  effects: { ...DEFAULT_EFFECTS, low: 8, mid: -3, high: 4, delayTime: .03, delayWet: .6, reverb: .5, ceiling: -3 },
});
describe("sound polish", () => {
  it.each([
    ["toneEnabled", { low: 0, mid: 0, high: 0 }],
    ["delayEnabled", { delayWet: 0 }],
    ["spaceEnabled", { reverb: 0 }],
  ] as const)("bypasses %s without discarding parameters", (flag, neutral) => {
    const p = fixture();
    const disabled = { ...p, effects: { ...p.effects!, [flag]: false } };
    const zero = { ...p, effects: { ...p.effects!, ...neutral } };
    expect(renderProject(disabled).left).toEqual(renderProject(zero).left);
    const restored = { ...disabled, effects: { ...disabled.effects, [flag]: true } };
    expect(renderProject(restored).left).toEqual(renderProject(p).left);
  });
  it("round trips disabled groups and retained values", () => {
    const p = fixture();
    p.effects!.toneEnabled = false;
    const saved = parseProject(JSON.parse(JSON.stringify(projectForSave(p))));
    expect(saved.effects).toEqual(p.effects);
  });
  it("rejects malformed group switches", () => {
    const p = fixture();
    Object.assign(p.effects!, { delayEnabled: "false" });
    expect(() => validateAdvanced(p)).toThrow();
  });
  it("comparison leaves the source, echo and safety ceiling intact", () => {
    const p = fixture(), snapshot = structuredClone(p);
    const original = beforeSoundPolish(p);
    expect(p).toEqual(snapshot);
    expect(original.layers).toBe(p.layers);
    expect(original.echo).toBe(p.echo);
    expect(original.effects!.ceiling).toBe(-3);
    const neutral = { ...p, effects: { ...p.effects!, low: 0, mid: 0, high: 0, delayWet: 0, reverb: 0 } };
    expect(renderProject(original).left).toEqual(renderProject(neutral).left);
    expect(renderProject(original).left).not.toEqual(renderProject(p).left);
  });
});

