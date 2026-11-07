import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stageDistribution, finishDistribution, verifyRemoteFiles, verifyStagedDistribution } from '../tools/sound-distribution.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sound-distribution-test-'));
  const bytes = Buffer.from('verified sound bytes'), sha256 = hash(bytes), file = `${sha256}.recording.bin`;
  const raw = JSON.stringify({ sounds: [], recordings: [{ id: 'r', file, sha256, compressedBytes: bytes.length }] });
  for (const dir of ['public/sound-library/licenses', 'public/ai', 'src/data']) await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, 'src/data/builtin-catalog.json'), raw);
  await writeFile(path.join(root, 'public/sound-library', file), bytes);
  await writeFile(path.join(root, 'public/sound-library/licenses/test.txt'), 'CC0');
  await writeFile(path.join(root, 'public/ai/tool.zip'), 'AI tools');
  await writeFile(path.join(root, 'public/sound-library/.source-fingerprint'), JSON.stringify({ catalog: hash(raw), licenses: { 'test.txt': hash('CC0') } }));
  return { root, file, bytes };
}

it('stages verified independent resources without overwriting a release; external build retains notices and AI tools', async () => {
  const { root, file, bytes } = await fixture();
  try {
    const output = path.join(root, 'release'), manifest = await stageDistribution(output, root);
    expect(await readFile(path.join(output, file))).toEqual(bytes);
    expect(manifest.files).toHaveLength(2);
    expect((await verifyStagedDistribution(output, root)).files).toBe(2);
    await writeFile(path.join(output, 'unexpected.bin'), 'stale');
    await expect(verifyStagedDistribution(output, root)).rejects.toThrow('Unexpected');
    await expect(stageDistribution(output, root)).rejects.toThrow();
    const site = path.join(root, 'dist');
    await finishDistribution(root, site, 'https://audio.example/v1');
    expect((await readdir(path.join(site, 'sound-library'))).sort()).toEqual(['distribution.json', 'licenses']);
    expect(await readFile(path.join(site, 'ai/tool.zip'), 'utf8')).toBe('AI tools');
    expect(JSON.parse(await readFile(path.join(site, 'sound-library/distribution.json'), 'utf8')).baseUrl).toBe('https://audio.example/v1/');
    await writeFile(path.join(root, 'public/sound-library', file), 'corrupt');
    await expect(stageDistribution(path.join(root, 'bad-release'), root)).rejects.toThrow('corrupt');
    expect(await readdir(root)).not.toContain('bad-release');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each(['ok', 'cors', 'checksum', 'oversize', 'missing'])('remote validation handles %s before allowing deployment', async kind => {
  const data = Buffer.from('audio');
  const manifest = { files: [{ file: `${hash(data)}.recording.bin`, bytes: data.length, sha256: hash(data) }] };
  const fetcher = async (_url, options) => {
    expect(options.headers.Origin).toBe('https://editor.example');
    expect(options.redirect).toBe('error');
    return new Response(kind === 'oversize' ? 'too much audio' : kind === 'checksum' ? 'other' : data, {
      status: kind === 'missing' ? 404 : 200,
      headers: kind === 'cors' ? {} : { 'Access-Control-Allow-Origin': '*' },
    });
  };
  const check = verifyRemoteFiles('https://audio.example/v1/', manifest, 'https://editor.example', fetcher);
  if (kind === 'ok') await expect(check).resolves.toBeUndefined();
  else await expect(check).rejects.toThrow();
});
