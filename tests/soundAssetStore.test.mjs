import { it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { LOCK_SCHEMA, writePack, validateLock, verify, sync, status, sha256, manifestBytes, fileDigest, packDirectory, assetFile } from '../tools/sound-asset-store.mjs';

const roots = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sound-assets-test-')); roots.push(root);
  await mkdir(path.join(root, 'samples/test'), {recursive:true});
  await writeFile(path.join(root, 'samples/test/first.wav'), 'first complete recording');
  await writeFile(path.join(root, 'samples/test/empty.wav'), '');
  const destination = path.join(root, 'packs'), cache = path.join(root, 'cache');
  const pack = await writePack(root, ['samples/test/first.wav', 'samples/test/empty.wav'], destination, 'build-001', 'build', 'test-1');
  const lock = {schema:LOCK_SCHEMA,packs:[pack]};
  return {root,destination,cache,pack,lock};
}

it('restores deterministic packages offline and detects same-size cache corruption', async () => {
  const f = await fixture();
  const again = await writePack(f.root, f.pack.files.map(x=>x.path).reverse(), f.destination, 'build-001', 'build', 'test-1');
  expect(again).toEqual(f.pack);
  expect((await status(f.lock, f.cache))[0].status).toBe('missing');
  await sync(f.lock, f.cache, {from:f.destination}); await verify(f.lock,f.cache);
  const fromCache = await writePack(f.root, f.pack.files.map(x=>x.path), f.destination, 'build-001', 'build', 'test-1',
    name => assetFile(f.cache, f.pack, f.pack.files.findIndex(x=>x.path===name)));
  expect(fromCache).toEqual(f.pack);
  const target = assetFile(f.cache,f.pack,f.pack.files.findIndex(x=>x.path==='samples/test/first.wav'));
  expect(await readFile(target,'utf8')).toBe('first complete recording');
  await writeFile(target,'FIRST complete recording');
  expect((await status(f.lock,f.cache))[0].status).toBe('corrupt');
  await expect(verify(f.lock,f.cache)).rejects.toThrow('assets:sync');
  await sync(f.lock,f.cache,{from:f.destination}); await verify(f.lock,f.cache);
});

it('rejects traversal, duplicate/case aliases, Windows devices, file-parent collisions and altered manifests', async () => {
  const {lock} = await fixture();
  for (const name of ['../escape', 'samples/../escape', 'samples/C:/test', 'samples/aux.wav','samples/test./a','samples/a\\b','samples//a']) {
    const bad=structuredClone(lock); bad.packs[0].files[0].path=name;
    expect(()=>validateLock(bad)).toThrow();
  }
  for (const files of [
    [lock.packs[0].files[0], {...lock.packs[0].files[0],path:lock.packs[0].files[0].path.toUpperCase().replace('SAMPLES','samples')}],
    [lock.packs[0].files[0], {...lock.packs[0].files[0],path:lock.packs[0].files[0].path+'/child'}],
  ]) {
    const p={...lock.packs[0],files,expandedBytes:files.reduce((n,f)=>n+f.bytes,0),manifestSha256:sha256(manifestBytes(files))};
    expect(()=>validateLock({schema:LOCK_SCHEMA,packs:[p]})).toThrow();
  }
  const bad=structuredClone(lock); bad.packs[0].files[0].sha256='0'.repeat(64);
  expect(()=>validateLock(bad)).toThrow('manifest mismatch');
});

it('rejects truncated, tampered and over-expanded archives before replacing an existing directory', async () => {
  const f=await fixture(); await sync(f.lock,f.cache,{from:f.destination});
  const target=assetFile(f.cache,f.pack,f.pack.files.findIndex(x=>x.path==='samples/test/first.wav'));
  await writeFile(target,'existing damaged but recoverable data');
  const original = await readFile(path.join(f.destination,f.pack.file));
  await writeFile(path.join(f.destination,f.pack.file),'corrupt');
  await expect(sync(f.lock,f.cache,{from:f.destination})).rejects.toThrow('checksum');
  expect(await readFile(target,'utf8')).toBe('existing damaged but recoverable data');
  const decoded = gunzipSync(original), damaged = Buffer.from(decoded);
  damaged[damaged.length - 1] ^= 1;
  for (const body of [Buffer.from('wrong manifest'), decoded.subarray(0, -1), damaged, Buffer.concat([decoded, Buffer.from('extra')]), Buffer.alloc(100000, 0)]) {
    const bytes=gzipSync(body), p={...f.pack,sha256:sha256(bytes),bytes:bytes.length};
    p.file=`${p.id}-${p.sha256}.sfa.gz`; await writeFile(path.join(f.destination,p.file),bytes);
    await expect(sync({schema:LOCK_SCHEMA,packs:[p]},f.cache,{from:f.destination})).rejects.toThrow();
    expect((await readdir(f.cache)).some(n=>n.startsWith('.extract-')||n.startsWith('.download-'))).toBe(false);
  }
});

it('refuses junctions in cache ancestors and keeps profiles explicit', async () => {
  const f=await fixture(), outside=path.join(f.root,'outside'); await mkdir(outside);
  const link=path.join(f.root,'linked'); await symlink(outside,link,process.platform==='win32'?'junction':'dir');
  await expect(sync(f.lock,path.join(link,'cache'),{from:f.destination})).rejects.toThrow('link');
  const audit={...f.pack, id:'audit-001', sha256:'0'.repeat(64), profile:'audit', files:f.pack.files.map(file=>({...file,path:file.path.replace('/test/','/audit/')}))};
  audit.file=`${audit.id}-${audit.sha256}.sfa.gz`; audit.manifestSha256=sha256(manifestBytes(audit.files));
  const lock={schema:LOCK_SCHEMA,packs:[f.pack,audit]};
  await sync(f.lock,f.cache,{from:f.destination});
  expect(await status(lock,f.cache,'build')).toHaveLength(1);
  expect((await status(lock,f.cache,'audit')).some(r=>r.status==='missing')).toBe(true);
  await expect(verify(lock,f.cache,'audit')).rejects.toThrow('audit-001');
  await expect(sync(f.lock,path.join(f.root,'empty'))).rejects.toThrow('not published');
});

it('bounds remote downloads, retries mirrors with the same expected hash, and restores the exact bytes', async () => {
  const f=await fixture(), bytes=await readFile(path.join(f.destination,f.pack.file));
  f.pack.urls=['https://first.example/pack','https://second.example/pack'];
  const fetcher=vi.fn(async url=>{
    const response=new Response(url.includes('first')?Buffer.alloc(f.pack.bytes+1):bytes);
    Object.defineProperty(response,'url',{value:url}); return response;
  });
  vi.stubGlobal('fetch',fetcher); await sync(f.lock,f.cache); await verify(f.lock,f.cache);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await fileDigest(assetFile(f.cache,f.pack,f.pack.files.findIndex(x=>x.path==='samples/test/first.wav')))).toEqual({bytes:24,sha256:sha256(Buffer.from('first complete recording'))});
});
