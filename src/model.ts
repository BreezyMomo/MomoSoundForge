import { effectTail } from "./nodeEffects";
import { BASIC_SYNTH, parseSynth, synthValues, type SynthDefinition } from "./synthesizers";
import { playerDuration } from "./playerPlayback";
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
  schema: "momo.soundforge/v4",
  name,
  seed: 2048,
  duration: DEFAULT_PROJECT_DURATION,
  master: 1,
  echo: 0,
  inputs: [],
  assets: {},
});
export type Wave = "sine" | "triangle" | "saw" | "square" | "noise";
/** One parent's use of a child player. The editor displays this use as a layer. */
export type PlayerInput = {
  id: string;
  name: string;
  start: number;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
  speed: number;
  loop: boolean;
  reverse: boolean;
  gain: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  automation?: Automation;
  player: Player;
};
/** Source-specific playback and shaping; never copied from the old player across replacement. */
export type Player = {
  synth?: SynthDefinition;
  synthValues?: Record<string, number>;
  type: "synth" | "sample" | "composition" | "instrument";
  wave: Wave;
  noiseSeed: number;
  level: number;
  duration: number;
  effects?: Effects;
  assetId?: string;
  score?: Score;
  mix?: Project;
  controlValues?: Record<string, number>;
  frequency: number;
  endFrequency: number;
  attack: number;
  release: number;
  decay: number;
  cutoff: number;
  drive: number;
};
export const CONTENT_KEYS = [
  "synth",
  "synthValues",
  "effects",
  "level",
  "type",
  "wave",
  "noiseSeed",
  "assetId",
  "score",
  "mix",
  "controlValues",
  "frequency",
  "endFrequency",
  "attack",
  "release",
  "decay",
  "cutoff",
  "drive",
] as const;
export type LayerPatch = Partial<Omit<PlayerInput, "player">> & {
  player?: Partial<Player>;
};
export function patchLayer(layer: PlayerInput, patch: LayerPatch): PlayerInput {
  const next = {
    ...layer,
    ...patch,
    player: { ...layer.player, ...patch.player },
  };
  if (patch.player && patch.sourceEnd === undefined && patch.duration === undefined &&
      layer.sourceStart === 0 && Math.abs(layer.sourceEnd - playerDuration(layer.player)) < 1e-6) {
    next.sourceEnd = playerDuration(next.player);
    if (!next.loop) next.duration = Math.max(0.01, next.sourceEnd / next.speed);
  }
  return next;
}
export type LayerField = keyof Omit<PlayerInput, "player"> | keyof Player | "generatorDuration";
export type LayerValue = PlayerInput[keyof PlayerInput] | Player[keyof Player];
export function layerValue(layer: PlayerInput, key: LayerField): LayerValue {
  if (key === "generatorDuration") return layer.player.duration;
  return (CONTENT_KEYS as readonly string[]).includes(key)
    ? layer.player[key as keyof Player]
    : layer[key as keyof PlayerInput];
}
export function withLayerValue(
  layer: PlayerInput,
  key: LayerField,
  value: LayerValue,
): PlayerInput {
  if (key === "generatorDuration") {
    const duration = value as number;
    const full = Math.abs(layer.sourceEnd - playerDuration(layer.player)) < 1e-6;
    return { ...layer, player: { ...layer.player, duration },
      ...(full ? { sourceEnd: duration + effectTail(layer.player.effects), duration: layer.loop ? layer.duration : (duration + effectTail(layer.player.effects) - layer.sourceStart) / layer.speed } : {}) };
  }
  const next = (CONTENT_KEYS as readonly string[]).includes(key)
    ? { ...layer, player: { ...layer.player, [key]: value } }
    : { ...layer, [key]: value };
  if ((key === "sourceStart" || key === "sourceEnd" || key === "speed") && !next.loop)
    next.duration = Math.max(0.01, (next.sourceEnd - next.sourceStart) / next.speed);
  if (key === "duration" && !next.loop) next.sourceEnd = next.sourceStart + next.duration * next.speed;
  if (key === "effects" && Math.abs(layer.sourceEnd - playerDuration(layer.player)) < 1e-6) {
    next.sourceEnd = playerDuration(next.player);
    if (!next.loop) next.duration = Math.max(0.01, (next.sourceEnd - next.sourceStart) / next.speed);
  }
  return next;
}
// Construction shorthand only; native documents always store the nested player object.
export type LayerInit = Partial<Omit<PlayerInput, "player">> &
  Partial<Omit<Player, "duration">> & { player?: Partial<Player> };
export type SampleAsset = {
  source?: SampleSource;
  id: string;
  name: string;
  sampleRate: number;
  channels: string[];
};
export type Project = {
  videoReference?: VideoReference;
  schema: "momo.soundforge/v4";
  name: string;
  controls?: Macro[];
  controlValues?: Record<string, number>;
  effects?: Effects;
  loopRegion?: LoopRegion;
  seed: number;
  duration: number;
  master: number;
  echo: number;
  inputs: PlayerInput[];
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
  inputs: Record<string, Float32Array>;
  tails?: Record<string, number>;
  processedLayers?: Record<string, Float32Array>;
  tailLimited?: boolean;
};
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random()}`;
export const clamp = (x: number, a: number, b: number) =>
  Math.min(b, Math.max(a, x));
export function makeLayer(patch: LayerInit = {}): PlayerInput {
  const player: Player = {
    duration: patch.player?.duration ?? patch.duration ?? 0.5,
    effects: patch.effects,
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
    ...Object.fromEntries(
      CONTENT_KEYS.filter((k) => Object.hasOwn(patch, k)).map((k) => [
        k,
        patch[k],
      ]),
    ),
    ...patch.player,
  };
  if (player.type === "synth") { player.synth = parseSynth(player.synth ?? BASIC_SYNTH); if (player.synth.algorithm === 'expression-v1') player.synthValues = synthValues(player.synth,player.synthValues); }
  else { delete player.synth; delete player.synthValues; }
  const outer = Object.fromEntries(
    Object.entries(patch).filter(
      ([key]) =>
        key !== "player" && key !== "effects" && !(CONTENT_KEYS as readonly string[]).includes(key),
    ),
  );
  const input: PlayerInput = {
    id: uid(),
    name: "Layer",
    start: 0,
    duration: 0.5,
    sourceStart: 0,
    sourceEnd: player.duration,
    speed: 1,
    loop: false,
    reverse: false,
    gain: 0.6,
    pan: 0,
    muted: false,
    solo: false,
    locked: false,
    ...outer,
    player,
  };
  if (patch.sourceEnd === undefined) {
    input.sourceEnd = playerDuration(player);
    input.duration = (input.sourceEnd - input.sourceStart) / input.speed;
  }
  return input;
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
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer),
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
  inputs: number;
  notes: number;
  stack: Set<object>;
};
export function parseProject(raw: unknown): Project {
  if (raw && typeof raw === "object" && "root" in raw) {
    const doc = raw as { schema: string; name: string; duration: number; root: Player; assets?: Project["assets"]; videoReference?: VideoReference; loopRegion?: LoopRegion };
    if (doc.schema !== "momo.soundforge/v4" || !doc.root || typeof doc.root !== "object") throw Error("Invalid SoundForge document");
    let inputCount = 0;
    const inflate = (player: Player, stack = new Set<object>(), depth = 0): Player => {
      if (!player || typeof player !== "object" || depth > MAX_COMPOSITION_DEPTH + 1 || stack.has(player)) throw Error("Invalid player graph");
      stack.add(player);
      const result = { ...player };
      if (player.type === "composition") {
        if (!player.mix || !Array.isArray(player.mix.inputs) || player.mix.inputs.length > 16 || (inputCount += player.mix.inputs.length) > MAX_TOTAL_LAYERS) throw Error("Invalid player mix");
        result.mix = { ...player.mix, schema: "momo.soundforge/v4", inputs: player.mix.inputs.map(input => ({ ...input, player: inflate(input.player, stack, depth + 1) })) };
      }
      stack.delete(player);
      return result;
    };
    const player = inflate(doc.root);
    const temporary = { ...makeProject(doc.name), duration: doc.duration, assets: doc.assets ?? {}, inputs: [{ ...makeLayer(), player, duration: player.duration, sourceEnd: playerDuration(player) }] };
    const parsed = readProject(temporary, { bytes: 0, inputs: player.type === "composition" ? -1 : 0, notes: 0, stack: new Set() }, -1);
    const root = parsed.inputs[0].player;
    // The neutral root is already the editor's parent. Opening never adds another wrapper.
    const project = root.type === "composition" && root.mix && root.level === 1 && !root.effects
      ? root.mix : parsed;
    const result = { ...project, name: doc.name, duration: doc.duration,
      ...(doc.videoReference ? { videoReference: validateVideoReference(doc.videoReference) } : {}),
      ...(doc.loopRegion ? { loopRegion: doc.loopRegion } : {}) };
    validateAdvanced(result);
    return result;
  }
  return readProject(
    raw,
    { bytes: 0, inputs: 0, notes: 0, stack: new Set() },
    0,
  );
}

/** Native file is a document containing one root player, not a playable nested project. */
export function projectDocument(project: Project) {
  const saved = projectForSave(project);
  const strip = (player: Player): unknown => {
    if (!player.mix) return player;
    const { schema, videoReference, loopRegion, ...mix } = player.mix;
    return { ...player, mix: { ...mix, inputs: mix.inputs.map(input => ({ ...input, player: strip(input.player) })) } };
  };
  return { schema: "momo.soundforge/v4", name: saved.name, duration: saved.duration,
    root: strip(makeComposition(saved).player),
    ...(saved.videoReference ? { videoReference: saved.videoReference } : {}),
    ...(saved.loopRegion ? { loopRegion: saved.loopRegion } : {}) };
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
    r.schema !== "momo.soundforge/v4" ||
    !str(r.name) ||
    !num(r.seed, 0, 4294967295) ||
    !Number.isInteger(r.seed) ||
    !num(r.duration, 0.1, Number.MAX_VALUE) ||
    !num(r.master, 0, 1.5) ||
    !num(r.echo, 0, 0.6) ||
    !Array.isArray(r.inputs) ||
    r.inputs.length > 16 ||
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
  const inputs: PlayerInput[] = [];
  for (const l of r.inputs) {
    if (++budget.inputs > MAX_TOTAL_LAYERS) return fail();
    if (
      !l ||
      Object.keys(l).some((k) =>
        (CONTENT_KEYS as readonly string[]).includes(k),
      ) ||
      !l.player ||
      typeof l.player !== "object" ||
      Array.isArray(l.player) ||
      ["project", "sourceDuration", "cropStart", "cropEnd", "trim", "reverse"].some(key => Object.hasOwn(l.player, key)) ||
      !str(l.id) ||
      ids.has(l.id) ||
      !str(l.name) ||
      !["synth", "sample", "composition", "instrument"].includes(
        l.player.type,
      ) ||
      !["sine", "triangle", "saw", "square", "noise"].includes(l.player.wave)
    )
      return fail();
    ids.add(l.id);
    if (
      !num(l.player.duration, 0.01, Number.MAX_VALUE) ||
      !num(l.sourceStart, 0, Number.MAX_VALUE) ||
      !num(l.sourceEnd, 0, Number.MAX_VALUE) ||
      l.sourceStart >= l.sourceEnd ||
      !num(l.speed, 0.01, 100) || typeof l.loop !== "boolean"
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
    } as const;
    for (const [key, [min, max]] of Object.entries(ranges))
      if (!num(layerValue(l, key as LayerField), min, max)) return fail();
    for (const key of ["reverse", "muted", "solo", "locked"] as const)
      if (typeof layerValue(l, key) !== "boolean") return fail();
    if (
      l.player.type === "sample" &&
      (!l.player.assetId || !Object.hasOwn(assets, l.player.assetId))
    )
      return fail();
    if (
      l.player.noiseSeed !== undefined &&
      (!num(l.player.noiseSeed, 0, 4294967295) ||
        !Number.isInteger(l.player.noiseSeed))
    )
      return fail();
    if (l.player.type === "instrument") {
      validateScore(l.player.score!, assets);
      budget.notes += l.player.score!.notes.length;
      if (budget.notes > MAX_TOTAL_NOTES) return fail();
    }
    const player = Object.fromEntries(
      CONTENT_KEYS.filter((k) => k !== "mix" && Object.hasOwn(l.player, k)).map((k) => [
        k,
        structuredClone(l.player[k]),
      ]),
    ) as unknown as Player;
    player.duration = l.player.duration;
    if (player.type === "synth") { player.synth = parseSynth(l.player.synth ?? BASIC_SYNTH); if (player.synth.algorithm === 'expression-v1') player.synthValues = synthValues(player.synth,player.synthValues); else delete player.synthValues; }
    else { delete player.synth; delete player.synthValues; }
    if (l.player.effects) player.effects = structuredClone(l.player.effects);
    if (player.type !== "sample") delete player.assetId;
    if (player.type !== "instrument") delete player.score;
    if (player.type === "composition")
      player.mix = readProject(l.player.mix, budget, depth + 1);
    else {
      delete player.mix;
      delete player.controlValues;
    }
    inputs.push({
      id: l.id,
      name: l.name,
      start: l.start,
      duration: l.duration,
      sourceStart: l.sourceStart,
      sourceEnd: l.sourceEnd,
      speed: l.speed,
      loop: l.loop,
      reverse: l.reverse,
      gain: l.gain,
      pan: l.pan,
      muted: l.muted,
      solo: l.solo,
      locked: l.locked,
      player,
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
    schema: "momo.soundforge/v4",
    name: r.name,
    seed: r.seed,
    duration: r.duration,
    master: r.master,
    echo: r.echo,
    inputs,
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
    // Randomness belongs to the player, never to its enclosing mix or input ID.
    preservedSeed = (l: PlayerInput) =>
      l.player.noiseSeed;
  return {
    ...project,
    seed: seed >>> 0,
    inputs: project.inputs.map((l) =>
      l.locked || amount === 0
        ? {
            ...l,
            player: {
              ...l.player,
              noiseSeed: preservedSeed(l),
            },
          }
        : l.player.type === "composition" && l.player.mix
          ? (() => {
              const child = varyProject(
                l.player.mix,
                Math.floor(random() * 4294967296),
                amount,
              );
              const duration = Math.max(
                0.1,
                ...child.inputs.map((n) => n.start + n.duration),
              );
              const player = { ...l.player, duration, mix: { ...child, duration } };
              const follows = !l.loop && l.sourceStart === 0 && Math.abs(l.sourceEnd - playerDuration(l.player)) < 1e-6;
              return {
                ...l,
                ...(follows ? { sourceEnd: playerDuration(player), duration: Math.max(0.01, playerDuration(player) / l.speed) } : {}),
                gain: clamp(jitter(l.gain, 0.3), 0, 1.5),
                pan: clamp(l.pan + (random() - 0.5) * amount * 0.4, -1, 1),
                player,
              };
            })()
          : (() => {
            const duration = Math.max(0.01, jitter(l.duration, 0.35));
            return {
              ...l,
              duration,
              speed: clamp(l.speed * l.duration / duration, 0.01, 100),
              gain: clamp(jitter(l.gain, 0.3), 0, 1.5),
              pan: clamp(l.pan + (random() - 0.5) * amount * 0.4, -1, 1),
              player: {
                ...l.player,
                noiseSeed: Math.floor(random() * 4294967296),
                frequency: clamp(jitter(l.player.frequency, 0.8), 20, 20000),
                endFrequency: clamp(
                  jitter(l.player.endFrequency, 0.8),
                  20,
                  20000,
                ),
              },
            };
          })(),
    ),
  };
}
// Temporary audition state: keep the source document and its timing untouched.
export function createLayerPreviewProject(
  project: Project,
  layerId: string,
): Project {
  const layer = resolveControls(project).inputs.find(
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
    inputs: [{ ...layer, start: 0, muted: false, solo: false }],
  };
}

export function projectForSave(p: Project): Project {
  const used = new Set(
    p.inputs
      .filter((l) => l.player.type === "sample")
      .map((l) => l.player.assetId),
  );
  for (const layer of p.inputs)
    if (layer.player.type === "instrument" && layer.player.score)
      for (const id of scoreAssets(layer.player.score)) used.add(id);
  return {
    ...p,
    schema: "momo.soundforge/v4",
    inputs: p.inputs.map((layer) =>
      layer.player.type === "composition" && layer.player.mix
        ? {
            ...layer,
            player: {
              ...layer.player,
              mix: projectForSave(layer.player.mix),
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
  let inputs = 0,
    notes = 0,
    bytes = 0;
  const stack = new Set<Project>();
  const visit = (p: Project, depth: number) => {
    if (depth > MAX_COMPOSITION_DEPTH || stack.has(p) || p.inputs.length > 16)
      throw Error("error.compositionLimit");
    stack.add(p);
    if (Object.keys(p.assets).length > 64) throw Error("error.budget");
    for (const asset of Object.values(p.assets))
      for (const channel of asset.channels) {
        bytes += channel.length * 0.75;
        if (bytes > MAX_ASSET_BYTES) throw Error("error.budget");
      }
    for (const layer of p.inputs) {
      if (++inputs > MAX_TOTAL_LAYERS) throw Error("error.compositionLimit");
      if (layer.player.type === "instrument") {
        validateScore(layer.player.score!, p.assets);
        notes += layer.player.score!.notes.length;
        if (notes > MAX_TOTAL_NOTES) throw Error("score.invalid");
      }
      if (layer.player.type === "composition") {
        if (!layer.player.mix) throw Error("error.project");
        visit(layer.player.mix, depth + 1);
      }
    }
    stack.delete(p);
  };
  visit(project, 0);
}
export function makeComposition(
  project: Project,
  patch: LayerInit = {},
): PlayerInput {
  assertProjectLimits(project);
  return makeLayer({
    name: project.name,
    type: "composition",
    mix: projectForSave(project),
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

/** Reuse a neutral editing root's existing use; keep meaningful mix boundaries. */
export function reusableInput(project: Project): { input: PlayerInput; assets: Project["assets"] } {
  const saved = projectForSave(project);
  const only = saved.inputs[0];
  if (saved.inputs.length !== 1 || saved.master !== 1 || saved.echo || saved.effects ||
      saved.controls?.length || only.start !== 0 || Math.abs(saved.duration - only.duration) > 1e-6)
    return { input: makeComposition(saved), assets: {} };
  const input = structuredClone(only);
  input.id = uid();
  input.name = saved.name;
  const assets: Project["assets"] = {};
  const ids: Record<string, string> = {};
  for (const [id, asset] of Object.entries(saved.assets)) {
    const next = uid();
    ids[id] = next;
    assets[next] = { ...asset, id: next };
  }
  if (input.player.assetId) input.player.assetId = ids[input.player.assetId];
  for (const instrument of input.player.score?.instruments ?? [])
    for (const region of instrument.regions) {
      region.assetId = ids[region.assetId];
      if (region.releaseAssetId) region.releaseAssetId = ids[region.releaseAssetId];
    }
  return { input, assets };
}
export function wrapProject(project: Project): Project {
  const result = {
    ...project,
    master: 1,
    echo: 0,
    assets: {},
    inputs: [makeComposition(project)],
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
    const layer = project.inputs.find((l) => l.id === id);
    if (layer?.player.type !== "composition" || !layer.player.mix) break;
    valid.push(id);
    project = layer.player.mix;
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
    layer = root.inputs.find((l) => l.id === id);
  if (layer?.player.type !== "composition" || !layer.player.mix)
    return root;
  const before = layer.player.mix,
    after = updateProjectAtPath(before, rest, change);
  if (before === after) return root;
  const followsDuration =
    layer.sourceStart === 0 &&
    !layer.loop && Math.abs(layer.sourceEnd - playerDuration(layer.player)) < 1e-6 && Math.abs(layer.duration * layer.speed - layer.sourceEnd) < 1e-6;
  const newPlayer = { ...layer.player, duration: after.duration, mix: after };
  const duration = followsDuration
    ? Math.max(0.01, playerDuration(newPlayer) / layer.speed)
    : layer.duration;
  const updated = {
    ...layer,
    duration,
    sourceEnd: followsDuration ? playerDuration(newPlayer) : layer.sourceEnd,
    name: layer.name === before.name ? after.name : layer.name,
    player: newPlayer,
  };
  const projectDuration =
    followsDuration && layer.start + layer.duration <= root.duration + 1e-6
      ? Math.max(root.duration, layer.start + duration)
      : root.duration;
  return {
    ...root,
    duration: projectDuration,
    inputs: root.inputs.map((l) => (l.id === id ? updated : l)),
  };
}
