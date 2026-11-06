import { reconcileAdvanced, resolveControls } from "./advanced";
import {
  makeComposition,
  makeLayer,
  makeProject,
  parseProject,
  projectForSave,
  updateProjectAtPath,
  uid,
  type Project,
  type SampleAsset,
  type SoundContent,
} from "./model";
import { nodeParent, normalizeGroups, type NodeAddress } from "./nodeTree";

export type ContentCandidate = {
  name: string;
  content: SoundContent;
  duration: number;
  assets: Project["assets"];
};

export function contentReplacementError(error: unknown, fallback: string): string {
  return error instanceof Error &&
    (error.message.startsWith("error.") || error.message === "library.builtinLoadError")
    ? error.message
    : fallback;
}

/** Candidate audio settings belong inside the new content; the destination keeps its outer mix. */
export function contentCandidate(
  source: Project,
  asComposition = false,
): ContentCandidate {
  const p = parseProject(projectForSave(source));
  const layer = resolveControls(p).layers[0];
  if (
    !asComposition &&
    p.layers.length === 1 &&
    layer.content.type === "sample" &&
    !p.effects &&
    !p.echo &&
    !layer.effects &&
    !layer.automation &&
    layer.pan === 0
  ) {
    const asset = p.assets[layer.content.assetId!];
    const id = uid();
    return {
      name: p.name,
      duration: layer.duration,
      content: {
        ...layer.content,
        assetId: id,
        level: layer.content.level * layer.gain * p.master,
      },
      assets: { [id]: { ...asset, id } },
    };
  }
  // Keep the candidate's internal mix, effects, controls, seeds and resources together.
  const group = makeComposition(p);
  return {
    name: p.name,
    content: group.content,
    duration: group.duration,
    assets: {},
  };
}

export function localContentCandidate(
  asset: SampleAsset,
  duration: number,
): ContentCandidate {
  return contentCandidate({
    ...makeProject(asset.name),
    duration,
    assets: { [asset.id]: asset },
    layers: [
      makeLayer({
        type: "sample",
        assetId: asset.id,
        duration,
        frequency: 440,
        endFrequency: 440,
        gain: 1,
        attack: 0.002,
        release: 0.02,
        decay: 0,
      }),
    ],
  });
}

export const isOuterMapping = (parameter: string) =>
  ["start", "gain", "pan"].includes(parameter);

export function contentBindingCount(
  root: Project,
  address: NodeAddress,
): number {
  return (
    nodeParent(root, address.path).controls?.reduce(
      (count, c) =>
        count +
        c.mappings.filter(
          (m) => m.layerId === address.id && !isOuterMapping(m.parameter),
        ).length,
      0,
    ) ?? 0
  );
}

/** Pure edit shared by the full-work preview and single undoable confirmation. */
export function replaceContent(
  root: Project,
  address: NodeAddress,
  candidate: ContentCandidate,
): Project {
  const parent = nodeParent(root, address.path);
  const old = parent.layers.find((l) => l.id === address.id);
  if (!old || !["sample", "composition"].includes(candidate.content.type))
    throw Error("error.replaceSource");
  if (
    Object.keys(candidate.assets).some((id) => Object.hasOwn(parent.assets, id))
  )
    throw Error("error.replaceSource");
  const content = structuredClone(candidate.content);
  const automation =
    old.automation &&
    Object.fromEntries(
      Object.entries(old.automation).filter(
        ([key]) => key === "gain" || key === "pan",
      ),
    );
  const replacement = {
    ...old,
    content,
    duration: candidate.duration,
    automation,
  };
  const changed = updateProjectAtPath(root, address.path, (p) => ({
    ...p,
    assets: { ...p.assets, ...candidate.assets },
    layers: p.layers.map((l) => (l.id === old.id ? replacement : l)),
    controls: p.controls?.map((c) => ({
      ...c,
      mappings: c.mappings.filter(
        (m) => m.layerId !== old.id || isOuterMapping(m.parameter),
      ),
    })),
  }));
  const next = reconcileAdvanced(normalizeGroups(changed));
  // Long replacements remain visible as overflow; changing content does not extend the work window.
  return parseProject(projectForSave({ ...next, duration: root.duration }));
}
