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
  const { unpackProject } = await server.ssrLoadModule("/src/resourcePackage.ts");
  const {prepareProjectSamples:prepare}=await server.ssrLoadModule("/src/prepareSamples.ts");
  const { renderProject, encodeWav } =
    await server.ssrLoadModule("/src/engine.ts");
  const project = await prepare(await unpackProject(await readFile(projectPath)));
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
    const p = await prepare(await unpackProject(await archive.file(entry.project).async("uint8array")));
    assert.equal(p.seed, entry.seed);
    const wav = await archive.file(entry.file).async("nodebuffer");
    assert.equal(
      Buffer.compare(Buffer.from(encodeWav(renderProject(p))), wav),
      0,
      `Variation ${entry.file} differs from its project`,
    );
  }
  let totalLayers = 0,
    embeddedSamples = 0;
  const count = (p) => {
    totalLayers += p.inputs.length;
    embeddedSamples += Object.keys(p.assets).length;
    for (const layer of p.inputs)
      if (layer.player.type === "composition" && layer.player.mix) count(layer.player.mix);
  };
  count(project);
  console.log(
    JSON.stringify({
      inputs: project.inputs.length,
      totalLayers,
      embeddedSamples,
      mixBytes: actual.length,
      variations: manifest.variations.length,
      allWavsExactlyMatchSavedProjects: true,
    }),
  );
} finally {
  await server.close();
}
