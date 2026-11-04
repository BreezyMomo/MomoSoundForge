import type { Layer, Project } from "./model";
export type CurvePoint = { time: number; value: number };
export type AutomationKey = "gain" | "pan" | "cutoff";
export type Automation = Partial<Record<AutomationKey, CurvePoint[]>>;
export const PARAMS = {
  gain: [0, 1.5],
  pan: [-1, 1],
  cutoff: [30, 22000],
  frequency: [20, 20000],
  endFrequency: [20, 20000],
  start: [0, 10],
  attack: [0, 3],
  release: [0, 5],
  decay: [0, 10],
  drive: [0, 10],
} as const;
export type Parameter = keyof typeof PARAMS;
export type Mapping = {
  layerId: string;
  parameter: Parameter | "control";
  controlId?: string;
  low: number;
  high: number;
  logarithmic?: boolean;
};
export type Macro = {
  id: string;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  hidden?: boolean;
  mappings: Mapping[];
};
export type Effects = {
  low: number;
  mid: number;
  high: number;
  delayTime: number;
  delayFeedback: number;
  delayWet: number;
  reverb: number;
  ceiling: number;
};
export const DEFAULT_EFFECTS: Effects = {
  low: 0,
  mid: 0,
  high: 0,
  delayTime: 0.18,
  delayFeedback: 0.25,
  delayWet: 0,
  reverb: 0,
  ceiling: -0.18,
};
export type LoopRegion = { start: number; end: number; crossfade: number };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export function curveValue(
  points: CurvePoint[] | undefined,
  time: number,
  fallback: number,
  logarithmic = false,
) {
  if (!points?.length) return fallback;
  if (time <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i++)
    if (time <= points[i].time) {
      const a = points[i - 1],
        b = points[i],
        u = (time - a.time) / (b.time - a.time);
      return logarithmic && a.value > 0 && b.value > 0
        ? a.value * Math.pow(b.value / a.value, u)
        : a.value + (b.value - a.value) * u;
    }
  return points[points.length - 1].value;
}
export function resolveControls(
  project: Project,
  values: Record<string, number> = project.controlValues ?? {},
): Project {
  if (!project.controls?.length) return project;
  values = { ...project.controlValues, ...values };
  const layers = project.layers.map((l) => ({
    ...l,
    controlValues: l.controlValues ? { ...l.controlValues } : undefined,
  }));
  for (const control of project.controls) {
    const value = clamp(
        values[control.id] ?? control.defaultValue,
        control.min,
        control.max,
      ),
      u = (value - control.min) / (control.max - control.min);
    for (const m of control.mappings) {
      const layer = layers.find((l) => l.id === m.layerId);
      if (!layer) continue;
      const mapped =
        m.logarithmic && m.low > 0 && m.high > 0
          ? m.low * Math.pow(m.high / m.low, u)
          : m.low + (m.high - m.low) * u;
      if (m.parameter === "control" && m.controlId)
        layer.controlValues = { ...layer.controlValues, [m.controlId]: mapped };
      else if (m.parameter !== "control")
        (layer[m.parameter] as number) = mapped;
    }
  }
  return { ...project, layers, controlValues: values };
}
export function boundControl(
  project: Project,
  layerId: string,
  parameter: string,
) {
  return project.controls?.find((c) =>
    c.mappings.some((m) => m.layerId === layerId && m.parameter === parameter),
  );
}
export function validateAdvanced(project: Project) {
  const fail = () => {
    throw Error("Invalid SoundForge controls or processing");
  };
  const number = (v: unknown, a: number, b: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
  if (project.effects) {
    const ranges: Record<keyof Effects, number[]> = {
      low: [-24, 24],
      mid: [-24, 24],
      high: [-24, 24],
      delayTime: [0.01, 1],
      delayFeedback: [0, 0.85],
      delayWet: [0, 1],
      reverb: [0, 1],
      ceiling: [-12, 0],
    };
    for (const [k, [a, b]] of Object.entries(ranges))
      if (!number(project.effects[k as keyof Effects], a, b)) fail();
  }
  if (project.loopRegion) {
    const r = project.loopRegion;
    if (
      !number(r.start, 0, project.duration) ||
      !number(r.end, 0, project.duration) ||
      r.end - r.start < 0.01 ||
      !number(r.crossfade, 0, (r.end - r.start) / 2)
    )
      fail();
  }
  const ids = new Set<string>(),
    targets = new Set<string>();
  if (
    project.controls !== undefined &&
    (!Array.isArray(project.controls) || project.controls.length > 16)
  )
    fail();
  for (const c of project.controls ?? []) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id ||
      c.id.length > 120 ||
      Object.hasOwn(Object.prototype, c.id) ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 120 ||
      !number(c.min, -20000, 20000) ||
      !number(c.max, -20000, 20000) ||
      c.min >= c.max ||
      !number(c.defaultValue, c.min, c.max) ||
      !Array.isArray(c.mappings) ||
      c.mappings.length > 32 ||
      (c.hidden !== undefined && typeof c.hidden !== "boolean")
    )
      fail();
    ids.add(c.id);
    for (const m of c.mappings) {
      if (
        !m ||
        typeof m.layerId !== "string" ||
        (m.logarithmic !== undefined && typeof m.logarithmic !== "boolean")
      )
        fail();
      const l = project.layers.find((l) => l.id === m.layerId),
        child = l?.project?.controls?.find((c) => c.id === m.controlId);
      const range =
        m.parameter === "control" && child
          ? [child.min, child.max]
          : PARAMS[m.parameter as Parameter];
      const key = JSON.stringify([m.layerId, m.parameter, m.controlId]);
      if (
        !l ||
        !range ||
        (m.parameter !== "control" && m.controlId !== undefined) ||
        targets.has(key) ||
        !number(m.low, range[0], range[1]) ||
        !number(m.high, range[0], range[1]) ||
        (m.parameter !== "control" &&
          l.automation?.[m.parameter as AutomationKey]?.length) ||
        (m.logarithmic && (m.low <= 0 || m.high <= 0))
      )
        fail();
      targets.add(key);
    }
  }
  const validateValues = (
    values: Record<string, number> | undefined,
    controls: Macro[] | undefined,
  ) => {
    if (values === undefined) return;
    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      Object.keys(values).length > 16
    )
      fail();
    for (const [id, value] of Object.entries(values)) {
      const c = controls?.find((c) => c.id === id);
      if (!c || !number(value, c.min, c.max)) fail();
    }
  };
  validateValues(project.controlValues, project.controls);
  for (const l of project.layers) {
    validateValues(l.controlValues, l.project?.controls);
    if (l.automation !== undefined) {
      if (
        !l.automation ||
        typeof l.automation !== "object" ||
        Array.isArray(l.automation)
      )
        fail();
      for (const [key, points] of Object.entries(l.automation)) {
        if (
          !["gain", "pan", "cutoff"].includes(key) ||
          !Array.isArray(points) ||
          points.length > 32
        )
          fail();
        let last = -1;
        for (const p of points) {
          const [a, b] = PARAMS[key as AutomationKey];
          if (
            !p ||
            !number(p.time, 0, 1) ||
            p.time <= last ||
            !number(p.value, a, b)
          )
            fail();
          last = p.time;
        }
      }
    }
  }
}
// Authored edits may remove layers/child controls. Repair their references, never imported data.
export function reconcileAdvanced(project: Project): Project {
  const values = (
    v: Record<string, number> | undefined,
    controls: Macro[] | undefined,
  ) =>
    v
      ? Object.fromEntries(
          Object.entries(v).flatMap(([id, n]) => {
            const c = controls?.find((c) => c.id === id);
            return c ? [[id, clamp(n, c.min, c.max)]] : [];
          }),
        )
      : undefined;
  const layers = project.layers.map((l) => {
    const child = l.project ? reconcileAdvanced(l.project) : undefined;
    return {
      ...l,
      ...(child ? { project: child } : {}),
      controlValues: values(l.controlValues, child?.controls),
    };
  });
  const controls = project.controls?.map((c) => ({
    ...c,
    mappings: c.mappings.flatMap((m) => {
      const layer = layers.find((l) => l.id === m.layerId);
      if (!layer) return [];
      if (m.parameter !== "control") return [m];
      const child = layer.project?.controls?.find((c) => c.id === m.controlId);
      if (!child) return [];
      const low = clamp(m.low, child.min, child.max),
        high = clamp(m.high, child.min, child.max);
      return [
        { ...m, low, high, logarithmic: m.logarithmic && low > 0 && high > 0 },
      ];
    }),
  }));
  let loopRegion = project.loopRegion;
  if (loopRegion) {
    const end = Math.min(project.duration, loopRegion.end),
      start = Math.min(loopRegion.start, end - 0.01);
    loopRegion = {
      start,
      end,
      crossfade: Math.min(loopRegion.crossfade, (end - start) / 2),
    };
  }
  const result = {
    ...project,
    layers,
    controls,
    controlValues: values(project.controlValues, controls),
    loopRegion,
  };
  validateAdvanced(result);
  return result;
}
export function processEffects(
  left: Float32Array,
  right: Float32Array,
  rate: number,
  e: Effects,
) {
  const lowGain = 10 ** (e.low / 20),
    midGain = 10 ** (e.mid / 20),
    highGain = 10 ** (e.high / 20);
  const a = 1 - Math.exp((-2 * Math.PI * 200) / rate),
    b = 1 - Math.exp((-2 * Math.PI * 3000) / rate);
  for (const channel of [left, right]) {
    let low = 0,
      upper = 0;
    if (e.low || e.mid || e.high)
      for (let i = 0; i < channel.length; i++) {
        const x = channel[i];
        low += a * (x - low);
        upper += b * (x - upper);
        channel[i] =
          low * lowGain + (upper - low) * midGain + (x - upper) * highGain;
      }
    if (e.delayWet > 0) {
      const n = Math.max(1, Math.round(e.delayTime * rate)),
        ring = new Float32Array(n);
      for (let i = 0; i < channel.length; i++) {
        const j = i % n,
          delayed = ring[j];
        ring[j] = channel[i] + delayed * e.delayFeedback;
        channel[i] += delayed * e.delayWet;
      }
    }
    if (e.reverb > 0) {
      const delays = [0.0297, 0.0371, 0.0411, 0.0437].map(
        (t) => new Float32Array(Math.max(1, Math.round(t * rate))),
      );
      for (let i = 0; i < channel.length; i++) {
        let wet = 0;
        const dry = channel[i];
        for (const ring of delays) {
          const j = i % ring.length,
            v = ring[j];
          ring[j] = dry + v * 0.72;
          wet += v;
        }
        channel[i] = dry + wet * 0.25 * e.reverb;
      }
    }
  }
}
