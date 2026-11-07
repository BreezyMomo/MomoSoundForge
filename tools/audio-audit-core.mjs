import { createHash } from 'node:crypto';
import { levels } from './audit-builtin-library.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Canonical PCM identity: UTF-8 header, then planar IEEE float32 little-endian.
// Includes rate/channel/frame count; never confuse this with a file hash or PCM16 payload hash.
export function pcmHash(channels, sampleRate) {
  if (!channels.length || channels.some(c => c.length !== channels[0].length)) throw Error('Invalid channel layout');
  const hash = createHash('sha256').update(`momo.pcm-f32le/v1\n${sampleRate}\n${channels.length}\n${channels[0].length}\n`);
  for (const channel of channels) {
    const bytes = Buffer.alloc(channel.length * 4);
    channel.forEach((x, i) => { if (!Number.isFinite(x)) throw Error('Non-finite PCM'); bytes.writeFloatLE(x, i * 4); });
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function measure(channels, sampleRate) {
  return { ...levels(channels, sampleRate), sampleRate, channels: channels.length, frames: channels[0].length,
    duration: channels[0].length / sampleRate, pcmSha256: pcmHash(channels, sampleRate) };
}

// Only the fixed PCM16 working format emitted by our collectors is accepted here.
// Independent libsndfile decoding in audit-source-audio.py also checks these files.
export function workingPcm(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.toString('ascii', 12, 16) !== 'fmt ' || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1
    || bytes.readUInt16LE(22) !== 2 || bytes.readUInt32LE(24) !== 48000 || bytes.readUInt16LE(34) !== 16
    || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44 || (bytes.length - 44) % 4) {
    throw Error('Unsupported working WAV');
  }
  const frames = (bytes.length - 44) / 4;
  return [0, 1].map(c => Float32Array.from({ length: frames }, (_, i) => bytes.readInt16LE(44 + i * 4 + c * 2) / 32768));
}

// Compare embedded audio against the same-length working prefix, allowing only
// a reported constant gain. Longer tails are recorded, not classified as bad audio.
export function compareEmbedded(working, embedded, sampleRate) {
  if (working.length !== embedded.length || embedded.some((c, i) => c.length > working[i].length))
    return { comparable: false, reason: 'channel-count-or-frame-count' };
  let xx = 0, xy = 0;
  for (let c = 0; c < working.length; c++) for (let i = 0; i < embedded[c].length; i++) {
    xx += working[c][i] ** 2; xy += working[c][i] * embedded[c][i];
  }
  const gain = xx > 0 ? xy / xx : 1;
  let maxResidual = 0;
  for (let c = 0; c < working.length; c++) for (let i = 0; i < embedded[c].length; i++)
    maxResidual = Math.max(maxResidual, Math.abs(embedded[c][i] - working[c][i] * gain));
  const removed = working.map(c => c.subarray(embedded[0].length));
  return { comparable: true, gain, gainDb: gain > 0 ? 20 * Math.log10(gain) : null, maxResidual,
    prefixMatchesWithGain: maxResidual < 1e-6, removedSeconds: removed[0].length / sampleRate,
    removedTail: removed[0].length ? levels(removed, sampleRate) : null };
}

export function representativeRegions(regions) {
  const result = [];
  for (const [articulation, group] of Map.groupBy(regions, r => r.articulation)) {
    const roots = [...new Set(group.map(r => r.rootMidi))].sort((a, b) => a - b);
    const selectedRoots = [...new Set([roots[0], roots[Math.floor((roots.length - 1) / 2)], roots.at(-1)])];
    for (const root of selectedRoots) {
      const atRoot = group.filter(r => r.rootMidi === root);
      // Every actual velocity band and alternate take; do not invent soft/medium/hard.
      for (const region of atRoot) result.push({ regionId: region.id, midi: root, articulation,
        velocity: Math.round((Math.max(1, region.velocityLow) + region.velocityHigh) / 2) });
    }
  }
  return result;
}

export function mappingCoverage(instrument, selectRegion, seed = 2048) {
  const groups = [], failures = [], reached = new Set();
  for (const [articulation, regions] of Map.groupBy(instrument.regions, r => r.articulation)) {
    const low = Math.min(...regions.map(r => r.keyLow)), high = Math.max(...regions.map(r => r.keyHigh));
    const gaps = [], overlaps = [];
    let coveredCells = 0;
    for (let midi = 0; midi <= 127; midi++) {
      const missing = [];
      for (let velocity = 1; velocity <= 127; velocity++) {
        const note = { midi, velocity, articulation, instrumentId: instrument.id };
        const candidates = regions.filter(r => midi >= r.keyLow && midi <= r.keyHigh && velocity >= r.velocityLow && velocity <= r.velocityHigh);
        const occurrences = new Map();
        const selected = selectRegion(instrument, note, seed, occurrences);
        if (!!selected !== !!candidates.length || (selected && !candidates.includes(selected))) failures.push({ midi, velocity, articulation });
        if (selected) {
          coveredCells++; reached.add(selected.id);
          // Reachability includes every alternate at every boundary cell, not
          // just the first seed-selected take or a group's midpoint probe.
          for (let index = 1; index < candidates.length; index++) {
            const alternative = selectRegion(instrument, note, seed, occurrences);
            if (alternative) reached.add(alternative.id);
          }
        }
        else if (midi >= low && midi <= high) missing.push(velocity);
        // Different roots/ranges can compete; same-range alternate takes are intentional.
        if (candidates.length > 1 && new Set(candidates.map(r => `${r.rootMidi}:${r.keyLow}:${r.keyHigh}:${r.velocityLow}:${r.velocityHigh}`)).size > 1)
          overlaps.push({ midi, velocity, candidates: candidates.map(r => r.id), selected: selected?.id });
      }
      if (missing.length) gaps.push({ midi, velocityRanges: contiguousRanges(missing) });
    }
    const cycles = [];
    const rrGroups = Map.groupBy(regions, r => JSON.stringify([r.playbackGroup ?? r.rootMidi, r.keyLow, r.keyHigh, r.velocityLow, r.velocityHigh]));
    for (const alternatives of rrGroups.values()) {
      const r = alternatives[0], note = { midi: Math.max(r.keyLow, Math.min(r.rootMidi, r.keyHigh)), velocity: Math.round((r.velocityLow + r.velocityHigh) / 2), articulation };
      const counters = new Map();
      const sequence = Array.from({ length: alternatives.length * 2 }, () => selectRegion(instrument, note, seed, counters)?.id);
      sequence.forEach(id => { if (id) reached.add(id); });
      cycles.push({ ...note, expected: alternatives.map(r => r.id), sequence,
        allAlternativesReached: alternatives.every(r => sequence.includes(r.id)),
        repeatsAfterOneCycle: sequence.slice(0, alternatives.length).every((id, i) => id === sequence[i + alternatives.length]) });
    }
    groups.push({ articulation, keyLow: low, keyHigh: high, coveredCells, gaps, overlaps, cycles });
  }
  return { testedCells: groups.length * 128 * 127, seed, failures, groups,
    unreachedRegions: instrument.regions.filter(r => !reached.has(r.id)).map(r => r.id) };
}

function contiguousRanges(values) {
  const ranges = [];
  for (const value of values) {
    if (ranges.at(-1)?.[1] === value - 1) ranges.at(-1)[1] = value;
    else ranges.push([value, value]);
  }
  return ranges;
}
