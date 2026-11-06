import { expect, it } from "vitest";
import { bindInstrumentNote, instrumentSource, noteMappings } from "../src/instrumentMapping";
import { BASIC_SYNTH } from "../src/synthesizers";
import { definitionProject, type InstrumentDefinition } from "../src/soundDefinitions";
import { renderProject } from "../src/engine";
import { resourceFromDefinition, resourceFromProject, resourceFromRecording, resourceProject } from "../src/soundResources";
import { makeLayer, makeProject, projectDocument, parseProject, encodeSamples } from "../src/model";

const definition = (): InstrumentDefinition => ({ schema: "momo.instrument/v1", instrument: {
  id: "keys", name: "Keys", regions: [{ id: "shared", assetId: "", synth: structuredClone(BASIC_SYNTH),
    rootMidi: 60, keyLow: 48, keyHigh: 72, velocityLow: 1, velocityHigh: 127,
    articulation: "sustain", roundRobin: 0, gainDb: -2, tuneCents: 0, releaseSeconds: 0.15 }],
}, assets: {} });
function play(d: InstrumentDefinition, midi: number) {
  const project = definitionProject(d, true);
  project.inputs[0].player.score!.notes[0].midi = midi;
  return renderProject(project, 8000).left;
}

it('keeps unpitched recordings at original speed across notes and clears that behavior when replaced',async()=>{
  const source=resourceFromRecording({id:'hit',name:'Hit',sampleRate:8000,channels:[encodeSamples(Float32Array.from({length:4000},(_,i)=>.2*Math.sin(2*Math.PI*200*i/8000)))]});
  const prepared=await instrumentSource(source,async()=>{throw Error('must reuse recording');});
  const d=bindInstrumentNote({...definition(),assets:prepared.assets},60,prepared.source);
  d.instrument.regions=d.instrument.regions.filter(r=>r.id!=='shared').map(r=>({...r,keyHigh:72}));
  expect(d.instrument.regions[0].fixedPitch).toBe(true);
  expect(play(d,60)).toEqual(play(d,72));
  const reopened=parseProject(projectDocument(definitionProject(d)));
  expect(play({...d,instrument:reopened.inputs[0].player.score!.instruments[0]},72)).toEqual(play(d,72));
  if(prepared.source.type!=="recording")throw Error("expected recording");
  const exact={...d,instrument:{...d.instrument,regions:d.instrument.regions.map(r=>({...r,keyHigh:60}))}};
  const replaced=bindInstrumentNote(exact,60,{...prepared.source,rootMidi:48,fixedPitch:false});
  expect(noteMappings(replaced,60)[0].fixedPitch).toBeUndefined();
  expect(play(replaced,60)).not.toEqual(play(exact,60));
});

it("assigns one note without altering the shared range or neighboring notes, and removal restores the shared sound", () => {
  const original = definition(), before = structuredClone(original);
  const source = { ...structuredClone(BASIC_SYNTH), name: "Square", defaults: { ...BASIC_SYNTH.defaults, wave: "square" as const } };
  const changed = bindInstrumentNote(original, 61, { type: "synth", synth: source });
  expect(original).toEqual(before);
  expect(changed.instrument.regions[0]).toMatchObject(before.instrument.regions[0]);
  expect(noteMappings(changed, 61)[0]).toMatchObject({ keyLow: 61, keyHigh: 61, rootMidi: 61, synth: { name: "Square" } });
  expect(play(changed, 60)).toEqual(play(original, 60));
  expect(play(changed, 62)).toEqual(play(original, 62));
  expect(play(changed, 61)).not.toEqual(play(original, 61));
  const removed = { ...changed, instrument: { ...changed.instrument, regions: changed.instrument.regions.filter(r => r.id === "shared") } };
  expect(play(removed, 61)).toEqual(play(original, 61));
});

it("replaces an exact note in place and preserves its performance settings and other variants", () => {
  const d = definition();
  d.instrument.regions = [
    { ...d.instrument.regions[0], id: "soft", keyLow: 60, keyHigh: 60, velocityHigh: 63, synthValues: {} },
    { ...d.instrument.regions[0], id: "hard", keyLow: 60, keyHigh: 60, velocityLow: 64 },
  ];
  const next = bindInstrumentNote(d, 60, { type: "synth", synth: { ...BASIC_SYNTH, name: "Replacement" } }, "soft");
  expect(next.instrument.regions).toHaveLength(2);
  expect(next.instrument.regions[0]).toMatchObject({ id: "soft", velocityHigh: 63, gainDb: -2, releaseSeconds: 0.15, synth: { name: "Replacement" } });
  expect(next.instrument.regions[1]).toMatchObject(d.instrument.regions[1]);
  expect(next.instrument.regions[0].synthValues).toEqual({});
});

it("uses the library sound's exact rendered audio and packs it into the instrument independently", async () => {
  const p = makeProject("Layered source");
  p.duration = 0.25; p.master = 0.7;
  p.inputs = [makeLayer({ duration: 0.25, wave: "triangle", gain: 0.4 }), makeLayer({ duration: 0.2, frequency: 550, gain: 0.2 })];
  const resource = resourceFromProject(p), expected = renderProject(resourceProject(resource), 8000);
  const prepared = await instrumentSource(resource, async project => renderProject(project, 8000));
  const next = bindInstrumentNote({ ...definition(), assets: prepared.assets }, 60, prepared.source);
  const saved = parseProject(projectDocument(definitionProject(next)));
  expect(Object.values(saved.assets)).toHaveLength(1);
  const asset = Object.values(saved.assets)[0];
  expect(asset.name).toBe("Layered source");
  const { decodeSamples } = await import("../src/model");
  expect(decodeSamples(asset.channels[0])).toEqual(expected.left);
  expect(decodeSamples(asset.channels[1])).toEqual(expected.right);
  resource.name = "Changed in library";
  expect(asset.name).toBe("Layered source");
});

it("keeps a library synthesizer as a generator and fails without mutating the instrument on invalid sources or limits", async () => {
  const d = definition(), snapshot = structuredClone(d);
  const prepared = await instrumentSource(resourceFromDefinition(BASIC_SYNTH), async () => { throw Error("must not render a synth"); });
  expect(prepared.source.type).toBe("synth"); expect(prepared.assets).toEqual({});
  await expect(instrumentSource(resourceFromDefinition(structuredClone(d)), async () => { throw Error(); })).rejects.toThrow("instrument.invalidSource");
  const full = { ...d, instrument: { ...d.instrument, regions: Array.from({ length: 128 }, (_, index) => ({ ...d.instrument.regions[0], id: `region-${index}` })) } };
  expect(() => bindInstrumentNote(full, 61, prepared.source)).toThrow();
  expect(d).toEqual(snapshot);
});
