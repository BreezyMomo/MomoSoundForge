import { Button, WorkbenchChoice } from "@momo/workbench/react";
import { useEffect, useState } from "react";
import type { Instrument, NoteEvent } from "./instruments";
import { BUILTIN_MESSAGES } from "./builtinMessages";
import { t, language } from "./i18n";
import { localizedArticulationName } from './articulationNames';
import { pitchName } from "./noteEditing";
import {
  noteCoverageIssue,
  playableNoteCandidates,
  velocityPercent,
  pitchRanges,
  playablePitches,
} from "./noteCoverage";
import "./note-coverage.css";

export function articulationName(value: string, instrument?: Instrument) {
  return localizedArticulationName(value, instrument?.articulationNames, language.interfaceLanguage(), id => {
    const key = `builtin.articulation.${id}`;
    return Object.hasOwn(BUILTIN_MESSAGES, key) ? t(key) : id;
  });
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
  const [selected, setSelected] = useState("0");
  const issue = noteCoverageIssue(instrument, note);
  const candidates = playableNoteCandidates(instrument, note);
  useEffect(() => setSelected("0"), [instrument?.id, note.id, note.midi, note.velocity, note.articulation]);
  if (!issue) return null;
  const choice = candidates[Number(selected)] ?? candidates[0];
  return (
    <div className="note-coverage-notice" role="status">
      <p>{t(`note.coverage.${issue}`)}</p>
      {choice && (
        <>
          <p>
            {t(
              "note.coverage.proposal",
              pitchName(choice.midi),
              velocityPercent(choice.velocity),
              articulationName(choice.articulation, instrument),
            )}
          </p>
          {candidates.length > 1 && (
            <WorkbenchChoice
              label={t("note.coverage.choose")}
              value={selected}
              items={candidates.map((candidate, index) => ({
                value: String(index),
                label: `${pitchName(candidate.midi)} · ${velocityPercent(candidate.velocity)}% · ${articulationName(candidate.articulation, instrument)}`,
              }))}
              onValueChange={setSelected}
            />
          )}
          <Button variant="outline" onClick={() => onApply(choice)}>
            {t("note.coverage.apply")}
          </Button>
        </>
      )}
    </div>
  );
}
