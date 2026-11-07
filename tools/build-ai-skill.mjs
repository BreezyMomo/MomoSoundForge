import { build } from 'esbuild';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';

const root = process.cwd(), zip = new JSZip(), name = 'momo-sound-forge';
const folder = zip.folder(name), fingerprint = {}, dependencies = new Set();
async function addTree(dir, prefix = '') {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, file.name), full = path.join(dir, file.name);
    if (file.isDirectory()) await addTree(full, relative);
    else { const bytes = await readFile(full); folder.file(relative, bytes, { date: new Date('2026-01-01') }); }
  }
}
await addTree(path.join(root, 'skills', name));
const output = path.join(root, 'public/ai'); await mkdir(output, { recursive: true });
for (const [entry, target] of [['tools/ai-server.mjs', 'server.mjs'], ['tools/ai-cli.ts', 'cli.mjs']]) {
  const result = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, external: ['@ffmpeg/*'],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }, legalComments: 'inline', metafile: true });
  const bytes = result.outputFiles[0].contents;
  folder.file(`scripts/${target}`, bytes, { date: new Date('2026-01-01') });
  for (const file of Object.keys(result.metafile.inputs)) if (!file.includes('node_modules')) fingerprint[file] = createHash('sha256').update(await readFile(file)).digest('hex');
  for (const file of Object.keys(result.metafile.inputs)) {
    const match = file.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (match) dependencies.add(match[1]);
  }
}
// Preserve bundled dependency licenses. No vendor source is copied into application code.
const licenses = [];
for (const dependency of [...dependencies].sort()) {
  const dir = path.resolve(root, dependency), pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  const files = (await readdir(dir)).filter(file => /^licen[cs]e|^copying|^notice/i.test(file));
  if (!files.length) {
    // isarray@1.0.0 distributes its complete MIT notice in README, without a LICENSE file.
    if(pkg.name==='isarray'&&pkg.version==='1.0.0'){
      const readme=await readFile(path.join(dir,'README.md'),'utf8'),notice=readme.slice(readme.indexOf('## License'));
      if(!notice.includes('Copyright (c) 2013 Julian Gruber')||!notice.includes('Permission is hereby granted'))throw Error(`Missing bundled license: ${pkg.name}`);
      licenses.push(`## ${pkg.name}@${pkg.version}\n${notice}`);continue;
    }
    throw Error(`Missing bundled license: ${pkg.name}`);
  }
  for (const file of files) licenses.push(`## ${pkg.name}@${pkg.version}\n${await readFile(path.join(dir, file), 'utf8')}`);
}
folder.file('THIRD_PARTY_NOTICES.txt', licenses.join('\n\n'));
folder.file('engine-version.json', JSON.stringify({ schema: 'momo.soundforge.ai-build/v1', sources: fingerprint }, null, 2));
await writeFile(path.join(output, `${name}.zip`), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Built ${name}.zip (portable Node service + native authoring CLI)`);
