import { renderProject } from "./engine";
import type { Project } from "./model";
self.onmessage = (event: MessageEvent<{ id: number; project: Project }>) => {
  const { id, project } = event.data;
  try {
    const result = renderProject(project);
    self.postMessage(
      { id, result },
      {
        transfer: [
          ...new Set([
            result.left.buffer,
            result.right.buffer,
            ...Object.values(result.layers).map((x) => x.buffer),
            ...Object.values(result.processedLayers ?? {}).map((x) => x.buffer),
          ]),
        ],
      },
    );
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error && error.message === "error.renderBudget" ? error.message : "error.render" });
  }
};
