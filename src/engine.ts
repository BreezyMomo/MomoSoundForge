import {
  SAMPLE_RATE,
  clamp,
  decodeSamples,
  rng,
  stableHash,
  type Project,
  type RenderResult,
  type SampleAsset,
} from "./model";
const sampleCache = new Map<
  string,
  { source: SampleAsset; data: Float32Array[] }
>();
function samples(asset: SampleAsset) {
  const cached = sampleCache.get(asset.id);
  if (cached?.source === asset) return cached.data;
  const data = asset.channels.map(decodeSamples);
  sampleCache.set(asset.id, { source: asset, data });
  return data;
}
export function renderProject(
  project: Project,
  sampleRate = SAMPLE_RATE,
): RenderResult {
  for (const id of sampleCache.keys())
    if (!Object.hasOwn(project.assets, id)) sampleCache.delete(id);
  const length = Math.round(project.duration * sampleRate),
    left = new Float32Array(length),
    right = new Float32Array(length),
    layers: Record<string, Float32Array> = Object.create(null);
  const solo = project.layers.some((l) => l.solo && !l.muted);
  for (const layer of project.layers) {
    const n = Math.min(
        Math.round(layer.duration * sampleRate),
        Math.max(0, length - Math.round(layer.start * sampleRate)),
      ),
      audio = new Float32Array(n);
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
    const asset = layer.assetId ? project.assets[layer.assetId] : null,
      channels = asset ? samples(asset) : null;
    const offset = Math.round(layer.start * sampleRate),
      pan = ((layer.pan + 1) * Math.PI) / 4,
      pl = Math.cos(pan),
      pr = Math.sin(pan);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate,
        u = t / layer.duration,
        frequency =
          layer.frequency * Math.pow(layer.endFrequency / layer.frequency, u);
      phase = (phase + Math.min(frequency, sampleRate * 0.45) / sampleRate) % 1;
      let value = 0,
        stereo = 0;
      if (layer.type === "sample" && asset && channels) {
        // frequency is the playback-rate control for samples; 440 Hz means original pitch.
        const rate = layer.frequency / 440,
          position =
            layer.trim * asset.sampleRate + t * asset.sampleRate * rate;
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
          : clamp(((layer.duration - t) * sampleRate) / 32, 0, 1);
      const envelope = attack * tail * Math.exp(-layer.decay * u) * layer.gain;
      const process = (input: number, c: number) => {
        filters[c] += alpha * (input - filters[c]);
        const dc = filters[c] - previousInputs[c] + 0.995 * previousOutputs[c];
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
      // A thumbnail must still show right-only and phase-inverted stereo samples.
      audio[i] = Math.abs(vl) >= Math.abs(vr) ? vl : vr;
      if (!layer.muted && (!solo || layer.solo)) {
        left[offset + i] += vl * pl;
        right[offset + i] += vr * pr;
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
  let sourcePeak = 0;
  for (let i = 0; i < length; i++) {
    left[i] *= project.master;
    right[i] *= project.master;
    sourcePeak = Math.max(sourcePeak, Math.abs(left[i]), Math.abs(right[i]));
  }
  // A single linked gain preserves transients and stereo balance while keeping WAV below full scale.
  const reduction = sourcePeak > 0.98 ? 0.98 / sourcePeak : 1;
  let sum = 0,
    peak = 0;
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / 32, (length - 1 - i) / 64);
    left[i] *= reduction * fade;
    right[i] *= reduction * fade;
    sum += left[i] ** 2 + right[i] ** 2;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
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
