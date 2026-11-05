export type SampleSource = {
  provider: string; url: string; author: string; license: string;
  licenseUrl: string; quality: 'preview' | 'original'; retrievedAt: string;
};
export function validateSampleSource(value: unknown): SampleSource {
  const s = value as SampleSource;
  if (!s || typeof s !== 'object' || ['provider', 'url', 'author', 'license', 'licenseUrl', 'retrievedAt'].some(k =>
    typeof s[k as keyof SampleSource] !== 'string' || !s[k as keyof SampleSource] || s[k as keyof SampleSource].length > 1500) ||
    !['preview', 'original'].includes(s.quality) || !Number.isFinite(Date.parse(s.retrievedAt))) throw Error('ai.invalidSource');
  for (const raw of [s.url, s.licenseUrl]) {
    const u = new URL(raw); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error('ai.invalidSource');
  }
  return Object.fromEntries(['provider', 'url', 'author', 'license', 'licenseUrl', 'quality', 'retrievedAt'].map(k => [k, s[k as keyof SampleSource]])) as SampleSource;
}
