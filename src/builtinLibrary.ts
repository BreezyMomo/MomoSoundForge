import catalog from "./data/builtin-catalog.json";
import { parseProject, type Project } from "./model";
import type { SoundCategory } from "./libraryPreferences";
import { t } from "./i18n";

export type BuiltinSound = {
  id: string;
  nameKey: string;
  kind: "instrument" | "sample" | "example";
  category: SoundCategory;
  duration: number;
  file: string;
  compressedBytes: number;
  projectBytes: number;
  sha256: string;
  waveform: number[];
  keywords: string;
  rootNote?: string | null;
  velocity?: string;
  variant?: number;
  articulation?: string;
  tone?: boolean;
  keyLow?: number;
  keyHigh?: number;
  maxSourceSeconds?: number;
  recordingIds?: string[];
  recordingGroup?: string;
  recording?: number;
  playback?: "loop" | "one-shot";
};
export const BUILTIN_SOUNDS = catalog.sounds as BuiltinSound[];
type Translate = (key: string, ...values: unknown[]) => string;

export const midiLabel = (midi: number) =>
  `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
export const builtinToneKey = (sound: BuiltinSound) =>
  sound.recordingGroup ??
  (sound.kind === "instrument"
    ? `${sound.nameKey}:${sound.articulation}`
    : sound.id);
export function builtinToneName(sound: BuiltinSound, translate: Translate = t) {
  return sound.kind === "instrument"
    ? `${translate(sound.nameKey)} · ${translate(`builtin.articulation.${sound.articulation}`)}`
    : translate(sound.nameKey);
}
export function builtinChoiceName(
  sound: BuiltinSound,
  translate: Translate = t,
) {
  if (sound.recordingGroup)
    return translate("builtin.recordingChoice", sound.recording);
  return sound.tone
    ? `${midiLabel(sound.keyLow!)}–${midiLabel(sound.keyHigh!)}`
    : translate(
        "builtin.takeChoice",
        sound.rootNote ?? translate("builtin.unpitched"),
        sound.velocity,
        sound.variant,
      );
}
export function preferredBuiltin<T extends { builtin?: BuiltinSound }>(
  items: T[],
): T {
  return (
    items.find(
      (item) =>
        item.builtin?.tone &&
        item.builtin.keyLow! <= 60 &&
        item.builtin.keyHigh! >= 60,
    ) ?? items[0]
  );
}

export function builtinSoundName(
  sound: BuiltinSound,
  translate: Translate = t,
  short = false,
) {
  const name = translate(sound.nameKey);
  if (sound.recordingGroup)
    return short
      ? name
      : translate("builtin.recordingName", name, sound.recording);
  if (sound.kind !== "instrument") return name;
  if (sound.tone)
    return `${builtinToneName(sound, translate)} · ${builtinChoiceName(sound, translate)}`;
  if (short)
    return sound.rootNote
      ? translate("builtin.instrumentShort", name, sound.rootNote)
      : name;
  return sound.rootNote
    ? translate(
        "builtin.instrumentVariant",
        name,
        sound.rootNote,
        sound.velocity,
        sound.variant,
      )
    : translate(
        "builtin.unpitchedVariant",
        name,
        sound.velocity,
        sound.variant,
      );
}
export function builtinSoundDescription(
  sound: BuiltinSound,
  translate: Translate = t,
) {
  if (sound.playback)
    return translate(
      sound.playback === "loop"
        ? "builtin.natureLoopDetails"
        : "builtin.natureEventDetails",
    );
  if (sound.tone)
    return translate(
      "builtin.toneDetails",
      sound.recordingIds?.length ?? 0,
      sound.maxSourceSeconds,
    );
  return sound.kind === "instrument"
    ? translate(
        "builtin.instrumentDetails",
        translate(`builtin.articulation.${sound.articulation}`),
        sound.velocity,
        sound.variant,
      )
    : translate(
        sound.kind === "sample"
          ? "builtin.sampleDetails"
          : "builtin.exampleDetails",
      );
}

const MAX_PROJECT_BYTES = 36 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = 12 * 1024 * 1024;
const CACHE_BYTES = 12 * 1024 * 1024;
const failed = () => Error("library.builtinLoadError");
async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw failed();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// Cache compressed resources only. Every action receives a freshly validated,
// independent project; opening a sound never mutates its factory entry.
// Cache compressed resources only. Every action receives a freshly validated,
// independent project; opening a sound never mutates its factory entry.
export function createBuiltinLoader(
  sounds: readonly BuiltinSound[] = BUILTIN_SOUNDS,
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
  base = import.meta.env.BASE_URL,
) {
  const entries = new Map(sounds.map((sound) => [sound.id, sound]));
  const cache = new Map<string, Uint8Array>();
  const pending = new Map<string, Promise<Uint8Array>>();
  let cacheBytes = 0;
  async function compressed(sound: BuiltinSound) {
    const hit = cache.get(sound.id);
    if (hit) {
      cache.delete(sound.id);
      cache.set(sound.id, hit);
      return hit;
    }
    const active = pending.get(sound.id);
    if (active) return active;
    const promise = (async () => {
      if (
        !/^[a-f0-9]{64}\.soundforge\.bin$/.test(sound.file) ||
        !Number.isInteger(sound.compressedBytes) ||
        sound.compressedBytes < 1 ||
        sound.compressedBytes > MAX_COMPRESSED_BYTES ||
        !Number.isInteger(sound.projectBytes) ||
        sound.projectBytes < 1 ||
        sound.projectBytes > MAX_PROJECT_BYTES
      )
        throw failed();
      const response = await fetcher(`${base}sound-library/${sound.file}`);
      if (!response.ok || !response.body) throw failed();
      const contentLength = Number(response.headers.get("Content-Length"));
      if (contentLength > sound.compressedBytes) {
        await response.body.cancel();
        throw failed();
      }
      const bytes = await readBounded(response.body, sound.compressedBytes);
      if (bytes.length !== sound.compressedBytes) throw failed();
      if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(bytes).buffer,
        );
        const hash = Array.from(new Uint8Array(digest), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== sound.sha256) throw failed();
      }
      while (cacheBytes + bytes.length > CACHE_BYTES && cache.size) {
        const oldest = cache.keys().next().value!;
        cacheBytes -= cache.get(oldest)!.byteLength;
        cache.delete(oldest);
      }
      cache.set(sound.id, bytes);
      cacheBytes += bytes.length;
      return bytes;
    })();
    pending.set(sound.id, promise);
    try {
      return await promise;
    } finally {
      pending.delete(sound.id);
    }
  }
  return async (id: string, name?: string): Promise<Project> => {
    const sound = entries.get(id);
    if (!sound) throw failed();
    try {
      const bytes = await compressed(sound);
      const stream = new Response(
        new Uint8Array(bytes).buffer,
      ).body!.pipeThrough(new DecompressionStream("gzip"));
      const json = await readBounded(stream, sound.projectBytes);
      if (json.byteLength !== sound.projectBytes) throw failed();
      const project = parseProject(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)),
      );
      if (name) {
        project.name = name.slice(0, 120);
        for (const layer of project.inputs)
          if (
            layer.name.startsWith("builtin.game") ||
            layer.name.startsWith("builtin.nature.")
          )
            layer.name = t(layer.name);
        for (const control of project.controls ?? [])
          if (
            control.name.startsWith("builtin.gameControl.") ||
            control.name.startsWith("builtin.natureControl.")
          )
            control.name = t(control.name);
        if (sound.kind === "instrument")
          for (const layer of project.inputs) {
            layer.name = project.name;
            for (const instrument of layer.player.score?.instruments ?? [])
              instrument.name = t(sound.nameKey);
          }
      }
      return project;
    } catch {
      // Do not retain a failed resource; retry can fetch a repaired deployment.
      const old = cache.get(id);
      if (old) {
        cacheBytes -= old.byteLength;
        cache.delete(id);
      }
      throw failed();
    }
  };
}
export const loadBuiltinSound = createBuiltinLoader();
