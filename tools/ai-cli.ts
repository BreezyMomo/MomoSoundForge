import { createSamplePreparer } from '../src/prepareSamples';
import { portableResource } from '../src/portableResource';
import { projectDocument } from '../src/model';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { makeProject, makeLayer, parseProject, projectForSave, encodeSamples, MAX_ASSET_BYTES, MAX_SAMPLE_FRAMES, type Project } from '../src/model';
import { renderProject, encodeWav } from '../src/engine';
import { applyEdits, AUTHORING_SCHEMA, projectScoreIssues } from '../src/aiAuthoring';
import { fromPreset, PRESETS } from '../src/presets';
import { validateSampleSource } from '../src/sampleSource';
import catalog from '../src/data/builtin-catalog.json';
import { createBuiltinRecordingLoader } from '../src/builtinRecordings';
import { importResource, resourceProject, RESOURCE_BYTES } from '../src/soundResources';

const [command, ...args] = process.argv.slice(2);
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i].startsWith('--') || !args[i + 1] || options[args[i]]) throw Error('Expected unique --key value pairs');
  options[args[i]] = args[i + 1];
}
const need = (key: string) => { if (!options[key]) throw Error(`Missing ${key}`); return options[key]; };
const json = async (path: string) => { const bytes = await readFile(path); if (bytes.length > 36 * 1024 * 1024) throw Error('Input exceeds budget'); return JSON.parse(bytes.toString('utf8')); };
const input = async () => parseProject(await json(need('--input')));
const write = async (path: string, value: string | Uint8Array) => { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(path, value, { flag: 'wx' }); };
const sampleBase = () => {
  if (!options['--site']) return '/';
  const site = new URL(options['--site']);
  if (!['https:', 'http:'].includes(site.protocol)) throw Error('Use an explicit HTTP(S) editor URL');
  site.pathname = site.pathname.replace(/\/?$/, '/'); site.search = ''; site.hash = ''; return site.href;
};
const prepare = createSamplePreparer(url => {
  if (!options['--site']) throw Error('Required recording is not embedded; pass --site EDITOR_URL to load it.');
  return fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
}, sampleBase());
const save = async (p: Project) => write(need('--out'), JSON.stringify(projectDocument(await prepare(parseProject(projectForSave(p)))), null, 2));

export function decodePCM(bytes: Buffer, name: string, id: string) {
  if (bytes.length > 24 * 1024 * 1024 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw Error('Use a PCM WAV file <=24 MiB');
  let format = 0, channels = 0, rate = 0, bits = 0, block = 0, data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > bytes.length) throw Error('Truncated WAV');
    if (tag === 'fmt ' && size >= 16) { format = bytes.readUInt16LE(start); channels = bytes.readUInt16LE(start + 2); rate = bytes.readUInt32LE(start + 4); block = bytes.readUInt16LE(start + 12); bits = bytes.readUInt16LE(start + 14); }
    if (tag === 'data') data = bytes.subarray(start, start + size);
    offset = start + size + size % 2;
  }
  if (!data || ![1, 2].includes(channels) || rate < 8000 || rate > 192000 || !((format === 1 && [16, 24, 32].includes(bits)) || (format === 3 && bits === 32)) || block !== channels * bits / 8 || data.length % block) throw Error('Unsupported WAV. Use mono/stereo PCM16/24/32 or float32.');
  const frames = data.length / block;
  if (!frames || frames > MAX_SAMPLE_FRAMES || frames * channels * 4 > MAX_ASSET_BYTES) throw Error('Decoded sample exceeds budget');
  const arrays = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const at = i * block + c * bits / 8;
    const value = format === 3 ? data.readFloatLE(at) : data.readIntLE(at, bits / 8) / 2 ** (bits - 1);
    if (!Number.isFinite(value) || Math.abs(value) > 1) throw Error('WAV has invalid or over-range samples; inspect original before conversion');
    arrays[c][i] = value;
  }
  return { id, name, sampleRate: rate, channels: arrays.map(encodeSamples) };
}

async function run() {
  if (!command || command === 'help' || command === '--help') return console.log('Commands: schema; catalog; resource-validate --input RESOURCE; resource-pack --input DEFINITION_OR_PROJECT --out RESOURCE; resource-project --input RESOURCE --out PROJECT; resource-render --input RESOURCE --out WAV; new --name NAME [--preset ID] --out FILE; edit --input PROJECT --operations JSON --out FILE; validate --input PROJECT; render --input PROJECT --out WAV; fetch-sound --id ID --site URL --out PROJECT; fetch-recording --id ID --site URL --out RESOURCE; import-wav --audio WAV --metadata JSON --out PROJECT; instrument --manifest JSON --out PROJECT; lesson --id e01-a --out PROJECT. Outputs never overwrite files.');
  if (command === 'schema') return console.log(JSON.stringify(AUTHORING_SCHEMA, null, 2));
  if (['resource-validate','resource-pack','resource-project','resource-render'].includes(command)) {
    const bytes=await readFile(need('--input'));if(bytes.length>RESOURCE_BYTES)throw Error('Resource exceeds budget');
    const r=importResource(JSON.parse(bytes.toString('utf8')));
    if(command==='resource-validate')return console.log(JSON.stringify({valid:true,id:r.id,name:r.name,kind:r.kind,version:r.version}));
    if(command==='resource-pack')return write(need('--out'),JSON.stringify(await portableResource(r,prepare),null,2));
    const p=resourceProject(r,command==='resource-render');
    if(command==='resource-project')return save(p);
    const audio=renderProject(await prepare(p));await write(need('--out'),new Uint8Array(encodeWav(audio)));
    return console.log(JSON.stringify({peak:audio.peak,rms:audio.rms,listeningVerified:false}));
  }
  if (command === 'catalog') return console.log(JSON.stringify({ presets: PRESETS.map(p => ({ id: p.id, duration: p.duration })), sounds: catalog.sounds.map(({ waveform, ...s }) => s), recordings: catalog.recordings }));
  if (command === 'new') {
    if (options['--preset'] && !PRESETS.some(p => p.id === options['--preset'])) throw Error('Unknown preset');
    return save(options['--preset'] ? fromPreset(options['--preset'], options['--name'] || 'Sound', k => k) : makeProject(options['--name'] || 'Sound'));
  }
  if (command === 'edit') return save(applyEdits(await input(), await json(need('--operations'))));
  if (command === 'validate') {
    const p = await input();
    return console.log(JSON.stringify({ valid: true, name: p.name, duration: p.duration, instrumentIssues: projectScoreIssues(p) }));
  }
  if (command === 'render') {
    const p = await input(), audio = renderProject(await prepare(p)), wav = new Uint8Array(encodeWav(audio));
    await write(need('--out'), wav);
    return console.log(JSON.stringify({ peak: audio.peak, rms: audio.rms, sourcePeak: audio.sourcePeak, gainReduction: audio.gainReduction, tailLimited: audio.tailLimited, duration: audio.left.length / audio.sampleRate, sha256: createHash('sha256').update(wav).digest('hex'), listeningVerified: false }));
  }
  if (command === 'fetch-recording') {
    const site = new URL(need('--site'));
    if (!['https:', 'http:'].includes(site.protocol)) throw Error('Use an explicit HTTP(S) editor URL');
    site.pathname = site.pathname.replace(/\/?$/, '/'); site.search = ''; site.hash = '';
    const loader = createBuiltinRecordingLoader(undefined, url => fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' }), site.href);
    const resource = await loader(need('--id').replace(/^recording:/, ''));
    await write(need('--out'), JSON.stringify(resource, null, 2) + '\n');
    return console.log(JSON.stringify({ id: resource.id, version: resource.version, kind: resource.kind, listeningVerified: false }));
  }
  if (command === 'fetch-sound') {
    const entry = catalog.sounds.find(s => s.id === need('--id').replace(/^builtin:/, '')); if (!entry) throw Error('Unknown factory sound');
    const site = new URL(need('--site')); if (!['https:', 'http:'].includes(site.protocol)) throw Error('Use an explicit HTTP(S) editor URL');
    site.pathname = site.pathname.replace(/\/?$/, '/'); site.search = ''; site.hash = '';
    const url = new URL(`sound-library/${entry.file}`, site);
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok || !response.body) throw Error(`Sound download failed: ${response.status}`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > entry.compressedBytes) throw Error('Sound exceeds catalog budget'); chunks.push(item.value); } } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== entry.compressedBytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('Catalog version or checksum mismatch; update the skill');
    return save(parseProject(JSON.parse(gunzipSync(bytes, { maxOutputLength: entry.projectBytes }).toString('utf8'))));
  }
  if (command === 'import-wav') {
    const meta = await json(need('--metadata'));
    const asset = { ...decodePCM(await readFile(need('--audio')), meta.name || 'Sample', 'sample-1'), source: validateSampleSource(meta.source) };
    const project = makeProject(asset.name); project.assets[asset.id] = asset;
    const seconds = Buffer.from(asset.channels[0], 'base64').length / 4 / asset.sampleRate;
    project.duration = Math.max(0.1, seconds);
    project.inputs = [makeLayer({ id: 'sample-layer', name: asset.name, type: 'sample', assetId: asset.id, duration: seconds, frequency: 440, endFrequency: 440, decay: 0, attack: 0.002, release: 0.02 })];
    return save(project);
  }
  if (command === 'instrument') {
    const manifest = await json(need('--manifest'));
    if (manifest.schema !== 'momo.soundforge.instrument-input/v1' || !Array.isArray(manifest.regions) || !manifest.regions.length || manifest.regions.length > 64) throw Error('Invalid instrument manifest');
    const p = makeProject(manifest.name), regions = []; let bytes = 0;
    for (let i = 0; i < manifest.regions.length; i++) {
      const { file, source, ...region } = manifest.regions[i];
      const id = `sample-${i}`, asset = { ...decodePCM(await readFile(resolve(dirname(need('--manifest')), file)), `${manifest.name} ${i + 1}`, id), source: validateSampleSource(source) };
      bytes += asset.channels.reduce((sum, c) => sum + Buffer.from(c, 'base64').length, 0); if (bytes > MAX_ASSET_BYTES) throw Error('Instrument exceeds asset budget');
      p.assets[id] = asset;
      regions.push({ velocityLow: 1, velocityHigh: 127, roundRobin: 0, tuneCents: 0, gainDb: 0, releaseSeconds: 0.1, ...region, id: `region-${i}`, assetId: id });
    }
    p.duration = manifest.duration ?? 10;
    p.inputs = [makeLayer({ id: 'instrument-layer', name: manifest.name, type: 'instrument', duration: p.duration, gain: 0.8, decay: 0, attack: 0, release: 0,
      score: { schema: 'momo.score/v1', bpm: manifest.bpm ?? 120, instruments: [{ id: manifest.instrumentId, name: manifest.name, regions }], notes: manifest.notes ?? [] } })];
    return save(p);
  }
  if (command === 'lesson') {
    const bank = await json(join(dirname(fileURLToPath(import.meta.url)), '../assets/lesson-recipes.json'));
    const recipe = bank.recipes.find((r: { id: string }) => r.id === need('--id')); if (!recipe) throw Error('Unknown lesson');
    const p = makeProject(recipe.name); p.duration = recipe.durationSeconds; p.seed = bank.renderSettings.seed;
    const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
    p.inputs = recipe.notes.map((n: any, i: number) => makeLayer({ id: `${recipe.id}-${i}`, name: `MIDI ${n.midi}`, start: n.startSeconds, duration: n.durationSeconds, wave: n.wave ?? bank.renderSettings.defaultWave,
      frequency: hz(n.midi), endFrequency: hz(n.endMidi ?? n.midi), gain: 0.35 * n.velocity / 127, attack: n.attackSeconds ?? Math.min(bank.renderSettings.defaultAttackSeconds, n.durationSeconds * 0.2),
      release: Math.min(bank.renderSettings.defaultReleaseSeconds, n.durationSeconds * 0.3), decay: n.decay ?? bank.renderSettings.defaultDecay, cutoff: bank.renderSettings.cutoffHz }));
    const initial = renderProject(parseProject(p)); p.master = Math.min(1.5, bank.renderSettings.targetPeak / Math.max(1e-9, initial.peak));
    return save(p);
  }
  throw Error('Unknown command. Run help.');
}
await run().catch(error => { console.error(error.message); process.exitCode = 1; });
