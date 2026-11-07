import { createServer } from 'vite';
import { readFile,writeFile,mkdir,stat,readdir,unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { deterministicGzip } from './deterministic-gzip.mjs';
import { pathToFileURL } from 'node:url';
const hashBytes=b=>createHash('sha256').update(b).digest('hex');
export async function remoteBuildFingerprint(){
  // Rendered recordings depend on the complete engine, not just the catalog.
  const sources=(await readdir('src',{recursive:true})).filter(f=>f.endsWith('.ts')).map(f=>path.join('src',f)).sort();
  const files=['src/data/builtin-catalog.json','tools/build-remote-library.mjs','tools/deterministic-gzip.mjs','package-lock.json',...sources];
  return hashBytes(JSON.stringify(await Promise.all(files.map(async f=>[f,hashBytes(await readFile(f))]))));
}

// Builds the same provider-neutral format for official audio and user resource packages.
export async function buildRemoteLibrary({output,official=false,inputs=[],libraryId='momo-official-sounds',name='Momo SoundForge'}){
  const root=process.cwd(),source=path.join(root,'public/sound-library');
  const fingerprint=official?await remoteBuildFingerprint():undefined;
  if(official&&path.resolve(output)!==source)throw Error('Official output must be public/sound-library; use library:stage to publish');
  if(official)try{
    const stamp=JSON.parse(await readFile(path.join(output,'.remote-fingerprint'),'utf8'));
    const raw=await readFile(path.join(output,'index.json'));
    if(stamp.input===fingerprint&&stamp.index===hashBytes(raw)){
      const index=JSON.parse(raw);
      for(const f of [...index.entries,...index.audio]){const bytes=await readFile(path.join(output,f.file));if(bytes.length!==f.bytes||hashBytes(bytes)!==f.sha256)throw Error('Changed generated remote file');}
      console.log(`Remote library ready: ${index.entries.length} entries (content verified).`);return index;
    }
  }catch{/* Missing or stale generated catalog: rebuild from verified inputs. */}
  if(!official){if(!inputs.length||!libraryId||libraryId==='momo-official-sounds')throw Error('Specify --id, --name and resource packages');
    try{await stat(output);throw Error('Output must be a new directory');}catch(e){if(e.code!=='ENOENT')throw e;}}
  await mkdir(output,{recursive:true});
  const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error'});
  try{
    const {sealResource,openResourceGraph}=await server.ssrLoadModule('/src/resourceGraph.ts');
    const {resourceProject,resourceFromDefinition,resourceFromRecording}=await server.ssrLoadModule('/src/soundResources.ts');
    const {createAudioReader}=await server.ssrLoadModule('/src/sharedAudio.ts');
    const {parseRemoteIndex}=await server.ssrLoadModule('/src/remoteLibrary.ts');
    const reader=createAudioReader(async url=>new Response(await readFile(path.join(source,path.basename(url)))),'/');
    const entries=[],audio=new Map();
    const hash=b=>createHash('sha256').update(b).digest('hex');
    const store=async(bytes,suffix)=>{const packed=deterministicGzip(bytes,{level:6}),sha256=hash(packed),file=`remote/${sha256}.${suffix}.bin`;
      await mkdir(path.join(output,'remote'),{recursive:true});await writeFile(path.join(output,file),packed);
      return {file,sha256,bytes:packed.length,decodedBytes:bytes.length};};
    const add=async(resource,names,read=reader)=>{
      const graph=await sealResource(resource,async(ref,bytes)=>{if(!audio.has(ref.audioId))audio.set(ref.audioId,{...ref,format:'pcm',...await store(bytes,'audio')});},read);
      entries.push({...graph.entry,names,contentId:graph.root,...await store(Buffer.from(JSON.stringify(graph)),'graph')});
    };
    if(official){
      const catalog=JSON.parse(await readFile(path.join(root,'src/data/builtin-catalog.json'),'utf8'));
      for(const a of catalog.audio)audio.set(a.id,{schema:'momo.audio-reference/v1',audioId:a.id,sampleRate:a.sampleRate??48000,channelCount:a.channelCount??2,frames:a.frames,format:a.format,assetGains:a.assetGains,file:a.file,sha256:a.sha256,bytes:a.compressedBytes,decodedBytes:a.decodedBytes});
      const {builtinSoundName,midiLabel}=await server.ssrLoadModule('/src/builtinLibrary.ts');
      const {BUILTIN_MESSAGES}=await server.ssrLoadModule('/src/builtinMessages.ts');
      const translate=language=>(key,...values)=>{let text=BUILTIN_MESSAGES[key]?.[language]??key;values.forEach((v,i)=>{text=text.replaceAll('{'+i+'}',String(v));});return text;};
      const {createSamplePreparer}=await server.ssrLoadModule('/src/prepareSamples.ts');
      const prepare=createSamplePreparer(async url=>new Response(await readFile(path.join(source,path.basename(url)))),'/');
      const {renderProject}=await server.ssrLoadModule('/src/engine.ts');
      const {encodeSamples}=await server.ssrLoadModule('/src/model.ts');
      for(const s of catalog.sounds){
        const {resource}=await openResourceGraph(JSON.parse(gunzipSync(await readFile(path.join(source,s.file)))));
        const p=resourceProject(resource),names={zh:builtinSoundName(s,translate(0)),en:builtinSoundName(s,translate(1))};
        let r={...resource,name:names.zh,category:s.category,preview:s.waveform};
        if(s.kind==='instrument')r={...resourceFromDefinition({schema:'momo.instrument/v1',instrument:p.inputs[0].player.score.instruments[0],assets:p.assets},s.id),name:names.zh,category:s.category,preview:s.waveform};
        if(s.kind==='sample'){
          const rendered=renderProject(await prepare(p));
          r={...resourceFromRecording({id:s.id,name:names.zh,sampleRate:rendered.sampleRate,channels:[encodeSamples(rendered.left),encodeSamples(rendered.right)],source:Object.values(p.assets)[0]?.source},null,s.id),category:s.category,preview:s.waveform};
        }
        await add(r,names);
      }
      for(const r of catalog.recordings){
        const nameFor=l=>`${translate(l)(r.nameKey)} · ${translate(l)('builtin.articulation.'+r.articulation)} · ${r.unpitched?(l?'Unpitched':'无固定音高'):midiLabel(r.rootMidi)} · ${r.velocityLow}–${r.velocityHigh} · ${r.variant}`;
        // Keep the reference lightweight; sealResource still reads and verifies its PCM.
        // Avoid decoding and re-encoding each full recording through base64 several times.
        const reference={schema:'momo.audio-reference/v1',audioId:r.audioId,sampleRate:48000,channelCount:2,frames:r.frames};
        await add({schema:'momo.sound-resource/v1',id:'builtin-recording-'+r.id,version:r.revision,name:nameFor(0),kind:'recording',category:r.category,description:'',preview:[],
          payload:{schema:'momo.recording/v1',asset:{id:r.id,name:r.name,sampleRate:48000,channels:[],reference,source:r.source},rootMidi:r.unpitched?null:r.rootMidi,gainDb:r.gainDb,tuneCents:r.tuneCents,releaseSeconds:r.releaseSeconds}},
        {zh:nameFor(0),en:nameFor(1)});
      }
    }else{
      const {unpackResource}=await server.ssrLoadModule('/src/resourcePackage.ts');
      const {readAudio}=await server.ssrLoadModule('/src/sharedAudio.ts');
      for(const input of inputs)await add(await unpackResource(new Uint8Array(await readFile(input))),undefined,readAudio);
    }
    const index={schema:'momo.remote-sound-library/v1',libraryId,name,entries,audio:[...audio.values()]};
    parseRemoteIndex(index,'https://example.com/index.json');
    const json=JSON.stringify(index,null,2)+'\n';if(Buffer.byteLength(json)>8*1024*1024)throw Error('Catalog exceeds 8 MiB');
    await writeFile(path.join(output,'index.json'),json);
    const referenced=new Set([...entries,...audio.values()].map(f=>f.file));
    const generatedRoot=path.resolve(output,'remote');
    for(const f of await readdir(generatedRoot))if(/^[a-f0-9]{64}\.(graph|audio)\.bin$/.test(f)&&!referenced.has('remote/'+f)){
      const target=path.resolve(generatedRoot,f);if(!target.startsWith(generatedRoot+path.sep))throw Error('Invalid generated path');await unlink(target);
    }
    if(official)await writeFile(path.join(output,'.remote-fingerprint'),JSON.stringify({input:fingerprint,index:hashBytes(json)}));
    console.log(`Remote library: ${entries.length} entries, ${audio.size} shared recordings.`);
    return index;
  }finally{await server.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={inputs:[]};
  while(args.length){const key=args.shift();if(key==='--official')options.official=true;else if(key==='--output')options.output=path.resolve(args.shift());else if(key==='--id')options.libraryId=args.shift();else if(key==='--name')options.name=args.shift();else if(key==='--input')options.inputs.push(path.resolve(args.shift()));else throw Error('Unknown option '+key);}
  if(!options.output)throw Error('Usage: --output NEW_DIRECTORY --id LIBRARY_ID --name NAME --input RESOURCE.sfresource [--input ...]');
  await buildRemoteLibrary(options);
}
