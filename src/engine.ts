import { playerDuration, sourceTime, mixTail } from "./playerPlayback";
import { effectTail, MAX_RENDER_SAMPLES } from "./nodeEffects";
import { renderScore } from "./instruments";
import { synthSample, expressionVoice } from "./synthesizers";
import { compileExpression } from './synthExpression';
import { sampleFrames, embeddedFrames } from './sampleReference';
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
  if (asset.reference && embeddedFrames(asset) < sampleFrames(asset)) throw Error('error.sampleUnavailable');
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
    for (const l of p.inputs)
      if (!l.muted) {
        const own = [...path, l.id];
        if (l.solo) solos.push(own);
        if (l.player.mix) visit(l.player.mix, own, depth + 1);
      }
  };
  visit(project);
  return renderNested(project, sampleRate, 0, {
    inputs: 0,
    frames: 0,
    synthOperations: 0,
    stack: new Set(),
    solos,
  });
}
function renderNested(
  project: Project,
  sampleRate: number,
  depth: number,
  context: {
    inputs: number;
    frames: number;
    synthOperations: number;
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
        ...p.inputs.map(
          (l) =>
            l.start +
            l.duration,
        ),
      ) + mixTail(p);
    if (
      !Number.isFinite(seconds) ||
      seconds * sampleRate * 4 > MAX_RENDER_SAMPLES
    )
      throw Error("error.renderBudget");
    return seconds;
  };
  const length = Math.max(
    1,
    Math.ceil(
      (depth === 0 ? project.duration : estimate(resolved)) * sampleRate,
    ),
  );
  context.frames += length * 4;
  if (!Number.isFinite(context.frames) || context.frames > MAX_RENDER_SAMPLES)
    throw Error("error.renderBudget");
  const left = new Float32Array(length),
    right = new Float32Array(length),
    inputs: Record<string, Float32Array> = Object.create(null),
    tails: Record<string, number> = Object.create(null),
    processedLayers: Record<string, Float32Array> = Object.create(null);
  let tailLimited = false;
  let usedLength = Math.round(project.duration * sampleRate);
  const append = (
    clip: (typeof project.inputs)[number],
    inputL: Float32Array,
    inputR: Float32Array,
    raw: Float32Array,
  ) => {
    const base = inputL.length;
    context.frames += base * 3;
    if (!Number.isFinite(context.frames) || context.frames > MAX_RENDER_SAMPLES)
      throw Error("error.renderBudget");
    const l = new Float32Array(base),
      r = new Float32Array(base);
    l.set(inputL);
    r.set(inputR);
    const end = l.length;
    const key = JSON.stringify([...path, clip.id]);
    inputs[key] = raw;
    // Keep the complete audible result for timeline bodies and their effect tails.
    processedLayers[key] = Float32Array.from(
      { length: Math.max(raw.length, end) },
      (_, i) =>
        Math.abs(l[i] ?? 0) >= Math.abs(r[i] ?? 0) ? (l[i] ?? 0) : (r[i] ?? 0),
    );
    if (!path.length) inputs[clip.id] = raw;
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
  for (const clip of resolved.inputs) {
    const layer = {
      ...clip,
      duration: clip.player.duration ?? clip.duration,
    };
    if (++context.inputs > MAX_TOTAL_LAYERS)
      throw Error("Too many sound inputs");
    if (layer.player.type === "composition" && !layer.player.mix)
      throw Error("Missing nested audio");
    const n = Math.round(layer.duration * sampleRate);
    context.frames += n * 5 + Math.ceil(clip.duration * sampleRate) * 5;
    if (!Number.isFinite(context.frames) || context.frames > MAX_RENDER_SAMPLES)
      throw Error("error.renderBudget");
    const sourceLeft = new Float32Array(n),
      sourceRight = new Float32Array(n);
    const noise = rng(layer.player.noiseSeed);
    if(layer.player.synth?.program) {
      const p=layer.player.synth.program;context.synthOperations+=n*compileExpression(p.expression,p.parameters.map(x=>x.variable)).cost;
      if(context.synthOperations>60_000_000)throw Error('error.renderBudget');
    }
    const expression = expressionVoice(layer.player.synth, layer.player.synthValues, noise, n);
    let phase = 0;
    const filters = [0, 0],
      previousInputs = [0, 0],
      previousOutputs = [0, 0];
    const alpha =
      1 -
      Math.exp(
        (-2 * Math.PI * Math.min(layer.player.cutoff, sampleRate * 0.45)) /
          sampleRate,
      );
    const asset = layer.player.assetId
      ? project.assets[layer.player.assetId]
      : null;
    const child =
      layer.player.type === "composition" && layer.player.mix
        ? renderNested(
            resolveControls(layer.player.mix, layer.player.controlValues),
            sampleRate,
            depth + 1,
            context,
            [...path, layer.id],
            absoluteStart + layer.start,
          )
        : null;
    if (child) {
      Object.assign(inputs, child.inputs); Object.assign(tails, child.tails);
      Object.assign(processedLayers, child.processedLayers); tailLimited ||= !!child.tailLimited;
    }
    const performance =
      layer.player.type === "instrument" && layer.player.score
        ? renderScore(
            layer.player.score,
            project.assets,
            layer.duration,
            sampleRate,
            layer.player.noiseSeed,
            context,
          )
        : null;
    const channels = child ? [child.left, child.right] : performance
      ? [performance.left, performance.right]
      : asset
        ? samples(asset)
        : null;
    const sourceRate =
      child || performance ? sampleRate : (asset?.sampleRate ?? sampleRate);
    const offset = Math.round(layer.start * sampleRate),
      pan = ((layer.pan + 1) * Math.PI) / 4,
      pl =
        layer.player.type === "composition" ||
        layer.player.type === "instrument"
          ? layer.pan <= 0
            ? 1
            : Math.cos((layer.pan * Math.PI) / 2)
          : Math.cos(pan),
      pr =
        layer.player.type === "composition" ||
        layer.player.type === "instrument"
          ? layer.pan >= 0
            ? 1
            : Math.cos((-layer.pan * Math.PI) / 2)
          : Math.sin(pan);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate,
        u = t / layer.duration,
        frequency =
          layer.player.frequency *
          Math.pow(layer.player.endFrequency / layer.player.frequency, u);
      phase = (phase + Math.min(frequency, sampleRate * 0.45) / sampleRate) % 1;
      let value = 0,
        stereo = 0;
      if (layer.player.type !== "synth" && channels) {
        // frequency is the playback-rate control for samples; 440 Hz means original pitch.
        const pos = t * sourceRate;
        const read = (channel: Float32Array) => {
          if (pos < 0 || pos >= channel.length) return 0;
          const j = Math.floor(pos),
            f = pos - j;
          return channel[j] * (1 - f) + (channel[j + 1] ?? channel[j]) * f;
        };
        value = read(channels[0]);
        stereo = read(channels[1] ?? channels[0]);
      } else {
        value = expression ? expression(t,phase,frequency,layer.duration) : synthSample("oscillator-v1", layer.player.wave, phase, noise);
        stereo = value;
      }
      const attack =
          layer.player.attack > 0 ? clamp(t / layer.player.attack, 0, 1) : 1,
        release = Math.min(layer.player.release, layer.duration);
      const tail =
        release > 0
          ? clamp((layer.duration - t) / release, 0, 1)
          : layer.player.type === "composition" ||
              layer.player.type === "instrument"
            ? 1
            : clamp(((layer.duration - t) * sampleRate) / 32, 0, 1);
      const envelope =
        attack *
        tail *
        Math.exp(-layer.player.decay * u);
      const process = (input: number, c: number) => {
        const cutoff = curveValue(
          layer.automation?.cutoff,
          u,
          layer.player.cutoff,
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
          layer.player.type === "composition" ||
          layer.player.type === "instrument"
            ? cutoff >= 22000
              ? input
              : filters[c]
            : filters[c] - previousInputs[c] + 0.995 * previousOutputs[c];
        previousInputs[c] = filters[c];
        previousOutputs[c] = dc;
        return (
          (layer.player.drive
            ? Math.tanh(dc * (1 + layer.player.drive)) /
              Math.tanh(1 + layer.player.drive)
            : dc) *
          envelope *
          layer.player.level
        );
      };
      const vl = process(value, 0),
        vr = layer.player.type === "synth" ? vl : process(stereo, 1);
      sourceLeft[i] = vl;
      sourceRight[i] = vr;
    }
    // Effects belong to the child. Render its complete output before the parent reads it.
    const sourceLength = child ? child.left.length : n;
    const extra = Math.ceil(effectTail(layer.player.effects) * sampleRate);
    context.frames += (sourceLength + extra) * 2;
    if (context.frames > MAX_RENDER_SAMPLES) throw Error('error.renderBudget');
    const completeL = new Float32Array(sourceLength + extra), completeR = new Float32Array(sourceLength + extra);
    if (child) {
      // Fade the mixed child output, retaining its own envelopes and effect tails.
      for (let i = 0; i < sourceLength; i++) {
        const time = i / sampleRate;
        const attack = layer.player.attack > 0 ? clamp(time / layer.player.attack, 0, 1) : 1;
        const release = Math.min(layer.player.release, layer.duration);
        const fade = attack * (release > 0 ? clamp((layer.duration - time) / release, 0, 1) : 1);
        completeL[i] = child.left[i] * layer.player.level * fade;
        completeR[i] = child.right[i] * layer.player.level * fade;
      }
    } else { completeL.set(sourceLeft); completeR.set(sourceRight); }
    if (layer.player.effects) processEffects(completeL, completeR, sampleRate, layer.player.effects);
    if (extra && Math.max(Math.abs(completeL.at(-1)!), Math.abs(completeR.at(-1)!)) >= 0.001) {
      tailLimited = true;
      const fadeFrames = Math.min(extra, Math.round(0.01 * sampleRate));
      for (let i = completeL.length - fadeFrames; i < completeL.length; i++) {
        const fade = (completeL.length - 1 - i) / Math.max(1, fadeFrames);
        completeL[i] *= fade; completeR[i] *= fade;
      }
    }
    const neutralMix = !!child && !clip.loop && !clip.reverse && clip.speed === 1 && clip.sourceStart === 0 && Math.abs(clip.sourceEnd - playerDuration(clip.player)) < 1e-6 && Math.abs(clip.duration - clip.sourceEnd) < 1e-6;
    const outputLength = neutralMix ? completeL.length : Math.round(clip.duration * sampleRate);
    const audio = new Float32Array(outputLength), clipLeft = new Float32Array(outputLength), clipRight = new Float32Array(outputLength);
    const read = (channel: Float32Array, pos: number) => {
      const frame = Math.round(pos);
      if (Math.abs(pos - frame) <= Number.EPSILON * Math.max(1, Math.abs(pos)) * 8) pos = frame;
      if (pos < 0 || pos >= channel.length) return 0;
      const j = Math.floor(pos), f = pos - j;
      return channel[j] * (1 - f) + (channel[j + 1] ?? channel[j]) * f;
    };
    for (let i = 0; i < outputLength; i++) {
      const time = neutralMix ? i / sampleRate : sourceTime(clip, i / sampleRate);
      if (time === null) continue;
      // Reverse reads the last frame inside the half-open range, never the next cycle.
      const pos = time * sampleRate - (clip.reverse ? 1 : 0);
      const u = i / Math.max(1, outputLength);
      const gain = curveValue(clip.automation?.gain, u, clip.gain);
      const panValue = curveValue(clip.automation?.pan, u, clip.pan);
      const stereo = clip.player.type === 'composition' || clip.player.type === 'instrument';
      const leftPan = stereo ? (panValue <= 0 ? 1 : Math.cos(panValue * Math.PI / 2)) : Math.cos((panValue + 1) * Math.PI / 4);
      const rightPan = stereo ? (panValue >= 0 ? 1 : Math.cos(-panValue * Math.PI / 2)) : Math.sin((panValue + 1) * Math.PI / 4);
      const l = read(completeL, pos) * gain * leftPan, r = read(completeR, pos) * gain * rightPan;
      clipLeft[i] = l; clipRight[i] = r; audio[i] = Math.abs(l) >= Math.abs(r) ? l : r;
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
    usedLength + Math.ceil(mixTail(project) * sampleRate),
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
    inputs,
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
