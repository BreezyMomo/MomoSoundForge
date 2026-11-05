import { useState } from "react";
import { WorkbenchNumberInput } from "@momo/workbench/react";
import type { Instrument, NoteEvent } from "./instruments";
import { t } from "./i18n";
import {
  nearestPlayableVelocity,
  playableVelocities,
  pitchRanges,
  percentVelocity,
  velocityPercent,
} from "./noteCoverage";

export function NoteStrength({
  instrument,
  note,
  label,
  onChange,
}: {
  instrument: Instrument | undefined;
  note: NoteEvent;
  label: string;
  onChange: (velocity: number) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [adjustment, setAdjustment] = useState<{
    requested: number;
    applied: number;
  } | null>(null);
  const available = playableVelocities(instrument, note);
  const ranges = pitchRanges(available.map(velocityPercent));
  const rangeText = ranges
    .map(([low, high]) => (low === high ? `${low}%` : `${low}–${high}%`))
    .join(", ");
  return (
    <div className="note-strength">
      <WorkbenchNumberInput
        key={revision}
        label={label}
        value={velocityPercent(note.velocity)}
        min={1}
        max={100}
        step={1}
        disabled={!available.length}
        onValueCommit={(percent) => {
          const requested = percentVelocity(percent);
          const applied = nearestPlayableVelocity(instrument, note, requested);
          setAdjustment(
            applied === requested ? null : { requested: percent, applied },
          );
          // A snapped value may equal the old prop; still replace the input's local draft.
          setRevision((value) => value + 1);
          if (applied !== note.velocity) onChange(applied);
        }}
      />
      <small className="field-help">
        {available.length
          ? t("note.strength.range", rangeText)
          : t("note.strength.unavailable")}
      </small>
      {adjustment && adjustment.applied === note.velocity && (
        <small role="status" className="field-help">
          {t(
            "note.strength.adjusted",
            adjustment.requested,
            velocityPercent(adjustment.applied),
          )}
        </small>
      )}
    </div>
  );
}
