import { validateVideoReference, type VideoReference } from "./videoReference";
import {
  validateScore,
  scoreAssets,
  MAX_TOTAL_NOTES,
  type Score,
} from "./instruments";
import {
  resolveControls,
  validateAdvanced,
  type Automation,
  type Macro,
  type Effects,
  type LoopRegion,
} from "./advanced";
export const SAMPLE_RATE = 48000;
export const MAX_SAMPLE_FRAMES = 5_760_000; // 30 seconds at the maximum accepted rate, 192 kHz.
export const MAX_ASSET_BYTES = 24 * 1024 * 1024;
export const MAX_COMPOSITION_DEPTH = 6;
export const MAX_TOTAL_LAYERS = 128;
export type Wave = "sine" | "triangle" | "saw" | "square" | "noise";
export type Layer = {
  id: string;
  name: string;
  type: "synth" | "sample" | "composition" | "instrument";
  score?: Score;
  effects?: Effects;
  project?: Project;
  wave: Wave;
  noiseSeed: number;
  assetId?: string;
  start: number;
  duration: number;
  automation?: Automation;
  controlValues?: Record<string, number>;
  sourceDuration?: number;
  cropStart?: number;
  cropEnd?: number;
  gain: number;
  pan: number;
  frequency: number;
  endFrequency: number;
  attack: number;
  release: number;
  decay: number;
  cutoff: number;
  drive: number;
  trim: number;
  reverse: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
};
export type SampleAsset = {
  id: string;
  name: string;
  sampleRate: number;
  channels: string[];
};
export type Project = {
  videoReference?: VideoReference;
  schema: "momo.soundforge/v2";
  name: string;
  controls?: Macro[];
  controlValues?: Record<string, number>;
  effects?: Effects;
  loopRegion?: LoopRegion;
  seed: number;
  duration: number;
  master: number;
  echo: number;
  layers: Layer[];
  assets: Record<string, SampleAsset>;
};
export type RenderResult = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  peak: number;
  sourcePeak: number;
  gainReduction: number;
  rms: number;
  layers: Record<string, Float32Array>;
  tails?: Record<string, number>;
  processedLayers?: Record<string, Float32Array>;
  tailLimited?: boolean;
};
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random()}`;
export const clamp = (x: number, a: number, b: number) =>
  Math.min(b, Math.max(a, x));
export const makeLayer = (patch: Partial<Layer> = {}): Layer => ({
  id: uid(),
  name: "Layer",
  type: "synth",
  wave: "sine",
  noiseSeed: 2048,
  start: 0,
  duration: 0.5,
  gain: 0.6,
  pan: 0,
  frequency: 220,
  endFrequency: 110,
  attack: 0.005,
  release: 0.12,
  decay: 2,
  cutoff: 18000,
  drive: 0,
  trim: 0,
  reverse: false,
  muted: false,
  solo: false,
  locked: false,
  ...patch,
});
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function stableHash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function encodeSamples(data: Float32Array) {
  const bytes = new Uint8Array(data.length * 4),
    view = new DataView(bytes.buffer);
  data.forEach((value, i) => view.setFloat32(i * 4, value, true));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function decodeSamples(data: string) {
  const binary = atob(data);
  if (binary.length % 4) throw Error("Invalid sample encoding");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    view = new DataView(bytes.buffer),
    out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) {
    const n = view.getFloat32(i * 4, true);
    if (!Number.isFinite(n) || Math.abs(n) > 1.01)
      throw Error("Invalid sample value");
    out[i] = n;
  }
  return out;
}
type ReadBudget = {
  bytes: number;
  layers: number;
  notes: number;
  stack: Set<object>;
};
export function parseProject(raw: unknown): Project {
  return readProject(
    raw,
    { bytes: 0, layers: 0, notes: 0, stack: new Set() },
    0,
  );
}
function readProject(raw: unknown, budget: ReadBudget, depth: number): Project {
  const fail = (): never => {
    throw Error("Invalid SoundForge project");
  };
  if (!raw || typeof raw !== "object") return fail();
  if (depth > MAX_COMPOSITION_DEPTH || budget.stack.has(raw)) return fail();
  budget.stack.add(raw);
  const r = raw as Omit<Project, "schema"> & { schema: string };
  const num = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const str = (v: unknown, max = 120): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= max;
  if (
    !["momo.soundforge/v1", "momo.soundforge/v2"].includes(r.schema) ||
    !str(r.name) ||
    !num(r.seed, 0, 4294967295) ||
    !Number.isInteger(r.seed) ||
    !num(r.duration, 0.1, 10) ||
    !num(r.master, 0, 1.5) ||
    !num(r.echo, 0, 0.6) ||
    !Array.isArray(r.layers) ||
    r.layers.length > 16 ||
    !r.assets ||
    typeof r.assets !== "object" ||
    Array.isArray(r.assets)
  )
    return fail();
  if (Object.keys(r.assets).length > 64) return fail();
  const assets: Project["assets"] = Object.create(null);
  for (const [id, a] of Object.entries(r.assets)) {
    if (
      !str(id) ||
      !a ||
      a.id !== id ||
      !str(a.name) ||
      !num(a.sampleRate, 8000, 192000) ||
      !Array.isArray(a.channels) ||
      a.channels.length < 1 ||
      a.channels.length > 2
    )
      return fail();
    const lengths: number[] = [];
    for (const channel of a.channels) {
      if (
        typeof channel !== "string" ||
        channel.length > ((MAX_SAMPLE_FRAMES * 4) / 3) * 4 + 8
      )
        return fail();
      budget.bytes += channel.length * 0.75;
      if (budget.bytes > MAX_ASSET_BYTES) return fail();
      const decoded = decodeSamples(channel);
      if (
        !decoded.length ||
        decoded.length > MAX_SAMPLE_FRAMES ||
        decoded.length / a.sampleRate > 30.001
      )
        return fail();
      lengths.push(decoded.length);
    }
    if (lengths.some((l) => l !== lengths[0])) return fail();
    assets[id] = {
      id,
      name: a.name,
      sampleRate: a.sampleRate,
      channels: [...a.channels],
    };
  }
  const ids = new Set<string>();
  const layers: Layer[] = [];
  for (const l of r.layers) {
    if (++budget.layers > MAX_TOTAL_LAYERS) return fail();
    if (
      !l ||
      !str(l.id) ||
      ids.has(l.id) ||
      !str(l.name) ||
      !["synth", "sample", "composition", "instrument"].includes(l.type) ||
      !["sine", "triangle", "saw", "square", "noise"].includes(l.wave)
    )
      return fail();
    ids.add(l.id);
    if (
      (l.sourceDuration !== undefined && !num(l.sourceDuration, 0.01, 10)) ||
      (l.cropStart !== undefined && !num(l.cropStart, 0, 1)) ||
      (l.cropEnd !== undefined && !num(l.cropEnd, 0, 1)) ||
      (l.cropStart ?? 0) >= (l.cropEnd ?? 1)
    )
      return fail();
    const ranges = {
      start: [0, 10],
      duration: [0.01, 10],
      gain: [0, 1.5],
      pan: [-1, 1],
      frequency: [20, 20000],
      endFrequency: [20, 20000],
      attack: [0, 3],
      release: [0, 5],
      decay: [0, 10],
      cutoff: [30, 22000],
      drive: [0, 10],
      trim: [0, 30],
    } as const;
    for (const [key, [min, max]] of Object.entries(ranges))
      if (!num(l[key as keyof Layer], min, max)) return fail();
    for (const key of ["reverse", "muted", "solo", "locked"] as const)
      if (typeof l[key] !== "boolean") return fail();
    if (
      l.type === "sample" &&
      (!l.assetId || !Object.hasOwn(assets, l.assetId))
    )
      return fail();
    if (
      l.noiseSeed !== undefined &&
      (!num(l.noiseSeed, 0, 4294967295) || !Number.isInteger(l.noiseSeed))
    )
      return fail();
    if (l.type === "instrument") {
      validateScore(l.score!, assets);
      budget.notes += l.score!.notes.length;
      if (budget.notes > MAX_TOTAL_NOTES) return fail();
    }
    layers.push({
      ...makeLayer(),
      ...Object.fromEntries(
        [
          "id",
          "name",
          "type",
          "wave",
          "assetId",
          ...Object.keys(ranges),
          "reverse",
          "muted",
          "solo",
          "locked",
        ].map((k) => [k, l[k as keyof Layer]]),
      ),
      noiseSeed: l.noiseSeed ?? r.seed,
      ...(l.type === "instrument" ? { score: structuredClone(l.score!) } : {}),
      ...(l.effects !== undefined
        ? { effects: structuredClone(l.effects) }
        : {}),
      ...(l.automation !== undefined
        ? { automation: structuredClone(l.automation) }
        : {}),
      ...(l.controlValues !== undefined
        ? { controlValues: structuredClone(l.controlValues) }
        : {}),
      ...(l.sourceDuration !== undefined
        ? { sourceDuration: l.sourceDuration }
        : {}),
      ...(l.cropStart !== undefined ? { cropStart: l.cropStart } : {}),
      ...(l.cropEnd !== undefined ? { cropEnd: l.cropEnd } : {}),
      ...(l.type === "composition"
        ? { project: readProject(l.project, budget, depth + 1) }
        : {}),
    } as Layer);
  }
  budget.stack.delete(raw);
  const parsed: Project = {
    ...(r.videoReference !== undefined ? { videoReference: validateVideoReference(r.videoReference) } : {}),
    schema: "momo.soundforge/v2",
    name: r.name,
    seed: r.seed,
    duration: r.duration,
    master: r.master,
    echo: r.echo,
    layers,
    assets,
    ...(r.controls !== undefined
      ? { controls: structuredClone(r.controls) }
      : {}),
    ...(r.controlValues !== undefined
      ? { controlValues: structuredClone(r.controlValues) }
      : {}),
    ...(r.effects !== undefined ? { effects: structuredClone(r.effects) } : {}),
    ...(r.loopRegion !== undefined
      ? { loopRegion: structuredClone(r.loopRegion) }
      : {}),
  };
  validateAdvanced(parsed);
  return parsed;
}
export function varyProject(
  project: Project,
  seed: number,
  amount: number,
): Project {
  const random = rng(seed),
    jitter = (value: number, scale: number) =>
      value * Math.pow(2, (random() - 0.5) * amount * scale);
  return {
    ...project,
    seed: seed >>> 0,
    layers: project.layers.map((l) =>
      l.locked
        ? { ...l }
        : l.type === "composition" && l.project
          ? (() => {
              const child = varyProject(
                l.project,
                amount === 0
                  ? l.project.seed
                  : Math.floor(random() * 4294967296),
                amount,
              );
              const duration =
                amount === 0
                  ? l.duration
                  : Math.max(
                      0.1,
                      ...child.layers.map((n) => n.start + n.duration),
                    );
              return {
                ...l,
                project: { ...child, duration },
                duration,
                gain: clamp(jitter(l.gain, 0.3), 0, 1.5),
                pan: clamp(l.pan + (random() - 0.5) * amount * 0.4, -1, 1),
              };
            })()
          : {
              ...l,
              noiseSeed:
                amount === 0 ? l.noiseSeed : Math.floor(random() * 4294967296),
              frequency: clamp(jitter(l.frequency, 0.8), 20, 20000),
              endFrequency: clamp(jitter(l.endFrequency, 0.8), 20, 20000),
              duration: clamp(jitter(l.duration, 0.35), 0.01, 10),
              gain: clamp(jitter(l.gain, 0.3), 0, 1.5),
              pan: clamp(l.pan + (random() - 0.5) * amount * 0.4, -1, 1),
            },
    ),
  };
}
// Temporary audition state: keep the source document and its timing untouched.
export function createLayerPreviewProject(
  project: Project,
  layerId: string,
): Project {
  const layer = resolveControls(project).layers.find(
    (item) => item.id === layerId,
  );
  if (!layer) throw Error("Unknown sound layer");
  return {
    ...project,
    duration: layer.duration,
    master: 1,
    echo: 0,
    effects: undefined,
    controls: undefined,
    controlValues: undefined,
    loopRegion: undefined,
    layers: [{ ...layer, start: 0, muted: false, solo: false }],
  };
}

export function projectForSave(p: Project): Project {
  const used = new Set(
    p.layers.filter((l) => l.type === "sample").map((l) => l.assetId),
  );
  for (const layer of p.layers)
    if (layer.type === "instrument" && layer.score)
      for (const id of scoreAssets(layer.score)) used.add(id);
  return {
    ...p,
    schema: "momo.soundforge/v2",
    layers: p.layers.map((layer) =>
      layer.type === "composition" && layer.project
        ? { ...layer, project: projectForSave(layer.project) }
        : layer,
    ),
    assets: Object.fromEntries(
      Object.entries(p.assets).filter(([id]) => used.has(id)),
    ),
  };
}

export function assertProjectLimits(project: Project) {
  let layers = 0,
    notes = 0,
    bytes = 0;
  const stack = new Set<Project>();
  const visit = (p: Project, depth: number) => {
    if (depth > MAX_COMPOSITION_DEPTH || stack.has(p) || p.layers.length > 16)
      throw Error("error.compositionLimit");
    stack.add(p);
    if (Object.keys(p.assets).length > 64) throw Error("error.budget");
    for (const asset of Object.values(p.assets))
      for (const channel of asset.channels) {
        bytes += channel.length * 0.75;
        if (bytes > MAX_ASSET_BYTES) throw Error("error.budget");
      }
    for (const layer of p.layers) {
      if (++layers > MAX_TOTAL_LAYERS) throw Error("error.compositionLimit");
      if (layer.type === "instrument") {
        validateScore(layer.score!, p.assets);
        notes += layer.score!.notes.length;
        if (notes > MAX_TOTAL_NOTES) throw Error("score.invalid");
      }
      if (layer.type === "composition") {
        if (!layer.project) throw Error("error.project");
        visit(layer.project, depth + 1);
      }
    }
    stack.delete(p);
  };
  visit(project, 0);
}
export function makeComposition(
  project: Project,
  patch: Partial<Layer> = {},
): Layer {
  assertProjectLimits(project);
  return makeLayer({
    name: project.name,
    type: "composition",
    project: projectForSave(project),
    duration: project.duration,
    frequency: 440,
    endFrequency: 440,
    gain: 1,
    attack: 0,
    release: 0,
    decay: 0,
    cutoff: 22000,
    ...patch,
  });
}
export function wrapProject(project: Project): Project {
  const result = {
    ...project,
    master: 1,
    echo: 0,
    assets: {},
    layers: [makeComposition(project)],
    controls: undefined,
    controlValues: undefined,
    effects: undefined,
  };
  assertProjectLimits(result);
  return result;
}
export function resolveProjectPath(root: Project, path: readonly string[]) {
  let project = root;
  const valid: string[] = [],
    breadcrumbs = [{ name: root.name, path: [] as string[] }];
  for (const id of path) {
    const layer = project.layers.find((l) => l.id === id);
    if (layer?.type !== "composition" || !layer.project) break;
    valid.push(id);
    project = layer.project;
    breadcrumbs.push({ name: layer.name, path: [...valid] });
  }
  return { project, path: valid, breadcrumbs };
}
export function updateProjectAtPath(
  root: Project,
  path: readonly string[],
  change: (project: Project) => Project,
): Project {
  if (!path.length) return change(root);
  const [id, ...rest] = path,
    layer = root.layers.find((l) => l.id === id);
  if (layer?.type !== "composition" || !layer.project) return root;
  const before = layer.project,
    after = updateProjectAtPath(before, rest, change);
  if (before === after) return root;
  const followsDuration =
    layer.sourceDuration === undefined &&
    layer.trim === 0 &&
    Math.abs(layer.duration - before.duration / (layer.frequency / 440)) < 1e-6;
  const duration = followsDuration
    ? clamp(after.duration / (layer.frequency / 440), 0.01, 10)
    : layer.duration;
  const updated = {
    ...layer,
    project: after,
    duration,
    name: layer.name === before.name ? after.name : layer.name,
  };
  const projectDuration =
    followsDuration && layer.start + layer.duration <= root.duration + 1e-6
      ? Math.min(10, Math.max(root.duration, layer.start + duration))
      : root.duration;
  return {
    ...root,
    duration: projectDuration,
    layers: root.layers.map((l) => (l.id === id ? updated : l)),
  };
}
