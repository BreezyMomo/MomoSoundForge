import { reconcileAdvanced, resolveControls } from "./advanced";
import {
  makeComposition,
  makeLayer,
  makeProject,
  parseProject,
  projectForSave,
  reusableInput,
  updateProjectAtPath,
  uid,
  type Project,
  type SampleAsset,
  type Player,
} from "./model";
import { nodeParent, normalizeGroups, type NodeAddress } from "./nodeTree";
import { playerDuration } from "./playerPlayback";

export type ContentCandidate = {
  name: string;
  player: Player;
  duration: number;
  assets: Project["assets"];
};

export function contentReplacementError(error: unknown, fallback: string): string {
  return error instanceof Error &&
    (error.message.startsWith("error.") || error.message === "library.builtinLoadError")
    ? error.message
    : fallback;
}

/** Candidate audio settings belong inside the new player; the destination keeps its outer mix. */
export function contentCandidate(
  source: Project,
  asComposition = false,
): ContentCandidate {
  const p = parseProject(projectForSave(source));
  const layer = resolveControls(p).inputs[0];
  // Reusing a neutral root adds no extra audio-processing boundary.
  if (p.inputs.length === 1 && p.master === 1 && !p.echo && !p.effects && !p.controls?.length &&
      !layer.muted && !layer.automation && layer.gain === 1 && layer.pan === 0 &&
      layer.start === 0 && layer.sourceStart === 0 && !layer.loop && !layer.reverse && layer.speed === 1 &&
      Math.abs(layer.duration - playerDuration(layer.player)) < 1e-6 &&
      Math.abs(layer.sourceEnd - layer.duration) < 1e-6 && Math.abs(p.duration - layer.duration) < 1e-6) {
    const { input, assets } = reusableInput(p);
    return { name: p.name, player: input.player, duration: playerDuration(input.player), assets };
  }
  if (
    !asComposition &&
    p.inputs.length === 1 &&
    layer.player.type === "sample" &&
    !p.effects &&
    !p.echo &&
    !layer.muted &&
    layer.sourceStart === 0 && !layer.loop && layer.speed === 1 && !layer.reverse && layer.start === 0 &&
    Math.abs(layer.sourceEnd - layer.player.duration) < 1e-6 &&
    !layer.player.effects &&
    !layer.automation &&
    layer.pan === 0
  ) {
    const asset = p.assets[layer.player.assetId!];
    const id = uid();
    return {
      name: p.name,
      duration: layer.duration,
      player: {
        ...layer.player,
        assetId: id,
        level: layer.player.level * layer.gain * p.master,
      },
      assets: { [id]: { ...asset, id } },
    };
  }
  // Keep the candidate's internal mix, effects, controls, seeds and resources together.
  const group = makeComposition(p);
  return {
    name: p.name,
    player: group.player,
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
    inputs: [
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
  const old = parent.inputs.find((l) => l.id === address.id);
  if (!old || !Number.isFinite(candidate.duration) || candidate.duration <= 0 || !["synth", "sample", "composition", "instrument"].includes(candidate.player.type))
    throw Error("error.replaceSource");
  if (
    Object.keys(candidate.assets).some((id) => Object.hasOwn(parent.assets, id))
  )
    throw Error("error.replaceSource");
  const player = structuredClone(candidate.player);
  const automation =
    old.automation &&
    Object.fromEntries(
      Object.entries(old.automation).filter(
        ([key]) => key === "gain" || key === "pan",
      ),
    );
  const replacement = {
    ...old,
    player,

    automation,
  };
  const changed = updateProjectAtPath(root, address.path, (p) => ({
    ...p,
    assets: { ...p.assets, ...candidate.assets },
    inputs: p.inputs.map((l) => (l.id === old.id ? replacement : l)),
    controls: p.controls?.map((c) => ({
      ...c,
      mappings: c.mappings.filter(
        (m) => m.layerId !== old.id || isOuterMapping(m.parameter),
      ),
    })),
  }));
  const next = reconcileAdvanced(normalizeGroups(changed));
  // Long replacements remain visible as overflow; changing player does not extend the work window.
  return parseProject(projectForSave({ ...next, duration: root.duration }));
}
