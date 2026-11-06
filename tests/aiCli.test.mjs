import { beforeAll, afterAll, it, expect } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

let root, cli;
const exec = promisify(execFile);
const run = (...args) => exec(process.execPath, [cli, ...args], { cwd: root, timeout: 15000 });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'soundforge-ai-test-'));
  cli = join(root, 'scripts/cli.mjs');
  await mkdir(join(root, 'assets'));
  await copyFile('skills/momo-sound-forge/assets/lesson-recipes.json', join(root, 'assets/lesson-recipes.json'));
  await build({ entryPoints: [resolve('tools/ai-cli.ts')], outfile: cli, bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['@ffmpeg/*'] });
});
afterAll(async () => { if (root && root.startsWith(join(tmpdir(), 'soundforge-ai-test-'))) await rm(root, { recursive: true, force: true }); });

it('runs outside the repository, renders deterministically and refuses to overwrite', async () => {
  await run('new', '--preset', 'pickup', '--out', 'a.soundforge');
  await expect(run('new', '--out', 'a.soundforge')).rejects.toThrow();
  await run('render', '--input', 'a.soundforge', '--out', 'a.wav');
  await run('render', '--input', 'a.soundforge', '--out', 'b.wav');
  expect(await readFile(join(root, 'a.wav'))).toEqual(await readFile(join(root, 'b.wav')));
  expect(JSON.parse((await run('validate', '--input', 'a.soundforge')).stdout).valid).toBe(true);
});

it('imports PCM with provenance and diagnoses uncovered instrument notes', async () => {
  await run('new', '--preset', 'pickup', '--out', 'source.soundforge');
  await run('render', '--input', 'source.soundforge', '--out', 'source.wav');
  const source = { provider: 'Test', url: 'https://example.org/sample', author: 'Tester', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', quality: 'original', retrievedAt: '2026-11-05T00:00:00Z' };
  await writeFile(join(root, 'metadata.json'), JSON.stringify({ name: 'Fixture', source }));
  await run('import-wav', '--audio', 'source.wav', '--metadata', 'metadata.json', '--out', 'sample.soundforge');
  const sample = JSON.parse(await readFile(join(root, 'sample.soundforge'), 'utf8'));
  expect(Object.values(sample.root.mix.assets)[0].source).toEqual(source);
  await writeFile(join(root, 'instrument.json'), JSON.stringify({ schema: 'momo.soundforge.instrument-input/v1', name: 'Test instrument', instrumentId: 'test', duration: 2, bpm: 120,
    regions: [{ file: 'source.wav', rootMidi: 60, keyLow: 60, keyHigh: 60, articulation: 'sustain', source }],
    notes: [{ id: 'n1', instrumentId: 'test', midi: 61, start: 0, duration: 1, velocity: 80, articulation: 'sustain' }] }));
  await run('instrument', '--manifest', 'instrument.json', '--out', 'instrument.soundforge');
  const result = JSON.parse((await run('validate', '--input', 'instrument.soundforge')).stdout);
  expect(result.instrumentIssues.some(i => i.noteId === 'n1')).toBe(true);
});

it('builds every included original lesson recipe as a valid native project', async () => {
  const bank = JSON.parse(await readFile(join(root, 'assets/lesson-recipes.json'), 'utf8'));
  for (const recipe of bank.recipes) {
    await run('lesson', '--id', recipe.id, '--out', `${recipe.id}.soundforge`);
    const p = JSON.parse(await readFile(join(root, `${recipe.id}.soundforge`), 'utf8'));
    expect(p.root.mix.inputs.length).toBe(recipe.notes.length);
  }
}, 30000);

it('packages an AI-authored algorithm outside the repository and preserves it through native projects', async () => {
  const schema=JSON.parse((await run('schema')).stdout),synth=schema.resources.synth;
  await writeFile(join(root,'custom.sfsynth'),JSON.stringify(synth));
  expect(JSON.parse((await run('resource-validate','--input','custom.sfsynth')).stdout).valid).toBe(true);
  await run('resource-pack','--input','custom.sfsynth','--out','custom.sfresource');
  await run('resource-render','--input','custom.sfresource','--out','custom-preview.wav');
  await run('resource-project','--input','custom.sfresource','--out','custom.soundforge');
  await run('render','--input','custom.soundforge','--out','custom-native.wav');
  expect(await readFile(join(root,'custom-preview.wav'))).toEqual(await readFile(join(root,'custom-native.wav')));
  const project=JSON.parse(await readFile(join(root,'custom.soundforge'),'utf8'));
  expect(project.root.mix.inputs[0].player.synth.program.expression).toBe(synth.program.expression);
  await expect(run('resource-pack','--input','custom.sfsynth','--out','custom.sfresource')).rejects.toThrow();
  synth.program.expression='globalThis.process.exit(0)';await writeFile(join(root,'invalid.sfsynth'),JSON.stringify(synth));
  await expect(run('resource-validate','--input','invalid.sfsynth')).rejects.toThrow();
});
