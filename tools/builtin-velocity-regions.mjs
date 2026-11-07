// The author sometimes uses different velocity boundaries for alternate takes.
// Compile their intersections into equal native ranges so every eligible take can
// cycle. This changes imported definitions only; saved user projects keep their rules.
export const sourceRegionId = id => id.replace(/-velocity-\d+-\d+$/, '');

export function compileVelocityRegions(regions) {
  const groups = Map.groupBy(regions, r => JSON.stringify([r.rootMidi, r.keyLow, r.keyHigh, r.articulation]));
  const cuts = new Map();
  for (const group of groups.values()) {
    const boundaries = [...new Set(group.flatMap(r => [r.velocityLow, r.velocityHigh + 1]))].sort((a, b) => a - b);
    for (const region of group) cuts.set(region, boundaries.filter(v => v >= region.velocityLow && v <= region.velocityHigh + 1));
  }
  return regions.flatMap(region => {
    const boundaries = cuts.get(region);
    return boundaries.slice(0, -1).map((low, index) => ({ ...region,
      id: index === 0 ? region.id : `${region.id}-velocity-${low}-${boundaries[index + 1] - 1}`,
      velocityLow: low, velocityHigh: boundaries[index + 1] - 1 }));
  });
}
