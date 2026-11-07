import { readFile, readdir, mkdir, copyFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { distributionDescriptor, normalizeLibraryUrl } from '../src/builtinDistribution.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const binaryName = /^[a-f0-9]{64}\.(soundforge|recording)\.bin$/;
async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw Error(`Expected a regular file: ${file}`);
  return readFile(file);
}

export async function libraryInventory(root = process.cwd()) {
  const raw = await readFile(path.join(root, 'src/data/builtin-catalog.json'));
  const catalog = JSON.parse(raw), entries = new Map();
  for (const entry of [...catalog.sounds, ...catalog.recordings, ...(catalog.audio ?? [])]) {
    if (!binaryName.test(entry.file) || !entry.file.startsWith(`${entry.sha256}.`)
      || !Number.isSafeInteger(entry.compressedBytes) || entry.compressedBytes < 1 || entry.compressedBytes > 12 * 1024 * 1024)
      throw Error(`Invalid distribution entry: ${entry.id}`);
    const item = { file: entry.file, bytes: entry.compressedBytes, sha256: entry.sha256 };
    if (entries.has(item.file) && JSON.stringify(entries.get(item.file)) !== JSON.stringify(item))
      throw Error(`Conflicting distribution entry: ${entry.id}`);
    entries.set(item.file, item);
  }
  const source = path.join(root, 'public/sound-library');
  const remoteBytes = await regularFile(path.join(source, 'index.json'));
  const remote = JSON.parse(remoteBytes);
  if(remote.schema !== 'momo.remote-sound-library/v1') throw Error('Rebuild the remote sound catalog');
  entries.set('index.json', {file:'index.json', bytes:remoteBytes.length, sha256:hash(remoteBytes)});
  for(const f of [...remote.entries,...remote.audio]) {
    if(!/^(?:remote\/)?[a-f0-9]{64}\.(?:graph|audio|soundforge|recording)\.bin$/.test(f.file)||! /^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<1)throw Error('Invalid remote file');
    const item={file:f.file,bytes:f.bytes,sha256:f.sha256};
    if(entries.has(item.file)&&JSON.stringify(entries.get(item.file))!==JSON.stringify(item))throw Error('Conflicting remote file');
    entries.set(item.file,item);
  }
  const stamp = JSON.parse(await readFile(path.join(source, '.source-fingerprint'), 'utf8'));
  if (stamp.catalog !== hash(raw)) throw Error('Rebuild the library before staging: catalog differs from generated files');
  for (const [file, sha256] of Object.entries(stamp.licenses)) {
    if (!/^[a-zA-Z0-9_-]+\.(txt|md|json)$/.test(file) || !/^[a-f0-9]{64}$/.test(sha256))
      throw Error('Invalid generated license inventory');
    const bytes = await regularFile(path.join(source, 'licenses', file));
    if (hash(bytes) !== sha256) throw Error(`Generated license changed: ${file}`);
    entries.set(`licenses/${file}`, { file: `licenses/${file}`, bytes: bytes.length, sha256 });
  }
  return { schema: 'momo.sound-distribution-files/v1', catalogSha256: hash(raw), files: [...entries.values()] };
}

export async function verifyLocalFiles(directory, manifest) {
  for (const entry of manifest.files) {
    const bytes = await regularFile(path.join(directory, entry.file));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error(`Missing or corrupt sound distribution file: ${entry.file}`);
  }
}

export async function stageDistribution(output, root = process.cwd()) {
  const manifest = await libraryInventory(root), source = path.join(root, 'public/sound-library');
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  if (manifest.files.reduce((n, f) => n + f.bytes, Buffer.byteLength(serialized)) >= 1_000_000_000)
    throw Error('Audio site exceeds the GitHub Pages 1 GB limit');
  await verifyLocalFiles(source, manifest);
  // Exclusive creation prevents overwriting an already reviewed release directory.
  await mkdir(output);
  await mkdir(path.join(output, 'licenses'));
  for (const entry of manifest.files) {
    await mkdir(path.dirname(path.join(output,entry.file)), {recursive:true});
    await copyFile(path.join(source, entry.file), path.join(output, entry.file));
  }
  await verifyLocalFiles(output, manifest);
  await writeFile(path.join(output, 'manifest.json'), serialized, { flag: 'wx' });
  return manifest;
}

export async function verifyStagedDistribution(directory, root = process.cwd()) {
  const expected = await libraryInventory(root);
  const actual = JSON.parse(await regularFile(path.join(directory, 'manifest.json')));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Audio site manifest differs from the current catalog');
  await verifyLocalFiles(directory, expected);
  const allowed = new Set(['manifest.json', ...expected.files.map(f => f.file)]);
  let bytes = 0;
  async function walk(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw Error(`Audio site contains a symlink: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else {
        if (!allowed.delete(name)) throw Error(`Unexpected audio site file: ${name}`);
        bytes += (await lstat(path.join(directory, name))).size;
      }
    }
  }
  await walk();
  if (allowed.size || bytes >= 1_000_000_000) throw Error('Incomplete audio site or GitHub Pages size limit exceeded');
  return { files: expected.files.length, bytes, catalogSha256: expected.catalogSha256 };
}

// Vite skips publicDir only in external builds. Preserve all other public files,
// including the downloadable AI tools; keep license notices on the website too.
export async function finishDistribution(root, outDir, externalUrl) {
  const descriptor = distributionDescriptor(externalUrl), target = path.join(outDir, 'sound-library');
  if (descriptor.mode === 'external') {
    const manifest = await libraryInventory(root);
    await verifyLocalFiles(path.join(root, 'public/sound-library'), manifest);
    async function copyPublic(relative = '') {
      const source = path.join(root, 'public', relative);
      for (const entry of await readdir(source, { withFileTypes: true })) {
        const file = path.posix.join(relative, entry.name);
        if (file === 'sound-library') continue;
        if (entry.isSymbolicLink()) throw Error(`Public symlink is unsupported: ${file}`);
        if (entry.isDirectory()) await copyPublic(file);
        else {
          await mkdir(path.dirname(path.join(outDir, file)), { recursive: true });
          await copyFile(path.join(source, entry.name), path.join(outDir, file));
        }
      }
    }
    await copyPublic();
    await mkdir(path.join(target, 'licenses'), { recursive: true });
    for (const entry of manifest.files.filter(f => f.file.startsWith('licenses/')))
      await copyFile(path.join(root, 'public/sound-library', entry.file), path.join(target, entry.file));
  }
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'distribution.json'), JSON.stringify(descriptor, null, 2) + '\n');
}

export async function verifyRemoteFiles(baseUrl, manifest, origin, fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const base = normalizeLibraryUrl(baseUrl);
  if (!base) throw Error('An external library URL is required');
  if (!origin || new URL(origin).origin !== origin) throw Error('Pass --origin with the website origin to verify CORS');
  async function request(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetcher(url, { headers: { Origin: origin }, signal: AbortSignal.timeout(60000), redirect: 'error', credentials: 'omit' });
      } catch (error) {
        if (attempt === 2 || !(error instanceof TypeError || error?.name === 'TimeoutError')) throw error;
      }
      if (response && (attempt === 2 || ![429, 500, 502, 503, 504].includes(response.status))) return response;
      await response?.body?.cancel().catch(() => {});
      await wait(1000 * (attempt + 1));
    }
  }
  let cursor = 0;
  async function worker() {
    while (cursor < manifest.files.length) {
      const entry = manifest.files[cursor++];
      const response = await request(`${base}${entry.file}`);
      if (!response.ok || !response.body) throw Error(`Resource HTTP ${response.status}: ${entry.file}`);
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
      if (allowOrigin !== '*' && allowOrigin !== origin) {
        await response.body.cancel(); throw Error(`Resource CORS is missing or incorrect: ${entry.file}`);
      }
      const digest = createHash('sha256'), reader = response.body.getReader(); let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          bytes += value.length;
          if (bytes > entry.bytes) throw Error(`Oversized remote resource: ${entry.file}`);
          digest.update(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (bytes !== entry.bytes || digest.digest('hex') !== entry.sha256) throw Error(`Remote resource checksum mismatch: ${entry.file}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, flag, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length || !((command === 'stage' && flag === '--output') || (command === 'check' && flag === '--directory')))
    throw Error('Usage: node tools/sound-distribution.mjs stage --output NEW_DIRECTORY | check --directory DIRECTORY');
  if (command === 'stage') {
    const manifest = await stageDistribution(path.resolve(output));
    console.log(`Staged ${manifest.files.length} verified files (${(manifest.files.reduce((n, f) => n + f.bytes, 0) / 1048576).toFixed(1)} MiB). Nothing uploaded.`);
  } else console.log(JSON.stringify(await verifyStagedDistribution(path.resolve(output))));
}
