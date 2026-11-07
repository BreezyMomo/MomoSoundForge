/** Content-addressed factory audio. References never contain URLs or local paths. */
export type SampleReference = {
  schema: 'momo.builtin-sample/v1'; file: string; sha256: string;
  compressedBytes: number; decodedBytes: number; frames: number;
  assetGains: number[];
};
export function parseSampleReference(raw: unknown): SampleReference {
  const r = raw as SampleReference;
  const integer = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!r || r.schema !== 'momo.builtin-sample/v1' || !/^[a-f0-9]{64}$/.test(r.sha256)
    || r.file !== `${r.sha256}.recording.bin` || !integer(r.frames, 1, 5_760_000)
    || r.decodedBytes !== 44 + r.frames * 4 || !integer(r.compressedBytes, 1, 12 * 1024 * 1024)
    || !Array.isArray(r.assetGains) || r.assetGains.length > 2 || r.assetGains.some(g => !Number.isFinite(g) || g <= 0 || g > 1000))
    throw Error('error.sampleReference');
  return { schema: r.schema, file: r.file, sha256: r.sha256, compressedBytes: r.compressedBytes,
    decodedBytes: r.decodedBytes, frames: r.frames, assetGains: [...r.assetGains] };
}
export function sampleFrames(asset: { channels: string[]; reference?: SampleReference }) {
  if (asset.reference) return asset.reference.frames;
  return embeddedFrames(asset);
}
export function embeddedFrames(asset: { channels: string[] }) {
  const s = asset.channels[0];
  return s ? (s.length * 3 / 4 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0)) / 4 : 0;
}
