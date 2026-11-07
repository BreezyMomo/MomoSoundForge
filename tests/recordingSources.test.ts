import type { RecordingDefinition } from '../src/recordingDefinition';
import { expect, it } from "vitest";
import { recordingSummaries, recordingResource, recordingPreview, parseRecordingSummaries } from "../src/recordingSources";
import { resourceFromDefinition } from "../src/soundResources";
import { definitionProject, type InstrumentDefinition } from "../src/soundDefinitions";
import { bindInstrumentNote, instrumentSource, noteMappings } from "../src/instrumentMapping";
import { encodeSamples, parseProject, projectDocument } from "../src/model";
import { renderProject } from "../src/engine";
import { selectRegion } from "../src/instruments";
import { BUILTIN_SOUNDS } from "../src/builtinLibrary";

function fixture(): InstrumentDefinition {
  const region = { id: "soft-region", assetId: "soft", rootMidi: 48, keyLow: 46, keyHigh: 51,
    velocityLow: 1, velocityHigh: 60, articulation: "single-hit", roundRobin: 0,
    gainDb: -3, tuneCents: 0, releaseSeconds: 0.15 };
  const audio = (id: string, amplitude: number) => ({ id, name: `${id}.wav`, sampleRate: 8000,
    channels: [encodeSamples(Float32Array.from({ length: 12000 }, (_, i) => amplitude * Math.sin(i * 2 * Math.PI * 200 / 8000)))] });
  return { schema: "momo.instrument/v1", instrument: { id: "piano", name: "Piano", regions: [
    region, { ...region, id: "soft-region-2", assetId: "soft-2", roundRobin: 50 },
    { ...region, id: "hard-region", assetId: "hard", velocityLow: 61, velocityHigh: 127 },
    // Reusing an asset in another mapping does not create another recording.
    { ...region, id: "soft-other-range", keyLow: 45, keyHigh: 52 },
  ] }, assets: { soft: audio("soft", .2), "soft-2": audio("soft-2", .21), hard: audio("hard", .3) } };
}

it("lists actual recordings once with original pitch, strength and deterministic takes", () => {
  const original = fixture(), before = structuredClone(original);
  const recordings = recordingSummaries(original);
  expect(recordings).toHaveLength(3);
  expect(recordings.filter(r => r.velocityHigh === 60).map(r => r.variant)).toEqual([1, 2]);
  expect(recordings.every(r => r.rootMidi === 48)).toBe(true);
  expect(parseRecordingSummaries(recordings)).toEqual(recordings);
  const reordered = structuredClone(original); reordered.instrument.regions.reverse();
  expect(recordingSummaries(reordered).map(r => [r.id, r.variant])).toEqual(recordings.map(r => [r.id, r.variant]));
  expect(original).toEqual(before);
});

it("extracts one portable source, with no other takes, and previews that actual recording at its root", () => {
  const parent = resourceFromDefinition(fixture()), snapshot = structuredClone(parent);
  const child = recordingResource(parent, "soft-2", "Piano C3 · soft · take 2");
  const d = child.payload as RecordingDefinition;
  expect(child.kind).toBe("recording");
  expect(d.asset.id).toBe("soft-2");
  expect(d).toMatchObject({ rootMidi: 48, gainDb: -3 });
  const preview = recordingPreview(child);
  expect(preview.duration).toBe(1.5);
  expect(preview.inputs[0].player).toMatchObject({ type: "sample", assetId: "soft-2" });
  expect(renderProject(preview, 8000).left.some(x => x !== 0)).toBe(true);
  const reopened = parseProject(projectDocument(preview));
  expect(renderProject(reopened, 8000).left).toEqual(renderProject(preview, 8000).left);
  expect(parent).toEqual(snapshot);
});

it("retains source pitch on assignment to another key, overrides shared mappings, and produces the expected octave", async () => {
  const parent = resourceFromDefinition(fixture());
  const child = recordingResource(parent, "hard", "Piano C3 hard");
  const prepared = await instrumentSource(child, async () => { throw Error("must reuse the original recording"); });
  expect(prepared.source).toMatchObject({ type: "recording", rootMidi: 48, gainDb: -3 });
  const base = fixture();
  base.instrument.regions = [{ ...base.instrument.regions[0], id: "shared", rootMidi: 60, keyLow: 0, keyHigh: 127, velocityHigh: 127 }];
  const changed = bindInstrumentNote({ ...base, assets: { ...base.assets, ...prepared.assets } }, 60, prepared.source);
  const mapping = noteMappings(changed, 60)[0];
  expect(mapping).toMatchObject({ rootMidi: 48, keyLow: 60, keyHigh: 60 });
  const project = definitionProject(changed, true), note = project.inputs[0].player.score!.notes[0];
  note.midi = 60; note.velocity = 100;
  expect(selectRegion(changed.instrument, note, 0, new Map())?.id).toBe(mapping.id);
  const audio = renderProject(project, 8000).left;
  let crossings = 0;
  for (let i = 800; i < 3200; i++) if (audio[i] <= 0 && audio[i + 1] > 0) crossings++;
  expect(crossings).toBeGreaterThanOrEqual(119);
  expect(crossings).toBeLessThanOrEqual(121);
  expect(noteMappings(changed, 59)[0].id).toBe("shared");
});

it("counts release recordings separately and never makes the primary recording play a second file", () => {
  const d = fixture(); d.instrument.regions = [{ ...d.instrument.regions[0], releaseAssetId: "hard" }];
  const summaries = recordingSummaries(d);
  expect(summaries).toHaveLength(2);
  expect(summaries.find(r => r.id === "hard")?.release).toBe(true);
  const parent = resourceFromDefinition(d);
  const main = recordingResource(parent, "soft", "Main").payload as RecordingDefinition;
  const release = recordingResource(parent, "hard", "Release").payload as RecordingDefinition;
  expect(main.asset.id).toBe("soft");
  expect(release.asset.id).toBe("hard");
  expect(main).not.toHaveProperty("releaseAssetId");
  expect(release).not.toHaveProperty("releaseAssetId");
});

it("exposes all attack and release recordings of the complete piano independently", () => {
  const piano = BUILTIN_SOUNDS.find(s => s.id === "instrument-vcsl-kawai")!;
  expect(piano.recordings).toHaveLength(222);
  expect(new Set(piano.recordings!.map(r => r.id)).size).toBe(222);
  expect(piano.recordings!.filter(r => r.release)).toHaveLength(84);
  expect(piano.recordings!.filter(r => !r.release)).toHaveLength(138);
  for (const sound of BUILTIN_SOUNDS.filter(s => s.kind === "instrument")) {
    expect(parseRecordingSummaries(sound.recordings)).toHaveLength(new Set(sound.recordingIds).size);
  }
});

it("validates recording index metadata before use", () => {
  const [recording] = recordingSummaries(fixture());
  for (const patch of [{ rootMidi: 128 }, { velocityLow: 0 }, { velocityHigh: 0 }, { variant: 0 }, { id: "" }, { release: "yes" }]) {
    expect(() => parseRecordingSummaries([{ ...recording, ...patch }])).toThrow("resources.invalid");
  }
  expect(() => parseRecordingSummaries([recording, recording])).toThrow("resources.invalid");
  expect(() => parseRecordingSummaries(Array(65).fill(recording))).toThrow("resources.invalid");
});
