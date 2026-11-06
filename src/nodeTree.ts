import { hasTimeTransform, playerDuration } from "./playerPlayback";
import { patchLayer, type LayerPatch } from "./model";
import { DEFAULT_EFFECTS, resolveControls } from "./advanced";
import {
  assertProjectLimits,
  makeComposition,
  projectForSave,
  uid,
  type PlayerInput,
  type Project,
} from "./model";
export type NodeAddress = { path: string[]; id: string };
export const nodeKey = (a: NodeAddress) => JSON.stringify([...a.path, a.id]);
export function nodeParent(root: Project, path: string[]) {
  let p = root;
  for (const id of path) {
    const node = p.inputs.find((l) => l.id === id);
    if (!node?.player.mix || node.player.type !== "composition")
      throw Error("error.project");
    p = node.player.mix;
  }
  return p;
}
export function normalizeGroups(root: Project): Project {
  const inputs = root.inputs.map((l) => {
    if (l.player.type !== "composition" || !l.player.mix) return l;
    const child = normalizeGroups(l.player.mix);
    const duration = Math.max(
      child.duration,
      ...child.inputs.map((n) => n.start + n.duration),
    );
    if (!Number.isFinite(duration)) throw Error("error.tree.timeBounds");
    const player = { ...l.player, duration, mix: { ...child, duration } };
    const follows = !l.loop && l.sourceStart === 0 && Math.abs(l.sourceEnd - playerDuration(l.player)) < 1e-6 && Math.abs(l.duration * l.speed - l.sourceEnd) < 1e-6;
    return {
      ...l,
      ...(follows ? { sourceEnd: playerDuration(player), duration: Math.max(0.01, playerDuration(player) / l.speed) } : {}),
      player,
    };
  });
  return { ...root, inputs };
}
function unbound(parent: Project, ids: string[]) {
  if (
    parent.controls?.some((c) =>
      c.mappings.some((m) => ids.includes(m.layerId)),
    )
  )
    throw Error("error.tree.bound");
}
export function groupNodes(
  root: Project,
  path: string[],
  ids: string[],
  name: string,
): {
  root: Project;
  id: string;
} {
  const next = structuredClone(root),
    parent = nodeParent(next, path);
  const chosen = parent.inputs.filter((l) => ids.includes(l.id));
  if (!chosen.length) throw Error("error.tree.choose");
  unbound(parent, ids);
  const start = Math.min(...chosen.map((l) => l.start));
  const duration = Math.max(...chosen.map((l) => l.start + l.duration)) - start;
  const child: Project = {
    schema: "momo.soundforge/v4",
    name,
    duration,
    master: 1,
    echo: 0,
    seed: parent.seed,
    assets: parent.assets,
    inputs: chosen.map((l) => ({ ...l, start: l.start - start })),
  };
  const group = makeComposition(child, { name, start });
  const index = parent.inputs.indexOf(chosen[0]);
  parent.inputs = parent.inputs.filter((l) => !ids.includes(l.id));
  parent.inputs.splice(index, 0, group);
  const normalized = projectForSave(normalizeGroups(next));
  assertProjectLimits(normalized);
  return { root: normalized, id: group.id };
}
export function pathOffset(root: Project, path: string[]) {
  let time = 0,
    p = root;
  for (const id of path) {
    const n = p.inputs.find((l) => l.id === id)!;
    time += n.start;
    p = n.player.mix!;
  }
  return time;
}
export function moveNodes(
  root: Project,
  sourcePath: string[],
  ids: string[],
  targetPath: string[],
  beforeId?: string,
): Project {
  if (
    JSON.stringify(sourcePath) === JSON.stringify(targetPath) &&
    beforeId &&
    ids.includes(beforeId)
  )
    return root;
  const transformed = (path: string[]) => {
    let p = root;
    return path.some(id => { const input = p.inputs.find(n => n.id === id); if (!input?.player.mix) return false; p = input.player.mix; return hasTimeTransform(input); });
  };
  if (JSON.stringify(sourcePath) !== JSON.stringify(targetPath) && (transformed(sourcePath) || transformed(targetPath))) throw Error("player.moveTransformed");
  for (const id of ids) {
  const own = [...sourcePath, id];
    if (own.every((v, i) => targetPath[i] === v))
      throw Error("error.tree.cycle");
  }
  const next = structuredClone(root),
    source = nodeParent(next, sourcePath),
    target = nodeParent(next, targetPath);
  const chosen = source.inputs.filter((l) => ids.includes(l.id));
  if (!chosen.length) throw Error("error.tree.choose");
  if (source !== target) unbound(source, ids);
  const delta = pathOffset(root, sourcePath) - pathOffset(root, targetPath);
  if (
    chosen.some(
      (l) =>
        l.start + delta < -1e-6 ||
        !Number.isFinite(l.start + delta + l.duration),
    )
  )
    throw Error("error.tree.timeBounds");
  for (const layer of chosen) {
    if (source !== target && target.inputs.some((l) => l.id === layer.id))
      throw Error("error.tree.duplicateId");
    if (source !== target && layer.player.type !== "composition") {
      const isolated = projectForSave({
        ...source,
        inputs: [layer],
        controls: undefined,
      });
      const replacements: Record<string, string> = {};
      for (const [id, asset] of Object.entries(isolated.assets)) {
        const key =
          target.assets[id] &&
          JSON.stringify(target.assets[id]) !== JSON.stringify(asset)
            ? uid()
            : id;
        target.assets[key] = { ...asset, id: key };
        replacements[id] = key;
      }
      if (layer.player.assetId)
        layer.player.assetId =
          replacements[layer.player.assetId] ?? layer.player.assetId;
      if (layer.player.score) {
        for (const instrument of layer.player.score.instruments)
          for (const region of instrument.regions) {
            region.assetId = replacements[region.assetId] ?? region.assetId;
            if (region.releaseAssetId)
              region.releaseAssetId =
                replacements[region.releaseAssetId] ?? region.releaseAssetId;
          }
      }
    }
    layer.start = Math.max(0, layer.start + delta);
  }
  source.inputs = source.inputs.filter((l) => !ids.includes(l.id));
  const at = beforeId ? target.inputs.findIndex((l) => l.id === beforeId) : -1;
  target.inputs.splice(at < 0 ? target.inputs.length : at, 0, ...chosen);
  const normalized = projectForSave(normalizeGroups(next));
  assertProjectLimits(normalized);
  return normalized;
}
export function editNode(
  root: Project,
  address: NodeAddress,
  patch: LayerPatch,
): Project {
  const next = structuredClone(root),
    parent = nodeParent(next, address.path),
    index = parent.inputs.findIndex((l) => l.id === address.id);
  if (index < 0) throw Error("error.project");
  parent.inputs[index] = patchLayer(parent.inputs[index], patch);
  return normalizeGroups(next);
}
export function isolatedNode(root: Project, address: NodeAddress): Project {
  const parent = nodeParent(root, address.path),
    node = resolveControls(parent).inputs.find((l) => l.id === address.id);
  if (!node) throw Error("error.project");
  return {
    ...parent,
    name: node.name,
    duration: node.duration,
    master: 1,
    echo: 0,
    effects: undefined,
    loopRegion: undefined,
    controls: undefined,
    controlValues: undefined,
    inputs: [{ ...node, start: 0, muted: false, solo: false }],
  };
}

// Resource recipes can still describe a finished sound. Insert their output settings on
// an explicit node so the editable document root remains a neutral container.
// Resource recipes can still describe a finished sound. Insert their output settings on
// an explicit node so the editable document root remains a neutral container.
export function nodeDocument(project: Project): Project { return project; }
