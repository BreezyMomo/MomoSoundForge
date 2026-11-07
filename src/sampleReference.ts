/** Content-addressed factory audio. References never contain URLs or local paths. */
export type BuiltinSampleReference = {
  schema: 'momo.builtin-sample/v1'; file: string; sha256: string;
  compressedBytes: number; decodedBytes: number; frames: number;
  assetGains: number[];
  frameLimit?: number;
  audioId?: string;
};
export type SharedSampleReference = {
  schema: 'momo.audio-reference/v1'; audioId: string; frames: number;
  sampleRate: number; channelCount: number; frameLimit?: number;
};
export type SampleReference = BuiltinSampleReference | SharedSampleReference;
export function parseSampleReference(raw: unknown): SampleReference {
  const shared = raw as SharedSampleReference;
  if (shared?.schema === 'momo.audio-reference/v1') {
    if (!/^audio-[a-f0-9]{64}$/.test(shared.audioId) || !Number.isInteger(shared.frames) || shared.frames < 1 || shared.frames > 5760000
      || !Number.isInteger(shared.sampleRate) || shared.sampleRate < 8000 || shared.sampleRate > 192000 || ![1,2].includes(shared.channelCount)
      || (shared.frameLimit !== undefined && (!Number.isInteger(shared.frameLimit) || shared.frameLimit < 1 || shared.frameLimit > shared.frames))) throw Error('error.sampleReference');
    return {schema:shared.schema,audioId:shared.audioId,frames:shared.frames,sampleRate:shared.sampleRate,channelCount:shared.channelCount,
      ...(shared.frameLimit !== undefined ? {frameLimit:shared.frameLimit} : {})};
  }
  const r = raw as BuiltinSampleReference;
  const integer = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!r || r.schema !== 'momo.builtin-sample/v1' || !/^[a-f0-9]{64}$/.test(r.sha256)
    || r.file !== `${r.sha256}.recording.bin` || !integer(r.frames, 1, 5_760_000)
    || r.decodedBytes !== 44 + r.frames * 4 || !integer(r.compressedBytes, 1, 12 * 1024 * 1024)
    || (r.frameLimit !== undefined && !integer(r.frameLimit, 1, r.frames))
    || !Array.isArray(r.assetGains) || r.assetGains.length > 2 || r.assetGains.some(g => !Number.isFinite(g) || g <= 0 || g > 1000))
    throw Error('error.sampleReference');
  return { schema: r.schema, file: r.file, sha256: r.sha256, compressedBytes: r.compressedBytes,
    decodedBytes: r.decodedBytes, frames: r.frames, assetGains: [...r.assetGains],
    ...(r.frameLimit !== undefined ? { frameLimit: r.frameLimit } : {}),
    ...(r.audioId !== undefined ? {audioId: /^audio-[a-f0-9]{64}$/.test(r.audioId) ? r.audioId : (()=>{throw Error('error.sampleReference');})()} : {}) };
}
export function sampleFrames(asset: { channels: string[]; reference?: SampleReference }) {
  if (asset.reference) return asset.reference.frameLimit ?? asset.reference.frames;
  return embeddedFrames(asset);
}
export function embeddedFrames(asset: { channels: string[] }) {
  const s = asset.channels[0];
  return s ? (s.length * 3 / 4 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0)) / 4 : 0;
}
