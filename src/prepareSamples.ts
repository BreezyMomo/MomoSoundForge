import { parseSampleReference, sampleFrames, embeddedFrames } from './sampleReference';
import { requiredScoreAssets } from './instruments';
import { encodeSamples, parseProject, MAX_ASSET_BYTES, type Project } from './model';
import { audioChannels, createAudioReader } from './sharedAudio';
export const projectHasReferences = (p: Project): boolean => Object.values(p.assets).some(a => a.reference)
  || p.inputs.some(l => l.player.mix && projectHasReferences(l.player.mix));

export function createSamplePreparer(_fetcher?: (url: string) => Promise<Response>, _base = import.meta.env?.BASE_URL ?? '/') {
  const readAudio = createAudioReader();
  return async (raw: Project, signal?: AbortSignal): Promise<Project> => {
    const project = parseProject(raw), jobs: { project: Project; id: string; frames: number }[] = [];
    let bytes = 0;
    const check = () => { if (signal?.aborted) throw Error('cancelled'); };
    const plan = (p: Project) => {
      const required = new Map<string, number>();
      for (const input of p.inputs) {
        const player = input.player;
        // Include muted voices as well, so unmuting a saved part stays portable.
        if (player.mix) plan(player.mix);
        if (player.type === 'sample' && player.assetId && p.assets[player.assetId]) required.set(player.assetId, sampleFrames(p.assets[player.assetId]));
        if (player.score) for (const [id, n] of requiredScoreAssets(player.score, p.assets, player.noiseSeed))
          required.set(id, Math.max(required.get(id) ?? 0, n));
      }
      for (const [id, asset] of Object.entries(p.assets)) {
        if (!asset.reference) { bytes += asset.channels.reduce((n, c) => n + c.length * .75, 0); continue; }
        const frames = required.get(id) ?? 0;
        bytes += frames * 4 * (asset.reference.schema === 'momo.audio-reference/v1' ? asset.reference.channelCount : 2);
        if (!frames) { asset.channels = []; continue; }
        if (embeddedFrames(asset) >= frames) {
          // Keeping only the needed prefix avoids accumulating all previously played notes.
          if (embeddedFrames(asset) > frames) {
            // Re-encode below from the existing data without fetching a source again.
            asset.channels = asset.channels.map(c => {
              const binary = atob(c), buffer = Uint8Array.from(binary.slice(0, frames * 4), x => x.charCodeAt(0));
              return encodeSamples(new Float32Array(buffer.buffer));
            });
          }
        } else jobs.push({ project: p, id, frames });
      }
    };
    check(); plan(project);
    if (bytes > MAX_ASSET_BYTES) throw Error('error.budget');
    // Sequential decoding bounds transient PCM memory; compressed requests share a bounded cache.
    for (const job of jobs) {
      check(); const asset = job.project.assets[job.id], r = parseSampleReference(asset.reference);
      if(r.schema === 'momo.audio-reference/v1') {
        asset.channels = audioChannels(await readAudio(asset),job.frames).map(encodeSamples); check(); continue;
      }
      throw Error('resources.missing');
    }
    check(); return parseProject(project);
  };
}
export const prepareProjectSamples = createSamplePreparer();
