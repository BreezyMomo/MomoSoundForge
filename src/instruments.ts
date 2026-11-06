import type { SampleAsset } from "./model";
import { decodeSamples, stableHash, rng } from "./model";
import { parseSynth, synthValues, expressionVoice, synthSample, type SynthDefinition } from './synthesizers';
import { compileExpression } from './synthExpression';
export const MAX_SCORE_NOTES = 256;
export const MAX_TOTAL_NOTES = 1024;
export type SampleRegion = {
  id: string;
  assetId: string;
  synth?: SynthDefinition;
  synthValues?: Record<string, number>;
  rootMidi: number;
  fixedPitch?: boolean;
  keyLow: number;
  keyHigh: number;
  velocityLow: number;
  velocityHigh: number;
  articulation: string;
  roundRobin: number;
  tuneCents: number;
  gainDb: number;
  releaseSeconds: number;
  releaseAssetId?: string;
  loop?: { start: number; end: number; crossfade: number; verified: true };
};
export type Instrument = {
  id: string;
  name: string;
  source?: string;
  license?: string;
  regions: SampleRegion[];
};
export type NoteEvent = {
  id: string;
  instrumentId: string;
  midi: number;
  start: number;
  duration: number;
  velocity: number;
  articulation: string;
};
export type Score = {
  schema: "momo.score/v1";
  bpm: number;
  instruments: Instrument[];
  notes: NoteEvent[];
};
export const beatsToSeconds = (beat: number, bpm: number) => (beat * 60) / bpm;
export const secondsToBeats = (seconds: number, bpm: number) =>
  (seconds * bpm) / 60;
export const emptyScore = (): Score => ({
  schema: "momo.score/v1",
  bpm: 120,
  instruments: [],
  notes: [],
});
const number = (v: unknown, low: number, high: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= low && v <= high;
const integer = (v: unknown, low: number, high: number) =>
  number(v, low, high) && Number.isInteger(v);
const text = (v: unknown, max = 120) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
export function validateScore(
  score: Score,
  assets: Record<string, SampleAsset>,
) {
  const fail = (): never => {
    throw Error("score.invalid");
  };
  if (
    !score ||
    score.schema !== "momo.score/v1" ||
    !number(score.bpm, 20, 300) ||
    !Array.isArray(score.instruments) ||
    score.instruments.length > 8 ||
    !Array.isArray(score.notes) ||
    score.notes.length > MAX_SCORE_NOTES
  )
    fail();
  const ids = new Set<string>();
  let regions = 0;
  for (const inst of score.instruments) {
    if (
      !inst ||
      !text(inst.id) ||
      ids.has(inst.id) ||
      !text(inst.name) ||
      !Array.isArray(inst.regions) ||
      !inst.regions.length ||
      (inst.source !== undefined && !text(inst.source, 1000)) ||
      (inst.license !== undefined && !text(inst.license, 1000))
    )
      fail();
    ids.add(inst.id);
    const regionIds = new Set<string>();
    for (const r of inst.regions) {
      if (
        ++regions > 128 ||
        !r ||
        !text(r.id) ||
        regionIds.has(r.id) ||
        (!r.synth && (!text(r.assetId) || !Object.hasOwn(assets, r.assetId))) ||
        !integer(r.rootMidi, 0, 127) ||
        (r.fixedPitch !== undefined && typeof r.fixedPitch !== 'boolean') ||
        !integer(r.keyLow, 0, 127) ||
        !integer(r.keyHigh, r.keyLow, 127) ||
        !integer(r.velocityLow, 1, 127) ||
        !integer(r.velocityHigh, r.velocityLow, 127) ||
        !text(r.articulation, 60) ||
        !integer(r.roundRobin, 0, 127) ||
        !number(r.tuneCents, -1200, 1200) ||
        !number(r.gainDb, -60, 24) ||
        !number(r.releaseSeconds, 0.005, 3)
      )
        fail();
      regionIds.add(r.id);
      if (r.synth) {
        r.synth = parseSynth(r.synth); r.synthValues = synthValues(r.synth,r.synthValues);
        if (r.assetId !== '' || r.loop || r.releaseAssetId) fail();
      }
      if (
        r.releaseAssetId !== undefined &&
        (!text(r.releaseAssetId) || !Object.hasOwn(assets, r.releaseAssetId))
      )
        fail();
      if (r.loop) {
        const frames = channels(assets[r.assetId])[0].length,
          loop = r.loop;
        if (
          loop.verified !== true ||
          !integer(loop.start, 0, frames - 33) ||
          !integer(loop.end, loop.start + 32, frames) ||
          !integer(loop.crossfade, 16, Math.floor((loop.end - loop.start) / 2))
        )
          fail();
      }
    }
  }
  const noteIds = new Set<string>();
  for (const n of score.notes) {
    if (
      !n ||
      !text(n.id) ||
      noteIds.has(n.id) ||
      !text(n.instrumentId) ||
      !integer(n.midi, 0, 127) ||
      !integer(n.velocity, 1, 127) ||
      !number(n.start, 0, Number.MAX_VALUE) ||
      !number(n.duration, 0.005, Number.MAX_VALUE) ||
      !text(n.articulation, 60) ||
      !Number.isFinite(beatsToSeconds(n.start + n.duration, score.bpm))
    )
      fail();
    // Unknown instruments remain editable and explicitly silent, rather than silently substituted.
    noteIds.add(n.id);
  }
}
export function scoreAssets(score: Score): string[] {
  return score.instruments.flatMap((i) =>
    i.regions.flatMap((r) =>
      r.synth ? [] : r.releaseAssetId ? [r.assetId, r.releaseAssetId] : [r.assetId],
    ),
  );
}
export function orderedNotes(score: Score) {
  return [...score.notes].sort(
    (a, b) => a.start - b.start || a.id.localeCompare(b.id, "en"),
  );
}
export function compareNoteRegions(midi: number, a: SampleRegion, b: SampleRegion) {
  // Explicit assignments to a single key override broader shared ranges.
  return Number(b.keyLow === b.keyHigh) - Number(a.keyLow === a.keyHigh)
    || Math.abs(midi - a.rootMidi) - Math.abs(midi - b.rootMidi)
    || a.keyHigh - a.keyLow - (b.keyHigh - b.keyLow)
    || a.velocityHigh - a.velocityLow - (b.velocityHigh - b.velocityLow)
    || a.id.localeCompare(b.id, "en");
}
export function selectRegion(
  instrument: Instrument | undefined,
  note: NoteEvent,
  seed: number,
  occurrences: Map<string, number>,
): SampleRegion | undefined {
  if (!instrument) return;
  const candidates = instrument.regions
    .filter(
      (r) =>
        r.articulation === note.articulation &&
        note.midi >= r.keyLow &&
        note.midi <= r.keyHigh &&
        note.velocity >= r.velocityLow &&
        note.velocity <= r.velocityHigh,
    )
    .sort((a, b) => compareNoteRegions(note.midi, a, b));
  const first = candidates[0];
  if (!first) return;
  const group = candidates
    .filter(
      (r) =>
        r.rootMidi === first.rootMidi &&
        r.keyLow === first.keyLow &&
        r.keyHigh === first.keyHigh &&
        r.velocityLow === first.velocityLow &&
        r.velocityHigh === first.velocityHigh,
    )
    .sort(
      (a, b) => a.roundRobin - b.roundRobin || a.id.localeCompare(b.id, "en"),
    );
  const key = JSON.stringify([
    instrument.id,
    note.articulation,
    first.rootMidi,
    first.keyLow,
    first.keyHigh,
    first.velocityLow,
    first.velocityHigh,
  ]);
  const count = occurrences.get(key) ?? 0;
  occurrences.set(key, count + 1);
  return group[
    ((((stableHash(key) ^ seed) >>> 0) % group.length) + count) % group.length
  ];
}
export type ScoreIssue = { noteId: string; key: string };
export function noteEndSeconds(
  note: NoteEvent,
  region: SampleRegion | undefined,
  assets: Record<string, SampleAsset>,
  bpm: number,
) {
  const start = beatsToSeconds(note.start, bpm),
    held = beatsToSeconds(note.duration, bpm);
  if (region?.synth) return start + held + region.releaseSeconds;
  if (!region || !assets[region.assetId]) return start + held;
  const a = assets[region.assetId],
    rate = 2 ** (((region.fixedPitch ? 0 : note.midi - region.rootMidi) + region.tuneCents / 100) / 12);
  const available = channels(a)[0].length / a.sampleRate / rate;
  const main = region.loop
    ? held + region.releaseSeconds
    : Math.min(available, held + region.releaseSeconds);
  const release = region.releaseAssetId
    ? assets[region.releaseAssetId]
    : undefined;
  const releaseEnd = release
    ? held +
      Math.min(
        region.releaseSeconds,
        channels(release)[0].length / release.sampleRate / rate,
      )
    : 0;
  return start + Math.max(main, releaseEnd);
}
export function scoreIssues(
  score: Score,
  assets: Record<string, SampleAsset>,
  duration: number,
  seed = 0,
): ScoreIssue[] {
  const counters = new Map<string, number>(),
    issues: ScoreIssue[] = [];
  for (const n of orderedNotes(score)) {
    const inst = score.instruments.find((i) => i.id === n.instrumentId),
      r = selectRegion(inst, n, seed, counters);
    const warn = (key: string) => issues.push({ noteId: n.id, key });
    if (!inst) {
      warn("score.missingInstrument");
      continue;
    }
    if (!r) {
      warn("score.noRegion");
      continue;
    }
    if (r.synth) { if (noteEndSeconds(n,r,assets,score.bpm)>duration+0.001) warn('score.tailClipped'); continue; }
    const asset = assets[r.assetId];
    if (!asset) {
      warn("score.missingSample");
      continue;
    }
    const rate = 2 ** (((r.fixedPitch ? 0 : n.midi - r.rootMidi) + r.tuneCents / 100) / 12);
    const available = channels(asset)[0].length / asset.sampleRate / rate;
    if (!r.loop && beatsToSeconds(n.duration, score.bpm) > available)
      warn("score.noSustain");
    if (noteEndSeconds(n, r, assets, score.bpm) > duration + 0.001)
      warn("score.tailClipped");
  }
  return issues;
}
const cache = new WeakMap<SampleAsset, Float32Array[]>();
function channels(a: SampleAsset) {
  let c = cache.get(a);
  if (!c) {
    c = a.channels.map(decodeSamples);
    cache.set(a, c);
  }
  return c;
}
function read(c: Float32Array, p: number) {
  if (p < 0 || p >= c.length - 1) return 0;
  const i = Math.floor(p),
    f = p - i;
  return c[i] * (1 - f) + c[i + 1] * f;
}
export function renderScore(
  score: Score,
  assets: Record<string, SampleAsset>,
  seconds: number,
  sampleRate: number,
  seed: number,
  budget = {synthOperations:0},
) {
  const left = new Float32Array(Math.round(seconds * sampleRate)),
    right = new Float32Array(left.length),
    counters = new Map<string, number>();
  for (const note of orderedNotes(score)) {
    const region = selectRegion(
      score.instruments.find((i) => i.id === note.instrumentId),
      note,
      seed,
      counters,
    );
    if (region?.synth) {
      const s = region.synth, defaults = s.defaults;
      const held = beatsToSeconds(note.duration,score.bpm), duration = held + region.releaseSeconds;
      const frames = Math.ceil(duration*sampleRate), start = Math.round(beatsToSeconds(note.start,score.bpm)*sampleRate);
      const cost=s.program?compileExpression(s.program.expression,s.program.parameters.map(p=>p.variable)).cost:4;
      budget.synthOperations+=Math.min(frames,Math.max(0,left.length-start))*cost;
      if (frames > 8_000_000 || budget.synthOperations>60_000_000) throw Error('error.renderBudget');
      const random = rng((seed ^ stableHash(note.id))>>>0), expression = expressionVoice(s,region.synthValues,random,frames);
      const frequency = 440 * 2**((note.midi-69+region.tuneCents/100)/12), gain = (note.velocity/127)*10**(region.gainDb/20);
      const alpha = 1-Math.exp(-2*Math.PI*Math.min(defaults.cutoff,sampleRate*0.45)/sampleRate);
      let phase=0, filter=0, previous=0, dcPrevious=0;
      for(let i=0;i<frames && start+i<left.length;i++) {
        const t=i/sampleRate; phase=(phase+Math.min(frequency,sampleRate*0.45)/sampleRate)%1;
        const raw=expression ? expression(t,phase,frequency,duration,note.velocity/127) : synthSample('oscillator-v1',defaults.wave,phase,random);
        filter+=alpha*(raw-filter); const dc=filter-previous+0.995*dcPrevious; previous=filter;dcPrevious=dc;
        const attack=Math.min(1,t/Math.max(0.003,defaults.attack)), release=Math.min(1,Math.max(0,(duration-t)/region.releaseSeconds));
        const value=(defaults.drive ? Math.tanh(dc*(1+defaults.drive))/Math.tanh(1+defaults.drive):dc)*attack*release*Math.exp(-defaults.decay*t/duration)*gain;
        left[start+i]+=value;right[start+i]+=value;
      }
      continue;
    }
    if (!region || !assets[region.assetId]) continue;
    const asset = assets[region.assetId],
      data = channels(asset),
      releaseAsset = region.releaseAssetId
        ? assets[region.releaseAssetId]
        : undefined,
      releaseData = releaseAsset ? channels(releaseAsset) : undefined;
    const step =
      (asset.sampleRate / sampleRate) *
      2 ** (((region.fixedPitch ? 0 : note.midi - region.rootMidi) + region.tuneCents / 100) / 12);
    const start = Math.round(
        beatsToSeconds(note.start, score.bpm) * sampleRate,
      ),
      held = Math.round(beatsToSeconds(note.duration, score.bpm) * sampleRate);
    const tail = Math.round(region.releaseSeconds * sampleRate),
      gain = (note.velocity / 127) * 10 ** (region.gainDb / 20),
      loop = region.loop;
    let pos = 0;
    for (let i = 0; i < held + tail && start + i < left.length; i++) {
      const off = i >= held;
      if (loop && pos >= loop.end)
        pos =
          loop.start +
          loop.crossfade +
          ((pos - loop.end) % (loop.end - loop.start - loop.crossfade));
      const attack = Math.min(1, i / (sampleRate * 0.003));
      const fade = off
        ? Math.max(
            0,
            1 -
              (i - held) /
                (releaseData ? Math.min(tail, sampleRate * 0.03) : tail),
          )
        : 1;
      for (let ch = 0; ch < 2; ch++) {
        const c = data[ch] ?? data[0];
        let value = read(c, pos);
        if (loop && pos >= loop.end - loop.crossfade) {
          const u = (pos - (loop.end - loop.crossfade)) / loop.crossfade;
          value =
            value * (1 - u) +
            read(c, loop.start + pos - (loop.end - loop.crossfade)) * u;
        }
        // Source-end taper also protects unlooped one-shots that run out before note-off.
        value *=
          (loop
            ? 1
            : Math.min(
                1,
                Math.max(0, (c.length - 1 - pos) / (step * sampleRate * 0.005)),
              )) *
          attack *
          fade;
        if (off && releaseData && releaseAsset) {
          const p =
              ((i - held) * step * releaseAsset.sampleRate) / asset.sampleRate,
            rc = releaseData[ch] ?? releaseData[0];
          value +=
            read(rc, p) *
            Math.min(
              1,
              (i - held) / (sampleRate * 0.003),
              Math.max(0, (held + tail - i) / (sampleRate * 0.005)),
              Math.max(
                0,
                (rc.length - 1 - p) /
                  (((step * releaseAsset.sampleRate) / asset.sampleRate) *
                    sampleRate *
                    0.005),
              ),
            );
        }
        (ch === 0 ? left : right)[start + i] += value * gain;
      }
      pos += step;
    }
  }
  return { left, right };
}
export function importNoteEvents(
  raw: unknown,
  score: Score,
  instrumentId: string,
  articulation: string,
): Score {
  const r = raw as {
    schema?: string;
    format?: string;
    bpm?: number;
    notes?: Array<Record<string, unknown>>;
  };
  if (!r || !Array.isArray(r.notes) || r.notes.length > MAX_SCORE_NOTES)
    throw Error("score.invalid");
  if (r.schema === "momo.note-events/v1")
    return {
      ...score,
      bpm: r.bpm as number,
      notes: r.notes.map((n) => ({ ...n })) as NoteEvent[],
    };
  if (r.format !== "melody-design/recipe-v1") throw Error("score.invalid");
  return {
    ...score,
    notes: r.notes.map((n, i) => ({
      id: `note-${i + 1}`,
      instrumentId,
      midi: n.midi as number,
      velocity: n.velocity as number,
      start: secondsToBeats(n.startSeconds as number, score.bpm),
      duration: secondsToBeats(n.durationSeconds as number, score.bpm),
      articulation,
    })),
  };
}
