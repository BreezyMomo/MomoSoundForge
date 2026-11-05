import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  FieldGroup,
  Field,
  FieldLabel,
  WorkbenchChoice,
  Input,
  Checkbox,
} from "@momo/workbench/react";
import { Range } from "./Inspector";
import { t } from "./i18n";
import type { Project, RenderResult } from "./model";
import {
  EXPORT_FORMATS,
  type ExportSettings,
  type ExportFormat,
} from "./exportAudio";

export function ExportDialog({
  open,
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
  open: boolean;
  encodingStatus: string;
  project: Project;
  settings: ExportSettings;
  onSettings: (settings: ExportSettings) => void;
  onPreview: () => void;
  onExport: () => void;
  onExportPack: () => void;
  variationCount: number;
  busy: boolean;
  output: RenderResult | null;
  onClose: () => void;
}) {
  const region = project.loopRegion;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        className="sound-export-dialog wb:max-h-[calc(100dvh-2rem)] wb:overflow-y-auto"
        finalFocus={() =>
          document.querySelector<HTMLButtonElement>(".export-button")
        }
      >
        <DialogHeader>
          <DialogTitle>{t("pro.export")}</DialogTitle>
          <DialogDescription>{project.name}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="export-fields">
          <FieldGroup className="sound-export-grid">
            <Field>
              <FieldLabel>{t("export.format")}</FieldLabel>
              <WorkbenchChoice
                label={t("export.format")}
                value={settings.format}
                disabled={busy}
                items={EXPORT_FORMATS.map((format) => ({
                  value: format,
                  label: t("export.format." + format),
                }))}
                onValueChange={(format) =>
                  onSettings({ ...settings, format: format as ExportFormat })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="export-prefix">{t("pro.prefix")}</FieldLabel>
              <Input
                id="export-prefix"
                value={settings.prefix}
                maxLength={80}
                disabled={busy}
                onChange={(event) =>
                  onSettings({ ...settings, prefix: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel>{t("pro.sampleRate")}</FieldLabel>
              <WorkbenchChoice
                label={t("pro.sampleRate")}
                value={String(settings.sampleRate)}
                disabled={busy}
                items={[22050, 44100, 48000].map((rate) => ({
                  value: String(rate),
                  label: rate + " Hz",
                }))}
                onValueChange={(rate) =>
                  onSettings({ ...settings, sampleRate: Number(rate) })
                }
              />
            </Field>
            <Field>
              <FieldLabel>{t("pro.channels")}</FieldLabel>
              <WorkbenchChoice
                label={t("pro.channels")}
                value={settings.mono ? "mono" : "stereo"}
                disabled={busy}
                items={["stereo", "mono"].map((value) => ({
                  value,
                  label: t("pro." + value),
                }))}
                onValueChange={(value) =>
                  onSettings({ ...settings, mono: value === "mono" })
                }
              />
            </Field>
            <Range
              label={t("pro.tail")}
              value={settings.tail}
              min={0}
              max={2}
              step={0.01}
              unit="s"
              disabled={busy}
              onChange={(tail) => onSettings({ ...settings, tail })}
            />
          </FieldGroup>
          <FieldGroup className="sound-option-fields">
            {(["normalize", "trimSilence", "loopOnly"] as const).map((key) => (
              <Field key={key} orientation="horizontal" className="wb:w-auto">
                <Checkbox
                  id={"export-" + key}
                  checked={settings[key]}
                  disabled={busy || (key === "loopOnly" && !region)}
                  onCheckedChange={(checked) =>
                    onSettings({ ...settings, [key]: checked })
                  }
                />
                <FieldLabel htmlFor={"export-" + key}>
                  {t("pro." + key)}
                </FieldLabel>
              </Field>
            ))}
          </FieldGroup>
          {settings.normalize && (
            <Range
              label={t("pro.targetRms")}
              value={settings.targetRms}
              min={-36}
              max={-6}
              step={0.1}
              unit="dBFS"
              disabled={busy}
              onChange={(targetRms) => onSettings({ ...settings, targetRms })}
            />
          )}
        </fieldset>
        <p className="wb:text-muted-foreground">
          {t("export.hint." + settings.format)}
        </p>
        <p className="wb:text-muted-foreground">{t("pro.exportHelp")}</p>
        {encodingStatus && <p role="status">{t(encodingStatus)}</p>}
        <div className="wb:flex wb:flex-wrap wb:gap-2">
          <Button variant="outline" disabled={busy} onClick={onPreview}>
            {t("pro.previewExport")}
          </Button>
          <Button disabled={busy} onClick={onExport}>
            {t("export.downloadFormat", settings.format.toUpperCase())}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !variationCount}
            onClick={onExportPack}
          >
            {t("export.pack", variationCount)}
          </Button>
        </div>
        {output && (
          <p className="wb:text-muted-foreground">
            {t(
              "pro.outputInfo",
              (output.left.length / output.sampleRate).toFixed(3),
              (20 * Math.log10(output.peak || 1e-9)).toFixed(1),
              (20 * Math.log10(output.rms || 1e-9)).toFixed(1),
            )}
            {output.rms < 0.001 && " · " + t("pro.silentWarning")}
            {output.gainReduction < 0.999 && " · " + t("pro.limitWarning")}
            {output.sourcePeak > 1 && " · " + t("pro.clipWarning")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
