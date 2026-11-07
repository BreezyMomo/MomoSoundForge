import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { assetResolver } from './sound-asset-store.mjs';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { createServer } from 'vite';
import { collections, reportDestination } from './inventory-sound-assets.mjs';
import { recordingId } from './builtin-instruments.mjs';
import { sourceRegionId } from './builtin-velocity-regions.mjs';
import { compareEmbedded, mappingCoverage, measure, pcmHash, representativeRegions, sha256, workingPcm } from './audio-audit-core.mjs';

const args = process.argv.slice(2);
const resolveAsset = await assetResolver(process.cwd(), {profile:'audit'});
const output = reportDestination(args.find(a => !a.startsWith('--')) ?? 'test-results/source-review');
const writeAudio = args.includes('--write-audio');
if (args.some(a => a.startsWith('--') && a !== '--write-audio')) throw Error('Unknown argument');
await mkdir(output, { recursive: true });
const sourceCollections = await collections();
const catalogBytes = await readFile('src/data/builtin-catalog.json');
const catalog = JSON.parse(catalogBytes);
const sourceByAsset = new Map(), sourceByRegion = new Map(), sourceGroups = [];
const representatives = new Set();
for (const collection of sourceCollections) {
  for (const sample of collection.manifest.samples) {
    const record = { collection: collection.name, base: collection.base, sample };
    sourceByRegion.set(sample.id, record);
    for (const id of [sample.id, ...(sample.sourcePath ? [recordingId(sample)] : [])]) {
      const group = sourceByAsset.get(id) ?? [];
      group.push(record); sourceByAsset.set(id, group);
    }
  }
  const instruments = collection.manifest.samples.filter(s => s.instrumentId);
  for (const [instrumentId, group] of Map.groupBy(instruments, s => s.instrumentId)) {
    for (const selection of representativeRegions(group.map(s => ({ ...s, rootMidi: s.rootMidi ?? 60 })))) representatives.add(selection.regionId);
    sourceGroups.push({ collection: collection.name, instrumentId, regions: group.length,
      recordings: new Set(group.map(s => s.wavSha256)).size, articulations: [...new Set(group.map(s => s.articulation))],
      sourceRoots: [...new Set(group.filter(s => s.rootMidi !== null).map(s => s.rootMidi))].sort((a, b) => a - b),
      sourceVelocityBands: [...new Set(group.map(s => `${s.velocityLow}-${s.velocityHigh}`))],
      fullWorkingDecodedBytes: [...new Map(group.map(s => [s.wavFile, s])).values()].reduce((n, s) => n + Math.round(s.durationSeconds * 48000) * 8, 0),
      subjectiveAudition: 'pending' });
  }
}

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
const entries = [], embedded = [], comparisons = [], failures = [];
const measuredAssets = new Map(), workingCache = new Map(), seenEmbedded = new Set();
const runtimeFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'tools', 'package-lock.json'], { encoding: 'utf8' }).trim().split('\n').sort();
const sourceFingerprint = sha256(JSON.stringify(await Promise.all(runtimeFiles.map(async name => [name, sha256(await readFile(name))]))));
try {
  const { parseProject, projectDocument, makeLayer, decodeSamples } = await server.ssrLoadModule('/src/model.ts');
  const { renderProject, encodeWav } = await server.ssrLoadModule('/src/engine.ts');
  const { createSamplePreparer } = await server.ssrLoadModule('/src/prepareSamples.ts');
  const prepare = createSamplePreparer(async url => new Response(await readFile(`public/sound-library/${path.basename(url)}`)), '/');
  const { sampleFrames } = await server.ssrLoadModule('/src/sampleReference.ts');
  const { selectRegion, renderScore, scoreIssues, noteEndSeconds } = await server.ssrLoadModule('/src/instruments.ts');
  const { recordingProject } = await server.ssrLoadModule('/src/recordingDefinition.ts');
  const { resourceFromDefinition } = await server.ssrLoadModule('/src/soundResources.ts');
  const { recordingResource } = await server.ssrLoadModule('/src/recordingSources.ts');
  const summarizeRender = audio => ({ ...measure([audio.left, audio.right], audio.sampleRate), sourcePeak: audio.sourcePeak,
    gainReduction: audio.gainReduction, wavSha256: sha256(Buffer.from(encodeWav(audio))) });
  async function saveAudio(name, channels, rate) {
    if (!writeAudio) return undefined;
    await mkdir(path.join(output, 'audio'), { recursive: true });
    // Audition copies use PCM16 export, with no gain normalization. Raw metrics/hash
    // are recorded separately because export quantization changes PCM identity.
    const file = `audio/${name}.wav`;
    await writeFile(path.join(output, file), Buffer.from(encodeWav({ left: channels[0], right: channels[1] ?? channels[0], sampleRate: rate })));
    return file;
  }
  async function inspectAssets(project, soundId, location = '') {
    for (const [assetId, asset] of Object.entries(project.assets)) {
      if (!asset.channels.length) continue; // Unused references remain in mapping/source coverage, not embedded PCM statistics.
      const key = sha256(JSON.stringify([asset.sampleRate, asset.channels]));
      let metrics = measuredAssets.get(key);
      if (!metrics) { metrics = measure(asset.channels.map(decodeSamples), asset.sampleRate); measuredAssets.set(key, metrics); }
      const identity = `${soundId}:${location}:${assetId}`;
      if (seenEmbedded.has(identity)) continue;
      seenEmbedded.add(identity);
      // Old demos use explicit "<region ID>-prefix-<frame count>" identities.
      // Treat this only as a trace candidate; PCM comparison still proves it.
      const sourceId = assetId.replace(/-prefix-\d+$/, '');
      const candidates = sourceByAsset.get(sourceId) ?? [];
      const preferred = candidates.filter(s => soundId.startsWith('tone-') || soundId.startsWith('example-expanded-')
        ? s.collection.startsWith('orchestra-expanded') : soundId.startsWith('instrument-') ? s.collection.startsWith('orchestra-basics') : true);
      const sources = preferred.length ? preferred : candidates;
      const checks = [];
      for (const source of [...new Map(sources.map(s => [`${s.base}/${s.sample.wavFile}`, s])).values()]) {
        const workingPath = `${source.base}/${source.sample.wavFile}`;
        let working = workingCache.get(workingPath);
        if (!working) {
          const bytes = await readFile(resolveAsset(workingPath));
          if (sha256(bytes) !== source.sample.wavSha256) throw Error(`Source hash mismatch: ${workingPath}`);
          working = workingPcm(bytes);
          // Bounded cache; the full orchestra should not stay decoded in memory.
          if (workingCache.size > 12) workingCache.clear();
          workingCache.set(workingPath, working);
        }
        const comparison = asset.sampleRate === 48000 ? compareEmbedded(working, asset.channels.map(decodeSamples), 48000)
          : { comparable: false, reason: 'sample-rate' };
        checks.push({ workingPath, regionIds: sources.filter(s => s.sample.wavFile === source.sample.wavFile).map(s => s.sample.id), ...comparison });
      }
      embedded.push({ soundId, location, assetId, name: asset.name, ...metrics, sources: checks,
        traceStatus: checks.some(c => c.prefixMatchesWithGain) ? 'verified-working-prefix-with-reported-gain'
          : checks.length ? 'identity-found-content-needs-review' : 'needs-source-trace', subjectiveAudition: 'pending' });
    }
    for (const input of project.inputs) if (input.player.type === 'composition' && input.player.mix)
      await inspectAssets(input.player.mix, soundId, `${location}/${input.id}`);
  }

  for (const sound of catalog.sounds) {
    try {
      const bytes = await readFile(`public/sound-library/${sound.file}`);
      if (sha256(bytes) !== sound.sha256) throw Error('Generated package hash mismatch');
      const project = await prepare(parseProject(JSON.parse(gunzipSync(bytes))));
      const rendered = renderProject(project);
      const entry = { id: sound.id, kind: sound.kind, packageSha256: sound.sha256, projectSha256: sha256(JSON.stringify(projectDocument(project))),
        render: summarizeRender(rendered), instruments: [], subjectiveAudition: 'pending' };
      if (entry.render.status === 'silent') failures.push({ id: sound.id, error: 'Silent default render' });
      await inspectAssets(project, sound.id);
      const collectInstruments = (p, location = '') => {
        for (const input of p.inputs) {
          if (input.player.type === 'instrument') for (const instrument of input.player.score.instruments)
            entry.instruments.push({ location: `${location}/${input.id}`, instrumentId: instrument.id, regionCount: instrument.regions.length,
              mappingSha256: sha256(JSON.stringify(instrument)), coverage: mappingCoverage(instrument, selectRegion),
              currentNotes: scoreIssues(input.player.score, p.assets, input.player.duration, input.player.noiseSeed),
              placement: { start: input.start, duration: input.duration, sourceStart: input.sourceStart, sourceEnd: input.sourceEnd, speed: input.speed,
                loop: input.loop, gain: input.gain, playerLevel: input.player.level } });
          if (input.player.type === 'composition' && input.player.mix) collectInstruments(input.player.mix, `${location}/${input.id}`);
        }
      };
      collectInstruments(project);
      entries.push(entry);
      if (sound.kind === 'instrument') {
        const input = project.inputs[0], instrument = input.player.score.instruments[0];
        for (const region of instrument.regions.filter(r => representatives.has(sourceRegionId(r.id)))) {
          const source = sourceByRegion.get(sourceRegionId(region.id));
          const asset = project.assets[region.assetId];
          const caseId = sha256(`${sound.id}:${region.id}`).slice(0, 20);
          const midi = Math.max(region.keyLow, Math.min(region.rootMidi, region.keyHigh));
          const velocity = Math.round((region.velocityLow + region.velocityHigh) / 2);
          const rate = 2 ** (((region.fixedPitch ? 0 : midi - region.rootMidi) + region.tuneCents / 100) / 12);
          const available = (sampleFrames(asset) - (region.sampleOffset ?? 0)) / asset.sampleRate / rate;
          const performance = [];
          const isolated = { ...instrument, regions: [region] };
          for (const held of [...new Set([.08, .6, Math.min(29, available + .25)])]) {
            const note = { id: 'audit-note', instrumentId: instrument.id, midi, velocity, articulation: region.articulation, start: 0, duration: held * 2 };
            const score = { schema: 'momo.score/v1', bpm: 120, instruments: [isolated], notes: [note] };
            const seconds = Math.max(.1, noteEndSeconds(note, region, project.assets, 120) + .05);
            const minimal = await prepare(parseProject({ schema: 'momo.soundforge/v4', name: 'Audit', seed: 2048, duration: seconds, master: 1, echo: 0,
              assets: project.assets, inputs: [makeLayer({ id: 'audit-layer', name: 'Audit', type: 'instrument', duration: seconds, score,
                gain: 1, level: 1, attack: 0, release: 0, decay: 0, cutoff: 22000, noiseSeed: 2048 })] }));
            const neutral = renderScore(score, minimal.assets, seconds, 48000, 2048);
            const neutralMetrics = measure([neutral.left, neutral.right], 48000);
            const timeline = renderProject(minimal), exportBytes = Buffer.from(encodeWav(timeline));
            const reopened = renderProject(parseProject(projectDocument(minimal)));
            if (pcmHash([timeline.left, timeline.right], 48000) !== pcmHash([reopened.left, reopened.right], 48000))
              throw Error(`Portable roundtrip changed render: ${region.id}`);
            performance.push({ heldSeconds: held, availableSeconds: available, renderSeconds: seconds,
              minimalInstrument: neutralMetrics, timeline: summarizeRender(timeline), exportBytes: exportBytes.length,
              portableRoundtripMatches: true, scoreIssues: scoreIssues(score, project.assets, seconds, 2048),
              audio: held === .6 ? await saveAudio(`${caseId}-timeline`, [timeline.left, timeline.right], 48000) : undefined });
          }
          const definition = { schema: 'momo.instrument/v1', instrument, assets: project.assets };
          const independent = recordingResource(resourceFromDefinition(definition, `audit-${caseId}`), region.assetId, asset.name);
          const recordingReady = await prepare(recordingProject(independent.payload, asset.name));
          const channels = recordingReady.assets[asset.id].channels.map(decodeSamples);
          const recordingPreview = renderProject(recordingReady);
          comparisons.push({ caseId, soundId: sound.id, regionId: region.id, assetId: region.assetId, collection: source?.collection,
            instrumentId: source?.sample.instrumentId, articulation: region.articulation,
            original: source ? { path: `${source.base}/${source.sample.originalFile}`, sha256: source.sample.originalSha256, nativeSpeed: true } : null,
            working: source ? { path: `${source.base}/${source.sample.wavFile}`, sha256: source.sample.wavSha256 } : null,
            embedded: { ...measure(channels, asset.sampleRate), audio: await saveAudio(`${caseId}-embedded`, channels, asset.sampleRate) },
            settings: { midi, velocity, region, seed: 2048, playbackRate: rate, regionVelocityGain: velocity / 127 * 10 ** (region.gainDb / 20) },
            performance, independentRecordingPreview: { ...summarizeRender(recordingPreview),
              audio: await saveAudio(`${caseId}-recording-preview`, [recordingPreview.left, recordingPreview.right], recordingPreview.sampleRate) },
            actualLibraryDefault: { soundId: sound.id, render: entry.render },
            browserInteraction: 'not-exercised', subjectiveAudition: 'pending', disposition: 'pending', defaultAvailability: 'unchanged' });
        }
      }
    } catch (error) { failures.push({ id: sound.id, error: String(error.stack ?? error) }); }
    if ((entries.length + failures.length) % 25 === 0) console.log(`Checked ${entries.length} resources; ${comparisons.length} five-stage cases; ${failures.length} failures`);
  }
  const report = { schema: 'momo.instrument-diagnosis/v1', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version, sourceFingerprint, catalogSha256: sha256(catalogBytes), sampleRate: 48000, seed: 2048,
    subjectiveAudition: 'pending', sourceGroups, entries, embedded, comparisons, failures,
    summary: { resources: entries.length, sourceInstrumentGroups: sourceGroups.length, embeddedInstances: embedded.length,
      uniqueEmbeddedPcm: new Set(embedded.map(a => a.pcmSha256)).size, representativeCases: comparisons.length,
      abbreviatedWorkingFiles: new Set(embedded.flatMap(a => a.sources.filter(s => s.removedSeconds > .001).map(s => s.workingPath))).size,
      unmappedEmbeddedInstances: embedded.filter(a => !a.sources.length).length,
      mappingCells: entries.flatMap(e => e.instruments).reduce((n, i) => n + i.coverage.testedCells, 0),
      selectorFailures: entries.flatMap(e => e.instruments).flatMap(i => i.coverage.failures).length,
      renderFailures: failures.length },
    limitations: ['No subjective listening or browser interaction certification.', 'Source decoding report is separate (sources.json).',
      'No automatic pitch correction, gain normalization, isolation or source deletion.',
      'Representatives cover active low/middle/high roots and available velocity bands, not all possible rendered notes.',
      'Unused lazy references are excluded from embedded PCM statistics; referenced representative recordings are resolved in full.',
      'PCM16 audition exports may clip an overloaded stage; raw peak and limiter gain remain in the report.'] };
  await writeFile(path.join(output, 'instruments.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
  if (failures.length || report.summary.selectorFailures) process.exitCode = 1;
} finally { await server.close(); }
