import { describe, expect, it } from "vitest";
import {
  selectRegion,
  type Instrument,
  type NoteEvent,
  type SampleRegion,
} from "../src/instruments";
import {
  noteCoverageIssue,
  playablePitches,
  pitchRanges,
  suggestPlayableNote,
  playableNoteCandidates,
  velocityPercent,
  percentVelocity,
  constrainNotePitch,
  playableVelocities,
  nearestPlayableVelocity,
} from "../src/noteCoverage";

const region = (patch: Partial<SampleRegion> = {}): SampleRegion => ({
  id: "middle",
  assetId: "sample",
  rootMidi: 60,
  keyLow: 58,
  keyHigh: 63,
  velocityLow: 61,
  velocityHigh: 110,
  articulation: "single-hit",
  roundRobin: 0,
  tuneCents: 0,
  gainDb: 0,
  releaseSeconds: 0.1,
  ...patch,
});
const instrument: Instrument = {
  id: "piano",
  name: "My piano",
  regions: [
    region(),
    region({ id: "high", rootMidi: 68, keyLow: 67, keyHigh: 70 }),
    region({ id: "soft", velocityLow: 1, velocityHigh: 20 }),
    region({ id: "short", articulation: "staccato", keyLow: 60, keyHigh: 60 }),
    region({
      id: "lowest",
      rootMidi: 0,
      keyLow: 0,
      keyHigh: 0,
      velocityLow: 1,
      velocityHigh: 127,
    }),
    region({
      id: "highest",
      rootMidi: 127,
      keyLow: 127,
      keyHigh: 127,
      velocityLow: 1,
      velocityHigh: 127,
    }),
  ],
};
const note: NoteEvent = {
  id: "n",
  instrumentId: "piano",
  midi: 60,
  velocity: 80,
  start: 0.77,
  duration: 1.22,
  articulation: "single-hit",
};

describe("recorded note coverage", () => {
  it("exposes strength gaps for the selected pitch and style", () => {
    expect(pitchRanges(playableVelocities(instrument, note))).toEqual([
      [1, 20],
      [61, 110],
    ]);
    expect(
      pitchRanges(
        playableVelocities(instrument, { ...note, articulation: "staccato" }),
      ),
    ).toEqual([[61, 110]]);
    expect(playableVelocities(instrument, { ...note, midi: 65 })).toEqual([]);
  });
  it("maps any requested strength to an eligible sample without changing other note properties", () => {
    for (let requested = 1; requested <= 127; requested++) {
      const velocity = nearestPlayableVelocity(instrument, note, requested);
      expect(
        selectRegion(instrument, { ...note, velocity }, 42, new Map()),
      ).toBeDefined();
    }
    expect(nearestPlayableVelocity(instrument, note, 40)).toBe(20);
    expect(nearestPlayableVelocity(instrument, note, 41)).toBe(61);
    expect(nearestPlayableVelocity(instrument, note, 127)).toBe(110);
    expect(note.velocity).toBe(80);
  });
  it("does not replace missing instruments, pitch or style when adjusting strength", () => {
    expect(nearestPlayableVelocity(undefined, note, 100)).toBe(note.velocity);
    const missing = { ...note, articulation: "unknown", velocity: 17 };
    expect(nearestPlayableVelocity(instrument, missing, 100)).toBe(17);
    expect(nearestPlayableVelocity(instrument, note, NaN)).toBe(note.velocity);
  });
  it("blocks unmapped pitch moves while retaining horizontal edits and the last valid pitch", () => {
    const previous = { ...note, midi: 63 };
    const proposed = { ...note, midi: 65, start: 2 };
    expect(constrainNotePitch(instrument, proposed, previous)).toEqual({
      ...proposed,
      midi: 63,
    });
    const valid = { ...proposed, midi: 67 };
    expect(constrainNotePitch(instrument, valid, previous)).toBe(valid);
    expect(previous.midi).toBe(63);
  });
  it("uses the note's style and strength when blocking a move", () => {
    const soft = { ...note, velocity: 10 };
    expect(
      constrainNotePitch(instrument, { ...soft, midi: 67 }, soft).midi,
    ).toBe(60);
    const short = { ...note, articulation: "staccato" };
    expect(
      constrainNotePitch(instrument, { ...short, midi: 61 }, short).midi,
    ).toBe(60);
    expect(
      constrainNotePitch(undefined, { ...note, midi: 61 }, note).midi,
    ).toBe(60);
  });
  it("keeps existing invalid notes editable and allows moving them back into coverage", () => {
    const invalid = { ...note, midi: 64 };
    const resized = { ...invalid, duration: 3 };
    expect(constrainNotePitch(instrument, resized, invalid)).toBe(resized);
    const repaired = { ...invalid, midi: 63 };
    expect(constrainNotePitch(instrument, repaired, invalid)).toBe(repaired);
    expect(
      constrainNotePitch(instrument, { ...invalid, midi: 65 }, invalid).midi,
    ).toBe(64);
  });
  it("distinguishes missing instruments, styles, pitches and strength", () => {
    expect(noteCoverageIssue(undefined, note)).toBe("instrument");
    expect(
      noteCoverageIssue(instrument, { ...note, articulation: "unknown" }),
    ).toBe("articulation");
    expect(noteCoverageIssue(instrument, { ...note, midi: 65 })).toBe("pitch");
    expect(noteCoverageIssue(instrument, { ...note, velocity: 40 })).toBe(
      "velocity",
    );
    expect(noteCoverageIssue(instrument, note)).toBeUndefined();
  });
  it("agrees with actual engine selection across pitch and strength boundaries and holes", () => {
    for (const articulation of ["single-hit", "staccato", "unknown"]) {
      for (const midi of [0, 1, 57, 58, 60, 63, 64, 66, 67, 70, 71, 126, 127]) {
        for (const velocity of [1, 20, 21, 60, 61, 110, 111, 127]) {
          const n = { ...note, articulation, midi, velocity };
          expect(!noteCoverageIssue(instrument, n)).toBe(
            !!selectRegion(instrument, n, 42, new Map()),
          );
        }
      }
    }
  });
  it("retains gaps and scopes ranges by the current style and strength", () => {
    expect(pitchRanges(playablePitches(instrument, note))).toEqual([
      [0, 0],
      [58, 63],
      [67, 70],
      [127, 127],
    ]);
    expect(
      pitchRanges(playablePitches(instrument, { ...note, velocity: 10 })),
    ).toEqual([
      [0, 0],
      [58, 63],
      [127, 127],
    ]);
    expect(
      pitchRanges(
        playablePitches(instrument, { ...note, articulation: "staccato" }),
      ),
    ).toEqual([[60, 60]]);
    expect(playablePitches(undefined, note)).toEqual([]);
    expect(pitchRanges([3, 1, 3, 2, 7])).toEqual([
      [1, 3],
      [7, 7],
    ]);
  });
  it("proposes the nearest playable correction without altering timing, IDs or input", () => {
    const original = { ...note, midi: 65, velocity: 40 };
    const before = structuredClone(original);
    expect(suggestPlayableNote(instrument, original)).toEqual({
      ...original,
      midi: 63,
      velocity: 20,
    });
    expect(original).toEqual(before);
    expect(suggestPlayableNote(instrument, { ...note, velocity: 40 })).toEqual({
      ...note,
      velocity: 20,
    });
    expect(suggestPlayableNote(instrument, note)).toBeUndefined();
    expect(suggestPlayableNote(undefined, note)).toBeUndefined();
  });
  it("prefers the existing style and gives deterministic playable proposals for missing styles", () => {
    const n = { ...note, articulation: "staccato", midi: 67 };
    expect(suggestPlayableNote(instrument, n)).toEqual({ ...n, midi: 60 });
    const missing = { ...note, articulation: "unknown" };
    const result = suggestPlayableNote(instrument, missing)!;
    expect(noteCoverageIssue(instrument, result)).toBeUndefined();
    expect(
      suggestPlayableNote(
        { ...instrument, regions: [...instrument.regions].reverse() },
        missing,
      ),
    ).toEqual(result);
  });
  it("exposes multiple playable mappings so the editor can let users choose", () => {
    const choices = playableNoteCandidates(instrument, {
      ...note,
      articulation: "missing-style",
      midi: 65,
      velocity: 40,
    });
    expect(choices.length).toBeGreaterThan(1);
    expect(choices.every((candidate) => !noteCoverageIssue(instrument, candidate))).toBe(true);
    expect(choices[0]).toEqual(suggestPlayableNote(instrument, {
      ...note,
      articulation: "missing-style",
      midi: 65,
      velocity: 40,
    }));
  });
  it("can repair a note after switching to a complete instrument mapping", () => {
    const switched = {
      ...note,
      instrumentId: "piano",
      articulation: "harmonics",
      midi: 90,
      velocity: 120,
    };
    const repaired = suggestPlayableNote(instrument, switched)!;
    expect(noteCoverageIssue(instrument, repaired)).toBeUndefined();
    expect(repaired.start).toBe(switched.start);
    expect(repaired.duration).toBe(switched.duration);
    expect(repaired.id).toBe(switched.id);
  });
  it("maps strengths to valid engine values while preserving endpoints", () => {
    expect([1, 127].map(velocityPercent)).toEqual([1, 100]);
    expect([1, 100].map(percentVelocity)).toEqual([1, 127]);
    for (let percent = 1; percent <= 100; percent++) {
      expect(velocityPercent(percentVelocity(percent))).toBe(percent);
    }
  });
});
