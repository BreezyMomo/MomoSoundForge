// Explicit provenance repair, never called by build/test. Fetch only pinned author
// mappings already declared by a collection, verify before writing, never overwrite.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collections } from './inventory-sound-assets.mjs';
import { sha256 } from './audio-audit-core.mjs';

const download = process.argv.includes('--download');
if (process.argv.slice(2).some(arg => arg !== '--download')) throw Error('Usage: node tools/restore-author-mappings.mjs [--download]');
const libraries = await collections(), available = new Map(), missing = [];
for (const library of libraries) for (const sample of [...library.manifest.samples, ...library.quarantine]) {
  if (!sample.mappingFile) continue;
  if (!/^[a-zA-Z0-9_.-]+\.sfz$/.test(sample.mappingFile)) throw Error('Invalid mapping filename');
  const destination = `${library.base}/mappings/${sample.mappingFile}`;
  try {
    const bytes = await readFile(destination);
    if (sha256(bytes) !== sample.mappingSha256) throw Error(`Mapping hash mismatch: ${destination}`);
    available.set(sample.mappingSha256, bytes);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!missing.some(m => m.destination === destination)) missing.push({ destination, sample });
  }
}
for (const { destination, sample } of missing) {
  let bytes = available.get(sample.mappingSha256), origin = 'verified-local-copy';
  if (!bytes) {
    if (!download) { console.log(`Missing ${destination}; explicit --download required`); process.exitCode = 1; continue; }
    const source = new URL(sample.mappingUrl);
    if (source.protocol !== 'https:' || source.hostname !== 'github.com' || !/^\/[\w-]+\/[\w.-]+\/blob\/[a-f0-9]{40}\/[\w.-]+\.sfz$/.test(source.pathname))
      throw Error('Mapping URL must identify an immutable Git commit');
    const url = `https://raw.githubusercontent.com${source.pathname.replace('/blob/', '/')}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 2 * 1024 * 1024) throw Error(`Mapping download failed: ${url}`);
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) throw Error('Mapping download exceeds budget');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks); origin = url;
  }
  if (sha256(bytes) !== sample.mappingSha256) throw Error(`Downloaded mapping hash mismatch: ${destination}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
  available.set(sample.mappingSha256, bytes);
  console.log(JSON.stringify({ restored: destination, sha256: sample.mappingSha256, origin }));
}
