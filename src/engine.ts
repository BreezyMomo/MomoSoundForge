import { renderScore } from "./instruments";
import { resolveControls, curveValue, processEffects } from "./advanced";
import {
  SAMPLE_RATE,
  clamp,
  decodeSamples,
  rng,
  stableHash,
  type Project,
  type RenderResult,
  type SampleAsset,
  MAX_COMPOSITION_DEPTH,
  MAX_TOTAL_LAYERS,
} from "./model";
const sampleCache = new WeakMap<SampleAsset, Float32Array[]>();
function samples(asset: SampleAsset) {
  const cached = sampleCache.get(asset);
  if (cached) return cached;
  const data = asset.channels.map(decodeSamples);
  sampleCache.set(asset, data);
  return data;
}
export function renderProject(
  project: Project,
  sampleRate = SAMPLE_RATE,
): RenderResult {
  return renderNested(project, sampleRate, 0, { layers: 0, stack: new Set() });
}
function renderNested(
  project: Project,
  sampleRate: number,
  depth: number,
  context: { layers: number; stack: Set<Project> },
): RenderResult {
  if (depth > MAX_COMPOSITION_DEPTH || context.stack.has(project))
    throw Error("Invalid nested audio");
  context.stack.add(project);
  const resolved = resolveControls(project);
  const length = Math.round(project.duration * sampleRate),
    left = new Float32Array(length),
    right = new Float32Array(length),
    layers: Record<string, Float32Array> = Object.create(null);
  const solo = resolved.layers.some((l) => l.solo && !l.muted);
  for (const clip of resolved.layers) {
    const layer = { ...clip, duration: clip.sourceDuration ?? clip.duration };
    if (++context.layers > MAX_TOTAL_LAYERS)
      throw Error("Too many sound layers");
    if (layer.type === "composition" && !layer.project)
      throw Error("Missing nested audio");
    const n = Math.round(layer.duration * sampleRate),
      sourceLeft = new Float32Array(n),
      sourceRight = new Float32Array(n);
    const noise = rng(layer.noiseSeed ^ stableHash(layer.id));
    let phase = 0;
    const filters = [0, 0],
      previousInputs = [0, 0],
      previousOutputs = [0, 0];
    const alpha =
      1 -
      Math.exp(
        (-2 * Math.PI * Math.min(layer.cutoff, sampleRate * 0.45)) / sampleRate,
      );
    const asset = layer.assetId ? project.assets[layer.assetId] : null;
    const child =
      layer.type === "composition" && layer.project
        ? renderNested(
            resolveControls(layer.project, layer.controlValues),
            sampleRate,
            depth + 1,
            context,
          )
        : null;
    const performance =
      layer.type === "instrument" && layer.score
        ? renderScore(
            layer.score,
            project.assets,
            layer.duration,
            sampleRate,
            project.seed ^ layer.noiseSeed,
          )
        : null;
    const channels = performance
      ? [performance.left, performance.right]
      : child
        ? [child.left, child.right]
        : asset
          ? samples(asset)
          : null;
    const sourceRate =
      child || performance ? sampleRate : (asset?.sampleRate ?? sampleRate);
    const offset = Math.round(layer.start * sampleRate),
      pan = ((layer.pan + 1) * Math.PI) / 4,
      pl =
        layer.type === "composition" || layer.type === "instrument"
          ? layer.pan <= 0
            ? 1
            : Math.cos((layer.pan * Math.PI) / 2)
          : Math.cos(pan),
      pr =
        layer.type === "composition" || layer.type === "instrument"
          ? layer.pan >= 0
            ? 1
            : Math.cos((-layer.pan * Math.PI) / 2)
          : Math.sin(pan);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate,
        u = t / layer.duration,
        frequency =
          layer.frequency * Math.pow(layer.endFrequency / layer.frequency, u);
      phase = (phase + Math.min(frequency, sampleRate * 0.45) / sampleRate) % 1;
      let value = 0,
        stereo = 0;
      if (layer.type !== "synth" && channels) {
        // frequency is the playback-rate control for samples; 440 Hz means original pitch.
        const rate = layer.frequency / 440,
          position = layer.trim * sourceRate + t * sourceRate * rate;
        const pos = layer.reverse
          ? channels[0].length - 1 - position
          : position;
        const read = (channel: Float32Array) => {
          if (pos < 0 || pos >= channel.length - 1) return 0;
          const j = Math.floor(pos),
            f = pos - j;
          return channel[j] * (1 - f) + channel[j + 1] * f;
        };
        value = read(channels[0]);
        stereo = read(channels[1] ?? channels[0]);
      } else {
        switch (layer.wave) {
          case "sine":
            value = Math.sin(phase * 2 * Math.PI);
            break;
          case "triangle":
            value = 1 - 4 * Math.abs(phase - 0.5);
            break;
          case "saw":
            value = 2 * phase - 1;
            break;
          case "square":
            value = phase < 0.5 ? 1 : -1;
            break;
          case "noise":
            value = noise() * 2 - 1;
        }
        stereo = value;
      }
      const attack = layer.attack > 0 ? clamp(t / layer.attack, 0, 1) : 1,
        release = Math.min(layer.release, layer.duration);
      const tail =
        release > 0
          ? clamp((layer.duration - t) / release, 0, 1)
          : layer.type === "composition" || layer.type === "instrument"
            ? 1
            : clamp(((layer.duration - t) * sampleRate) / 32, 0, 1);
      const envelope =
        attack *
        tail *
        Math.exp(-layer.decay * u) *
        curveValue(layer.automation?.gain, u, layer.gain);
      const process = (input: number, c: number) => {
        const cutoff = curveValue(
          layer.automation?.cutoff,
          u,
          layer.cutoff,
          true,
        );
        const coefficient = layer.automation?.cutoff?.length
          ? 1 -
            Math.exp(
              (-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate,
            )
          : alpha;
        filters[c] += coefficient * (input - filters[c]);
        const dc =
          layer.type === "composition" || layer.type === "instrument"
            ? cutoff >= 22000
              ? input
              : filters[c]
            : filters[c] - previousInputs[c] + 0.995 * previousOutputs[c];
        previousInputs[c] = filters[c];
        previousOutputs[c] = dc;
        return (
          (layer.drive
            ? Math.tanh(dc * (1 + layer.drive)) / Math.tanh(1 + layer.drive)
            : dc) * envelope
        );
      };
      const vl = process(value, 0),
        vr = layer.type === "synth" ? vl : process(stereo, 1);
      sourceLeft[i] = vl;
      sourceRight[i] = vr;
    }
    const outputLength = Math.round(clip.duration * sampleRate);
    const audio = new Float32Array(outputLength);
    const read = (channel: Float32Array, pos: number) => {
      const j = Math.floor(pos),
        f = pos - j;
      return (
        channel[j] * (1 - f) + channel[Math.min(j + 1, channel.length - 1)] * f
      );
    };
    for (let i = 0; i < outputLength; i++) {
      const pos = (i * n) / outputLength;
      const vl = read(sourceLeft, pos),
        vr = read(sourceRight, pos);
      // Preserve the complete waveform beneath the non-destructive crop mask.
      audio[i] = Math.abs(vl) >= Math.abs(vr) ? vl : vr;
      const u = i / outputLength;
      if (
        u >= (clip.cropStart ?? 0) &&
        u < (clip.cropEnd ?? 1) &&
        offset + i < length &&
        !layer.muted &&
        (!solo || layer.solo)
      ) {
        const panValue = curveValue(layer.automation?.pan, u, layer.pan);
        const angle = ((panValue + 1) * Math.PI) / 4;
        const lpan = layer.automation?.pan?.length
          ? layer.type === "composition" || layer.type === "instrument"
            ? panValue <= 0
              ? 1
              : Math.cos((panValue * Math.PI) / 2)
            : Math.cos(angle)
          : pl;
        const rpan = layer.automation?.pan?.length
          ? layer.type === "composition" || layer.type === "instrument"
            ? panValue >= 0
              ? 1
              : Math.cos((-panValue * Math.PI) / 2)
            : Math.sin(angle)
          : pr;
        left[offset + i] += vl * lpan;
        right[offset + i] += vr * rpan;
      }
    }
    layers[layer.id] = audio;
  }
  if (project.echo > 0) {
    const delay = Math.round(0.135 * sampleRate);
    for (let i = delay; i < length; i++) {
      left[i] += right[i - delay] * project.echo;
      right[i] += left[i - delay] * project.echo;
    }
  }
  if (project.effects) processEffects(left, right, sampleRate, project.effects);
  let sourcePeak = 0;
  for (let i = 0; i < length; i++) {
    left[i] *= project.master;
    right[i] *= project.master;
    sourcePeak = Math.max(sourcePeak, Math.abs(left[i]), Math.abs(right[i]));
  }
  // A single linked gain preserves transients and stereo balance while keeping WAV below full scale.
  const ceiling = project.effects ? 10 ** (project.effects.ceiling / 20) : 0.98;
  const reduction = sourcePeak > ceiling ? ceiling / sourcePeak : 1;
  let sum = 0,
    peak = 0;
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / 32, (length - 1 - i) / 64);
    left[i] *= reduction * fade;
    right[i] *= reduction * fade;
    sum += left[i] ** 2 + right[i] ** 2;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  context.stack.delete(project);
  return {
    left,
    right,
    sampleRate,
    peak,
    sourcePeak,
    gainReduction: reduction,
    rms: Math.sqrt(sum / Math.max(1, 2 * length)),
    layers,
  };
}
export function encodeWav(
  result: Pick<RenderResult, "left" | "right" | "sampleRate">,
): ArrayBuffer {
  const { left, right, sampleRate } = result,
    buffer = new ArrayBuffer(44 + left.length * 4),
    view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, left.length * 4, true);
  for (let i = 0; i < left.length; i++)
    for (let c = 0; c < 2; c++) {
      const x = clamp((c ? right : left)[i], -1, 1);
      view.setInt16(
        44 + i * 4 + c * 2,
        Math.round(x * (x < 0 ? 32768 : 32767)),
        true,
      );
    }
  return buffer;
}
