import {
  Button,
  Field,
  FieldLabel,
  WorkbenchChoice,
  WorkbenchNumberInput,
} from "@momo/workbench/react";
import {
  beatsToSeconds,
  secondsToBeats,
  type NoteEvent,
  type Score,
} from "./instruments";
import { t } from "./i18n";
import { NoteStrength } from "./NoteStrength";
import { pitchName } from "./noteEditing";
import { playablePitches } from "./noteCoverage";
import {
  articulationName,
  coverageLabel,
  NoteCoverageNotice,
} from "./NoteCoverageNotice";

export function BasicScoreEditor({
  score,
  canAdd,
  onAdd,
  onFit,
  onUpdate,
  onRemove,
  onAudition,
}: {
  score: Score;
  canAdd: boolean;
  onAdd: () => void;
  onFit: () => void;
  onUpdate: (id: string, patch: Partial<NoteEvent>) => void;
  onRemove: (id: string) => void;
  onAudition: (note: NoteEvent) => void;
}) {
  return (
    <div className="basic-score">
      <header>
        <h2>{t("note.basic.title")}</h2>
        <Button variant="outline" disabled={!canAdd} onClick={onAdd}>
          {t("score.addNote")}
        </Button>
      </header>
      <p className="field-help">{t("note.basic.hint")}</p>
      {!score.notes.length && (
        <p className="field-help">{t("note.basic.empty")}</p>
      )}
      {score.notes.map((note, index) => {
        const instrument = score.instruments.find(
          (i) => i.id === note.instrumentId,
        );
        const pitches = [
          ...new Set([...playablePitches(instrument, note), note.midi]),
        ].sort((a, b) => a - b);
        const articulations = [
          ...new Set([
            note.articulation,
            ...(instrument?.regions.map((r) => r.articulation) ?? []),
          ]),
        ];
        const label = (key: string) => `${t(key)} ${index + 1}`;
        return (
          <section
            className="basic-note"
            key={note.id}
            aria-label={t("note.basic.number", index + 1)}
          >
            <header>
              <strong>
                {t("note.basic.number", index + 1)} · {pitchName(note.midi)}
              </strong>
              <div className="basic-note-actions">
                <Button
                  variant="outline"
                  aria-label={label("note.basic.audition")}
                  onClick={() => onAudition(note)}
                >
                  {t("note.basic.audition")}
                </Button>
                <Button
                  variant="ghost"
                  aria-label={label("score.removeNote")}
                  onClick={() => onRemove(note.id)}
                >
                  {t("score.removeNote")}
                </Button>
              </div>
            </header>
            <div className="basic-note-fields">
              <Field>
                <FieldLabel>{t("note.basic.pitch")}</FieldLabel>
                <WorkbenchChoice
                  label={label("note.basic.pitch")}
                  value={String(note.midi)}
                  items={pitches.map((midi) => ({
                    value: String(midi),
                    label: pitchName(midi),
                  }))}
                  onValueChange={(value) =>
                    onUpdate(note.id, { midi: Number(value) })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{t("note.basic.strength")}</FieldLabel>
                <NoteStrength
                  instrument={instrument}
                  note={note}
                  label={label("note.basic.strength")}
                  onChange={(velocity) => onUpdate(note.id, { velocity })}
                />
              </Field>
              <Field>
                <FieldLabel>{t("note.basic.start")}</FieldLabel>
                <WorkbenchNumberInput
                  label={label("note.basic.start")}
                  value={beatsToSeconds(note.start, score.bpm)}
                  min={0}
                  max={Number.MAX_VALUE / 300}
                  step={0.01}
                  onValueCommit={(value) =>
                    onUpdate(note.id, {
                      start: secondsToBeats(value, score.bpm),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{t("note.basic.duration")}</FieldLabel>
                <WorkbenchNumberInput
                  label={label("note.basic.duration")}
                  value={beatsToSeconds(note.duration, score.bpm)}
                  min={beatsToSeconds(0.005, score.bpm)}
                  max={Number.MAX_VALUE / 300}
                  step={0.01}
                  onValueCommit={(value) =>
                    onUpdate(note.id, {
                      duration: secondsToBeats(value, score.bpm),
                    })
                  }
                />
              </Field>
              {(score.instruments.length > 1 || !instrument) && (
                <Field>
                  <FieldLabel>{t("score.instrument")}</FieldLabel>
                  <WorkbenchChoice
                    label={label("note.basic.instrument")}
                    value={note.instrumentId}
                    items={[
                      ...score.instruments.map((i) => ({
                        value: i.id,
                        label: i.name,
                      })),
                      ...(!instrument
                        ? [
                            {
                              value: note.instrumentId,
                              label: t("note.coverage.missing"),
                            },
                          ]
                        : []),
                    ]}
                    onValueChange={(instrumentId) =>
                      onUpdate(note.id, { instrumentId })
                    }
                  />
                </Field>
              )}
              {articulations.length > 1 && (
                <Field>
                  <FieldLabel>{t("note.basic.articulation")}</FieldLabel>
                  <WorkbenchChoice
                    label={label("note.basic.articulation")}
                    value={note.articulation}
                    items={articulations.map((value) => ({
                      value,
                      label: articulationName(value),
                    }))}
                    onValueChange={(articulation) =>
                      onUpdate(note.id, { articulation })
                    }
                  />
                </Field>
              )}
            </div>
            <p className="field-help">
              {t(
                "note.basic.coverage",
                instrument?.name ?? t("note.coverage.missing"),
                articulationName(note.articulation),
                coverageLabel(instrument, note),
              )}
            </p>
            <NoteCoverageNotice
              instrument={instrument}
              note={note}
              onApply={(next) => onUpdate(note.id, next)}
            />
          </section>
        );
      })}
      <Button variant="outline" disabled={!score.notes.length} onClick={onFit}>
        {t("score.fit")}
      </Button>
    </div>
  );
}
