import type { Project, RenderResult } from "./model";
import { clamp } from "./model";
import { playbackPosition } from "./playback";
export function createRenderer() {
  const worker = new Worker(new URL("./render.worker.ts", import.meta.url), {
    type: "module",
  });
  let serial = 0;
  const pending = new Map<
    number,
    { resolve: (r: RenderResult) => void; reject: (e: Error) => void }
  >();
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    data.error ? job.reject(Error("render")) : job.resolve(data.result);
  };
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(Error("render"));
    pending.clear();
  };
  return {
    render: (project: Project) =>
      new Promise<RenderResult>((resolve, reject) => {
        const id = ++serial;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, project });
      }),
    dispose: () => {
      worker.terminate();
      for (const job of pending.values()) job.reject(Error("disposed"));
      pending.clear();
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
