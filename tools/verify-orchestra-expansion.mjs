import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
const base='samples/orchestra-expanded-20261105';
const manifest=JSON.parse(await readFile(`${base}/manifest.json`,'utf8'));
const quarantined=JSON.parse(await readFile(`${base}/quarantine.json`,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const seen=new Set();
for(const s of [...manifest.samples,...quarantined]) {
  assert(!seen.has(s.id));seen.add(s.id);
  const wav=await readFile(`${base}/${s.wavFile}`),original=await readFile(`${base}/${s.originalFile}`);
  assert.equal(hash(wav),s.wavSha256);assert.equal(hash(original),s.originalSha256);
  assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${original.length}\0`),original])).digest('hex'),s.sourceGitBlobSha1);
  assert(s.keyLow<=s.rootMidi && s.rootMidi<=s.keyHigh);
  assert.equal(s.conversion.appliedGainDb,-6);
  assert.equal(s.conversion.recommendedRegionGainDb,s.conversion.suggestedAuthorRegionVolumeDb+6-s.conversion.instrumentUniformAttenuationDb);
  assert(s.conversion.recommendedRegionGainDb<=24);
}
assert(manifest.samples.every(s=>s.sourceFullScaleSampleCount===0));
assert(quarantined.every(s=>s.sourceFullScaleSampleCount>0));
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error'});
try {
  const {parseProject,makeLayer}=await server.ssrLoadModule('/src/model.ts');
  const {selectRegion}=await server.ssrLoadModule('/src/instruments.ts');
  // Verify the actual native selector across every key and velocity, per articulation.
  let covered=0,uncovered=0;
  for(const ident of new Set(manifest.samples.map(s=>s.instrumentId))) {
    const sources=manifest.samples.filter(s=>s.instrumentId===ident);
    for(const art of new Set(sources.map(s=>s.articulation))) {
      const regions=sources.filter(s=>s.articulation===art).map(s=>({...s,roundRobin:s.roundRobin.randomLow??0}));
      for(let midi=0;midi<=127;midi++)for(let velocity=1;velocity<=127;velocity++) {
        const expected=regions.some(r=>midi>=r.keyLow&&midi<=r.keyHigh&&velocity>=r.velocityLow&&velocity<=r.velocityHigh);
        const r=selectRegion({id:ident,regions},{midi,velocity,articulation:art},2048,new Map());
        assert.equal(!!r,expected);
        if(expected)covered++;else uncovered++;
      }
    }
  }
  await mkdir(`${base}/instruments`,{recursive:true});
  const bundles=[];
  for(const id of ['piano','flute','violin','cello','horn','trumpet']) {
    const project=parseProject(JSON.parse(await readFile(`${base}/demos/expanded-${id}.soundforge`,'utf8')));
    const instruments=project.layers.flatMap(l=>l.content.score.instruments);
    assert(instruments.every(i=>i.id===instruments[0].id));
    const regions=[...new Map(instruments.flatMap(i=>i.regions).map(r=>[r.id,r])).values()];
    const instrument={...instruments[0],regions};
    parseProject({...project,layers:[makeLayer({type:'instrument',score:{schema:'momo.score/v1',bpm:120,instruments:[instrument],notes:[]}})]});
    const json=JSON.stringify({schema:'momo.instrument/v1',instrument,assets:project.assets});
    assert(Buffer.byteLength(json)<34*1024*1024);
    const file=`instruments/${id}-demo-region.sfinstrument`;
    await writeFile(`${base}/${file}`,json);
    bundles.push({file,regions:regions.length,articulations:[...new Set(regions.map(r=>r.articulation))],scope:'Only the demo regions and at most the first four seconds; the full collection is in manifest.json.',sha256:hash(json)});
  }
  await writeFile(`${base}/validation.json`,JSON.stringify({sourceRecordings:manifest.uniqueRecordingCount,usableRecordings:manifest.usableRecordingCount,usableRegions:manifest.samples.length,quarantinedRegions:quarantined.length,allSourceBlobIdsAndWavHashesMatch:true,selectorCoveredCells:covered,selectorUncoveredCells:uncovered,bundles,subjectiveAudition:'pending'},null,2)+'\n');
  console.log(`Verified ${manifest.samples.length} usable regions; native selection ${covered} covered cells; six portable instrument bundles.`);
} finally {await server.close();}
