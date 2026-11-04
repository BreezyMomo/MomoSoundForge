// Convert a locally collected instrument manifest. Reads sources; never edits them.
import { readFile, writeFile, mkdir, realpath, stat } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import assert from "node:assert/strict";
const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(
    [
      "--collection",
      "--instrument",
      "--out",
      "--articulation",
      "--roots",
    ].includes(args[i]) && args[i + 1],
    "Expected --collection, --instrument, --out; optional --articulation and --roots",
  );
  options[args[i]] = args[i + 1];
}
assert(
  options["--collection"] && options["--instrument"] && options["--out"],
  "Required: --collection <manifest.json> --instrument <id> --out <folder>",
);
const manifestPath = resolve(options["--collection"]),
  base = await realpath(dirname(manifestPath)),
  out = resolve(options["--out"]);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.schema, "momo.instrument-collection/v1");
const roots = options["--roots"]?.split(",").map(Number);
const selected = manifest.samples.filter(
  (s) =>
    s.instrumentId === options["--instrument"] &&
    (!options["--articulation"] ||
      s.articulation === options["--articulation"]) &&
    (!roots || roots.includes(s.rootMidi)),
);
assert(
  selected.length > 0 && selected.length <= 64,
  "No matching samples or over 64 samples",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
try {
  const { encodeSamples, makeLayer, parseProject, projectForSave } =
    await server.ssrLoadModule("/src/model.ts");
  const { renderProject, encodeWav } =
    await server.ssrLoadModule("/src/engine.ts");
  const assets = {},
    regions = [],
    conversion = [];
  let decodedBytes = 0;
  for (const sample of selected) {
    assert(
      typeof sample.wavFile === "string" && !isAbsolute(sample.wavFile),
      "Expected relative sample path",
    );
    const path = await realpath(resolve(base, sample.wavFile)),
      rel = relative(base, path);
    assert(
      !rel.startsWith("..") && !isAbsolute(rel),
      "Sample must stay within collection",
    );
    assert(
      (await stat(path)).size <= 24 * 1024 * 1024,
      "Sample exceeds input budget",
    );
    const b = await readFile(path);
    assert(
      b.toString("ascii", 0, 4) === "RIFF" &&
        b.toString("ascii", 8, 12) === "WAVE",
      "Expected WAV",
    );
    let fmt, pcm;
    for (let p = 12; p + 8 <= b.length; ) {
      const size = b.readUInt32LE(p + 4);
      assert(p + 8 + size <= b.length, "Bad WAV chunk");
      const id = b.toString("ascii", p, p + 4);
      if (id === "fmt ") fmt = b.subarray(p + 8, p + 8 + size);
      if (id === "data") pcm = b.subarray(p + 8, p + 8 + size);
      p += 8 + size + (size % 2);
    }
    assert(
      fmt && pcm && fmt.readUInt16LE(0) === 1 && fmt.readUInt16LE(14) === 16,
      "Converter accepts collected PCM16 WAVs only",
    );
    const channelCount = fmt.readUInt16LE(2),
      rate = fmt.readUInt32LE(4);
    assert(channelCount >= 1 && channelCount <= 2);
    assert(pcm.length % (channelCount * 2) === 0);
    decodedBytes += pcm.length * 2;
    assert(
      decodedBytes <= 24 * 1024 * 1024,
      "Decoded assets exceed 24 MiB; select fewer roots or articulations",
    );
    const channels = Array.from({ length: channelCount }, (_, ch) =>
      encodeSamples(
        Float32Array.from(
          { length: pcm.length / channelCount / 2 },
          (_, i) => pcm.readInt16LE((i * channelCount + ch) * 2) / 32768,
        ),
      ),
    );
    assets[sample.id] = {
      id: sample.id,
      name: `${sample.name} · #${sample.slot}`,
      sampleRate: rate,
      channels,
    };
    assert(
      Number.isInteger(sample.rootMidi),
      "Unpitched sources need an explicitly assigned root and key range",
    );
    const r = {
      id: sample.id,
      assetId: sample.id,
      rootMidi: sample.rootMidi,
      keyLow: sample.keyLow,
      keyHigh: sample.keyHigh,
      velocityLow: Math.max(1, sample.velocityLow),
      velocityHigh: sample.velocityHigh,
      articulation: sample.articulation,
      roundRobin:
        sample.roundRobin?.index ??
        Math.round((sample.roundRobin?.randomLow ?? 0) * 100),
      tuneCents: Number(sample.sourceEffectiveOpcodes?.tune ?? 0),
      gainDb: sample.conversion?.suggestedAuthorRegionVolumeDb ?? 0,
      releaseSeconds: Math.max(
        0.005,
        Math.min(3, sample.release?.envelopeSeconds ?? 0.15),
      ),
    };
    if (
      sample.release?.recordedReleaseSampleId &&
      selected.some((s) => s.id === sample.release.recordedReleaseSampleId)
    )
      r.releaseAssetId = sample.release.recordedReleaseSampleId;
    // Unverified collection loop points are deliberately not enabled by this adapter.
    regions.push(r);
    conversion.push({
      id: sample.id,
      source: sample.sourceUrl,
      license: sample.license,
      originalLoop: sample.loop,
      loopEnabled: false,
      roundRobinMode: "deterministic-cycle",
      originalRoundRobin: sample.roundRobin,
    });
  }
  const instrument = {
    id: options["--instrument"],
    name: selected[0].instrumentName,
    source: manifest.source,
    license: manifest.license,
    regions,
  };
  // An original five-note phrase within the available regions, with actual velocity changes.
  const stacc = regions.filter(
      (r) => r.articulation === regions[0].articulation,
    ),
    rootsAvailable = [...new Set(stacc.map((r) => r.rootMidi))].sort(
      (a, b) => a - b,
    );
  const melody = [
    rootsAvailable[0],
    rootsAvailable[0],
    rootsAvailable[Math.min(1, rootsAvailable.length - 1)],
    rootsAvailable[0],
    rootsAvailable[Math.min(2, rootsAvailable.length - 1)],
  ];
  const notes = melody.map((midi, i) => {
    const candidates = stacc.filter(
        (r) => midi >= r.keyLow && midi <= r.keyHigh,
      ),
      desired = [35, 75, 105, 65, 95][i],
      r =
        candidates.find(
          (r) => desired >= r.velocityLow && desired <= r.velocityHigh,
        ) ?? candidates[0];
    return {
      id: `note-${i + 1}`,
      instrumentId: instrument.id,
      midi,
      start: i * 0.75,
      duration: 0.45,
      velocity: Math.max(r.velocityLow, Math.min(r.velocityHigh, desired)),
      articulation: r.articulation,
    };
  });
  const score = {
    schema: "momo.score/v1",
    bpm: 120,
    instruments: [instrument],
    notes,
  };
  const project = parseProject({
    schema: "momo.soundforge/v2",
    name: `${instrument.name} · 五音动机`,
    seed: 2048,
    duration: 3,
    master: 0.8,
    echo: 0,
    assets,
    layers: [
      makeLayer({
        id: "instrument-part",
        name: instrument.name,
        type: "instrument",
        score,
        duration: 3,
        frequency: 440,
        endFrequency: 440,
        gain: 1,
        attack: 0,
        release: 0,
        decay: 0,
        cutoff: 22000,
      }),
    ],
  });
  const saved = projectForSave(project),
    reopened = parseProject(JSON.parse(JSON.stringify(saved))),
    rendered = renderProject(saved),
    again = renderProject(reopened);
  assert.deepEqual(rendered.left, again.left);
  assert.deepEqual(rendered.right, again.right);
  await mkdir(out, { recursive: true });
  await writeFile(
    resolve(out, "instrument.sfinstrument"),
    JSON.stringify({ schema: "momo.instrument/v1", instrument, assets }),
  );
  await writeFile(resolve(out, "phrase.soundforge"), JSON.stringify(saved));
  await writeFile(
    resolve(out, "phrase.wav"),
    new Uint8Array(encodeWav(rendered)),
  );
  await writeFile(
    resolve(out, "notes.json"),
    JSON.stringify(
      { schema: "momo.note-events/v1", bpm: score.bpm, notes },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(out, "conversion.json"),
    JSON.stringify(
      {
        manifest: manifest.schema,
        source: manifest.source,
        sourceCommit: manifest.sourceCommit,
        license: manifest.license,
        conversion,
        verification: {
          frames: rendered.left.length,
          sampleRate: rendered.sampleRate,
          peak: rendered.peak,
          rms: rendered.rms,
          reopenIdentical: true,
          subjectiveListening: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(`Created ${regions.length} sample regions in ${out}`);
} finally {
  await server.close();
}
