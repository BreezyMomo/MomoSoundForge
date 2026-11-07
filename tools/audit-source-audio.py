"""Read-only independent decoder. Inputs are local collection manifests, never URLs.

Writes a technical report; full-scale/quiet/duplicate audio is a review signal,
not subjective rejection. Install tools/audio-audit-requirements.txt in a venv.
"""
import argparse
import hashlib
import json
import math
import pathlib
import sys
import wave

import numpy as np
import scipy
from scipy.signal import resample_poly
import soundfile as sf


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical_pcm(audio, rate):
    h = hashlib.sha256(f'momo.pcm-f32le/v1\n{rate}\n{audio.shape[1]}\n{len(audio)}\n'.encode())
    for channel in audio.T:
        h.update(channel.astype('<f4').tobytes())
    return h.hexdigest()


def metrics(audio, rate):
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError('Empty or non-finite audio')
    peak = float(np.max(np.abs(audio)))
    window = max(1, round(rate * .1))
    active = max(float(np.sqrt(np.mean(audio[i:i+window] ** 2, axis=0)).max()) for i in range(0, len(audio), window))
    db = lambda x: 20 * math.log10(x) if x > 0 else None
    return dict(sampleRate=rate, channels=audio.shape[1], frames=len(audio), duration=len(audio)/rate,
                peakDb=db(peak), rmsDb=db(float(np.sqrt(np.mean(audio**2)))), activeRmsDb=db(active),
                dcOffset=np.mean(audio, axis=0).tolist(), fullScaleSamples=int(np.sum(np.abs(audio) >= 1-1/32768)),
                status='silent' if peak == 0 else 'quiet' if peak < 10**(-36/20) or active < 10**(-42/20) else 'ok',
                pcmSha256=canonical_pcm(audio, rate))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='.')
    parser.add_argument('--output', required=True)
    parser.add_argument('--asset-map', help='Verified local cache mapping from review-sound-sources.mjs')
    args = parser.parse_args()
    root = pathlib.Path(args.root).resolve()
    asset_map = json.loads(pathlib.Path(args.asset_map).read_text('utf8')) if args.asset_map else {}

    def physical(target):
        return pathlib.Path(asset_map.get(target.relative_to(root).as_posix(), str(target)))
    output = pathlib.Path(args.output).resolve()
    # No writes below samples, exports, src or public, even if accidentally requested.
    if root in output.parents and output.relative_to(root).parts[0] != 'test-results':
        raise ValueError('Reports inside the repository must be under test-results/')
    records, files, failures, conversions = [], {}, [], []
    manifest_hashes = []

    def local(base, relative):
        target = (base / relative).resolve()
        if base.resolve() not in target.parents:
            raise ValueError('Source path escapes collection')
        return target

    def decode(target):
        key = target.relative_to(root).as_posix()
        if key not in files:
            data = physical(target).read_bytes()
            info = sf.info(physical(target))
            if info.channels not in (1, 2) or info.frames <= 0 or info.frames * info.channels > 100_000_000:
                raise ValueError('Unsupported audio layout or frame budget')
            audio, rate = sf.read(physical(target), dtype='float64', always_2d=True)
            files[key] = dict(path=key, bytes=len(data), sha256=sha(data), format=info.format, subtype=info.subtype,
                              gitBlobSha1=hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest(), **metrics(audio, rate))
        return files[key]

    for manifest_path in sorted((root/'samples').glob('*/manifest.json')):
        manifest = json.loads(manifest_path.read_text('utf8'))
        manifest_hashes.append(dict(path=manifest_path.relative_to(root).as_posix(), sha256=sha(manifest_path.read_bytes())))
        base = manifest_path.parent
        sources = [(s, False) for s in manifest['samples']]
        quarantine = base/'quarantine.json'
        if quarantine.exists():
            sources += [(s, True) for s in json.loads(quarantine.read_text('utf8'))]
        for sample, isolated in sources:
            entry = dict(collection=base.name, id=sample['id'], instrumentId=sample.get('instrumentId'),
                         articulation=sample.get('articulation'), existingQuarantine=isolated, checks=[], issues=[], provenanceGaps=[])
            try:
                for kind, name, expected in [('original', 'originalFile', 'originalSha256'), ('working', 'wavFile', 'wavSha256')]:
                    target = local(base, sample[name])
                    result = decode(target)
                    entry[kind] = result['path']
                    if result['sha256'] != sample[expected]:
                        entry['issues'].append(kind+'-file-hash-mismatch')
                    else:
                        entry['checks'].append(kind+'-file-hash')
                    if result['status'] == 'silent':
                        entry['issues'].append(kind+'-silent')
                    if kind == 'original' and sample.get('sourceGitBlobSha1'):
                        if result['gitBlobSha1'] != sample['sourceGitBlobSha1']:
                            entry['issues'].append('source-git-blob-mismatch')
                        else:
                            entry['checks'].append('source-git-blob')
                    if kind == 'working':
                        with wave.open(str(physical(target)), 'rb') as wav:
                            pcm = wav.readframes(wav.getnframes())
                        if sha(pcm) != sample['pcmSha256']:
                            entry['issues'].append('working-pcm16-hash-mismatch')
                        else:
                            entry['checks'].append('working-pcm16-hash')
                        if result['sampleRate'] != 48000 or result['channels'] != 2 or result['subtype'] != 'PCM_16':
                            entry['issues'].append('working-format-mismatch')
                if sample.get('mappingFile'):
                    mapping = local(base, 'mappings/'+sample['mappingFile'])
                    if not mapping.exists():
                        entry['provenanceGaps'].append(dict(reason='author-mapping-not-archived',
                            path=mapping.relative_to(root).as_posix(), expectedSha256=sample['mappingSha256'], url=sample.get('mappingUrl')))
                    elif sha(mapping.read_bytes()) != sample['mappingSha256']:
                        entry['issues'].append('mapping-hash-mismatch')
                    else:
                        entry['checks'].append('author-mapping-file-hash')
                if base.name.startswith(('orchestra-expanded', 'vcsl-kawai')) and entry['working'] not in {c['working'] for c in conversions}:
                    # Independently replay the documented fixed conversion, without writing a WAV.
                    audio, rate = sf.read(physical(root/entry['original']), dtype='float64', always_2d=True)
                    if audio.shape[1] == 1:
                        audio = np.repeat(audio, 2, axis=1)
                    divisor = math.gcd(rate, 48000)
                    converted = resample_poly(audio, 48000//divisor, rate//divisor, axis=0) if rate != 48000 else audio
                    converted *= 10**(sample['conversion']['appliedGainDb']/20)
                    pcm = np.clip(np.rint(converted*32768), -32768, 32767).astype('<i2')
                    actual = sha(pcm.tobytes())
                    conversions.append(dict(working=entry['working'], reproducedPcm16Sha256=actual,
                                            matches=actual == sample['pcmSha256']))
                    if actual != sample['pcmSha256']:
                        entry['issues'].append('conversion-reproduction-mismatch')
                entry['technicalStatus'] = 'failed' if entry['issues'] else 'passed'
            except Exception as error:
                entry['technicalStatus'] = 'failed'
                entry['issues'].append(str(error))
            if entry['issues']:
                failures.append(dict(collection=base.name, id=sample['id'], issues=entry['issues']))
            entry['disposition'] = 'quarantined-existing' if isolated else 'pending'
            entry['provenanceStatus'] = 'pending' if entry['provenanceGaps'] else 'passed-declared-checks'
            entry['subjectiveAudition'] = 'pending'
            records.append(entry)
        print(f"Decoded {base.name}: {len(sources)} mappings, {len(files)} unique file paths so far", flush=True)

    report = dict(schema='momo.source-audit/v1', decoder=dict(python=sys.version.split()[0], numpy=np.__version__,
                  scipy=scipy.__version__, soundfile=sf.__version__, libsndfile=sf.__libsndfile_version__),
                  pcmHashFormat='momo.pcm-f32le/v1; UTF-8 header rate/channels/frames, planar little-endian float32',
                  subjectiveAudition='pending', manifests=manifest_hashes, records=records, files=list(files.values()), conversions=conversions, failures=failures)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', 'utf8')
    print(json.dumps(dict(report=str(output), records=len(records), files=len(files), failures=len(failures))))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
