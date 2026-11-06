import { useSyncExternalStore, type SetStateAction } from 'react';
import { LIBRARY_PREFERENCES_KEY, parseLibraryPreferences } from './libraryPreferences';
type Preferences=ReturnType<typeof parseLibraryPreferences>;
let state:Preferences|undefined;
const listeners=new Set<()=>void>();
const read=()=>{try{return parseLibraryPreferences(JSON.parse(localStorage.getItem(LIBRARY_PREFERENCES_KEY)??'null'));
}catch{return parseLibraryPreferences(null);}};
const get=()=>state??=read();
if(typeof window!=='undefined')window.addEventListener('storage',e=>{if(e.key===LIBRARY_PREFERENCES_KEY){state=read();listeners.forEach(fn=>fn());}});
if(typeof window!=='undefined')window.addEventListener('soundforge-preferences-updated',()=>{state=read();listeners.forEach(fn=>fn());});
export function useResourcePreferences():[Preferences,(next:SetStateAction<Preferences>)=>void] {
  const value=useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},get,get);
  return [value,next=>{state=typeof next==='function'?next(get()):next;try{localStorage.setItem(LIBRARY_PREFERENCES_KEY,JSON.stringify(state));}catch{}listeners.forEach(fn=>fn());}];
}
