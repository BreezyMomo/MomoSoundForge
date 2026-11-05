import type { Project } from "./model";
// Only bypass this section; layer design, the legacy echo, master level and safety ceiling stay intact.
export function beforeSoundPolish(project: Project): Project {
  return project.effects ? { ...project, effects: { ...project.effects, toneEnabled: false, delayEnabled: false, spaceEnabled: false } } : project;
}
