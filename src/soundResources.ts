import { parseProject, projectDocument, uid, type Project } from './model';
import { parseDefinition, definitionName, definitionProject, type SoundDefinition } from './soundDefinitions';
import { parseRecording, recordingProject, type RecordingDefinition } from './recordingDefinition';
import type { SampleAsset } from './model';

export type ResourceKind = 'recording' | 'synth' | 'instrument' | 'sound';
// Origin belongs to a catalog entry, not to the portable sound algorithm.
// A future remote provider can implement this interface without changing resource payloads.
export type ResourceSource = {kind:'builtin';id:string} | {kind:'local';libraryId:string} | {kind:'remote';libraryId:string;catalogUrl:string};
export interface ResourceProvider { source:ResourceSource; list():Promise<Omit<SoundResource,'schema'|'payload'>[]>; load(id:string):Promise<SoundResource> }
export type SoundResource = {
  schema: 'momo.sound-resource/v1'; id: string; version: number; name: string;
  kind: ResourceKind; category: string; description: string;
  payload: unknown; preview: number[];
};
export const RESOURCE_BYTES = 40 * 1024 * 1024;
export function parseResource(raw: unknown): SoundResource {
  const r = raw as SoundResource;
  if (!r || r.schema !== 'momo.sound-resource/v1' || typeof r.id !== 'string' || !/^[a-zA-Z0-9-]{1,120}$/.test(r.id) ||
    !Number.isSafeInteger(r.version) || r.version < 1 || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 120 ||
    !['recording', 'synth', 'instrument', 'sound'].includes(r.kind) || typeof r.category !== 'string' || r.category.length > 120 ||
    typeof r.description !== 'string' || r.description.length > 2000 || !Array.isArray(r.preview) || r.preview.length > 160 ||
    r.preview.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1)) throw Error('resources.invalid');
  let payload: unknown;
  if (r.kind === 'sound') payload = projectDocument({...parseProject(r.payload),name:r.name.trim()});
  else if(r.kind==='recording')payload=parseRecording(r.payload);
  else {
    const d = parseDefinition(r.payload);
    if (d.schema !== (r.kind === 'synth' ? 'momo.synth/v1' : 'momo.instrument/v1')) throw Error('resources.invalid');
    if(d.schema==='momo.synth/v1')d.name=r.name.trim();else d.instrument.name=r.name.trim();payload = d;
  }
  return { schema: r.schema, id: r.id, version: r.version, name: r.name.trim(), kind: r.kind,
    category: r.category, description: r.description, payload, preview: [...r.preview] };
}
export function resourceFromDefinition(d: SoundDefinition, id:string=uid()): SoundResource {
  const clean = parseDefinition(d);
  return parseResource({ schema: 'momo.sound-resource/v1', id, version: 1, name: definitionName(clean),
    kind: clean.schema === 'momo.synth/v1' ? 'synth' : 'instrument', category: 'uncategorized', description: '', payload: clean, preview: [] });
}
export function resourceFromProject(p: Project, preview: number[] = [], id:string=uid()): SoundResource {
  return parseResource({ schema: 'momo.sound-resource/v1', id, version: 1, name: p.name,
    kind: 'sound', category: 'uncategorized', description: '', payload: projectDocument(p), preview });
}
export function resourceProject(r: SoundResource, audition = false): Project {
  return r.kind === 'sound' ? parseProject(r.payload) : r.kind==='recording'?recordingProject(r.payload,r.name):definitionProject(parseDefinition(r.payload), audition);
}
export function resourceFromRecording(asset:SampleAsset,rootMidi:number|null=null,id:string=uid()):SoundResource {
  return parseResource({schema:'momo.sound-resource/v1',id,version:1,name:asset.name,kind:'recording',category:'uncategorized',description:'',preview:[],
    payload:{schema:'momo.recording/v1',asset,rootMidi,tuneCents:0,gainDb:0,releaseSeconds:.15} satisfies RecordingDefinition});
}
export function importResource(raw: unknown): SoundResource {
  const schema = (raw as {schema?: string})?.schema;
  if (schema === 'momo.sound-resource/v1') return parseResource(raw);
  if(schema==='momo.recording/v1'){const d=parseRecording(raw);return parseResource({...resourceFromRecording(d.asset,d.rootMidi),payload:d});}
  if (schema === 'momo.synth/v1' || schema === 'momo.instrument/v1') return resourceFromDefinition(parseDefinition(raw));
  return resourceFromProject(parseProject(raw));
}
