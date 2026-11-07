import { playerDuration } from './playerPlayback';
import { patchLayer, type LayerPatch } from "./model";
import { clamp, type PlayerInput } from "./model";
export type CropEdit = "cropStart" | "cropEnd";
export function adjustCrop(layer: PlayerInput, mode: CropEdit, delta: number): Partial<PlayerInput> {
  const change = delta * layer.speed;
  if (mode === 'cropStart') {
    if (layer.reverse) {
      const sourceEnd = clamp(layer.sourceEnd - change, Math.max(layer.sourceStart + 0.01 * layer.speed, layer.sourceEnd - (layer.duration - 0.01) * layer.speed), Math.min(Math.max(playerDuration(layer.player), layer.sourceEnd), layer.sourceEnd + layer.start * layer.speed));
      const shift = (layer.sourceEnd - sourceEnd) / layer.speed;
      return { sourceEnd, start: layer.start + shift, duration: Math.max(0.01, layer.duration - shift) };
    }
    const sourceStart = clamp(layer.sourceStart + change, Math.max(0, layer.sourceStart - layer.start * layer.speed), Math.min(layer.sourceEnd - 0.01 * layer.speed, layer.sourceStart + (layer.duration - 0.01) * layer.speed));
    const shift = (sourceStart - layer.sourceStart) / layer.speed;
    return { sourceStart, start: layer.start + shift, duration: Math.max(0.01, layer.duration - shift) };
  }
  if (layer.loop) return { duration: Math.max(0.01, layer.duration + delta) };
  if (layer.reverse) {
    const sourceStart = clamp(layer.sourceStart - change, 0, layer.sourceEnd - 0.01 * layer.speed);
    return { sourceStart, duration: (layer.sourceEnd - sourceStart) / layer.speed };
  }
  const sourceEnd = clamp(layer.sourceEnd + change, layer.sourceStart + 0.01 * layer.speed, Math.max(playerDuration(layer.player), layer.sourceEnd));
  return { sourceEnd, duration: (sourceEnd - layer.sourceStart) / layer.speed };
}
/** Timeline edges trim the read window; only explicit speed controls stretch sound. */
export function editClip(layer: PlayerInput, mode: ClipEdit, delta: number, projectDuration: number, step=0.01): Partial<PlayerInput> {
  const timing=adjustClipTiming(layer,mode,delta,projectDuration,step);
  if(mode==='move')return timing;
  return adjustCrop(layer,mode==='start'?'cropStart':'cropEnd',mode==='start'?timing.start-layer.start:timing.duration-layer.duration);
}
/** Reference-only extent. It may start before timeline zero and never constrains movement. */
export function cropReference(layer: PlayerInput) {
  const full=Math.max(playerDuration(layer.player),layer.sourceEnd);
  const before=(layer.reverse?full-layer.sourceEnd:layer.sourceStart)/layer.speed;
  const after=(layer.reverse?layer.sourceStart:full-layer.sourceEnd)/layer.speed;
  return {before,after,start:layer.start-before,end:layer.start+layer.duration+after};
}
export function stretchClip(layer: PlayerInput, timing: ClipTiming): Partial<PlayerInput> {
  return { ...timing, speed: layer.speed * layer.duration / timing.duration };
}
export type ClipTiming = { start: number; duration: number };
export type ClipEdit = "move" | "start" | "end";
export const MIN_CLIP_DURATION = 0.01;
export function rulerTicks(duration: number, width: number): number[] {
  const count = Math.max(2, Math.min(1000, Math.floor(width / 90)));
  const raw = duration / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((n) => n * power >= raw) ?? 10) * power;
  if (!Number.isFinite(step) || step <= 0) return [0, duration];
  const ticks = Array.from(
    { length: Math.ceil(duration / step) },
    (_, i) => i * step,
  );
  // Leave enough room for the end label when the duration isn't a round interval.
  if (ticks.length > 1 && duration - ticks.at(-1)! < step * 0.6) ticks.pop();
  return [...ticks, duration];
}

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
          Math.max(MIN_CLIP_DURATION, projectDuration - original.start),
        ),
      ),
    };
  const end = Math.min(projectDuration, original.start + original.duration);
  const start = clean(
    clamp(original.start + snapped, 0, Math.max(0, end - MIN_CLIP_DURATION)),
  );
  return { start, duration: clean(Math.max(MIN_CLIP_DURATION, end - start)) };
}
export const timingChanged = (a: ClipTiming, b: ClipTiming) =>
  Math.abs(a.start - b.start) > 1e-6 ||
  Math.abs(a.duration - b.duration) > 1e-6;

export function transformSelection(
  inputs: PlayerInput[],
  ids: string[],
  active: PlayerInput,
  next: LayerPatch,
): PlayerInput[] {
  const chosen = inputs.filter((l) => ids.includes(l.id));
  if (!chosen.length) return inputs;
  const duration = next.duration ?? active.duration,
    scale = duration / active.duration;
  const editsReadRange =
    (next.sourceStart !== undefined && next.sourceStart !== active.sourceStart) ||
    (next.sourceEnd !== undefined && next.sourceEnd !== active.sourceEnd) ||
    (Math.abs(scale - 1) > 1e-6 && next.speed === active.speed);
  if (editsReadRange)
    return inputs.map(l => l.id === active.id ? patchLayer(l, next) : l);
  const anchor =
    Math.abs((next.start ?? active.start) - active.start) > 1e-6 &&
    Math.abs(scale - 1) > 1e-6
      ? active.start + active.duration
      : active.start;
  const delta = (next.start ?? active.start) - active.start;
  if (Math.abs(scale - 1) < 1e-6 && Math.abs(delta) < 1e-6)
    return inputs.map((l) => (l.id === active.id ? patchLayer(l, next) : l));
  return inputs.map((l) =>
    !ids.includes(l.id)
      ? l
      : l.id === active.id && ids.length === 1
        ? {
            ...l,
            ...patchLayer(l, next),
            ...(Math.abs(scale - 1) > 1e-6
              ? {
                  speed: next.speed ?? l.speed / scale,
                }
              : {}),
          }
        : Math.abs(scale - 1) > 1e-6
          ? {
              ...l,
              start: anchor + (l.start - anchor) * scale,
              duration: l.duration * scale,
              speed: l.speed / scale,
            }
          : { ...l, start: l.start + delta },
  );
}
export function boundedSelection(
  inputs: PlayerInput[],
  ids: string[],
  active: PlayerInput,
  next: LayerPatch,
  duration: number,
) {
  // Clamp the entire moving set by its earliest start and latest end. Rejecting
  // an overshoot makes every clip jump back to its original position mid-drag.
  if (
    Math.abs((next.duration ?? active.duration) - active.duration) < 1e-6 &&
    Math.abs((next.start ?? active.start) - active.start) > 1e-6
  ) {
    const chosen = inputs.filter((layer) => ids.includes(layer.id));
    if (!chosen.length) return inputs;
    const minDelta = -Math.min(...chosen.map((layer) => layer.start));
    const maxDelta =
      duration -
      Math.max(...chosen.map((layer) => layer.start + layer.duration));
    if (minDelta > maxDelta) return inputs;
    const delta = Math.max(
      minDelta,
      Math.min(maxDelta, next.start! - active.start),
    );
    if (Math.abs(delta) < 1e-6) return inputs;
    next = { ...next, start: active.start + delta };
  }
  const transformed = transformSelection(inputs, ids, active, next);
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
    ? inputs
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
