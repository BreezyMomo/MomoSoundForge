"""Collect the pinned CC0 nature selection. Requires numpy, beautifulsoup4 and FFmpeg."""
import argparse
import hashlib
import io
import json
import math
import subprocess
import urllib.request
import wave
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from bs4 import BeautifulSoup

ROOT = Path.cwd().resolve()
OUT = ROOT / 'samples/nature-ambience-20261105'
CACHE = ROOT / 'test-results/nature-downloads'
PAGES = ROOT / 'test-results/nature-source-pages'
RATE = 48000
sha = lambda data: hashlib.sha256(data).hexdigest()


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def download(url, limit):
    request = urllib.request.Request(url, headers={'User-Agent': 'MomoSoundForge CC0 collection'})
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Publisher file exceeds download budget')
    return data


def cached_file(path, url, digest, limit=100 * 1024 * 1024):
    data = path.read_bytes() if path.exists() else download(url, limit)
    if len(data) > limit or sha(data) != digest:
        raise ValueError(f'Publisher file changed; review before use: {path.name}')
    if not path.exists():
        path.write_bytes(data)
    return data


def verify():
    manifest = json.loads((OUT / 'manifest.json').read_text('utf-8'))
    for source in manifest['sources']:
        assert sha((OUT / source['pageSnapshot']).read_bytes()) == source['pageSnapshotSha256']
    for original in manifest['originals']:
        assert sha((OUT / original['file']).read_bytes()) == original['sha256']
    pcm_hashes = set()
    for sample in manifest['samples']:
        raw = (OUT / sample['wavFile']).read_bytes()
        assert sha(raw) == sample['wavSha256']
        with wave.open(io.BytesIO(raw)) as wav:
            assert (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) == (2, RATE, 2)
            pcm = wav.readframes(wav.getnframes())
        assert sha(pcm) == sample['pcmSha256'] and sample['pcmSha256'] not in pcm_hashes
        pcm_hashes.add(sample['pcmSha256'])
        x = np.frombuffer(pcm, dtype='<i2').reshape(-1, 2).astype(float) / 32768
        assert np.isfinite(x).all() and .0001 < np.max(abs(x)) < 1
        assert np.max(abs(x[[0, -1]])) == 0
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    assert (ROOT / 'AGENTS.md').is_file() and OUT.resolve().parent == ROOT / 'samples'
    if args.verify_only:
        m = verify()
        print(f"Verified {len(m['originals'])} originals and {len(m['samples'])} unique playback clips.")
        return
    if not args.ffmpeg:
        parser.error('--ffmpeg is required for collection')
    plan = json.loads((ROOT / 'tools/nature-selection.json').read_text('utf-8'))
    for folder in ['originals', 'wav', 'licenses']:
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    PAGES.mkdir(parents=True, exist_ok=True)
    old = OUT / 'manifest.json'
    previous = json.loads(old.read_text('utf-8')) if old.exists() else None
    collected = previous['collectedAt'] if previous else datetime.now(timezone.utc).isoformat()
    decoder = subprocess.check_output([args.ffmpeg, '-version'], text=True).splitlines()[0]
    sources = []
    for entry in plan['sources']:
        snapshot = PAGES / (entry['pageSlug'] + '.html')
        retained = OUT / f"licenses/{entry['id']}-source.html"
        if snapshot.exists():
            raw = snapshot.read_bytes()
        elif retained.exists():
            raw = retained.read_bytes()
        elif entry.get('provider') == 'BigSoundBank':
            raise ValueError(f"Save the publisher's rendered main DOM to {snapshot} before collection")
        else:
            raw = download(entry['sourceUrl'], 2 * 1024 * 1024)
        soup = BeautifulSoup(raw, 'html.parser')
        if entry.get('provider') == 'BigSoundBank':
            explicit_cc0 = 'CC0 (public domain)' in soup.get_text(' ', strip=True)
        else:
            license_field = soup.select_one('.field-name-field-art-licenses')
            explicit_cc0 = license_field is not None and any(e.get_text(strip=True) == 'CC0' for e in license_field.select('a'))
        if not explicit_cc0:
            raise ValueError(f"Missing explicit publisher CC0 selection: {entry['id']}")
        snapshot.write_bytes(raw)
        relative = f"licenses/{entry['id']}-source.html"
        (OUT / relative).write_bytes(raw)
        sources.append({**entry, 'license': 'CC0-1.0', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
                        'pageSnapshot': relative, 'pageSnapshotSha256': sha(raw), 'retrievedAt': collected})
    original_entries = []
    original_paths = {}
    for entry in plan['files']:
        extension = Path(entry['cacheFile']).suffix
        relative = f"originals/{entry['id']}{extension}"
        target = OUT / relative
        if entry.get('archiveMember'):
            archive = cached_file(CACHE / entry['archiveCacheFile'], entry['downloadUrl'], entry['archiveSha256'], 32 * 1024 * 1024)
            with zipfile.ZipFile(io.BytesIO(archive)) as z:
                info = z.getinfo(entry['archiveMember'])
                assert info.file_size < 20 * 1024 * 1024
                data = z.read(info)
            assert sha(data) == entry['sha256']
        elif entry.get('downloadMethod') == 'publisher WAV download form':
            cached = CACHE / entry['cacheFile']
            if not cached.exists() and not target.exists():
                raise ValueError(f"Download WAV from {entry['sourceUrl']} and save it to {cached}")
            data = (cached if cached.exists() else target).read_bytes()
            if len(data) > 100 * 1024 * 1024 or sha(data) != entry['sha256']:
                raise ValueError(f"Publisher WAV changed: {entry['id']}")
        else:
            data = cached_file(CACHE / entry['cacheFile'], entry['downloadUrl'], entry['sha256'])
        target.write_bytes(data)
        original_paths[entry['id']] = target
        probe = subprocess.run([args.ffmpeg, '-hide_banner', '-i', str(target)], capture_output=True, text=True, encoding='utf-8', errors='replace')
        audio = next(line.strip() for line in probe.stderr.splitlines() if 'Audio:' in line)
        original_entries.append({**entry, 'file': relative, 'bytes': len(data), 'audioFormat': audio})
    source_by_id = {s['id']: s for s in sources}
    original_by_id = {s['id']: s for s in original_entries}
    samples = []
    for group in plan['groups']:
        for index, clip in enumerate(group['clips'], 1):
            ident = f"nature-{group['id']}-{index:02}"
            overlap = .25 if group['mode'] == 'loop' else 0
            command = [args.ffmpeg, '-v', 'error', '-ss', str(clip['start']), '-i', str(original_paths[clip['sourceFile']])]
            if clip['duration'] is not None:
                # Encoded timestamps/resampler delay can remove a few milliseconds;
                # decode a little extra, then select an exact PCM frame count below.
                command += ['-t', str(clip['duration'] + overlap + .05)]
            command += ['-map', '0:a:0', '-af', f"highpass=f={group['highpassHz']}", '-ac', '2', '-ar', str(RATE), '-f', 'f32le', '-']
            decoded = subprocess.check_output(command, timeout=45)
            x = np.frombuffer(decoded, dtype='<f4').reshape(-1, 2).astype(float)
            assert 0 < len(x) <= 16 * RATE and np.isfinite(x).all()
            if overlap:
                count, seam = round(clip['duration'] * RATE), round(overlap * RATE)
                assert len(x) >= count + seam, f'Source is too short: {ident}'
                t = np.linspace(0, math.pi / 2, seam)[:, None]
                blended = x[seam:seam + count].copy()
                blended[-seam:] = x[count:count + seam] * np.cos(t) + x[:seam] * np.sin(t)
                x = blended
            else:
                if clip['duration'] is not None:
                    x = x[:round(clip['duration'] * RATE)]
                # Keep a small attack lead and the natural tail of each selected event.
                peak = float(np.max(abs(x)))
                active = np.flatnonzero(np.max(abs(x), axis=1) > max(peak * .001, 1 / 32768))
                assert len(active)
                x = x[max(0, int(active[0]) - 240):min(len(x), int(active[-1]) + 2401)]
            # Short edge ramps prevent clicks in the editor's one-shot audition too.
            ramp = min(round(.005 * RATE), len(x) // 4)
            fade = np.linspace(0, 1, ramp)[:, None]
            x[:ramp] *= fade
            x[-ramp:] *= fade[::-1]
            peak = float(np.max(abs(x)))
            rms = float(np.sqrt(np.mean(x * x)))
            assert peak > .0001 and rms > .00001
            gain_db = min(-20 - 20 * math.log10(rms), -3 - 20 * math.log10(peak), 24)
            pcm = np.rint(x * 10 ** (gain_db / 20) * 32768).clip(-32768, 32767).astype('<i2').tobytes()
            relative = f'wav/{ident}.wav'
            with wave.open(str(OUT / relative), 'wb') as wav:
                wav.setnchannels(2)
                wav.setsampwidth(2)
                wav.setframerate(RATE)
                wav.writeframes(pcm)
            original = original_by_id[clip['sourceFile']]
            source = source_by_id[original['sourceId']]
            samples.append({'id': ident, 'groupId': f"nature-{group['id']}", 'recording': index,
                            'name': group['name'][0], 'englishName': group['name'][1], 'nameKey': f"builtin.nature.{group['id']}",
                            'category': group['category'], 'keywords': group['keywords'], 'playback': group['mode'],
                            'sourceId': source['id'], 'originalId': original['id'], 'originalFile': original['file'],
                            'originalSha256': original['sha256'], 'wavFile': relative,
                            'wavSha256': sha((OUT / relative).read_bytes()), 'pcmSha256': sha(pcm),
                            'sampleRate': RATE, 'channels': 2, 'frames': len(pcm) // 4, 'duration': len(pcm) / 4 / RATE,
                            'selection': clip, 'processing': {'highpassHz': group['highpassHz'], 'equalPowerSeamSeconds': overlap,
                                                           'edgeRampSeconds': .005, 'gainDb': gain_db, 'decoder': decoder},
                            'source': {'provider': source.get('provider', 'OpenGameArt'), 'url': source['sourceUrl'], 'author': source['author'],
                                       'license': 'CC0-1.0', 'licenseUrl': source['licenseUrl'], 'quality': 'original', 'retrievedAt': collected}})
    manifest = {'schema': 'momo.nature-collection/v1', 'collectedAt': collected, 'license': 'CC0-1.0',
                'uniquePublisherFiles': len(original_entries), 'playbackClips': len(samples), 'groups': len(plan['groups']),
                'sources': sources, 'originals': original_entries, 'samples': samples, 'excluded': plan['excluded']}
    save_json(OUT / 'manifest.json', manifest)
    (OUT / '.gitattributes').write_text('# Publisher evidence is retained byte-for-byte.\nlicenses/* -diff\n', encoding='utf-8', newline='\n')
    lines = ['MomoSoundForge nature ambience collection', 'Selected license: CC0-1.0',
             'https://creativecommons.org/publicdomain/zero/1.0/', '',
             'Publisher originals and source-page evidence are retained without modification.',
             'Working clips use documented selections, high-pass filtering, gain and edge/seam processing.',
             'Publisher-provided OGG/MP3 remain lossy sources; PCM conversion does not restore quality.', '']
    for source in sources:
        lines += [source['title'], 'Author: ' + source['author'], source['sourceUrl'], source['note'], '']
    (OUT / 'licenses/nature-cc0.txt').write_text('\n'.join(lines), encoding='utf-8', newline='\n')
    verify()
    # Only retire unchanged files referenced by the previous selection, within this collection.
    def referenced_files(value):
        if not value:
            return {}
        return {**{s['pageSnapshot']: s['pageSnapshotSha256'] for s in value['sources']},
                **{s['file']: s['sha256'] for s in value['originals']},
                **{s['wavFile']: s['wavSha256'] for s in value['samples']}}
    retained = referenced_files(manifest)
    for relative, digest in referenced_files(previous).items():
        if relative in retained:
            continue
        target = (OUT / relative).resolve()
        if target.parent not in [(OUT / folder).resolve() for folder in ['originals', 'wav', 'licenses']]:
            raise ValueError(f'Unsafe retired path: {relative}')
        if target.exists():
            if sha(target.read_bytes()) != digest:
                raise ValueError(f'Retired file has unrecorded edits; preserve it: {relative}')
            target.unlink()
    save_json(OUT / 'verification.json', {'manifestSha256': sha((OUT / 'manifest.json').read_bytes()),
                                         'originals': len(original_entries), 'uniquePlaybackClips': len(samples),
                                         'allSourcesExplicitCC0': True, 'hashesAndPcmChecked': True,
                                         'listeningReview': 'Pending human audition; measurements do not certify sound quality.'})
    print(f'Collected {len(original_entries)} publisher files into {len(samples)} playback clips / {len(plan["groups"])} groups.')


if __name__ == '__main__':
    main()
