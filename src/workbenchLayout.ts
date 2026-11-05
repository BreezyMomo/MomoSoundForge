import { createLayoutModel, type LayoutNode } from "@momo/workbench/layout";
export const SOUND_PANELS = [
  { id: "video", title: "video.title", showEdge: "top", dockRatio: { y: 0.4 } },
  {
    id: "notes",
    title: "notes.panel",
    showEdge: "left",
    dockRatio: { x: 0.65 },
  },
  { id: "library", title: "panel.library", showEdge: "left" },
  { id: "editor", title: "panel.editor" },
  { id: "inspector", title: "panel.inspector", showEdge: "right" },
  { id: "variants", title: "panel.variants", showEdge: "bottom" },
] as const;
export const SOUND_TASK_LAYOUTS = [
  { id: "default", title: "layout.soundDesign" },
  { id: "video", title: "layout.videoDesign" },
  { id: "notes", title: "layout.noteDesign" },
] as const;
const stack = (id: string, panels: string[]): LayoutNode => ({
  kind: "stack",
  id,
  panels,
  active: panels[0],
});
const split = (
  id: string,
  axis: "x" | "y",
  ratio: number,
  first: LayoutNode,
  second: LayoutNode,
): LayoutNode => ({ kind: "split", id, axis, ratio, first, second });
export function createSoundLayout(compact = false) {
  const columns = (main: LayoutNode) =>
    split(
      "columns",
      "x",
      0.18,
      stack("library", ["library"]),
      split("work", "x", 0.74, main, stack("properties", ["inspector"])),
    );
  return createLayoutModel({
    panels: SOUND_PANELS.map((panel) => ({ ...panel })),
    anchorPanel: "editor",
    storageKey: "momo-sound-forge:layout:v1",
    defaultPreset: "default",
    presets: {
      default: () => ({
        root: compact
          ? stack("compact", ["editor", "library", "inspector", "variants"])
          : columns(
              split(
                "sound-main",
                "y",
                0.8,
                stack("editor", ["editor"]),
                stack("variants", ["variants"]),
              ),
            ),
        floats: [],
      }),
      video: () => ({
        root: compact
          ? stack("compact-video", ["video", "editor", "library", "inspector"])
          : columns(
              split(
                "video-main",
                "y",
                0.43,
                stack("video", ["video"]),
                stack("editor", ["editor"]),
              ),
            ),
        floats: [],
      }),
      notes: () => ({
        root: compact
          ? stack("compact-notes", ["notes", "editor", "inspector", "library"])
          : columns(stack("note-main", ["notes", "editor"])),
        floats: [],
      }),
    },
  });
}
