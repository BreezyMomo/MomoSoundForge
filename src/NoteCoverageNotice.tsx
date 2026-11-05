import { Button } from "@momo/workbench/react";
import type { Instrument, NoteEvent } from "./instruments";
import { BUILTIN_MESSAGES } from "./builtinMessages";
import { t } from "./i18n";
import { pitchName } from "./noteEditing";
import {
  noteCoverageIssue,
  suggestPlayableNote,
  velocityPercent,
  pitchRanges,
  playablePitches,
} from "./noteCoverage";
import "./note-coverage.css";

export function articulationName(value: string) {
  const key = `builtin.articulation.${value}`;
  return Object.hasOwn(BUILTIN_MESSAGES, key) ? t(key) : value;
}

export function coverageLabel(
  instrument: Instrument | undefined,
  note: NoteEvent,
) {
  return (
    pitchRanges(playablePitches(instrument, note))
      .map(([low, high]) =>
        low === high ? pitchName(low) : `${pitchName(low)}–${pitchName(high)}`,
      )
      .join(", ") || t("note.coverage.none")
  );
}

export function NoteCoverageNotice({
  instrument,
  note,
  onApply,
}: {
  instrument: Instrument | undefined;
  note: NoteEvent;
  onApply: (note: NoteEvent) => void;
}) {
  const issue = noteCoverageIssue(instrument, note);
  if (!issue) return null;
  const suggestion = suggestPlayableNote(instrument, note);
  return (
    <div className="note-coverage-notice" role="status">
      <p>{t(`note.coverage.${issue}`)}</p>
      {suggestion && (
        <>
          <p>
            {t(
              "note.coverage.proposal",
              pitchName(suggestion.midi),
              velocityPercent(suggestion.velocity),
              articulationName(suggestion.articulation),
            )}
          </p>
          <Button variant="outline" onClick={() => onApply(suggestion)}>
            {t("note.coverage.apply")}
          </Button>
        </>
      )}
    </div>
  );
}
