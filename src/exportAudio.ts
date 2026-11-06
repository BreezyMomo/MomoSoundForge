import type { Project, RenderResult } from "./model";
import { resolveControls, type LoopRegion } from "./advanced";
import { effectTail, MAX_EFFECT_TAIL, MAX_RENDER_SAMPLES } from "./nodeEffects";
export const EXPORT_FORMATS = ["wav", "ogg", "mp3", "flac"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportSettings = {
  format: ExportFormat;
  sampleRate: number;
  mono: boolean;
  normalize: boolean;
  targetRms: number;
  trimSilence: boolean;
  preserveTail: boolean;
  /** Pure silence appended after trimming, resampling and normalization. */
  tail: number;
  loopOnly: boolean;
  prefix: string;
};
export const DEFAULT_EXPORT: ExportSettings = {
  format: "wav",
  sampleRate: 48000,
  mono: false,
  normalize: false,
  targetRms: -18,
  trimSilence: false,
  preserveTail: false,
  tail: 0,
  loopOnly: false,
  prefix: "",
};
export function parseExportSettings(raw: unknown): ExportSettings {
  const value =
    raw && typeof raw === "object" ? (raw as Partial<ExportSettings>) : {};
  const result = { ...DEFAULT_EXPORT };
  if (EXPORT_FORMATS.includes(value.format as ExportFormat))
    result.format = value.format!;
  if ([22050, 44100, 48000].includes(value.sampleRate ?? 0))
    result.sampleRate = value.sampleRate!;
  for (const key of [
    "mono",
    "normalize",
    "trimSilence",
    "loopOnly",
    "preserveTail",
  ] as const)
    if (typeof value[key] === "boolean") result[key] = value[key]!;
  if (typeof value.targetRms === "number" && Number.isFinite(value.targetRms))
    result.targetRms = Math.max(-36, Math.min(-6, value.targetRms));
  if (typeof value.tail === "number" && Number.isFinite(value.tail))
    result.tail = Math.max(0, Math.min(2, value.tail));
  if (typeof value.prefix === "string")
    result.prefix = value.prefix.slice(0, 80);
  return result;
}
export function readExportSettings(): ExportSettings {
  try {
    return parseExportSettings(
      JSON.parse(localStorage.getItem("soundforge.export.v1") ?? "null"),
    );
  } catch {
    return { ...DEFAULT_EXPORT };
  }
}
export function audioResult(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): RenderResult {
  let peak = 0,
    sum = 0;
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    sum += left[i] ** 2 + right[i] ** 2;
  }
  return {
    left,
    right,
    sampleRate,
    peak,
    sourcePeak: peak,
    gainReduction: 1,
    rms: Math.sqrt(sum / Math.max(1, left.length * 2)),
    layers: {},
  };
}
export function makeLoop(
  result: RenderResult,
  region: LoopRegion,
): RenderResult {
  const start = Math.max(0, Math.round(region.start * result.sampleRate)),
    end = Math.min(
      result.left.length,
      Math.round(region.end * result.sampleRate),
    );
  const n = end - start;
  if (n < 2) throw Error("error.project");
  const cross = Math.min(
    Math.floor(n / 2),
    Math.max(0, Math.round(region.crossfade * result.sampleRate)),
  );
  const process = (input: Float32Array) => {
    const output = new Float32Array(n - cross);
    for (let i = 0; i < output.length; i++) {
      if (i < cross) {
        const u = cross > 1 ? i / (cross - 1) : 0.5;
        output[i] = input[end - cross + i] * (1 - u) + input[start + i] * u;
      } else output[i] = input[start + i];
    }
    return output;
  };
  return audioResult(
    process(result.left),
    process(result.right),
    result.sampleRate,
  );
}
// Shared by the work-range warning and export; muted branches do not extend the range.
// Shared by the work-range warning and export; muted branches do not extend the range.
export function contentRange(project: Project, result: RenderResult) {
  const resolved = resolveControls(project);
  const hasSolo = (p: Project): boolean =>
    p.layers.some(
      (l) =>
        !l.muted &&
        (l.solo || (!!l.content.project && hasSolo(l.content.project))),
    );
  const solo = hasSolo(resolved);
  const audible = resolved.layers.filter(
    (l) =>
      !l.muted &&
      (!solo || l.solo || (!!l.content.project && hasSolo(l.content.project))),
  );
  const contentEnd = Math.max(0, ...audible.map((l) => l.start + l.duration));
  const layerEnd = Math.max(
    0,
    ...audible.map(
      (l) =>
        l.start + l.duration + (result.tails?.[l.id] ?? effectTail(l.effects)),
    ),
  );
  const echoTail =
    resolved.echo > 0
      ? Math.min(
          MAX_EFFECT_TAIL,
          0.135 * (1 + Math.ceil(Math.log(0.0001) / Math.log(resolved.echo))),
        )
      : 0;
  return {
    contentEnd,
    tailEnd:
      layerEnd + (audible.length ? effectTail(resolved.effects) + echoTail : 0),
  };
}
export async function renderExport(
  project: Project,
  settings: ExportSettings,
  render: (project: Project) => Promise<RenderResult>,
): Promise<ExportResult> {
  settings = parseExportSettings(settings);
  const loopOnly = settings.loopOnly && !!project.loopRegion;
  let input = await render(project);
  if (settings.preserveTail && !loopOnly) {
    const { contentEnd, tailEnd } = contentRange(project, input);
    const duration = Math.max(project.duration, tailEnd);
    if (duration > project.duration) {
      input = await render({ ...project, duration });
      // Remove unused extension, without shortening authored content or the work range.
      const minimum = Math.min(
        input.left.length,
        Math.round(Math.max(project.duration, contentEnd) * input.sampleRate),
      );
      let end = input.left.length;
      while (
        end > minimum &&
        Math.max(
          Math.abs(input.left[end - 1]),
          Math.abs(input.right[end - 1]),
        ) < 0.001
      )
        end--;
      if (end > minimum)
        end = Math.min(
          input.left.length,
          end + Math.round(0.01 * input.sampleRate),
        );
      input = {
        ...input,
        ...audioResult(
          input.left.slice(0, end),
          input.right.slice(0, end),
          input.sampleRate,
        ),
        sourcePeak: input.sourcePeak,
        gainReduction: input.gainReduction,
      };
    }
  }
  return prepareExport(input, settings, project.loopRegion);
}
export type ExportResult = RenderResult & {
  exportInfo?: {
    audioSeconds: number;
    silenceSeconds: number;
    rangeSeconds: number;
  };
};
export function prepareExport(
  input: RenderResult,
  settings: ExportSettings,
  region?: LoopRegion,
): ExportResult {
  settings = parseExportSettings(settings);
  const loopOnly = settings.loopOnly && !!region;
  let result = loopOnly && region ? makeLoop(input, region) : input;
  let first = 0,
    last = result.left.length;
  if (settings.trimSilence && !loopOnly) {
    while (
      first < last &&
      Math.max(Math.abs(result.left[first]), Math.abs(result.right[first])) <
        0.001
    )
      first++;
    while (
      last > first &&
      Math.max(
        Math.abs(result.left[last - 1]),
        Math.abs(result.right[last - 1]),
      ) < 0.001
    )
      last--;
    if (first === last) {
      first = 0;
      last = Math.min(result.left.length, 1);
    }
  }
  const length = Math.max(
    1,
    Math.round(((last - first) * settings.sampleRate) / result.sampleRate),
  );
  const silenceFrames = loopOnly
    ? 0
    : Math.round(settings.tail * settings.sampleRate);
  if (
    !Number.isFinite(length + silenceFrames) ||
    (length + silenceFrames) * 4 > MAX_RENDER_SAMPLES
  )
    throw Error("error.renderBudget");
  // Windowed sinc low-pass prevents high frequencies folding into the game-rate output.
  const ratio = settings.sampleRate / result.sampleRate,
    radius = 24,
    phases = 512;
  const kernels =
    ratio < 1
      ? Array.from({ length: phases }, (_, phase) => {
          const fraction = phase / phases,
            cutoff = ratio * 0.94;
          const weights = Float64Array.from(
            { length: radius * 2 + 1 },
            (_, j) => {
              const x = j - radius - fraction,
                t = Math.PI * x * cutoff;
              return (
                (Math.abs(t) < 1e-10 ? 1 : Math.sin(t) / t) *
                cutoff *
                (0.5 + 0.5 * Math.cos((Math.PI * x) / (radius + 1)))
              );
            },
          );
          const sum = weights.reduce((a, b) => a + b, 0);
          return weights.map((w) => w / sum);
        })
      : null;
  const convert = (input: Float32Array) =>
    Float32Array.from({ length }, (_, i) => {
      const p = Math.min(last - 1, first + i / ratio),
        a = Math.floor(p),
        u = p - a;
      if (!kernels)
        return (
          (input[a] ?? 0) * (1 - u) +
          (input[Math.min(last - 1, a + 1)] ?? 0) * u
        );
      const weights = kernels[Math.min(phases - 1, Math.floor(u * phases))];
      let value = 0;
      for (let j = 0; j < weights.length; j++)
        value +=
          input[Math.max(first, Math.min(last - 1, a + j - radius))] *
          weights[j];
      return value;
    });
  const left = convert(result.left),
    right = convert(result.right);
  if (settings.mono)
    for (let i = 0; i < length; i++)
      left[i] = right[i] = (left[i] + right[i]) * 0.5;
  result = audioResult(left, right, settings.sampleRate);
  const wanted =
    settings.normalize && result.rms > 0
      ? 10 ** (settings.targetRms / 20) / result.rms
      : 1;
  const gain = Math.min(wanted, result.peak > 0 ? 0.98 / result.peak : 1);
  for (let i = 0; i < length; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
  const pad = (channel: Float32Array) => {
    if (!silenceFrames) return channel;
    const padded = new Float32Array(length + silenceFrames);
    padded.set(channel);
    return padded;
  };
  const output: ExportResult = audioResult(
    pad(left),
    pad(right),
    settings.sampleRate,
  );
  output.gainReduction = wanted > 0 ? gain / wanted : 1;
  output.sourcePeak = input.sourcePeak;
  output.tailLimited = input.tailLimited;
  output.exportInfo = {
    audioSeconds: length / settings.sampleRate,
    silenceSeconds: silenceFrames / settings.sampleRate,
    rangeSeconds: input.left.length / input.sampleRate,
  };
  return output;
}
export function exportWav(result: RenderResult, mono: boolean): ArrayBuffer {
  const channels = mono ? 1 : 2,
    buffer = new ArrayBuffer(44 + result.left.length * channels * 2),
    v = new DataView(buffer);
  const text = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, result.sampleRate, true);
  v.setUint32(28, result.sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, buffer.byteLength - 44, true);
  for (let i = 0; i < result.left.length; i++)
    for (let c = 0; c < channels; c++) {
      const x = Math.max(-1, Math.min(1, (c ? result.right : result.left)[i]));
      v.setInt16(
        44 + (i * channels + c) * 2,
        Math.round(x * (x < 0 ? 32768 : 32767)),
        true,
      );
    }
  return buffer;
}
export function seamPreview(result: RenderResult): RenderResult {
  const n = Math.min(result.left.length, Math.round(result.sampleRate * 0.25));
  const join = (x: Float32Array) => {
    const y = new Float32Array(n * 2);
    y.set(x.slice(-n));
    y.set(x.slice(0, n), n);
    return y;
  };
  return audioResult(join(result.left), join(result.right), result.sampleRate);
}
