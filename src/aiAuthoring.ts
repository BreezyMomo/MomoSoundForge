import { sampleFrames } from './sampleReference';
import { CONTENT_KEYS, patchLayer, type LayerPatch } from "./model";
import { RESOURCE_SCHEMA } from './resourceSchema';
import {
  makeLayer,
  withLayerValue,
  makeProject,
  makeComposition,
  reusableInput,
  parseProject,
  projectForSave,
  assertProjectLimits,
  type Project,
  type PlayerInput,
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
const layerKeys = [...Object.keys(makeLayer()), "automation"];
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
        const layer = parent.inputs.find((l) => l.id === action.id);
        if (!layer) throw Error("ai.missingNode");
        Object.assign(layer, withLayerValue(layer, "effects", editPolish(layer.player.effects, action)));
        break;
      }
      case "add":
        keys(action.layer, layerKeys);
        if (action.layer.player)
          keys(
            action.layer.player,
            [...CONTENT_KEYS, "duration"].filter(
              (k) => !["assetId", "mix", "score"].includes(k),
            ),
          );
        if (
          action.layer.player?.type &&
          action.layer.player?.type !== "synth"
        )
          throw Error("ai.useInsert");
        parent.inputs.push(makeLayer(action.layer));
        break;
      case "patch": {
        keys(
          action.patch,
          layerKeys.filter((k) => k !== "id"),
        );
        if (action.patch.player)
          keys(
            action.patch.player,
            [...CONTENT_KEYS, "duration"].filter(
              (k) => !["type", "assetId", "mix"].includes(k),
            ),
          );
        const layer = parent.inputs.find((l) => l.id === action.id);
        if (!layer) throw Error("ai.missingNode");
        Object.assign(layer, patchLayer(layer, action.patch));
        if (action.patch.player?.controlValues !== undefined)
          validateValues.push({ path, id: action.id });
        break;
      }
      case "remove": {
        if (!parent.inputs.some((l) => l.id === action.id))
          throw Error("ai.missingNode");
        parent.inputs = parent.inputs.filter((l) => l.id !== action.id);
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
        const { input, assets } = reusableInput(child);
        parent.inputs.push({ ...input, start: action.start ?? 0, name: action.name ?? child.name });
        Object.assign(parent.assets, assets);
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
      inputs: p.inputs.map((l) => ({
        ...l,
        player: {
          ...l.player,
          controlValues: undefined,
        },
      })),
    });
  }
  for (const { path, id } of validateValues) {
    const p = nodeParent(next, path),
      layer = id ? p.inputs.find((l) => l.id === id) : undefined;
    if (id && !layer) throw Error("ai.missingNode");
    const controls = id ? layer!.player.mix?.controls : p.controls,
      controlValues = id ? layer!.player.controlValues : p.controlValues;
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
          channelCount: asset.reference ? 2 : asset.channels.length,
          frames: sampleFrames(asset),
        },
      ]),
    ),
    inputs: project.inputs.map((l) => ({
      ...l,
      player: {
        ...l.player,
        mix: l.player.mix
          ? describeProject(l.player.mix)
          : undefined,
      },
    })),
  };
}
export function projectScoreIssues(
  project: Project,
  path: string[] = [],
): object[] {
  return project.inputs.flatMap((layer) => [
    ...(layer.player.score
      ? scoreIssues(
          layer.player.score,
          project.assets,
          layer.player.duration,
          layer.player.noiseSeed,
        ).map((issue) => ({ path, layerId: layer.id, ...issue }))
      : []),
    ...(layer.player.mix
      ? projectScoreIssues(layer.player.mix, [...path, layer.id])
      : []),
  ]);
}
export const AUTHORING_SCHEMA = {
  schema: "momo.soundforge.ai/v1",
  resources: RESOURCE_SCHEMA,
  projectDefaults: makeProject("Untitled"),
  layerDefaults: { ...makeLayer(), id: "<unique id>" },
  playerPatchKeys: [...CONTENT_KEYS, "duration"].filter(
    (k) => !["type", "assetId", "mix"].includes(k),
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
        "Partial parent input with source parameters inside player; missing fields use layerDefaults",
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
  time: "Inputs own start/duration in parent seconds, sourceStart/sourceEnd in child-output seconds, speed, loop and reverse. player.duration is the intrinsic source body; effects extend its output. Over-read is silence, loops retain the requested read interval. Gain/pan automation time is normalized [0,1] over this use; cutoff automation is over source body. player.score notes use beats and score.bpm. Preserve instruments when replacing notes. Native files use momo.soundforge/v4 with root player; capture exposes root mix inputs. Work duration is explicit.",
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
      "project.controlValues or group input player.controlValues; values must be in declared ranges",
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
    "Query catalog and capture; use actual instrument regions. A patch shallow-merges player; player.score and player.effects are replaced in full. Every edit is atomic, version-checked, validated and undoable. Insert retains meaningful mix boundaries and reuses neutral single-input roots. Effects belong to players. No arbitrary scripts.",
};
