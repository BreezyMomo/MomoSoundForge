export const SAMPLE_RATE = 48000;
export const MAX_SAMPLE_FRAMES = 5_760_000; // 30 seconds at the maximum accepted rate, 192 kHz.
export const MAX_ASSET_BYTES = 24 * 1024 * 1024;
export type Wave = "sine" | "triangle" | "saw" | "square" | "noise";
export type Layer = {
  id: string;
  name: string;
  type: "synth" | "sample";
  wave: Wave;
  noiseSeed: number;
  assetId?: string;
  start: number;
  duration: number;
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
  schema: "momo.soundforge/v1";
  name: string;
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
export function parseProject(raw: unknown): Project {
  const fail = (): never => {
    throw Error("Invalid SoundForge project");
  };
  if (!raw || typeof raw !== "object") return fail();
  const r = raw as Project;
  const num = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const str = (v: unknown, max = 120): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= max;
  if (
    r.schema !== "momo.soundforge/v1" ||
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
  if (Object.keys(r.assets).length > 16) return fail();
  let bytes = 0;
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
      bytes += channel.length * 0.75;
      if (bytes > MAX_ASSET_BYTES) return fail();
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
    if (
      !l ||
      !str(l.id) ||
      ids.has(l.id) ||
      !str(l.name) ||
      !["synth", "sample"].includes(l.type) ||
      !["sine", "triangle", "saw", "square", "noise"].includes(l.wave)
    )
      return fail();
    ids.add(l.id);
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
    } as Layer);
  }
  return {
    schema: r.schema,
    name: r.name,
    seed: r.seed,
    duration: r.duration,
    master: r.master,
    echo: r.echo,
    layers,
    assets,
  };
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
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) throw Error("Unknown sound layer");
  return {
    ...project,
    duration: layer.duration,
    layers: [{ ...layer, start: 0, muted: false, solo: false }],
  };
}

export function projectForSave(p: Project): Project {
  const used = new Set(
    p.layers.filter((l) => l.type === "sample").map((l) => l.assetId),
  );
  return {
    ...p,
    assets: Object.fromEntries(
      Object.entries(p.assets).filter(([id]) => used.has(id)),
    ),
  };
}
