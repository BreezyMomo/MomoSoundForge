import { describe, expect, it } from "vitest";
import { editNote, noteSpan, pitchName, noteGridTicks } from "../src/noteEditing";
import { emptyScore, type NoteEvent } from "../src/instruments";
import { makeLayer } from "../src/model";

const note: NoteEvent = { id: "n", instrumentId: "i", midi: 60, start: 1, duration: 2, velocity: 80, articulation: "sustain" };
describe("visual note editing", () => {
  it("moves from the original note, quantizes time and preserves musical attributes", () => {
    expect(editNote(note, "move", .38, 2, 120, .25)).toEqual({ ...note, start: 1.5, midi: 62 });
    expect(note.start).toBe(1);
    expect(editNote(note, "move", .38, 0, 120, 0).start).toBe(1.38);
  });
  it("resizes without moving pitch or onset and supports long scores", () => {
    expect(editNote(note, "resize", .38, 30, 120, .25)).toEqual({ ...note, duration: 2.5 });
    expect(editNote(note, "resize", -100, 0, 120, .25).duration).toBe(.005);
    expect(editNote(note, "resize", 100, 0, 120, .25).duration).toBe(102);
    expect(editNote(note, "move", 100, 100, 120, .25)).toMatchObject({ start: 101, midi: 127 });
    expect(editNote(note, "move", -100, -100, 120, .25)).toMatchObject({ start: 0, midi: 0 });
    expect(editNote(note, "move", Infinity, 0, 20, 1)).toBe(note);
    expect(editNote(note, "resize", NaN, 0, 20, 1)).toBe(note);
    expect(noteGridTicks(1e12).length).toBeLessThanOrEqual(33);
  });
  it("positions notes in the rendered clip across stretch, trim, speed and reverse", () => {
    const layer = makeLayer({ type: "instrument", duration: 4, score: emptyScore(), frequency: 440 });
    expect(noteSpan(layer, note)).toEqual({ start: .125, width: .25 });
    expect(noteSpan({ ...layer, duration: 2, sourceDuration: 4 }, note)).toEqual(noteSpan(layer, note));
    expect(noteSpan({ ...layer, trim: .5, frequency: 880 }, note)).toEqual({ start: 0, width: .125 });
    expect(noteSpan({ ...layer, reverse: true }, note)).toEqual({ start: .625, width: .25 });
  });
  it("names the full MIDI pitch range", () => {
    expect([0, 60, 61, 127].map(pitchName)).toEqual(["C-1", "C4", "C♯4", "G9"]);
  });
});
