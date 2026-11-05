import type { Project, RenderResult } from "./model";
import { clamp } from "./model";
import { playbackPosition } from "./playback";
function audioIdentity(project: Project): unknown {
  return { ...project, name: undefined, videoReference: undefined,
    layers: project.layers.map(layer => ({ ...layer, name: undefined,
      project: layer.project ? audioIdentity(layer.project) : undefined,
    })),
  };
}
export function createRenderer() {
  type Job = { id: number; project: Project; key: string; resolve: (r: RenderResult) => void;
    reject: (e: Error) => void; signal?: AbortSignal; abort: () => void };
  let worker: Worker | undefined, active: Job | undefined, serial = 0, disposed = false;
  const queue: Job[] = [];
  const cache = new Map<string, { result: RenderResult; bytes: number }>();
  const forget = (job: Job) => job.signal?.removeEventListener("abort", job.abort);
  const run = () => {
    if (active || disposed || !queue.length) return;
    active = queue.shift()!;
    if (!worker) {
      worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        const job = active;
        if (!job || data.id !== job.id) return;
        active = undefined; forget(job);
        if (data.error) job.reject(Error(data.error));
        else {
          const result: RenderResult = data.result;
          const arrays = new Set([result.left, result.right, ...Object.values(result.layers), ...Object.values(result.processedLayers ?? {})]);
          const bytes = [...arrays].reduce((n, a) => n + a.byteLength, 0);
          if (bytes <= 64 * 1024 * 1024) {
            while (cache.size && (cache.size >= 2 || [...cache.values()].reduce((n, c) => n + c.bytes, bytes) > 64 * 1024 * 1024)) cache.delete(cache.keys().next().value!);
            cache.set(job.key, { result, bytes });
          }
          job.resolve(result);
        }
        run();
      };
      worker.onerror = () => {
        const job = active; active = undefined;
        worker?.terminate(); worker = undefined;
        if (job) { forget(job); job.reject(Error("error.render")); }
        run();
      };
    }
    worker.postMessage({ id: active.id, project: active.project });
  };
  return {
    render: (project: Project, signal?: AbortSignal): Promise<RenderResult> => {
      if (disposed || signal?.aborted) return Promise.reject(Error("cancelled"));
      // Video alignment and labels do not change audio; reuse the exact same samples.
      const key = JSON.stringify(audioIdentity(project));
      const cached = cache.get(key);
      if (cached) return Promise.resolve(cached.result);
      return new Promise((resolve, reject) => {
        const job: Job = { id: ++serial, project, key, resolve, reject, signal, abort: () => {
          forget(job);
          if (active === job) { worker?.terminate(); worker = undefined; active = undefined; }
          else { const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); }
          reject(Error("cancelled")); run();
        }};
        signal?.addEventListener("abort", job.abort, { once: true });
        queue.push(job); run();
      });
    },
    dispose: () => {
      disposed = true; worker?.terminate();
      for (const job of [...queue, ...(active ? [active] : [])]) { forget(job); job.reject(Error("disposed")); }
      queue.length = 0; active = undefined; cache.clear();
    },
  };
}
export class AudioPlayer {
  context: AudioContext | null = null;
  source: AudioBufferSourceNode | null = null;
  gain: GainNode | null = null;
  startTime = 0;
  startOffset = 0;
  duration = 0;
  // Decoding a file does not require starting the playback clock.
  decode(data: ArrayBuffer) {
    this.context ??= new AudioContext();
    return this.context.decodeAudioData(data);
  }
  async prepare() {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }
  async play(
    result: RenderResult,
    loop: boolean,
    volume: number,
    onEnd: () => void,
    isCurrent: () => boolean = () => true,
    offset = 0,
  ) {
    const context = await this.prepare();
    // A cancelled render/resume must never replace a newer audition.
    if (!isCurrent()) return false;
    this.stop();
    const buffer = context.createBuffer(
      2,
      result.left.length,
      result.sampleRate,
    );
    buffer.copyToChannel(new Float32Array(result.left), 0);
    buffer.copyToChannel(new Float32Array(result.right), 1);
    const gain = context.createGain();
    gain.gain.value = volume;
    gain.connect(context.destination);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(gain);
    source.onended = () => {
      if (this.source === source) {
        source.disconnect();
        this.startOffset = this.duration;
        this.source = null;
        this.gain?.disconnect();
        this.gain = null;
        onEnd();
      }
    };
    this.source = source;
    this.gain = gain;
    this.startTime = context.currentTime;
    this.duration = result.left.length / result.sampleRate;
    this.startOffset = clamp(
      Number.isFinite(offset) ? offset : 0,
      0,
      Math.max(0, this.duration - 1 / result.sampleRate),
    );
    source.start(0, this.startOffset);
    return true;
  }
  position() {
    if (!this.source || !this.context) return this.startOffset;
    return playbackPosition(
      this.context.currentTime - this.startTime,
      this.startOffset,
      this.duration,
      this.source.loop,
    );
  }
  setLoop(loop: boolean) {
    if (!this.source || !this.context || this.source.loop === loop) return;
    this.startOffset = this.position();
    this.startTime = this.context.currentTime;
    this.source.loop = loop;
  }
  setVolume(volume: number) {
    if (this.gain && this.context)
      this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.015);
  }
  stop() {
    if (this.source) {
      this.startOffset = this.position();
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* Source may already have ended. */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.gain?.disconnect();
    this.gain = null;
  }
  dispose() {
    this.stop();
    void this.context?.close();
  }
}
