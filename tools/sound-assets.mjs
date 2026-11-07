import path from 'node:path';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { buildInputPaths } from './inventory-sound-assets.mjs';
import { LOCK_SCHEMA, loadLock, validateLock, writePack, sync, verify, status, cacheRoot, walkFiles, assetResolver } from './sound-asset-store.mjs';

const [command, ...args] = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  if (!['--from', '--output', '--profile', '--version'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--'))
    throw Error(`Unknown or incomplete option: ${args[i]}`);
  options[args[i].slice(2)] = args[++i];
}
const root = process.cwd(), profile = options.profile ?? 'build';
if (command === 'pack') {
  if (!options.output || !options.version) throw Error('Usage: npm run assets:pack -- --output DIRECTORY --version VERSION');
  const destination = path.resolve(options.output);
  if (destination === root || path.relative(root, destination).split(path.sep)[0] === 'samples') throw Error('Packages must not overwrite source assets');
  await mkdir(destination, { recursive: true });
  const inputs = await buildInputPaths(root), groups = { build: [], audit: [], archive: [] };
  const sources = new Map();
  let previous;
  try { previous = await loadLock(root); } catch (e) { if(e.code !== 'ENOENT') throw e; }
  if (previous) {
    const resolve = await assetResolver(root, {profile:'archive'});
    for (const pack of previous.packs) for (const file of pack.files) sources.set(file.path, resolve(file.path));
  }
  // Keep source metadata, author mappings, notices and conversion recipes in Git.
  const binary = /\.(wav|mp3|ogg|flac|aiff?|soundforge|sfresource|sfinstrument|zip)$/i;
  for (const base of ['samples', 'exports']) {
    let files;
    try { files = await walkFiles(path.join(root, base)); } catch (e) { if(e.code !== 'ENOENT') throw e; files = []; }
    for (const relative of files) {
      const name = `${base}/${relative}`;
      if (binary.test(name)) sources.set(name, path.join(root, name));
    }
  }
  for (const name of sources.keys()) {
    const role = inputs.has(name) ? 'build' : name.startsWith('samples/') ? 'audit' : 'archive';
    groups[role].push(name);
  }
  for (const name of inputs) if (binary.test(name) && !groups.build.includes(name)) throw Error(`Missing build input: ${name}`);
  const packs = [];
  for (const [role, files] of Object.entries(groups)) {
    let part = [], bytes = 0, number = 0;
    async function flush() {
      if (!part.length) return;
      const id = `${role}-${String(++number).padStart(3, '0')}`;
      console.log(`Packing ${id}: ${part.length} files, ${(bytes / 1048576).toFixed(1)} MiB expanded`);
      packs.push(await writePack(root, part, destination, id, role, options.version, name => sources.get(name))); part = []; bytes = 0;
    }
    for (const name of files.sort()) {
      const size = (await stat(sources.get(name))).size;
      if (size > 256 * 1024 * 1024) throw Error(`Single source exceeds pack budget: ${name}`);
      if (bytes + size > 256 * 1024 * 1024 || part.length === 5000) await flush();
      part.push(name); bytes += size;
    }
    await flush();
  }
  const lock = validateLock({ schema: LOCK_SCHEMA, packs });
  // Generate a candidate; adopting it in the code checkout is an explicit local step.
  await writeFile(path.join(destination, 'sound-assets.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  console.log(JSON.stringify({ output: destination, packs: packs.length, files: packs.reduce((n, p) => n + p.files.length, 0), bytes: packs.reduce((n, p) => n + p.bytes, 0), published: false }));
} else {
  const lock = await loadLock(root), cache = cacheRoot(root);
  if (command === 'sync') await sync(lock, cache, { profile, from: options.from });
  else if (command === 'verify') await verify(lock, cache, profile);
  else if (command === 'status') {
    const results = await status(lock, cache, profile); console.log(JSON.stringify(results, null, 2));
    if (results.some(r => r.status !== 'ready')) process.exitCode = 1;
  } else throw Error('Usage: sound-assets.mjs pack|sync|verify|status');
  if (['sync', 'verify'].includes(command)) console.log(`Asset ${profile} profile verified.`);
}
