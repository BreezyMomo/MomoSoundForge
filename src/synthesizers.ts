import type { Wave } from "./model";
import { compileExpression, reservedVariables, type ExpressionContext } from './synthExpression';

export type SynthParameter = { variable: string; name: string; min: number; max: number; step: number; default: number };

export type SynthDefaults = {
  wave: Wave; frequency: number; endFrequency: number;
  attack: number; release: number; decay: number; cutoff: number; drive: number;
};
export type SynthDefinition = {
  schema: "momo.synth/v1";
  id: string;
  name: string;
  algorithm: "oscillator-v1" | "expression-v1";
  program?: { expression: string; parameters: SynthParameter[] };
  defaults: SynthDefaults;
};
// Algorithms are trusted engine implementations, never executable code in imported resources.
export const SYNTH_ALGORITHMS = ["oscillator-v1", "expression-v1"] as const;
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
  let program: SynthDefinition['program'];
  if (s.algorithm === 'expression-v1') {
    if (!s.program || !Array.isArray(s.program.parameters) || s.program.parameters.length > 16) throw Error('resources.expression');
    const parameters = s.program.parameters.map(p => {
      if (!p || typeof p.variable !== 'string' || !/^[a-zA-Z_][a-zA-Z_0-9]{0,31}$/.test(p.variable) || reservedVariables.has(p.variable) ||
        typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120 ||
        ![p.min,p.max,p.step,p.default].every(n=>typeof n === 'number' && Number.isFinite(n) && Math.abs(n)<=1e6) ||
        p.min >= p.max || p.step <= 0 || p.default < p.min || p.default > p.max) throw Error('resources.expression');
      return {variable:p.variable,name:p.name,min:p.min,max:p.max,step:p.step,default:p.default};
    });
    if (new Set(parameters.map(p=>p.variable)).size !== parameters.length) throw Error('resources.expression');
    compileExpression(s.program.expression, parameters.map(p=>p.variable));
    program = {expression:s.program.expression,parameters};
  }
  return { schema: s.schema, id: s.id, name: s.name.trim(), algorithm: s.algorithm,
    ...(program ? {program} : {}), defaults: { wave: s.defaults.wave, ...Object.fromEntries(Object.keys(SYNTH_RANGES).map(k => [k, s.defaults[k as keyof typeof SYNTH_RANGES]])) } as SynthDefaults };
}
export function synthValues(s: SynthDefinition, raw: Record<string, number> = {}): Record<string, number> {
  const params = s.program?.parameters ?? [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k=>!params.some(p=>p.variable===k))) throw Error('resources.expression');
  return Object.fromEntries(params.map(p=>{ const n = Object.hasOwn(raw,p.variable) ? raw[p.variable] : p.default;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < p.min || n > p.max) throw Error('resources.expression'); return [p.variable,n]; }));
}
export function expressionVoice(s: SynthDefinition | undefined, values: Record<string,number> | undefined, noise: () => number, frames: number) {
  if (s?.algorithm !== 'expression-v1' || !s.program) return null;
  const compiled = compileExpression(s.program.expression,s.program.parameters.map(p=>p.variable));
  if (frames * compiled.cost > 60_000_000) throw Error('error.renderBudget');
  const context: ExpressionContext = {t:0,phase:0,frequency:220,duration:1,velocity:1,noise,values:synthValues(s,values)};
  return (t:number,phase:number,frequency:number,duration:number,velocity=1) => {
    context.t=t;context.phase=phase;context.frequency=frequency;context.duration=duration;context.velocity=velocity;return compiled.evaluate(context);
  };
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
