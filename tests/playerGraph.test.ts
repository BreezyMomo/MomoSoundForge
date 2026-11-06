import { describe, expect, it } from "vitest";
import { makeProject, makeLayer, makeComposition, parseProject, projectDocument, withLayerValue, reusableInput, patchLayer } from "../src/model";
import { DEFAULT_EFFECTS } from "../src/advanced";
import { renderProject } from "../src/engine";
import { sourceTime, fitPlayerRange, hasReadOverflow, playerDuration, timeAtPath, timeFromPath } from "../src/playerPlayback";
import { contentCandidate, replaceContent } from "../src/contentReplacement";
import { isolatedNode, moveNodes } from "../src/nodeTree";
import { adjustCrop, boundedSelection } from "../src/timeline";

describe("player graph contracts", () => {
  it("keeps processing state independent between two uses of the same definition", () => {
    const a = makeLayer({ id: "a", gain: 0.1, duration: 0.1, wave: "noise", effects: { ...DEFAULT_EFFECTS, delayWet: 0.5 } });
    const b = { ...a, id: "b", start: 0.2 };
    const root = { ...makeProject("instances"), duration: 2, inputs: [a] };
    const first = renderProject(root, 8000).left;
    const together = renderProject({ ...root, inputs: [a,b] }, 8000).left;
    for (let i = 0; i < together.length - 1; i++)
      expect(together[i]).toBeCloseTo(first[i] + (i >= 1600 ? first[i - 1600] : 0), 6);
  });

  it("edits full-source effects without losing tails and respects explicit read windows", () => {
    const input = makeLayer({ duration: 0.1 });
    const effects = { ...DEFAULT_EFFECTS, delayWet: 0.5 };
    expect(patchLayer(input, { player: { effects } }).sourceEnd).toBeGreaterThan(input.sourceEnd);
    const cut = { ...input, sourceEnd: 0.05, duration: 0.05 };
    expect(patchLayer(cut, { player: { effects } }).sourceEnd).toBe(0.05);
  });

  it("crops reversed reads at the audible edges", () => {
    const input = makeLayer({ start: 1, sourceStart: 0.2, sourceEnd: 1.2, duration: 1, reverse: true });
    expect(adjustCrop(input, "cropStart", 0.2)).toMatchObject({ sourceEnd: 1, start: 1.2, duration: 0.8 });
    expect(adjustCrop(input, "cropEnd", -0.2)).toMatchObject({ sourceStart: 0.4, duration: 0.7999999999999999 });
  });

  it("commits a crop through multi-selection without turning it into a stretch", () => {
    const a = makeLayer({ id: "a", duration: 1 });
    const b = makeLayer({ id: "b", duration: 1, start: 1 });
    const cropped = { ...a, ...adjustCrop(a, "cropEnd", -0.5) };
    const result = boundedSelection([a,b], ["a","b"], a, cropped, 3);
    expect(result[0]).toMatchObject({ duration: 0.5, speed: 1, sourceEnd: 0.5 });
    expect(result[1]).toEqual(b);
    const looping = { ...a, loop: true };
    const shorter = { ...looping, ...adjustCrop(looping, "cropEnd", -0.5) };
    expect(boundedSelection([looping], ["a"], looping, shorter, 3)[0]).toMatchObject({ duration: 0.5, speed: 1, sourceEnd: 1 });
  });
  it("rejects malformed native graphs and invalid document loop ranges", () => {
    const root = { ...makeProject("test"), inputs: [makeLayer()] };
    const doc = projectDocument(root);
    expect(() => parseProject({ ...doc, root: {} })).toThrow();
    expect(() => parseProject({ ...doc, loopRegion: { start: 3, end: 2, crossfade: 0 } })).toThrow();
    expect(() => parseProject({ ...doc, root: { type: "composition", mix: { inputs: [{ player: null }] } } })).toThrow();
    expect(() => parseProject({ ...doc, schema: "momo.soundforge/v3" })).toThrow();
    const cyclic: any = { type: "composition", mix: { inputs: [] } };
    cyclic.mix.inputs.push({ player: cyclic });
    expect(() => parseProject({ ...doc, root: cyclic })).toThrow();
  });

  it("reuses saved single layers without accumulating neutral mix wrappers", () => {
    let root = { ...makeProject("reuse"), duration: 0.7, inputs: [makeLayer({ duration: 0.7, sourceStart: 0.1, sourceEnd: 0.3, loop: true, gain: 0.3, wave: "noise" })] };
    const before = renderProject(root, 8000).left;
    for (let i = 0; i < 8; i++) {
      const { input, assets } = reusableInput(parseProject(projectDocument(root)));
      root = { ...root, inputs: [input], assets };
    }
    expect(root.inputs[0].player.type).toBe("synth");
    expect(renderProject(root, 8000).left).toEqual(before);
    expect(reusableInput({ ...root, master: 0.5 }).input.player.type).toBe("composition");
    expect(reusableInput({ ...root, duration: 2 }).input.player.type).toBe("composition");
  });

  it("maps nested source clocks and seeks to the current loop iteration", () => {
    const mix = { ...makeProject("inside"), duration: 4, inputs: [makeLayer({ id: "voice", duration: 4 })] };
    const group = makeComposition(mix, { id: "group", start: 2, sourceStart: 1, sourceEnd: 3, speed: 2, duration: 5, loop: true });
    const root = { ...makeProject("work"), inputs: [group] };
    expect(timeAtPath(root, ["group"], 3.25)).toBeCloseTo(1.5);
    expect(timeFromPath(root, ["group"], 2, 3.25)).toBeCloseTo(3.5);
    expect(timeAtPath(root, ["group"], 1)).toBeNull();
    expect(() => moveNodes(root, ["group"], ["voice"], [])).toThrow("player.moveTransformed");
  });

  it("includes mixer echo in the child's finite output contract", () => {
    const child = { ...makeProject("echo"), duration: 0.1, echo: 0.5, inputs: [makeLayer({ duration: 0.1 })] };
    const group = makeComposition(child);
    expect(group.sourceEnd).toBeGreaterThan(0.2);
    const result = renderProject({ ...makeProject("outer"), duration: group.duration, inputs: [group] }, 8000);
    expect(result.left.slice(1600).some(x => Math.abs(x) > 0.001)).toBe(true);
  });

  it("maps the parent's read range and loop without changing the child", () => {
    const input = makeLayer({ duration: 10, sourceStart: 1, sourceEnd: 4, loop: true, start: 2, player: { duration: 8 } });
    expect(sourceTime(input, 0)).toBe(1);
    expect(sourceTime(input, 2.5)).toBe(3.5);
    expect(sourceTime(input, 3)).toBe(1);
    expect(sourceTime(input, 9.5)).toBe(1.5);
    expect(sourceTime(input, 10)).toBeNull();
    expect(input.player.duration).toBe(8);
  });

  it("pads out-of-range loop reads with silence and preserves their period", () => {
    const input = makeLayer({ id: "loop", gain: 0.2, duration: 1.2, sourceStart: 0.1, sourceEnd: 0.4, loop: true,
      player: { duration: 0.2, wave: "noise", attack: 0, release: 0, decay: 0 } });
    const root = { ...makeProject("loop"), duration: 1.2, inputs: [input] };
    const audio = renderProject(root, 8000).inputs.loop;
    expect(audio.slice(0, 700).some(x => Math.abs(x) > 0.001)).toBe(true);
    expect(audio.slice(800, 2400).every(x => x === 0)).toBe(true);
    for (let i = 0; i < 2400; i++) expect(audio[i + 2400]).toBeCloseTo(audio[i], 6);
    expect(hasReadOverflow(input)).toBe(true);
    const fit = fitPlayerRange(input);
    expect(fit).toMatchObject({ start: input.start, duration: 1.2, sourceStart: 0.1, sourceEnd: 0.2, speed: 1, loop: true });
    const absent = { ...input, sourceStart: 1, sourceEnd: 2 };
    expect(renderProject({ ...root, inputs: [absent] }, 8000).peak).toBe(0);
    expect(fitPlayerRange(absent).sourceStart).toBe(0);
    expect(root.inputs[0]).toBe(input);
  });

  it("replaces only the player, retains its use, and does not retain old child effects", () => {
    const old = makeLayer({ id: "slot", duration: 2, sourceStart: 0.1, sourceEnd: 0.8, speed: 2, loop: true,
      effects: { ...DEFAULT_EFFECTS, reverb: 0.4 } });
    const root = { ...makeProject("work"), effects: { ...DEFAULT_EFFECTS, delayWet: 0.2 }, inputs: [old] };
    const candidate = contentCandidate({ ...makeProject("short"), duration: 0.2, inputs: [makeLayer({ duration: 0.2 })] });
    const next = replaceContent(root, { path: [], id: old.id }, candidate);
    const { player: oldPlayer, ...oldUse } = old;
    const { player: newPlayer, ...newUse } = next.inputs[0];
    expect(newUse).toEqual(oldUse);
    expect(newPlayer).toEqual(candidate.player);
    expect(newPlayer.effects).not.toEqual(oldPlayer.effects);
    expect(next.effects).toEqual(root.effects);
    expect(hasReadOverflow(next.inputs[0])).toBe(true);
  });

  it("includes a player's own tail by default, but explicit parent cuts truncate it", () => {
    const input = makeLayer({ id: "tail", duration: 0.1, gain: 0.2,
      effects: { ...DEFAULT_EFFECTS, delayTime: 0.15, delayWet: 0.7, delayFeedback: 0.3 } });
    expect(input.duration).toBe(playerDuration(input.player));
    const root = { ...makeProject("tail"), duration: 1, inputs: [input] };
    expect(renderProject(root, 8000).left.slice(1600).some(x => Math.abs(x) > 0.001)).toBe(true);
    const cut = { ...input, sourceEnd: 0.1, duration: 0.1 };
    expect(renderProject({ ...root, inputs: [cut] }, 8000).left.slice(800).every(x => x === 0)).toBe(true);
    const parentFx = { ...root, inputs: [cut], effects: { ...DEFAULT_EFFECTS, delayTime: 0.2, delayWet: 0.7 } };
    expect(renderProject(parentFx, 8000).left.slice(1600).some(x => Math.abs(x) > 0.001)).toBe(true);
  });

  it("round-trips the root graph repeatedly without adding nodes or altering audio", () => {
    let root = { ...makeProject("saved"), duration: 0.5, inputs: [makeLayer({ id: "tone", duration: 0.3, wave: "noise" })] };
    const document = projectDocument(root), audio = renderProject(root, 8000);
    for (let i = 0; i < 5; i++) root = parseProject(JSON.parse(JSON.stringify(projectDocument(root))));
    expect(projectDocument(root)).toEqual(document);
    expect(renderProject(root, 8000).left).toEqual(audio.left);
    expect(root.inputs).toHaveLength(1);
    expect(root.inputs[0].player.type).toBe("synth");
  });

  it("saves a selected layer's use and own effects without its parent's processing", () => {
    const root = { ...makeProject("parent"), master: 0.4, effects: { ...DEFAULT_EFFECTS, reverb: 0.5 },
      inputs: [makeLayer({ id: "voice", start: 2, duration: 1, sourceStart: 0.1, sourceEnd: 0.3, loop: true,
        effects: { ...DEFAULT_EFFECTS, high: 3 } })] };
    const saved = parseProject(projectDocument(isolatedNode(root, { path: [], id: "voice" })));
    expect(saved.effects).toBeUndefined();
    expect(saved.master).toBe(1);
    expect(saved.inputs[0]).toMatchObject({ start: 0, sourceStart: 0.1, sourceEnd: 0.3, loop: true, duration: 1 });
    expect(saved.inputs[0].player.effects).toEqual(root.inputs[0].player.effects);
  });

  it("keeps noise stable when the input id or parent seed changes", () => {
    const input = makeLayer({ id: "one", duration: 0.3, wave: "noise" });
    const root = { ...makeProject("seed"), duration: 0.3, inputs: [input] };
    expect(renderProject({ ...root, seed: 19, inputs: [{ ...input, id: "two" }] }, 8000).left)
      .toEqual(renderProject(root, 8000).left);
  });

  it("applies speed and crop to compositions through the same mapping as leaves", () => {
    const child = { ...makeProject("inner"), duration: 0.4, inputs: [makeLayer({ duration: 0.4, wave: "noise" })] };
    const group = makeComposition(child, { id: "group" });
    const root = { ...makeProject("outer"), duration: 0.4, inputs: [group] };
    const full = renderProject(root, 8000).inputs.group;
    const shortened = withLayerValue(withLayerValue(group, "sourceStart", 0.1), "speed", 2);
    const result = renderProject({ ...root, inputs: [shortened] }, 8000).inputs.group;
    expect(result.length).toBe(1200);
    for (let i = 0; i < result.length; i++) expect(result[i]).toBeCloseTo(full[800 + i * 2], 6);
  });
});
