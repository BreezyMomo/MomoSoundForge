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
          result.left.buffer,
          result.right.buffer,
          ...Object.values(result.layers).map((x) => x.buffer),
        ],
      },
    );
  } catch {
    self.postMessage({ id, error: true });
  }
};
