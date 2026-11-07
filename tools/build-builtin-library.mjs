import { assetResolver, fileDigest, walkFiles } from './sound-asset-store.mjs';
import { pianoJob, pianoProject } from './builtin-vcsl-piano.mjs';
import { createServer } from "vite";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat, copyFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { instrumentJobs, instrumentProject, recordingId } from "./builtin-instruments.mjs";
import { legacyInstrumentLevels, standaloneBoostDb } from "./builtin-levels.mjs";
import { buildRecordings } from "./builtin-recordings.mjs";
import { shareBuiltinRecordings } from './share-builtin-recordings.mjs';
import { levels } from "./audit-builtin-library.mjs";
import { gameSfxJobs, gameSfxProject } from "./builtin-game-sfx.mjs";
import { natureSfxJobs, natureSfxProject } from "./builtin-nature-sfx.mjs";

const root = process.cwd();
const resolveAsset = await assetResolver(root);
const output = path.join(root, "public/sound-library");
const catalogFile = path.join(root, "src/data/builtin-catalog.json");
const stampFile = path.join(output, ".source-fingerprint");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
const fxRoot = "samples/cc0-starter-20261104";
const orchestraRoot = "samples/orchestra-basics-20261104";
const expandedRoot = "samples/orchestra-expanded-20261105";
const gameRoot = "samples/game-sfx-starter-20261105";
const natureRoot = "samples/nature-ambience-20261105";
const fx = await readJson(`${fxRoot}/manifest.json`);
const orchestra = await readJson(`${orchestraRoot}/manifest.json`);
const expanded = await readJson(`${expandedRoot}/manifest.json`);
const game = await readJson(`${gameRoot}/manifest.json`);
const nature = await readJson(`${natureRoot}/manifest.json`);
const pianoRoot = "samples/vcsl-kawai-20261107";
const piano = await readJson(`${pianoRoot}/manifest.json`);
const quality = await readJson("tools/builtin-quality.json");
const excludedStandalone = new Set(quality.excludedStandaloneSamples.map(entry => entry.id));
const fxExamples = await readJson(`${fxRoot}/examples/recipes.json`);
const jobs = [];
jobs.push(...gameSfxJobs(game, gameRoot));
jobs.push(...natureSfxJobs(nature, natureRoot));
// Group alternate recordings of the same action explicitly. Material, strength
// and different actions stay separate; publisher file numbers are not categories.
const fxRecordingGroups = [
  ["cloth", ["11-cloth-01", "12-cloth-04", "13-cloth-05", "14-cloth-07"]],
  ["paper", ["17-paper-01", "18-paper-02"]],
  ["swish", ["19-swish-01", "20-swish-11"]],
  ["bubble", ["21-bubble-01", "22-bubble-02", "23-bubble-03"]],
  ["slime", ["24-slime-01", "25-slime-05", "26-slime-10", "27-slime-12"]],
  ["splash", ["28-splash-01", "29-splash-02", "30-splash-03"]],
  ["bell", ["31-bell-00", "32-bell-01"]],
  ["camera", ["33-camera-01", "34-camera-02"]],
  ["lock-door", ["35-lock-door-02", "36-lock-door-04"]],
];
const fxChoices = new Map(fxRecordingGroups.flatMap(([group, ids]) => ids.map((id, index) =>
  [id, { nameKey: `builtin.effect.${group}`, recordingGroup: `fx-${group}`, recording: index + 1 }])));
for (const sample of fx.samples) jobs.push({
  id: `fx-${sample.id}`, kind: "sample", nameKey: `builtin.effect.${sample.id.slice(3)}`,
  ...fxChoices.get(sample.id),
  category: sample.category === "details" ? "foley" : sample.category,
  source: `${fxRoot}/${sample.projectFile}`, sample,
  keywords: `${sample.id} ${sample.sourceArchiveMember} ${sample.author}`,
});
const variants = new Map();
const expandedInstruments = new Set(expanded.samples.map(s => s.instrumentId));
for (const sample of orchestra.samples) {
  if (excludedStandalone.has(sample.id)) continue;
  if (expandedInstruments.has(sample.instrumentId)) continue;
  const group = [sample.instrumentId, sample.rootMidi, sample.articulation, sample.velocityLow, sample.velocityHigh].join(":");
  const variant = (variants.get(group) ?? 0) + 1; variants.set(group, variant);
  jobs.push({
    id: `instrument-${sample.id}`, kind: "instrument", nameKey: `builtin.instrument.${sample.instrumentId}`,
    category: sample.family, source: `${orchestraRoot}/${sample.wavFile}`, sample,
    rootNote: sample.rootNote, velocity: `${sample.velocityLow}–${sample.velocityHigh}`,
    variant, articulation: sample.articulation, recordingIds: [recordingId(sample)],
    keywords: `${sample.instrumentId} ${sample.sourcePath} ${sample.rootMidi ?? ""} ${sample.rootNote ?? ""}`,
  });
}
jobs.push(...instrumentJobs({...expanded, samples: expanded.samples.filter(s => s.instrumentId !== "upright-piano")}, expandedRoot));
jobs.push(pianoJob(piano, pianoRoot));
const legacyLevels = legacyInstrumentLevels(jobs.filter(job => job.kind === "instrument" && !job.tone && !job.completeInstrument).map(job => job.sample));
const effectCategories = ["impacts", "interface", "magic", "motion", "motion", "liquid", "liquid", "foley"];
for (const [index, entry] of fxExamples.entries()) jobs.push({
  id: `example-${entry.id}`, kind: "example", nameKey: `builtin.example.${entry.id.slice(3)}`,
  category: effectCategories[index], source: `${fxRoot}/${entry.projectFile}`, keywords: entry.id,
});
for (const [id, source] of [
  ["forest-departure", `${orchestraRoot}/examples/forest-departure-8s.soundforge`],
  ["piano-window-light", "exports/piano-window-light-20261104/piano-window-light.soundforge"],
]) jobs.push({ id: `example-${id}`, kind: "example", nameKey: `builtin.example.${id}`, category: "music", source, keywords: id });
for (const id of ["piano", "flute", "violin", "cello", "horn", "trumpet"]) jobs.push({
  id: `example-expanded-${id}`, kind: "example", nameKey: `builtin.example.expanded-${id}`,
  category: "music", source: `${expandedRoot}/demos/expanded-${id}.soundforge`,
  keywords: `expanded ${id} multisample dynamics articulation 连续音域 力度 演奏法`,
});

const sourceFiles = [...new Set([
  "tools/build-builtin-library.mjs", "tools/builtin-game-sfx.mjs", "tools/builtin-nature-sfx.mjs", "tools/builtin-instruments.mjs", "tools/builtin-levels.mjs", "tools/audit-builtin-library.mjs", "tools/builtin-quality.json", "src/sampleTail.ts", "src/engine.ts", "src/instruments.ts", "src/model.ts", "src/advanced.ts", "src/nodeEffects.ts", "src/playerPlayback.ts", "src/effectTypes.ts", "src/synthesizers.ts", "src/synthExpression.ts",
  "src/recordingSources.ts", "tools/builtin-velocity-regions.mjs", "tools/builtin-recordings.mjs", "tools/builtin-vcsl-piano.mjs", "src/sampleReference.ts", "src/prepareSamples.ts", `${fxRoot}/manifest.json`, `${fxRoot}/examples/recipes.json`, `${orchestraRoot}/manifest.json`,
  `${fxRoot}/licenses/kenney-impact-License.txt`, `${orchestraRoot}/licenses/VSCO-LICENSE`,
  `${expandedRoot}/manifest.json`,
  `${gameRoot}/manifest.json`, ...game.sources.map(s => `${gameRoot}/${s.includedLicenseFile}`),
  `${natureRoot}/manifest.json`, `${natureRoot}/licenses/nature-cc0.txt`,
  ...jobs.flatMap((job) => job.sourceFiles ?? [job.source]),
])];
// Hash all engine/build dependencies, not an easy-to-forget handpicked subset.
const dependencies = ["package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "sound-assets.lock.json"];
for (const base of ["src", "tools", "vendor"]) for (const name of await walkFiles(path.join(root, base))) {
  const logical = base + "/" + name;
  if (logical !== "src/data/builtin-catalog.json" && !logical.includes("/__pycache__/")) dependencies.push(logical);
}
const inputs = [];
for (const name of [...new Set([...sourceFiles, ...dependencies])].sort()) inputs.push([name, (await fileDigest(resolveAsset(name))).sha256]);
const fingerprint = hash(JSON.stringify(inputs));
try {
  const stamp = JSON.parse(await readFile(stampFile, "utf8"));
  if (!process.argv.includes("--force") && stamp.fingerprint === fingerprint) {
    const previous = await readJson("src/data/builtin-catalog.json");
    if (stamp.catalog !== hash(await readFile(catalogFile))) throw Error("Catalog changed");
    for (const sound of [...previous.sounds, ...previous.recordings, ...(previous.audio ?? [])]) {
      if ((await fileDigest(path.join(output, sound.file))).sha256 !== sound.sha256) throw Error("Generated resource changed");
    }
    for (const [name, expected] of Object.entries(stamp.licenses))
      if ((await fileDigest(path.join(output, "licenses", name))).sha256 !== expected) throw Error("License changed");
    console.log(`Built-in library ready: ${previous.sounds.length} sounds (content verified).`);
    process.exit(0);
  }
} catch { /* Generate after changed inputs, missing or corrupt outputs. No network. */ }

await mkdir(output, { recursive: true });
await mkdir(path.dirname(catalogFile), { recursive: true });
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
try {
  const { makeLayer: makeInput, stableHash, encodeSamples, decodeSamples, parseProject, projectForSave, projectDocument } = await server.ssrLoadModule("/src/model.ts");
  const { renderProject } = await server.ssrLoadModule("/src/engine.ts");
  const { instrumentPlaybackRange } = await server.ssrLoadModule("/src/sampleTail.ts");
  const { recordingSummaries } = await server.ssrLoadModule("/src/recordingSources.ts");
  // Preserve the curated seeds while playback instances become independent of placement IDs.
  const makeLayer = patch => {
    const input = makeInput(patch);
    if (input.player.type === 'synth') input.player.noiseSeed = (input.player.noiseSeed ^ stableHash(input.id)) >>> 0;
    if (input.player.type === 'instrument') input.player.noiseSeed = (input.player.noiseSeed ^ 2048) >>> 0;
    return input;
  };
  const { createSamplePreparer } = await server.ssrLoadModule('/src/prepareSamples.ts');
  const prepare = createSamplePreparer(async url => new Response(await readFile(path.join(output, path.basename(url)))), '/');
  const renderAudio = async p => renderProject(await prepare(p));
  const {sealResource}=await server.ssrLoadModule('/src/resourceGraph.ts');
  const {resourceFromProject}=await server.ssrLoadModule('/src/soundResources.ts');
  const {createAudioReader,audioReference,builtinPCM}=await server.ssrLoadModule('/src/sharedAudio.ts');
  const readAudio=createAudioReader(async url=>new Response(await readFile(path.join(output,path.basename(url)))),'/');
  const sounds = [], recordings = new Map(), audioObjects=new Map();

  let fullPiano;
  for (const job of jobs) {
    let source;
    const assetGains = [];
    if (job.completeInstrument) {
      source = await pianoProject(job, root, { makeLayer });
      fullPiano = source;
    } else if (job.natureSfx) {
      source = await natureSfxProject(job, root, natureRoot, { makeLayer, encodeSamples });
    } else if (job.gameSfx) {
      source = await gameSfxProject(job, root, gameRoot, { makeLayer, encodeSamples });
    } else if (job.tone) {
      source = await instrumentProject(job, root, { makeLayer, encodeSamples });
      let raw = await renderAudio(parseProject(source));
      // A naturally weak low-register note need not be the first sound a novice
      // hears. Pick a nearby audible root without changing sample/velocity gains.
      if (levels([raw.left, raw.right], raw.sampleRate).status !== "ok") {
        const originalMidi = source.inputs[0].player.score.notes[0].midi;
        const roots = [...new Set(job.samples.map(s => s.rootMidi))]
          .filter(midi => midi !== originalMidi).sort((a, b) => Math.abs(a - originalMidi) - Math.abs(b - originalMidi));
        for (const midi of roots) {
          const candidate = await instrumentProject(job, root, { makeLayer, encodeSamples }, midi);
          const audio = await renderAudio(parseProject(candidate));
          if (levels([audio.left, audio.right], audio.sampleRate).status === "ok") {
            source = candidate; raw = audio; break;
          }
        }
      }
      // One gain for the entire range keeps the relative velocity dynamics intact.
      if (raw.sourcePeak > .8) source.master = .8 / raw.sourcePeak;
    } else if (job.kind === "instrument") {
      const wav = await readFile(resolveAsset(job.source));
      if (hash(wav) !== job.sample.wavSha256 || wav.toString("ascii", 36, 40) !== "data" ||
          wav.readUInt32LE(24) !== 48000 || wav.readUInt16LE(22) !== 2 || wav.readUInt16LE(34) !== 16)
        throw Error(`Invalid built-in source WAV: ${job.id}`);
      const length = wav.readUInt32LE(40) / 4;
      if (!Number.isInteger(length) || length < 1 || length > 30 * 48000 || wav.length !== 44 + length * 4)
        throw Error(`Source WAV exceeds the sample budget: ${job.id}`);
      const channels = [new Float32Array(length), new Float32Array(length)];
      const level = legacyLevels.get(job.sample.id);
      const assetGain = 10 ** (level.assetGainDb / 20);
      assetGains.push(assetGain);
      for (let i = 0; i < length; i++) for (let c = 0; c < 2; c++) channels[c][i] = wav.readInt16LE(44 + i * 4 + c * 2) / 32768 * assetGain;
      const { duration, release } = instrumentPlaybackRange(channels, 48000, job.sample.instrumentId);
      source = {
        schema: "momo.soundforge/v4", name: job.id, seed: 2048, duration, master: 1, echo: 0,
        assets: { [job.sample.id]: { id: job.sample.id, name: path.basename(job.source), sampleRate: 48000, channels: channels.map(encodeSamples) } },
        inputs: [makeLayer({ id: `layer-${job.sample.id}`, name: job.sample.id, type: "instrument",
          score: { schema: "momo.score/v1", bpm: 120,
            instruments: [{ id: job.sample.instrumentId, name: job.sample.instrumentId, license: "CC0-1.0",
              regions: [{ id: job.sample.id, assetId: job.sample.id, rootMidi: job.sample.rootMidi ?? 60,
                keyLow: 0, keyHigh: 127, velocityLow: 1, velocityHigh: 127,
                articulation: job.sample.articulation, roundRobin: 0, tuneCents: 0, gainDb: level.regionGainDb, releaseSeconds: release }] }],
            notes: [{ id: `note-${job.sample.id}`, instrumentId: job.sample.instrumentId,
              midi: job.sample.rootMidi ?? 60, start: 0, duration: Math.max(.05, duration - release) * 2,
              velocity: 100, articulation: job.sample.articulation }] },
          duration, frequency: 440, endFrequency: 440, gain: 1.3, attack: .002, release, decay: 0, cutoff: 22000, noiseSeed: 2048 })],
      };
    } else source = parseProject(JSON.parse(await readFile(resolveAsset(job.source), "utf8")));
    if (job.id === 'example-expanded-piano') {
      source.assets = structuredClone(fullPiano.assets);
      for (const input of source.inputs) if (input.player.score) {
        const instrument = structuredClone(fullPiano.inputs[0].player.score.instruments[0]);
        input.player.score.instruments = [instrument];
        input.player.score.notes = input.player.score.notes.map(n => ({ ...n, instrumentId: instrument.id, articulation: 'single-hit' }));
      }
    }
    let project = parseProject(projectForSave(source));
    let audio = await renderAudio(project);
    if (job.gameSfx || job.natureSfx) {
      const measured = levels([audio.left, audio.right], audio.sampleRate);
      if (measured.status === "silent" || audio.sourcePeak >= 1) throw Error(`Review SFX default: ${job.id}`);
      const gainDb = Math.min((job.natureSfx ? -23 : -20) - measured.activeRmsDb, -6 - 20 * Math.log10(audio.sourcePeak));
      project.master = Math.min(1.5, project.master * 10 ** (gainDb / 20));
      project = parseProject(projectForSave(project));
      audio = await renderAudio(project);
    }
    if (job.kind === "instrument" && !job.tone && !job.completeInstrument) {
      const boostDb = standaloneBoostDb(levels([audio.left, audio.right], audio.sampleRate));
      if (boostDb > 0) {
        const region = project.inputs[0].player.score.instruments[0].regions[0];
        const extraDb = Math.max(0, region.gainDb + boostDb - 24);
        region.gainDb = Math.min(24, region.gainDb + boostDb);
        if (extraDb > 0) {
          const asset = project.assets[region.assetId], gain = 10 ** (extraDb / 20);
          assetGains.push(gain);
          asset.channels = asset.channels.map(channel => encodeSamples(Float32Array.from(decodeSamples(channel), x => x * gain)));
        }
        project = parseProject(projectForSave(project));
        audio = await renderAudio(project);
      }
    }
    if (levels([audio.left, audio.right], audio.sampleRate).status !== "ok")
      throw Error(`Built-in default is silent or too quiet; review its source/mapping: ${job.id}`);
    if (job.kind === "instrument" && !job.tone && !job.completeInstrument && standaloneBoostDb(levels([audio.left, audio.right], audio.sampleRate)) > .1)
      throw Error(`Standalone default lacks usable loudness: ${job.id}`);
    const waveform = Array.from({ length: 160 }, (_, bin) => {
      const start = Math.floor(bin * audio.left.length / 160), end = Math.floor((bin + 1) * audio.left.length / 160);
      let peak = 0;
      for (let i = start; i < end; i++) for (const channel of [audio.left, audio.right]) if (Math.abs(channel[i]) > Math.abs(peak)) peak = channel[i];
      return Number(peak.toFixed(6));
    });
    const summaries = job.kind === 'instrument' ? recordingSummaries({schema:'momo.instrument/v1',instrument:project.inputs[0].player.score.instruments[0],assets:project.assets}) : undefined;
    const completeRecordings = summaries ? await buildRecordings(job, project, summaries, assetGains, root, output) : [];
    for (const recording of completeRecordings) {
      const pcm=builtinPCM(gunzipSync(await readFile(path.join(output,recording.file))),recording),ref=await audioReference(pcm);
      recording.audioId=ref.audioId;
      audioObjects.set(ref.audioId,{...recording,id:ref.audioId,format:'wav16'});
      if (!recordings.has(recording.id)) recordings.set(recording.id, recording);
    }
    const stored = job.tone ? parseProject(await shareBuiltinRecordings(project, completeRecordings, output)) : project;
    const graph=await sealResource(resourceFromProject(stored,[],job.id),async(ref,pcm)=>{
      if(audioObjects.has(ref.audioId))return;
      const bytes=gzipSync(pcm,{level:6}),sha256=hash(bytes),file=sha256+'.recording.bin';
      await writeFile(path.join(output,file),bytes);
      audioObjects.set(ref.audioId,{id:ref.audioId,format:'pcm',file,sha256,compressedBytes:bytes.length,decodedBytes:pcm.length,...ref});
    },readAudio);
    const json = Buffer.from(JSON.stringify(graph));
    // Lossless transport compression keeps the complete audio library within the static-site budget.
    const compressed = gzipSync(json, { level: 9 });
    if (json.length > 36 * 1024 * 1024 || compressed.length > 12 * 1024 * 1024)
      throw Error(`Built-in sound exceeds the loader budget: ${job.id}`);
    // A .gz suffix makes some static servers set Content-Encoding automatically,
    // so fetch would receive decoded JSON. Keep the explicit gzip envelope binary.
    const digest = hash(compressed), file = `${digest}.soundforge.bin`;
    await writeFile(path.join(output, file), compressed);
    const { id, kind, nameKey, category, keywords, rootNote, velocity, variant, articulation, tone, keyLow, keyHigh, maxSourceSeconds, recordingIds, recordingGroup, recording, playback, completeInstrument } = job;
    const revision = job.id === 'example-expanded-piano' || (kind === 'instrument' && !completeInstrument && project.inputs[0].player.score.instruments[0].regions.some(r => /-velocity-\d+-\d+$/.test(r.id))) ? 2 : 1;
    sounds.push({ id, kind, nameKey, category, keywords, rootNote, velocity, variant, articulation, tone, keyLow, keyHigh, maxSourceSeconds, recordingIds, recordingGroup, recording, playback, ...(completeInstrument ? { completeInstrument } : {}),
      ...(revision > 1 ? { revision } : {}), ...(summaries ? { recordings: summaries } : {}),
      duration: project.duration, file, compressedBytes: compressed.length, projectBytes: json.length, sha256: digest, waveform });
  }
  const catalog = JSON.stringify({ schema: "momo.builtin-library/v1", sounds, recordings: [...recordings.values()], audio: [...audioObjects.values()] }, null, 2) + "\n";
  let previous;
  try { previous = await readFile(catalogFile, "utf8"); } catch {}
  if (catalog !== previous) await writeFile(catalogFile, catalog);
  await mkdir(path.join(output, "licenses"), { recursive: true });
  await copyFile(path.join(root, pianoRoot, "licenses/VCSL-README.md"), path.join(output, "licenses/vcsl-cc0.md"));
  await copyFile(path.join(root, `${orchestraRoot}/licenses/VSCO-LICENSE`), path.join(output, "licenses/vsco-cc0.txt"));
  await copyFile(path.join(root, `${fxRoot}/licenses/kenney-impact-License.txt`), path.join(output, "licenses/kenney-cc0.txt"));
  await copyFile(path.join(root, `${natureRoot}/licenses/nature-cc0.txt`), path.join(output, "licenses/nature-cc0.txt"));
  for (const source of game.sources) await copyFile(path.join(root, gameRoot, source.includedLicenseFile), path.join(output, `licenses/game-${source.id.replace("kenney-", "")}.txt`));
  await writeFile(path.join(output, "licenses/sources.json"), JSON.stringify({
    license: "CC0-1.0", sources: [
      { author: "Versilian Studios / VCSL contributors", sourceUrl: piano.source, sourceCommit: piano.sourceCommit, license: piano.license, includedLicenseFile: "licenses/vcsl-cc0.md" },
      ...fx.sources,
      ...nature.sources.map(source => ({ ...source, includedLicenseFile: "licenses/nature-cc0.txt" })),
      ...game.sources.map(source => ({ ...source, includedLicenseFile: `licenses/game-${source.id.replace("kenney-", "")}.txt` })),
      { author: "Versilian Studios / Sam Gossner; Simon Dalzell; Elan Hickler / Soundemote", sourceUrl: orchestra.source,
        sourceCommit: orchestra.sourceCommit, license: orchestra.license, licenseUrl: orchestra.licenseUrl },
    ],
  }, null, 2) + "\n");
  const resolvedOutput = await realpath(output);
  const expectedOutput = path.join(await realpath(root), "public/sound-library");
  if (path.resolve(resolvedOutput).toLowerCase() !== path.resolve(expectedOutput).toLowerCase())
    throw Error("Refusing to clean generated resources outside this workspace");
  const currentFiles = new Set([...sounds, ...recordings.values(), ...audioObjects.values()].map(sound => sound.file));
  for (const entry of await readdir(resolvedOutput, { withFileTypes: true }))
    if (entry.isFile() && /^[a-f0-9]{64}\.(soundforge|recording)\.(gz|bin)$/.test(entry.name) && !currentFiles.has(entry.name))
      await unlink(path.join(resolvedOutput, entry.name));
  const licenses = {};
  for (const name of await walkFiles(path.join(output, "licenses"))) licenses[name] = (await fileDigest(path.join(output, "licenses", name))).sha256;
  await writeFile(stampFile, JSON.stringify({ fingerprint, catalog: hash(await readFile(catalogFile)), licenses }));
  console.log(`Built ${sounds.length} built-in sounds (${Math.round(sounds.reduce((sum, sound) => sum + sound.compressedBytes, 0) / 1048576)} MiB, loaded on demand).`);
} finally { await server.close(); }
