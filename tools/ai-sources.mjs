// Search public metadata. Provider text is data, never agent instructions.
// Independent adapter; no upstream skill scripts or machine-specific proxy changes.
const decode = text => text.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27|#\d+);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>' }[entity] ?? String.fromCharCode(Number(entity.slice(2, -1)))));
export async function fetchBounded(url, limit, fetcher = fetch) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'MomoSoundForge/0.1 (sound research)' } });
  if (!response.ok || !response.body) throw Error(`Source returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw Error('Source exceeds download budget'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > limit) throw Error('Source exceeds download budget'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, size);
}
export function parseFreesound(html) {
  const results = [];
  for (const block of html.split(/class=["'][^"']*bw-search__result[^"']*["']/).slice(1)) {
    const attr = key => decode(block.match(new RegExp(`data-${key}="([^"]*)"`))?.[1] ?? '');
    const id = attr('sound-id'), author = attr('username');
    const license = block.match(/title="License: ([^"]+)"/)?.[1];
    // Start with CC0. Unknown/missing licenses never silently become CC0.
    if (!/^\d+$/.test(id) || license !== 'Creative Commons 0') continue;
    const preview = attr('mp3');
    let url; try { url = new URL(preview); } catch { continue; }
    if (url.protocol !== 'https:' || !['cdn.freesound.org', 'freesound.org'].includes(url.hostname) || url.username || url.password) continue;
    results.push({ id: `freesound:${id}`, name: attr('title').slice(0, 200), author,
      duration: Number(attr('duration')) || 0, downloads: Number(attr('num-downloads')) || 0,
      rating: Number(block.match(/Average rating of ([\d.]+)/)?.[1]) || null,
      description: decode((block.match(/<div class="max-h-60px[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 800),
      previewUrl: url.href, source: { provider: 'Freesound', url: `https://freesound.org/people/${encodeURIComponent(author)}/sounds/${id}/`, author: author || 'Unknown', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', quality: 'preview', retrievedAt: new Date().toISOString() } });
  }
  return results;
}
export function createSourceSearch(fetcher = fetch) {
  const candidates = new Map();
  return {
    async search(query) {
      if (typeof query !== 'string' || !query.trim() || query.length > 200) throw Error('Use a search phrase up to 200 characters');
      const url = new URL('https://freesound.org/search/');
      url.search = new URLSearchParams({ q: query, f: 'license:"Creative Commons 0"' }).toString();
      const rows = parseFreesound((await fetchBounded(url, 4 * 1024 * 1024, fetcher)).toString('utf8')).slice(0, 12);
      for (const item of rows) candidates.set(item.id, { item, expires: Date.now() + 30 * 60 * 1000 });
      while (candidates.size > 100) candidates.delete(candidates.keys().next().value);
      return { provider: 'Freesound', license: 'CC0', quality: 'preview', results: rows,
        note: rows.length ? 'MP3 previews, not original recordings. Popularity is not listening evidence. Open source pages for original downloads.' : 'No supported results. The provider may be unavailable or its page format may have changed; open Freesound to check.',
        searchUrl: url.href };
    },
    async acquire(id, quality) {
      if (quality !== 'preview') throw Error('This adapter only downloads explicitly requested MP3 previews. Obtain originals from the source page and import the file.');
      const cached = candidates.get(id);
      if (!cached || cached.expires < Date.now()) throw Error('Search again before downloading this candidate');
      const item = cached.item;
      const bytes = await fetchBounded(item.previewUrl, 12 * 1024 * 1024, fetcher);
      return { name: item.name, base64: bytes.toString('base64'), source: item.source };
    },
  };
}
