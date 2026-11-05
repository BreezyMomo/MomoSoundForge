import {
  Button,
  Field,
  FieldLabel,
  WorkbenchChoice,
} from "@momo/workbench/react";
import type { Layer } from "./model";
import type { NoteEvent } from "./instruments";
import { NoteRoll } from "./NoteRoll";
import { t } from "./i18n";
import "./notes-workspace.css";

export function NotesWorkspace({
  layers,
  selected,
  onSelect,
  onChange,
  onBegin,
  onAudition,
  onToggle,
  playing,
  ready,
  cue,
  duration,
  onArrange,
}: {
  layers: Layer[];
  selected: string;
  onSelect: (id: string) => void;
  onChange: (note: NoteEvent) => void;
  onBegin: () => void;
  onAudition: (note: NoteEvent) => void;
  onToggle: () => void;
  playing: boolean;
  ready: boolean;
  cue: number;
  duration: number;
  onArrange: () => void;
}) {
  const instruments = layers.filter(
    (layer) => layer.type === "instrument" && layer.score,
  );
  const layer = instruments.find((layer) => layer.id === selected);
  return (
    <section className="notes-workspace" aria-label={t("notes.panel")}>
      <header className="notes-workspace-toolbar">
        <Field
          orientation="horizontal"
          className="wb:w-auto wb:min-w-0 wb:flex-1"
        >
          <FieldLabel>{t("notes.track")}</FieldLabel>
          <WorkbenchChoice
            label={t("notes.track")}
            value={layer?.id ?? ""}
            className="sound-track-choice wb:min-w-0"
            items={[
              { value: "", label: t("notes.chooseTrack") },
              ...instruments.map((layer) => ({
                value: layer.id,
                label: layer.name,
              })),
            ]}
            onValueChange={(id) => {
              if (id) onSelect(id);
            }}
          />
        </Field>
        <Button disabled={!ready} onClick={onToggle}>
          {t(playing ? "notes.pauseProject" : "notes.playProject")}
        </Button>
        <Button variant="outline" onClick={onArrange}>
          {t("panel.editor")}
        </Button>
        <span className="notes-workspace-time">
          {cue.toFixed(3)} / {duration.toFixed(3)} s
        </span>
      </header>
      {layer ? (
        <NoteRoll
          key={layer.id}
          minimumRows={36}
          layer={layer}
          onSelect={() => {}}
          onBegin={onBegin}
          onChange={onChange}
          onAudition={onAudition}
        />
      ) : (
        <p className="field-help">
          {t(instruments.length ? "notes.chooseHint" : "notes.empty")}
        </p>
      )}
    </section>
  );
}
