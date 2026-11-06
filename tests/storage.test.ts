import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { fromPreset } from "../src/presets";
import { encodeSamples, makeLayer, wrapProject } from "../src/model";
import { renderProject } from "../src/engine";
import {
  listSavedSounds,
  readDraft,
  readSavedSound,
  renameSavedSound,
  saveSoundToLibrary,
  setSavedSoundDeleted,
  writeDraft,
} from "../src/storage";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const sound = () => fromPreset("deny", "Saved effect", (key) => key);

describe("persistent editable sound library", () => {
  it("persists library classification independently of the editable sound", async () => {
    const project = sound();
    const entry = await saveSoundToLibrary(
      project,
      renderProject(project),
      undefined,
      "magic",
    );
    expect((await listSavedSounds())[0].category).toBe("magic");
    await renameSavedSound(entry.id, "Renamed", "motion");
    await setSavedSoundDeleted(entry.id, true);
    await setSavedSoundDeleted(entry.id, false);
    expect((await listSavedSounds())[0].category).toBe("motion");
    expect(await readSavedSound(entry.id)).toEqual({
      ...project,
      name: "Renamed",
    });
  });
  it("upgrades the database without changing the native draft", async () => {
    const project = sound();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("momo-sound-forge", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put(project, "current");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    expect(await readDraft()).toEqual(project);
    expect(await listSavedSounds()).toEqual([]);
    const saved = await saveSoundToLibrary(project, renderProject(project));
    await writeDraft({ ...project, name: "Another draft" });
    expect((await readDraft())?.name).toBe("Another draft");
    expect((await readSavedSound(saved.id)).name).toBe("Saved effect");
  });
  it("stores nested samples as an independent snapshot and keeps only previews in the index", async () => {
    const child = sound();
    child.assets.sample = {
      id: "sample",
      name: "sample.wav",
      sampleRate: 8000,
      channels: [
        encodeSamples(
          Float32Array.from(
            { length: 2000 },
            (_, i) => Math.sin(i * 0.2) * 0.3,
          ),
        ),
      ],
    };
    child.layers.push(
      makeLayer({ type: "sample", assetId: "sample", duration: 0.25 }),
    );
    const project = wrapProject(wrapProject(child)),
      expected = renderProject(project),
      entry = await saveSoundToLibrary(project, expected);
    child.layers[0].content.frequency = 999;
    project.layers[0].content.project!.master = 0;
    const restored = await readSavedSound(entry.id),
      actual = renderProject(restored);
    expect(actual.left).toEqual(expected.left);
    expect(actual.right).toEqual(expected.right);
    expect(
      restored.layers[0].content.project!.layers[0].content.project!.assets
        .sample,
    ).toBeDefined();
    const index = await listSavedSounds();
    expect(index).toHaveLength(1);
    expect(index[0]).not.toHaveProperty("project");
    expect(index[0].layerCount).toBe(5);
    expect(index[0].thumbnail).toHaveLength(160);
    expect(index[0].thumbnail.every(Number.isFinite)).toBe(true);
    restored.layers[0].gain = 0;
    expect((await readSavedSound(entry.id)).layers[0].gain).toBe(1);
  });
  it("updates, renames, removes and restores a saved sound without changing its instances", async () => {
    const project = sound(),
      audio = renderProject(project),
      entry = await saveSoundToLibrary(project, audio),
      instance = await readSavedSound(entry.id);
    const updated = { ...project, name: "Tuned effect", master: 0.5 };
    await saveSoundToLibrary(updated, renderProject(updated), entry.id);
    expect(await listSavedSounds()).toHaveLength(1);
    expect((await readSavedSound(entry.id)).master).toBe(0.5);
    expect(instance.master).toBe(project.master);
    await renameSavedSound(entry.id, " Renamed effect ");
    expect((await readSavedSound(entry.id)).name).toBe("Renamed effect");
    expect((await listSavedSounds())[0].name).toBe("Renamed effect");
    await setSavedSoundDeleted(entry.id, true);
    expect((await listSavedSounds())[0].deleted).toBe(true);
    await setSavedSoundDeleted(entry.id, false);
    expect((await listSavedSounds())[0].deleted).toBe(false);
    expect((await readSavedSound(entry.id)).layers).toEqual(updated.layers);
    await expect(readSavedSound("missing")).rejects.toThrow();
  });
  it("rolls back both payload and index when a write transaction fails", async () => {
    const project = sound(),
      audio = renderProject(project),
      entry = await saveSoundToLibrary(project, audio),
      put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      if (this.name === "sound-index") {
        this.transaction.abort();
        return {} as IDBRequest<IDBValidKey>;
      }
      return put.call(this, value, key);
    });
    await expect(
      saveSoundToLibrary(
        { ...project, name: "Failed update" },
        audio,
        entry.id,
      ),
    ).rejects.toThrow();
    expect((await readSavedSound(entry.id)).name).toBe(project.name);
    expect((await listSavedSounds())[0].name).toBe(project.name);
  });
});
