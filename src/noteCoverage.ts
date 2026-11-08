import type { Instrument, NoteEvent } from "./instruments";

export type CoverageIssue =
  "instrument" | "articulation" | "pitch" | "velocity";

// Eligibility must agree with selectRegion; sample choice and round robin stay in the engine.
export function noteCoverageIssue(
  instrument: Instrument | undefined,
  note: NoteEvent,
): CoverageIssue | undefined {
  if (!instrument) return "instrument";
  const articulation = instrument.regions.filter(
    (r) => r.articulation === note.articulation,
  );
  if (!articulation.length) return "articulation";
  const pitch = articulation.filter(
    (r) => note.midi >= r.keyLow && note.midi <= r.keyHigh,
  );
  if (!pitch.length) return "pitch";
  if (
    !pitch.some(
      (r) => note.velocity >= r.velocityLow && note.velocity <= r.velocityHigh,
    )
  )
    return "velocity";
}

export function playablePitches(
  instrument: Instrument | undefined,
  note: NoteEvent,
): number[] {
  return Array.from({ length: 128 }, (_, midi) => midi).filter(
    (midi) => !noteCoverageIssue(instrument, { ...note, midi }),
  );
}

export function playableVelocities(
  instrument: Instrument | undefined,
  note: NoteEvent,
): number[] {
  return Array.from({ length: 127 }, (_, i) => i + 1).filter(
    (velocity) => !noteCoverageIssue(instrument, { ...note, velocity }),
  );
}

export function nearestPlayableVelocity(
  instrument: Instrument | undefined,
  note: NoteEvent,
  requested: number,
): number {
  const values = playableVelocities(instrument, note);
  if (!values.length || !Number.isFinite(requested)) return note.velocity;
  return values.reduce((best, velocity) =>
    Math.abs(velocity - requested) < Math.abs(best - requested)
      ? velocity
      : best,
  );
}

/** Reject only a new unmapped pitch; preserve timing and existing invalid notes. */
export function constrainNotePitch(
  instrument: Instrument | undefined,
  proposed: NoteEvent,
  previous: NoteEvent,
): NoteEvent {
  return proposed.midi !== previous.midi &&
    noteCoverageIssue(instrument, proposed)
    ? { ...proposed, midi: previous.midi }
    : proposed;
}

export function pitchRanges(pitches: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const pitch of [...new Set(pitches)].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && pitch === last[1] + 1) last[1] = pitch;
    else ranges.push([pitch, pitch]);
  }
  return ranges;
}

// A proposal only: callers must require an explicit user action before applying it.
export function suggestPlayableNote(
  instrument: Instrument | undefined,
  note: NoteEvent,
): NoteEvent | undefined {
  return playableNoteCandidates(instrument, note)[0];
}

/** Return deterministic, distinct playable choices for an invalid note. */
export function playableNoteCandidates(
  instrument: Instrument | undefined,
  note: NoteEvent,
): NoteEvent[] {
  if (!instrument || !noteCoverageIssue(instrument, note)) return [];
  const sameArt = instrument.regions.filter(
    (r) => r.articulation === note.articulation,
  );
  const candidates = (sameArt.length ? sameArt : instrument.regions).map(
    (r) => ({
      region: r.id,
      note: {
        ...note,
        midi: Math.max(r.keyLow, Math.min(r.keyHigh, note.midi)),
        velocity: Math.max(
          r.velocityLow,
          Math.min(r.velocityHigh, note.velocity),
        ),
        articulation: r.articulation,
      },
    }),
  );
  candidates.sort(
    (a, b) =>
      Math.abs(a.note.midi - note.midi) - Math.abs(b.note.midi - note.midi) ||
      Math.abs(a.note.velocity - note.velocity) -
        Math.abs(b.note.velocity - note.velocity) ||
      a.region.localeCompare(b.region, "en"),
  );
  const seen = new Set<string>();
  return candidates
    .map((candidate) => candidate.note)
    .filter((candidate) => {
      const key = `${candidate.midi}:${candidate.velocity}:${candidate.articulation}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export const velocityPercent = (velocity: number) =>
  Math.round((velocity / 127) * 100);
export const percentVelocity = (percent: number) =>
  Math.max(1, Math.min(127, Math.round((percent / 100) * 127)));
