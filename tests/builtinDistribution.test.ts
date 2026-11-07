import { expect, it, vi, afterEach } from 'vitest';
import { normalizeLibraryUrl, distributionDescriptor, createPublishedLibraryFetcher } from '../src/builtinDistribution.mjs';
import { createBuiltinFileLoader } from '../src/builtinFiles';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

afterEach(() => vi.unstubAllEnvs());
const filename = `${'a'.repeat(64)}.recording.bin`;

it('accepts a versioned HTTPS prefix and loopback checks, rejects unsafe deployment URLs', () => {
  expect(normalizeLibraryUrl('https://audio.example/v1')).toBe('https://audio.example/v1/');
  expect(normalizeLibraryUrl('http://127.0.0.1:5209/v1/')).toBe('http://127.0.0.1:5209/v1/');
  for (const url of ['http://audio.example/', '//audio.example/', 'file:///tmp/', 'https://u:p@audio.example/', 'https://audio.example/?token=a', 'https://audio.example/#x'])
    expect(() => normalizeLibraryUrl(url)).toThrow();
});

it('routes the shared bounded loader to the external prefix and retains integrity checks', async () => {
  const data = Buffer.from('sound data'), packed = gzipSync(data), sha256 = createHash('sha256').update(packed).digest('hex');
  const entry = { id: 'x', file: `${sha256}.recording.bin`, sha256, compressedBytes: packed.length, decodedBytes: data.length };
  const fetcher = vi.fn(async () => new Response(packed));
  vi.stubEnv('VITE_SOUND_LIBRARY_URL', 'https://audio.example/v1');
  const loader = createBuiltinFileLoader([entry], fetcher, '/editor/');
  expect(Buffer.from(await loader.load('x'))).toEqual(data);
  expect(fetcher).toHaveBeenCalledWith(`https://audio.example/v1/${entry.file}`);
  const corrupt = Buffer.from(packed); corrupt[corrupt.length - 1] ^= 1;
  await expect(createBuiltinFileLoader([entry], async () => new Response(corrupt), '/').load('x')).rejects.toThrow();
});

it('AI tools discover the deployed prefix once and preserve hashed filenames', async () => {
  const fetcher = vi.fn(async (url: string) => url.endsWith('distribution.json')
    ? Response.json(distributionDescriptor('https://audio.example/v1/')) : new Response('asset'));
  const download = createPublishedLibraryFetcher('https://editor.example/nested/', fetcher);
  await Promise.all([download(`https://editor.example/nested/sound-library/${filename}`), download(`sound-library/${filename}`)]);
  expect(fetcher.mock.calls.map(c => c[0])).toEqual([
    'https://editor.example/nested/sound-library/distribution.json',
    `https://audio.example/v1/${filename}`, `https://audio.example/v1/${filename}`,
  ]);
  await expect(download('https://other.example/private')).rejects.toThrow();
});

it('requires a current descriptor and retries failed discovery', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(Response.json(distributionDescriptor())).mockResolvedValue(new Response('asset'));
  const download = createPublishedLibraryFetcher('https://editor.example/nested', fetcher);
  await expect(download(`sound-library/${filename}`)).rejects.toThrow();
  await expect(download(`sound-library/${filename}`)).rejects.toThrow();
  await download(`sound-library/${filename}`);
  expect(fetcher).toHaveBeenLastCalledWith(`https://editor.example/nested/sound-library/${filename}`);
});

it.each([
  'x'.repeat(4097), JSON.stringify({ schema: 'future', mode: 'local', baseUrl: null }),
  JSON.stringify({ schema: 'momo.sound-distribution/v1', mode: 'external', baseUrl: 'file:///x' }),
])('rejects invalid discovery without attempting audio downloads', async body => {
  const fetcher = vi.fn(async () => new Response(body));
  await expect(createPublishedLibraryFetcher('https://editor.example/', fetcher)(`sound-library/${filename}`)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
