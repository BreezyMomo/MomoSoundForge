import { describe, it, expect } from 'vitest';
import { startAIServer } from '../tools/ai-server.mjs';
import { createSourceSearch, parseFreesound, fetchBounded } from '../tools/ai-sources.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('AI bridge', () => {
  it('isolates page sessions, enforces origins and bearer credentials, and supports the real SDK client', async () => {
    const origin = 'http://127.0.0.1:5188', service = await startAIServer({ port: 0, origins: [origin] });
    const client = new Client({ name: 'test', version: '1' });
    try {
      expect((await fetch(service.base + '/pages/connect', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
      expect((await fetch(service.base + '/mcp', { method: 'POST' })).status).toBe(401);
      const response = await fetch(service.base + '/pages/connect', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test work' }) });
      const page = await response.json();
      await client.connect(new StreamableHTTPClientTransport(new URL(service.base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${service.token}` } } }));
      expect((await client.listTools()).tools.some(t => t.name === 'sound_render')).toBe(true);
      const invalid = await client.callTool({ name: 'sound_edit', arguments: { pageId: page.pageId, mode: 'typo', operations: [] } });
      expect(invalid.isError).toBe(true);
      expect(invalid.content[0].text).toContain('Invalid arguments');
      const list = await client.callTool({ name: 'sound_pages' });
      expect(JSON.parse(list.content[0].text).pages[0].pageId).toBe(page.pageId);
      const call = client.callTool({ name: 'sound_capture', arguments: { pageId: page.pageId } });
      const headers = { Origin: origin, Authorization: `Bearer ${page.token}`, 'Content-Type': 'application/json' };
      const poll = await fetch(`${service.base}/pages/${page.pageId}/requests`, { headers });
      const task = (await poll.json()).requests[0];
      expect(task.operation).toBe('capture');
      await fetch(`${service.base}/pages/${page.pageId}/response`, { method: 'POST', headers, body: JSON.stringify({ id: task.id, result: { snapshotId: 'one' } }) });
      expect(JSON.parse((await call).content[0].text).snapshotId).toBe('one');
      expect((await fetch(`${service.base}/pages/${page.pageId}/requests`, { headers: { ...headers, Authorization: 'Bearer wrong' } })).status).toBe(401);
      await fetch(`${service.base}/pages/${page.pageId}/disconnect`, { method: 'POST', headers, body: '{}' });
      expect(JSON.parse((await client.callTool({ name: 'sound_pages' })).content[0].text).pages).toEqual([]);
    } finally { await client.close(); await service.close(); }
  });
  it('expires unacknowledged writes and tells clients to inspect before retry', async () => {
    const origin = 'http://127.0.0.1:5188', s = await startAIServer({ port: 0, origins: [origin], taskTimeout: 30 });
    const client = new Client({ name: 'test', version: '1' });
    try {
      const page = await (await fetch(s.base + '/pages/connect', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).json();
      await client.connect(new StreamableHTTPClientTransport(new URL(s.base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
      const result = await client.callTool({ name: 'sound_edit', arguments: { pageId: page.pageId, snapshotId: 's', operations: [] } });
      expect(result.isError).toBe(true); expect(result.content[0].text).toContain('Capture actual state');
    } finally { await client.close(); await s.close(); }
  });
});

describe('source acquisition', () => {
  const fixture = `<div class="bw-search__result" data-sound-id="12" data-title="Wood &amp; click" data-username="Alice" data-duration="0.4" data-num-downloads="50" data-mp3="https://cdn.freesound.org/previews/0/12.mp3"><span title="License: Creative Commons 0"></span><span aria-label="Average rating of 4.2"></span></div>`;
  it('rejects unknown licenses and remote audio hosts, and labels previews honestly', async () => {
    expect(parseFreesound(fixture)[0].source.quality).toBe('preview');
    expect(parseFreesound(fixture)[0].name).toBe('Wood & click');
    expect(parseFreesound(fixture.replace('Creative Commons 0', 'Unknown'))).toEqual([]);
    expect(parseFreesound(fixture.replace('cdn.freesound.org', '127.0.0.1'))).toEqual([]);
    const sources = createSourceSearch(async url => new Response(String(url).includes('/search/') ? fixture : new Uint8Array([1, 2, 3])));
    await expect(sources.acquire('freesound:12', 'preview')).rejects.toThrow('Search again');
    await sources.search('wood');
    await expect(sources.acquire('freesound:12', 'original')).rejects.toThrow('only downloads');
    expect((await sources.acquire('freesound:12', 'preview')).base64).toBe('AQID');
  });
  it('bounds downloads without trusting Content-Length', async () => {
    await expect(fetchBounded('https://example.org', 2, async () => new Response(new Uint8Array([1, 2, 3])))).rejects.toThrow('budget');
  });
});
