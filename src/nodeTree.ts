import { DEFAULT_EFFECTS, resolveControls } from "./advanced";
import {
  assertProjectLimits,
  makeComposition,
  projectForSave,
  uid,
  type Layer,
  type Project,
} from "./model";
export type NodeAddress = { path: string[]; id: string };
export const nodeKey = (a: NodeAddress) => JSON.stringify([...a.path, a.id]);
export function nodeParent(root: Project, path: string[]) {
  let p = root;
  for (const id of path) {
    const node = p.layers.find((l) => l.id === id);
    if (!node?.project || node.type !== "composition")
      throw Error("error.project");
    p = node.project;
  }
  return p;
}
export function normalizeGroups(root: Project): Project {
  const layers = root.layers.map((l) => {
    if (l.type !== "composition" || !l.project) return l;
    const child = normalizeGroups(l.project);
    const duration = Math.max(
      0.1,
      ...child.layers.map((n) => n.start + n.duration),
    );
    if (duration > 10 + 1e-6) throw Error("error.tree.timeBounds");
    return { ...l, duration, project: { ...child, duration } };
  });
  return { ...root, layers };
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
): { root: Project; id: string } {
  const next = structuredClone(root),
    parent = nodeParent(next, path);
  const chosen = parent.layers.filter((l) => ids.includes(l.id));
  if (!chosen.length) throw Error("error.tree.choose");
  unbound(parent, ids);
  const start = Math.min(...chosen.map((l) => l.start));
  const duration = Math.max(...chosen.map((l) => l.start + l.duration)) - start;
  const child: Project = {
    schema: "momo.soundforge/v2",
    name,
    duration,
    master: 1,
    echo: 0,
    seed: parent.seed,
    assets: parent.assets,
    layers: chosen.map((l) => ({ ...l, start: l.start - start })),
  };
  const group = makeComposition(child, { name, start });
  const index = parent.layers.indexOf(chosen[0]);
  parent.layers = parent.layers.filter((l) => !ids.includes(l.id));
  parent.layers.splice(index, 0, group);
  const normalized = projectForSave(normalizeGroups(next));
  assertProjectLimits(normalized);
  return { root: normalized, id: group.id };
}
function pathOffset(root: Project, path: string[]) {
  let time = 0,
    p = root;
  for (const id of path) {
    const n = p.layers.find((l) => l.id === id)!;
    time += n.start;
    p = n.project!;
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
  for (const id of ids) {
    const own = [...sourcePath, id];
    if (own.every((v, i) => targetPath[i] === v))
      throw Error("error.tree.cycle");
  }
  const next = structuredClone(root),
    source = nodeParent(next, sourcePath),
    target = nodeParent(next, targetPath);
  const chosen = source.layers.filter((l) => ids.includes(l.id));
  if (!chosen.length) throw Error("error.tree.choose");
  if (source !== target) unbound(source, ids);
  const delta = pathOffset(root, sourcePath) - pathOffset(root, targetPath);
  if (
    chosen.some(
      (l) =>
        l.start + delta < -1e-6 || l.start + delta + l.duration > 10 + 1e-6,
    )
  )
    throw Error("error.tree.timeBounds");
  for (const layer of chosen) {
    if (source !== target && target.layers.some((l) => l.id === layer.id))
      throw Error("error.tree.duplicateId");
    if (source !== target && layer.type !== "composition") {
      const isolated = projectForSave({
        ...source,
        layers: [layer],
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
      if (layer.assetId)
        layer.assetId = replacements[layer.assetId] ?? layer.assetId;
      if (layer.score) {
        for (const instrument of layer.score.instruments)
          for (const region of instrument.regions) {
            region.assetId = replacements[region.assetId] ?? region.assetId;
            if (region.releaseAssetId)
              region.releaseAssetId =
                replacements[region.releaseAssetId] ?? region.releaseAssetId;
          }
        layer.noiseSeed = (layer.noiseSeed ^ source.seed ^ target.seed) >>> 0;
      }
    }
    layer.start = Math.max(0, layer.start + delta);
  }
  source.layers = source.layers.filter((l) => !ids.includes(l.id));
  const at = beforeId ? target.layers.findIndex((l) => l.id === beforeId) : -1;
  target.layers.splice(at < 0 ? target.layers.length : at, 0, ...chosen);
  const normalized = projectForSave(normalizeGroups(next));
  assertProjectLimits(normalized);
  return normalized;
}
export function editNode(
  root: Project,
  address: NodeAddress,
  patch: Partial<Layer>,
): Project {
  const next = structuredClone(root),
    parent = nodeParent(next, address.path),
    index = parent.layers.findIndex((l) => l.id === address.id);
  if (index < 0) throw Error("error.project");
  parent.layers[index] = { ...parent.layers[index], ...patch };
  return normalizeGroups(next);
}
export function isolatedNode(root: Project, address: NodeAddress): Project {
  const parent = nodeParent(root, address.path),
    node = resolveControls(parent).layers.find((l) => l.id === address.id);
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
    layers: [{ ...node, start: 0, muted: false, solo: false }],
  };
}

// Resource recipes can still describe a finished sound. Insert their output settings on
// an explicit node so the editable document root remains a neutral container.
export function nodeDocument(project: Project): Project {
  if (!project.effects && !project.echo && project.master === 1) return project;
  const effects = { ...DEFAULT_EFFECTS, ...project.effects };
  if (project.echo && !effects.delayWet)
    Object.assign(effects, {
      delayTime: 0.135,
      delayFeedback: project.echo,
      delayWet: project.echo,
    });
  const child = {
    ...project,
    master: 1,
    echo: 0,
    effects: undefined,
    loopRegion: undefined,
  };
  const group = makeComposition(child, {
    name: project.name,
    gain: project.master,
    effects,
  });
  return {
    ...project,
    master: 1,
    echo: 0,
    effects: undefined,
    assets: {},
    controls: undefined,
    controlValues: undefined,
    layers: [group],
  };
}
