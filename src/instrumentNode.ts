import { uid, type Project } from "./model";

// A library instrument is a leaf node, with portable, independently owned assets.
export function appendInstrumentNode(
  parent: Project,
  child: Project,
  id: string = uid(),
): Project {
  const layer = structuredClone(child.layers[0]);
  if (
    child.layers.length !== 1 ||
    layer.content.type !== "instrument" ||
    !layer.content.score
  )
    throw Error("error.project");
  layer.id = id;
  layer.name = child.name;
  // Keep the preset's master level inside its content. Multiplying outer gain
  // can exceed the layer's 1.5 limit even when both source values are valid.
  layer.content.level *= child.master;
  const assets: Project["assets"] = {};
  const replacements: Record<string, string> = {};
  for (const [key, asset] of Object.entries(child.assets)) {
    const next = uid();
    replacements[key] = next;
    assets[next] = { ...asset, id: next };
  }
  for (const instrument of layer.content.score.instruments)
    for (const region of instrument.regions) {
      region.assetId = replacements[region.assetId];
      if (region.releaseAssetId)
        region.releaseAssetId = replacements[region.releaseAssetId];
    }
  return {
    ...parent,
    assets: { ...parent.assets, ...assets },
    duration: Math.max(parent.duration, layer.start + layer.duration),
    layers: [...parent.layers, layer],
  };
}
