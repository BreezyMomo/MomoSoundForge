import { clamp } from "./model";
export function playbackPosition(
  elapsed: number,
  offset: number,
  duration: number,
  loop: boolean,
) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const position = Math.max(0, elapsed) + clamp(offset, 0, duration);
  return loop ? position % duration : clamp(position, 0, duration);
}
export function timeAtPointer(
  x: number,
  left: number,
  width: number,
  duration: number,
) {
  if (!Number.isFinite(x) || width <= 0 || duration <= 0) return 0;
  return clamp(
    Math.round(clamp((x - left) / width, 0, 1) * duration * 1000) / 1000,
    0,
    duration,
  );
}
