import { describe, it, expect } from "vitest";
import { createSoundLayout, SOUND_PANELS } from "../src/workbenchLayout";
describe("task layouts", () => {
  for (const compact of [false, true])
    for (const task of ["default", "video", "notes"])
      it(`${compact ? "compact" : "desktop"} ${task} keeps registered panels unique`, () => {
        const model = createSoundLayout(compact),
          layout = model.layoutPreset(task),
          found: string[] = [];
        model.visitLayout(layout, (node) => {
          if (node.kind === "stack") found.push(...node.panels);
        });
        expect(new Set(found).size).toBe(found.length);
        expect(
          found.every((id) => SOUND_PANELS.some((panel) => panel.id === id)),
        ).toBe(true);
        expect(found).toContain("editor");
        expect(found).toContain("library");
        expect(found).toContain("inspector");
        if (task === "video") {
          expect(found).toContain("video");
          expect(found).not.toContain("variants");
        }
        if (task === "notes") {
          expect(found).toContain("notes");
          expect(found).not.toContain("variants");
          expect(model.panelStack(layout, "notes")?.active).toBe("notes");
        }
      });
  it("preserves saved geometry and named layouts when the note panel is registered", () => {
    const model = createSoundLayout(),
      old = {
        root: {
          kind: "stack",
          id: "old-layout",
          panels: ["editor", "library", "video"],
          active: "video",
        },
        floats: [],
      };
    const saved = model.sanitizeLayoutSettings({
      current: old,
      named: [{ name: "My workspace", layout: old }],
    });
    expect(saved.current).toEqual(old);
    expect(saved.named[0].layout).toEqual(old);
    const next = model.workspaceActions(saved, [
      { action: "preset", preset: "notes" },
    ]);
    expect(saved.current).toEqual(old);
    expect(next.named).toEqual(saved.named);
  });
});
