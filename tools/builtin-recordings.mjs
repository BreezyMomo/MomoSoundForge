import { readAsset } from './sound-asset-store.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deterministicGzip as gzipSync } from './deterministic-gzip.mjs';
import { recordingId } from './builtin-instruments.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Complete working PCM, independent of a budgeted instrument's performance clips. */
export async function buildRecordings(job, project, summaries, assetGains, root, output) {
  const result = [];
  for (const summary of summaries) {
    const sample = job.samples ? job.samples.find(s => recordingId(s) === summary.id) : job.sample;
    if (!sample) throw Error(`Missing recording provenance: ${summary.id}`);
    const wav = await readAsset(root, job.samples ? `${job.base}/${sample.wavFile}` : job.source);
    const frames = wav.readUInt32LE(40) / 4;
    if (hash(wav) !== sample.wavSha256 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
      || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 2 || wav.readUInt32LE(24) !== 48000
      || wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data'
      || !Number.isInteger(frames) || frames < 1 || frames > 120 * 48000 || wav.length !== 44 + frames * 4)
      throw Error(`Invalid complete recording: ${sample.id}`);
    const bytes = gzipSync(wav, { level: 6 }), sha256 = hash(bytes), file = `${sha256}.recording.bin`;
    if (bytes.length > 12 * 1024 * 1024) throw Error(`Recording exceeds transport budget: ${sample.id}`);
    await writeFile(path.join(output, file), bytes);
    const original = project.inputs[0].player.score.instruments[0].regions.find(r => r.assetId === summary.id || r.releaseAssetId === summary.id);
    const region = summary.release && original.releaseVoice ? { ...original, ...original.releaseVoice } : original;
    result.push({ ...summary, ...(sample.pitched === false || sample.rootMidi === null ? { unpitched: true } : {}),
      name: path.basename(sample.wavFile), nameKey: job.nameKey, category: job.category,
      revision: 2, file, sha256, compressedBytes: bytes.length, decodedBytes: wav.length, frames, duration: frames / 48000,
      assetGains, gainDb: region.gainDb, tuneCents: region.tuneCents, releaseSeconds: region.releaseSeconds,
      source: { provider: 'Versilian Studios', url: sample.sourceUrl, author: sample.author, license: sample.license,
        licenseUrl: sample.licenseUrl, quality: 'original', retrievedAt: job.completeInstrument ? '2026-11-07T00:00:00Z' : '2026-11-05T00:00:00Z' } });
  }
  return result;
}
