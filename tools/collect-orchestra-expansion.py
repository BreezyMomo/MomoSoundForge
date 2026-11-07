"""Collect pinned VSCO recordings and author mappings; no synthesized gap filling.

Requires numpy, scipy and soundfile. Run from the repository root.
Downloads are resumable and verified against Git blob IDs before conversion.
"""
import argparse, concurrent.futures, hashlib, json, math, re, shutil, time, urllib.parse, urllib.request
from pathlib import Path

SOURCE = '440300901dfe9275fd84e0b7763af1f8443ae62e'
MAPPING = '6dd651d55dde97fd4028699be9d4481f26917891'
REPOSITORY = 'https://github.com/sgossner/VSCO-2-CE'
SPECS = {
 'upright-piano': [('VSUpright1','single-hit')],
 'flute': [('FluteSusNV','sustain'),('FluteSusVib','sustain-vibrato'),('FluteStac','staccato')],
 'violin-section': [('ViolinEnsSusVib','sustain'),('ViolinEnsSpic','spiccato'),('ViolinEnsPizz','pizzicato'),('ViolinEnsTrem','tremolo')],
 'cello-section': [('CelloEnsSusVib','sustain'),('CelloEnsSpic','spiccato'),('CelloEnsPizz','pizzicato'),('CelloEnsTrem','tremolo')],
 'french-horn': [('FHornSus','sustain'),('FHornStac','staccato'),('FHornMute','muted-sustain')],
 'trumpet': [('TrumpetSus','sustain'),('TrumpetStac','staccato'),('TrumpetSusVib','sustain-vibrato'),('TrumpetHarmonMuteSus','harmon-muted-sustain'),('TrumpetStraightMuteSus','straight-muted-sustain')],
}
COMPLETE_TRIO = {
 'solo-violin': [('SViolinVib','sustain'),('SViolinSpic','spiccato')],
 'clarinet': [('ClarinetSus','sustain'),('ClarinetStac','staccato')],
 'trombone': [('TromboneSus','sustain'),('TromboneStac','staccato')],
}
def sha(b): return hashlib.sha256(b).hexdigest()
def blob(b): return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
def fetch(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MomoSoundForge-sample-collector'}),timeout=60) as r:
                data=r.read(24*1024*1024+1)
                assert len(data)<=24*1024*1024, 'Download exceeds per-file budget'
                return data
        except Exception:
            if attempt==3: raise
            time.sleep(1+attempt)
def raw_url(rev,path): return 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/'+rev+'/'+urllib.parse.quote(path,safe='/')
def parse_sfz(text):
    assert '#include' not in text and '#define' not in text
    text=re.sub(r'//[^\n]*','',text)
    chunks=re.split(r'<([^>]+)>',text)
    control={}; glob={}; group={}; regions=[]
    for tag,body in zip(chunks[1::2],chunks[2::2]):
        assert tag in ['control','global','group','region'], tag
        fields=list(re.finditer(r'\b([A-Za-z_]\w*)\s*=',body))
        ops={m[1]:body[m.end():fields[i+1].start() if i+1<len(fields) else len(body)].strip() for i,m in enumerate(fields)}
        if tag=='control': control.update(ops)
        elif tag=='global': glob=ops;group={}
        elif tag=='group':group=ops
        else: regions.append((ops,{**glob,**group,**ops}))
    assert regions and control.get('default_path')
    return control['default_path'].replace('\\','/'),regions
def ranges(values):
    result=[]
    for n in sorted(set(values)):
        if result and n==result[-1][1]+1:result[-1][1]=n
        else:result.append([n,n])
    return result
def coverage(samples):
    result={}
    for inst in sorted({s['instrumentId'] for s in samples}):
        arts={}
        for art in sorted({s['articulation'] for s in samples if s['instrumentId']==inst}):
            ss=[s for s in samples if s['instrumentId']==inst and s['articulation']==art]
            cells={(m,v) for s in ss for m in range(s['keyLow'],s['keyHigh']+1) for v in range(max(1,s['velocityLow']),s['velocityHigh']+1)}
            arts[art]={'regionCount':len(ss),'rootMidi':sorted({s['rootMidi'] for s in ss}),
                'velocityBands':sorted({(s['velocityLow'],s['velocityHigh']) for s in ss}),
                'keyRangesAtVelocity':{str(v):ranges(m for m in range(128) if (m,v) in cells) for v in [35,75,110]},
                'coveredKeyVelocityCells':len(cells),
                'maxRootDistanceSemitones':max(max(abs(s['keyLow']-s['rootMidi']),abs(s['keyHigh']-s['rootMidi'])) for s in ss)}
        result[inst]=arts
    return result
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out');parser.add_argument('--selection',choices=['expanded','complete-trio'],default='expanded');parser.add_argument('--asset-map');parser.add_argument('--audit-only',action='store_true');args=parser.parse_args()
    specs=COMPLETE_TRIO if args.selection=='complete-trio' else SPECS
    root=Path.cwd();oldroot=root/'samples/orchestra-basics-20261104';old=json.loads((oldroot/'manifest.json').read_text('utf8'))
    out=Path(args.out or ('samples/orchestra-complete-20261107' if args.selection=='complete-trio' else 'samples/orchestra-expanded-20261105')).resolve();assert out.parent==root/'samples' and out!=oldroot
    asset_map=json.loads(Path(args.asset_map).read_text('utf8')) if args.asset_map else {}
    out.mkdir(exist_ok=True)
    for folder in ['mappings','originals','wav','licenses']:(out/folder).mkdir(exist_ok=True)
    trees={}
    for label,rev in [('source',SOURCE),('mapping',MAPPING)]:
        cache=root/f'test-results/library-expansion/{label}-tree.json'
        data=cache.read_bytes() if cache.exists() else fetch(f'https://api.github.com/repos/sgossner/VSCO-2-CE/git/trees/{rev}?recursive=1')
        tree=json.loads(data);assert not tree.get('truncated') and tree['sha']==rev
        trees[label]={x['path']:x for x in tree['tree'] if x['type']=='blob'}
    records=[]
    for ident,instrument_specs in specs.items():
        template=next(s for s in old['samples'] if s['instrumentId']==ident)
        for filename,art in instrument_specs:
            filename+='.sfz'; dest=out/'mappings'/filename
            raw=dest.read_bytes() if dest.exists() else fetch(raw_url(MAPPING,filename))
            assert blob(raw)==trees['mapping'][filename]['sha'];dest.write_bytes(raw)
            default,regions=parse_sfz(raw.decode('utf-8-sig'))
            for i,(own,ops) in enumerate(regions):
                source_path=default+ops['sample'].replace('\\','/')
                assert source_path in trees['source'] and '..' not in source_path.split('/')
                for key in ['lokey','hikey','pitch_keycenter','lovel','hivel']:assert re.fullmatch(r'\d+',ops[key])
                midi=int(ops['pitch_keycenter']);lo=int(ops['lokey']);hi=int(ops['hikey']);lv=int(ops['lovel']);hv=int(ops['hivel'])
                assert 0<=lo<=midi<=hi<=127 and 0<=lv<=hv<=127
                sid=f'{ident}-{filename[:-4].lower()}-{i+1:03d}'
                records.append({'id':sid,'instrumentId':ident,'instrumentName':template['instrumentName'],'family':template['family'],
                    'name':f"{template['instrumentName']} MIDI {midi} {art} vel {lv}–{hv}",'pitched':True,'rootMidi':midi,'keyLow':lo,'keyHigh':hi,'velocityLow':lv,'velocityHigh':hv,
                    'rootNote':['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][midi%12]+str(midi//12-1),
                    'slot':i+1,'articulation':art,'sourcePath':source_path,'sourceUrl':raw_url(SOURCE,source_path),'sourceCommit':SOURCE,
                    'sourceGitBlobSha1':trees['source'][source_path]['sha'],'sourceRegion':own,'sourceEffectiveOpcodes':ops,
                    'mappingFile':filename,'mappingCommit':MAPPING,'mappingSha256':sha(raw),'mappingUrl':REPOSITORY+'/blob/'+MAPPING+'/'+filename,
                    'author':template['author'],'license':'CC0-1.0','licenseUrl':old['licenseUrl'],
                    'roundRobin':{'mode':'sequence' if 'seq_position' in ops else 'random-window' if 'lorand' in ops else None,'index':int(ops['seq_position'])-1 if 'seq_position' in ops else None,'randomLow':float(ops['lorand']) if 'lorand' in ops else None,'randomHigh':float(ops['hirand']) if 'hirand' in ops else None},
                    'loop':{'mode':None,'startFrame':None,'endFrame':None,'evidence':'Unverified; no loop enabled'},
                    'release':{'envelopeSeconds':float(ops.get('ampeg_release',.15)),'recordedReleaseSampleId':None},
                    'measuredTuningHz':None,'pitchEvidence':'Author SFZ pitch_keycenter; no measured tuning certification','subjectiveAudition':'pending'})
    paths=sorted({s['sourcePath'] for s in records});total=sum(trees['source'][p]['size'] for p in paths)
    assert total<1024**3,'Pinned selection exceeds 1 GiB source budget'
    print(f'{len(records)} mapped regions, {len(paths)} source recordings, {total/1048576:.1f} MiB originals',flush=True)
    before=[s for s in old['samples'] if s['instrumentId'] in specs]
    (out/'author-coverage.json').write_text(json.dumps({'before':coverage(before),'authorReference':coverage(records),'sourceRecordings':len(paths),'newSourceRecordings':len(set(paths)-{s['sourcePath'] for s in old['samples']})},ensure_ascii=False,indent=2)+'\n','utf8')
    if args.audit_only:return
    import numpy as np, scipy, soundfile as sf
    from scipy.signal import resample_poly
    old_by_path={s['sourcePath']:s for s in old['samples']}
    def acquire(path):
        asset=hashlib.sha256(path.encode()).hexdigest()[:20];original=out/'originals'/(asset+'.wav');working=out/'wav'/(asset+'.wav')
        if original.exists():data=original.read_bytes()
        elif path in old_by_path and (oldroot/old_by_path[path]['originalFile']).exists():data=(oldroot/old_by_path[path]['originalFile']).read_bytes()
        elif path in old_by_path and 'samples/orchestra-basics-20261104/'+old_by_path[path]['originalFile'] in asset_map:data=Path(asset_map['samples/orchestra-basics-20261104/'+old_by_path[path]['originalFile']]).read_bytes()
        else:data=fetch(raw_url(SOURCE,path))
        assert len(data)==trees['source'][path]['size'] and blob(data)==trees['source'][path]['sha'],path
        if not original.exists():original.write_bytes(data)
        audio,rate=sf.read(original,dtype='float64',always_2d=True)
        assert audio.shape[1] in [1,2] and 0<len(audio)<=rate*30 and np.isfinite(audio).all()
        if audio.shape[1]==1:audio=np.repeat(audio,2,axis=1)
        pre=float(np.max(np.abs(audio)))
        full_scale_hits=int(np.sum(np.abs(audio)>=1-1/32768))
        g=math.gcd(rate,48000);converted=resample_poly(audio,48000//g,rate//g,axis=0) if rate!=48000 else audio
        # One common 6 dB attenuation for the whole collection provides resampling
        # headroom without changing the relative dynamics of different recordings.
        converted*=10**(-6/20)
        peak=float(np.max(np.abs(converted)));assert peak<1,f'Resampling overshoot: {path}'
        # No per-recording normalization: preserve dynamics between takes and layers.
        pcm=np.clip(np.rint(converted*32768),-32768,32767).astype('<i2')
        import wave
        with wave.open(str(working),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(48000);w.writeframes(pcm.tobytes())
        return path,{'assetKey':asset,'originalFile':f'originals/{asset}.wav','originalSha256':sha(data),'wavFile':f'wav/{asset}.wav','wavSha256':sha(working.read_bytes()),
          'pcmSha256':sha(pcm.tobytes()),'sampleRate':48000,'channels':2,'bitsPerSample':16,'durationSeconds':len(pcm)/48000,
          'sourceSampleRate':rate,'sourceDurationSeconds':len(audio)/rate,'sourceDecodedPeak':pre,'sourceFullScaleSampleCount':full_scale_hits,
          'qualityReview':{'usableForAutomaticSelection':full_scale_hits==0,'status':'quarantined-full-scale-samples' if full_scale_hits else 'technical-checks-pass-subjective-pending'},
          'peak':float(np.max(np.abs(pcm.astype(float)))/32768),'rms':float(np.sqrt(np.mean((pcm.astype(float)/32768)**2)))}
    assets={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for count,(path,metadata) in enumerate(pool.map(acquire,paths),1):
            assets[path]=metadata
            if count%25==0 or count==len(paths):print(f'Verified and converted {count}/{len(paths)}',flush=True)
    offsets={ident:max(0,max(float(s['sourceEffectiveOpcodes'].get('volume',0))+6 for s in records if s['instrumentId']==ident)-24) for ident in specs}
    if args.selection=='complete-trio':
        # Preserve all relative author levels with one headroom value per instrument.
        for ident in specs:
            peak=max(assets[s['sourcePath']]['peak']*10**((float(s['sourceEffectiveOpcodes'].get('volume',0))+6)/20) for s in records if s['instrumentId']==ident)
            offsets[ident]=round(max(offsets[ident],20*math.log10(peak/.7)),12)
    for s in records:
        s.update(assets[s['sourcePath']]);gain=float(s['sourceEffectiveOpcodes'].get('volume',0))
        s['conversion']={'suggestedAuthorRegionVolumeDb':gain,'recommendedRegionGainDb':gain+6-offsets[s['instrumentId']],'instrumentUniformAttenuationDb':offsets[s['instrumentId']],
            'appliedGainDb':-6,'resampledToHz':48000,'truncatedToEditorWindow':False,'preservesDynamicRelationships':True,'denoised':False,'endFadeSeconds':0}
    for filename in ['LICENSE','README.md','Readme.txt']:
        data=fetch(raw_url(SOURCE,filename));assert blob(data)==trees['source'][filename]['sha'];(out/'licenses'/('VSCO-'+filename)).write_bytes(data)
    usable=[s for s in records if s['qualityReview']['usableForAutomaticSelection']]
    quarantine=[s for s in records if not s['qualityReview']['usableForAutomaticSelection']]
    (out/'coverage.json').write_text(json.dumps({'before':coverage(before),'after':coverage(usable),'authorReference':coverage(records),'sourceRecordings':len(paths),'newSourceRecordings':len(set(paths)-{s['sourcePath'] for s in old['samples']}),'quarantinedRegions':len(quarantine)},ensure_ascii=False,indent=2)+'\n','utf8')
    (out/'quarantine.json').write_text(json.dumps(quarantine,ensure_ascii=False,indent=2)+'\n','utf8')
    manifest={'schema':'momo.instrument-collection/v1','title':'VSCO Complete Violin, Clarinet and Trombone' if args.selection=='complete-trio' else 'Orchestra Expanded 2026-11-05','instrumentCount':len(specs),'sampleCount':len(usable),'uniqueRecordingCount':len(paths),'usableRecordingCount':len({s['sourcePath'] for s in usable}),'quarantinedRegionCount':len(quarantine),
        'source':old['source'],'repository':REPOSITORY,'sourceCommit':SOURCE,'mappingCommit':MAPPING,'license':'CC0-1.0','licenseUrl':old['licenseUrl'],
        'coverage':f'Selected {sum(len(s) for s in specs.values())} author mappings for {len(specs)} instruments, excluding full-scale source recordings from automatic use. Original mappings are preserved. See coverage.json for remaining holes.',
        'limitations':['No measured tuning or subjective sound-quality certification.','No unverified sustain loops, legato or release recordings enabled.','Full recordings are shared by reference; portable exports include every instrument dependency.' if args.selection=='complete-trio' else 'Sample duration is full; portable projects select budgeted excerpts explicitly.','Author random windows are metadata; native engine uses deterministic cycling.'],
        'conversionTools':{'numpy':np.__version__,'scipy':scipy.__version__,'soundfile':sf.__version__},'samples':usable}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf8')
    print('Collection complete: '+str(out),flush=True)
if __name__=='__main__':main()
