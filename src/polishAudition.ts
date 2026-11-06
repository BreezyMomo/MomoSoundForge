import { editNode, nodeParent, type NodeAddress } from "./nodeTree";
import { bypassEffects } from "./nodeEffects";
import type { Project, RenderResult } from "./model";
// Only bypass this section; layer design, the legacy echo, master level and safety ceiling stay intact.
export function beforeSoundPolish(
  project: Project,
  address?: NodeAddress,
): Project {
  if (address) {
    const node = nodeParent(project, address.path).inputs.find(
      (l) => l.id === address.id,
    );
    return node
      ? editNode(project, address, { player: { effects: bypassEffects(node.player.effects) } })
      : project;
  }
  return project.effects
    ? {
        ...project,
        effects: {
          ...project.effects,
          toneEnabled: false,
          delayEnabled: false,
          spaceEnabled: false,
        },
      }
    : project;
}

export function padAudition(
  result: RenderResult,
  frames: number,
): RenderResult {
  if (result.left.length >= frames) return result;
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  left.set(result.left);
  right.set(result.right);
  return { ...result, left, right };
}
