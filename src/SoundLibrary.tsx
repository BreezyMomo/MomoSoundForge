import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Plus,
  Save,
  Search,
  Square,
  Star,
  X,
} from "lucide-react";
import { PRESETS, fromPreset } from "./presets";
import { renderProject } from "./engine";
import { Waveform } from "./Waveform";
import type { Project, RenderResult } from "./model";
import {
  download,
  listSavedSounds,
  readSavedSound,
  renameSavedSound,
  safeFilename,
  saveSoundToLibrary,
  setSavedSoundDeleted,
  type SavedSound,
} from "./storage";
import { t } from "./i18n";
import { SOUND_CATEGORIES, LIBRARY_PREFERENCES_KEY, parseLibraryPreferences, rememberSound, type SoundCategory } from "./libraryPreferences";
import { BUILTIN_SOUNDS, builtinSoundName, builtinSoundDescription, builtinToneKey, builtinToneName, builtinChoiceName, preferredBuiltin, type BuiltinSound } from "./builtinLibrary";

const presetThumbnails = Object.fromEntries(
  PRESETS.map((p) => [
    p.id,
    renderProject(
      fromPreset(p.id, p.id, (key) => key),
      6000,
    ).left,
  ]),
);
const builtinThumbnails = new Map(BUILTIN_SOUNDS.map(sound => [sound.id, Float32Array.from(sound.waveform)]));
type CatalogEntry = {
  key: string; id: string; name: string; shortName?: string; category: SoundCategory;
  duration: number; description: string; waveform?: Float32Array; keywords?: string;
  saved?: SavedSound; builtin?: BuiltinSound;
};
type Dialog =
  { kind: "save"; project: Project } | { kind: "rename"; entry: SavedSound };
export function SoundLibrary({
  project,
  ready,
  playback,
  pendingPlayback,
  onPreset,
  onPresetInsert,
  onPresetPlay,
  onBuiltinOpen,
  onBuiltinInsert,
  onBuiltinPlay,
  saveHost,
  onOpen,
  onInsert,
  onPlay,
  onRender,
  onMessage,
}: {
  project: Project;
  ready: boolean;
  playback: string | null;
  pendingPlayback: string | null;
  onPreset: (id: string) => void;
  onPresetInsert: (id: string) => void;
  onPresetPlay: (id: string) => void;
  onBuiltinOpen: (id: string) => Promise<void>;
  onBuiltinInsert: (id: string) => Promise<void>;
  onBuiltinPlay: (id: string) => void;
  saveHost: HTMLElement | null;
  onOpen: (id: string) => Promise<void>;
  onInsert: (id: string) => Promise<void>;
  onPlay: (id: string) => void;
  onRender: (project: Project) => Promise<RenderResult>;
  onMessage: (key: string, ...values: unknown[]) => void;
}) {
  const [preferences, setPreferences] = useState(() => {
    try { return parseLibraryPreferences(JSON.parse(localStorage.getItem(LIBRARY_PREFERENCES_KEY) ?? "null")); }
    catch { return parseLibraryPreferences(null); }
  }),
    [saveCategory, setSaveCategory] = useState<SoundCategory>("uncategorized"),
    [query, setQuery] = useState(""),
    [section, setSection] = useState<"basic" | "examples" | "mine">("basic"),
    [toneChoices, setToneChoices] = useState<Record<string, string>>({}),
    [category, setCategory] = useState("all"),
    [entries, setEntries] = useState<SavedSound[]>([]),
    [loadState, setLoadState] = useState("loading"),
    [busy, setBusy] = useState(false),
    [trash, setTrash] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [name, setName] = useState(""),
    [dialogError, setDialogError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null),
    saveButton = useRef<HTMLButtonElement>(null);
  const waveforms = useMemo(
    () =>
      new Map(
        entries.map((entry) => [entry.id, Float32Array.from(entry.thumbnail)]),
      ),
    [entries],
  );
  const refresh = useCallback(async () => {
    setLoadState("loading");
    try {
      setEntries(await listSavedSounds());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (dialog && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [dialog]);
  const mine = entries.filter((entry) => !entry.deleted),
    removed = entries.filter((entry) => entry.deleted),
    duplicate = mine.find(
      (entry) => entry.name.toLowerCase() === name.trim().toLowerCase(),
    ),
    catalog: CatalogEntry[] = [
      ...PRESETS.map<CatalogEntry>(p => ({ key: `preset-${p.id}`, id: p.id, name: t(`preset.${p.id}`), category: p.category, duration: p.duration, description: t(`preset.${p.id}.desc`), waveform: presetThumbnails[p.id] })),
      ...BUILTIN_SOUNDS.map<CatalogEntry>(sound => ({ key: `builtin-${sound.id}`, id: sound.id, name: builtinSoundName(sound), shortName: builtinSoundName(sound, t, true), category: sound.category, duration: sound.duration, description: builtinSoundDescription(sound), waveform: builtinThumbnails.get(sound.id), keywords: sound.keywords, builtin: sound })),
      ...(trash ? removed : mine).map<CatalogEntry>(e => ({ key: `library-${e.id}`, id: e.id, name: e.name, category: e.category ?? "uncategorized", duration: e.duration, description: t("library.layerCount", e.layerCount), waveform: waveforms.get(e.id), saved: e })),
    ].filter(e => !trash || e.saved),
    inSection = catalog.filter(e => trash || (section === "mine" ? !!e.saved : section === "examples" ? e.builtin?.kind === "example" : !e.saved && e.builtin?.kind !== "example")),
    favoriteCount = inSection.filter(e => preferences.favorites.includes(e.key)).length,
    basicCount = PRESETS.length + new Set(BUILTIN_SOUNDS.filter(s => s.kind !== "example").map(builtinToneKey)).size,
    recordingCount = new Set(BUILTIN_SOUNDS.filter(s => s.kind === "instrument").flatMap(s => s.recordingIds ?? [])).size,
    visible = inSection.filter(e =>
      (trash || preferences.filter === "all" || (preferences.filter === "favorites" ? preferences.favorites : preferences.recent).includes(e.key)) &&
      (trash || category === "all" || category === e.category) &&
      `${e.name} ${e.description} ${e.keywords ?? ""} ${e.builtin ? builtinToneName(e.builtin) : ""} ${t(`library.${e.category}`)}`.toLowerCase().includes(query.trim().toLowerCase())
    ).sort((a,b) => !trash && preferences.filter === "recent" ? preferences.recent.indexOf(a.key) - preferences.recent.indexOf(b.key) : 0),
    groups = trash || preferences.filter === "recent" ? ["results"] : SOUND_CATEGORIES;
  useEffect(() => {
    try { localStorage.setItem(LIBRARY_PREFERENCES_KEY, JSON.stringify(preferences)); }
    catch { onMessage("library.preferenceError"); }
  }, [preferences]);
  const remember = (key: string) => setPreferences(p => ({ ...p, recent: rememberSound(p.recent, key) }));
  const toggleFavorite = (key: string) => setPreferences(p => ({ ...p, favorites: p.favorites.includes(key) ? p.favorites.filter(id => id !== key) : [...p.favorites, key] }));
  const updateEntry = (entry: SavedSound) =>
    setEntries((items) =>
      [entry, ...items.filter((item) => item.id !== entry.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
  const closeDialog = () => {
    dialogRef.current?.close();
    setDialog(null);
    setDialogError("");
    saveButton.current?.focus();
  };
  const showSave = () => {
    setName(project.name);
    setSaveCategory("uncategorized");
    setDialogError("");
    setDialog({ kind: "save", project });
  };
  const copyName = (value: string) => {
    let candidate = value,
      suffix = 2;
    while (
      mine.some((entry) => entry.name.toLowerCase() === candidate.toLowerCase())
    )
      candidate = `${value.slice(0, 112)} (${suffix++})`;
    return candidate;
  };
  async function save(copy = false) {
    if (!dialog || busy || !name.trim()) return;
    if (
      dialog.kind === "rename" &&
      mine.some(
        (entry) =>
          entry.id !== dialog.entry.id &&
          entry.name.toLowerCase() === name.trim().toLowerCase(),
      )
    ) {
      setDialogError("library.nameTaken");
      return;
    }
    setBusy(true);
    setDialogError("");
    let savedName = name.trim();
    try {
      if (dialog.kind === "rename") {
        updateEntry(await renameSavedSound(dialog.entry.id, name, saveCategory));
      } else {
        const nextName = copy ? copyName(name.trim()) : name.trim();
        const snapshot = { ...dialog.project, name: nextName },
          audio = await onRender(snapshot),
          entry = await saveSoundToLibrary(
            snapshot,
            audio,
            copy ? undefined : duplicate?.id,
            saveCategory,
          );
        updateEntry(entry);
        savedName = entry.name;
      }
      setPreferences(p => ({ ...p, filter: "all" }));
      setCategory("all");
      setSection("mine");
      setTrash(false);
      setQuery("");
      closeDialog();
      onMessage("library.saved", savedName);
    } catch {
      setDialogError("library.saveError");
    } finally {
      setBusy(false);
    }
  }
  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await run();
      setExpanded(null);
    } catch (error) {
      onMessage(
        error instanceof Error && (error.message.startsWith("error.") || error.message === "library.builtinLoadError")
          ? error.message
          : "library.actionError",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="library-content">
      {saveHost &&
        createPortal(
          <button
            ref={saveButton}
            className="secondary"
            onClick={showSave}
            disabled={!ready || busy || loadState !== "ready"}
          >
            <Save size={15} />
            {t("library.saveCurrent")}
          </button>,
          saveHost,
        )}
      <div className="library-toolbar">
        <label className="search-field">
          <Search size={15} /><input aria-label={t("library.search")} placeholder={t("library.search")} value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <details className="library-display">
          <summary>{t("library.display")}</summary>
          <div className="library-display-menu">
            {(["list", "grid"] as const).map(view => <button key={view} aria-pressed={preferences.view === view} onClick={() => setPreferences(p => ({ ...p, view }))}>{t(`library.${view}`)}</button>)}
          </div>
        </details>
      </div>
      <div className="library-sections" role="group" aria-label={t("library.section")}>
        {(["basic", "examples", "mine"] as const).map(value => <button key={value} aria-pressed={!trash && section === value} onClick={() => {
          setSection(value); setTrash(false); setCategory("all"); setQuery("");
          setPreferences(p => ({ ...p, filter: "all" }));
        }}>{t(`library.${value}`)}</button>)}
      </div>
      {!trash && <p className="library-section-hint">{t(`library.${section}Hint`)}</p>}
      <div className="library-sources" role="group" aria-label={t("library.filter")}>
        {(["all", "favorites", "recent"] as const).map(filter => <button key={filter} aria-pressed={!trash && preferences.filter === filter} onClick={() => { setTrash(false); setPreferences(p => ({ ...p, filter })); }}>{t(`library.${filter}`)}{filter === "favorites" ? ` (${favoriteCount})` : ""}</button>)}
      </div>
      {!trash && <label className="library-category-select">
        <span>{t("library.category")}</span>
        <select aria-label={t("library.category")} value={category} onChange={event => setCategory(event.target.value)}>
          {["all", ...SOUND_CATEGORIES.filter(c => inSection.some(e => e.category === c))].map(c => <option key={c} value={c}>{t(`library.${c}`)}</option>)}
        </select>
      </label>}
      {!trash && <p className="library-builtin-count">{section === "basic" ? t("library.basicCount", basicCount, recordingCount) : section === "examples" ? t("library.exampleCount", BUILTIN_SOUNDS.filter(s => s.kind === "example").length) : t("library.mineCount", mine.length)}</p>}
      {busy && <p role="status" className="library-builtin-count">{t("library.processingSound")}</p>}
      {loadState === "error" && <div className="library-error" role="status"><p>{t("library.loadError")}</p><button className="text-button" onClick={() => void refresh()}>{t("library.retry")}</button></div>}
      {loadState === "loading" && <p role="status">{t("library.loading")}</p>}
      {trash && <div className="saved-library-heading">{t("library.trash")}<button className="text-button" onClick={() => setTrash(false)}>{t("library.back")}</button></div>}
      {groups.map(group => {
        const candidates = visible.filter(item => group === "results" || item.category === group);
        const buckets = new Map<string, CatalogEntry[]>();
        for (const item of candidates) {
          const key = item.builtin ? builtinToneKey(item.builtin) : item.key;
          buckets.set(key, [...(buckets.get(key) ?? []), item]);
        }
        if (!buckets.size) return null;
        return <details className="library-category-group" key={group} open>
          <summary>{t(`library.${group === "results" ? (trash ? "trash" : "recent") : group}`)} <span>{buckets.size}</span></summary>
          <div className={`saved-sound-list library-view-${preferences.view}`}>
            {[...buckets].map(([key, choices]) => {
              const item = choices.find(e => e.key === toneChoices[key]) ?? (preferences.filter === "recent" ? choices[0] : preferredBuiltin(choices));
              const entry = item.saved;
              const title = item.builtin && (item.builtin.kind === "instrument" || item.builtin.recordingGroup) ? builtinToneName(item.builtin) : item.name;
              return <article className="saved-sound" key={key} aria-label={title}>
                <div className="saved-sound-title">
                  <strong title={item.name}>{title}</strong>
                  {!trash && <div className="sound-card-tools">
                    <button className="icon-button" aria-label={t(preferences.favorites.includes(item.key) ? "library.unfavorite" : "library.favorite", item.name)} aria-pressed={preferences.favorites.includes(item.key)} onClick={() => toggleFavorite(item.key)}><Star size={15} fill={preferences.favorites.includes(item.key) ? "currentColor" : "none"} /></button>
                    <button className="icon-button" disabled={!ready || busy} aria-label={t("library.listen", item.name)} aria-pressed={playback === item.key} aria-busy={pendingPlayback === item.key} onClick={() => { if (playback !== item.key) remember(item.key); if (entry) onPlay(item.id); else if (item.builtin) onBuiltinPlay(item.id); else onPresetPlay(item.id); }}>{pendingPlayback === item.key ? <LoaderCircle size={14} className="spin"/> : playback === item.key ? <Square size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}</button>
                  </div>}
                </div>
                {item.builtin && (item.builtin.kind === "instrument" || (item.builtin.recordingGroup && choices.length > 1)) && <label className="library-tone-choice">
                  <span>{t(item.builtin.recordingGroup ? "library.recording" : item.builtin.tone ? "library.range" : "library.take")}</span>
                  <select aria-label={t(item.builtin.recordingGroup ? "library.recording" : item.builtin.tone ? "library.range" : "library.take")} value={item.key} disabled={busy} onChange={event => {
                    if (playback === item.key) onBuiltinPlay(item.id);
                    setToneChoices(prev => ({ ...prev, [key]: event.target.value }));
                  }}>{choices.map(choice => <option key={choice.key} value={choice.key}>{builtinChoiceName(choice.builtin!)}</option>)}</select>
                </label>}
                <Waveform data={item.waveform} label={item.name}/>
                <div className="preset-meta"><span title={item.description}>{item.description}</span><span>{item.duration.toFixed(2)} s</span></div>
                {item.builtin?.tone && <details className="library-tone-info"><summary>{t("library.rangeInfo")}</summary><p>{t("builtin.toneLimit", item.builtin.maxSourceSeconds)}</p></details>}
                {trash && entry ? <button className="secondary wide" disabled={busy} onClick={() => void action(async () => {
                  const nextName = copyName(entry.name);
                  const restored = nextName === entry.name ? entry : await renameSavedSound(entry.id, nextName);
                  await setSavedSoundDeleted(entry.id, false); updateEntry({ ...restored, deleted: false });
                })}>{t("library.restore")}</button> : <>
                  <div className="saved-sound-actions">
                    <button className="text-button" aria-label={t("library.insert")} disabled={busy || !ready || project.layers.length >= 16} onClick={() => void action(async () => { if (entry) await onInsert(item.id); else if (item.builtin) await onBuiltinInsert(item.id); else onPresetInsert(item.id); remember(item.key); })}><Plus size={14}/>{t(preferences.view === "grid" ? "library.addShort" : "library.insert")}</button>
                    <button className="text-button" aria-label={t("library.open")} disabled={busy || !ready} onClick={() => void action(async () => { if (entry) await onOpen(item.id); else if (item.builtin) await onBuiltinOpen(item.id); else onPreset(item.id); remember(item.key); })}>{t(preferences.view === "grid" ? "library.editShort" : "library.open")}</button>
                    {entry && <button className="icon-button" aria-label={t("library.more", item.name)} aria-expanded={expanded === entry.id} onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}><MoreHorizontal size={15}/></button>}
                  </div>
                  {entry && <>
                    {expanded === entry.id && (
                      <div className="saved-sound-menu">
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setName(entry.name);
                            setSaveCategory(entry.category ?? "uncategorized");
                            setDialogError("");
                            setDialog({ kind: "rename", entry });
                          }}
                        >
                          {t("library.rename")}
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              const sound = await readSavedSound(entry.id);
                              download(
                                JSON.stringify(sound),
                                `${safeFilename(sound.name)}.soundforge`,
                                "application/json",
                              );
                            })
                          }
                        >
                          <Download size={13} />
                          {t("library.export")}
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              if (playback === `library-${entry.id}`)
                                onPlay(entry.id);
                              await setSavedSoundDeleted(entry.id, true);
                              updateEntry({ ...entry, deleted: true });
                              onMessage("library.removed", entry.name);
                            })
                          }
                        >
                          {t("library.remove")}
                        </button>
                      </div>
                    )}
                  </>}
                </>}
              </article>;
            })}
          </div>
        </details>;
      })}
      {!visible.length && <p className="empty-copy">{t(trash ? "library.trashEmpty" : query.trim() || category !== "all" ? "library.noSavedMatch" : preferences.filter === "favorites" ? "library.favoritesEmpty" : preferences.filter === "recent" ? "library.recentEmpty" : "library.noSavedMatch")}</p>}
      {!trash && removed.length > 0 && <button className="text-button library-trash" onClick={() => setTrash(true)}>{t("library.trash")} ({removed.length})</button>}
      {dialog && (
        <dialog
          className="library-dialog"
          ref={dialogRef}
          aria-labelledby="library-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) closeDialog();
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="section-line">
              <h2 id="library-dialog-title">
                {t(
                  dialog.kind === "save"
                    ? "library.saveTitle"
                    : "library.rename",
                )}
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label={t("action.close")}
                disabled={busy}
                onClick={closeDialog}
              >
                <X size={17} />
              </button>
            </div>
            <label className="library-name-field">
              {t("library.name")}
              <input
                autoFocus
                required
                maxLength={120}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="library-name-field">{t("library.category")}
              <select value={saveCategory} disabled={busy} onChange={e => setSaveCategory(e.target.value as SoundCategory)}>{SOUND_CATEGORIES.map(c => <option key={c} value={c}>{t(`library.${c}`)}</option>)}</select>
            </label>
            <p className="field-help">
              {t(
                dialog.kind === "save" && duplicate
                  ? "library.duplicateHint"
                  : "library.snapshotHint",
              )}
            </p>
            {dialogError && (
              <p className="library-error" role="alert">
                {t(dialogError)}
              </p>
            )}
            <div className="library-dialog-actions">
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={closeDialog}
              >
                {t("action.cancel")}
              </button>
              {dialog.kind === "save" && duplicate && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !name.trim()}
                  onClick={() => void save(true)}
                >
                  {t("library.saveCopy")}
                </button>
              )}
              <button
                className="primary"
                type="submit"
                disabled={busy || !name.trim()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Save size={15} />
                )}
                {t(
                  dialog.kind === "rename"
                    ? "library.confirmRename"
                    : duplicate
                      ? "library.update"
                      : "library.confirmSave",
                )}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
