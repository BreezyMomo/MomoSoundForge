import { CONTENT_KEYS, patchLayer, type LayerPatch } from "./model";
import {
  makeLayer,
  makeProject,
  makeComposition,
  parseProject,
  projectForSave,
  assertProjectLimits,
  type Project,
  type Layer,
} from "./model";
import {
  groupNodes,
  moveNodes,
  nodeParent,
  normalizeGroups,
  nodeDocument,
} from "./nodeTree";
import {
  DEFAULT_EFFECTS,
  PARAMS,
  reconcileAdvanced,
  validateAdvanced,
} from "./advanced";
import { editPolish, POLISH_SCHEMA, type PolishEdit } from "./polishControls";
import { EXPORT_SCHEMA } from "./aiCapabilities";
import { scoreIssues } from "./instruments";

export type EditOperation =
  | { op: "project"; path?: string[]; patch: Partial<Project> }
  | ({ op: "polish"; path?: string[]; id: string } & PolishEdit)
  | { op: "add"; path?: string[]; layer: LayerPatch }
  | { op: "patch"; path?: string[]; id: string; patch: LayerPatch }
  | { op: "remove"; path?: string[]; id: string }
  | { op: "group"; path?: string[]; ids: string[]; name: string }
  | {
      op: "move";
      path?: string[];
      ids: string[];
      targetPath: string[];
      beforeId?: string;
    }
  | {
      op: "insert";
      path?: string[];
      soundId?: string;
      project?: Project;
      start?: number;
      name?: string;
    };

const projectKeys = [
  "name",
  "duration",
  "seed",
  "master",
  "loopRegion",
  "videoReference",
  "controls",
  "controlValues",
];
const layerKeys = [...Object.keys(makeLayer()), "effects", "automation"];
function keys(value: object, allowed: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw Error("ai.invalidEdit");
}
export function applyEdits(
  project: Project,
  operations: EditOperation[],
): Project {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 64
  )
    throw Error("ai.invalidEdit");
  let next = structuredClone(project);
  const validatePaths = new Map<string, string[]>();
  const validateValues: {
    path: string[];
    id?: string;
  }[] = [];
  for (const action of operations) {
    if (!action || typeof action !== "object") throw Error("ai.invalidEdit");
    const path = "path" in action ? (action.path ?? []) : [];
    if (
      !Array.isArray(path) ||
      path.length > 6 ||
      path.some((p) => typeof p !== "string")
    )
      throw Error("ai.invalidEdit");
    const parent = nodeParent(next, path);
    switch (action.op) {
      case "project":
        keys(
          action.patch,
          path.length
            ? projectKeys.filter(
                (k) => !["duration", "videoReference"].includes(k),
              )
            : projectKeys,
        );
        Object.assign(parent, action.patch);
        if (action.patch.controls !== undefined)
          validatePaths.set(JSON.stringify(path), path);
        if (action.patch.controlValues !== undefined)
          validateValues.push({ path });
        break;
      case "polish": {
        keys(action, [
          "op",
          "path",
          "id",
          "action",
          "group",
          "enabled",
          "values",
        ]);
        const layer = parent.layers.find((l) => l.id === action.id);
        if (!layer) throw Error("ai.missingNode");
        layer.effects = editPolish(layer.effects, action);
        break;
      }
      case "add":
        keys(action.layer, layerKeys);
        if (action.layer.content)
          keys(
            action.layer.content,
            [...CONTENT_KEYS].filter(
              (k) => !["assetId", "project", "score"].includes(k),
            ),
          );
        if (
          action.layer.content?.type &&
          action.layer.content?.type !== "synth"
        )
          throw Error("ai.useInsert");
        parent.layers.push(makeLayer(action.layer));
        break;
      case "patch": {
        keys(
          action.patch,
          layerKeys.filter((k) => k !== "id"),
        );
        if (action.patch.content)
          keys(
            action.patch.content,
            [...CONTENT_KEYS].filter(
              (k) => !["type", "assetId", "project"].includes(k),
            ),
          );
        const layer = parent.layers.find((l) => l.id === action.id);
        if (!layer) throw Error("ai.missingNode");
        Object.assign(layer, patchLayer(layer, action.patch));
        if (action.patch.content?.controlValues !== undefined)
          validateValues.push({ path, id: action.id });
        break;
      }
      case "remove": {
        if (!parent.layers.some((l) => l.id === action.id))
          throw Error("ai.missingNode");
        parent.layers = parent.layers.filter((l) => l.id !== action.id);
        break;
      }
      case "group":
        next = groupNodes(next, path, action.ids, action.name).root;
        break;
      case "move":
        next = moveNodes(
          next,
          path,
          action.ids,
          action.targetPath,
          action.beforeId,
        );
        break;
      case "insert": {
        if (!action.project) throw Error("ai.useInsert");
        const child = nodeDocument(parseProject(action.project));
        parent.layers.push(
          makeComposition(child, {
            start: action.start ?? 0,
            name: action.name ?? child.name,
          }),
        );
        break;
      }
      default:
        throw Error("ai.invalidEdit");
    }
  }
  // Validate newly authored definitions/values before reconciliation. Existing values
  // and ancestor bindings still follow the editor's range-change reconciliation.
  for (const path of validatePaths.values()) {
    const p = nodeParent(next, path);
    validateAdvanced({
      ...p,
      controlValues: undefined,
      layers: p.layers.map((l) => ({
        ...l,
        content: {
          ...l.content,
          controlValues: undefined,
        },
      })),
    });
  }
  for (const { path, id } of validateValues) {
    const p = nodeParent(next, path),
      layer = id ? p.layers.find((l) => l.id === id) : undefined;
    if (id && !layer) throw Error("ai.missingNode");
    const controls = id ? layer!.content.project?.controls : p.controls,
      controlValues = id ? layer!.content.controlValues : p.controlValues;
    validateAdvanced({
      ...makeProject("Validation"),
      controls: controls?.map((c) => ({ ...c, mappings: [] })),
      controlValues,
    });
  }
  next = parseProject(projectForSave(reconcileAdvanced(normalizeGroups(next))));
  assertProjectLimits(next);
  return next;
}

// Keep audio out of conversational snapshots. Explicit project export retains PCM.
// Keep audio out of conversational snapshots. Explicit project export retains PCM.
export function describeProject(project: Project): unknown {
  return {
    ...project,
    assets: Object.fromEntries(
      Object.entries(project.assets).map(([id, asset]) => [
        id,
        {
          ...asset,
          channels: undefined,
          channelCount: asset.channels.length,
          frames:
            ((asset.channels[0].length * 3) / 4 -
              (asset.channels[0].endsWith("==")
                ? 2
                : asset.channels[0].endsWith("=")
                  ? 1
                  : 0)) /
            4,
        },
      ]),
    ),
    layers: project.layers.map((l) => ({
      ...l,
      content: {
        ...l.content,
        project: l.content.project
          ? describeProject(l.content.project)
          : undefined,
      },
    })),
  };
}
export function projectScoreIssues(
  project: Project,
  path: string[] = [],
): object[] {
  return project.layers.flatMap((layer) => [
    ...(layer.content.score
      ? scoreIssues(
          layer.content.score,
          project.assets,
          layer.duration,
          project.seed ^ layer.content.noiseSeed,
        ).map((issue) => ({ path, layerId: layer.id, ...issue }))
      : []),
    ...(layer.content.project
      ? projectScoreIssues(layer.content.project, [...path, layer.id])
      : []),
  ]);
}
export const AUTHORING_SCHEMA = {
  schema: "momo.soundforge.ai/v1",
  projectDefaults: makeProject("Untitled"),
  layerDefaults: { ...makeLayer(), id: "<unique id>" },
  contentPatchKeys: [...CONTENT_KEYS].filter(
    (k) => !["type", "assetId", "project"].includes(k),
  ),
  effectsDefaults: DEFAULT_EFFECTS,
  parameterRanges: PARAMS,
  operations: {
    project: {
      path: [],
      patch: projectKeys,
      nested:
        "path addresses a child document; duration is derived, videoReference belongs to root",
    },
    polish: {
      path: [],
      id: "node ID",
      action: "adjust | reset | toggle",
      group: "optional tone | delay | space",
      values: POLISH_SCHEMA.values,
      enabled: "boolean for toggle",
    },
    add: {
      path: [],
      layer:
        "Partial synth layer with source parameters inside content; missing fields use layerDefaults",
    },
    patch: {
      path: [],
      id: "layer id",
      patch: layerKeys.filter((k) => !["id", "type", "assetId"].includes(k)),
    },
    remove: { path: [], id: "layer id" },
    group: { path: [], ids: ["layer id"], name: "Group" },
    move: {
      path: [],
      ids: ["layer id"],
      targetPath: [],
      beforeId: "optional layer id",
    },
    insert: {
      path: [],
      soundId: "catalog ID OR project field with complete native project",
      start: 0,
    },
  },
  time: "Layer start/duration use seconds relative to parent. content.cropStart/cropEnd are normalized fractions. Automation time is normalized [0,1] across the source duration, NOT seconds. Score notes use beats, with score.bpm. Patch content.score by preserving instruments and replacing notes. Groups have content-derived duration. Root duration remains explicit.",
  waves: ["sine", "triangle", "saw", "square", "noise"],
  polish: POLISH_SCHEMA,
  export: EXPORT_SCHEMA,
  automation: {
    keys: ["gain", "pan", "cutoff"],
    time: [0, 1],
    point: { time: 0, value: "native parameter value" },
    maxPoints: 32,
    ordering:
      "strictly increasing time; cannot target a parameter already controlled by a macro",
  },
  controls: {
    scope:
      "project patch with path; definitions may exist at every document level",
    maxPerDocument: 16,
    maxMappings: 32,
    definition: {
      id: "unique",
      name: "Weight",
      min: 0,
      max: 1,
      defaultValue: 0.5,
      mappings: [
        { layerId: "child node ID", parameter: "gain", low: 0.1, high: 0.8 },
      ],
    },
    childBinding: {
      layerId: "group ID",
      parameter: "control",
      controlId: "existing child control ID",
      low: "within child range",
      high: "within child range",
    },
    values:
      "project.controlValues or group layer content.controlValues; values must be in declared ranges",
  },
  notes: {
    schema: "momo.score/v1",
    bpm: [20, 300],
    maxNotesPerScore: 256,
    event: {
      id: "unique",
      instrumentId: "existing instrument ID",
      midi: 60,
      start: 0,
      duration: 0.5,
      velocity: 80,
      articulation: "existing region articulation",
    },
  },
  constraints:
    "Query catalog and capture; use actual instrument regions. A patch shallow-merges content; nested fields such as content.score and effects are replaced in full. Every edit is atomic, version-checked, validated and undoable. Imported sounds become editable groups. All layers have effects. No arbitrary scripts.",
};
