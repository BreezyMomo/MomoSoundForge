import { createBuiltinFileLoader } from './builtinFiles';
import { parseSampleReference, sampleFrames, embeddedFrames } from './sampleReference';
import { requiredScoreAssets } from './instruments';
import { encodeSamples, parseProject, MAX_ASSET_BYTES, type Project } from './model';
export const projectHasReferences = (p: Project): boolean => Object.values(p.assets).some(a => a.reference)
  || p.inputs.some(l => l.player.mix && projectHasReferences(l.player.mix));

export function createSamplePreparer(fetcher: (url: string) => Promise<Response> = url => fetch(url), base = import.meta.env?.BASE_URL ?? '/') {
  const files = createBuiltinFileLoader([], fetcher, base);
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
        bytes += frames * 8;
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
      const wav = await files.loadFile({ ...r, id: r.sha256 }); check();
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      const tag = (n: number) => String.fromCharCode(...wav.subarray(n, n + 4));
      if (wav.length !== 44 + r.frames * 4 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt '
        || tag(36) !== 'data' || view.getUint32(4, true) !== wav.length - 8 || view.getUint32(16, true) !== 16
        || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 2 || view.getUint32(24, true) !== 48000
        || view.getUint32(28, true) !== 192000 || view.getUint16(32, true) !== 4 || view.getUint16(34, true) !== 16
        || view.getUint32(40, true) !== r.frames * 4) throw Error('error.sampleReference');
      asset.channels = [0, 1].map(ch => encodeSamples(Float32Array.from({ length: job.frames }, (_, i) => {
        let value = view.getInt16(44 + i * 4 + ch * 2, true) / 32768;
        for (const gain of r.assetGains) value = Math.fround(value * gain);
        return value;
      })));
    }
    check(); return parseProject(project);
  };
}
export const prepareProjectSamples = createSamplePreparer();
