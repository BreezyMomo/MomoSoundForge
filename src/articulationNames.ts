/** Display metadata supplied by a resource; articulation IDs keep their sound meaning. */
export type ArticulationNames = Record<string, { zh: string; en: string }>;

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function validateArticulationNames(raw: unknown, message = 'score.invalid'): asserts raw is ArticulationNames {
  if (!plain(raw) || Object.keys(raw).length > 512) throw Error(message);
  for (const [id, names] of Object.entries(raw)) {
    if (!id.trim() || id.length > 60 || ['__proto__', 'prototype', 'constructor'].includes(id)
      || !plain(names) || Object.keys(names).length !== 2
      || !Object.hasOwn(names, 'zh') || !Object.hasOwn(names, 'en')) throw Error(message);
    for (const value of Object.values(names)) {
      if (typeof value !== 'string' || !value.trim() || value.length > 120) throw Error(message);
    }
  }
}

export function localizedArticulationName(
  id: string,
  names: ArticulationNames | undefined,
  locale: string,
  fallback: (id: string) => string = value => value,
) {
  return names && Object.hasOwn(names, id)
    ? names[id][locale.toLowerCase().startsWith('zh') ? 'zh' : 'en']
    : fallback(id);
}
