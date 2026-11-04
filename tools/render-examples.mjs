import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { fromPreset } = await server.ssrLoadModule("/src/presets.ts");
  const { renderProject, encodeWav } =
    await server.ssrLoadModule("/src/engine.ts");
  await mkdir("test-results/audio", { recursive: true });
  for (const id of ["ice", "confirm", "laser", "explosion"]) {
    const p = fromPreset(id, id, (key) => key);
    const r = renderProject(p);
    await writeFile(`test-results/audio/${id}.wav`, Buffer.from(encodeWav(r)));
    if (id === "ice")
      await writeFile("test-results/audio/ice.soundforge", JSON.stringify(p));
  }
  console.log("Examples rendered to test-results/audio/");
} finally {
  await server.close();
}
