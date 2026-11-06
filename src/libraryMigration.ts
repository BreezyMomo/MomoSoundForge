import { listSavedSounds, readSavedSound } from './storage';
import { listDefinitions, loadDefinition } from './definitionStorage';
import { folderLibrary } from './folderLibrary';
import { resourceFromProject, resourceFromDefinition, parseResource } from './soundResources';
import { LIBRARY_PREFERENCES_KEY, parseLibraryPreferences } from './libraryPreferences';
const migrationId=async(id:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id))),n=>n.toString(16).padStart(2,'0')).join('');
export async function legacyResourceCount(existingIds:string[] = []) {
  const ids=[...(await listSavedSounds()).filter(e=>!e.deleted).map(e=>'legacy-sound-'+e.id),...(await listDefinitions()).map(e=>'legacy-definition-'+e.id)];
  return (await Promise.all(ids.map(migrationId))).filter(id=>!existingIds.includes(id)).length;
}
// Keep legacy originals. Retrying verifies/reuses the exact migrated payload; no data is silently overwritten.
export async function migrateBrowserLibrary() {
  const existing=await folderLibrary.list();
  const preferenceKeys=new Map<string,string>();
  const migrate=async (id:string, make:()=>Promise<ReturnType<typeof resourceFromProject>>) => {
    const made=await make();const r=parseResource({...made,id:await migrationId(id)});id=r.id;
    const old=existing.find(e=>e.id===id);
    if(old) {const actual=await folderLibrary.load(id);if(JSON.stringify(actual.payload)!==JSON.stringify(r.payload))throw Error('resources.conflict');}
    else {await folderLibrary.save(r);await folderLibrary.load(id);}
  };
  for(const e of (await listSavedSounds()).filter(e=>!e.deleted)) {await migrate('legacy-sound-'+e.id,async()=>({...resourceFromProject(await readSavedSound(e.id),e.thumbnail),category:e.category??'uncategorized'}));preferenceKeys.set('library-'+e.id,'local-'+await migrationId('legacy-sound-'+e.id));}
  for(const e of await listDefinitions()) await migrate('legacy-definition-'+e.id,async()=>resourceFromDefinition(await loadDefinition(e.id)));
  if(typeof localStorage!=='undefined') {
    const p=parseLibraryPreferences(JSON.parse(localStorage.getItem(LIBRARY_PREFERENCES_KEY)??'null'));
    localStorage.setItem(LIBRARY_PREFERENCES_KEY,JSON.stringify({...p,favorites:p.favorites.map(k=>preferenceKeys.get(k)??k),recent:p.recent.map(k=>preferenceKeys.get(k)??k)}));
    window.dispatchEvent(new Event('soundforge-preferences-updated'));
  }
}
