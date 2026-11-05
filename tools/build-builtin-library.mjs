import { createServer } from "vite";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat, copyFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "public/sound-library");
const catalogFile = path.join(root, "src/data/builtin-catalog.json");
const stampFile = path.join(output, ".source-fingerprint");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
const fxRoot = "samples/cc0-starter-20261104";
const orchestraRoot = "samples/orchestra-basics-20261104";
const fx = await readJson(`${fxRoot}/manifest.json`);
const orchestra = await readJson(`${orchestraRoot}/manifest.json`);
const fxExamples = await readJson(`${fxRoot}/examples/recipes.json`);
const jobs = [];
for (const sample of fx.samples) jobs.push({
  id: `fx-${sample.id}`, kind: "sample", nameKey: `builtin.effect.${sample.id.slice(3)}`,
  category: sample.category === "details" ? "foley" : sample.category,
  source: `${fxRoot}/${sample.projectFile}`, sample,
  keywords: `${sample.id} ${sample.sourceArchiveMember} ${sample.author}`,
});
const variants = new Map();
for (const sample of orchestra.samples) {
  const group = [sample.instrumentId, sample.rootMidi, sample.articulation, sample.velocityLow, sample.velocityHigh].join(":");
  const variant = (variants.get(group) ?? 0) + 1; variants.set(group, variant);
  jobs.push({
    id: `instrument-${sample.id}`, kind: "instrument", nameKey: `builtin.instrument.${sample.instrumentId}`,
    category: sample.family, source: `${orchestraRoot}/${sample.wavFile}`, sample,
    rootNote: sample.rootNote, velocity: `${sample.velocityLow}–${sample.velocityHigh}`,
    variant, articulation: sample.articulation,
    keywords: `${sample.instrumentId} ${sample.sourcePath} ${sample.rootMidi ?? ""} ${sample.rootNote ?? ""}`,
  });
}
const effectCategories = ["impacts", "interface", "magic", "motion", "motion", "liquid", "liquid", "foley"];
for (const [index, entry] of fxExamples.entries()) jobs.push({
  id: `example-${entry.id}`, kind: "example", nameKey: `builtin.example.${entry.id.slice(3)}`,
  category: effectCategories[index], source: `${fxRoot}/${entry.projectFile}`, keywords: entry.id,
});
for (const [id, source] of [
  ["forest-departure", `${orchestraRoot}/examples/forest-departure-8s.soundforge`],
  ["piano-window-light", "exports/piano-window-light-20261104/piano-window-light.soundforge"],
]) jobs.push({ id: `example-${id}`, kind: "example", nameKey: `builtin.example.${id}`, category: "music", source, keywords: id });

const sourceFiles = [...new Set([
  "tools/build-builtin-library.mjs", "src/sampleTail.ts", "src/engine.ts", "src/instruments.ts", "src/model.ts", "src/advanced.ts", "src/nodeEffects.ts",
  `${fxRoot}/manifest.json`, `${fxRoot}/examples/recipes.json`, `${orchestraRoot}/manifest.json`,
  `${fxRoot}/licenses/kenney-impact-License.txt`, `${orchestraRoot}/licenses/VSCO-LICENSE`,
  ...jobs.map((job) => job.source),
])];
const fingerprint = hash(JSON.stringify(await Promise.all(sourceFiles.map(async (name) => {
  const info = await stat(path.join(root, name));
  return [name, info.size, info.mtimeMs];
}))));
try {
  if (!process.argv.includes("--force") && (await readFile(stampFile, "utf8")) === fingerprint) {
    const previous = await readJson("src/data/builtin-catalog.json");
    await Promise.all(previous.sounds.map((sound) => stat(path.join(output, sound.file))));
    await Promise.all(["vsco-cc0.txt", "kenney-cc0.txt", "sources.json"].map((file) => stat(path.join(output, "licenses", file))));
    console.log(`Built-in library ready: ${previous.sounds.length} sounds.`);
    process.exit(0);
  }
} catch { /* Generate all resources on a fresh checkout or after a missing file. */ }

await mkdir(output, { recursive: true });
await mkdir(path.dirname(catalogFile), { recursive: true });
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
try {
  const { makeLayer, encodeSamples, parseProject, projectForSave } = await server.ssrLoadModule("/src/model.ts");
  const { renderProject } = await server.ssrLoadModule("/src/engine.ts");
  const { instrumentPlaybackRange } = await server.ssrLoadModule("/src/sampleTail.ts");
  const sounds = [];
  for (const job of jobs) {
    let source;
    if (job.kind === "instrument") {
      const wav = await readFile(path.join(root, job.source));
      if (hash(wav) !== job.sample.wavSha256 || wav.toString("ascii", 36, 40) !== "data" ||
          wav.readUInt32LE(24) !== 48000 || wav.readUInt16LE(22) !== 2 || wav.readUInt16LE(34) !== 16)
        throw Error(`Invalid built-in source WAV: ${job.id}`);
      const length = wav.readUInt32LE(40) / 4;
      if (!Number.isInteger(length) || length < 1 || length > 30 * 48000 || wav.length !== 44 + length * 4)
        throw Error(`Source WAV exceeds the sample budget: ${job.id}`);
      const channels = [new Float32Array(length), new Float32Array(length)];
      for (let i = 0; i < length; i++) for (let c = 0; c < 2; c++) channels[c][i] = wav.readInt16LE(44 + i * 4 + c * 2) / 32768;
      const { duration, release } = instrumentPlaybackRange(channels, 48000, job.sample.instrumentId);
      source = {
        schema: "momo.soundforge/v2", name: job.id, seed: 2048, duration, master: 1.25, echo: 0,
        assets: { [job.sample.id]: { id: job.sample.id, name: path.basename(job.source), sampleRate: 48000, channels: channels.map(encodeSamples) } },
        layers: [makeLayer({ id: `layer-${job.sample.id}`, name: job.sample.id, type: "sample", assetId: job.sample.id,
          duration, frequency: 440, endFrequency: 440, gain: 1.3, attack: .002, release, decay: 0, cutoff: 22000, noiseSeed: 2048 })],
      };
    } else source = JSON.parse(await readFile(path.join(root, job.source), "utf8"));
    const project = parseProject(projectForSave(source));
    const audio = renderProject(project);
    const waveform = Array.from({ length: 160 }, (_, bin) => {
      const start = Math.floor(bin * audio.left.length / 160), end = Math.floor((bin + 1) * audio.left.length / 160);
      let peak = 0;
      for (let i = start; i < end; i++) for (const channel of [audio.left, audio.right]) if (Math.abs(channel[i]) > Math.abs(peak)) peak = channel[i];
      return Number(peak.toFixed(6));
    });
    const json = Buffer.from(JSON.stringify(project));
    const compressed = gzipSync(json, { level: 6 });
    if (json.length > 36 * 1024 * 1024 || compressed.length > 12 * 1024 * 1024)
      throw Error(`Built-in sound exceeds the loader budget: ${job.id}`);
    // A .gz suffix makes some static servers set Content-Encoding automatically,
    // so fetch would receive decoded JSON. Keep the explicit gzip envelope binary.
    const digest = hash(compressed), file = `${digest}.soundforge.bin`;
    await writeFile(path.join(output, file), compressed);
    const { id, kind, nameKey, category, keywords, rootNote, velocity, variant, articulation } = job;
    sounds.push({ id, kind, nameKey, category, keywords, rootNote, velocity, variant, articulation,
      duration: project.duration, file, compressedBytes: compressed.length, projectBytes: json.length, sha256: digest, waveform });
  }
  const catalog = JSON.stringify({ schema: "momo.builtin-library/v1", sounds }, null, 2) + "\n";
  let previous;
  try { previous = await readFile(catalogFile, "utf8"); } catch {}
  if (catalog !== previous) await writeFile(catalogFile, catalog);
  await mkdir(path.join(output, "licenses"), { recursive: true });
  await copyFile(path.join(root, `${orchestraRoot}/licenses/VSCO-LICENSE`), path.join(output, "licenses/vsco-cc0.txt"));
  await copyFile(path.join(root, `${fxRoot}/licenses/kenney-impact-License.txt`), path.join(output, "licenses/kenney-cc0.txt"));
  await writeFile(path.join(output, "licenses/sources.json"), JSON.stringify({
    license: "CC0-1.0", sources: [
      ...fx.sources,
      { author: "Versilian Studios / Sam Gossner; Simon Dalzell; Elan Hickler / Soundemote", sourceUrl: orchestra.source,
        sourceCommit: orchestra.sourceCommit, license: orchestra.license, licenseUrl: orchestra.licenseUrl },
    ],
  }, null, 2) + "\n");
  const resolvedOutput = await realpath(output);
  const expectedOutput = path.join(await realpath(root), "public/sound-library");
  if (path.resolve(resolvedOutput).toLowerCase() !== path.resolve(expectedOutput).toLowerCase())
    throw Error("Refusing to clean generated resources outside this workspace");
  const currentFiles = new Set(sounds.map(sound => sound.file));
  for (const entry of await readdir(resolvedOutput, { withFileTypes: true }))
    if (entry.isFile() && /^[a-f0-9]{64}\.soundforge\.(gz|bin)$/.test(entry.name) && !currentFiles.has(entry.name))
      await unlink(path.join(resolvedOutput, entry.name));
  await writeFile(stampFile, fingerprint);
  console.log(`Built ${sounds.length} built-in sounds (${Math.round(sounds.reduce((sum, sound) => sum + sound.compressedBytes, 0) / 1048576)} MiB, loaded on demand).`);
} finally { await server.close(); }
