import { projectDocument } from './model';
import { timeAtPath, timeFromPath, fitPlayerRange, resetPlayerRange, playerDuration } from "./playerPlayback";
import {
  layerValue,
  withLayerValue,
  type LayerField,
  type LayerValue,
} from "./model";
import { patchLayer, type LayerPatch } from "./model";
import { NotesWorkspace } from "./NotesWorkspace";
import { Button } from "@momo/workbench/react";
import { HelpDialog } from "./HelpDialog";
import { SupportDialog } from "./SupportDialog";
import { AITools } from "./AITools";
import { useAIEditor } from "./useAIEditor";
import { ContentReplacementDialog } from "./ContentReplacementDialog";
import { ResourceManager } from "./SoundLibrary";
import { readSavedSound } from "./localSoundStorage";
import { bindDefinition, synthFromPlayer, parseDefinition, type SoundDefinition } from "./soundDefinitions";
import { localContentCandidate } from "./contentReplacement";
import { generateVariants } from "./aiCapabilities";
import { renderExport } from "./exportPipeline";
import { flushSync } from "react-dom";
import { VideoReferencePanel } from "./VideoReferencePanel";
import { appendInstrumentNode } from "./instrumentNode";
import { TreeTimeline } from "./TreeTimeline";
import { LayerToolbar } from "./LayerToolbar";
import { SoundPolish } from "./SoundPolish";
import {
  groupNodes,
  moveNodes,
  editNode,
  isolatedNode,
  nodeKey,
  normalizeGroups,
  nodeDocument,
  nodeParent,
  pathOffset,
  type NodeAddress,
} from "./nodeTree";
import { bypassEffects } from "./nodeEffects";
import { beforeSoundPolish, padAudition } from "./polishAudition";
import { ScoreEditor } from "./ScoreEditor";
import {
  noteEndSeconds,
  orderedNotes,
  selectRegion,
  type NoteEvent,
} from "./instruments";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Play,
  Square,
  Undo2,
  Redo2,
  FolderOpen,
  Save,
  Download,
  Plus,
  Upload,
  Volume2,
  X,
  Shuffle,
  Check,
  ChevronRight,
  LoaderCircle,
  Pause,
  SkipBack,
  FilePlus2,
} from "lucide-react";
import JSZip from "jszip";
import type { DockWorkspace } from "@momo/workbench/dock";
import { AppearancePreferences } from "./AppearancePreferences";
import { LanguagePreferences } from "./LanguagePreferences";
import { Workbench } from "./Workbench";
import { SoundLibrary } from "./SoundLibrary";
import { Inspector, Range, CommitText } from "./Inspector";
import { Waveform } from "./Waveform";
import { PlayheadTimeline } from "./PlayheadTimeline";
import { fromPreset } from "./presets";
import {
  BUILTIN_SOUNDS,
  builtinSoundName,
  loadBuiltinSound,
} from "./builtinLibrary";
import {
  SAMPLE_RATE,
  MAX_ASSET_BYTES,
  MAX_SAMPLE_FRAMES,
  clamp,
  encodeSamples,
  makeLayer,
  makeProject,
  parseProject,
  projectForSave,
  uid,
  assertProjectLimits,
  makeComposition,
  reusableInput,
  resolveProjectPath,
  updateProjectAtPath,
  type PlayerInput,
  type Project,
  type RenderResult,
} from "./model";
import { MacroEditor, exposeParameter } from "./AuthoringTools";
import { WaveformTools } from "./WaveformTools";
import { encodeAudio, AUDIO_MIME } from "./encodeAudio";
import { ExportDialog } from "./ExportDialog";
import { reconcileAdvanced, boundControl, resolveControls } from "./advanced";
import { boundedSelection } from "./timeline";
import {
  readExportSettings,
  contentRange,
  type ExportResult,
  audioResult,
  makeLoop,
  seamPreview,
  type ExportSettings,
} from "./exportAudio";
import { AudioPlayer, createRenderer } from "./audio";
import {
  download,
  readDraft,
  safeFilename,
  writeDraft,
} from "./storage";
import { language, t, useLanguage } from "./i18n";
type Variation = { project: Project; result: RenderResult };
const defaultProject = () => makeProject(t("file.untitled"));
const db = (v: number) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : "−∞");
function readBuiltinSound(id: string) {
  const sound = BUILTIN_SOUNDS.find((entry) => entry.id === id);
  if (!sound) throw Error("library.builtinLoadError");
  return loadBuiltinSound(id, builtinSoundName(sound));
}
export default function App() {
  const lang = useLanguage();
  const [replacement, setReplacement] = useState<{
    base: Project;
    address: NodeAddress;
  }>();
  const [librarySaveHost, setLibrarySaveHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [history, setHistory] = useState<{
    past: Project[];
    project: Project;
    future: Project[];
  }>(() => ({ past: [], project: nodeDocument(defaultProject()), future: [] }));
  const [editPath, setEditPath] = useState<string[]>([]);
  const [timelinePath, setTimelinePath] = useState<string[]>([]);
  const timelineScope = useMemo(() => resolveProjectPath(history.project, timelinePath), [history.project, timelinePath]);
  const context = useMemo(
    () => resolveProjectPath(history.project, editPath),
    [history.project, editPath],
  );
  const project = context.project,
    current = useRef(project),
    rootCurrent = useRef(history.project),
    pathRef = useRef(context.path);
  current.current = project;
  rootCurrent.current = history.project;
  pathRef.current = context.path;
  const [selected, setSelected] = useState("ice-0"),
    [ready, setReady] = useState(false),
    [saveState, setSaveState] = useState("status.loading"),
    [notice, setNotice] = useState<{
      key: string;
      values: unknown[];
    } | null>(null);
  const [rendered, setRendered] = useState<{
      project: Project;
      result: RenderResult;
      original: RenderResult;
      target: string;
    } | null>(null),
    [renderFailed, setRenderFailed] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null),
    [pendingPlayback, setPendingPlayback] = useState<string | null>(null),
    [loop, setLoop] = useState(false),
    [monitor, setMonitor] = useState(0.7),
    [progress, setProgress] = useState(0);
  const [cue, setCue] = useState(0);
  const [originalAudition, setOriginalAudition] = useState(false);
  useEffect(() => setOriginalAudition(false), [project, selected]);
  const [encodingStatus, setEncodingStatus] = useState("");
  const encodedCache = useRef<{
    project: Project;
    settings: string;
    promise: Promise<{
      output: ExportResult;
      bytes: Uint8Array<ArrayBuffer>;
    }>;
  } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [definitionEditor, setDefinitionEditor] = useState<{
    base: Project; path: string[]; id?: string; initial?: SoundDefinition;
    type?: "synth" | "instrument";
  }>();
  const [cropMode, setCropMode] = useState(false);
  const [selection, setSelection] = useState<string[]>([]),
    [zoom, setZoom] = useState(1),
    [snap, setSnap] = useState(true),
    [groupScale, setGroupScale] = useState(1);
  const selectionAnchor = useRef<string | null>(null);
  const selectedIds = selection.includes(selected)
    ? selection.filter((id) => project.inputs.some((l) => l.id === id))
    : project.inputs.some((layer) => layer.id === selected)
      ? [selected]
      : [];
  const [exportSettings, setExportSettings] =
    useState<ExportSettings>(readExportSettings);
  const [exportOutput, setExportOutput] = useState<ExportResult | null>(null);
  const [exportPreparing, setExportPreparing] = useState(false);
  const [exportPreparationError, setExportPreparationError] = useState("");
  const exportRenderCache = useRef<{
    project: Project;
    settings: string;
    signal?: AbortSignal;
    promise: Promise<ExportResult>;
  } | null>(null);
  const outputVersion = useRef(0);
  useEffect(() => {
    try {
      localStorage.setItem(
        "soundforge.export.v1",
        JSON.stringify(exportSettings),
      );
    } catch {
      /* Preferences are optional. */
    }
  }, [exportSettings]);
  useEffect(() => {
    setSelection([]);
    selectionAnchor.current = null;
  }, [JSON.stringify(context.path)]);
  useEffect(() => {
    outputVersion.current++;
    setExportOutput(null);
  }, [history.project, exportSettings]);
  const selectLayer = (
    id: string,
    event?: {
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
  ) => {
    if (event?.shiftKey) {
      const anchor = selectionAnchor.current ?? selected;
      const anchorIndex = project.inputs.findIndex((l) => l.id === anchor),
        b = project.inputs.findIndex((l) => l.id === id);
      const a = anchorIndex < 0 ? b : anchorIndex;
      selectionAnchor.current = project.inputs[a]?.id ?? id;
      setSelection(
        project.inputs
          .slice(Math.min(a, b), Math.max(a, b) + 1)
          .map((l) => l.id),
      );
    } else if (event?.ctrlKey || event?.metaKey) {
      selectionAnchor.current = id;
      const next = selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
      setSelection(next);
      setSelected(next.includes(id) ? id : (next[0] ?? ""));
      return;
    } else if (event || !selectedIds.includes(id)) {
      setSelection([id]);
      selectionAnchor.current = id;
    }
    setSelected(id);
  };
  const transformLayers = (p: Project, l: PlayerInput, next: LayerPatch) => {
    const ids = selectedIds.includes(l.id) ? selectedIds : [l.id];
    if (
      (Math.abs((next.start ?? l.start) - l.start) > 1e-6 ||
        Math.abs((next.duration ?? l.duration) - l.duration) > 1e-6) &&
      ids.some((id) => boundControl(p, id, "start"))
    )
      return p.inputs;
    return boundedSelection(p.inputs, ids, l, next, p.duration);
  };
  const [variations, setVariations] = useState<Variation[]>([]),
    [variationBase, setVariationBase] = useState<Project | null>(null),
    [amount, setAmount] = useState(0.35),
    [busy, setBusy] = useState(false),
    [ioBusy, setIoBusy] = useState(false);
  const menu = useRef<HTMLDivElement>(null),
    manager = useRef<DockWorkspace | null>(null),
    projectInput = useRef<HTMLInputElement>(null),
    sampleInput = useRef<HTMLInputElement>(null),
    compositionInput = useRef<HTMLInputElement>(null);
  const renderer = useRef<ReturnType<typeof createRenderer> | null>(null),
    player = useRef<AudioPlayer | null>(null),
    playToken = useRef(0),
    pendingPlaybackRef = useRef<string | null>(null),
    playbackDuration = useRef(1),
    loopRef = useRef(loop),
    cueRef = useRef(0),
    activePlaybackRef = useRef<string | null>(null),
    resumeSeekRef = useRef(false),
    scopeEpoch = useRef(0),
    editGroup = useRef({ key: "", time: 0 }),
    alive = useRef(true);
  loopRef.current = loop;
  const flash = useCallback(
    (key: string, ...values: unknown[]) => setNotice({ key, values }),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5500);
    return () => clearTimeout(timer);
  }, [notice]);
  const updateCue = useCallback((time: number) => {
    const value = Number.isFinite(time)
      ? clamp(time, 0, rootCurrent.current.duration)
      : 0;
    cueRef.current = value;
    setCue(value);
  }, []);
  const stop = useCallback(() => {
    if (activePlaybackRef.current === "main" && player.current)
      updateCue(player.current.position());
    playToken.current++;
    activePlaybackRef.current = null;
    resumeSeekRef.current = false;
    pendingPlaybackRef.current = null;
    player.current?.stop();
    setPendingPlayback(null);
    setPlaying(null);
    setProgress(0);
  }, [updateCue]);
  const editRoot = useCallback(
    (change: (p: Project) => Project, key = "") => {
      stop();
      const now = Date.now(),
        coalesce =
          key &&
          editGroup.current.key === key &&
          now - editGroup.current.time < 700;
      editGroup.current = { key, time: now };
      setHistory((h) => {
        let next: Project;
        try {
          next = change(h.project);
          if (next !== h.project)
            next = reconcileAdvanced(normalizeGroups(next));
          assertProjectLimits(next);
        } catch (error) {
          queueMicrotask(() =>
            flash(
              error instanceof Error && error.message.startsWith("error.")
                ? error.message
                : "error.project",
            ),
          );
          return h;
        }
        if (next === h.project) return h;
        return {
          past: coalesce ? h.past : [...h.past, h.project].slice(-50),
          project: next,
          future: [],
        };
      });
    },
    [stop, flash],
  );
  const edit = useCallback(
    (change: (p: Project) => Project, key = "") => {
      const path = [...pathRef.current];
      editRoot(
        (root) => updateProjectAtPath(root, path, change),
        key ? `${JSON.stringify(path)}:${key}` : "",
      );
    },
    [editRoot],
  );
  const undo = useCallback(() => {
    stop();
    editGroup.current = { key: "", time: 0 };
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            project: h.past.at(-1)!,
            future: [h.project, ...h.future],
          }
        : h,
    );
  }, [stop]);
  const redo = useCallback(() => {
    stop();
    editGroup.current = { key: "", time: 0 };
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.project],
            project: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
  }, [stop]);
  const ai = useAIEditor({
    project: history.project,
    ready,
    exportSettings,
    publishVariants: (base, items, path) => {
      stop();
      scopeEpoch.current++;
      setEditPath(path);
      setSelection([]);
      setSelected("");
      setVariations(items);
      setVariationBase(base);
      manager.current?.show("variants");
    },
    commit: (expected, next) => {
      if (rootCurrent.current !== expected) throw Error("ai.stale");
      stop();
      editGroup.current = { key: "", time: 0 };
      flushSync(() =>
        setHistory((h) => ({
          past: [...h.past, h.project].slice(-50),
          project: next,
          future: [],
        })),
      );
    },
    undo: () => flushSync(undo),
    redo: () => flushSync(redo),
  });
  const save = useCallback(() => {
    download(
      JSON.stringify(projectDocument(rootCurrent.current)),
      `${safeFilename(rootCurrent.current.name)}.soundforge`,
      "application/json",
    );
    flash("status.saved");
  }, [flash]);
  useEffect(() => {
    alive.current = true;
    renderer.current = createRenderer();
    player.current = new AudioPlayer();
    let cancelled = false;
    readDraft()
      .then((p) => {
        if (cancelled) return;
        if (p) {
          setHistory({ past: [], project: nodeDocument(p), future: [] });
          setSelected(p.inputs[0]?.id ?? "");
          flash("status.restored");
        }
        setSaveState("status.local");
      })
      .catch(() => {
        if (!cancelled) setSaveState("status.unavailable");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      alive.current = false;
      renderer.current?.dispose();
      player.current?.dispose();
    };
  }, [flash]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (context.path.length === editPath.length) return;
    stop();
    scopeEpoch.current++;
    setEditPath(context.path);
    updateCue(0);
    setVariations([]);
  }, [context, editPath.length, stop, updateCue]);
  useEffect(() => {
    updateCue(cueRef.current);
  }, [project.duration, updateCue]);
  useEffect(() => {
    if (!ready) return;
    setSaveState("status.saving");
    let cancelled = false;
    const timer = setTimeout(() => {
      writeDraft(history.project)
        .then(() => {
          if (!cancelled) setSaveState("status.local");
        })
        .catch(() => {
          if (!cancelled) setSaveState("status.unavailable");
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [history.project, ready]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setRenderFailed(false);
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        renderer
          .current!.render(history.project, abort.signal)
          .then(async (result) => {
            if (cancelled) return;
            const original = selected
              ? await renderer.current!.render(
                  beforeSoundPolish(history.project, {
                    path: context.path,
                    id: selected,
                  }),
                  abort.signal,
                )
              : result;
            const frames = Math.max(result.left.length, original.left.length);
            if (!cancelled)
              setRendered({
                project: history.project,
                result: padAudition(result, frames),
                original: padAudition(original, frames),
                target: nodeKey({ path: context.path, id: selected }),
              });
          })
          .catch((error) => {
            if (!cancelled) {
              setRenderFailed(true);
              flash(
                error?.message === "error.renderBudget"
                  ? "error.renderBudget"
                  : "error.render",
              );
            }
          });
      },
      history.project.duration > 10 ? 180 : 90,
    );
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [history.project, selected, JSON.stringify(context.path), ready, flash]);
  useEffect(() => {
    if (selected && !project.inputs.some((l) => l.id === selected))
      setSelected(project.inputs[0]?.id ?? "");
  }, [project, selected]);
  const play = useCallback(
    async (
      input: RenderResult | (() => Promise<RenderResult>),
      id: string,
      replace = false,
    ) => {
      if (
        !replace &&
        (activePlaybackRef.current === id || pendingPlaybackRef.current === id)
      ) {
        stop();
        return;
      }
      const replaceOffset = replace ? (player.current?.position() ?? 0) : 0;
      const token = ++playToken.current;
      if (activePlaybackRef.current === "main" && player.current)
        updateCue(player.current.position());
      player.current?.stop();
      activePlaybackRef.current = null;
      setPlaying(null);
      setProgress(0);
      pendingPlaybackRef.current = id;
      setPendingPlayback(id);
      let phase: "audio" | "render" = "audio";
      try {
        await player.current!.prepare();
        if (token !== playToken.current) return;
        phase = "render";
        const renderedAudio =
          typeof input === "function" ? await input() : input;
        const result = replace
          ? padAudition(
              renderedAudio,
              Math.round(playbackDuration.current * renderedAudio.sampleRate),
            )
          : renderedAudio;
        if (token !== playToken.current) return;
        phase = "audio";
        const duration = result.left.length / result.sampleRate;
        const offset = replace
          ? Math.min(
              replaceOffset,
              Math.max(0, duration - 1 / result.sampleRate),
            )
          : id === "main" && cueRef.current < duration - 1 / result.sampleRate
            ? cueRef.current
            : 0;
        const started = await player.current!.play(
          result,
          id.startsWith("loop-") || loopRef.current,
          monitor,
          () => {
            if (id === "main") updateCue(duration);
            activePlaybackRef.current = null;
            setPlaying(null);
            setProgress(0);
          },
          () => token === playToken.current,
          offset,
          id === "main" ? rootCurrent.current.loopRegion : undefined,
        );
        if (!started || token !== playToken.current) return;
        playbackDuration.current = result.left.length / result.sampleRate;
        activePlaybackRef.current = id;
        setPlaying(id);
        const startedAt = player.current!.position();
        setProgress(startedAt / duration);
        if (id === "main") updateCue(startedAt);
      } catch (error) {
        if (token === playToken.current)
          flash(
            error instanceof Error &&
              error.message === "library.builtinLoadError"
              ? error.message
              : phase === "render"
                ? "error.render"
                : "error.audio",
          );
      } finally {
        if (token === playToken.current) {
          pendingPlaybackRef.current = null;
          setPendingPlayback(null);
        }
      }
    },
    [playing, stop, loop, monitor, flash, updateCue],
  );
  const result = rendered?.project === history.project ? rendered.result : null;
  const comparisonReady =
    !!result &&
    rendered?.target === nodeKey({ path: context.path, id: selected });
  const auditionResult =
    originalAudition && comparisonReady ? rendered.original : result;
  // Keep the last waveform during edits, but never use it for playback/export.
  // Unrelated documents have new node IDs and must not inherit this preview.
  const sharesNode = (nodes: PlayerInput[], previous: Set<string>): boolean =>
    nodes.some(
      (node) =>
        previous.has(node.id) ||
        (node.player.mix &&
          sharesNode(node.player.mix.inputs, previous)),
    );
  const previousIds = new Set<string>();
  const collectIds = (nodes: PlayerInput[]) =>
    nodes.forEach((node) => {
      previousIds.add(node.id);
      if (node.player.mix) collectIds(node.player.mix.inputs);
    });
  if (rendered) collectIds(rendered.project.inputs);
  const displayResult =
    auditionResult ??
    (sharesNode(history.project.inputs, previousIds) ? rendered?.result : null);
  const timelineDuration = history.project.duration;
  const layerTimelineDuration = timelineScope.project.duration;
  const layerTimelineCue = timeAtPath(history.project, timelineScope.path, cue) ?? -1;
  const selectedScopeCue = timeAtPath(history.project, context.path, cue) ?? 0;
  const comparePolish = (original: boolean) => {
    if (
      !result ||
      !rendered ||
      !comparisonReady ||
      original === originalAudition
    )
      return;
    setOriginalAudition(original);
    // Both buffers are ready: replace playback at the current cursor, without changing the project.
    if (
      activePlaybackRef.current === "main" ||
      pendingPlaybackRef.current === "main"
    )
      void play(original ? rendered.original : result, "main", true);
    else if (activePlaybackRef.current?.startsWith("node-")) {
      const address = { path: context.path, id: selected };
      if (activePlaybackRef.current === `node-${nodeKey(address)}`) {
        const isolated = isolatedNode(history.project, address);
        if (original)
          isolated.inputs[0].player.effects = bypassEffects(
            isolated.inputs[0].player.effects,
          );
        void play(
          () => renderer.current!.render(isolated),
          `node-${nodeKey(address)}`,
          true,
        );
      }
    }
  };
  const beginSeek = () => {
    const resume =
      activePlaybackRef.current === "main" ||
      pendingPlaybackRef.current === "main";
    stop();
    resumeSeekRef.current = resume;
  };
  const endSeek = (time: number) => {
    updateCue(time);
    const resume = resumeSeekRef.current;
    resumeSeekRef.current = false;
    if (resume && result && time < timelineDuration)
      void play(auditionResult!, "main");
  };
  const rewind = () => {
    beginSeek();
    updateCue(0);
    endSeek(0);
  };
  const previewLayer = project.inputs.find(
    (layer) =>
      `node-${nodeKey({ path: context.path, id: layer.id })}` ===
      (playing ?? pendingPlayback),
  );
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const p = player.current;
      if (p?.context) {
        const time = p.position();
        setProgress(time / playbackDuration.current);
        if (playing === "main") updateCue(time);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [playing, updateCue]);
  useEffect(() => {
    player.current?.setVolume(monitor);
  }, [monitor]);
  useEffect(() => {
    if (activePlaybackRef.current === "main" && auditionResult) {
      // Restart at the current position so toggling outside the region also seeks into it.
      void play(auditionResult, "main", true);
      return;
    }
    player.current?.setLoop(
      activePlaybackRef.current?.startsWith("loop-") || loop,
    );
  }, [loop]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement,
        typing =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target.isContentEditable;
      if (
        e.defaultPrevented ||
        target.closest('[role="dialog"], dialog') ||
        document.querySelector("[data-slot=dialog-content][data-open]")
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (typing) return;
      if (e.code === "Space") {
        if (target.closest('button, [role="button"], summary')) return;
        e.preventDefault();
        if (playing || pendingPlayback) stop();
        else if (result) void play(auditionResult!, "main");
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [
    save,
    result,
    auditionResult,
    play,
    playing,
    pendingPlayback,
    stop,
    undo,
    redo,
  ]);
  const selectedLayer = project.inputs.find((l) => l.id === selected);
  const navigate = (path: string[]) => {
    stop();
    scopeEpoch.current++;
    const target = resolveProjectPath(rootCurrent.current, path);
    const returnSelection = pathRef.current[path.length];
    setEditPath(target.path);
    setTimelinePath(target.path);
    setSelected(returnSelection ?? target.project.inputs[0]?.id ?? "");
    updateCue(0);
    setVariations([]);
    manager.current?.show("editor");
  };
  const enterComposition = (id: string) => {
    const layer = current.current.inputs.find((l) => l.id === id);
    if (layer?.player.type !== "composition" || !layer.player.mix) return;
    stop();
    scopeEpoch.current++;
    setEditPath([...pathRef.current, id]);
    setTimelinePath([...pathRef.current, id]);
    setSelected(layer.player.mix.inputs[0]?.id ?? "");
    updateCue(0);
    setVariations([]);
    manager.current?.show("editor");
  };
  const wrapCurrent = () => {
    try {
      const grouped = groupNodes(
        rootCurrent.current,
        context.path,
        selectedIds,
        t("tree.group"),
      );
      editRoot(() => grouped.root);
      setSelected(grouped.id);
      setSelection([grouped.id]);
    } catch (error) {
      flash(error instanceof Error ? error.message : "error.project");
    }
  };
  const treeSelect = (
    address: NodeAddress,
    event?: {
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
  ) => {
    stop();
    if (JSON.stringify(address.path) === JSON.stringify(context.path))
      selectLayer(address.id, event);
    else {
      stop();
      setEditPath(address.path);
      setSelected(address.id);
      setSelection([address.id]);
    }
  };
  const treeMove = (
    path: string[],
    ids: string[],
    target: string[],
    before?: string,
  ) => {
    try {
      const next = moveNodes(rootCurrent.current, path, ids, target, before);
      editRoot(() => next);
      setEditPath(target);
      setSelected(ids[0]);
      setSelection(ids);
    } catch (error) {
      flash(error instanceof Error ? error.message : "error.project");
    }
  };
  const previewNode = (address: NodeAddress) => {
    const isolated = isolatedNode(rootCurrent.current, address);
    if (
      originalAudition &&
      nodeKey(address) === nodeKey({ path: context.path, id: selected })
    )
      isolated.inputs[0].player.effects = bypassEffects(isolated.inputs[0].player.effects);
    void play(
      () => renderer.current!.render(isolated),
      `node-${nodeKey(address)}`,
    );
  };
  const previewNote = (address: NodeAddress, note: NoteEvent) => {
    const isolated = isolatedNode(rootCurrent.current, address);
    const layer = isolated.inputs[0],
      score = layer.player.score;
    if (!score) return;
    // Resolve with the original ordering so round-robin audition matches the score.
    const counters = new Map<string, number>();
    let region;
    for (const n of orderedNotes(score)) {
      const chosen = selectRegion(
        score.instruments.find((i) => i.id === n.instrumentId),
        n,
        layer.player.noiseSeed,
        counters,
      );
      if (n.id === note.id) {
        region = chosen;
        break;
      }
    }
    const instrument = score.instruments.find(
      (i) => i.id === note.instrumentId,
    );
    if (!region || !instrument) {
      flash("roll.unmapped");
      return;
    }
    const single = { ...note, start: 0 };
    const duration = Math.max(
      0.1,
      noteEndSeconds(single, region, isolated.assets, score.bpm),
    );
    isolated.duration = duration;
    isolated.inputs = [
      {
        ...layer,
        duration, sourceStart: 0, sourceEnd: duration, speed: 1, reverse: false, loop: false,
        player: {
          ...layer.player,
          duration,
          attack: 0,
          release: 0,
          score: {
            ...score,
            instruments: [{ ...instrument, regions: [region] }],
            notes: [single],
          },
        },
      },
    ];
    void play(
      () => renderer.current!.render(isolated),
      `note-${nodeKey(address)}-${note.id}`,
    );
  };
  const saveCurrentSound = () => {
    download(
      JSON.stringify(
        projectDocument(
          context.path.length
            ? isolatedNode(history.project, {
                path: context.path.slice(0, -1),
                id: context.path.at(-1)!,
              })
            : history.project,
        ),
      ),
      `${safeFilename(current.current.name)}.soundforge`,
      "application/json",
    );
    flash("status.componentSaved");
  };
  async function openLibrarySound(id: string) {
    const next = await readSavedSound(id);
    editRoot(() => nodeDocument(next));
    scopeEpoch.current++;
    setEditPath([]);
    setTimelinePath([]);
    setSelected(next.inputs[0]?.id ?? "");
    updateCue(0);
    setVariations([]);
    manager.current?.show("editor");
  }
  async function insertLibrarySound(id: string) {
    const target = current.current,
      epoch = scopeEpoch.current,
      child = await readSavedSound(id);
    if (target !== current.current || epoch !== scopeEpoch.current)
      throw Error("error.scopeChanged");
    insertSound(child);
  }
  async function openBuiltinSound(id: string) {
    const target = rootCurrent.current,
      epoch = scopeEpoch.current;
    const next = await readBuiltinSound(id);
    if (target !== rootCurrent.current || epoch !== scopeEpoch.current)
      throw Error("error.scopeChanged");
    editRoot(() => nodeDocument(next));
    scopeEpoch.current++;
    setEditPath([]);
    setTimelinePath([]);
    setSelected(next.inputs[0]?.id ?? "");
    updateCue(0);
    setVariations([]);
    manager.current?.show("editor");
  }
  async function insertBuiltinSound(id: string) {
    const target = current.current,
      epoch = scopeEpoch.current;
    const child = await readBuiltinSound(id);
    if (target !== current.current || epoch !== scopeEpoch.current)
      throw Error("error.scopeChanged");
    insertSound(child);
  }
  function insertSound(child: Project) {
    if (current.current.inputs.length >= 16) throw Error("error.layers");
    if (
      child.inputs.length === 1 &&
      child.inputs[0].player.type === "instrument" &&
      !child.effects &&
      !child.echo &&
      !child.controls?.length
    ) {
      const layerId = uid();
      const append = (p: Project) => appendInstrumentNode(p, child, layerId);
      assertProjectLimits(
        updateProjectAtPath(rootCurrent.current, pathRef.current, append),
      );
      edit(append);
      setSelected(layerId);
      manager.current?.show("inspector");
      return;
    }
    const { input: layer, assets } = reusableInput(nodeDocument(child)),
      append = (p: Project) => ({
        ...p,
        assets: { ...p.assets, ...assets },
        duration: Math.max(p.duration, layer.duration),
        inputs: [...p.inputs, layer],
      });
    assertProjectLimits(
      updateProjectAtPath(rootCurrent.current, pathRef.current, append),
    );
    edit(append);
    setSelected(layer.id);
    manager.current?.show("editor");
    flash("status.compositionImported", child.name);
  }
  const changeLayer = (key: LayerField, value: LayerValue) =>
    edit(
      (p) => ({
        ...p,
        inputs: p.inputs.map((l) =>
          l.id === selected && !boundControl(p, l.id, key)
            ? withLayerValue(
                l,
                key,
                value,
              )
            : l,
        ),
      }),
      `${selected}:${key}`,
    );
  const changeProject = (
    key: "duration" | "master" | "echo" | "seed",
    value: number,
  ) => edit((p) => ({ ...p, [key]: value }), key);
  const setPreset = (id: string) => {
    const next = nodeDocument(
      fromPreset(id, t(`preset.${id}`), (key) => t(`layer.${key}`)),
    );
    editRoot(() => nodeDocument(next));
    scopeEpoch.current++;
    setEditPath([]);
    setTimelinePath([]);
    setVariations([]);
    setSelection([]);
    updateCue(0);
    setSelected(next.inputs[0].id);
    manager.current?.show("editor");
  };
  const addSynth = () => {
    if (project.inputs.length >= 16) {
      flash("error.layers");
      return;
    }
    const l = makeLayer({ name: t("layer.new") });
    edit((p) => ({ ...p, inputs: [...p.inputs, l] }));
    setSelected(l.id);
    manager.current?.show("inspector");
  };
  const duplicate = () => {
    const inputs = resolveControls(project).inputs.filter((l) =>
      selectedIds.includes(l.id),
    );
    if (!inputs.length || project.inputs.length + inputs.length > 16) {
      flash("error.layers");
      return;
    }
    const copies = inputs.map((l) => ({
      ...structuredClone(l),
      id: uid(),
      name: `${l.name} ${t("layer.copy")}`.slice(0, 120),
    }));
    edit((p) => ({ ...p, inputs: [...p.inputs, ...copies] }));
    setSelection(copies.map((l) => l.id));
    setSelected(copies[0].id);
  };
  const removeLayers = (ids: string[]) => {
    if (!project.inputs.some((layer) => ids.includes(layer.id))) return;
    edit((p) => ({
      ...p,
      inputs: p.inputs.filter((layer) => !ids.includes(layer.id)),
    }));
    setSelection([]);
    setSelected("");
    selectionAnchor.current = null;
  };
  const removeNode = (address: NodeAddress) => {
    editRoot((root) => {
      const next = structuredClone(root),
        parent = nodeParent(next, address.path);
      parent.inputs = parent.inputs.filter((layer) => layer.id !== address.id);
      return next;
    });
    const removesContext = [...address.path, address.id].every(
      (id, index) => context.path[index] === id,
    );
    if (removesContext) {
      scopeEpoch.current++;
      setEditPath(address.path);
      setSelection([]);
      setSelected("");
      selectionAnchor.current = null;
    } else if (JSON.stringify(address.path) === JSON.stringify(context.path)) {
      const remaining = selectedIds.filter((id) => id !== address.id);
      setSelection(remaining);
      if (selected === address.id) setSelected(remaining[0] ?? "");
      if (selectionAnchor.current === address.id)
        selectionAnchor.current = null;
    }
  };
  function finalOutput(
    p: Project,
    settings = exportSettings,
    signal?: AbortSignal,
  ): Promise<ExportResult> {
    const key = JSON.stringify(settings),
      cached = exportRenderCache.current;
    if (
      cached?.project === p &&
      cached.settings === key &&
      !cached.signal?.aborted
    )
      return cached.promise;
    const promise = renderExport(p, settings, (project) =>
      renderer.current!.render(project, signal),
    );
    exportRenderCache.current = { project: p, settings: key, signal, promise };
    promise.catch(() => {
      if (exportRenderCache.current?.promise === promise)
        exportRenderCache.current = null;
    });
    return promise;
  }
  useEffect(() => {
    if (!exportOpen) return;
    const controller = new AbortController();
    setExportPreparing(true);
    setExportPreparationError("");
    setExportOutput(null);
    void finalOutput(history.project, exportSettings, controller.signal)
      .then((output) => {
        if (!controller.signal.aborted) setExportOutput(output);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setExportPreparationError(
            error instanceof Error && error.message === "error.renderBudget"
              ? error.message
              : "error.render",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setExportPreparing(false);
      });
    return () => controller.abort();
  }, [exportOpen, history.project, exportSettings]);
  async function encodedOutput(p: Project, settings = exportSettings) {
    const key = JSON.stringify(settings),
      cached = encodedCache.current;
    if (cached?.project === p && cached.settings === key) return cached.promise;
    const promise = (async () => {
      try {
        const output = await finalOutput(p, settings);
        const bytes = await encodeAudio(output, settings, setEncodingStatus);
        return { output, bytes };
      } finally {
        setEncodingStatus("");
      }
    })();
    encodedCache.current = { project: p, settings: key, promise };
    promise.catch(() => {
      if (encodedCache.current?.promise === promise)
        encodedCache.current = null;
    });
    return promise;
  }
  async function exportCurrent() {
    setIoBusy(true);
    const version = outputVersion.current;
    try {
      const { output, bytes } = await encodedOutput(history.project);
      if (version === outputVersion.current) setExportOutput(output);
      download(
        bytes,
        `${safeFilename(exportSettings.prefix || history.project.name)}_01.${exportSettings.format}`,
        AUDIO_MIME[exportSettings.format],
      );
      flash("status.exported");
    } catch {
      flash("error.encode");
    } finally {
      setIoBusy(false);
    }
  }
  const auditionExport = () => {
    const version = outputVersion.current;
    void play(async () => {
      const { output, bytes } = await encodedOutput(history.project);
      let preview: ExportResult = output;
      if (exportSettings.format !== "wav") {
        const decoded = await player.current!.decode(
          new Uint8Array(bytes).buffer,
        );
        preview = audioResult(
          new Float32Array(decoded.getChannelData(0)),
          new Float32Array(
            decoded.getChannelData(decoded.numberOfChannels > 1 ? 1 : 0),
          ),
          decoded.sampleRate,
        );
        preview.exportInfo = output.exportInfo;
        preview.tailLimited = output.tailLimited;
        preview.sourcePeak = output.sourcePeak;
        preview.gainReduction = output.gainReduction;
      }
      if (version === outputVersion.current) setExportOutput(preview);
      return preview;
    }, "export-preview");
  };
  const auditionLoop = (seam = false) => {
    if (!result || !history.project.loopRegion) return;
    const audio = makeLoop(result, history.project.loopRegion);
    void play(
      seam ? seamPreview(audio) : audio,
      seam ? "loop-seam" : "loop-region",
    );
  };
  async function openProject(file?: File) {
    if (!file) return;
    setIoBusy(true);
    try {
      if (file.size > 36 * 1024 * 1024) throw Error("error.fileSize");
      const next = nodeDocument(parseProject(JSON.parse(await file.text())));
      editRoot(() => next);
      scopeEpoch.current++;
      setEditPath([]);
    setTimelinePath([]);
      updateCue(0);
      setSelected(next.inputs[0]?.id ?? "");
      setVariations([]);
      manager.current?.show("editor");
      flash("status.opened");
    } catch (e) {
      flash(
        e instanceof Error && e.message === "error.fileSize"
          ? e.message
          : "error.project",
      );
    } finally {
      setIoBusy(false);
    }
  }
  async function importComposition(file?: File) {
    if (!file) return;
    setIoBusy(true);
    const path = [...pathRef.current];
    try {
      if (file.size > 36 * 1024 * 1024) throw Error("error.fileSize");
      const child = parseProject(JSON.parse(await file.text()));
      if (JSON.stringify(path) !== JSON.stringify(pathRef.current))
        throw Error("error.scopeChanged");
      if (current.current.inputs.length >= 16) throw Error("error.layers");
      const { input: layer, assets } = reusableInput(child);
      const append = (p: Project) => ({
        ...p,
        assets: { ...p.assets, ...assets },
        duration: Math.max(p.duration, layer.duration),
        inputs: [...p.inputs, layer],
      });
      assertProjectLimits(
        updateProjectAtPath(rootCurrent.current, path, append),
      );
      edit(append);
      setSelected(layer.id);
      manager.current?.show("editor");
      flash("status.compositionImported", child.name);
    } catch (error) {
      flash(
        error instanceof Error && error.message.startsWith("error.")
          ? error.message
          : "error.project",
      );
    } finally {
      setIoBusy(false);
    }
  }
  async function importSample(file?: File) {
    if (!file) return;
    if (current.current.inputs.length >= 16) {
      flash("error.layers");
      return;
    }
    setIoBusy(true);
    const importPath = [...pathRef.current];
    try {
      if (file.size > 24 * 1024 * 1024) throw Error("error.fileSize");
      const data = await file.arrayBuffer(),
        buffer = await player.current!.decode(data);
      if (
        buffer.length > MAX_SAMPLE_FRAMES ||
        buffer.length * Math.min(2, buffer.numberOfChannels) * 4 >
          MAX_ASSET_BYTES
      )
        throw Error("error.budget");
      if (JSON.stringify(importPath) !== JSON.stringify(pathRef.current))
        throw Error("error.scopeChanged");
      const id = uid(),
        channels = Array.from(
          { length: Math.min(2, buffer.numberOfChannels) },
          (_, i) => encodeSamples(buffer.getChannelData(i)),
        ),
        asset = {
          id,
          name: file.name.slice(0, 120) || "sample",
          sampleRate: buffer.sampleRate,
          channels,
        };
      if (current.current.inputs.length >= 16) throw Error("error.layers");
      const p = current.current,
        total =
          Object.values(projectForSave(p).assets).reduce(
            (sum, a) =>
              sum + a.channels.reduce((s, c) => s + c.length * 0.75, 0),
            0,
          ) + channels.reduce((s, c) => s + c.length * 0.75, 0);
      if (total > MAX_ASSET_BYTES) throw Error("error.budget");
      const layer = makeLayer({
        name:
          file.name.replace(/\.[^.]+$/, "").slice(0, 120) || t("editor.sample"),
        type: "sample",
        assetId: id,
        frequency: 440,
        endFrequency: 440,
        duration: Math.max(0.01, buffer.duration),
        gain: 0.8,
        decay: 0,
        release: 0.02,
        attack: 0.002,
      });
      const append = (p: Project) => ({
        ...p,
        duration: Math.max(p.duration, buffer.duration + 0.05),
        assets: { ...projectForSave(p).assets, [id]: asset },
        inputs: [...p.inputs, layer],
      });
      assertProjectLimits(
        updateProjectAtPath(rootCurrent.current, importPath, append),
      );
      edit(append);
      setSelected(layer.id);
      manager.current?.show("editor");
      flash("status.imported", file.name);
    } catch (e) {
      flash(
        e instanceof Error && e.message.startsWith("error.")
          ? e.message
          : "error.sample",
      );
    } finally {
      setIoBusy(false);
    }
  }
  async function importReplacement(file: File) {
    if (file.size > MAX_ASSET_BYTES) throw Error("error.fileSize");
    const buffer = await player.current!.decode(await file.arrayBuffer());
    if (
      buffer.length > MAX_SAMPLE_FRAMES ||
      buffer.length * Math.min(2, buffer.numberOfChannels) * 4 > MAX_ASSET_BYTES
    )
      throw Error("error.budget");
    return localContentCandidate(
      {
        id: uid(),
        name: file.name.slice(0, 120),
        sampleRate: buffer.sampleRate,
        channels: Array.from(
          { length: Math.min(2, buffer.numberOfChannels) },
          (_, i) => encodeSamples(buffer.getChannelData(i)),
        ),
      },
      Math.max(0.01, buffer.duration),
    );
  }
  async function generate() {
    if (!renderer.current || busy) return;
    ai.invalidateVariants();
    stop();
    setBusy(true);
    const base = current.current,
      items: Variation[] = [];
    const epoch = scopeEpoch.current;
    try {
      for (const next of generateVariants(base, { amount })) {
        items.push({
          project: next,
          result: await renderer.current.render(next),
        });
      }
      if (alive.current && epoch === scopeEpoch.current) {
        ai.invalidateVariants();
        setVariations(items);
        setVariationBase(base);
      }
    } catch {
      flash("error.render");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function exportPack() {
    setIoBusy(true);
    try {
      const zip = new JSZip(),
        manifest: {
          file: string;
          project: string;
          seed: number;
          sampleRate: number;
          duration: number;
        }[] = [];
      for (const [i, v] of variations.entries()) {
        const name = `${safeFilename(exportSettings.prefix || v.project.name)}_${String(i + 1).padStart(2, "0")}`;
        const { output, bytes } = await encodedOutput(
          v.project,
          exportSettings,
        );
        zip.file(`${name}.${exportSettings.format}`, bytes);
        zip.file(
          `${name}.soundforge`,
          JSON.stringify(projectDocument(v.project)),
        );
        manifest.push({
          file: `${name}.${exportSettings.format}`,
          project: `${name}.soundforge`,
          seed: v.project.seed,
          sampleRate: output.sampleRate,
          duration: output.left.length / output.sampleRate,
        });
      }
      zip.file(
        "manifest.json",
        JSON.stringify(
          {
            schema: "momo.soundforge-pack/v1",
            format: exportSettings.format,
            channels: exportSettings.mono ? 1 : 2,
            settings: exportSettings,
            variations: manifest,
          },
          null,
          2,
        ),
      );
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
      });
      download(
        blob,
        `${safeFilename(variationBase?.name ?? "sound")}-variations.zip`,
        "application/zip",
      );
      flash("status.pack");
    } catch {
      flash("status.error");
    } finally {
      setIoBusy(false);
    }
  }
  const fullContentEnd = result
    ? contentRange(history.project, result).tailEnd
    : history.project.duration;
  const extendedDuration = Math.max(
    history.project.duration,
    Math.ceil(fullContentEnd * 1000) / 1000,
  );
  const truncated =
    !!result &&
    fullContentEnd > history.project.duration + 1 / result.sampleRate;
  const compareName = project.inputs.find((l) => l.id === selected)?.name ?? "";
  const openResourceProject = (next: Project) => {
    stop(); editRoot(() => nodeDocument(next)); scopeEpoch.current++;
    setEditPath([]); setTimelinePath([]); setSelected(next.inputs[0]?.id ?? "");
    updateCue(0); setVariations([]); manager.current?.show("editor");
  };
  const resourceProps = {
    project: history.project, ready: ready && !ioBusy, playback: playing ?? pendingPlayback,
    currentAssets: project.assets,
    onInsert: insertSound, onOpen: openResourceProject,
    onPreview: (p: Project, key: string) => { void play(() => renderer.current!.render(p), key); },
    onStop: stop, onRender: (p: Project) => renderer.current!.render(p),
    onImportAudio: async (file: File): Promise<Project> => {
      const c = await importReplacement(file);
      return {...makeProject(c.name), duration:c.duration, assets:c.assets, inputs:[makeLayer({name:c.name, player:c.player, gain:1})]};
    },
  };
  const library = <SoundLibrary {...resourceProps} saveHost={librarySaveHost}/>;
  const editor = (
    <div className="editor-content">
      {timelineScope.path.length > 0 && (
        <div className="composition-navigation">
          <nav aria-label={t("composition.breadcrumbs")}>
            {timelineScope.breadcrumbs.map((item, index) => (
              <span key={index}>
                {index > 0 && <ChevronRight size={13} />}{" "}
                {index === timelineScope.breadcrumbs.length - 1 ? (
                  <span aria-current="page">{item.name}</span>
                ) : (
                  <button
                    className="text-button"
                    aria-label={
                      index === 0
                        ? t("composition.backRoot")
                        : t("composition.backTo", item.name)
                    }
                    onClick={() => navigate(item.path)}
                  >
                    {item.name}
                  </button>
                )}
              </span>
            ))}
          </nav>
          <button className="text-button" onClick={saveCurrentSound}>
            <Save size={14} />
            {t("composition.saveCurrent")}
          </button>
        </div>
      )}
      <div className="project-heading">
        <div>
          <span className="eyebrow">
            Momo Sound Forge <span className="version">/ 0.1</span>
          </span>
          <h1>
            <CommitText
              className="project-name"
              value={history.project.name}
              label={t("editor.name")}
              onCommit={(v) => editRoot((p) => ({ ...p, name: v }))}
            />
          </h1>
        </div>
        <div className="project-actions">
          <span className="format-label">
            {t(
              "pro.format",
              exportSettings.sampleRate / 1000,
              t(exportSettings.mono ? "pro.mono" : "pro.stereo"),
              exportSettings.format.toUpperCase(),
            )}
          </span>
          <div className="project-action-buttons">
            <Button
              variant="outline"
              onClick={() => {
                const dock = manager.current;
                if (!dock) return;
                if (dock.has("video")) dock.show("video");
                else dock.control([{ action: "preset", preset: "video" }]);
              }}
            >
              {t("video.title")}
            </Button>
            <div ref={setLibrarySaveHost} />
          </div>
        </div>
      </div>
      <div className="transport">
        <button
          className="primary play-button momo-button"
          data-variant="primary"
          disabled={!result && !playing && !pendingPlayback}
          onClick={() =>
            playing || pendingPlayback
              ? stop()
              : result && void play(auditionResult!, "main")
          }
        >
          {playing === "main" ? (
            <Pause size={16} fill="currentColor" />
          ) : playing || pendingPlayback ? (
            <Square size={16} fill="currentColor" />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
          {t(
            playing === "main"
              ? "action.pause"
              : playing || pendingPlayback
                ? "action.stop"
                : "action.play",
          )}
        </button>
        <button
          className="icon-button"
          aria-label={t("action.rewind")}
          title={t("action.rewind")}
          disabled={!ready}
          onClick={rewind}
        >
          <SkipBack size={16} />
        </button>
        <label className="check-field">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
          />
          {t("editor.loop")}
        </label>
        <span className="transport-spacer" />
        <label className="monitor" title={t("editor.gain")}>
          <Volume2 size={15} />
          <input
            type="range"
            min="0"
            max="1"
            step=".01"
            value={monitor}
            aria-label={t("editor.gain")}
            onChange={(e) => setMonitor(e.target.valueAsNumber)}
          />
        </label>
        <span className="time-readout">
          {(previewLayer ? progress * playbackDuration.current : cue).toFixed(
            3,
          )}{" "}
          <span>/ {timelineDuration.toFixed(2)} s</span>
        </span>
      </div>
      <div className="mix-area">
        <div className="section-line">
          <span>
            {t("editor.mix")}
            {originalAudition && ` · ${t("polish.original")}`}
          </span>
          <span>
            {auditionResult
              ? `${t("editor.peak")} ${db(auditionResult.peak)} dBFS`
              : t(renderFailed ? "error.render" : "editor.rendering")}
          </span>
        </div>
        <PlayheadTimeline
          duration={timelineDuration}
          loopRegion={history.project.loopRegion}
          position={cue}
          left={displayResult?.left}
          right={displayResult?.right}
          disabled={!auditionResult}
          version={history.project}
          onLoopBegin={stop}
          onLoopChange={(loopRegion) =>
            editRoot((p) => ({
              ...p,
              loopRegion: {
                ...p.loopRegion!,
                ...loopRegion,
                crossfade: Math.min(
                  p.loopRegion?.crossfade ?? 0,
                  (loopRegion.end - loopRegion.start) / 2,
                ),
              },
            }))
          }
          onSeekStart={beginSeek}
          onSeek={updateCue}
          onSeekEnd={endSeek}
        />
        <div className="mix-foot">
          <span>{t("editor.shortcut")}</span>
          <span>
            {previewLayer
              ? t("editor.previewing", previewLayer.name)
              : auditionResult && auditionResult.gainReduction < 0.999
                ? t(
                    "editor.headroom",
                    (-20 * Math.log10(auditionResult.gainReduction)).toFixed(1),
                  )
                : t(auditionResult ? "editor.ready" : "editor.rendering")}
          </span>
        </div>
        <WaveformTools
          project={history.project}
          cue={cue}
          ready={!!result}
          busy={!result || ioBusy}
          truncated={truncated}
          extendedDuration={extendedDuration}
          tailLimited={!!result?.tailLimited}
          onChange={(next) => editRoot(() => next)}
          onLoop={() => auditionLoop()}
          onSeam={() => auditionLoop(true)}
        />
      </div>
      <div className="layers-heading">
        <div className="layer-title-status">
          <h2>{timelineScope.path.length ? t("player.localTimeline", timelineScope.project.name) : t("tree.title")}</h2>
          <span
            className="field-help"
            role="status"
            title={
              !auditionResult
                ? t("tree.waveUpdating")
                : originalAudition && comparisonReady
                  ? t("tree.waveBefore", compareName)
                  : t("tree.waveAfter")
            }
          >
            {!auditionResult
              ? t("tree.waveUpdating")
              : t(
                  originalAudition && comparisonReady
                    ? "tree.waveBeforeShort"
                    : "tree.waveAfterShort",
                )}
          </span>
        </div>
        <div className="button-group">
          <button
            className="text-button"
            onClick={() => compositionInput.current?.click()}
            disabled={ioBusy || project.inputs.length >= 16}
          >
            <FilePlus2 size={15} />
            {t("composition.import")}
          </button>
          <button
            className="text-button"
            disabled={project.inputs.length >= 16}
            onClick={() => { stop(); setDefinitionEditor({ base: rootCurrent.current, path: [...pathRef.current] }); }}
          >
            <Plus size={15} />
            {t("resources.use")}
          </button>
          <button
            className="text-button"
            disabled={ioBusy || project.inputs.length >= 16}
            onClick={() => sampleInput.current?.click()}
          >
            <Upload size={15} />
            {t("file.import")}
          </button>
        </div>
      </div>
      <TreeTimeline
        renderToolbar={(tools) => (
          <LayerToolbar
            {...tools}
            path={context.path}
            ids={selectedIds}
            cropMode={cropMode}
            onCrop={() => setCropMode((value) => !value)}
            canResetCrop={
              !!selectedLayer &&
              ((selectedLayer.sourceStart ?? 0) > 0 ||
                selectedLayer.sourceEnd < playerDuration(selectedLayer.player))
            }
            onResetCrop={() =>
              edit((p) => ({
                ...p,
                inputs: p.inputs.map((l) =>
                  l.id === selected
                    ? resetPlayerRange(l)
                    : l,
                ),
              }))
            }
            snap={snap}
            onSnap={setSnap}
            zoom={zoom}
            onZoom={setZoom}
            duration={layerTimelineDuration}
            canDuplicate={!!selectedLayer}
            onDuplicate={duplicate}
            canGroup={!!selectedIds.length && ready}
            onGroup={wrapCurrent}
            onDelete={() => removeLayers(selectedIds)}
            onMove={(target) => treeMove(context.path, selectedIds, target)}
            waveformHelp={
              !auditionResult
                ? t("tree.waveUpdating")
                : originalAudition && comparisonReady
                  ? t("tree.waveBefore", compareName)
                  : t("tree.waveAfter")
            }
            tailLimited={!!result?.tailLimited}
          >
            <button
              className="secondary"
              disabled={!selectedLayer}
              onClick={() =>
                edit((p) => ({
                  ...p,
                  inputs: transformLayers(p, selectedLayer!, { start: selectedScopeCue }),
                }))
              }
            >
              {t("pro.moveToCue")}
            </button>
            <button
              className="secondary"
              disabled={selectedIds.length < 2}
              onClick={() =>
                edit((p) => ({
                  ...p,
                  inputs: p.inputs.map((l) =>
                    selectedIds.includes(l.id) &&
                    !boundControl(p, l.id, "start")
                      ? {
                          ...l,
                          start: Math.max(
                            0,
                            Math.min(selectedScopeCue, p.duration - l.duration),
                          ),
                        }
                      : l,
                  ),
                }))
              }
            >
              {t("pro.alignStart")}
            </button>
            <button
              className="secondary"
              disabled={selectedIds.length < 2}
              onClick={() =>
                edit((p) => ({
                  ...p,
                  inputs: p.inputs.map((l) =>
                    selectedIds.includes(l.id) &&
                    !boundControl(p, l.id, "start")
                      ? { ...l, start: Math.max(0, selectedScopeCue - l.duration) }
                      : l,
                  ),
                }))
              }
            >
              {t("pro.alignEnd")}
            </button>
            <label>
              {t("pro.groupScale")}
              <input
                type="number"
                min={0.1}
                max={4}
                step={0.01}
                value={groupScale}
                onChange={(e) => {
                  const v = e.target.valueAsNumber;
                  if (Number.isFinite(v)) setGroupScale(clamp(v, 0.1, 4));
                }}
              />
            </label>
            <button
              className="secondary"
              disabled={!selectedLayer}
              onClick={() => {
                if (selectedLayer)
                  edit((p) => ({
                    ...p,
                    inputs: transformLayers(p, selectedLayer, {
                      duration: selectedLayer.duration * groupScale,
                    }),
                  }));
              }}
            >
              {t("action.apply")}
            </button>
          </LayerToolbar>
        )}
        root={history.project}
        viewPath={timelineScope.path}
        selected={{ path: context.path, id: selected }}
        ids={selectedIds}
        result={displayResult ?? null}
        beforeKey={
          originalAudition && comparisonReady
            ? nodeKey({ path: context.path, id: selected })
            : undefined
        }
        ready={!!auditionResult}
        cue={layerTimelineCue}
        duration={layerTimelineDuration}
        zoom={zoom}
        cropMode={cropMode}
        playing={playing}
        previewTime={progress * playbackDuration.current}
        onSelect={treeSelect}
        onClearSelection={() => {
          setSelection([]);
          setSelected("");
          selectionAnchor.current = null;
        }}
        onDeleteSelection={() => removeLayers(selectedIds)}
        onDeleteNode={removeNode}
        onPatch={(address, patch) =>
          editRoot((root) => editNode(root, address, patch))
        }
        onTiming={(address, patch) =>
          editRoot((root) => {
            const parent = nodeParent(root, address.path),
              active = parent.inputs.find((l) => l.id === address.id)!;
            const inputs = transformLayers(
              {
                ...parent,
                duration: Math.max(
                  parent.duration,
                  layerTimelineDuration - (pathOffset(root, address.path) - pathOffset(root, timelineScope.path)),
                ),
              },
              active,
              patch,
            );
            if (inputs === parent.inputs) return root;
            return updateProjectAtPath(root, address.path, p => ({ ...p, inputs }));
          })
        }
        snap={snap}
        onSeekStart={beginSeek}
        onSeek={time => updateCue(timeFromPath(history.project, timelineScope.path, time, cue))}
        onSeekEnd={time => endSeek(timeFromPath(history.project, timelineScope.path, time, cue))}
        onMove={treeMove}
        onPreview={previewNode}
        onNoteAudition={previewNote}
        onOpenNotes={(address) => {
          treeSelect(address);
          const dock = manager.current;
          if (!dock) return;
          if (dock.has("notes")) dock.show("notes");
          else dock.control([{ action: "preset", preset: "notes" }]);
        }}
        onBegin={stop}
      />
      <MacroEditor
        project={project}
        onChange={(next) => edit(() => next, "controls")}
      />
    </div>
  );
  const variants = (
    <div className="variants-content">
      <div className="variants-toolbar">
        <div className="variant-controls">
          <label className="seed-field">
            {t("editor.seed")}
            <input
              aria-label={t("editor.seed")}
              type="number"
              min="0"
              max="4294967295"
              value={project.seed}
              onChange={(e) => {
                if (
                  e.target.value !== "" &&
                  Number.isFinite(e.target.valueAsNumber)
                )
                  changeProject(
                    "seed",
                    clamp(Math.round(e.target.valueAsNumber), 0, 4294967295),
                  );
              }}
            />
          </label>
          <Range
            label={t("variants.amount")}
            value={amount}
            min={0}
            max={1}
            onChange={setAmount}
          />
        </div>
        <div className="button-group">
          <button
            className="secondary"
            onClick={() => void generate()}
            disabled={busy || !ready || !project.inputs.length}
          >
            <Shuffle size={15} />
            {t(busy ? "variants.busy" : "variants.generate")}
          </button>
          <button
            className="icon-button"
            disabled={!variations.length || ioBusy}
            onClick={() => setExportOpen(true)}
            aria-label={t("variants.export")}
            title={t("variants.export")}
          >
            <Download size={16} />
          </button>
        </div>
      </div>
      {!variations.length ? (
        <p className="variant-empty">
          {t("variants.empty")}
          <span>{t("variants.hint")}</span>
        </p>
      ) : (
        <>
          <div className="variation-grid">
            {variations.map((v, i) => (
              <div
                className={`variation ${playing === `var-${i}` ? "playing" : ""}`}
                key={v.project.seed}
              >
                <div className="variation-top">
                  <span>{t("variants.title", i + 1)}</span>
                  <button
                    className="icon-button"
                    aria-pressed={playing === `var-${i}`}
                    aria-label={`${t(playing === `var-${i}` ? "action.stop" : "action.listen")} ${i + 1}`}
                    onClick={() => void play(v.result, `var-${i}`)}
                  >
                    {playing === `var-${i}` ? (
                      <Square size={13} />
                    ) : (
                      <Play size={13} />
                    )}
                  </button>
                </div>
                <Waveform
                  data={v.result.left}
                  right={v.result.right}
                  label={t("variants.title", i + 1)}
                />
                <div className="variation-bottom">
                  <span>{v.project.seed}</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      edit(() => v.project);
                      setSelected(v.project.inputs[0]?.id ?? "");
                    }}
                  >
                    {t("action.apply")}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {variationBase !== project && (
            <p className="field-help">{t("variants.old")}</p>
          )}
        </>
      )}
    </div>
  );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <AudioLines size={25} />
          <span>
            Momo<span className="brand-name">SoundForge</span>
          </span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            disabled={!history.past.length}
            onClick={undo}
            title={t("action.undo")}
            aria-label={t("action.undo")}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            disabled={!history.future.length}
            onClick={redo}
            title={t("action.redo")}
            aria-label={t("action.redo")}
          >
            <Redo2 size={17} />
          </button>
          <span className="header-divider" />
          <button
            className="text-button"
            title={t("file.new")}
            aria-label={t("file.new")}
            disabled={!ready || ioBusy}
            onClick={() => {
              editRoot(() => defaultProject());
              scopeEpoch.current++;
              setEditPath([]);
    setTimelinePath([]);
              setSelected("");
              setSelection([]);
              setVariations([]);
              updateCue(0);
              setZoom(1);
              manager.current?.show("editor");
            }}
          >
            <FilePlus2 size={16} />
            <span>{t("file.new")}</span>
          </button>
          <button
            className="text-button"
            aria-label={t("file.open")}
            title={t("file.open")}
            disabled={ioBusy || !ready}
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={16} />
            <span>{t("file.open")}</span>
          </button>
          <button
            className="text-button"
            aria-label={t("file.save")}
            title={t("file.save")}
            disabled={!ready}
            onClick={save}
          >
            <Save size={16} />
            <span>{t("file.save")}</span>
          </button>
          <button
            className="secondary export-button"
            disabled={!result || ioBusy}
            onClick={() => setExportOpen(true)}
            aria-haspopup="dialog"
          >
            <Download size={16} />
            <span>{t("export.open")}</span>
          </button>
        </div>
        <div className="header-right">
          <button disabled={!ready || ioBusy} onClick={() => {
            stop(); setDefinitionEditor({ base: rootCurrent.current, path: [...pathRef.current] });
          }}>{t("resources.title")}</button>
          <div ref={menu} className="layout-menu" />
          <AppearancePreferences />
          <LanguagePreferences />
          <AITools project={history.project} {...ai} />
          <SupportDialog />
          <HelpDialog />
        </div>
      </header>
      <main className={!ready ? "restoring" : ""}>
        <Workbench
          contents={{
            library,
            notes: (
              <NotesWorkspace
                inputs={project.inputs}
                selected={selected}
                cue={timeAtPath(history.project, context.path, cue) ?? -1}
                duration={project.duration}
                offset={0}
                onSeekStart={beginSeek}
                onSeek={time => updateCue(timeFromPath(history.project, context.path, time, cue))}
                onSeekEnd={time => endSeek(timeFromPath(history.project, context.path, time, cue))}
                onSelect={(id) => treeSelect({ path: context.path, id })}
                onBegin={stop}
                onChange={(note) => {
                  if (selectedLayer?.player.score)
                    editRoot((root) =>
                      editNode(
                        root,
                        { path: context.path, id: selectedLayer.id },
                        {
                          player: {
                            score: {
                              ...selectedLayer.player.score!,
                              notes: selectedLayer.player.score!.notes.map(
                                (n) => (n.id === note.id ? note : n),
                              ),
                            },
                          },
                        },
                      ),
                    );
                }}
                onAudition={(note) => {
                  if (selectedLayer)
                    previewNote(
                      { path: context.path, id: selectedLayer.id },
                      note,
                    );
                }}
                ready={!!auditionResult}
                playing={playing === "main"}
                onToggle={() => {
                  if (playing || pendingPlayback) stop();
                  else if (auditionResult) void play(auditionResult, "main");
                }}
                onArrange={() => manager.current?.show("editor")}
              />
            ),
            video: (
              <VideoReferencePanel
                reference={history.project.videoReference}
                cue={cue}
                playing={playing === "main"}
                ready={!!auditionResult}
                loop={loop}
                onLoop={setLoop}
                onStop={stop}
                onSeek={updateCue}
                onToggle={() => {
                  if (playing) {
                    stop();
                    return;
                  }
                  if (!auditionResult || !history.project.videoReference)
                    return;
                  const r = history.project.videoReference;
                  const frames = Math.round(
                    (r.end - r.start) * auditionResult.sampleRate,
                  );
                  if (cue >= r.end - r.start) updateCue(0);
                  void play(
                    {
                      ...auditionResult,
                      left: auditionResult.left.slice(0, frames),
                      right: auditionResult.right.slice(0, frames),
                    },
                    "main",
                  );
                }}
                onChange={(videoReference) =>
                  editRoot((p) => ({
                    ...p,
                    videoReference,
                    duration: videoReference
                      ? Math.max(
                          p.duration,
                          videoReference.end - videoReference.start,
                        )
                      : p.duration,
                  }))
                }
              />
            ),
            editor,
            inspector: (
              <Inspector
                definitionControl={selectedLayer && (selectedLayer.player.type === "synth" || selectedLayer.player.type === "instrument") ? (
                  <div className="inspector-definition">
                    <p className="inspector-resource-name">{selectedLayer.player.type === "synth" ? (selectedLayer.player.synth?.id === "builtin.oscillator" ? t("definition.defaultSynth") : selectedLayer.player.synth?.name) : selectedLayer.player.score?.instruments.map(i => i.name).join(" · ")}</p>
                    <button onClick={() => {
                      stop();
                      const initial = selectedLayer.player.type === "synth" ? synthFromPlayer(project, selectedLayer.id)
                        : selectedLayer.player.score?.instruments[0] ? parseDefinition({ schema: "momo.instrument/v1", instrument: selectedLayer.player.score.instruments[0], assets: project.assets }) : undefined;
                      setDefinitionEditor({ base: rootCurrent.current, path: [...pathRef.current], id: selectedLayer.id, initial, type: selectedLayer.player.type as "synth" | "instrument" });
                    }} className="secondary">{t(`inspector.choose.${selectedLayer.player.type}`)}</button>
                  </div>
                ) : undefined}
                onReplaceContent={
                  ready && !ioBusy
                    ? () => {
                        stop();
                        setReplacement({
                          base: rootCurrent.current,
                          address: { path: [...pathRef.current], id: selected },
                        });
                      }
                    : undefined
                }
                sourceEditor={
                  selectedLayer?.player.type === "instrument" ? (
                    <ScoreEditor
                      key={selectedLayer.id}
                      project={project}
                      layer={selectedLayer}
                      onChange={(next) => edit(() => next)}
                      onAudition={(note) =>
                        previewNote(
                          { path: context.path, id: selectedLayer.id },
                          note,
                        )
                      }
                    />
                  ) : undefined
                }
                postProcessing={
                  selectedLayer && (
                    <SoundPolish
                      embedded
                      node={selectedLayer}
                      onChange={(effects) => changeLayer("effects", effects)}
                      original={originalAudition}
                      onCompare={comparePolish}
                      busy={!comparisonReady || ioBusy}
                    />
                  )
                }
                layer={selectedLayer}
                project={project}
                onChange={changeLayer}
                onFitRange={() => edit(p => ({ ...p, inputs: p.inputs.map(l => l.id === selected ? fitPlayerRange(l) : l) }))}
                onExpose={(key) =>
                  selectedLayer &&
                  edit((p) => exposeParameter(p, selectedLayer, key))
                }
                onDuplicate={duplicate}
                onDelete={() => removeLayers([selected])}
                onEnter={() =>
                  selectedLayer && enterComposition(selectedLayer.id)
                }
              />
            ),
            variants,
          }}
          menuHost={menu}
          managerRef={manager}
          onMessage={(message) => flash(message)}
        />
      </main>
      <footer className="statusbar">
        <span
          className={saveState === "status.unavailable" ? "error-status" : ""}
        >
          <Check size={12} />
          {t(saveState)}
        </span>
        <span>{t("app.version")}</span>
      </footer>
      <input
        type="file"
        hidden
        ref={projectInput}
        accept=".soundforge,.json"
        onChange={(e) => {
          const input = e.currentTarget;
          void openProject(input.files?.[0]).finally(() => {
            input.value = "";
          });
        }}
      />
      <input
        type="file"
        hidden
        ref={compositionInput}
        accept=".soundforge,.json"
        onChange={(e) => {
          const input = e.currentTarget;
          void importComposition(input.files?.[0]).finally(() => {
            input.value = "";
          });
        }}
      />
      <input
        type="file"
        hidden
        ref={sampleInput}
        accept="audio/*,.wav,.mp3,.ogg,.flac"
        onChange={(e) => {
          const input = e.currentTarget;
          void importSample(input.files?.[0]).finally(() => {
            input.value = "";
          });
        }}
      />
      {notice && (
        <div className="toast" role="status">
          {t(notice.key, ...notice.values)}
          <button
            className="icon-button"
            aria-label={t("action.close")}
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <ExportDialog
        open={exportOpen}
        project={history.project}
        settings={exportSettings}
        onSettings={(settings) => {
          stop();
          setExportSettings(settings);
        }}
        onPreview={auditionExport}
        onExport={() => void exportCurrent()}
        onExportPack={() => void exportPack()}
        encodingStatus={encodingStatus}
        variationCount={variations.length}
        busy={!result || ioBusy || !!encodingStatus}
        output={exportOutput}
        preparing={exportPreparing}
        preparationError={exportPreparationError}
        onClose={() => {
          if (
            activePlaybackRef.current === "export-preview" ||
            pendingPlaybackRef.current === "export-preview"
          )
            stop();
          setExportOpen(false);
        }}
      />
      {replacement && (
        <ContentReplacementDialog
          base={replacement.base}
          address={replacement.address}
          stale={history.project !== replacement.base}
          onClose={() => setReplacement(undefined)}
          onStop={stop}
          onImport={importReplacement}
          onPlay={(p, id) => void play(() => renderer.current!.render(p), id)}
          onApply={(next) => {
            if (rootCurrent.current !== replacement.base) {
              flash("error.scopeChanged");
              return;
            }
            editRoot((p) => (p === replacement.base ? next : p));
            setReplacement(undefined);
          }}
        />
      )}
      {definitionEditor && <ResourceManager
        {...resourceProps} bindingType={definitionEditor.type}
        initialDefinition={definitionEditor.initial}
        stale={history.project !== definitionEditor.base}
        onClose={() => setDefinitionEditor(undefined)}
        onInsert={p => {
          if (rootCurrent.current !== definitionEditor.base) throw Error("error.scopeChanged");
          insertSound(p); setDefinitionEditor(undefined);
        }}
        onBind={definitionEditor.id ? d => {
          if (rootCurrent.current !== definitionEditor.base) throw Error("error.scopeChanged");
          const next = updateProjectAtPath(definitionEditor.base, definitionEditor.path, p => bindDefinition(p, definitionEditor.id!, d));
          assertProjectLimits(next); editRoot(() => next); setDefinitionEditor(undefined);
        } : undefined}
      />}
    </div>
  );
}
