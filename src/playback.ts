import { clamp } from "./model";
export function adjustLoopBoundary(region: { start: number; end: number }, edge: "start" | "end", time: number, duration: number) {
  const value = Math.round(time * 1000) / 1000;
  return { ...region, [edge]: edge === "start" ? clamp(value, 0, region.end - 0.01) : clamp(value, region.start + 0.01, duration) };
}
export function playbackPosition(
  elapsed: number,
  offset: number,
  duration: number,
  loop: boolean,
  region?: { start: number; end: number },
) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const position = Math.max(0, elapsed) + clamp(offset, 0, duration);
  if (!loop) return clamp(position, 0, duration);
  const start = region?.start ?? 0, end = region?.end ?? duration;
  return position < end ? position : start + (position - start) % (end - start);
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
