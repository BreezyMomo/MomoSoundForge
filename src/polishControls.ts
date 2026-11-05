import { DEFAULT_EFFECTS, type Effects, type EffectGroup, type EffectParameter } from './advanced';

export const POLISH_GROUPS: { id: 'tone' | 'delay' | 'space'; flag: EffectGroup; keys: EffectParameter[] }[] = [
  { id: 'tone', flag: 'toneEnabled', keys: ['low', 'mid', 'high'] },
  { id: 'delay', flag: 'delayEnabled', keys: ['delayTime', 'delayFeedback', 'delayWet'] },
  { id: 'space', flag: 'spaceEnabled', keys: ['reverb'] },
];
export const POLISH_RANGES: Record<EffectParameter, [number, number, number, string]> = {
  low: [-24, 24, 0.1, 'dB'], mid: [-24, 24, 0.1, 'dB'], high: [-24, 24, 0.1, 'dB'],
  delayTime: [0.01, 1, 0.001, 's'], delayFeedback: [0, 0.85, 0.01, ''], delayWet: [0, 1, 0.01, ''], reverb: [0, 1, 0.01, ''], ceiling: [-12, 0, 0.1, 'dBFS'],
};
export type PolishKey = Exclude<EffectParameter, 'ceiling'>;
export function polishAmount(key: PolishKey, value: number) {
  if (key === 'delayTime') return value;
  const [min, max] = POLISH_RANGES[key];
  return ['low', 'mid', 'high'].includes(key) ? value / max * 100 : (value - min) / (max - min) * 100;
}
export function resetPolish(effects: Effects = DEFAULT_EFFECTS, group?: string): Effects {
  if (!group) return { ...DEFAULT_EFFECTS };
  const g = POLISH_GROUPS.find(g => g.id === group); if (!g) throw Error('ai.invalidEdit');
  const next = { ...effects, [g.flag]: true }; for (const key of g.keys) next[key] = DEFAULT_EFFECTS[key];
  return next;
}
export type PolishEdit = { action: 'adjust' | 'reset' | 'toggle'; group?: 'tone' | 'delay' | 'space'; enabled?: boolean; values?: Partial<Record<PolishKey, number>> };
export function editPolish(current: Effects | undefined, edit: PolishEdit): Effects | undefined {
  const effects = current ?? DEFAULT_EFFECTS;
  if (edit.action === 'reset') {
    if (edit.values !== undefined || edit.enabled !== undefined) throw Error('ai.invalidEdit');
    return edit.group ? resetPolish(effects, edit.group) : undefined;
  }
  const group = POLISH_GROUPS.find(g => g.id === edit.group);
  if (edit.action === 'toggle') {
    if (!group || typeof edit.enabled !== 'boolean' || edit.values !== undefined) throw Error('ai.invalidEdit');
    return { ...effects, [group.flag]: edit.enabled };
  }
  if (edit.action !== 'adjust' || edit.group !== undefined || edit.enabled !== undefined || !edit.values || typeof edit.values !== 'object' || Array.isArray(edit.values) || !Object.keys(edit.values).length) throw Error('ai.invalidEdit');
  const next = { ...effects };
  for (const [rawKey, value] of Object.entries(edit.values)) {
    const key = rawKey as PolishKey, tone = ['low', 'mid', 'high'].includes(key);
    if (rawKey === 'ceiling' || !Object.hasOwn(POLISH_RANGES, key) || !Number.isFinite(value) || value! < (key === 'delayTime' ? .01 : tone ? -100 : 0) || value! > (key === 'delayTime' ? 1 : 100)) throw Error('ai.invalidEdit');
    const [min, max] = POLISH_RANGES[key];
    next[key] = key === 'delayTime' ? value! : tone ? value! / 100 * max : min + value! / 100 * (max - min);
  }
  return next;
}
export const POLISH_SCHEMA = {
  groups: POLISH_GROUPS, values: { low: 'Weight [-100,100]', mid: 'Body [-100,100]', high: 'Brightness [-100,100]', delayTime: 'Echo spacing [0.01,1] seconds', delayFeedback: 'Echo sustain [0,100]', delayWet: 'Echo amount [0,100]', reverb: 'Space [0,100]' },
  behavior: 'adjust preserves group enabled flags; toggle explicitly enables/disables a group; reset with group resets/enables only that group, reset without group removes all node effects. Matches the editor controls. Render beforePolish to compare without editing.',
};
