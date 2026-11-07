import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './audio-audit-core.mjs';
import { instrumentJobs } from './builtin-instruments.mjs';
import { gameSfxJobs } from './builtin-game-sfx.mjs';
import { natureSfxJobs } from './builtin-nature-sfx.mjs';
import { pianoJob } from './builtin-vcsl-piano.mjs';
import { assetResolver, loadLock } from './sound-asset-store.mjs';

export async function collections(root = process.cwd()) {
  const names = ['cc0-starter-20261104', 'orchestra-basics-20261104', 'orchestra-expanded-20261105', 'game-sfx-starter-20261105', 'nature-ambience-20261105', 'vcsl-kawai-20261107'];
  return Promise.all(names.map(async name => {
    const base = `samples/${name}`, manifest = JSON.parse(await readFile(path.join(root, base, 'manifest.json'), 'utf8'));
    let quarantine = [];
    try { quarantine = JSON.parse(await readFile(path.join(root, base, 'quarantine.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { name, base, manifest, quarantine };
  }));
}

export async function buildInputPaths(root = process.cwd()) {
  const [fx, basics, expanded, game, nature, piano] = await collections(root);
  const quality = JSON.parse(await readFile(path.join(root, 'tools/builtin-quality.json'), 'utf8'));
  const excluded = new Set(quality.excludedStandaloneSamples.map(s => s.id));
  const replaced = new Set(expanded.manifest.samples.map(s => s.instrumentId));
  const recipes = JSON.parse(await readFile(path.join(root, fx.base, 'examples/recipes.json'), 'utf8'));
  return new Set([
    ...fx.manifest.samples.map(s => `${fx.base}/${s.projectFile}`),
    ...recipes.map(s => `${fx.base}/${s.projectFile}`),
    ...basics.manifest.samples.filter(s => !excluded.has(s.id) && !replaced.has(s.instrumentId)).map(s => `${basics.base}/${s.wavFile}`),
    ...instrumentJobs({ ...expanded.manifest, samples: expanded.manifest.samples.filter(s => s.instrumentId !== 'upright-piano') }, expanded.base).flatMap(j => j.sourceFiles),
    ...pianoJob(piano.manifest, piano.base).sourceFiles,
    ...gameSfxJobs(game.manifest, game.base).flatMap(j => j.sourceFiles ?? [j.source]),
    ...natureSfxJobs(nature.manifest, nature.base).flatMap(j => j.sourceFiles ?? [j.source]),
    `${basics.base}/examples/forest-departure-8s.soundforge`,
    'exports/piano-window-light-20261104/piano-window-light.soundforge',
    ...['piano', 'flute', 'violin', 'cello', 'horn', 'trumpet'].map(id => `${expanded.base}/demos/expanded-${id}.soundforge`),
  ]);
}

export function reportDestination(value) {
  const root = process.cwd(), destination = path.resolve(value);
  const rel = path.relative(root, destination);
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(path.sep)[0] !== 'test-results'))
    throw Error('Reports inside the repository must be under test-results/');
  return destination;
}

export async function inventory(destination) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const lock = await loadLock(), resolveAsset = await assetResolver(process.cwd(), {profile:'archive'});
  const paths = [...new Set([...git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean),
    ...lock.packs.flatMap(p => p.files.map(f => f.path))])].sort(), inputs = await buildInputPaths(), files = [];
  const knownInputs = new Set();
  for (const name of paths) {
    const bytes = await readFile(resolveAsset(name));
    const binaryAsset = /\.(wav|ogg|mp3|flac|sfresource|soundforge|sfinstrument|zip)$/i.test(name);
    const role = inputs.has(name) ? 'build-input' : binaryAsset ? 'archive-until-reproducibility-proven' : 'keep-in-git';
    if (inputs.has(name)) knownInputs.add(name);
    files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes), role });
  }
  for (const name of inputs) if (!knownInputs.has(name)) throw Error(`Build input is not inventoried: ${name}`);
  const duplicateGroups = [...Map.groupBy(files.filter(f => f.role !== 'keep-in-git'), f => f.sha256).values()]
    .filter(group => group.length > 1).map(group => ({ sha256: group[0].sha256, bytes: group[0].bytes, paths: group.map(f => f.path) }));
  const catalog = JSON.parse(await readFile('src/data/builtin-catalog.json', 'utf8'));
  const generated = [];
  for (const sound of [...catalog.sounds, ...(catalog.recordings ?? [])]) {
    const data = await readFile(`public/sound-library/${sound.file}`);
    if (sha256(data) !== sound.sha256) throw Error(`Generated baseline hash mismatch: ${sound.id}`);
    generated.push({ id: sound.id, kind: sound.kind, file: sound.file, sha256: sound.sha256, bytes: data.length });
  }
  const report = { schema: 'momo.asset-inventory/v1', commit: git('rev-parse', 'HEAD').trim(),
    workingTree: git('status', '--porcelain'), createdAt: new Date().toISOString(),
    totals: [...Map.groupBy(files, f => f.role)].map(([role, list]) => ({ role, files: list.length, bytes: list.reduce((n, f) => n + f.bytes, 0) })),
    files, duplicateGroups, catalogSha256: sha256(await readFile('src/data/builtin-catalog.json')), generated,
    deletionApproved: false, note: 'Archive is conservative. No file is declared regenerable solely by extension.' };
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'inventory.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ commit: report.commit, totals: report.totals, duplicates: duplicateGroups.length, baselineSounds: generated.length }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await inventory(reportDestination(process.argv[2] ?? 'test-results/source-review/inventory'));
