import { clamp, type Layer } from "./model";
export type CropEdit = "cropStart" | "cropEnd";
export function adjustCrop(layer: Layer, mode: CropEdit, delta: number) {
  const start = layer.cropStart ?? 0,
    end = layer.cropEnd ?? 1;
  const gap = Math.min(1, 0.001 / layer.duration);
  return mode === "cropStart"
    ? {
        cropStart: clamp(start + delta / layer.duration, 0, end - gap),
        cropEnd: end,
      }
    : {
        cropStart: start,
        cropEnd: clamp(end + delta / layer.duration, start + gap, 1),
      };
}
export function stretchClip(layer: Layer, timing: ClipTiming): Partial<Layer> {
  return {
    ...timing,
    ...(Math.abs(layer.duration - timing.duration) > 1e-6
      ? { sourceDuration: layer.sourceDuration ?? layer.duration }
      : {}),
  };
}
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

export function transformSelection(
  layers: Layer[],
  ids: string[],
  active: Layer,
  next: Partial<Layer>,
): Layer[] {
  const chosen = layers.filter((l) => ids.includes(l.id));
  if (!chosen.length) return layers;
  const duration = next.duration ?? active.duration,
    scale = duration / active.duration;
  const anchor =
    Math.abs((next.start ?? active.start) - active.start) > 1e-6 &&
    Math.abs(scale - 1) > 1e-6
      ? active.start + active.duration
      : active.start;
  const delta = (next.start ?? active.start) - active.start;
  if (Math.abs(scale - 1) < 1e-6 && Math.abs(delta) < 1e-6)
    return layers.map((l) => (l.id === active.id ? { ...l, ...next } : l));
  return layers.map((l) =>
    !ids.includes(l.id)
      ? l
      : l.id === active.id && ids.length === 1
        ? {
            ...l,
            ...next,
            ...(Math.abs(scale - 1) > 1e-6
              ? { sourceDuration: l.sourceDuration ?? l.duration }
              : {}),
          }
        : Math.abs(scale - 1) > 1e-6
          ? {
              ...l,
              start: anchor + (l.start - anchor) * scale,
              duration: l.duration * scale,
              sourceDuration: l.sourceDuration ?? l.duration,
            }
          : { ...l, start: l.start + delta },
  );
}
export function boundedSelection(
  layers: Layer[],
  ids: string[],
  active: Layer,
  next: Partial<Layer>,
  duration: number,
) {
  const transformed = transformSelection(layers, ids, active, next);
  if (
    Math.abs((next.start ?? active.start) - active.start) < 1e-6 &&
    Math.abs((next.duration ?? active.duration) - active.duration) < 1e-6
  )
    return transformed;
  return transformed.some(
    (l) =>
      ids.includes(l.id) &&
      (l.start < -0.000001 ||
        l.duration < 0.01 ||
        l.start + l.duration > duration + 0.000001),
  )
    ? layers
    : transformed;
}
export function snapTime(value: number, targets: number[], tolerance: number) {
  let best = value,
    distance = tolerance;
  for (const target of targets) {
    const d = Math.abs(target - value);
    if (d <= distance) {
      best = target;
      distance = d;
    }
  }
  return best;
}
