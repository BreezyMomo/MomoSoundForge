"""Convert the pinned, verified Kawai candidate; preserve full tails and author mappings.
Run with the audit venv after tools/prepare-vcsl-piano.mjs --download.
"""
import hashlib, json, math, pathlib, shutil, wave
import numpy as np
from scipy.signal import resample_poly
import soundfile as sf

candidate = pathlib.Path('test-results/replacement-candidates/vcsl-kawai')
output = pathlib.Path('samples/vcsl-kawai-20261107')
c = json.loads((candidate / 'candidate.json').read_text())
assert c['revision'] == 'dfcf4a4918771eee884b96ad4493de82ef84daf6'
sha = lambda b: hashlib.sha256(b).hexdigest()
files = {f['sourcePath'].split('Chordophones/Zithers/')[1]: f for f in c['files']}
(output / 'wav').mkdir(parents=True, exist_ok=True)
(output / 'mappings').mkdir(exist_ok=True)
(output / 'licenses').mkdir(exist_ok=True)
(output / 'originals').mkdir(exist_ok=True)
shutil.copyfile(candidate / 'author.sfz', output / 'mappings/Kawai.sfz')
shutil.copyfile(candidate / 'README.upstream.md', output / 'licenses/VCSL-README.md')
samples = []
for index, ops in enumerate(c['regions']):
    f = files[ops['sample']]; raw = (candidate / f['file']).read_bytes()
    assert sha(raw) == f['sha256']
    assert hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == f['gitBlobSha1']
    original_file = 'originals/' + f['gitBlobSha1'] + '.wav'
    (output / original_file).write_bytes(raw)
    audio, rate = sf.read(candidate / f['file'], dtype='float64', always_2d=True)
    assert audio.shape[1] in (1, 2) and np.isfinite(audio).all()
    if audio.shape[1] == 1: audio = np.repeat(audio, 2, axis=1)
    divisor = math.gcd(rate, 48000)
    audio = resample_poly(audio, 48000 // divisor, rate // divisor)
    peak = float(np.max(np.abs(audio))); assert peak > 0
    applied = 20 * math.log10(.5 / peak)
    pcm = np.round(np.clip(audio * 10 ** (applied / 20), -1, 32767 / 32768) * 32768).astype('<i2')
    ident = f'vcsl-kawai-{index+1:03d}'; wav_file = f'wav/{ident}.wav'
    with wave.open(str(output / wav_file), 'wb') as writer:
        writer.setnchannels(2); writer.setsampwidth(2); writer.setframerate(48000); writer.writeframes(pcm.tobytes())
    root = int(ops['pitch_keycenter'])
    samples.append(dict(id=ident, instrumentId='vcsl-kawai', instrumentName='Kawai Grand Piano', family='keys', pitched=True,
        rootMidi=root, rootNote=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][root % 12] + str(root // 12 - 1),
        keyLow=int(ops['lokey']), keyHigh=min(108, int(ops['hikey'])), velocityLow=max(1, int(ops.get('lovel', 0))), velocityHigh=int(ops.get('hivel',127)),
        articulation='single-hit', trigger=ops['trigger'], sourceEffectiveOpcodes=ops, sourcePath=f['sourcePath'], sourceUrl=f['url'],
        sourceCommit=c['revision'], sourceGitBlobSha1=f['gitBlobSha1'], originalSha256=f['sha256'], sourceSampleRate=rate,
        author='Versilian Studios / Sam Gossner and VCSL contributors', license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
        originalFile=original_file, wavFile=wav_file, wavSha256=sha((output / wav_file).read_bytes()), pcmSha256=sha(pcm.tobytes()), durationSeconds=len(pcm)/48000, sampleRate=48000, channels=2,
        offsetFrames=round(float(ops.get('offset',0)) * 48000 / rate),
        conversion=dict(appliedGainDb=applied, recommendedRegionGainDb=float(ops.get('volume',0)) - applied - 7,
            instrumentHeadroomDb=-7, preservesDynamicRelationships=True, truncatedToEditorWindow=False, resampledToHz=48000),
        mappingFile='Kawai.sfz', mappingSha256=c['mapping']['sha256'], release=dict(envelopeSeconds=float(ops.get('ampeg_release', .4)))))
manifest=dict(schema='momo.sample-collection/v1', title='VCSL Kawai Grand Piano', source='https://github.com/sgossner/VCSL',
    sourceCommit=c['revision'], license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
    sampleCount=len(samples), samples=samples,
    conversion='Full 48 kHz stereo PCM16; per-file peak staging is exactly compensated by region gain, plus uniform -7 dB instrument headroom. No tail trimming.',
    limitations=['Native envelope and velocity response, not a claim of bit-exact SFZ emulation.', 'C8 is the intended upper key; author C#8 extension is excluded.'])
(output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(dict(samples=len(samples),seconds=max(s['durationSeconds'] for s in samples),gainRange=[min(s['conversion']['recommendedRegionGainDb'] for s in samples),max(s['conversion']['recommendedRegionGainDb'] for s in samples)])))
