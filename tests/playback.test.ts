import { describe, it, expect } from "vitest";
import { playbackPosition, timeAtPointer } from "../src/playback";
describe("playback position and seeking", () => {
  it("tracks playback from the selected offset and clamps at the end", () => {
    expect(playbackPosition(0.2, 0.3, 1, false)).toBe(0.5);
    expect(playbackPosition(2, 0.3, 1, false)).toBe(1);
    expect(playbackPosition(-1, 0.3, 1, false)).toBe(0.3);
  });
  it("wraps over the full project when looping from a nonzero position", () => {
    expect(playbackPosition(0.5, 0.75, 1, true)).toBe(0.25);
    expect(playbackPosition(3.5, 0.75, 1, true)).toBe(0.25);
    expect(playbackPosition(1, 0, 0, true)).toBe(0);
  });
  it("maps pointer positions to milliseconds and clamps both ends", () => {
    expect(timeAtPointer(250, 100, 400, 2)).toBe(0.75);
    expect(timeAtPointer(99, 100, 400, 2)).toBe(0);
    expect(timeAtPointer(900, 100, 400, 2)).toBe(2);
    expect(timeAtPointer(900, 100, 400, 0.1236)).toBe(0.1236);
    expect(timeAtPointer(250, 100, 0, 2)).toBe(0);
  });
  it("wraps within a nonzero loop range while retaining project time", () => {
    const region = { start: 2, end: 5 };
    expect(playbackPosition(0.5, 3, 10, true, region)).toBe(3.5);
    expect(playbackPosition(2, 3, 10, true, region)).toBe(2);
    expect(playbackPosition(9.5, 3, 10, true, region)).toBe(3.5);
    expect(playbackPosition(2, 3, 10, false, region)).toBe(5);
  });
});
