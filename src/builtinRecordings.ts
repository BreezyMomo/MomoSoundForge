import catalog from './data/builtin-catalog.json';
import { createBuiltinFileLoader, type BuiltinFile } from './builtinFiles';
import { encodeSamples, type SampleAsset } from './model';
import { parseResource } from './soundResources';
import type { RecordingSummary } from './recordingSources';

export type BuiltinRecording = RecordingSummary & BuiltinFile & {
  nameKey: string; category: string; revision: number; frames: number; duration: number;
  assetGains: number[]; gainDb: number; tuneCents: number; releaseSeconds: number; source: SampleAsset['source'];
};
export const BUILTIN_RECORDINGS = (catalog as unknown as { recordings: BuiltinRecording[] }).recordings;
export function createBuiltinRecordingLoader(
  recordings: readonly BuiltinRecording[] = BUILTIN_RECORDINGS,
  fetcher: (url: string) => Promise<Response> = url => fetch(url),
  base = import.meta.env?.BASE_URL ?? '/',
) {
  const entries = new Map(recordings.map(r => [r.id, r]));
  const files = createBuiltinFileLoader(recordings, fetcher, base);
  return async (id: string, name?: string) => {
    try {
      const r = entries.get(id);
      if (!r || !Number.isInteger(r.frames) || r.frames < 1 || r.frames > 30 * 48000
        || !Array.isArray(r.assetGains) || r.assetGains.length > 2 || r.assetGains.some(g => !Number.isFinite(g) || g <= 0 || g > 1000))
        throw Error('library.builtinLoadError');
      const bytes = await files.load(id), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const tag = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
      if (bytes.length !== 44 + r.frames * 4 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt '
        || tag(36) !== 'data' || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16
        || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 2 || view.getUint32(24, true) !== 48000
        || view.getUint32(28, true) !== 192000 || view.getUint16(32, true) !== 4 || view.getUint16(34, true) !== 16
        || view.getUint32(40, true) !== r.frames * 4) throw Error('library.builtinLoadError');
      const channels = [0, 1].map(c => encodeSamples(Float32Array.from({ length: r.frames }, (_, i) => {
        let value = view.getInt16(44 + i * 4 + c * 2, true) / 32768;
        // Match the legacy builder's sequential Float32 gain passes exactly.
        for (const gain of r.assetGains) value = Math.fround(value * gain);
        return value;
      })));
      return parseResource({ schema: 'momo.sound-resource/v1', id: `builtin-recording-${id}`, version: r.revision,
        name: name ?? r.name, kind: 'recording', category: r.category, description: '', preview: [],
        payload: { schema: 'momo.recording/v1', asset: { id, name: r.name, sampleRate: 48000, channels, source: r.source },
          rootMidi: r.unpitched ? null : r.rootMidi, gainDb: r.gainDb, tuneCents: r.tuneCents, releaseSeconds: r.releaseSeconds } });
    } catch { files.invalidate(id); throw Error('library.builtinLoadError'); }
  };
}
export const loadBuiltinRecording = createBuiltinRecordingLoader();
