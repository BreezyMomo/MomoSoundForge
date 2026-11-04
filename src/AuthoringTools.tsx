import { useState, useRef } from "react";
import { Range } from "./Inspector";
import { t } from "./i18n";
import { uid, type Layer, type Project } from "./model";
import {
  PARAMS,
  boundControl,
  type Parameter,
  type Macro,
  type Mapping,
  type AutomationKey,
  type CurvePoint,
} from "./advanced";

export function exposeParameter(
  project: Project,
  layer: Layer,
  key: Parameter,
): Project {
  if (
    boundControl(project, layer.id, key) ||
    (project.controls?.length ?? 0) >= 16 ||
    layer.automation?.[key as AutomationKey]?.length
  )
    return project;
  const [min, max] = PARAMS[key];
  const control: Macro = {
    id: uid(),
    name: `${layer.name} · ${t(`pro.param.${key}`)}`.slice(0, 120),
    min,
    max,
    defaultValue: Math.max(min, Math.min(max, layer[key])),
    mappings: [{ layerId: layer.id, parameter: key, low: min, high: max }],
  };
  return { ...project, controls: [...(project.controls ?? []), control] };
}
export function MacroEditor({
  project,
  onChange,
}: {
  project: Project;
  onChange: (p: Project) => void;
}) {
  const controls = project.controls ?? [];
  const [error, setError] = useState("");
  const update = (id: string, patch: Partial<Macro>) => {
    const next = controls.map((c) => (c.id === id ? { ...c, ...patch } : c));
    onChange({ ...project, controls: next });
  };
  return (
    <details className="pro-section">
      <summary>
        {t("pro.controls")} ({controls.length})
      </summary>
      <p className="field-help">{t("pro.controlsHelp")}</p>
      <button
        className="secondary"
        disabled={controls.length >= 16}
        onClick={() =>
          onChange({
            ...project,
            controls: [
              ...controls,
              {
                id: uid(),
                name: t("pro.newControl"),
                min: 0,
                max: 100,
                defaultValue: 50,
                mappings: [],
              },
            ],
          })
        }
      >
        {t("pro.addControl")}
      </button>
      {error && <p role="alert">{t(error)}</p>}
      {controls.map((c, index) => (
        <div className="macro-card" key={c.id}>
          <label>
            {t("pro.name")}
            <input
              value={c.name}
              maxLength={120}
              onChange={(e) => {
                if (e.target.value.trim())
                  update(c.id, { name: e.target.value });
              }}
            />
          </label>
          <div className="pro-numbers">
            <label>
              {t("pro.min")}
              <input
                type="number"
                value={c.min}
                min={-20000}
                max={c.max - 0.001}
                onChange={(e) => {
                  const min = e.target.valueAsNumber;
                  if (Number.isFinite(min) && min >= -20000 && min < c.max) {
                    onChange({
                      ...project,
                      controls: controls.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              min,
                              defaultValue: Math.max(min, c.defaultValue),
                            }
                          : x,
                      ),
                      controlValues: {
                        ...project.controlValues,
                        [c.id]: Math.max(
                          min,
                          project.controlValues?.[c.id] ?? c.defaultValue,
                        ),
                      },
                    });
                  }
                }}
              />
            </label>
            <label>
              {t("pro.max")}
              <input
                type="number"
                value={c.max}
                min={c.min + 0.001}
                max={20000}
                onChange={(e) => {
                  const max = e.target.valueAsNumber;
                  if (Number.isFinite(max) && max <= 20000 && max > c.min)
                    onChange({
                      ...project,
                      controls: controls.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              max,
                              defaultValue: Math.min(max, c.defaultValue),
                            }
                          : x,
                      ),
                      controlValues: {
                        ...project.controlValues,
                        [c.id]: Math.min(
                          max,
                          project.controlValues?.[c.id] ?? c.defaultValue,
                        ),
                      },
                    });
                }}
              />
            </label>
            <label>
              {t("pro.default")}
              <input
                type="number"
                value={c.defaultValue}
                min={c.min}
                max={c.max}
                onChange={(e) => {
                  const v = e.target.valueAsNumber;
                  if (Number.isFinite(v))
                    update(c.id, {
                      defaultValue: Math.max(c.min, Math.min(c.max, v)),
                    });
                }}
              />
            </label>
          </div>
          <Range
            label={t("pro.testControl", c.name)}
            min={c.min}
            max={c.max}
            step={(c.max - c.min) / 1000}
            value={project.controlValues?.[c.id] ?? c.defaultValue}
            onChange={(value) =>
              onChange({
                ...project,
                controlValues: { ...project.controlValues, [c.id]: value },
              })
            }
          />
          <div className="button-group">
            <button
              className="secondary"
              onClick={() => {
                const values = { ...project.controlValues };
                delete values[c.id];
                onChange({ ...project, controlValues: values });
              }}
            >
              {t("pro.resetControl")}
            </button>
            <label>
              <input
                type="checkbox"
                checked={!!c.hidden}
                onChange={(e) => update(c.id, { hidden: e.target.checked })}
              />
              {t("pro.hidden")}
            </label>
            <button
              className="secondary"
              disabled={index === 0}
              onClick={() => {
                const next = [...controls];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                onChange({ ...project, controls: next });
              }}
            >
              {t("pro.up")}
            </button>
            <button
              className="secondary"
              onClick={() => {
                const values = { ...project.controlValues };
                delete values[c.id];
                onChange({
                  ...project,
                  controls: controls.filter((x) => x.id !== c.id),
                  controlValues: values,
                });
              }}
            >
              {t("pro.remove")}
            </button>
          </div>
          {c.mappings.map((m, i) => {
            const layer = project.layers.find((l) => l.id === m.layerId),
              child = layer?.project?.controls?.find(
                (c) => c.id === m.controlId,
              ),
              range = child
                ? [child.min, child.max]
                : PARAMS[m.parameter as Parameter];
            const change = (patch: Partial<Mapping>) =>
              update(c.id, {
                mappings: c.mappings.map((v, j) =>
                  j === i ? { ...v, ...patch } : v,
                ),
              });
            return (
              <div
                className="macro-mapping"
                key={`${m.layerId}:${m.parameter}:${m.controlId}`}
              >
                <span>
                  {layer?.name} / {child?.name ?? t(`pro.param.${m.parameter}`)}
                </span>
                <label>
                  {t("pro.atMin")}
                  <input
                    type="number"
                    value={m.low}
                    min={range?.[0]}
                    max={range?.[1]}
                    onChange={(e) => {
                      const v = e.target.valueAsNumber;
                      if (
                        Number.isFinite(v) &&
                        range &&
                        v >= range[0] &&
                        v <= range[1]
                      )
                        change({ low: v, logarithmic: m.logarithmic && v > 0 });
                    }}
                  />
                </label>
                <label>
                  {t("pro.atMax")}
                  <input
                    type="number"
                    value={m.high}
                    min={range?.[0]}
                    max={range?.[1]}
                    onChange={(e) => {
                      const v = e.target.valueAsNumber;
                      if (
                        Number.isFinite(v) &&
                        range &&
                        v >= range[0] &&
                        v <= range[1]
                      )
                        change({
                          high: v,
                          logarithmic: m.logarithmic && v > 0,
                        });
                    }}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={!!m.logarithmic}
                    disabled={m.low <= 0 || m.high <= 0}
                    onChange={(e) => change({ logarithmic: e.target.checked })}
                  />
                  {t("pro.logarithmic")}
                </label>
                <button
                  className="text-button"
                  onClick={() =>
                    update(c.id, {
                      mappings: c.mappings.filter((_, j) => j !== i),
                    })
                  }
                >
                  {t("pro.remove")}
                </button>
              </div>
            );
          })}
          <label>
            {t("pro.bind")}
            <select
              value=""
              disabled={c.mappings.length >= 32}
              onChange={(e) => {
                if (!e.target.value) return;
                const [layerId, parameter, controlId] = JSON.parse(
                  e.target.value,
                ) as [string, Parameter | "control", string?];
                if (
                  controls.some((x) =>
                    x.mappings.some(
                      (m) =>
                        m.layerId === layerId &&
                        m.parameter === parameter &&
                        m.controlId === controlId,
                    ),
                  )
                ) {
                  setError("pro.alreadyBound");
                  return;
                }
                const layer = project.layers.find((l) => l.id === layerId)!;
                const child = layer.project?.controls?.find(
                    (x) => x.id === controlId,
                  ),
                  range =
                    parameter === "control" && child
                      ? [child.min, child.max]
                      : PARAMS[parameter as Parameter];
                setError("");
                update(c.id, {
                  mappings: [
                    ...c.mappings,
                    {
                      layerId,
                      parameter,
                      ...(controlId ? { controlId } : {}),
                      low: range[0],
                      high: range[1],
                    },
                  ],
                });
              }}
            >
              <option value="">{t("pro.chooseParameter")}</option>
              {project.layers.map((l) => (
                <optgroup key={l.id} label={l.name}>
                  {(Object.keys(PARAMS) as Parameter[])
                    .filter((k) => !l.automation?.[k as AutomationKey]?.length)
                    .map((k) => (
                      <option
                        key={k}
                        value={JSON.stringify([l.id, k])}
                        disabled={!!boundControl(project, l.id, k)}
                      >
                        {t(`pro.param.${k}`)}
                      </option>
                    ))}
                  {l.project?.controls?.map((child) => (
                    <option
                      key={child.id}
                      value={JSON.stringify([l.id, "control", child.id])}
                    >
                      {child.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      ))}
    </details>
  );
}

export function AutomationEditor({
  layer,
  project,
  onChange,
}: {
  layer: Layer;
  project: Project;
  onChange: (automation: Layer["automation"]) => void;
}) {
  const [key, setKey] = useState<AutomationKey>("gain"),
    [draft, setDraft] = useState<CurvePoint[] | null>(null),
    [selected, setSelected] = useState(0);
  const gesture = useRef<{
    index: number;
    points: CurvePoint[];
    id: number;
  } | null>(null);
  const points = draft ?? layer.automation?.[key] ?? [],
    [min, max] = PARAMS[key],
    logarithmic = key === "cutoff";
  const unit = (value: number) =>
    logarithmic
      ? Math.log(value / min) / Math.log(max / min)
      : (value - min) / (max - min);
  const value = (u: number) =>
    logarithmic ? min * Math.pow(max / min, u) : min + (max - min) * u;
  const commit = (p: CurvePoint[]) =>
    onChange({ ...layer.automation, [key]: p });
  return (
    <details className="pro-section">
      <summary>{t("pro.automation")}</summary>
      <select
        aria-label={t("pro.curveParameter")}
        value={key}
        onChange={(e) => {
          gesture.current = null;
          setKey(e.target.value as AutomationKey);
          setDraft(null);
          setSelected(0);
        }}
      >
        {(["gain", "pan", "cutoff"] as const).map((k) => (
          <option key={k} value={k}>
            {t(`pro.param.${k}`)}
          </option>
        ))}
      </select>
      <label>
        <input
          type="checkbox"
          checked={points.length > 0}
          disabled={!!boundControl(project, layer.id, key)}
          onChange={(e) =>
            commit(
              e.target.checked
                ? [
                    { time: 0, value: layer[key] },
                    { time: 1, value: layer[key] },
                  ]
                : [],
            )
          }
        />
        {t("pro.enableCurve")}
      </label>
      {boundControl(project, layer.id, key) && (
        <p>{t("pro.controlled", boundControl(project, layer.id, key)!.name)}</p>
      )}
      {points.length > 0 && (
        <>
          <p className="field-help">{t("pro.curveHelp")}</p>
          <svg
            className="automation-plot"
            viewBox="0 0 300 120"
          preserveAspectRatio="none"
            role="img"
            aria-label={t("pro.curveParameter")}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const time = Math.max(
                  0,
                  Math.min(1, (e.clientX - rect.left) / rect.width),
                ),
                v = value(
                  1 -
                    Math.max(
                      0,
                      Math.min(1, (e.clientY - rect.top) / rect.height),
                    ),
                );
              let index = points.findIndex(
                  (p) => Math.abs(p.time - time) * rect.width < 10,
                ),
                next = points.map((p) => ({ ...p }));
              if (index < 0) {
                if (points.length >= 32) return;
                next.push({ time, value: v });
                next.sort((a, b) => a.time - b.time);
                index = next.findIndex((p) => p.time === time);
              }
              gesture.current = { index, points: next, id: e.pointerId };
              setSelected(index);
              setDraft(next);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (!g) return;
              const rect = e.currentTarget.getBoundingClientRect(),
                i = g.index;
              const time = Math.max(
                i ? g.points[i - 1].time + 0.0001 : 0,
                Math.min(
                  i < g.points.length - 1 ? g.points[i + 1].time - 0.0001 : 1,
                  (e.clientX - rect.left) / rect.width,
                ),
              );
              g.points = g.points.map((p, j) =>
                j === i
                  ? {
                      time,
                      value: value(
                        1 -
                          Math.max(
                            0,
                            Math.min(1, (e.clientY - rect.top) / rect.height),
                          ),
                      ),
                    }
                  : p,
              );
              setDraft(g.points);
            }}
            onPointerUp={(e) => {
              const g = gesture.current;
              if (!g) return;
              gesture.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
              setDraft(null);
              commit(g.points);
            }}
            onPointerCancel={() => {
              gesture.current = null;
              setDraft(null);
            }}
          >
            <path d="M0 60H300 M150 0V120" className="curve-grid" />
            <polyline
              points={points
                .map((p) => `${p.time * 300},${(1 - unit(p.value)) * 120}`)
                .join(" ")}
              fill="none"
            />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.time * 300}
                cy={(1 - unit(p.value)) * 120}
                r={i === selected ? 5 : 3}
              />
            ))}
          </svg>
          <select
            aria-label={t("pro.point")}
            value={Math.min(selected, points.length - 1)}
            onChange={(e) => setSelected(+e.target.value)}
          >
            {points.map((p, i) => (
              <option key={i} value={i}>
                {i + 1} · {(p.time * layer.duration).toFixed(3)} s
              </option>
            ))}
          </select>
          {points[Math.min(selected, points.length - 1)] && (
            <Range
              label={t("pro.pointValue")}
              value={points[Math.min(selected, points.length - 1)].value}
              min={min}
              max={max}
              step={(max - min) / 1000}
              onChange={(v) =>
                commit(
                  points.map((p, i) =>
                    i === Math.min(selected, points.length - 1)
                      ? { ...p, value: v }
                      : p,
                  ),
                )
              }
            />
          )}
          {points[selected] && (
            <Range
              label={t("pro.pointTime")}
              value={points[selected].time * layer.duration}
              min={
                selected
                  ? (points[selected - 1].time + 0.0001) * layer.duration
                  : 0
              }
              max={
                selected < points.length - 1
                  ? (points[selected + 1].time - 0.0001) * layer.duration
                  : layer.duration
              }
              step={0.001}
              unit="s"
              onChange={(v) =>
                commit(
                  points.map((p, i) =>
                    i === selected ? { ...p, time: v / layer.duration } : p,
                  ),
                )
              }
            />
          )}
          <button
            className="secondary"
            disabled={points.length <= 2}
            onClick={() => {
              commit(points.filter((_, i) => i !== selected));
              setSelected(0);
            }}
          >
            {t("pro.removePoint")}
          </button>
        </>
      )}
    </details>
  );
}
