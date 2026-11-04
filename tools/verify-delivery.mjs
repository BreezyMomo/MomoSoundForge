import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import JSZip from "jszip";
const [projectPath, wavPath, packPath] = process.argv.slice(2);
if (!projectPath || !wavPath || !packPath)
  throw Error(
    "Usage: node tools/verify-delivery.mjs project.soundforge mix.wav variations.zip",
  );
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { parseProject } = await server.ssrLoadModule("/src/model.ts");
  const { renderProject, encodeWav } =
    await server.ssrLoadModule("/src/engine.ts");
  const project = parseProject(JSON.parse(await readFile(projectPath, "utf8")));
  const expected = Buffer.from(encodeWav(renderProject(project))),
    actual = await readFile(wavPath);
  assert.equal(
    Buffer.compare(expected, actual),
    0,
    "Downloaded mix differs from the saved project render",
  );
  const archive = await JSZip.loadAsync(await readFile(packPath)),
    manifest = JSON.parse(await archive.file("manifest.json").async("string"));
  assert.equal(manifest.variations.length, 5);
  for (const entry of manifest.variations) {
    const p = parseProject(
      JSON.parse(await archive.file(entry.project).async("string")),
    );
    assert.equal(p.seed, entry.seed);
    const wav = await archive.file(entry.file).async("nodebuffer");
    assert.equal(
      Buffer.compare(Buffer.from(encodeWav(renderProject(p))), wav),
      0,
      `Variation ${entry.file} differs from its project`,
    );
  }
  console.log(
    JSON.stringify({
      layers: project.layers.length,
      embeddedSamples: Object.keys(project.assets).length,
      mixBytes: actual.length,
      variations: manifest.variations.length,
      allWavsExactlyMatchSavedProjects: true,
    }),
  );
} finally {
  await server.close();
}
