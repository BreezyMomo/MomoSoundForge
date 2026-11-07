import { readAsset } from './sound-asset-store.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { recordingId } from './builtin-instruments.mjs';

export function pianoJob(manifest, base) {
  return { id: 'instrument-vcsl-kawai', kind: 'instrument', completeInstrument: true,
    nameKey: 'builtin.instrument.vcsl-kawai', category: 'keys', articulation: 'single-hit', keyLow: 21, keyHigh: 108,
    keywords: 'piano kawai grand 钢琴 完整键盘 88', samples: manifest.samples, base, recordingIds: manifest.samples.map(recordingId),
    sourceFiles: [base + '/manifest.json', base + '/mappings/Kawai.sfz', base + '/licenses/VCSL-README.md', ...manifest.samples.map(s => `${base}/${s.wavFile}`)] };
}

export async function pianoProject(job, root, { makeLayer }) {
  const assets = {};
  for (const s of job.samples) {
    const id = recordingId(s), wav = await readAsset(root, `${job.base}/${s.wavFile}`);
    if (createHash('sha256').update(wav).digest('hex') !== s.wavSha256) throw Error(`Piano source mismatch: ${s.id}`);
    const compressed = gzipSync(wav, { level: 6 }), sha256 = createHash('sha256').update(compressed).digest('hex');
    await writeFile(path.join(root, 'public/sound-library', `${sha256}.recording.bin`), compressed);
    assets[id] = { id, name: `${s.rootNote} ${s.trigger === 'release' ? 'release' : 'piano'} ${s.velocityLow}-${s.velocityHigh}`,
      sampleRate: 48000, channels: [], reference: { schema: 'momo.builtin-sample/v1', file: `${sha256}.recording.bin`, sha256,
        frames: wav.readUInt32LE(40) / 4, decodedBytes: wav.length, compressedBytes: compressed.length, assetGains: [] } };
  }
  const releases = job.samples.filter(s => s.trigger === 'release');
  const pairs = job.samples.filter(s => s.trigger === 'attack').flatMap(s => {
    const candidates = releases.filter(r => r.keyLow <= s.keyHigh && r.keyHigh >= s.keyLow);
    const keys = [...new Set([s.keyLow, s.keyHigh + 1, ...candidates.flatMap(r => [r.keyLow, r.keyHigh + 1])])]
      .filter(v => v >= s.keyLow && v <= s.keyHigh + 1).sort((a, b) => a - b);
    return keys.slice(0, -1).flatMap((keyLow, keyIndex) => {
      const keyHigh = keys[keyIndex + 1] - 1, eligible = candidates.filter(r => keyLow >= r.keyLow && keyHigh <= r.keyHigh);
      const cuts = [...new Set([s.velocityLow, s.velocityHigh + 1, ...eligible.flatMap(r => [r.velocityLow, r.velocityHigh + 1])])]
        .filter(v => v >= s.velocityLow && v <= s.velocityHigh + 1).sort((a, b) => a - b);
      return cuts.slice(0, -1).map((low, index) => {
        const high = cuts[index + 1] - 1, matches = eligible.filter(r => low >= r.velocityLow && high <= r.velocityHigh);
        if (matches.length > 1) throw Error(`Ambiguous release: ${s.id} ${keyLow} ${low}-${high}`);
        return { s: { ...s, id: keyIndex || index ? `${s.id}-key-${keyLow}-${keyHigh}-velocity-${low}-${high}` : s.id,
          keyLow, keyHigh, velocityLow: low, velocityHigh: high }, r: matches[0] };
      });
    });
  });
  const regions = pairs.map(({ s, r }) => {
    const ops = s.sourceEffectiveOpcodes;
    return { id: s.id, assetId: recordingId(s), rootMidi: s.rootMidi, keyLow: s.keyLow, keyHigh: s.keyHigh,
      velocityLow: s.velocityLow, velocityHigh: s.velocityHigh, articulation: 'single-hit', roundRobin: 0,
      sampleOffset: s.offsetFrames, tuneCents: Number(ops.tune ?? 0), gainDb: s.conversion.recommendedRegionGainDb,
      releaseSeconds: Number(ops.ampeg_release ?? .4),
      envelope: { attack: Number(ops.ampeg_attack ?? 0), decay: Number(ops.ampeg_decay ?? 0), sustain: Number(ops.ampeg_sustain ?? 100) / 100 },
      ...(r ? { releaseAssetId: recordingId(r), releaseVoice: { rootMidi: r.rootMidi, tuneCents: Number(r.sourceEffectiveOpcodes.tune ?? 0),
        gainDb: r.conversion.recommendedRegionGainDb, offset: r.offsetFrames, decayDbPerSecond: Number(r.sourceEffectiveOpcodes.rt_decay ?? 0) } } : {}) };
  });
  const usedReleases = new Set(regions.map(r => r.releaseAssetId).filter(Boolean));
  if (usedReleases.size !== releases.length) throw Error('Some author release recordings were not mapped');
  const instrument = { id: job.id, name: 'Kawai Grand Piano', source: 'https://github.com/sgossner/VCSL', license: 'CC0-1.0', keyRange: { low: 21, high: 108 }, regions };
  return { schema: 'momo.soundforge/v4', name: job.id, seed: 2048, duration: 3, master: 1, echo: 0, assets,
    inputs: [makeLayer({ id: 'kawai-piano', name: job.id, type: 'instrument', duration: 3,
      gain: 1, attack: 0, release: 0, decay: 0, cutoff: 22000,
      score: { schema: 'momo.score/v1', bpm: 120, instruments: [instrument], notes: [
        { id: 'piano-preview', instrumentId: instrument.id, midi: 60, velocity: 90, start: 0, duration: 1, articulation: 'single-hit' },
      ] } })] };
}
