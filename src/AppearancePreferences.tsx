import { createAppearance } from "@momo/workbench/appearance";
import { WorkbenchAppearance } from "@momo/workbench/react";
let storage: Storage | undefined;
try {
  storage = localStorage;
} catch {
  /* Session preview remains available. */
}
export const appearance = createAppearance({
  storage,
  root: document.documentElement,
  storageKey: "momo-sound-forge:appearance:v1",
});
export function AppearancePreferences() {
  return <WorkbenchAppearance />;
}
