import { effectTail, MAX_RENDER_SAMPLES } from "./nodeEffects";
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
  if (!Number.isFinite(sampleRate) || sampleRate < 100 || sampleRate > 192000)
    throw Error("error.renderBudget");
  const solos: string[][] = [];
  const visit = (p: Project, path: string[] = [], depth = 0) => {
    if (depth > MAX_COMPOSITION_DEPTH) throw Error("error.renderBudget");
    for (const l of p.layers)
      if (!l.muted) {
        const own = [...path, l.id];
        if (l.solo) solos.push(own);
        if (l.project) visit(l.project, own, depth + 1);
      }
  };
  visit(project);
  return renderNested(project, sampleRate, 0, {
    layers: 0,
    frames: 0,
    stack: new Set(),
    solos,
  });
}
function renderNested(
  project: Project,
  sampleRate: number,
  depth: number,
  context: {
    layers: number;
    frames: number;
    solos: string[][];
    stack: Set<Project>;
  },
  path: string[] = [],
  absoluteStart = 0,
): RenderResult {
  if (depth > MAX_COMPOSITION_DEPTH || context.stack.has(project))
    throw Error("Invalid nested audio");
  context.stack.add(project);
  const resolved = resolveControls(project);
  const estimate = (p: Project, level = 0): number => {
    if (level > MAX_COMPOSITION_DEPTH) throw Error("error.renderBudget");
    const seconds =
      Math.max(
        p.duration,
        ...p.layers.map(
          (l) =>
            l.start +
            (l.type === "composition" && l.project
              ? estimate(l.project, level + 1)
              : l.duration) +
            effectTail(l.effects),
        ),
      ) + effectTail(p.effects);
    if (!Number.isFinite(seconds) || seconds * sampleRate * 4 > MAX_RENDER_SAMPLES) throw Error("error.renderBudget");
    return seconds;
  };
  const length = Math.max(1, Math.ceil((depth === 0 ? project.duration : estimate(resolved)) * sampleRate));
  context.frames += length * 4;
  if (!Number.isFinite(context.frames) || context.frames > MAX_RENDER_SAMPLES) throw Error("error.renderBudget");
  const left = new Float32Array(length),
    right = new Float32Array(length),
    layers: Record<string, Float32Array> = Object.create(null),
    tails: Record<string, number> = Object.create(null),
    processedLayers: Record<string, Float32Array> = Object.create(null);
  let tailLimited = false;
  let usedLength = Math.round(project.duration * sampleRate);
  const append = (
    clip: (typeof project.layers)[number],
    inputL: Float32Array,
    inputR: Float32Array,
    raw: Float32Array,
  ) => {
    const base = inputL.length;
    const extra = Math.ceil(effectTail(clip.effects) * sampleRate);
    context.frames += (base + extra) * 3;
    if (!Number.isFinite(context.frames) || context.frames > MAX_RENDER_SAMPLES) throw Error("error.renderBudget");
    const l = new Float32Array(base + extra),
      r = new Float32Array(base + extra);
    l.set(inputL);
    r.set(inputR);
    if (clip.effects) processEffects(l, r, sampleRate, clip.effects);
    // Trim only the generated tail, never authored content. -60 dBFS, with a 10 ms release margin.
    let end = l.length;
    while (
      end > Math.max(base, Math.round(clip.duration * sampleRate)) &&
      Math.max(Math.abs(l[end - 1]), Math.abs(r[end - 1])) < 0.001
    )
      end--;
    end = Math.min(
      l.length,
      end + (end > base && end < l.length ? Math.round(0.01 * sampleRate) : 0),
    );
    if (
      extra &&
      end === l.length &&
      Math.max(Math.abs(l[end - 1]), Math.abs(r[end - 1])) >= 0.001
    ) {
      tailLimited = true;
      for (
        let i = Math.max(base, end - Math.round(0.01 * sampleRate));
        i < end;
        i++
      ) {
        const fade =
          (end - 1 - i) /
          Math.max(1, Math.min(extra, Math.round(0.01 * sampleRate)));
        l[i] *= fade;
        r[i] *= fade;
      }
    }
    const key = JSON.stringify([...path, clip.id]);
    layers[key] = raw;
    processedLayers[key] = Float32Array.from({ length: raw.length }, (_, i) =>
      Math.abs(l[i] ?? 0) >= Math.abs(r[i] ?? 0) ? (l[i] ?? 0) : (r[i] ?? 0),
    );
    if (!path.length) layers[clip.id] = raw;
    tails[key] = Math.max(0, end / sampleRate - clip.duration);
    if (!path.length) tails[clip.id] = tails[key];
    const offset =
      Math.round((absoluteStart + clip.start) * sampleRate) -
      Math.round(absoluteStart * sampleRate);
    const own = [...path, clip.id];
    const audible =
      !context.solos.length ||
      context.solos.some(
        (s) =>
          s.every((id, i) => own[i] === id) ||
          own.every((id, i) => s[i] === id),
      );
    if (!clip.muted && audible)
      usedLength = Math.max(usedLength, Math.min(length, offset + end));
    if (!clip.muted && audible)
      for (let i = 0; i < end && i + offset < length; i++) {
        left[i + offset] += l[i];
        right[i + offset] += r[i];
      }
  };
  for (const clip of resolved.layers) {
    const layer = { ...clip, duration: clip.sourceDuration ?? clip.duration };
    if (++context.layers > MAX_TOTAL_LAYERS)
      throw Error("Too many sound layers");
    if (layer.type === "composition" && !layer.project)
      throw Error("Missing nested audio");
    const n = Math.round(layer.duration * sampleRate);
    context.frames += n * 5 + Math.ceil(clip.duration * sampleRate) * 5;
    if (!Number.isFinite(context.frames) || context.frames > MAX_RENDER_SAMPLES)
      throw Error("error.renderBudget");
    const sourceLeft = new Float32Array(n),
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
            [...path, layer.id],
            absoluteStart + layer.start,
          )
        : null;
    if (child) {
      Object.assign(layers, child.layers);
      Object.assign(tails, child.tails);
      Object.assign(processedLayers, child.processedLayers);
      tailLimited ||= !!child.tailLimited;
      const l = new Float32Array(child.left.length),
        r = new Float32Array(child.right.length);
      const raw = new Float32Array(Math.round(clip.duration * sampleRate));
      for (let i = 0; i < l.length; i++) {
        const u = Math.min(1, i / Math.max(1, clip.duration * sampleRate));
        const gain = curveValue(layer.automation?.gain, u, layer.gain);
        const pan = curveValue(layer.automation?.pan, u, layer.pan);
        l[i] =
          child.left[i] * gain * (pan <= 0 ? 1 : Math.cos((pan * Math.PI) / 2));
        r[i] =
          child.right[i] *
          gain *
          (pan >= 0 ? 1 : Math.cos((-pan * Math.PI) / 2));
        if (i < raw.length)
          raw[i] = Math.abs(l[i]) >= Math.abs(r[i]) ? l[i] : r[i];
      }
      append(clip, l, r, raw);
      continue;
    }
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
    const clipLeft = new Float32Array(outputLength),
      clipRight = new Float32Array(outputLength);
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
      if (u >= (clip.cropStart ?? 0) && u < (clip.cropEnd ?? 1)) {
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
        clipLeft[i] = vl * lpan;
        clipRight[i] = vr * rpan;
      }
    }
    append(clip, clipLeft, clipRight, audio);
  }
  if (project.echo > 0) {
    const delay = Math.round(0.135 * sampleRate);
    for (let i = delay; i < length; i++) {
      left[i] += right[i - delay] * project.echo;
      right[i] += left[i - delay] * project.echo;
    }
  }
  if (project.effects) processEffects(left, right, sampleRate, project.effects);
  const finalLength = Math.min(
    length,
    depth === 0 ? Math.round(project.duration * sampleRate) : Infinity,
    usedLength + Math.ceil(effectTail(project.effects) * sampleRate),
  );
  let sourcePeak = 0;
  for (let i = 0; i < finalLength; i++) {
    left[i] *= project.master;
    right[i] *= project.master;
    sourcePeak = Math.max(sourcePeak, Math.abs(left[i]), Math.abs(right[i]));
  }
  // A single linked gain preserves transients and stereo balance while keeping WAV below full scale.
  const ceiling = project.effects ? 10 ** (project.effects.ceiling / 20) : 0.98;
  const reduction =
    depth === 0 && sourcePeak > ceiling ? ceiling / sourcePeak : 1;
  let sum = 0,
    peak = 0;
  for (let i = 0; i < finalLength; i++) {
    const fade = depth === 0 && i === finalLength - 1 ? 0 : 1;
    left[i] *= reduction * fade;
    right[i] *= reduction * fade;
    sum += left[i] ** 2 + right[i] ** 2;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  context.stack.delete(project);
  return {
    left: left.slice(0, finalLength),
    right: right.slice(0, finalLength),
    sampleRate,
    peak,
    sourcePeak,
    gainReduction: reduction,
    rms: Math.sqrt(sum / Math.max(1, 2 * finalLength)),
    layers,
    tails,
    processedLayers,
    tailLimited,
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
