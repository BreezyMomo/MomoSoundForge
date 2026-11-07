/** Review candidate only. Never changes the factory catalog or existing samples. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const revision = 'dfcf4a4918771eee884b96ad4493de82ef84daf6';
const mappingPath = 'Chordophones/Zithers/Grand Piano, Kawai.sfz';
const destination = path.resolve('test-results/replacement-candidates/vcsl-kawai');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const raw = name => `https://raw.githubusercontent.com/sgossner/VCSL/${revision}/${name.split('/').map(encodeURIComponent).join('/')}`;
async function fetchBounded(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok || !response.body) throw Error(`Download failed: ${response.status} ${url}`);
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) throw Error('Candidate download exceeds budget'); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
await mkdir(destination, { recursive: true });
const tree = JSON.parse(await fetchBounded(`https://api.github.com/repos/sgossner/VCSL/git/trees/${revision}?recursive=1`, 4 * 1024 * 1024));
if (tree.truncated || tree.sha !== revision) throw Error('Incomplete or unexpected source tree');
const entries = new Map(tree.tree.filter(e => e.type === 'blob' && e.mode === '100644').map(e => [e.path, e]));
async function verified(name) {
  const entry = entries.get(name);
  if (!entry || entry.size > 24 * 1024 * 1024) throw Error(`Missing/oversized candidate: ${name}`);
  const bytes = await fetchBounded(raw(name), entry.size);
  if (bytes.length !== entry.size || blob(bytes) !== entry.sha) throw Error(`Candidate checksum mismatch: ${name}`);
  return bytes;
}
const mapping = await verified(mappingPath), readme = await verified('README.md');
await writeFile(path.join(destination, 'author.sfz'), mapping);
await writeFile(path.join(destination, 'README.upstream.md'), readme);
const text = mapping.toString('utf8');
if (/#include|#define/.test(text)) throw Error('Preprocessor requires a dedicated importer');
let global = {}, group = {};
const regions = [];
for (const match of text.replace(/\/\/[^\n]*/g, '').matchAll(/<([^>]+)>([^<]*)/g)) {
  const [, tag, body] = match;
  const fields = [...body.matchAll(/\b([A-Za-z_]\w*)\s*=/g)];
  const ops = Object.fromEntries(fields.map((f, i) => [f[1], body.slice(f.index + f[0].length, fields[i + 1]?.index ?? body.length).trim()]));
  if (tag === 'global') { global = ops; group = {}; }
  else if (tag === 'group') group = ops;
  else if (tag === 'region') regions.push({ ...global, ...group, ...ops });
  else throw Error(`Unsupported SFZ tag: ${tag}`);
}
const files = [...new Set(regions.map(r => r.sample))].map(name => {
  if (!name || name.includes('\\') || name.split('/').some(p => !p || p === '..' || p === '.' || p.includes(':'))) throw Error('Unsafe sample path');
  const sourcePath = path.posix.join(path.posix.dirname(mappingPath), name), entry = entries.get(sourcePath);
  if (!entry) throw Error(`Missing mapped sample: ${sourcePath}`);
  return { sourcePath, gitBlobSha1: entry.sha, bytes: entry.size, url: raw(sourcePath), file: `originals/${entry.sha}.wav` };
});
if (files.reduce((n, f) => n + f.bytes, 0) > 600 * 1024 * 1024 || files.length > 300) throw Error('Candidate set exceeds review budget');
const oldBlobs = new Set();
for (const collection of ['orchestra-basics-20261104', 'orchestra-expanded-20261105']) {
  const m = JSON.parse(await readFile(`samples/${collection}/manifest.json`, 'utf8'));
  m.samples.forEach(s => oldBlobs.add(s.sourceGitBlobSha1));
}
const attacks = regions.filter(r => r.trigger === 'attack'), gaps = [];
for (let midi = 21; midi <= 108; midi++) for (let velocity = 1; velocity <= 127; velocity++)
  if (!attacks.some(r => midi >= +r.lokey && midi <= +r.hikey && velocity >= +(r.lovel ?? 0) && velocity <= +(r.hivel ?? 127))) gaps.push([midi, velocity]);
if (process.argv.includes('--download')) {
  await mkdir(path.join(destination, 'originals'), { recursive: true });
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < files.length) {
      const f = files[next++], target = path.join(destination, f.file); let data;
      try { data = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (data && (data.length !== f.bytes || blob(data) !== f.gitBlobSha1)) throw Error(`Existing candidate differs: ${f.file}`);
      if (!data) { data = await verified(f.sourcePath); await writeFile(target, data); }
      f.sha256 = sha(data); completed++;
      if (completed % 40 === 0) console.log(`Verified ${completed}/${files.length} candidate recordings`);
    }
  }));
}
const report = { schema: 'momo.source-candidate/v1', status: 'candidate-not-shipped', repository: 'https://github.com/sgossner/VCSL', revision,
  license: 'CC0-1.0', licenseEvidence: { file: 'README.upstream.md', sha256: sha(readme), url: raw('README.md') },
  mapping: { path: mappingPath, sha256: sha(mapping), regions: regions.length, opcodes: [...new Set(regions.flatMap(r => Object.keys(r)))].sort() },
  attackRegions: attacks.length, releaseRegions: regions.filter(r => r.trigger === 'release').length,
  noteRange: [Math.min(...attacks.map(r => +r.lokey)), Math.max(...attacks.map(r => +r.hikey))],
  roots: [...new Set(attacks.map(r => +r.pitch_keycenter))].sort((a, b) => a - b), uncoveredKeyVelocityCells: gaps.length,
  reusedExistingRecordings: files.filter(f => oldBlobs.has(f.gitBlobSha1)).length,
  bytes: files.reduce((n, f) => n + f.bytes, 0), files, regions,
  integrationRequirements: ['Preserve author offset, tune, volume, attack/release envelopes and velocity mapping.',
    'Map release-trigger samples; do not silently treat them as normal note attacks.',
    'Complete recordings must remain available independently of instrument performance clips.',
    'Do not label waveform/statistical checks as subjective timbre verification.'] };
await writeFile(path.join(destination, 'candidate.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ destination, files: files.length, attackRegions: report.attackRegions, releaseRegions: report.releaseRegions,
  noteRange: report.noteRange, gaps: gaps.length, reused: report.reusedExistingRecordings, mib: report.bytes / 1048576, downloaded: files.every(f => f.sha256) }));
