import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const recordingId = sample => createHash('sha256').update(sample.sourcePath).digest('hex');
// Short editable tones retain every velocity/round-robin take. Partition at root
// boundaries so a selected range never drops a dynamic layer to meet a budget.
export const TONE_SECONDS = 4;
const PACK_BYTES = 10 * 1024 * 1024;
const assetBytes = samples => [...new Map(samples.map(s => [s.wavFile, s])).values()]
  .reduce((n, s) => n + Math.min(Math.round(s.durationSeconds * 48000), TONE_SECONDS * 48000) * 8, 0);
export function instrumentJobs(manifest, base) {
  const jobs = [];
  for (const samples of Map.groupBy(manifest.samples, s => `${s.instrumentId}:${s.articulation}`).values()) {
    const roots = [...Map.groupBy(samples, s => s.rootMidi)].sort((a, b) => a[0] - b[0]);
    const chunks = []; let chunk = [];
    for (const [, group] of roots) {
      if (assetBytes(group) > PACK_BYTES) throw Error('A root exceeds the tone budget');
      if (chunk.length && (assetBytes([...chunk, ...group]) > PACK_BYTES || chunk.length + group.length > 64)) {
        chunks.push(chunk); chunk = [];
      }
      chunk.push(...group);
    }
    if (chunk.length) chunks.push(chunk);
    for (const selected of chunks) {
      const first = selected[0];
      const keyLow = Math.min(...selected.map(s => s.keyLow)), keyHigh = Math.max(...selected.map(s => s.keyHigh));
      jobs.push({
        id: `tone-${first.instrumentId}-${first.articulation}-${keyLow}-${keyHigh}`,
        kind: 'instrument', nameKey: `builtin.instrument.${first.instrumentId}`, category: first.family,
        articulation: first.articulation, tone: true, keyLow, keyHigh, maxSourceSeconds: TONE_SECONDS,
        recordingIds: [...new Set(selected.map(recordingId))],
        sourceFiles: [...new Set(selected.map(s => `${base}/${s.wavFile}`))], samples: selected, base,
        keywords: `${first.instrumentId} ${first.articulation} multisample dynamics 音区 力度 轮替`,
      });
    }
  }
  return jobs;
}

export async function instrumentProject(job, root, { makeLayer, encodeSamples }) {
  const assets = {}, regions = [];
  for (const s of job.samples) {
    const id = recordingId(s), wav = await readFile(path.join(root, job.base, s.wavFile));
    if (createHash('sha256').update(wav).digest('hex') !== s.wavSha256 || wav.toString('ascii', 36, 40) !== 'data' ||
        wav.readUInt32LE(24) !== 48000 || wav.readUInt16LE(22) !== 2 || wav.readUInt16LE(34) !== 16)
      throw Error(`Invalid tone source: ${s.id}`);
    if (!assets[id]) {
      const frames = Math.min(wav.readUInt32LE(40) / 4, TONE_SECONDS * 48000);
      const channels = [0, 1].map(c => encodeSamples(Float32Array.from({ length: frames }, (_, i) => wav.readInt16LE(44 + i * 4 + c * 2) / 32768)));
      assets[id] = { id, name: `${s.instrumentId} ${s.rootNote} · ${s.articulation}${s.durationSeconds > TONE_SECONDS ? ' · 4s excerpt' : ''}`, sampleRate: 48000, channels };
    }
    regions.push({ id: s.id, assetId: id, rootMidi: s.rootMidi, keyLow: s.keyLow, keyHigh: s.keyHigh,
      velocityLow: Math.max(1, s.velocityLow), velocityHigh: s.velocityHigh, articulation: s.articulation,
      roundRobin: s.roundRobin?.index ?? Math.round((s.roundRobin?.randomLow ?? 0) * 100),
      tuneCents: Number(s.sourceEffectiveOpcodes?.tune ?? 0), gainDb: s.conversion.recommendedRegionGainDb,
      releaseSeconds: Math.max(.005, Math.min(3, s.release.envelopeSeconds, Math.min(s.durationSeconds, TONE_SECONDS) - .03)) });
  }
  const candidates = [...regions].sort((a, b) => Math.abs(a.rootMidi - 60) - Math.abs(b.rootMidi - 60));
  const chosen = candidates.find(r => r.velocityLow <= 80 && r.velocityHigh >= 80) ?? candidates[0];
  const sample = job.samples.find(s => s.id === chosen.id);
  const playable = regions.filter(r => chosen.rootMidi >= r.keyLow && chosen.rootMidi <= r.keyHigh);
  const available = r => Math.min(job.samples.find(s => s.id === r.id).durationSeconds, TONE_SECONDS)
    / 2 ** ((chosen.rootMidi - r.rootMidi + r.tuneCents / 100) / 12);
  const held = Math.max(.005, Math.min(.6, ...playable.map(r => available(r) - .02)));
  // Include every velocity and alternate take's tail, not just the first take.
  const duration = Math.max(.2, ...playable.map(r => Math.min(available(r), held + r.releaseSeconds) + .05));
  const instrument = { id: job.id, name: sample.instrumentName, source: sample.sourceUrl, license: sample.license, regions };
  return { schema: 'momo.soundforge/v2', name: job.id, seed: 2048, duration, master: 1, echo: 0, assets,
    layers: [makeLayer({ id: `layer-${job.id}`, name: job.id, type: 'instrument', duration,
      frequency: 440, endFrequency: 440, attack: 0, release: 0, decay: 0, gain: 1, cutoff: 22000,
      score: { schema: 'momo.score/v1', bpm: 120, instruments: [instrument], notes: [
        { id: 'tone', instrumentId: instrument.id, midi: chosen.rootMidi, velocity: Math.max(chosen.velocityLow, Math.min(80, chosen.velocityHigh)),
          start: 0, duration: held * 2, articulation: chosen.articulation },
      ] } })] };
}
