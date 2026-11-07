import { gzipSync } from 'node:zlib';

// Gzip's OS byte otherwise differs between Windows development and Linux CI.
// It is transport metadata, not part of the deflate payload or checksum.
export function deterministicGzip(bytes, options) {
  const compressed = gzipSync(bytes, options);
  compressed[9] = 3;
  return compressed;
}
