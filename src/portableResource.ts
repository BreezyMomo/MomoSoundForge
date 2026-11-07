import { parseResource, resourceProject, type SoundResource } from './soundResources';
import { projectDocument } from './model';
import { prepareProjectSamples } from './prepareSamples';
import type { RecordingDefinition } from './recordingDefinition';

/** Preserve library definitions; embed audio required by a saved composition or recording. */
export async function portableResource(raw: SoundResource, prepare = prepareProjectSamples): Promise<SoundResource> {
  const r = parseResource(raw);
  if (r.kind === 'sound') return parseResource({ ...r, payload: projectDocument(await prepare(resourceProject(r))) });
  if (r.kind === 'recording') {
    const d = r.payload as RecordingDefinition, project = await prepare(resourceProject(r));
    return parseResource({ ...r, payload: { ...d, asset: project.assets[d.asset.id] } });
  }
  return r;
}
