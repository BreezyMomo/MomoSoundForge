import { describe, it, expect } from "vitest";
import { adjustClipTiming, timingChanged } from "../src/timeline";
describe("timeline positioning and resizing", () => {
  it("moves the whole clip without changing duration and clamps it to the project", () => {
    const original = { start: 0.12, duration: 0.2 };
    expect(adjustClipTiming(original, "move", 0.34, 1)).toEqual({
      start: 0.46,
      duration: 0.2,
    });
    expect(adjustClipTiming(original, "move", -100, 1)).toEqual({
      start: 0,
      duration: 0.2,
    });
    expect(adjustClipTiming(original, "move", 100, 1)).toEqual({
      start: 0.8,
      duration: 0.2,
    });
    expect(original).toEqual({ start: 0.12, duration: 0.2 });
  });
  it("resizes the right edge while keeping the start fixed", () => {
    const original = { start: 0.2, duration: 0.4 };
    expect(adjustClipTiming(original, "end", 0.2, 1)).toEqual({
      start: 0.2,
      duration: 0.6,
    });
    expect(adjustClipTiming(original, "end", 100, 1)).toEqual({
      start: 0.2,
      duration: 0.8,
    });
    expect(adjustClipTiming(original, "end", -100, 1)).toEqual({
      start: 0.2,
      duration: 0.01,
    });
  });
  it("resizes the left edge while keeping the end fixed and preventing inversion", () => {
    const original = { start: 0.2, duration: 0.4 };
    expect(adjustClipTiming(original, "start", -0.15, 1)).toEqual({
      start: 0.05,
      duration: 0.55,
    });
    expect(adjustClipTiming(original, "start", -100, 1)).toEqual({
      start: 0,
      duration: 0.6,
    });
    expect(adjustClipTiming(original, "start", 100, 1)).toEqual({
      start: 0.59,
      duration: 0.01,
    });
  });
  it("supports millisecond fine adjustment without accumulating pointer-move drift", () => {
    const original = { start: 0.2, duration: 0.4 };
    const normal = adjustClipTiming(original, "move", 0.0044, 1);
    const fine = adjustClipTiming(original, "move", 0.0044, 1, 0.001);
    expect(normal).toEqual(original);
    expect(fine.start).toBe(0.204);
    expect(timingChanged(normal, original)).toBe(false);
    expect(timingChanged(fine, original)).toBe(true);
    expect(adjustClipTiming(original, "move", 0.0044, 1, 0.001)).toEqual(fine);
  });
  it("handles clips longer than the visible project and rejects invalid deltas", () => {
    expect(
      adjustClipTiming({ start: 0.2, duration: 2 }, "move", 0.1, 1),
    ).toEqual({ start: 0, duration: 2 });
    expect(
      adjustClipTiming({ start: 0.2, duration: 2 }, "start", -0.1, 1),
    ).toEqual({ start: 0.1, duration: 0.9 });
    const original = { start: 0, duration: 0.2 };
    expect(adjustClipTiming(original, "move", NaN, 1)).toEqual(original);
  });
});
