const mirror = 'https://audio.breezymomo.com/';
const legacy = 'https://breezymomo.github.io/';

export const PRIMARY_SOUND_LIBRARY_URL = mirror;

const supplemental = [
  ['vcsl-harp-sax', 'momo-vcsl-harp-sax'],
  ['vcsl-winds', 'vcsl-winds'],
  ['vcsl-plucked', 'vcsl-plucked'],
  ['vcsl-keyboards', 'vcsl-keyboards'],
  ['vcsl-harpsichords', 'vcsl-harpsichords'],
  ['vcsl-piano-knight', 'vcsl-piano-knight'],
  ['vcsl-piano-steinway', 'vcsl-piano-steinway'],
  ['vcsl-piano-steinway-2', 'vcsl-piano-steinway-2'],
  ['vcsl-piano-yamaha', 'vcsl-piano-yamaha'],
  ['vcsl-mallets', 'vcsl-mallets'],
  ['vcsl-percussion', 'vcsl-percussion'],
  ['vcsl-timpani', 'vcsl-timpani'],
].map(([slug, libraryId]) => ({ path: `MomoSoundForge-assets-${slug}/`, libraryId }));

export const SUPPLEMENTAL_SOUND_LIBRARY_URLS = supplemental.map(({ path }) => mirror + path);

const moves = new Map<string, { url: string; libraryId: string }>([
  [legacy + 'MomoSoundForge-assets/index.json', { url: mirror + 'index.json', libraryId: 'momo-official-sounds' }],
  ...supplemental.map(({ path, libraryId }): [string, { url: string; libraryId: string }] => [
    legacy + path + 'index.json', { url: mirror + path + 'index.json', libraryId },
  ]),
]);

export function relocatedSoundLibrary(url: string, libraryId?: string) {
  const moved = moves.get(url);
  if (moved && (libraryId === undefined || libraryId === moved.libraryId)) return moved;
}
