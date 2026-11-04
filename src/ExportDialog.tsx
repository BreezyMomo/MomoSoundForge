import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Range } from "./Inspector";
import { t } from "./i18n";
import type { Project, RenderResult } from "./model";
import {
  EXPORT_FORMATS,
  type ExportSettings,
  type ExportFormat,
} from "./exportAudio";
export function ExportDialog({
  encodingStatus,
  project,
  settings,
  onSettings,
  onPreview,
  onExport,
  onExportPack,
  variationCount,
  busy,
  output,
  onClose,
}: {
  encodingStatus: string;
  project: Project;
  settings: ExportSettings;
  onSettings: (s: ExportSettings) => void;
  onPreview: () => void;
  onExport: () => void;
  onExportPack: () => void;
  variationCount: number;
  busy: boolean;
  output: RenderResult | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    region = project.loopRegion;
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      queueMicrotask(() =>
        document.querySelector<HTMLButtonElement>(".export-button")?.focus(),
      );
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="export-dialog"
      aria-labelledby="export-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="export-heading">
        <div>
          <h2 id="export-title">{t("pro.export")}</h2>
          <p>{project.name}</p>
        </div>
        <button
          autoFocus
          className="icon-button"
          aria-label={t("action.close")}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="pro-section export-settings">
        <fieldset className="export-fields" disabled={busy}>
          <div className="pro-grid">
            <label>
              {t("export.format")}
              <select
                value={settings.format}
                onChange={(e) =>
                  onSettings({
                    ...settings,
                    format: e.target.value as ExportFormat,
                  })
                }
              >
                {EXPORT_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t(`export.format.${f}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("pro.prefix")}
              <input
                value={settings.prefix}
                maxLength={80}
                onChange={(e) =>
                  onSettings({ ...settings, prefix: e.target.value })
                }
              />
            </label>
            <label>
              {t("pro.sampleRate")}
              <select
                value={settings.sampleRate}
                onChange={(e) =>
                  onSettings({ ...settings, sampleRate: +e.target.value })
                }
              >
                {[22050, 44100, 48000].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate} Hz
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("pro.channels")}
              <select
                value={settings.mono ? "mono" : "stereo"}
                onChange={(e) =>
                  onSettings({ ...settings, mono: e.target.value === "mono" })
                }
              >
                <option value="stereo">{t("pro.stereo")}</option>
                <option value="mono">{t("pro.mono")}</option>
              </select>
            </label>
            <Range
              label={t("pro.tail")}
              value={settings.tail}
              min={0}
              max={2}
              step={0.01}
              unit="s"
              onChange={(v) => onSettings({ ...settings, tail: v })}
            />
          </div>
          <div className="pro-checks">
            {(["normalize", "trimSilence", "loopOnly"] as const).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={settings[key]}
                  disabled={key === "loopOnly" && !region}
                  onChange={(e) =>
                    onSettings({ ...settings, [key]: e.target.checked })
                  }
                />
                {t(`pro.${key}`)}
              </label>
            ))}
          </div>
          {settings.normalize && (
            <Range
              label={t("pro.targetRms")}
              value={settings.targetRms}
              min={-36}
              max={-6}
              step={0.1}
              unit="dBFS"
              onChange={(v) => onSettings({ ...settings, targetRms: v })}
            />
          )}
        </fieldset>
        <p className="field-help">{t(`export.hint.${settings.format}`)}</p>
        <p className="field-help">{t("pro.exportHelp")}</p>
        {encodingStatus && <p role="status">{t(encodingStatus)}</p>}
        <div className="button-group">
          <button className="secondary" disabled={busy} onClick={onPreview}>
            {t("pro.previewExport")}
          </button>
          <button className="primary" disabled={busy} onClick={onExport}>
            {t("export.downloadFormat", settings.format.toUpperCase())}
          </button>
          <button
            className="secondary"
            disabled={busy || !variationCount}
            onClick={onExportPack}
          >
            {t("export.pack", variationCount)}
          </button>
        </div>
        {output && (
          <p className="field-help">
            {t(
              "pro.outputInfo",
              (output.left.length / output.sampleRate).toFixed(3),
              (20 * Math.log10(output.peak || 1e-9)).toFixed(1),
              (20 * Math.log10(output.rms || 1e-9)).toFixed(1),
            )}
            {output.rms < 0.001 && ` · ${t("pro.silentWarning")}`}
            {output.gainReduction < 0.999 && ` · ${t("pro.limitWarning")}`}
            {output.sourcePeak > 1 && ` · ${t("pro.clipWarning")}`}
          </p>
        )}
      </div>
    </dialog>
  );
}
