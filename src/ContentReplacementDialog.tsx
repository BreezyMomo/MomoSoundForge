import { sampleFrames } from './sampleReference';
import { fitPlayerRange, hasReadOverflow } from "./playerPlayback";
import { updateProjectAtPath } from "./model";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Play, Square, Upload, X } from "lucide-react";
import { nodeParent, type NodeAddress } from "./nodeTree";
import {
  contentCandidate,
  localContentCandidate,
  replaceContent,
  contentBindingCount,
  contentReplacementError,
  type ContentCandidate,
} from "./contentReplacement";
import { type Project } from "./model";
import { t, language } from "./i18n";
import { remoteLibraries } from "./remoteSubscriptions";
import { resourceProject } from "./soundResources";
import "./sample-replacement.css";

export function ContentReplacementDialog({
  base,
  address,
  stale,
  onClose,
  onApply,
  onPlay,
  onStop,
  onImport,
}: {
  base: Project;
  address: NodeAddress;
  stale: boolean;
  onClose: () => void;
  onApply: (next: Project) => void;
  onPlay: (project: Project, id: string) => void;
  onStop: () => void;
  onImport: (file: File) => Promise<ContentCandidate>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    request = useRef(0);
  const [query, setQuery] = useState(""),
    [source, setSource] = useState<"samples" | "compositions" | "project">(
      "samples",
    );
  const [adapt, setAdapt] = useState(false);
  const [candidate, setCandidate] = useState<ContentCandidate>(),
    [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const parent = nodeParent(base, address.path),
    layer = parent.inputs.find((l) => l.id === address.id)!;
  const subscriptions=useSyncExternalStore(remoteLibraries.subscribe,remoteLibraries.snapshot);
  useEffect(()=>{remoteLibraries.start();},[]);
  const entries = useMemo(
    () => source !== "project"
        ? subscriptions.filter(s=>s.enabled&&s.index).flatMap(s=>s.index!.entries.filter(e=>e.kind===(source==='samples'?'recording':'sound')).map(e=>({
          id:s.id+':'+e.id,name:e.names?.[language.interfaceLanguage().startsWith('zh')?'zh':'en']??e.name,duration:null as number|null,keywords:s.name+' '+e.category+' '+e.description,
          load:async()=>contentCandidate(resourceProject(await remoteLibraries.loader(s)(e)),e.kind==='sound'),
        })))
        : Object.values(parent.assets).map((asset) => {
            const duration = sampleFrames(asset) / asset.sampleRate;
            return {
              id: asset.id,
              name: asset.name,
              duration,
              keywords: "",
              load: async () => localContentCandidate(asset, duration),
            };
          }),
    [source, parent, subscriptions, language.interfaceLanguage()],
  );
  const visible = entries.filter((e) =>
    `${e.name} ${e.keywords}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const preview = useMemo(() => {
    if (!candidate) return {};
    try {
      const replaced = replaceContent(base, address, candidate);
      return { project: adapt ? updateProjectAtPath(replaced, address.path, p => ({ ...p, inputs: p.inputs.map(l => l.id === address.id ? fitPlayerRange(l) : l) })) : replaced };
    } catch (e) {
      return {
        error: contentReplacementError(e, "error.replaceProject"),
      };
    }
  }, [base, address, candidate, adapt]);
  const nextLayer =
    preview.project &&
    nodeParent(preview.project, address.path).inputs.find(
      (l) => l.id === address.id,
    );
  const bindings = contentBindingCount(base, address);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      request.current++;
      onStop();
    };
  }, [onStop]);
  useEffect(() => {
    if (stale) {
      request.current++;
      setLoading(false);
      onStop();
    }
  }, [stale, onStop]);
  const close = () => {
    request.current++;
    onStop();
    onClose();
  };
  const stopPreview = () => {
    request.current++;
    setLoading(false);
    onStop();
  };
  const choose = async (id: string, load: () => Promise<ContentCandidate>) => {
    const token = ++request.current;
    onStop();
    setAdapt(false);
    setCandidate(undefined);
    setSelected("");
    setLoading(true);
    setError("");
    let fallback = id === "local" ? "error.sample" : "error.replaceSource";
    try {
      const value = await load();
      if (token !== request.current) return;
      fallback = "error.replaceProject";
      const next = replaceContent(base, address, value);
      setCandidate(value);
      setSelected(id);
      onPlay(next, "content-replacement");
    } catch (e) {
      if (token === request.current)
        setError(contentReplacementError(e, fallback));
    } finally {
      if (token === request.current) setLoading(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="sample-replacement"
      aria-labelledby="replacement-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="replacement-heading">
        <h2 id="replacement-title">
          {t("replace.title")} · {layer.name}
        </h2>
        <button
          className="icon-button"
          aria-label={t("action.close")}
          onClick={close}
        >
          <X size={17} />
        </button>
      </div>
      <p className="field-help">{t("replace.intro")}</p>
      <div className="replacement-layout">
        <section
          className="replacement-browser"
          aria-label={t("replace.candidates")}
        >
          <div
            className="replacement-sources"
            role="group"
            aria-label={t("replace.source")}
          >
            {(["samples", "compositions", "project"] as const).map((key) => (
              <button
                key={key}
                aria-pressed={source === key}
                onClick={() => {
                  setSource(key);
                  setQuery("");
                }}
              >
                {t(`replace.${key}`)}
              </button>
            ))}
            <button disabled={stale} onClick={() => input.current?.click()}>
              <Upload size={14} />
              {t("replace.import")}
            </button>
            <input
              ref={input}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void choose("local", () => onImport(file));
              }}
            />
          </div>
          <input
            type="search"
            aria-label={t("replace.search")}
            placeholder={t("replace.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="replacement-list" aria-busy={loading}>
            {visible.map((entry) => (
              <button
                key={entry.id}
                className="replacement-candidate"
                disabled={stale}
                aria-label={t("replace.choose", entry.name)}
                aria-pressed={selected === entry.id}
                onClick={() => void choose(entry.id, entry.load)}
              >
                <Play size={13} />
                <span>{entry.name}</span>
                <small>{entry.duration===null?'':entry.duration.toFixed(2)+' s'}</small>
              </button>
            ))}
            {!visible.length && (
              <p className="field-help">{t("replace.empty")}</p>
            )}
          </div>
        </section>
        <section
          className="replacement-settings"
          aria-label={t("replace.settings")}
        >
          <div>
            <span className="field-help">{t("replace.current")}</span>
            <p>
              {t(`content.${layer.player.type}`)} ·{" "}
              {layer.player.type === "sample"
                ? parent.assets[layer.player.assetId!]?.name
                : layer.name}
            </p>
          </div>
          <div aria-live="polite">
            <span className="field-help">{t("replace.new")}</span>
            <p>
              {loading
                ? t("replace.loading")
                : candidate
                  ? `${t(`content.${candidate.player.type}`)} · ${candidate.name}`
                  : t("replace.select")}
            </p>
          </div>
          <p className="field-help">{t("replace.preserveHelp")}</p>
          <p className="field-help">{t("replace.contentHelp")}</p>
          {nextLayer && hasReadOverflow(nextLayer) && <div role="status"><p className="field-help">{t("player.overflow")}</p><button onClick={() => setAdapt(true)}>{t("player.fit")}</button></div>}
          {bindings > 0 && (
            <p className="field-help">{t("replace.detach", bindings)}</p>
          )}
          {layer.automation?.cutoff?.length ? (
            <p className="field-help">{t("replace.clearCurve")}</p>
          ) : null}
          {nextLayer && (
            <p className="replacement-timing">
              {t(
                "replace.timing",
                layer.duration.toFixed(3),
                nextLayer.duration.toFixed(3),
              )}
            </p>
          )}
          <p className="field-help">
            {t("replace.window", base.duration.toFixed(3))}
          </p>
          {(layer.muted ||
            parent.inputs.some((l) => l.solo && l.id !== layer.id)) && (
            <p className="field-help">{t("replace.muted")}</p>
          )}
          {Object.values(candidate?.assets ?? {})
            .filter((a) => a.source)
            .map((a) => (
              <p key={a.id} className="field-help">
                {a.source!.license} ·{" "}
                <a
                  href={a.source!.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {a.source!.provider}
                </a>
              </p>
            ))}
        </section>
      </div>
      <div role="status" aria-live="polite">
        {stale
          ? t("replace.stale")
          : error || preview.error
            ? t(error || preview.error!)
            : ""}
      </div>
      <div className="replacement-footer">
        <div className="button-group">
          <button
            disabled={stale}
            onClick={() => {
              stopPreview();
              onPlay(base, "content-original");
            }}
          >
            <Play size={14} />
            {t("replace.original")}
          </button>
          <button
            disabled={stale || loading || !preview.project}
            onClick={() =>
              preview.project && onPlay(preview.project, "content-replacement")
            }
          >
            <Play size={14} />
            {t("replace.preview")}
          </button>
          <button
            className="icon-button"
            aria-label={t("replace.stop")}
            onClick={stopPreview}
          >
            <Square size={15} />
          </button>
        </div>
        <div className="button-group">
          <button onClick={close}>{t("action.cancel")}</button>
          <button
            className="primary"
            disabled={stale || loading || !preview.project}
            onClick={() => {
              if (preview.project) onApply(preview.project);
            }}
          >
            {t("replace.apply")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
