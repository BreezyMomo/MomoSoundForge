import {
  Button,
  Input,
  Checkbox,
  Field,
  FieldGroup,
  FieldLabel,
  type WorkbenchChoiceProps,
  WorkbenchChoice,
  WorkbenchNumberInput,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@momo/workbench/react";
import { useRef, useState } from "react";
import { t } from "./i18n";
import {
  parseProject,
  uid,
  type Project,
  type Layer,
  type SampleAsset,
} from "./model";
import {
  emptyScore,
  noteEndSeconds,
  importNoteEvents,
  scoreIssues,
  selectRegion,
  orderedNotes,
  beatsToSeconds,
  type Score,
  type Instrument,
  type SampleRegion,
  type NoteEvent,
} from "./instruments";
import "./score.css";
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 127,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <WorkbenchNumberInput
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onValueCommit={onChange}
    />
  );
}
function RegionChoice({
  defaultValue,
  ...props
}: Omit<WorkbenchChoiceProps, "value" | "onValueChange"> & {
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <WorkbenchChoice
      {...props}
      value={value}
      onValueChange={setValue}
      className="wb:w-full wb:min-w-0"
    />
  );
}
const regionFor = (assetId: string): SampleRegion => ({
  id: uid(),
  assetId,
  rootMidi: 60,
  keyLow: 60,
  keyHigh: 60,
  velocityLow: 1,
  velocityHigh: 127,
  articulation: "sustain",
  roundRobin: 0,
  tuneCents: 0,
  gainDb: 0,
  releaseSeconds: 0.15,
});
export function ScoreEditor({
  project,
  layer,
  onChange,
}: {
  project: Project;
  layer: Layer;
  onChange: (p: Project) => void;
}) {
  const latestProject = useRef(project);
  latestProject.current = project;
  const score = layer.score ?? emptyScore(),
    [error, setError] = useState(""),
    [tab, setTab] = useState("notes"),
    [instrumentId, setInstrumentId] = useState(score.instruments[0]?.id ?? ""),
    [assetId, setAssetId] = useState(Object.keys(project.assets)[0] ?? ""),
    [regionId, setRegionId] = useState(""),
    [snap, setSnap] = useState(0.25);
  const bundleInput = useRef<HTMLInputElement>(null),
    notesInput = useRef<HTMLInputElement>(null);
  const inst =
      score.instruments.find((i) => i.id === instrumentId) ??
      score.instruments[0],
    region = inst?.regions.find((r) => r.id === regionId) ?? inst?.regions[0];
  const commit = (next: Score, assets = project.assets) => {
    try {
      const p = parseProject({
        ...project,
        assets,
        layers: project.layers.map((l) =>
          l.id === layer.id ? { ...l, score: next } : l,
        ),
      });
      onChange(p);
      setError("");
      return true;
    } catch {
      setError(t("score.invalid"));
      return false;
    }
  };
  const updateInstrument = (next: Instrument) =>
    commit({
      ...score,
      instruments: score.instruments.map((i) => (i.id === next.id ? next : i)),
    });
  const updateNote = (id: string, patch: Partial<NoteEvent>) =>
    commit({
      ...score,
      notes: score.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    });
  const addInstrument = () => {
    const asset = project.assets[assetId];
    if (!asset) return;
    const i = { id: uid(), name: asset.name, regions: [regionFor(assetId)] };
    if (commit({ ...score, instruments: [...score.instruments, i] }))
      setInstrumentId(i.id);
  };
  const importBundle = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 34 * 1024 * 1024) throw Error();
      const raw = JSON.parse(await file.text()) as {
        schema: string;
        instrument: Instrument;
        assets: Record<string, SampleAsset>;
      };
      if (latestProject.current !== project) throw Error();
      if (raw.schema !== "momo.instrument/v1" || !raw.instrument || !raw.assets)
        throw Error();
      // Validate embedded audio before installing anything into the active document.
      const candidate = parseProject({
        ...project,
        controls: undefined,
        controlValues: undefined,
        layers: [
          {
            ...layer,
            score: { ...emptyScore(), instruments: [raw.instrument] },
          },
        ],
        assets: raw.assets,
      });
      const mapping = new Map(
        Object.keys(candidate.assets).map((id) => [id, uid()]),
      );
      const assets = {
        ...project.assets,
        ...Object.fromEntries(
          Object.values(candidate.assets).map((a) => [
            mapping.get(a.id)!,
            { ...a, id: mapping.get(a.id)! },
          ]),
        ),
      };
      if (score.instruments.some((i) => i.id === raw.instrument.id))
        throw Error();
      const imported = {
        ...raw.instrument,
        id: raw.instrument.id,
        regions: raw.instrument.regions.map((r) => ({
          ...r,
          assetId: mapping.get(r.assetId)!,
          releaseAssetId: r.releaseAssetId
            ? mapping.get(r.releaseAssetId)
            : undefined,
        })),
      };
      if (
        commit(
          { ...score, instruments: [...score.instruments, imported] },
          assets,
        )
      ) {
        setInstrumentId(imported.id);
        setTab("mapping");
      }
    } catch {
      setError(t("score.invalid"));
    }
  };
  const importNotes = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 256 * 1024) throw Error();
      const raw = JSON.parse(await file.text());
      if (latestProject.current !== project) throw Error();
      const next = importNoteEvents(
        raw,
        score,
        inst?.id ?? "",
        inst?.regions[0]?.articulation ?? "sustain",
      );
      commit(next);
    } catch {
      setError(t("score.invalid"));
    }
  };
  const counters = new Map<string, number>(),
    choices = new Map(
      orderedNotes(score).map((n) => [
        n.id,
        selectRegion(
          score.instruments.find((i) => i.id === n.instrumentId),
          n,
          project.seed ^ layer.noiseSeed,
          counters,
        ),
      ]),
    );
  const issues = scoreIssues(
    score,
    project.assets,
    layer.sourceDuration ?? layer.duration,
    project.seed ^ layer.noiseSeed,
  );
  const quantize = (n: number) => (snap ? Math.round(n / snap) * snap : n);
  return (
    <section className="score-editor">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className="wb:min-w-0"
        aria-label={t("score.title")}
      >
        <header>
          <h2>
            {t("score.title")} · {layer.name}
          </h2>
          <TabsList aria-label={t("score.title")}>
            <TabsTrigger value="notes">{t("score.notes")}</TabsTrigger>
            <TabsTrigger value="mapping">{t("score.mapping")}</TabsTrigger>
          </TabsList>
        </header>
        {error && (
          <p role="alert" className="warning-line">
            {error}
          </p>
        )}
        <FieldGroup className="sound-score-toolbar">
          <Field className="wb:min-w-0">
            <FieldLabel>{t("score.instrument")}</FieldLabel>
            <WorkbenchChoice
              label={t("score.instrument")}
              className="wb:w-full wb:min-w-0"
              value={inst?.id ?? ""}
              items={[
                { value: "", label: t("score.choose") },
                ...score.instruments.map((i) => ({
                  value: i.id,
                  label: i.name,
                })),
              ]}
              onValueChange={setInstrumentId}
            />
          </Field>
          <Button
            variant="outline"
            className="secondary"
            onClick={() => bundleInput.current?.click()}
            disabled={score.instruments.length >= 8}
          >
            {t("score.importInstrument")}
          </Button>
          <input
            ref={bundleInput}
            type="file"
            accept=".json,.sfinstrument"
            hidden
            onChange={(e) => {
              void importBundle(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </FieldGroup>
        {!score.instruments.length && (
          <p className="field-help">{t("score.empty")}</p>
        )}
        {tab === "notes" ? (
          <TabsContent value="notes">
            <FieldGroup className="sound-score-toolbar">
              <Field className="wb:min-w-0">
                <FieldLabel>BPM</FieldLabel>
                <NumberField
                  label="BPM"
                  value={score.bpm}
                  min={20}
                  max={300}
                  onChange={(bpm) => commit({ ...score, bpm })}
                />
              </Field>
              <Field className="wb:min-w-0">
                <FieldLabel>{t("score.snap")}</FieldLabel>
                <WorkbenchChoice
                  label={t("score.snap")}
                  value={String(snap)}
                  onValueChange={(value) => setSnap(Number(value))}
                  items={[0, 0.125, 0.25, 0.5, 1].map((value) => ({
                    value: String(value),
                    label: value
                      ? value + " " + t("score.beats")
                      : t("score.off"),
                  }))}
                />
              </Field>
              <Button
                variant="outline"
                className="secondary"
                disabled={!inst || score.notes.length >= 256}
                onClick={() => {
                  if (!inst) return;
                  const r = inst.regions[0],
                    start = quantize(
                      score.notes.reduce(
                        (m, n) => Math.max(m, n.start + n.duration),
                        0,
                      ),
                    );
                  commit({
                    ...score,
                    notes: [
                      ...score.notes,
                      {
                        id: uid(),
                        instrumentId: inst.id,
                        midi: r.rootMidi,
                        start,
                        duration: 0.5,
                        velocity: Math.round(
                          (r.velocityLow + r.velocityHigh) / 2,
                        ),
                        articulation: r.articulation,
                      },
                    ],
                  });
                }}
              >
                {t("score.addNote")}
              </Button>
              <Button
                variant="outline"
                className="secondary"
                disabled={!inst}
                onClick={() => notesInput.current?.click()}
              >
                {t("score.importNotes")}
              </Button>
              <Button
                variant="outline"
                className="secondary"
                onClick={() => {
                  const blob = new Blob(
                      [
                        JSON.stringify(
                          {
                            schema: "momo.note-events/v1",
                            bpm: score.bpm,
                            notes: score.notes,
                          },
                          null,
                          2,
                        ),
                      ],
                      { type: "application/json" },
                    ),
                    url = URL.createObjectURL(blob),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "notes.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                {t("score.exportNotes")}
              </Button>
              <Button
                variant="outline"
                className="secondary"
                disabled={!score.notes.length}
                onClick={() => {
                  const duration = Math.max(
                    0.1,
                    ...score.notes.map((n) =>
                      noteEndSeconds(
                        n,
                        choices.get(n.id),
                        project.assets,
                        score.bpm,
                      ),
                    ),
                  );
                  onChange({
                    ...project,
                    duration: Math.max(
                      project.duration,
                      layer.start + duration,
                    ),
                    layers: project.layers.map((l) =>
                      l.id === layer.id
                        ? { ...l, duration, sourceDuration: undefined }
                        : l,
                    ),
                  });
                }}
              >
                {t("score.fit")}
              </Button>
              <input
                ref={notesInput}
                type="file"
                accept=".json"
                hidden
                onChange={(e) => {
                  void importNotes(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </FieldGroup>
            <p className="field-help">
              {t("score.timeHint", (60 / score.bpm).toFixed(3))}
            </p>
            <div className="score-table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "pitch",
                      "start",
                      "duration",
                      "velocity",
                      "instrument",
                      "articulation",
                      "selectedSample",
                      "actions",
                    ].map((k) => (
                      <th key={k}>{t("score." + k)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {score.notes.map((n, index) => {
                    const i = score.instruments.find(
                        (i) => i.id === n.instrumentId,
                      ),
                      arts = [
                        ...new Set([
                          n.articulation,
                          ...(i?.regions.map((r) => r.articulation) ?? []),
                        ]),
                      ],
                      r = choices.get(n.id);
                    return (
                      <tr key={n.id}>
                        <td data-label={t("score.pitch")}>
                          <NumberField
                            label={`${t("score.pitch")} ${index + 1}`}
                            value={n.midi}
                            onChange={(midi) =>
                              updateNote(n.id, { midi: Math.round(midi) })
                            }
                          />
                        </td>
                        <td data-label={t("score.start")}>
                          <NumberField
                            label={`${t("score.start")} ${index + 1}`}
                            value={n.start}
                            max={Number.POSITIVE_INFINITY}
                            step={snap || 0.01}
                            onChange={(v) =>
                              updateNote(n.id, { start: quantize(v) })
                            }
                          />
                          <small>
                            {beatsToSeconds(n.start, score.bpm).toFixed(3)} s
                          </small>
                        </td>
                        <td data-label={t("score.duration")}>
                          <NumberField
                            label={`${t("score.duration")} ${index + 1}`}
                            value={n.duration}
                            min={0.005}
                            max={Number.POSITIVE_INFINITY}
                            step={snap || 0.01}
                            onChange={(v) =>
                              updateNote(n.id, {
                                duration: Math.max(0.005, quantize(v)),
                              })
                            }
                          />
                          <small>
                            {beatsToSeconds(n.duration, score.bpm).toFixed(3)} s
                          </small>
                        </td>
                        <td data-label={t("score.velocity")}>
                          <NumberField
                            label={`${t("score.velocity")} ${index + 1}`}
                            min={1}
                            value={n.velocity}
                            onChange={(velocity) =>
                              updateNote(n.id, {
                                velocity: Math.round(velocity),
                              })
                            }
                          />
                        </td>
                        <td data-label={t("score.instrument")}>
                          <WorkbenchChoice
                            label={`${t("score.instrument")} ${index + 1}`}
                            value={n.instrumentId}
                            className="wb:w-full wb:min-w-0"
                            items={[
                              ...(!i
                                ? [
                                    {
                                      value: n.instrumentId,
                                      label: t("score.missingInstrument"),
                                    },
                                  ]
                                : []),
                              ...score.instruments.map((i) => ({
                                value: i.id,
                                label: i.name,
                              })),
                            ]}
                            onValueChange={(value) => {
                              const next = score.instruments.find(
                                (i) => i.id === value,
                              )!;
                              updateNote(n.id, {
                                instrumentId: next.id,
                                articulation: next.regions[0].articulation,
                              });
                            }}
                          />
                        </td>
                        <td data-label={t("score.articulation")}>
                          <WorkbenchChoice
                            label={`${t("score.articulation")} ${index + 1}`}
                            value={n.articulation}
                            className="wb:w-full wb:min-w-0"
                            items={arts.map((a) => ({ value: a, label: a }))}
                            onValueChange={(articulation) =>
                              updateNote(n.id, { articulation })
                            }
                          />
                        </td>
                        <td data-label={t("score.selectedSample")}>
                          <small>
                            {r
                              ? `${project.assets[r.assetId]?.name} · vel ${r.velocityLow}–${r.velocityHigh} · RR ${r.roundRobin}`
                              : t("score.noRegion")}
                          </small>
                        </td>
                        <td data-label={t("score.actions")}>
                          <Button
                            variant="outline"
                            className="secondary"
                            aria-label={`${t("score.removeNote")} ${index + 1}`}
                            onClick={() =>
                              commit({
                                ...score,
                                notes: score.notes.filter((x) => x.id !== n.id),
                              })
                            }
                          >
                            {t("score.removeNote")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!!issues.length && (
              <ul className="score-issues">
                {issues.slice(0, 12).map((issue, i) => (
                  <li key={i}>
                    {score.notes.findIndex((n) => n.id === issue.noteId) + 1}:{" "}
                    {t(issue.key)}
                  </li>
                ))}
                {issues.length > 12 && (
                  <li>{t("score.moreIssues", issues.length - 12)}</li>
                )}
              </ul>
            )}
          </TabsContent>
        ) : (
          <TabsContent value="mapping">
            <FieldGroup className="sound-score-toolbar">
              <Field className="wb:min-w-0">
                <FieldLabel>{t("score.asset")}</FieldLabel>
                <WorkbenchChoice
                  label={t("score.asset")}
                  value={assetId}
                  onValueChange={setAssetId}
                  className="wb:w-full wb:min-w-0"
                  items={[
                    { value: "", label: t("score.choose") },
                    ...Object.values(project.assets).map((a) => ({
                      value: a.id,
                      label: a.name,
                    })),
                  ]}
                />
              </Field>
              <Button
                variant="outline"
                className="secondary"
                disabled={!assetId || score.instruments.length >= 8}
                onClick={addInstrument}
              >
                {t("score.fromSample")}
              </Button>
              <Button
                variant="outline"
                className="secondary"
                disabled={!inst || !assetId}
                onClick={() => {
                  if (inst) {
                    const r = regionFor(assetId);
                    if (
                      updateInstrument({
                        ...inst,
                        regions: [...inst.regions, r],
                      })
                    )
                      setRegionId(r.id);
                  }
                }}
              >
                {t("score.addRegion")}
              </Button>
            </FieldGroup>
            {inst && (
              <>
                <p className="field-help">
                  {inst.name} · {inst.license} {inst.source}
                </p>
                <Field className="wb:min-w-0">
                  <FieldLabel>{t("score.region")}</FieldLabel>
                  <WorkbenchChoice
                    label={t("score.region")}
                    value={region?.id ?? ""}
                    onValueChange={setRegionId}
                    className="wb:w-full wb:min-w-0"
                    items={inst.regions.map((r, i) => ({
                      value: r.id,
                      label: `${i + 1}. ${project.assets[r.assetId]?.name} · ${r.articulation} · MIDI ${r.keyLow}–${r.keyHigh} · vel ${r.velocityLow}–${r.velocityHigh} · RR ${r.roundRobin}`,
                    }))}
                  />
                </Field>
                {region && (
                  <form
                    className="score-region-form"
                    key={region.id + JSON.stringify(region)}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget),
                        num = (k: string) => Number(f.get(k));
                      const next: SampleRegion = {
                        ...region,
                        assetId: String(f.get("assetId")),
                        rootMidi: num("rootMidi"),
                        keyLow: num("keyLow"),
                        keyHigh: num("keyHigh"),
                        velocityLow: num("velocityLow"),
                        velocityHigh: num("velocityHigh"),
                        articulation: String(f.get("articulation")).trim(),
                        roundRobin: num("roundRobin"),
                        tuneCents: num("tuneCents"),
                        gainDb: num("gainDb"),
                        releaseSeconds: num("releaseSeconds"),
                        releaseAssetId:
                          String(f.get("releaseAssetId")) || undefined,
                        loop: f.has("loopEnabled")
                          ? {
                              start: num("loopStart"),
                              end: num("loopEnd"),
                              crossfade: num("crossfade"),
                              verified: true,
                            }
                          : undefined,
                      };
                      updateInstrument({
                        ...inst,
                        name: String(f.get("instrumentName")).trim(),
                        regions: inst.regions.map((r) =>
                          r.id === region.id ? next : r,
                        ),
                      });
                    }}
                  >
                    <FieldGroup className="sound-region-fields">
                      <Field className="wb:min-w-0">
                        <FieldLabel>{t("score.instrumentName")}</FieldLabel>
                        <Input
                          aria-label={t("score.instrumentName")}
                          name="instrumentName"
                          defaultValue={inst.name}
                          required
                          maxLength={120}
                        />
                      </Field>
                      <Field className="wb:min-w-0">
                        <FieldLabel>{t("score.asset")}</FieldLabel>
                        <RegionChoice
                          label={t("score.asset")}
                          name="assetId"
                          defaultValue={region.assetId}
                          items={Object.values(project.assets).map((a) => ({
                            value: a.id,
                            label: a.name,
                          }))}
                        />
                      </Field>
                      {(
                        [
                          "rootMidi",
                          "keyLow",
                          "keyHigh",
                          "velocityLow",
                          "velocityHigh",
                          "roundRobin",
                          "tuneCents",
                          "gainDb",
                          "releaseSeconds",
                        ] as const
                      ).map((k) => (
                        <Field key={k} className="wb:min-w-0">
                          <FieldLabel>{t("score." + k)}</FieldLabel>
                          <Input
                            type="number"
                            step={
                              k === "releaseSeconds"
                                ? 0.005
                                : k === "gainDb"
                                  ? 0.1
                                  : 1
                            }
                            aria-label={t("score." + k)}
                            name={k}
                            defaultValue={region[k]}
                            required
                          />
                        </Field>
                      ))}
                      <Field className="wb:min-w-0">
                        <FieldLabel>{t("score.articulation")}</FieldLabel>
                        <Input
                          aria-label={t("score.articulation")}
                          name="articulation"
                          defaultValue={region.articulation}
                          required
                          maxLength={60}
                        />
                      </Field>
                      <Field className="wb:min-w-0">
                        <FieldLabel>{t("score.releaseAsset")}</FieldLabel>
                        <RegionChoice
                          label={t("score.releaseAsset")}
                          name="releaseAssetId"
                          defaultValue={region.releaseAssetId ?? ""}
                          items={[
                            { value: "", label: t("score.none") },
                            ...Object.values(project.assets).map((a) => ({
                              value: a.id,
                              label: a.name,
                            })),
                          ]}
                        />
                      </Field>
                      <Field orientation="horizontal">
                        <Checkbox
                          id={`score-loop-${layer.id}`}
                          name="loopEnabled"
                          defaultChecked={!!region.loop}
                        />
                        <FieldLabel htmlFor={`score-loop-${layer.id}`}>
                          {t("score.loopVerified")}
                        </FieldLabel>
                      </Field>
                      {(["loopStart", "loopEnd", "crossfade"] as const).map(
                        (k, i) => (
                          <Field key={k} className="wb:min-w-0">
                            <FieldLabel>{t("score." + k)}</FieldLabel>
                            <Input
                              aria-label={t("score." + k)}
                              name={k}
                              type="number"
                              step="1"
                              defaultValue={
                                i === 0
                                  ? (region.loop?.start ?? 0)
                                  : i === 1
                                    ? (region.loop?.end ?? 0)
                                    : (region.loop?.crossfade ?? 64)
                              }
                            />
                          </Field>
                        ),
                      )}
                      <p className="field-help">{t("score.loopHint")}</p>
                      <div className="button-group">
                        <Button type="submit">{t("score.applyRegion")}</Button>
                        <Button
                          variant="outline"
                          type="button"
                          className="secondary"
                          disabled={inst.regions.length <= 1}
                          onClick={() =>
                            updateInstrument({
                              ...inst,
                              regions: inst.regions.filter(
                                (r) => r.id !== region.id,
                              ),
                            })
                          }
                        >
                          {t("score.removeRegion")}
                        </Button>
                      </div>
                    </FieldGroup>
                  </form>
                )}
              </>
            )}
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}
