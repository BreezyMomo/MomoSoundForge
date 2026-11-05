export type VideoReference = { name: string; size: number; duration: number; start: number; end: number; markers: { id: string; name: string; time: number }[] };
export function validateVideoReference(raw: unknown): VideoReference {
  const r = raw as VideoReference;
  const finite = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
  if (!r || typeof r.name !== 'string' || !r.name.length || r.name.length > 255 ||
      !Number.isInteger(r.size) || !finite(r.size, 1, 80 * 1024 * 1024) ||
      !finite(r.duration, .01, Number.MAX_VALUE) || !finite(r.start, 0, r.duration) ||
      !finite(r.end, r.start + .01, r.duration) ||
      !Array.isArray(r.markers) || r.markers.length > 64) throw Error('video.invalid');
  const ids = new Set<string>();
  for (const m of r.markers) {
    if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 120 || ids.has(m.id) ||
      typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80 || !finite(m.time, 0, Number.MAX_VALUE)) throw Error('video.invalid');
    ids.add(m.id);
  }
  return structuredClone(r);
}
export function frameIndex(times: number[], time: number) {
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (times[mid] <= time + 1e-7) lo = mid + 1; else hi = mid; }
  return Math.max(0, lo - 1);
}
export function stepFrame(times: number[], time: number, direction: number) {
  const current = frameIndex(times, time);
  // At an in-between position (including the end boundary), go to the preceding
  // frame timestamp first instead of skipping that frame.
  const delta = direction < 0 && time > (times[current] ?? time) + 1e-7 ? 0 : direction;
  return times[Math.max(0, Math.min(times.length - 1, current + delta))] ?? time;
}
export async function indexVideo(file: File, signal: AbortSignal): Promise<number[]> {
  const [{ FFmpeg }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'), import('@ffmpeg/core?url'), import('@ffmpeg/core/wasm?url')]);
  const core = new FFmpeg();
  const cancel = () => core.terminate();
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 90000);
  try {
    if (signal.aborted) throw Error('video.failed');
    await core.load({ coreURL: new URL(coreURL, location.href).href, wasmURL: new URL(wasmURL, location.href).href });
    await core.writeFile('reference', new Uint8Array(await file.arrayBuffer()));
    const frames: number[] = [];
    core.on('log', ({ message }) => {
      const match = /\bn:\s*\d+.*?pts_time:([\d.e+-]+)/.exec(message);
      if (match) { const time = Number(match[1]); if (Number.isFinite(time) && time >= 0 && (frames.length === 0 || time > frames.at(-1)!)) frames.push(time); }
      if (frames.length > 500000) core.terminate();
    });
    const code = await core.exec(['-i', 'reference', '-map', '0:v:0', '-an', '-vf', 'setpts=PTS-STARTPTS,showinfo', '-f', 'null', '-'], 90000);
    if (code || !frames.length || signal.aborted) throw Error('video.failed');
    return frames;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); core.terminate(); }
}
