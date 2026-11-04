import { clamp } from "./model";
export type ClipTiming = { start: number; duration: number };
export type ClipEdit = "move" | "start" | "end";
export const MIN_CLIP_DURATION = 0.01;

/** Calculate from the gesture's original timing, never from the previous pointer move. */
export function adjustClipTiming(
  original: ClipTiming,
  mode: ClipEdit,
  delta: number,
  projectDuration: number,
  step = 0.01,
): ClipTiming {
  if (
    !Number.isFinite(delta) ||
    !Number.isFinite(projectDuration) ||
    projectDuration < MIN_CLIP_DURATION
  )
    return { ...original };
  const snapped = Math.round(delta / step) * step;
  const clean = (value: number) => Math.round(value * 1e6) / 1e6;
  if (mode === "move")
    return {
      start: clean(
        clamp(
          original.start + snapped,
          0,
          Math.max(0, projectDuration - original.duration),
        ),
      ),
      duration: original.duration,
    };
  if (mode === "end")
    return {
      start: original.start,
      duration: clean(
        clamp(
          original.duration + snapped,
          MIN_CLIP_DURATION,
          Math.max(
            MIN_CLIP_DURATION,
            Math.min(10, projectDuration - original.start),
          ),
        ),
      ),
    };
  const end = Math.min(projectDuration, original.start + original.duration);
  const start = clean(
    clamp(
      original.start + snapped,
      Math.max(0, end - 10),
      Math.max(0, end - MIN_CLIP_DURATION),
    ),
  );
  return { start, duration: clean(Math.max(MIN_CLIP_DURATION, end - start)) };
}
export const timingChanged = (a: ClipTiming, b: ClipTiming) =>
  Math.abs(a.start - b.start) > 1e-6 ||
  Math.abs(a.duration - b.duration) > 1e-6;
