import { definitionId, definitionName, parseDefinition, type SoundDefinition } from "./soundDefinitions";
export type DefinitionIndex = { id: string; name: string; schema: SoundDefinition["schema"]; updatedAt: number };
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("momo-sound-forge-definitions", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("definitions");
      request.result.createObjectStore("index");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
export async function listDefinitions(): Promise<DefinitionIndex[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("index").objectStore("index").getAll();
      r.onsuccess = () => resolve(r.result.sort((a: DefinitionIndex, b: DefinitionIndex) => b.updatedAt - a.updatedAt));
      r.onerror = () => reject(r.error);
    });
  } finally { db.close(); }
}
export async function loadDefinition(id: string): Promise<SoundDefinition> {
  const db = await database();
  try {
    const raw = await new Promise((resolve, reject) => {
      const r = db.transaction("definitions").objectStore("definitions").get(id);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    return parseDefinition(raw);
  } finally { db.close(); }
}
export async function saveDefinition(raw: SoundDefinition): Promise<void> {
  const d = parseDefinition(raw), id = definitionId(d);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["definitions", "index"], "readwrite");
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      tx.objectStore("definitions").put(d, id);
      tx.objectStore("index").put({ id, name: definitionName(d), schema: d.schema, updatedAt: Date.now() }, id);
    });
  } finally { db.close(); }
}
