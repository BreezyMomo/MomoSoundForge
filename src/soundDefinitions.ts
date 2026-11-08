import { BASIC_SYNTH, parseSynth, synthValues, type SynthDefinition } from "./synthesizers";
import { emptyScore, noteEndSeconds, type Instrument } from "./instruments";
import { makeLayer, makeProject, parseProject, projectForSave, uid, type Project, type SampleAsset } from "./model";
export type InstrumentDefinition = {
  schema: "momo.instrument/v1";
  instrument: Instrument;
  assets: Record<string, SampleAsset>;
};
export type SoundDefinition = SynthDefinition | InstrumentDefinition;
export const definitionId = (d: SoundDefinition) => d.schema === "momo.synth/v1" ? d.id : d.instrument.id;
export const definitionName = (d: SoundDefinition) => d.schema === "momo.synth/v1" ? d.name : d.instrument.name;
/** A synth can voice a note track without creating a separate library resource. */
export function noteTrackDefinition(raw: SoundDefinition): InstrumentDefinition {
  const d = parseDefinition(raw);
  if (d.schema === 'momo.instrument/v1') return d;
  return { schema: 'momo.instrument/v1', assets: {}, instrument: {
    id: uid(), name: d.name, keyRange: { low: 0, high: 127 }, regions: [{
      id: uid(), assetId: '', synth: d, synthValues: synthValues(d), rootMidi: 60,
      keyLow: 0, keyHigh: 127, velocityLow: 1, velocityHigh: 127,
      articulation: 'normal', roundRobin: 0, tuneCents: 0, gainDb: 0, releaseSeconds: 0.12,
    }],
  } };
}
export function parseDefinition(raw: unknown): SoundDefinition {
  const d = raw as SoundDefinition;
  if (d?.schema === "momo.synth/v1") return parseSynth(d);
  if (d?.schema !== "momo.instrument/v1" || !d.instrument || !d.assets) throw Error("definition.invalid");
  const p = parseProject({ ...makeProject(d.instrument.name), assets: d.assets,
    inputs: [makeLayer({ type: "instrument", score: { ...emptyScore(), instruments: [d.instrument] } })] });
  return { schema: "momo.instrument/v1", instrument: p.inputs[0].player.score!.instruments[0], assets: projectForSave(p).assets };
}
export function definitionProject(raw: SoundDefinition, preview = false): Project {
  const d = parseDefinition(raw), p = makeProject(definitionName(d));
  p.master = 1; p.duration = d.schema === "momo.synth/v1" ? 0.5 : 2;
  if (d.schema === "momo.synth/v1") {
    p.inputs = [makeLayer({ name: d.name, synth: d, ...d.defaults, duration: p.duration })];
  } else {
    const instrument = structuredClone(d.instrument), score = { ...emptyScore(), instruments: [instrument] };
    if (preview) {
      const r = instrument.regions.find(r => d.assets[r.assetId]?.reference && r.keyLow <= 60 && r.keyHigh >= 60 && r.velocityLow <= 90 && r.velocityHigh >= 90) ?? instrument.regions[0];
      score.notes = [{ id: 'definition-audition', instrumentId: instrument.id, midi: Math.max(r.keyLow,Math.min(r.keyHigh,r.rootMidi)),
        velocity: Math.round((r.velocityLow + r.velocityHigh) / 2), articulation: r.articulation, start: 0, duration: 1 }];
      p.duration = Math.max(p.duration, noteEndSeconds(score.notes[0], r, d.assets, score.bpm));
    }
    p.assets = structuredClone(d.assets);
    p.inputs = [makeLayer({ name: instrument.name, type: "instrument", score, duration: p.duration,
      gain: 1, attack: 0, release: 0, decay: 0, cutoff: 22000 })];
  }
  return p;
}
/** Definitions are immutable snapshots in players; replacing one never edits library records. */
export function bindDefinition(project: Project, id: string, raw: SoundDefinition): Project {
  const d = parseDefinition(raw), target = project.inputs.find(l => l.id === id);
  if (!target || target.player.type !== (d.schema === "momo.synth/v1" ? "synth" : "instrument")) throw Error("definition.typeMismatch");
  let assets = project.assets;
  const input = structuredClone(target);
  if (d.schema === "momo.synth/v1") {
    input.player = { ...input.player, ...d.defaults, synth: d, synthValues: synthValues(d) };
    // Parameter bindings belong to the old algorithm's parameter meanings.
    if (target.player.synth?.algorithm !== d.algorithm) {
      if (input.automation) { input.automation = {...input.automation}; delete input.automation.cutoff; }
      project = {...project, controls:project.controls?.map(c=>({...c,mappings:c.mappings.filter(b=>b.layerId !== id || ['start','gain','pan'].includes(b.parameter))}))};
    }
  } else {
    const mapping = new Map(Object.keys(d.assets).map(k => [k, uid()]));
    assets = { ...assets, ...Object.fromEntries(Object.values(d.assets).map(a => {
      const id = mapping.get(a.id)!; return [id, { ...a, id }];
    })) };
    const instrument = structuredClone(d.instrument);
    instrument.regions = instrument.regions.map(r => ({ ...r, assetId: r.synth ? '' : mapping.get(r.assetId)!,
      ...(r.releaseAssetId ? { releaseAssetId: mapping.get(r.releaseAssetId)! } : {}) }));
    input.player.score = { ...(input.player.score ?? emptyScore()), instruments: [instrument],
      // Keep the note values intact. The editor exposes mapping choices for
      // uncovered notes instead of silently changing the user's composition.
      notes: (input.player.score?.notes ?? []).map(n => ({ ...n, instrumentId: instrument.id })) };
  }
  // All parent read settings, notes, own effects and the player body duration survive selection.
  return parseProject(projectForSave({ ...project, assets, inputs: project.inputs.map(l => l.id === id ? input : l) }));
}
export function synthFromPlayer(project: Project, id: string): SynthDefinition {
  const p = project.inputs.find(l => l.id === id)?.player;
  if (p?.type !== "synth") throw Error("definition.typeMismatch");
  return parseSynth({ ...(p.synth ?? BASIC_SYNTH), ...(p.synth?.program?{program:{...p.synth.program,parameters:p.synth.program.parameters.map(x=>({...x,default:p.synthValues?.[x.variable]??x.default}))}}:{}), defaults: { wave: p.wave, frequency: p.frequency,
    endFrequency: p.endFrequency, attack: p.attack, release: p.release, decay: p.decay, cutoff: p.cutoff, drive: p.drive } });
}
