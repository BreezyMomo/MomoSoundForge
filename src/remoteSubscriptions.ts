import { createRemoteLoader, fetchRemoteIndex, remoteIndexUrl, REMOTE_LIMITS, type RemoteIndex } from './remoteLibrary';

export type Subscription = { id:string; name:string; url:string; enabled:boolean; libraryId?:string; official?:boolean; autoName?:boolean };
export type RemoteState = Subscription & { index?:RemoteIndex; loading?:boolean; error?:string };
type Storage = Pick<globalThis.Storage,'getItem'|'setItem'>;
const KEY='momo-sound-forge:remote-libraries:v2';
export class RemoteLibraries {
  private states:RemoteState[];
  private listeners=new Set<()=>void>();
  private revisions=new Map<string,number>();
  constructor(defaults:Subscription[],private storage?:Storage,private fetcher:typeof fetch=fetch){
    this.states=defaults.map(s=>({...s,autoName:s.autoName===true}));
    try{const raw=storage?.getItem(KEY);if(raw){const saved=JSON.parse(raw);if(!Array.isArray(saved)||saved.length>REMOTE_LIMITS.sources)throw Error();
      const ids=new Set();this.states=saved.map(s=>{if(typeof s.id!=='string'||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>120||typeof s.enabled!=='boolean'||(s.libraryId!==undefined&&!/^[a-zA-Z0-9-]{1,120}$/.test(s.libraryId))||(s.autoName!==undefined&&typeof s.autoName!=='boolean'))throw Error();ids.add(s.id);return {id:s.id,name:s.name,url:remoteIndexUrl(s.url),enabled:s.enabled,libraryId:s.libraryId,official:s.id==='official',autoName:s.autoName===true};});}}
    catch{this.states=defaults;}
  }
  snapshot=()=>this.states;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private update(next:RemoteState[]){this.states=next;for(const f of this.listeners)f();}
  private persist(next:RemoteState[]){this.storage?.setItem(KEY,JSON.stringify(next.map(({id,name,url,enabled,libraryId,official,autoName})=>({id,name,url,enabled,libraryId,official,...(autoName?{autoName:true}:{})}))));this.update(next);}
  private stamp(id:string){const n=(this.revisions.get(id)??0)+1;this.revisions.set(id,n);return n;}
  private current(id:string,n:number){return this.revisions.get(id)===n&&this.states.some(s=>s.id===id);}
  async add(name:string,url:string){
    name=name.trim();url=remoteIndexUrl(url);
    if(!name||name.length>120||this.states.length>=REMOTE_LIMITS.sources)throw Error('remote.invalid');
    if(this.states.some(s=>s.url===url))throw Error('remote.duplicate');
    const index=await fetchRemoteIndex(url,this.fetcher);
    // Recheck after the asynchronous fetch: two dialogs may add concurrently.
    if(this.states.some(s=>s.url===url||s.libraryId===index.libraryId))throw Error('remote.duplicate');
    if(this.states.length>=REMOTE_LIMITS.sources)throw Error('remote.budget');
    this.persist([...this.states,{id:crypto.randomUUID(),name,url,enabled:true,libraryId:index.libraryId,index,autoName:false}]);
  }
  async edit(id:string,name:string,url:string){
    name=name.trim();url=remoteIndexUrl(url);const old=this.states.find(s=>s.id===id);if(!old)return;
    if(!name||name.length>120)throw Error('remote.invalid');
    if(this.states.some(s=>s.id!==id&&s.url===url))throw Error('remote.duplicate');
    const n=this.stamp(id);
    this.update(this.states.map(s=>s.id===id?{...s,loading:false}:s));
    const index=await fetchRemoteIndex(url,this.fetcher);
    if(!this.current(id,n))return;
    if(old.libraryId&&index.libraryId!==old.libraryId)throw Error('remote.identity');
    if(this.states.some(s=>s.id!==id&&s.libraryId===index.libraryId))throw Error('remote.duplicate');
    this.persist(this.states.map(s=>s.id===id?{...s,name,url,index,libraryId:index.libraryId,loading:false,error:undefined,autoName:false}:s));
  }
  remove(id:string){this.stamp(id);this.persist(this.states.filter(s=>s.id!==id));}
  enable(id:string,enabled:boolean){this.stamp(id);this.persist(this.states.map(s=>s.id===id?{...s,enabled,loading:false}:s));if(enabled)void this.refresh(id);}
  async refresh(id:string){
    const s=this.states.find(s=>s.id===id);if(!s||!s.enabled||s.loading)return;
    const n=this.stamp(id);this.update(this.states.map(x=>x.id===id?{...x,loading:true,error:undefined}:x));
    try{const index=await fetchRemoteIndex(s.url,this.fetcher);if(!this.current(id,n))return;
      if(s.libraryId&&s.libraryId!==index.libraryId)throw Error('remote.identity');
      if(this.states.some(x=>x.id!==id&&x.libraryId===index.libraryId))throw Error('remote.duplicate');
      this.persist(this.states.map(x=>x.id===id?{...x,index,libraryId:index.libraryId,name:x.autoName?index.name:x.name,loading:false,error:undefined}:x));
    }catch(e){if(this.current(id,n))this.update(this.states.map(x=>x.id===id?{...x,loading:false,error:e instanceof Error&&e.message.startsWith('remote.')?e.message:'remote.network'}:x));}
  }
  start(){for(const s of this.states)if(s.enabled&&!s.index&&!s.loading)void this.refresh(s.id);}
  loader(s:RemoteState){if(!s.index)throw Error('remote.invalid');return createRemoteLoader(s.index,s.url,this.fetcher);}
}
export function parseRemoteLibraryUrls(raw:string, excluded=''){
  const excludedUrl=excluded?remoteIndexUrl(excluded):'';
  return [...new Set(raw.split(/[\r\n,]+/).map(value=>value.trim()).filter(Boolean).map(value=>remoteIndexUrl(value)).filter(url=>url!==excludedUrl))];
}
// The editor is a framework; factory resources live in the published library
// and are discovered from its self-describing index at runtime.
const base=import.meta.env?.VITE_SOUND_LIBRARY_URL || 'https://breezymomo.github.io/MomoSoundForge-assets/';
const defaultUrl=new URL('index.json',new URL(base,typeof document==='undefined'?'http://localhost/':document.baseURI)).href;
const configuredUrls=parseRemoteLibraryUrls(
  import.meta.env?.VITE_SOUND_LIBRARY_URLS ?? 'https://breezymomo.github.io/MomoSoundForge-assets-vcsl-harp-sax/',
  defaultUrl,
);
const externalDefaults:Subscription[]=configuredUrls.map((url:string,index:number)=>({id:`external-${index+1}`,name:'External sound library',url,enabled:true,autoName:true}));
let browserStorage:Storage|undefined;try{browserStorage=globalThis.localStorage;}catch{/* browsing without persistent preferences */}
export const remoteLibraries=new RemoteLibraries([{id:'official',name:'Momo SoundForge',url:defaultUrl,enabled:true,libraryId:'momo-official-sounds',official:true},...externalDefaults],browserStorage);
