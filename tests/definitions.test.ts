import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { BASIC_SYNTH, parseSynth } from "../src/synthesizers";
import { bindDefinition, definitionProject, parseDefinition, type InstrumentDefinition } from "../src/soundDefinitions";
import { encodeSamples, parseProject, projectDocument } from "../src/model";
import { renderProject } from "../src/engine";
import { listDefinitions, loadDefinition, saveDefinition } from "../src/definitionStorage";
import { DEFAULT_EFFECTS } from "../src/advanced";
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
const instrument = (): InstrumentDefinition => ({ schema: "momo.instrument/v1",
  instrument: { id: "keys", name: "Keys", regions: [{ id: "r", assetId: "wave", rootMidi: 60,
    keyLow: 48, keyHigh: 72, velocityLow: 1, velocityHigh: 127, articulation: "sustain", roundRobin: 0,
    tuneCents: 0, gainDb: 0, releaseSeconds: 0.1 }] },
  assets: { wave: { id: "wave", name: "recording", sampleRate: 8000,
    channels: [encodeSamples(Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i * 0.2) * 0.2))] } },
});
it("separates definitions from player values and carries both through portable native saves", () => {
  const definition = structuredClone(BASIC_SYNTH);
  const first = definitionProject(definition), second = definitionProject(definition);
  first.inputs[0].player.frequency = 880;
  definition.defaults.frequency = 440;
  expect(second.inputs[0].player.frequency).toBe(220);
  expect(first.inputs[0].player.synth!.defaults.frequency).toBe(220);
  const reopened = parseProject(projectDocument(first));
  expect(reopened.inputs[0].player.frequency).toBe(880);
  expect(reopened.inputs[0].player.synth!.algorithm).toBe("oscillator-v1");
  expect(renderProject(reopened, 8000).left).toEqual(renderProject(first, 8000).left);
});
it("keeps existing oscillator output when adding its explicit definition", () => {
  const p = definitionProject(BASIC_SYNTH);
  const expected = renderProject(p, 8000).left;
  delete p.inputs[0].player.synth;
  expect(renderProject(p, 8000).left).toEqual(expected);
});
it("saves definitions independently of projects and returns isolated validated copies", async () => {
  const d = structuredClone(BASIC_SYNTH); d.id = "custom";
  await saveDefinition(d);
  d.name = "changed";
  expect((await listDefinitions())[0].name).toBe(BASIC_SYNTH.name);
  const loaded = await loadDefinition("custom");
  expect(loaded).toEqual({ ...BASIC_SYNTH, id: "custom" });
  if (loaded.schema === "momo.synth/v1") loaded.defaults.frequency = 1200;
  expect(await loadDefinition("custom")).not.toEqual(loaded);
  await saveDefinition(instrument());
  expect((await loadDefinition("keys")).schema).toBe("momo.instrument/v1");
});
it("rejects unsupported algorithms, nonfinite parameters, dangling mappings and corrupt recordings", () => {
  expect(() => parseSynth({ ...BASIC_SYNTH, algorithm: "user-code" })).toThrow();
  expect(() => parseSynth({ ...BASIC_SYNTH, defaults: { ...BASIC_SYNTH.defaults, cutoff: Infinity } })).toThrow();
  const d = instrument(); d.instrument.regions[0].assetId = "missing";
  expect(() => parseDefinition(d)).toThrow();
  d.instrument.regions[0].assetId = "wave"; d.assets.wave.channels = ["bad"];
  expect(() => parseDefinition(d)).toThrow();
});
it("creates blank instrument players while preview notes remain temporary", () => {
  const d = instrument(), p = definitionProject(d), preview = definitionProject(d, true);
  expect(p.inputs[0].player.score!.notes).toEqual([]);
  expect(preview.inputs[0].player.score!.notes).toHaveLength(1);
  expect(renderProject(preview, 8000).peak).toBeGreaterThan(0);
  expect(parseDefinition(d)).not.toHaveProperty("notes");
});
it("switches an instrument without changing notes, read settings or effects, remapping audio IDs", () => {
  const p = definitionProject(instrument(), true), input = p.inputs[0];
  input.start = 1; input.sourceStart = 0.1; input.sourceEnd = 0.9;
  input.speed = 2; input.loop = true; input.duration = 1.5;
  input.player.effects = { ...DEFAULT_EFFECTS, delayWet: 0.3 };
  const next = instrument(); next.instrument.id = "other"; next.instrument.name = "Other";
  const result = bindDefinition(p, input.id, next), bound = result.inputs[0];
  expect({ ...bound, player: undefined }).toEqual({ ...input, player: undefined });
  expect(bound.player.effects).toEqual(input.player.effects);
  expect(bound.player.score!.notes[0]).toEqual({ ...input.player.score!.notes[0], instrumentId: "other" });
  const mapped = bound.player.score!.instruments[0].regions[0].assetId;
  expect(mapped).not.toBe("wave"); expect(result.assets[mapped].channels).toEqual(next.assets.wave.channels);
  expect(parseProject(projectDocument(result)).inputs[0].player.score).toEqual(bound.player.score);
  expect(p.inputs[0].player.score!.instruments[0].id).toBe("keys");
});
it("binds synth defaults without replacing duration or read range and rejects a mismatched type", () => {
  const p = definitionProject(BASIC_SYNTH), input = p.inputs[0]; input.sourceStart = 0.1;
  const d = { ...structuredClone(BASIC_SYNTH), id: "custom" }; d.defaults.frequency = 880;
  const next = bindDefinition(p, input.id, d).inputs[0];
  expect(next.player.frequency).toBe(880); expect(next.player.duration).toBe(input.player.duration);
  expect(next.sourceStart).toBe(0.1); expect(next.duration).toBe(input.duration);
  expect(() => bindDefinition(p, input.id, instrument())).toThrow();
});
