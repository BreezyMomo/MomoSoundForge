import { projectDocument } from './model';
import { SOUND_CATEGORIES, type SoundCategory } from "./libraryPreferences";
import {
  parseProject,
  projectForSave,
  assertProjectLimits,
  uid,
  type Project,
  type RenderResult,
} from "./model";
export type SavedSound = {
  id: string;
  name: string;
  duration: number;
  layerCount: number;
  updatedAt: number;
  thumbnail: number[];
  deleted: boolean;
  category?: SoundCategory;
};
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("momo-sound-forge", 2);
    request.onupgradeneeded = () => {
      for (const name of ["drafts", "sounds", "sound-index"])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
const completed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? Error("Storage transaction aborted"));
  });
export async function readDraft(): Promise<Project | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readonly"),
        req = tx.objectStore("drafts").get("current");
      req.onsuccess = () => {
        try {
          resolve(req.result ? parseProject(req.result) : null);
        } catch (e) {
          reject(e);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
export async function writeDraft(project: Project) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(projectDocument(project), "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function listSavedSounds(): Promise<SavedSound[]> {
  const db = await database();
  try {
    const items = await new Promise<SavedSound[]>((resolve, reject) => {
      const request = db
        .transaction("sound-index")
        .objectStore("sound-index")
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return items.sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  } finally {
    db.close();
  }
}
export async function readSavedSound(id: string): Promise<Project> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("sounds").objectStore("sounds").get(id);
      request.onsuccess = () => {
        try {
          resolve(parseProject(request.result));
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveSoundToLibrary(
  source: Project,
  audio: Pick<RenderResult, "left" | "right">,
  id: string = uid(),
  category: SoundCategory = "uncategorized",
): Promise<SavedSound> {
  assertProjectLimits(source);
  const project = parseProject(projectForSave(source));
  let layerCount = 0;
  const count = (p: Project) => {
    layerCount += p.inputs.length;
    for (const layer of p.inputs)
      if (layer.player.mix) count(layer.player.mix);
  };
  count(project);
  const channels = [audio.left, audio.right];
  const thumbnail = Array.from({ length: 160 }, (_, bin) => {
    const start = Math.floor((bin * audio.left.length) / 160),
      end = Math.floor(((bin + 1) * audio.left.length) / 160);
    let peak = 0;
    for (let i = start; i < end; i++)
      for (const channel of channels)
        if (
          Number.isFinite(channel[i]) &&
          Math.abs(channel[i]) > Math.abs(peak)
        )
          peak = channel[i];
    return Math.max(-1, Math.min(1, peak));
  });
  const entry: SavedSound = {
    id,
    name: project.name,
    duration: project.duration,
    layerCount,
    updatedAt: Date.now(),
    thumbnail,
    deleted: false,
    category: SOUND_CATEGORIES.includes(category) ? category : "uncategorized",
  };
  const db = await database();
  try {
    const tx = db.transaction(["sounds", "sound-index"], "readwrite"),
      done = completed(tx);
    tx.objectStore("sounds").put(projectDocument(project), id);
    tx.objectStore("sound-index").put(entry, id);
    await done;
    return entry;
  } finally {
    db.close();
  }
}
export async function setSavedSoundDeleted(id: string, deleted: boolean) {
  const db = await database();
  try {
    const tx = db.transaction("sound-index", "readwrite"),
      done = completed(tx),
      store = tx.objectStore("sound-index"),
      request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) {
        tx.abort();
        return;
      }
      store.put({ ...request.result, deleted }, id);
    };
    await done;
  } finally {
    db.close();
  }
}
export async function renameSavedSound(
  id: string,
  name: string,
  category?: SoundCategory,
) {
  const nextName = name.trim();
  if (!nextName || nextName.length > 120) throw Error("Invalid sound name");
  const db = await database();
  try {
    const tx = db.transaction(["sounds", "sound-index"], "readwrite"),
      done = completed(tx),
      sounds = tx.objectStore("sounds"),
      index = tx.objectStore("sound-index"),
      project = sounds.get(id),
      entry = index.get(id);
    let result: SavedSound;
    entry.onsuccess = () => {
      if (!entry.result || !project.result) {
        tx.abort();
        return;
      }
      result = {
        ...entry.result,
        name: nextName,
        updatedAt: Date.now(),
        ...(category && SOUND_CATEGORIES.includes(category)
          ? { category }
          : {}),
      };
      sounds.put(projectDocument({ ...parseProject(project.result), name: nextName }), id);
      index.put(result, id);
    };
    await done;
    return result!;
  } finally {
    db.close();
  }
}
export function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export const safeFilename = (name: string) =>
  name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 100)
    .replace(/[. ]+$/, "") || "sound";
