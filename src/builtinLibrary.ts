import { createBuiltinFileLoader } from "./builtinFiles";
import catalog from "./data/builtin-catalog.json";
import { parseProject, type Project } from "./model";
import type { SoundCategory } from "./libraryPreferences";
import { t } from "./i18n";
import type { RecordingSummary } from "./recordingSources";
import { openResourceGraph } from './resourceGraph';
import { resourceProject } from './soundResources';

export type BuiltinSound = {
  id: string;
  revision?: number;
  completeInstrument?: boolean;
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
  recordings?: RecordingSummary[];
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
  if (sound.completeInstrument) return `${midiLabel(sound.keyLow!)}–${midiLabel(sound.keyHigh!)}`;
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
  if (sound.completeInstrument) return name;
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
  if (sound.completeInstrument) return translate('resources.completeInstrument');
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

const failed = () => Error("library.builtinLoadError");

export function createBuiltinLoader(
  sounds: readonly BuiltinSound[] = BUILTIN_SOUNDS,
  fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
  base = import.meta.env.BASE_URL,
) {
  const entries = new Map(sounds.map((sound) => [sound.id, sound]));
  const files = createBuiltinFileLoader(sounds.map(s => ({ ...s, decodedBytes: s.projectBytes })), fetcher, base);
  return async (id: string, name?: string): Promise<Project> => {
    const sound = entries.get(id);
    if (!sound) throw failed();
    try {
      const json = await files.load(id);
      const project = resourceProject((await openResourceGraph(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(json)))).resource);
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
      files.invalidate(id);
      throw failed();
    }
  };
}
export const loadBuiltinSound = createBuiltinLoader();
