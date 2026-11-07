// Build-time storage only. Logical asset names never enter projects as local paths.
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, lstat, rename, rm, open, readdir } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

export const LOCK_SCHEMA = 'momo.sound-assets-lock/v1';
const MAGIC = Buffer.from('MOMOSFA1');
const MAX_PACK = 300 * 1024 * 1024, MAX_EXPANDED = 512 * 1024 * 1024, MAX_FILES = 10000;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

export function logicalPath(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^(samples|exports)\//.test(value) ||
      value.split('/').some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f:<>"|?*]/.test(p) ||
        /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)))
    throw Error(`Unsafe asset path: ${value}`);
  return value;
}

export const manifestBytes = files => Buffer.from(JSON.stringify({ schema: 'momo.sound-assets-pack/v1', files }));
export function validateLock(lock) {
  if (lock?.schema !== LOCK_SCHEMA || !Array.isArray(lock.packs) || lock.packs.length > 200)
    throw Error('Unsupported sound asset lock');
  const paths = new Set(), ids = new Set();
  for (const pack of lock.packs) {
    if (!/^[a-z0-9-]{1,80}$/.test(pack.id) || ids.has(pack.id) || !/^[a-z0-9.-]{1,80}$/.test(pack.version) ||
        !['build', 'audit', 'archive'].includes(pack.profile) || !digestPattern.test(pack.sha256) ||
        !digestPattern.test(pack.manifestSha256) || !integer(pack.bytes, MAX_PACK) || pack.bytes < 1 ||
        !integer(pack.expandedBytes, MAX_EXPANDED) || !Array.isArray(pack.files) || !pack.files.length || pack.files.length > MAX_FILES ||
        pack.file !== `${pack.id}-${pack.sha256}.sfa.gz` || !Array.isArray(pack.urls) || pack.urls.length > 5)
      throw Error(`Invalid asset pack: ${pack.id}`);
    ids.add(pack.id);
    for (const url of pack.urls) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw Error('Asset URLs must use HTTPS without credentials');
    }
    let total = 0;
    for (const file of pack.files) {
      const key = logicalPath(file.path).toLowerCase();
      if (paths.has(key) || !integer(file.bytes, MAX_EXPANDED) || !digestPattern.test(file.sha256))
        throw Error(`Duplicate or invalid asset entry: ${file.path}`);
      paths.add(key); total += file.bytes;
    }
    if (total !== pack.expandedBytes || sha256(manifestBytes(pack.files)) !== pack.manifestSha256)
      throw Error(`Asset manifest mismatch: ${pack.id}`);
  }
  // A file cannot also be another file's parent, even on a case-insensitive host.
  for (const name of paths) {
    const segments = name.split('/');
    while (segments.pop() && segments.length) if (paths.has(segments.join('/'))) throw Error(`Asset path collision: ${name}`);
  }
  return lock;
}

export async function loadLock(root = process.cwd()) {
  const target = path.join(root, 'sound-assets.lock.json');
  await noLinks(target);
  if ((await lstat(target)).size > 16 * 1024 * 1024) throw Error('Asset lock exceeds budget');
  const bytes = await readFile(target);
  if (bytes.length > 16 * 1024 * 1024) throw Error('Asset lock exceeds budget');
  return validateLock(JSON.parse(bytes));
}

export function selectedPacks(lock, profile = 'build') {
  if (!['build', 'audit', 'archive'].includes(profile)) throw Error(`Unknown asset profile: ${profile}`);
  return lock.packs.filter(p => p.profile === 'build' || profile === 'archive' || p.profile === profile);
}

export function cacheRoot(root = process.cwd()) {
  return path.resolve(process.env.SOUNDFORGE_ASSET_CACHE || path.join(root, '.cache/sound-assets'));
}

// Check every existing ancestor, not just the final file (Windows junctions count as links).
export async function noLinks(target) {
  const absolute = path.resolve(target), anchor = path.parse(absolute).root;
  let current = anchor;
  for (const part of absolute.slice(anchor.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw Error(`Asset path traverses a link: ${current}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

export async function fileDigest(file, maxBytes = Infinity) {
  await noLinks(file);
  const info = await lstat(file);
  if (!info.isFile() || info.size > maxBytes) throw Error(`Asset file exceeds byte budget or is not a regular file: ${file}`);
  const h = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Error(`Asset file exceeds byte budget: ${file}`);
    h.update(chunk);
  }
  return { bytes, sha256: h.digest('hex') };
}
const matches = (a, b) => a.bytes === b.bytes && a.sha256 === b.sha256;
async function renameReady(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(path.toNamespacedPath(from), path.toNamespacedPath(to)); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 10) throw error;
      await delay(100 + attempt * 50);
    }
  }
}
export const packDirectory = (cache, pack) => path.join(cache, 'unpacked', pack.sha256);
// Do not repeat long logical source paths under a long worktree/cache prefix.
// Stable entry numbers also avoid Windows' directory-move path-length limits.
export const assetFile = (cache, pack, index) => path.join(packDirectory(cache, pack), `${String(index).padStart(5, '0')}.asset`);

export async function verifyPack(pack, cache) {
  const directory = packDirectory(cache, pack);
  const savedManifest = path.join(directory, 'manifest.json');
  await noLinks(savedManifest);
  if ((await lstat(savedManifest)).size !== manifestBytes(pack.files).length) throw Error(`Cached asset manifest size mismatch: ${pack.id}`);
  if (!(await readFile(savedManifest)).equals(manifestBytes(pack.files))) throw Error(`Cached asset manifest mismatch: ${pack.id}`);
  for (const [index, file] of pack.files.entries()) {
    const target = assetFile(cache, pack, index);
    if (!matches(await fileDigest(target, file.bytes), file)) throw Error(`Corrupt asset: ${file.path}`);
  }
  return directory;
}

export async function status(lock, cache, profile = 'build') {
  const results = [];
  for (const pack of selectedPacks(lock, profile)) {
    try { await verifyPack(pack, cache); results.push({ id: pack.id, status: 'ready' }); }
    catch (e) { results.push({ id: pack.id, status: e.code === 'ENOENT' ? 'missing' : 'corrupt', reason: e.message }); }
  }
  return results;
}

export async function verify(lock, cache, profile = 'build') {
  const results = await status(lock, cache, profile), failed = results.filter(r => r.status !== 'ready');
  if (failed.length) throw Error(`${failed.length} asset pack(s) missing or corrupt: ${failed.map(r => r.id).join(', ')}. Run npm run assets:sync -- --profile ${profile} [--from PACKAGE_DIRECTORY].`);
  return results;
}

// Format: gzip(magic + uint32 manifest length + canonical manifest + raw files in manifest order).
// There are no archive-controlled names, links, modes, offsets or nested archives to extract.
export async function writePack(root, names, destination, id, profile, version, resolveSource = name => path.join(root, name)) {
  await noLinks(destination); await mkdir(destination, { recursive: true });
  const files = [];
  for (const name of [...names].sort()) files.push({ path: logicalPath(name), ...await fileDigest(resolveSource(name)) });
  const manifest = manifestBytes(files), header = Buffer.alloc(12);
  MAGIC.copy(header); header.writeUInt32LE(manifest.length, 8);
  const expandedBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  if (expandedBytes > MAX_EXPANDED || files.length > MAX_FILES || manifest.length > 4 * 1024 * 1024) throw Error('Pack exceeds expanded budget');
  const temporary = path.join(destination, `.pack-${randomUUID()}`);
  try {
    async function* input() {
      yield header; yield manifest;
      for (const file of files) {
        const h = createHash('sha256'); let bytes = 0;
        for await (const chunk of createReadStream(resolveSource(file.path))) { bytes += chunk.length; h.update(chunk); yield chunk; }
        if (!matches({ bytes, sha256: h.digest('hex') }, file)) throw Error(`Source changed while packing: ${file.path}`);
      }
    }
    await pipeline(Readable.from(input()), createGzip({ level: 6 }), byteLimit(MAX_PACK), createWriteStream(temporary, { flags: 'wx' }));
    const digest = await fileDigest(temporary);
    const pack = { id, version, profile, file: `${id}-${digest.sha256}.sfa.gz`, urls: [], ...digest,
      manifestSha256: sha256(manifest), expandedBytes, files };
    validateLock({ schema: LOCK_SCHEMA, packs: [pack] });
    const output = path.join(destination, pack.file);
    try { const existing = await fileDigest(output); if (!matches(existing, pack)) throw Error('Existing package differs'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; await rename(temporary, output); }
    return pack;
  } finally { await rm(temporary, { force: true }); }
}

function byteLimit(max) {
  let bytes = 0;
  return new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length; done(bytes > max ? Error('Asset stream exceeds byte budget') : null, chunk);
  } });
}

export async function extractPack(archive, pack, staging) {
  if (!matches(await fileDigest(archive, pack.bytes), pack)) throw Error(`Package checksum mismatch: ${pack.id}`);
  await noLinks(staging); await mkdir(staging, { recursive: false });
  const manifest = manifestBytes(pack.files), expected = Buffer.alloc(12 + manifest.length);
  MAGIC.copy(expected); expected.writeUInt32LE(manifest.length, 8); manifest.copy(expected, 12);
  let headerOffset = 0, index = 0, remaining = 0, handle, hash, consumed = 0;
  async function nextFile() {
    while (!handle && index < pack.files.length) {
      const file = pack.files[index], target = path.join(staging, `${String(index).padStart(5, '0')}.asset`);
      await mkdir(path.dirname(target), { recursive: true });
      handle = await open(target, 'wx'); hash = createHash('sha256'); remaining = file.bytes;
      if (!remaining) await finishFile();
    }
  }
  async function finishFile() {
    await handle.close(); handle = undefined;
    if (hash.digest('hex') !== pack.files[index].sha256) throw Error(`Extracted asset checksum mismatch: ${pack.files[index].path}`);
    index++;
  }
  const compressed = createReadStream(archive), decompressor = createGunzip();
  compressed.on('error', e => decompressor.destroy(e)); compressed.pipe(decompressor);
  try {
    for await (const chunk of decompressor) {
      consumed += chunk.length;
      if (consumed > expected.length + pack.expandedBytes) throw Error('Expanded asset stream exceeds byte budget');
      let offset = 0;
      if (headerOffset < expected.length) {
        const count = Math.min(chunk.length, expected.length - headerOffset);
        if (!chunk.subarray(0, count).equals(expected.subarray(headerOffset, headerOffset + count))) throw Error('Package header/manifest mismatch');
        headerOffset += count; offset += count;
      }
      if (headerOffset === expected.length) await nextFile();
      while (offset < chunk.length) {
        if (!handle) throw Error('Trailing asset data');
        const count = Math.min(remaining, chunk.length - offset), part = chunk.subarray(offset, offset + count);
        await handle.writeFile(part); hash.update(part); remaining -= count; offset += count;
        if (!remaining) { await finishFile(); await nextFile(); }
      }
    }
    if (headerOffset !== expected.length || index !== pack.files.length) throw Error('Truncated asset stream');
    await writeFile(path.join(staging, 'manifest.json'), manifest, {flag:'wx'});
  } finally { compressed.destroy(); decompressor.destroy(); if (handle) await handle.close(); }
}

async function obtain(pack, archive, from) {
  if (from) {
    const source = path.join(path.resolve(from), pack.file);
    if (!matches(await fileDigest(source, pack.bytes), pack)) throw Error(`Local package checksum mismatch: ${pack.id}`);
    await pipeline(createReadStream(source), byteLimit(pack.bytes), createWriteStream(archive, { flags: 'wx' }));
    return;
  }
  if (!pack.urls.length) throw Error(`Pack ${pack.id} is not published. Use --from PACKAGE_DIRECTORY; no remote release has been configured.`);
  const errors = [];
  for (const url of pack.urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok || !response.body || !response.url.startsWith('https:')) throw Error(`HTTP ${response.status}`);
      if (response.headers.has('content-length') && Number(response.headers.get('content-length')) !== pack.bytes) throw Error('Download size mismatch');
      await pipeline(Readable.fromWeb(response.body), byteLimit(pack.bytes), createWriteStream(archive, { flags: 'wx' }));
      if (!matches(await fileDigest(archive, pack.bytes), pack)) throw Error('Download checksum mismatch');
      return;
    } catch (e) { errors.push(e.message); await rm(archive, { force: true }); }
  }
  throw Error(`Cannot download ${pack.id}: ${errors.join('; ')}`);
}

export async function sync(lock, cache, { profile = 'build', from } = {}) {
  validateLock(lock); await noLinks(cache); await mkdir(path.join(cache, 'unpacked'), { recursive: true });
  const mutex = path.join(cache, '.sync-lock');
  try { await mkdir(mutex); }
  catch (e) { if (e.code === 'EEXIST') throw Error(`Asset sync already running, or interrupted. Check active processes before removing ${mutex}`); throw e; }
  try {
    for (const pack of selectedPacks(lock, profile)) {
      try { await verifyPack(pack, cache); continue; } catch { /* Recover from a missing/corrupt pack. */ }
      const token = randomUUID(), archive = path.join(cache, `.download-${token}`), staging = path.join(cache, `.extract-${token}`);
      const final = packDirectory(cache, pack), old = path.join(cache, `.previous-${token}`);
      try {
        console.log(`Sync ${pack.id} (${(pack.bytes / 1048576).toFixed(1)} MiB)`);
        await obtain(pack, archive, from); await extractPack(archive, pack, staging);
        // Do not remove the prior directory until its replacement has fully verified.
        await noLinks(final);
        let moved = false;
        try { await renameReady(final, old); moved = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
        try { await renameReady(staging, final); }
        catch (e) { if (moved) await renameReady(old, final); throw e; }
        if (moved) await rm(old, { recursive: true, force: true });
      } finally { await rm(archive, { force: true }); await rm(staging, { recursive: true, force: true }); }
    }
  } finally { await rm(mutex, { recursive: true, force: true }); }
}

export async function assetResolver(root = process.cwd(), { profile = 'build', check = true } = {}) {
  const lock = await loadLock(root), cache = cacheRoot(root);
  if (check) await verify(lock, cache, profile);
  const entries = new Map(lock.packs.flatMap(pack => pack.files.map((file, index) => [file.path, assetFile(cache, pack, index)])));
  return name => entries.get(name.replaceAll('\\', '/')) ?? path.join(root, name);
}

const resolvers = new Map();
export async function readAsset(root, logical, encoding) {
  const key = path.resolve(root);
  if (!resolvers.has(key)) resolvers.set(key, assetResolver(key, { check: false }));
  return readFile((await resolvers.get(key))(logical), encoding);
}

export async function walkFiles(directory, relative = '') {
  const output = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error(`Unexpected link: ${relative}/${entry.name}`);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await walkFiles(directory, name));
    else if (entry.isFile()) output.push(name);
  }
  return output.sort();
}
