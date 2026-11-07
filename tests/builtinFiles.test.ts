import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createBuiltinFileLoader } from '../src/builtinFiles';

function fixture() {
  let seed = 1234567;
  const original = Uint8Array.from({ length: 4096 }, () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed & 255;
  });
  const packed = gzipSync(original);
  const sha256 = createHash('sha256').update(packed).digest('hex');
  return { original, packed, file: {
    id: 'recording', file: `${sha256}.recording.bin`, sha256,
    compressedBytes: packed.length, decodedBytes: original.length,
  } };
}

it('loads assets when HTTP gzip makes the wire length larger than the original asset', async () => {
  const { original, packed, file } = fixture(), wire = gzipSync(packed);
  expect(wire.length).toBeGreaterThan(packed.length);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': wire.length });
    response.end(wire);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing test server address');
    const loader = createBuiltinFileLoader([file], url => fetch(url), `http://127.0.0.1:${address.port}/`);
    expect(await loader.load(file.id)).toEqual(original);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it.each(['oversized', 'corrupt'])('still rejects %s asset bodies under HTTP content encoding', async kind => {
  const { packed, file } = fixture();
  const body = kind === 'oversized' ? Buffer.concat([packed, Buffer.of(0)]) : Buffer.from(packed);
  if (kind === 'corrupt') body[body.length - 1] ^= 1;
  // Fetch exposes the HTTP-decoded body while retaining the encoded wire headers.
  const loader = createBuiltinFileLoader([file], async () => new Response(body, {
    headers: { 'Content-Encoding': 'gzip', 'Content-Length': String(body.length + 30) },
  }), '/');
  await expect(loader.load(file.id)).rejects.toThrow('library.builtinLoadError');
});

it('accepts decoded cross-origin bytes when CORS hides Content-Encoding but exposes wire length', async () => {
  const { original, packed, file } = fixture();
  const loader = createBuiltinFileLoader([file], async () => new Response(packed, {
    headers: { 'Content-Length': String(packed.length + 30) },
  }), '/', 'https://audio.example/v1/');
  expect(await loader.load(file.id)).toEqual(original);
});
