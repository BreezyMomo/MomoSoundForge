import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseDistribution } from '../src/builtinDistribution.mjs';
import { libraryInventory, verifyLocalFiles, verifyRemoteFiles } from './sound-distribution.mjs';

// Validate the actual deployment folder, including resources loaded on demand.
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!['--dir', '--origin', '--local-resources'].includes(key) || key in options) throw Error(`Unknown or duplicate option: ${key}`);
  options[key] = key === '--local-resources' ? true : args[++i];
  if (!options[key]) throw Error(`Missing value for ${key}`);
}
const root = path.resolve(options['--dir'] || 'dist');
const html = await readFile(path.join(root, "index.html"), "utf8");
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)) {
  await stat(path.resolve(root, match[1]));
}
const catalog = JSON.parse(await readFile("src/data/builtin-catalog.json", "utf8"));
const manifest = await libraryInventory();
const distribution = parseDistribution(JSON.parse(await readFile(path.join(root, 'sound-library/distribution.json'), 'utf8')));
if (distribution.mode === 'local') await verifyLocalFiles(path.join(root, 'sound-library'), manifest);
else {
  if ((await readdir(path.join(root, 'sound-library'))).some(file => file.endsWith('.bin')))
    throw Error('External deployment still contains sound binaries');
  await verifyLocalFiles(path.join(root, 'sound-library'), { files: manifest.files.filter(f => f.file.startsWith('licenses/')) });
  if (options['--local-resources']) {
    await verifyLocalFiles(path.resolve('public/sound-library'), manifest);
    console.log('Candidate only: local source files verified; remote availability and CORS have NOT been verified.');
  } else await verifyRemoteFiles(distribution.baseUrl, manifest, options['--origin']);
}
const assets = await readdir(path.join(root, "assets"));
if (!assets.some(file => file.startsWith("render.worker-") && file.endsWith(".js")) ||
    !assets.some(file => file.endsWith(".wasm"))) {
  throw Error("Missing audio worker or WebAssembly encoder");
}
async function size(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Deployment contains a symlink: ${file}`);
    total += entry.isDirectory() ? await size(file) : (await stat(file)).size;
  }
  return total;
}
const bytes = await size(root);
if (bytes >= 1_000_000_000) throw Error("Website exceeds the GitHub Pages 1 GB limit");
console.log(`Static site verified (${distribution.mode}): ${catalog.sounds.length} sounds, ${(bytes / 1048576).toFixed(1)} MiB`);
