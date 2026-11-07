import { normalizeLibraryUrl } from './builtinDistribution.mjs';
/** Bounded, verified transport shared by factory projects and complete recordings. */
export type BuiltinFile = { id: string; file: string; compressedBytes: number; decodedBytes: number; sha256: string };
const LIMIT = 12 * 1024 * 1024;
const failed = () => Error('library.builtinLoadError');
async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
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
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function createBuiltinFileLoader(
  files: readonly BuiltinFile[],
  fetcher: (url: string) => Promise<Response>,
  base: string,
  externalBase = import.meta.env?.VITE_SOUND_LIBRARY_URL ?? '',
) {
  const libraryBase = normalizeLibraryUrl(externalBase) || `${base}sound-library/`;
  const entries = new Map(files.map(f => [f.id, f]));
  const cache = new Map<string, Uint8Array>(), pending = new Map<string, Promise<Uint8Array>>();
  let cacheBytes = 0;
  const invalidate = (id: string) => {
    const previous = cache.get(id);
    if (previous) { cacheBytes -= previous.byteLength; cache.delete(id); }
  };
  async function compressed(file: BuiltinFile) {
    const hit = cache.get(file.id);
    if (hit) { cache.delete(file.id); cache.set(file.id, hit); return hit; }
    const active = pending.get(file.id);
    if (active) return active;
    const promise = (async () => {
      if (!/^[a-f0-9]{64}\.(soundforge|recording)\.bin$/.test(file.file) || !/^[a-f0-9]{64}$/.test(file.sha256)
        || !Number.isInteger(file.compressedBytes) || file.compressedBytes < 1 || file.compressedBytes > LIMIT
        || !Number.isInteger(file.decodedBytes) || file.decodedBytes < 1 || file.decodedBytes > 36 * 1024 * 1024) throw failed();
      const response = await fetcher(`${libraryBase}${file.file}`);
      if (!response.ok || !response.body) throw failed();
      // Fetch decodes HTTP encoding; cross-origin responses may hide that header
      // while exposing the encoded Content-Length. Bound the actual body instead.
      const bytes = await readBounded(response.body, file.compressedBytes);
      if (bytes.length !== file.compressedBytes) throw failed();
      if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
        const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
        if (hash !== file.sha256) throw failed();
      }
      while (cacheBytes + bytes.length > LIMIT && cache.size) invalidate(cache.keys().next().value!);
      cache.set(file.id, bytes); cacheBytes += bytes.length;
      return bytes;
    })();
    pending.set(file.id, promise);
    try { return await promise; } finally { pending.delete(file.id); }
  }
  const loader = {
    invalidate,
    async loadFile(file: BuiltinFile): Promise<Uint8Array> {
      entries.set(file.id, file);
      try { return await loader.load(file.id); } finally { entries.delete(file.id); }
    },
    async load(id: string) {
      const file = entries.get(id);
      if (!file) throw failed();
      try {
        const bytes = await compressed(file);
        const stream = new Response(new Uint8Array(bytes).buffer).body!.pipeThrough(new DecompressionStream('gzip'));
        const decoded = await readBounded(stream, file.decodedBytes);
        if (decoded.length !== file.decodedBytes) throw failed();
        return decoded;
      } catch { invalidate(id); throw failed(); }
    },
  };
  return loader;
}
