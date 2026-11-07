import { readAsset } from './sound-asset-store.mjs';
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const SCENES = [
  { id: "forest-morning", category: "nature", keywords: "forest morning wind birds 林间 清晨 风声 鸟鸣",
    clips: [["wind", 1, 0, .35], ["wind", 1, 10, .35], ["birds", 1, 0, .8], ["bird-calls", 1, 4, .65]],
    control: ["wind", "wind", 0, .8] },
  { id: "rainstorm", category: "weather", keywords: "rain thunder storm wind 雨天 雷雨 风雨 雷声",
    clips: [["rain-ground", 2, 0, .65], ["thunder-clean", 1, 3.2, .65], ["wind", 2, 0, .2], ["wind", 2, 10, .2]],
    control: ["rain", "rain-ground", .15, 1] },
  { id: "night-stream", category: "nature", keywords: "night stream crickets water 夜晚 小溪 虫鸣 流水",
    clips: [["stream", 1, 0, .65], ["insects", 1, 0, .45], ["insects", 1, 10, .45]],
    control: ["insects", "insects", 0, .9] },
];

export function natureSfxJobs(manifest, root) {
  const samples = manifest.samples.map(sample => ({
    id: sample.id, kind: "sample", nameKey: sample.nameKey, category: sample.category,
    keywords: `${sample.keywords} ${sample.englishName} ${sample.source.author}`,
    recordingGroup: sample.groupId, recording: sample.recording, playback: sample.playback,
    natureSfx: true, sample, source: `${root}/${sample.wavFile}`,
  }));
  return [...samples, ...SCENES.map(scene => {
    const selected = scene.clips.map(([group, recording]) => {
      const sample = manifest.samples.find(s => s.groupId === `nature-${group}` && s.recording === recording);
      if (!sample) throw Error(`Missing nature source for ${scene.id}: ${group}/${recording}`);
      return sample;
    });
    return { id: `example-nature-${scene.id}`, kind: "example", nameKey: `builtin.natureScene.${scene.id}`,
      category: scene.category, keywords: scene.keywords, natureSfx: true, scene, samples: selected,
      sourceFiles: [...new Set(selected.map(s => `${root}/${s.wavFile}`))] };
  })];
}

export async function natureSfxProject(job, workspace, root, { makeLayer, encodeSamples }) {
  const assets = {}, inputs = [], duration = job.scene ? 12 : job.sample.duration;
  const add = async (sample, start = 0, gain = 1) => {
    if (!assets[sample.id]) {
      const wav = await readAsset(workspace, `${root}/${sample.wavFile}`);
      if (createHash("sha256").update(wav).digest("hex") !== sample.wavSha256 ||
          wav.toString("ascii", 36, 40) !== "data" || wav.readUInt32LE(24) !== 48000 ||
          wav.readUInt16LE(22) !== 2 || wav.readUInt16LE(34) !== 16 || wav.length !== 44 + sample.frames * 4)
        throw Error(`Invalid nature WAV: ${sample.id}`);
      const channels = [new Float32Array(sample.frames), new Float32Array(sample.frames)];
      for (let i = 0; i < sample.frames; i++) for (let c = 0; c < 2; c++)
        channels[c][i] = wav.readInt16LE(44 + i * 4 + c * 2) / 32768;
      assets[sample.id] = { id: sample.id, name: path.basename(sample.wavFile), sampleRate: 48000,
        channels: channels.map(encodeSamples), source: sample.source };
    }
    inputs.push(makeLayer({ id: `nature-layer-${inputs.length}-${sample.id}`, name: sample.nameKey,
      type: "sample", assetId: sample.id, start, duration: Math.min(sample.duration, duration - start),
      frequency: 440, endFrequency: 440, attack: 0, release: 0, decay: 0, cutoff: 22000,
      gain, noiseSeed: 2048 }));
  };
  if (job.scene) for (const [i, [, , start, gain]] of job.scene.clips.entries()) await add(job.samples[i], start, gain);
  else await add(job.sample);
  const project = { schema: "momo.soundforge/v4", name: job.nameKey, seed: 2048, duration,
    master: job.scene ? .65 : 1, echo: 0, assets, inputs };
  if (job.playback === "loop") project.loopRegion = { start: 0, end: duration, crossfade: 0 };
  if (job.scene?.control) {
    const [name, group, low, high] = job.scene.control;
    project.controls = [{ id: `nature-control-${name}`, name: `builtin.natureControl.${name}`,
      min: 0, max: 1, defaultValue: .5,
      mappings: inputs.filter(layer => job.samples.some(s => s.id === layer.player.assetId && s.groupId === `nature-${group}`))
        .map(layer => ({ layerId: layer.id, parameter: "gain", low, high })) }];
  }
  return project;
}
