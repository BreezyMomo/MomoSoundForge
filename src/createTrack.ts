import { emptyScore } from './instruments';
import { makeComposition, makeLayer, makeProject, assertProjectLimits, updateProjectAtPath, type Project } from './model';
import { normalizeGroups } from './nodeTree';

export function createTrack(root: Project, path: string[], kind: 'notes' | 'group', name: string) {
  const layer = kind === 'group'
    ? makeComposition({ ...makeProject(name), duration: 2, master: 1 })
    : makeLayer({ name, type: 'instrument', score: emptyScore(), duration: 2, gain: 1, attack: 0, release: 0, decay: 0, cutoff: 22000 });
  const next = normalizeGroups(updateProjectAtPath(root, path, p => ({ ...p, inputs: [...p.inputs, layer], duration: Math.max(p.duration, layer.duration) })));
  assertProjectLimits(next);
  return { root: next, id: layer.id };
}
