import { folderLibrary, libraryReady } from './folderLibrary';
import { resourceFromProject, resourceProject } from './soundResources';
import type { Project, RenderResult } from './model';
import type { SavedSound } from './storage';
import type { SoundCategory } from './libraryPreferences';
export async function listSavedSounds(): Promise<SavedSound[]> {
  await libraryReady;
  return (await folderLibrary.list('sound')).map(e=>({id:e.id,name:e.name,duration:e.duration??0,layerCount:e.layerCount??0,updatedAt:e.updatedAt,thumbnail:e.preview,category:e.category as SoundCategory,deleted:false}));
}
export async function readSavedSound(id:string) { await libraryReady; const r=await folderLibrary.load(id); if(r.kind!=='sound')throw Error('resources.invalid'); return resourceProject(r); }
export async function saveSoundToLibrary(project:Project,audio:Pick<RenderResult,'left'|'right'>) {
  await libraryReady;
  const preview=Array.from({length:160},(_,b)=>{
    let peak=0; for(let i=Math.floor(b*audio.left.length/160);i<Math.floor((b+1)*audio.left.length/160);i++)
      for(const c of [audio.left,audio.right])if(Math.abs(c[i])>Math.abs(peak))peak=c[i];return Math.max(-1,Math.min(1,peak));
  });
  const e=await folderLibrary.save(resourceFromProject(project,preview));
  return {id:e.id,name:e.name};
}
