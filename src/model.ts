import { validateVideoReference, type VideoReference } from "./videoReference";
import { validateSampleSource, type SampleSource } from "./sampleSource";
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
export const MAX_SAMPLE_FRAMES = 5_760_000; // Per-channel decoded sample budget; duration depends on sample rate.
export const MAX_ASSET_BYTES = 24 * 1024 * 1024;
export const MAX_COMPOSITION_DEPTH = 6;
export const MAX_TOTAL_LAYERS = 128;
export const DEFAULT_PROJECT_DURATION = 10;
export const makeProject = (name: string): Project => ({
  schema: "momo.soundforge/v3",
  name,
  seed: 2048,
  duration: DEFAULT_PROJECT_DURATION,
  master: 1,
  echo: 0,
  layers: [],
  assets: {},
});
export type Wave = "sine" | "triangle" | "saw" | "square" | "noise";
/** A sound layer owns placement and outer processing. Its content is independently replaceable. */
export type Layer = {
  id: string;
  name: string;
  start: number;
  duration: number;
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  effects?: Effects;
  automation?: Automation;
  content: SoundContent;
};
/** Source-specific playback and shaping; never copied from the old content across replacement. */
export type SoundContent = {
  type: "synth" | "sample" | "composition" | "instrument";
  wave: Wave;
  noiseSeed: number;
  level: number;
  assetId?: string;
  score?: Score;
  project?: Project;
  controlValues?: Record<string, number>;
  sourceDuration?: number;
  cropStart?: number;
  cropEnd?: number;
  frequency: number;
  endFrequency: number;
  attack: number;
  release: number;
  decay: number;
  cutoff: number;
  drive: number;
  trim: number;
  reverse: boolean;
};
export const CONTENT_KEYS = [
  "level",
  "type",
  "wave",
  "noiseSeed",
  "assetId",
  "score",
  "project",
  "controlValues",
  "sourceDuration",
  "cropStart",
  "cropEnd",
  "frequency",
  "endFrequency",
  "attack",
  "release",
  "decay",
  "cutoff",
  "drive",
  "trim",
  "reverse",
] as const;
export type LayerPatch = Partial<Omit<Layer, "content">> & {
  content?: Partial<SoundContent>;
};
export function patchLayer(layer: Layer, patch: LayerPatch): Layer {
  return {
    ...layer,
    ...patch,
    content: { ...layer.content, ...patch.content },
  };
}
export type LayerField = keyof Omit<Layer, "content"> | keyof SoundContent;
export type LayerValue = Layer[keyof Layer] | SoundContent[keyof SoundContent];
export function layerValue(layer: Layer, key: LayerField): LayerValue {
  return (CONTENT_KEYS as readonly string[]).includes(key)
    ? layer.content[key as keyof SoundContent]
    : layer[key as keyof Layer];
}
export function withLayerValue(
  layer: Layer,
  key: LayerField,
  value: LayerValue,
): Layer {
  return (CONTENT_KEYS as readonly string[]).includes(key)
    ? { ...layer, content: { ...layer.content, [key]: value } }
    : { ...layer, [key]: value };
}
// Construction shorthand only; native documents always store the nested content object.
export type LayerInit = Partial<Omit<Layer, "content">> &
  Partial<SoundContent> & { content?: Partial<SoundContent> };
export type SampleAsset = {
  source?: SampleSource;
  id: string;
  name: string;
  sampleRate: number;
  channels: string[];
};
export type Project = {
  videoReference?: VideoReference;
  schema: "momo.soundforge/v3";
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
export function makeLayer(patch: LayerInit = {}): Layer {
  const content: SoundContent = {
    level: 1,
    type: "synth",
    wave: "sine",
    noiseSeed: 2048,
    frequency: 220,
    endFrequency: 110,
    attack: 0.005,
    release: 0.12,
    decay: 2,
    cutoff: 18000,
    drive: 0,
    trim: 0,
    reverse: false,
    ...Object.fromEntries(
      CONTENT_KEYS.filter((k) => Object.hasOwn(patch, k)).map((k) => [
        k,
        patch[k],
      ]),
    ),
    ...patch.content,
  };
  const outer = Object.fromEntries(
    Object.entries(patch).filter(
      ([key]) =>
        key !== "content" && !(CONTENT_KEYS as readonly string[]).includes(key),
    ),
  );
  return {
    id: uid(),
    name: "Layer",
    start: 0,
    duration: 0.5,
    gain: 0.6,
    pan: 0,
    muted: false,
    solo: false,
    locked: false,
    ...outer,
    content,
  };
}
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
  const r = raw as Omit<Project, "schema"> & {
    schema: string;
  };
  const num = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const str = (v: unknown, max = 120): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= max;
  if (
    r.schema !== "momo.soundforge/v3" ||
    !str(r.name) ||
    !num(r.seed, 0, 4294967295) ||
    !Number.isInteger(r.seed) ||
    !num(r.duration, 0.1, Number.MAX_VALUE) ||
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
      if (!decoded.length || decoded.length > MAX_SAMPLE_FRAMES) return fail();
      lengths.push(decoded.length);
    }
    if (lengths.some((l) => l !== lengths[0])) return fail();
    assets[id] = {
      ...(a.source !== undefined
        ? { source: validateSampleSource(a.source) }
        : {}),
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
      Object.keys(l).some((k) =>
        (CONTENT_KEYS as readonly string[]).includes(k),
      ) ||
      !l.content ||
      typeof l.content !== "object" ||
      Array.isArray(l.content) ||
      !str(l.id) ||
      ids.has(l.id) ||
      !str(l.name) ||
      !["synth", "sample", "composition", "instrument"].includes(
        l.content.type,
      ) ||
      !["sine", "triangle", "saw", "square", "noise"].includes(l.content.wave)
    )
      return fail();
    ids.add(l.id);
    if (
      (l.content.sourceDuration !== undefined &&
        !num(l.content.sourceDuration, 0.01, Number.MAX_VALUE)) ||
      (l.content.cropStart !== undefined && !num(l.content.cropStart, 0, 1)) ||
      (l.content.cropEnd !== undefined && !num(l.content.cropEnd, 0, 1)) ||
      (l.content.cropStart ?? 0) >= (l.content.cropEnd ?? 1)
    )
      return fail();
    const ranges = {
      start: [0, Number.MAX_VALUE],
      duration: [0.01, Number.MAX_VALUE],
      gain: [0, 1.5],
      pan: [-1, 1],
      level: [0, 8],
      frequency: [20, 20000],
      endFrequency: [20, 20000],
      attack: [0, 3],
      release: [0, 5],
      decay: [0, 10],
      cutoff: [30, 22000],
      drive: [0, 10],
      trim: [0, Number.MAX_VALUE],
    } as const;
    for (const [key, [min, max]] of Object.entries(ranges))
      if (!num(layerValue(l, key as LayerField), min, max)) return fail();
    for (const key of ["reverse", "muted", "solo", "locked"] as const)
      if (typeof layerValue(l, key) !== "boolean") return fail();
    if (
      l.content.type === "sample" &&
      (!l.content.assetId || !Object.hasOwn(assets, l.content.assetId))
    )
      return fail();
    if (
      l.content.noiseSeed !== undefined &&
      (!num(l.content.noiseSeed, 0, 4294967295) ||
        !Number.isInteger(l.content.noiseSeed))
    )
      return fail();
    if (l.content.type === "instrument") {
      validateScore(l.content.score!, assets);
      budget.notes += l.content.score!.notes.length;
      if (budget.notes > MAX_TOTAL_NOTES) return fail();
    }
    const content = Object.fromEntries(
      CONTENT_KEYS.filter((k) => Object.hasOwn(l.content, k)).map((k) => [
        k,
        structuredClone(l.content[k]),
      ]),
    ) as SoundContent;
    if (content.type !== "sample") delete content.assetId;
    if (content.type !== "instrument") delete content.score;
    if (content.type === "composition")
      content.project = readProject(l.content.project, budget, depth + 1);
    else {
      delete content.project;
      delete content.controlValues;
    }
    layers.push({
      id: l.id,
      name: l.name,
      start: l.start,
      duration: l.duration,
      gain: l.gain,
      pan: l.pan,
      muted: l.muted,
      solo: l.solo,
      locked: l.locked,
      content,
      ...(l.effects !== undefined
        ? { effects: structuredClone(l.effects) }
        : {}),
      ...(l.automation !== undefined
        ? { automation: structuredClone(l.automation) }
        : {}),
    });
  }
  budget.stack.delete(raw);
  const parsed: Project = {
    ...(r.videoReference !== undefined
      ? { videoReference: validateVideoReference(r.videoReference) }
      : {}),
    schema: "momo.soundforge/v3",
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
      value * Math.pow(2, (random() - 0.5) * amount * scale),
    // Instrument round-robin selection uses project.seed ^ layer.noiseSeed.
    // Compensate for the new project seed when this voice must stay identical.
    preservedSeed = (l: Layer) =>
      l.content.type === "instrument"
        ? (l.content.noiseSeed ^ project.seed ^ seed) >>> 0
        : l.content.noiseSeed;
  return {
    ...project,
    seed: seed >>> 0,
    layers: project.layers.map((l) =>
      l.locked || amount === 0
        ? {
            ...l,
            content: {
              ...l.content,
              noiseSeed: preservedSeed(l),
            },
          }
        : l.content.type === "composition" && l.content.project
          ? (() => {
              const child = varyProject(
                l.content.project,
                Math.floor(random() * 4294967296),
                amount,
              );
              const duration = Math.max(
                0.1,
                ...child.layers.map((n) => n.start + n.duration),
              );
              return {
                ...l,
                duration,
                gain: clamp(jitter(l.gain, 0.3), 0, 1.5),
                pan: clamp(l.pan + (random() - 0.5) * amount * 0.4, -1, 1),
                content: {
                  ...l.content,
                  project: { ...child, duration },
                },
              };
            })()
          : {
              ...l,
              duration: Math.max(0.01, jitter(l.duration, 0.35)),
              gain: clamp(jitter(l.gain, 0.3), 0, 1.5),
              pan: clamp(l.pan + (random() - 0.5) * amount * 0.4, -1, 1),
              content: {
                ...l.content,
                noiseSeed: Math.floor(random() * 4294967296),
                frequency: clamp(jitter(l.content.frequency, 0.8), 20, 20000),
                endFrequency: clamp(
                  jitter(l.content.endFrequency, 0.8),
                  20,
                  20000,
                ),
              },
            },
    ),
  };
}
// Temporary audition state: keep the source document and its timing untouched.
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
    p.layers
      .filter((l) => l.content.type === "sample")
      .map((l) => l.content.assetId),
  );
  for (const layer of p.layers)
    if (layer.content.type === "instrument" && layer.content.score)
      for (const id of scoreAssets(layer.content.score)) used.add(id);
  return {
    ...p,
    schema: "momo.soundforge/v3",
    layers: p.layers.map((layer) =>
      layer.content.type === "composition" && layer.content.project
        ? {
            ...layer,
            content: {
              ...layer.content,
              project: projectForSave(layer.content.project),
            },
          }
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
      if (layer.content.type === "instrument") {
        validateScore(layer.content.score!, p.assets);
        notes += layer.content.score!.notes.length;
        if (notes > MAX_TOTAL_NOTES) throw Error("score.invalid");
      }
      if (layer.content.type === "composition") {
        if (!layer.content.project) throw Error("error.project");
        visit(layer.content.project, depth + 1);
      }
    }
    stack.delete(p);
  };
  visit(project, 0);
}
export function makeComposition(
  project: Project,
  patch: LayerInit = {},
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
    if (layer?.content.type !== "composition" || !layer.content.project) break;
    valid.push(id);
    project = layer.content.project;
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
  if (layer?.content.type !== "composition" || !layer.content.project)
    return root;
  const before = layer.content.project,
    after = updateProjectAtPath(before, rest, change);
  if (before === after) return root;
  const followsDuration =
    layer.content.sourceDuration === undefined &&
    layer.content.trim === 0 &&
    Math.abs(
      layer.duration - before.duration / (layer.content.frequency / 440),
    ) < 1e-6;
  const duration = followsDuration
    ? Math.max(0.01, after.duration / (layer.content.frequency / 440))
    : layer.duration;
  const updated = {
    ...layer,
    duration,
    name: layer.name === before.name ? after.name : layer.name,
    content: {
      ...layer.content,
      project: after,
    },
  };
  const projectDuration =
    followsDuration && layer.start + layer.duration <= root.duration + 1e-6
      ? Math.max(root.duration, layer.start + duration)
      : root.duration;
  return {
    ...root,
    duration: projectDuration,
    layers: root.layers.map((l) => (l.id === id ? updated : l)),
  };
}
