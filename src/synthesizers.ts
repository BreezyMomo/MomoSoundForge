import type { Wave } from "./model";

export type SynthDefaults = {
  wave: Wave; frequency: number; endFrequency: number;
  attack: number; release: number; decay: number; cutoff: number; drive: number;
};
export type SynthDefinition = {
  schema: "momo.synth/v1";
  id: string;
  name: string;
  algorithm: "oscillator-v1";
  defaults: SynthDefaults;
};
// Algorithms are trusted engine implementations, never executable code in imported resources.
export const SYNTH_ALGORITHMS = ["oscillator-v1"] as const;
export const SYNTH_RANGES = {
  frequency: [20, 20000], endFrequency: [20, 20000], attack: [0, 3],
  release: [0, 5], decay: [0, 10], cutoff: [30, 22000], drive: [0, 10],
} as const;
export const BASIC_SYNTH: SynthDefinition = {
  schema: "momo.synth/v1", id: "builtin.oscillator", name: "Basic oscillator",
  algorithm: "oscillator-v1",
  defaults: { wave: "sine", frequency: 220, endFrequency: 110, attack: 0.005,
    release: 0.12, decay: 2, cutoff: 18000, drive: 0 },
};
export function parseSynth(raw: unknown): SynthDefinition {
  const s = raw as SynthDefinition;
  if (!s || s.schema !== "momo.synth/v1" || !SYNTH_ALGORITHMS.includes(s.algorithm) ||
      typeof s.id !== "string" || !s.id || s.id.length > 120 ||
      typeof s.name !== "string" || !s.name.trim() || s.name.length > 120 ||
      !s.defaults || !["sine", "triangle", "saw", "square", "noise"].includes(s.defaults.wave))
    throw Error("definition.invalid");
  for (const [key, [min, max]] of Object.entries(SYNTH_RANGES)) {
    const value = s.defaults[key as keyof typeof SYNTH_RANGES];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
      throw Error("definition.invalid");
  }
  return { schema: s.schema, id: s.id, name: s.name.trim(), algorithm: s.algorithm,
    defaults: { wave: s.defaults.wave, ...Object.fromEntries(Object.keys(SYNTH_RANGES).map(k => [k, s.defaults[k as keyof typeof SYNTH_RANGES]])) } as SynthDefaults };
}
export function synthSample(algorithm: SynthDefinition["algorithm"], wave: Wave, phase: number, noise: () => number): number {
  if (algorithm !== "oscillator-v1") throw Error("definition.invalid");
  switch (wave) {
    case "sine": return Math.sin(phase * 2 * Math.PI);
    case "triangle": return 1 - 4 * Math.abs(phase - 0.5);
    case "saw": return 2 * phase - 1;
    case "square": return phase < 0.5 ? 1 : -1;
    case "noise": return noise() * 2 - 1;
  }
}
