import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogTitle, WorkbenchNumberInput } from "@momo/workbench/react";
import { X } from "lucide-react";
import { t } from "./i18n";
import { BASIC_SYNTH, SYNTH_RANGES, type SynthDefinition } from "./synthesizers";
import { definitionName, definitionProject, parseDefinition, type SoundDefinition } from "./soundDefinitions";
import { listDefinitions, loadDefinition, saveDefinition, type DefinitionIndex } from "./definitionStorage";
import { makeLayer, makeProject, parseProject, uid, type Project, type SampleAsset } from "./model";
import { emptyScore } from "./instruments";
import { ScoreEditor } from "./ScoreEditor";
import { BUILTIN_SOUNDS, builtinSoundName, loadBuiltinSound } from "./builtinLibrary";
import { download, safeFilename } from "./storage";
import "./definition-editor.css";

type Kind = "synth" | "instrument";
const freshInstrument = (): Project => ({ ...makeProject(t("definition.untitledInstrument")),
  inputs: [makeLayer({ type: "instrument", name: t("definition.untitledInstrument"), duration: 2,
    score: emptyScore(), attack: 0, release: 0, decay: 0, cutoff: 22000, gain: 1 })] });
export function DefinitionEditor({ initial, currentAssets, bindingType, stale, onClose, onAdd, onBind, onPlay, onStop, onImportAudio }: {
  initial?: SoundDefinition; currentAssets: Project["assets"];
  bindingType?: Kind; stale: boolean;
  onClose: () => void; onAdd: (p: Project) => void; onBind: (d: SoundDefinition) => void;
  onPlay: (p: Project) => void; onStop: () => void;
  onImportAudio: (file: File) => Promise<SampleAsset>;
}) {
  const importInput = useRef<HTMLInputElement>(null), audioInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>(initial?.schema === "momo.instrument/v1" ? "instrument" : bindingType ?? "synth");
  const [synth, setSynth] = useState<SynthDefinition>(initial?.schema === "momo.synth/v1" ? initial : { ...structuredClone(BASIC_SYNTH), name: t("definition.defaultSynth") });
  const [instrumentProject, setInstrumentProject] = useState(() => initial?.schema === "momo.instrument/v1" ? definitionProject(initial) : freshInstrument());
  const [entries, setEntries] = useState<DefinitionIndex[]>([]), [query, setQuery] = useState("");
  const [savedId, setSavedId] = useState(""), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [status, setStatus] = useState(""), [pending, setPending] = useState<(() => void) | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void listDefinitions().then(setEntries).catch(() => setError(t("definition.storageError")));
    return () => { alive.current = false; onStop(); };
  }, []);
  const transition = (action: () => void) => { if (busy) return; if (dirty) setPending(() => action); else { onStop(); action(); } };
  const changed = () => { setDirty(true); setStatus(""); setError(""); onStop(); };
  const install = (raw: SoundDefinition, id = "") => {
    const d = parseDefinition(raw);
    setKind(d.schema === "momo.synth/v1" ? "synth" : "instrument");
    if (d.schema === "momo.synth/v1") setSynth(d); else setInstrumentProject(definitionProject(d));
    setSavedId(id); setDirty(false); setError(""); setStatus("");
  };
  const run = async (action: () => Promise<void>, storage = false) => {
    setBusy(true); setError("");
    try { await action(); } catch (e) {
      if (alive.current) setError(t(storage ? "definition.storageError" : e instanceof Error && e.message.startsWith("error.") ? e.message : "definition.invalid"));
    } finally { if (alive.current) setBusy(false); }
  };
  const definition = (): SoundDefinition => kind === "synth" ? parseDefinition(synth) : parseDefinition({
    schema: "momo.instrument/v1", instrument: instrumentProject.inputs[0].player.score?.instruments[0], assets: instrumentProject.assets,
  });
  const valid = kind === "synth" ? !!synth.name.trim() : !!instrumentProject.inputs[0].player.score?.instruments.length;
  const act = (fn: (d: SoundDefinition) => void) => { try { fn(definition()); } catch { setError(t("definition.invalid")); } };
  const save = (copy: boolean) => void run(async () => {
    const d = definition(), id = copy || !savedId ? uid() : savedId;
    if (d.schema === "momo.synth/v1") d.id = id; else d.instrument.id = id;
    await saveDefinition(d);
    if (!alive.current) return;
    install(d, id); setEntries(await listDefinitions()); setStatus(t("definition.saved"));
  }, true);
  const newDefinition = (nextKind: Kind) => transition(() => {
    setKind(nextKind); setSavedId(""); setError(""); setStatus(""); setDirty(false);
    if (nextKind === "synth") setSynth({ ...structuredClone(BASIC_SYNTH), id: uid(), name: t("definition.untitledSynth") });
    else setInstrumentProject(freshInstrument());
  });
  const loadBuiltinInstrument = (id: string) => transition(() => void run(async () => {
    const p = await loadBuiltinSound(id, builtinSoundName(BUILTIN_SOUNDS.find(s => s.id === id)!));
    if (alive.current) install({ schema: "momo.instrument/v1", instrument: p.inputs[0].player.score!.instruments[0], assets: p.assets });
  }));
  const assetAdd = (assets: Project["assets"]) => {
    // IDs from the current work cannot overwrite a different recording in this draft.
    const copied = Object.fromEntries(Object.values(assets).map(a => { const id = uid(); return [id, { ...a, id }]; }));
    const p = parseProject({ ...instrumentProject, assets: { ...instrumentProject.assets, ...copied } });
    changed(); setInstrumentProject(p);
  };
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const schema = kind === "synth" ? "momo.synth/v1" : "momo.instrument/v1";
  return <Dialog open onOpenChange={open => { if (!open) transition(onClose); }}>
    <DialogContent className="definition-editor" showCloseButton={false}>
    <header className="definition-header"><DialogTitle>{t("definition.title")}</DialogTitle>
      <Button variant="ghost" className="icon-button" aria-label={t("definition.close")} disabled={busy} onClick={() => transition(onClose)}><X size={18}/></Button></header>
    <fieldset disabled={busy} className="definition-layout">
      <aside className="definition-sidebar">
        <div className="button-group" role="group" aria-label={t("definition.title")}>
          {(["synth", "instrument"] as const).map(k => <Button variant="outline" key={k} aria-pressed={kind === k} disabled={busy}
            onClick={() => { if (kind !== k) newDefinition(k); }}>{t(`definition.${k}`)}</Button>)}
        </div>
        <Button variant="outline" disabled={busy} onClick={() => newDefinition(kind)}>{t(kind === "synth" ? "definition.newSynth" : "definition.newInstrument")}</Button>
        <input aria-label={t("definition.search")} placeholder={t("definition.search")} value={query} onChange={e => setQuery(e.target.value)}/>
        <div className="definition-list">
          <h3>{t("definition.my")}</h3>
          {!entries.some(e => e.schema === schema) && <p className="field-help">{t("definition.noSaved")}</p>}
          {entries.filter(e => e.schema === schema && matches(e.name)).map(e => <Button variant="outline" key={e.id} className="definition-entry" disabled={busy}
            aria-pressed={savedId === e.id} onClick={() => transition(() => void run(async () => { const d = await loadDefinition(e.id); if (alive.current) install(d, e.id); }, true))}>{e.name}</Button>)}
          <h3>{t("definition.builtin")}</h3>
          {kind === "synth" ? <Button variant="outline" className="definition-entry" disabled={busy} onClick={() => transition(() => install({ ...structuredClone(BASIC_SYNTH), name: t("definition.defaultSynth") }))}>{t("definition.defaultSynth")}</Button>
            : BUILTIN_SOUNDS.filter(s => s.kind === "instrument" && matches(builtinSoundName(s))).map(s => <Button variant="outline" className="definition-entry" disabled={busy} key={s.id} onClick={() => loadBuiltinInstrument(s.id)}>{builtinSoundName(s)}</Button>)}
        </div>
        <Button variant="outline" disabled={busy} onClick={() => transition(() => importInput.current?.click())}>{t("definition.import")}</Button>
      </aside>
      <main className="definition-content">
        <p>{t(kind === "synth" ? "definition.synthHelp" : "definition.instrumentHelp")}</p>
        <p className="field-help">{t("definition.snapshot")}</p>
        {kind === "synth" ? <>
          <label className="text-field"><span>{t("definition.name")}</span><input maxLength={120} value={synth.name} onChange={e => { changed(); setSynth({ ...synth, name: e.target.value }); }}/></label>
          <label className="text-field"><span>{t("definition.algorithm")}</span><select value={synth.algorithm} onChange={() => {}}><option value="oscillator-v1">{t("definition.oscillator")}</option></select></label>
          <p className="field-help">{t("definition.algorithmHint")}</p>
          <h3>{t("definition.defaults")}</h3>
          <div className="definition-parameters">
            <label className="text-field"><span>{t("prop.wave")}</span><select value={synth.defaults.wave} onChange={e => { changed(); setSynth({ ...synth, defaults: { ...synth.defaults, wave: e.target.value as SynthDefinition["defaults"]["wave"] } }); }}>
              {["sine", "triangle", "saw", "square", "noise"].map(w => <option key={w} value={w}>{t(`wave.${w}`)}</option>)}</select></label>
            {Object.entries(SYNTH_RANGES).map(([key, [min, max]]) => <label key={key} className="text-field"><span>{t(`prop.${key}`)}{["frequency", "endFrequency", "cutoff"].includes(key) ? " · Hz" : ["attack", "release"].includes(key) ? " · s" : ""}</span><WorkbenchNumberInput label={t(`prop.${key}`)}
              value={synth.defaults[key as keyof typeof SYNTH_RANGES]} min={min} max={max} step={key === "attack" || key === "release" ? 0.001 : 1}
              onValueCommit={v => { changed(); setSynth(s => ({ ...s, defaults: { ...s.defaults, [key]: v } })); }}/></label>) }
          </div>
        </> : <>
          <div className="button-group">
            <Button variant="outline" disabled={busy} onClick={() => audioInput.current?.click()}>{t("definition.importAudio")}</Button>
            <Button variant="outline" disabled={busy || !Object.keys(currentAssets).length} onClick={() => { try { assetAdd(currentAssets); } catch { setError(t("definition.invalid")); } }}>{t("definition.currentAudio")}</Button>
          </div>
          {!valid && <p className="field-help">{t("definition.emptyInstrument")}</p>}
          <ScoreEditor key={instrumentProject.inputs[0].id} definitionOnly project={instrumentProject} layer={instrumentProject.inputs[0]}
            onChange={p => { changed(); setInstrumentProject(p); }} onAudition={() => {}}/>
        </>}
      </main>
    </fieldset>
    {pending && <div className="definition-unsaved" role="alert"><span>{t("definition.dirty")}</span>
      <Button variant="outline" onClick={() => { const action = pending; setPending(null); setDirty(false); onStop(); action(); }}>{t("definition.discard")}</Button>
      <Button variant="outline" onClick={() => setPending(null)}>{t("definition.keep")}</Button></div>}
    {error && <p role="alert" className="warning-line">{error}</p>}
    {(status || busy) && <p role="status">{busy ? t("definition.loading") : status}</p>}
    <footer className="definition-footer">
      <p className="field-help">{t(bindingType ? "definition.bindHelp" : "definition.previewHelp")}</p>
      <div className="button-group">
        <Button variant="outline" disabled={busy || !valid} onClick={() => act(d => onPlay(definitionProject(d, true)))}>{t("definition.preview")}</Button>
        <Button variant="outline" onClick={onStop}>{t("definition.stop")}</Button>
        <Button variant="outline" disabled={busy || !valid} onClick={() => save(false)}>{t("definition.save")}</Button>
        {!!savedId && <Button variant="outline" disabled={busy || !valid} onClick={() => save(true)}>{t("definition.saveCopy")}</Button>}
        <Button variant="outline" disabled={busy || !valid} onClick={() => act(d => download(JSON.stringify(d, null, 2), safeFilename(definitionName(d)) + (kind === "synth" ? ".sfsynth" : ".sfinstrument"), "application/json"))}>{t("definition.export")}</Button>
        <Button variant="default" className="primary" disabled={busy || !valid || stale || (!!bindingType && bindingType !== kind)}
          onClick={() => act(d => { onStop(); if (bindingType) onBind(d); else onAdd(definitionProject(d)); })}>{t(bindingType ? "definition.bind" : "definition.add")}</Button>
      </div>
    </footer>
    <input ref={importInput} hidden type="file" accept=".sfsynth,.sfinstrument,.json" onChange={e => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (file) void run(async () => { if (file.size > 34 * 1024 * 1024) throw Error(); const d = parseDefinition(JSON.parse(await file.text())); if (alive.current) { install(d); setDirty(true); } });
    }}/>
    <input ref={audioInput} hidden type="file" accept="audio/*,.wav,.ogg,.mp3" onChange={e => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (file) void run(async () => { const asset = await onImportAudio(file); if (alive.current) assetAdd({ [asset.id]: asset }); });
    }}/>
    </DialogContent>
  </Dialog>;
}
