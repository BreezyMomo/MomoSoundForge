"""Collect the pinned CC0 game SFX selection. Requires numpy and an FFmpeg CLI.

Run from the repository root: python tools/collect-game-sfx.py --ffmpeg PATH
Publisher originals are retained unchanged. Working WAVs are decoded/resampled,
with attenuation only when Vorbis reconstruction exceeds safe PCM headroom.
Signed download URLs are requested from the publisher's own download API.
"""
import argparse, hashlib, http.cookiejar, json, re, subprocess, urllib.request, wave, zipfile
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

PACKS = {
    'impact-sounds': ('Impact Sounds', '029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8'),
    'rpg-audio': ('RPG Audio', '6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b'),
}
OUT = Path('samples/game-sfx-starter-20261105')
CACHE = Path('test-results/game-sfx-acquisition')
sha = lambda data: hashlib.sha256(data).hexdigest()
def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
def bounded(client, url, referer=None):
    headers = {'User-Agent': 'MomoSoundForge sample collection'}
    if referer: headers.update(Referer=referer, Origin='https://kenney.nl', Accept='application/json')
    with client.open(urllib.request.Request(url, headers=headers), timeout=60) as response:
        data = response.read(32*1024*1024+1)
    assert len(data) <= 32*1024*1024, 'Download budget exceeded'
    return data
def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--ffmpeg', required=True); args = parser.parse_args()
    # Every destination below is rooted in this checkout; never extract ZIP paths.
    root = Path.cwd().resolve(); assert (root/'AGENTS.md').is_file()
    out = (root/OUT).resolve(); assert out.parent == root/'samples'
    for folder in ['originals', 'wav', 'licenses']: (out/folder).mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    selection = json.loads(Path('tools/game-sfx-selection.json').read_text('utf-8'))
    sources = []; archives = {}
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    for pack, (title, digest) in PACKS.items():
        page = 'https://kenney.nl/assets/'+pack
        html_path = CACHE/(pack+'.html')
        html = html_path.read_bytes() if html_path.exists() else bounded(client, page)
        assert 'Creative Commons CC0' in html.decode()
        html_path.write_bytes(html)
        archive_path = CACHE/(pack+'.zip')
        if archive_path.exists(): data = archive_path.read_bytes()
        else:
            # Refresh cookies before calling the same endpoint used by the page.
            html = bounded(client, page)
            ident = re.search(r"data-download-id='([^']+)'", html.decode())[1]
            link = json.loads(bounded(client, 'https://kenney.nl/download-link/'+ident, page))
            assert link['url'].startswith('https://kenney.nl/download/')
            data = bounded(client, link['url'], page); archive_path.write_bytes(data)
        assert sha(data) == digest, f'Publisher archive changed; review before collecting: {pack}'
        archive = zipfile.ZipFile(archive_path); archives[pack] = archive
        license_bytes = archive.read('License.txt'); assert b'Creative Commons Zero, CC0' in license_bytes
        (out/'licenses'/f'{pack}-License.txt').write_bytes(license_bytes)
        (out/'licenses'/f'{pack}-source.html').write_bytes(html)
        sources.append({'id': 'kenney-'+pack, 'title': title, 'author': 'Kenney', 'sourceUrl': page,
            'license': 'CC0-1.0', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
            'archiveSha256': digest, 'pageSnapshotSha256': sha(html),
            'includedLicenseFile': f'licenses/{pack}-License.txt'})
    previous = json.loads(Path('samples/cc0-starter-20261104/manifest.json').read_text('utf-8'))
    original_hashes = {s['originalSha256'] for s in previous['samples']}
    pcm_hashes = {s['pcmSha256'] for s in previous['samples']}; samples = []
    decoder = subprocess.check_output([args.ffmpeg, '-version'], text=True).splitlines()[0]
    for group in selection:
        files = group.get('files') or [f"{group['prefix']}{i:03}.ogg" for i in group['indices']]
        for index, filename in enumerate(files, 1):
            ident = f"game-{group['id']}-{index:02}"; member = 'Audio/'+filename
            data = archives[group['pack']].read(member)
            assert sha(data) not in original_hashes, f'Duplicate original: {ident}'
            original_hashes.add(sha(data))
            original = out/'originals'/f'{ident}.ogg'; original.write_bytes(data)
            decoded = subprocess.check_output([args.ffmpeg, '-v', 'error', '-i', str(original), '-map', '0:a:0',
                '-ac', '2', '-ar', '48000', '-c:a', 'pcm_f32le', '-f', 'f32le', '-'])
            floating = np.frombuffer(decoded, dtype='<f4').reshape(-1, 2).astype(float)
            assert 0 < len(floating) <= 48000*10 and np.isfinite(floating).all()
            source_peak = float(np.max(np.abs(floating)))
            assert .0001 < source_peak < 2, f'Invalid decoded level: {ident}'
            gain = min(1, .98/source_peak)
            pcm = np.rint(floating*gain*32768).clip(-32768, 32767).astype('<i2').tobytes()
            assert sha(pcm) not in pcm_hashes, f'Duplicate decoded recording: {ident}'
            pcm_hashes.add(sha(pcm))
            audio = np.frombuffer(pcm, dtype='<i2').reshape(-1, 2).astype(float)/32768
            assert 0 < len(audio) <= 48000*10 and np.isfinite(audio).all()
            peak = float(np.max(np.abs(audio))); assert .0001 < peak < 1, f'Silent/clipped source: {ident}'
            # Remove only near-silence, retaining a little attack room and tail.
            active = np.flatnonzero(np.max(np.abs(audio), axis=1) > max(peak*.001, 1/32768))
            start = max(0, int(active[0])-480)
            end = min(len(audio), int(active[-1])+1+2400)
            wav_path = out/'wav'/f'{ident}.wav'
            with wave.open(str(wav_path), 'wb') as wav:
                wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(48000); wav.writeframes(pcm)
            samples.append({'id': ident, 'groupId': 'game-'+group['id'], 'nameKey': 'builtin.game.'+group['id'],
                'name': group['name'][0], 'englishName': group['name'][1], 'category': group['category'],
                'recording': index, 'keywords': group['keywords'], 'packId': 'kenney-'+group['pack'],
                'author': 'Kenney', 'sourceUrl': 'https://kenney.nl/assets/'+group['pack'],
                'sourceArchiveMember': member, 'license': 'CC0-1.0', 'sourceFormat': 'OGG Vorbis',
                'originalFile': original.relative_to(out).as_posix(), 'originalSha256': sha(data),
                'wavFile': wav_path.relative_to(out).as_posix(), 'wavSha256': sha(wav_path.read_bytes()),
                'pcmSha256': sha(pcm), 'sampleRate': 48000, 'channels': 2, 'bitsPerSample': 16,
                'duration': len(audio)/48000, 'peakDb': round(20*np.log10(peak), 3),
                'playback': {'trim': start/48000, 'duration': max(.1, (end-start)/48000), 'release': .025},
                'conversion': {'gain': gain, 'decodedSourcePeakDb': round(20*np.log10(source_peak), 3), 'trimmed': False, 'denoised': False,
                    'note': 'Publisher OGG decoded to PCM16; this WAV is not a lossless recording master.'}})
    manifest = {'schema': 'momo.sample-collection/v1', 'title': 'Game SFX Starter 2026-11-05',
        'sampleCount': len(samples), 'groupCount': len(selection), 'license': 'CC0-1.0',
        'verifiedAtUtc': datetime.now(timezone.utc).isoformat(), 'decoder': decoder,
        'technicalValidation': 'Pinned publisher archive, original and WAV SHA256, PCM de-duplication, finite samples, duration and peak checks.',
        'subjectiveAudition': 'No subjective sound-quality certification. Representative playback and final-render checks are recorded separately.',
        'sources': sources, 'samples': samples}
    save_json(out/'manifest.json', manifest)
    print(json.dumps({'samples': len(samples), 'groups': len(selection), 'seconds': round(sum(s['duration'] for s in samples), 3)}))
if __name__ == '__main__': main()
