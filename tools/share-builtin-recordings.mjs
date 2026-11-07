import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Change only transport/storage: verify every existing Float32 sample before
// replacing the embedded prefix with a reference to the complete working WAV.
export async function shareBuiltinRecordings(project, recordings, output) {
  const shared = structuredClone(project), byId = new Map(recordings.map(r => [r.id, r]));
  for (const [id, asset] of Object.entries(shared.assets)) {
    if (asset.reference) continue;
    const recording = byId.get(id);
    if (!recording || asset.sampleRate !== 48000 || asset.channels.length !== 2)
      throw Error(`Missing complete recording for tone asset: ${id}`);
    const compressed = await readFile(path.join(output, recording.file));
    if (compressed.length !== recording.compressedBytes || createHash('sha256').update(compressed).digest('hex') !== recording.sha256)
      throw Error(`Invalid shared recording: ${id}`);
    const wav = gunzipSync(compressed, { maxOutputLength: recording.decodedBytes });
    if (wav.length !== recording.decodedBytes || wav.length !== 44 + recording.frames * 4)
      throw Error(`Invalid recording length: ${id}`);
    const channels = asset.channels.map(c => Buffer.from(c, 'base64')), frames = channels[0].length / 4;
    if (!Number.isInteger(frames) || frames < 1 || frames > recording.frames || channels[1].length !== channels[0].length)
      throw Error(`Invalid tone prefix: ${id}`);
    for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) {
      let expected = wav.readInt16LE(44 + i * 4 + c * 2) / 32768;
      for (const gain of recording.assetGains) expected = Math.fround(expected * gain);
      if (!Object.is(channels[c].readFloatLE(i * 4), expected)) throw Error(`Tone PCM differs from recording: ${id} frame ${i}`);
    }
    const { file, sha256, compressedBytes, decodedBytes, assetGains } = recording;
    asset.channels = [];
    asset.reference = { schema: 'momo.builtin-sample/v1', file, sha256, compressedBytes, decodedBytes,
      frames: recording.frames, assetGains: [...assetGains], ...(frames < recording.frames ? { frameLimit: frames } : {}) };
  }
  return shared;
}
