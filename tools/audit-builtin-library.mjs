import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { standaloneBoostDb } from './builtin-levels.mjs';

// Check actual engine output, not just thumbnail amplitudes. Short windows avoid
// treating a naturally long percussion tail as a nearly silent recording.
export function levels(channels, sampleRate) {
  let peak = 0, sum = 0, activeRms = 0, clipped = 0;
  const frames = channels[0].length, window = Math.max(1, Math.round(sampleRate * .1));
  for (let start = 0; start < frames; start += window) {
    const end = Math.min(frames, start + window);
    for (const channel of channels) {
      let squares = 0;
      for (let i = start; i < end; i++) {
        const x = channel[i];
        if (!Number.isFinite(x)) throw Error('Non-finite audio');
        peak = Math.max(peak, Math.abs(x)); squares += x * x;
        if (Math.abs(x) >= .9999) clipped++;
      }
      sum += squares;
      activeRms = Math.max(activeRms, Math.sqrt(squares / (end - start)));
    }
  }
  const db = x => x > 0 ? Number((20 * Math.log10(x)).toFixed(2)) : null;
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(1, frames * channels.length))),
    activeRmsDb: db(activeRms), clippedSamples: clipped,
    status: peak === 0 ? 'silent' : peak < 10 ** (-36 / 20) || activeRms < 10 ** (-42 / 20) ? 'quiet' : 'ok' };
}

async function audit() {
  const catalog = JSON.parse(await readFile('src/data/builtin-catalog.json', 'utf8'));
  const destination = process.argv[2] ?? 'test-results/builtin-audit.json';
  const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  const entries = [], recordings = new Map();
  try {
    const { parseProject, decodeSamples } = await server.ssrLoadModule('/src/model.ts');
    const { renderProject } = await server.ssrLoadModule('/src/engine.ts');
    const { createSamplePreparer } = await server.ssrLoadModule('/src/prepareSamples.ts');
    const {openResourceGraph}=await server.ssrLoadModule('/src/resourceGraph.ts');
    const {resourceProject}=await server.ssrLoadModule('/src/soundResources.ts');
    const prepare = createSamplePreparer(async url => new Response(await readFile(`public/sound-library/${path.basename(url)}`)), '/');
    for (const sound of catalog.sounds) {
      const bytes = await readFile(`public/sound-library/${sound.file}`);
      if (createHash('sha256').update(bytes).digest('hex') !== sound.sha256) throw Error(`Checksum: ${sound.id}`);
      const project = await prepare(resourceProject((await openResourceGraph(JSON.parse(gunzipSync(bytes)))).resource));
      const rendered = renderProject(project);
      const entry = { id: sound.id, kind: sound.kind, ...levels([rendered.left, rendered.right], rendered.sampleRate),
        sourcePeakDb: rendered.sourcePeak > 0 ? Number((20 * Math.log10(rendered.sourcePeak)).toFixed(2)) : null };
      if (sound.kind === 'instrument' && !sound.tone && !sound.completeInstrument && entry.status === 'ok' && standaloneBoostDb(entry) > .1)
        entry.status = 'quiet-default';
      entries.push(entry);
      const visit = p => {
        for (const asset of Object.values(p.assets)) {
          if (!asset.channels.length) continue; // Unplayed references are covered by source/coverage audits.
          const digest = createHash('sha256').update(asset.channels.join(':')).digest('hex');
          if (!recordings.has(digest)) recordings.set(digest, { name: asset.name, ...levels(asset.channels.map(decodeSamples), asset.sampleRate) });
        }
        for (const layer of p.inputs) if (layer.player.type === 'composition' && layer.player.mix) visit(layer.player.mix);
      };
      visit(project);
      if (entries.length % 25 === 0) console.log(`Audited ${entries.length}/${catalog.sounds.length}`);
    }
    const raw = [...recordings.values()];
    const report = { schema: 'momo.library-audit/v1', thresholds: { peakDb: -36, active100msRmsDb: -42,
      standaloneActive100msRmsTargetDb: -20, standalonePeakCeilingDb: -6 },
      entryCount: entries.length, uniqueEmbeddedRecordings: raw.length,
      issues: entries.filter(e => e.status !== 'ok'), silentRecordings: raw.filter(e => e.status === 'silent'),
      // Raw weak inputs are informational: region gain and note velocity determine playback.
      quietRawRecordings: raw.filter(e => e.status === 'quiet'), entries };
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ entryCount: report.entryCount, uniqueEmbeddedRecordings: raw.length,
      issues: report.issues, silentRecordings: report.silentRecordings.length, quietRawRecordings: report.quietRawRecordings.length, report: destination }, null, 2));
    if (report.issues.length || report.silentRecordings.length) process.exitCode = 1;
  } finally { await server.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await audit();
