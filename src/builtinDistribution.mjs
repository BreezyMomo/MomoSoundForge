export const DISTRIBUTION_SCHEMA = 'momo.sound-distribution/v1';

// This is deployment configuration, never a URL supplied by a sound project.
export function normalizeLibraryUrl(value) {
  if (!value) return '';
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash)
    throw Error('Sound library URL must be HTTPS without credentials, query or fragment (HTTP loopback is allowed for local checks)');
  url.pathname = url.pathname.replace(/\/?$/, '/');
  return url.href;
}

export function distributionDescriptor(baseUrl = '') {
  const normalized = normalizeLibraryUrl(baseUrl);
  return { schema: DISTRIBUTION_SCHEMA, mode: normalized ? 'external' : 'local', baseUrl: normalized || null };
}

export function parseDistribution(value) {
  if (!value || value.schema !== DISTRIBUTION_SCHEMA
    || !['local', 'external'].includes(value.mode)
    || (value.mode === 'local' ? value.baseUrl !== null : typeof value.baseUrl !== 'string' || !value.baseUrl))
    throw Error('Invalid sound distribution descriptor');
  return distributionDescriptor(value.baseUrl ?? '');
}

// AI tools discover the site's current transport without recording it in projects.
export function createPublishedLibraryFetcher(site, fetcher = url => fetch(url)) {
  const base = new URL(site);
  base.pathname = base.pathname.replace(/\/?$/, '/'); base.search = ''; base.hash = '';
  const local = new URL('sound-library/', base).href;
  let pending;
  async function location() {
    const response = await fetcher(`${local}distribution.json`);
    if (!response.ok || !response.body) throw Error('Cannot load sound distribution descriptor');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 4096) throw Error('Sound distribution descriptor exceeds budget');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const descriptor = parseDistribution(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    return descriptor.baseUrl ?? local;
  }
  return async url => {
    const requested = new URL(url, base).href;
    if (!requested.startsWith(local) || !/^[a-f0-9]{64}\.(soundforge|recording)\.bin$/.test(requested.slice(local.length)))
      throw Error('Unexpected built-in resource URL');
    pending ??= location().catch(error => { pending = undefined; throw error; });
    return fetcher(`${await pending}${requested.slice(local.length)}`);
  };
}
