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
  const { makeLayer, encodeSamples } =
    await server.ssrLoadModule("/src/model.ts");
  await mkdir("test-results/audio", { recursive: true });
  for (const id of ["ice", "confirm", "laser", "explosion"]) {
    const p = fromPreset(id, id, (key) => key);
    const r = renderProject(p);
    await writeFile(`test-results/audio/${id}.wav`, Buffer.from(encodeWav(r)));
    if (id === "ice")
      await writeFile("test-results/audio/ice.soundforge", JSON.stringify(p));
  }
  const child = fromPreset("confirm", "QA Sample Child", (key) => key);
  const samples = Float32Array.from(
    { length: 4000 },
    (_, i) => Math.sin((i / 8000) * 440 * 2 * Math.PI) * 0.3,
  );
  child.assets = {
    fixture: {
      id: "fixture",
      name: "generated-sine.wav",
      sampleRate: 8000,
      channels: [encodeSamples(samples)],
    },
  };
  child.layers.push(
    makeLayer({
      id: "fixture-layer",
      name: "Generated sample",
      type: "sample",
      assetId: "fixture",
      duration: 0.5,
      frequency: 440,
      endFrequency: 440,
      decay: 0,
    }),
  );
  await writeFile(
    "test-results/audio/legacy-sample.soundforge",
    JSON.stringify({ ...child, schema: "momo.soundforge/v1" }),
  );
  console.log("Examples rendered to test-results/audio/");
} finally {
  await server.close();
}
