import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { reportDestination } from './inventory-sound-assets.mjs';
import { sha256 } from './audio-audit-core.mjs';

const args = process.argv.slice(2);
let output = 'test-results/source-review', python = process.env.SOUNDFORGE_AUDIT_PYTHON ?? 'python', audio = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) output = args[++i];
  else if (args[i] === '--python' && args[i + 1]) python = args[++i];
  else if (args[i] === '--write-audio') audio = true;
  else throw Error('Usage: npm run audit:sources -- [--output DIRECTORY] [--python PYTHON] [--write-audio]');
}
output = reportDestination(output);
await mkdir(output, { recursive: true });
const commands = [
  [process.execPath, ['tools/inventory-sound-assets.mjs', output]],
  [python, ['tools/audit-source-audio.py', '--output', path.join(output, 'sources.json')]],
  [process.execPath, ['tools/diagnose-instruments.mjs', output, ...(audio ? ['--write-audio'] : [])]],
];
const results = [];
for (const [executable, argv] of commands) {
  console.log(`Running ${path.basename(executable)} ${argv[0]}`);
  const result = await new Promise(resolve => {
    const child = spawn(executable, argv, { stdio: 'inherit' });
    child.on('error', error => resolve({ code: -1, error: error.message }));
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  results.push({ tool: argv[0], ...result });
  if (result.code !== 0) {
    await writeFile(path.join(output, 'run.json'), JSON.stringify({ results, status: 'failed' }, null, 2) + '\n');
    console.error('Audit failed. No source files were changed. Python dependencies: tools/audio-audit-requirements.txt.');
    process.exitCode = 1; break;
  }
}
if (!process.exitCode) {
  const source = JSON.parse(await readFile(path.join(output, 'sources.json'), 'utf8'));
  const instruments = JSON.parse(await readFile(path.join(output, 'instruments.json'), 'utf8'));
  const generated = instruments.entries.flatMap(e => e.instruments.map(i => ({ soundId: e.id, ...i })));
  const disposition = source.records.map(r => ({ collection: r.collection, id: r.id, disposition: r.disposition,
    technicalStatus: r.technicalStatus, provenanceStatus: r.provenanceStatus, subjectiveAudition: 'pending',
    defaultAvailability: r.existingQuarantine ? 'excluded-existing' : 'unchanged',
    reason: r.existingQuarantine ? 'Existing quarantine retained; not a new listening decision' : 'Technical review does not certify timbre; source retained' }));
  const index = { schema: 'momo.source-review/v1', commit: instruments.commit, status: 'technical-pass-subjective-pending',
    sourceRecords: source.records.length, uniqueFiles: source.files.length, decodeFailures: source.failures.length,
    provenanceGaps: source.records.filter(r => r.provenanceGaps.length).length,
    conversionChecks: source.conversions.length, conversionMismatches: source.conversions.filter(c => !c.matches).length,
    ...instruments.summary, sourceGroups: instruments.sourceGroups,
    mappingReview: generated.filter(i => i.coverage.unreachedRegions.length).map(i => ({ soundId: i.soundId, regionIds: i.coverage.unreachedRegions })),
    disposition, results, reportHashes: Object.fromEntries(await Promise.all(['inventory.json', 'sources.json', 'instruments.json'].map(async name => [name, sha256(await readFile(path.join(output, name)))]))) };
  await writeFile(path.join(output, 'review.json'), JSON.stringify(index, null, 2) + '\n');
  await writeFile(path.join(output, 'run.json'), JSON.stringify({ results, status: 'completed', subjectiveAudition: 'pending' }, null, 2) + '\n');
  console.log(JSON.stringify({ report: path.join(output, 'review.json'), resources: index.resources, cases: index.representativeCases, provenanceGaps: index.provenanceGaps, subjectiveAudition: 'pending' }));
}
