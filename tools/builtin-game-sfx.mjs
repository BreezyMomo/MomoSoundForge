import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const SCENES = [
  ...[
    ['wood-impact', 'wood-heavy', 95, 'noise'],
    ['metal-impact', 'metal-heavy', 115, 'triangle'],
    ['body-impact', 'body-thud', 70, 'noise'],
  ].map(([id, material, frequency, detail]) => ({ id, category: 'impacts',
    keywords: `${material} impact hit 命中 撞击`, clips: [[material, 1, 0, .85]], quick: { frequency, detail } })),
  { id: "wooden-landing", category: "footsteps", keywords: "wood land jump fall 木地板 跳跃 落地", clips: [
    ["footstep-wood", 1, 0, .9], ["body-thud", 1, .025, .55],
  ], bass: true, control: ["weight", "body-thud", .2, .9] },
  { id: "snow-landing", category: "footsteps", keywords: "snow land jump fall 雪地 跳跃 落地", clips: [
    ["footstep-snow", 2, 0, 1], ["body-thud", 2, .025, .4],
  ], control: ["weight", "body-thud", .15, .65] },
  { id: "wooden-walk", category: "footsteps", keywords: "wood walk footsteps 木地板 走路 连续脚步", clips: [
    ["footstep-wood", 1, 0, 1], ["footstep-wood", 2, .45, .95],
    ["footstep-wood", 3, .9, 1], ["footstep-wood", 4, 1.35, .95],
  ] },
  { id: "solid-punch", category: "impacts", keywords: "punch fight melee hit 拳击 战斗 重击", clips: [
    ["punch-heavy", 1, .015, .9], ["body-thud", 2, .035, .5],
  ], bass: true, control: ["impact", "punch-heavy", .5, 1.3] },
  { id: "blade-metal-hit", category: "impacts", keywords: "blade sword metal hit 刀剑 金属 挥砍 命中", clips: [
    ["knife-swish", 1, 0, .65], ["metal-heavy", 1, .12, .75], ["punch-medium", 2, .12, .2],
  ], control: ["metal", "metal-heavy", .3, 1.2] },
  { id: "creaky-door-open", category: "mechanisms", keywords: "door creak latch open 开门 门闩 吱呀", clips: [
    ["latch", 1, 0, .55], ["creak", 1, .06, .45], ["door-open", 1, .13, .8],
  ], control: ["creak", "creak", 0, .9] },
  { id: "door-close-lock", category: "mechanisms", keywords: "door shut close latch lock 关门 落锁 门闩", clips: [
    ["door-close", 2, 0, .8], ["latch", 1, .2, .55], ["body-thud", 3, .015, .25],
  ], control: ["impact", "door-close", .45, 1.15] },
  { id: "mechanism-activate", category: "mechanisms", keywords: "switch lever mechanism activate 开关 拉杆 机关 启动", clips: [
    ["switch", 1, 0, .65], ["latch", 1, .07, .55], ["metal-heavy", 2, .16, .2],
  ], motor: true, control: ["mechanism", "latch", .2, .9] },
];

export function gameSfxJobs(manifest, root) {
  const samples = manifest.samples.map(sample => ({
    id: sample.id, kind: "sample", nameKey: sample.nameKey, category: sample.category,
    keywords: `${sample.keywords} ${sample.englishName} ${sample.sourceArchiveMember}`,
    recordingGroup: sample.groupId, recording: sample.recording,
    gameSfx: true, sample, source: `${root}/${sample.wavFile}`,
  }));
  const examples = SCENES.map(scene => {
    const sources = scene.clips.map(([group, recording]) => {
      const sample = manifest.samples.find(s => s.groupId === `game-${group}` && s.recording === recording);
      if (!sample) throw Error(`Missing game SFX recipe input: ${scene.id}/${group}/${recording}`);
      return sample;
    });
    return { id: `example-game-${scene.id}`, kind: "example", nameKey: `builtin.gameScene.${scene.id}`,
      category: scene.category, keywords: scene.keywords, gameSfx: true, scene, samples: sources,
      sourceFiles: sources.map(s => `${root}/${s.wavFile}`) };
  });
  return [...samples, ...examples];
}

export async function gameSfxProject(job, root, collectionRoot, { makeLayer, encodeSamples }) {
  const assets = {}, inputs = [];
  const add = async (sample, start = 0, gain = 1) => {
    if (!assets[sample.id]) {
      const bytes = await readFile(path.join(root, collectionRoot, sample.wavFile));
      if (createHash("sha256").update(bytes).digest("hex") !== sample.wavSha256 ||
        bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 36, 40) !== "data" ||
        bytes.readUInt32LE(24) !== 48000 || bytes.readUInt16LE(22) !== 2 || bytes.readUInt16LE(34) !== 16)
        throw Error(`Invalid game SFX WAV: ${sample.id}`);
      const frames = bytes.readUInt32LE(40) / 4;
      if (!Number.isInteger(frames) || frames < 1 || frames > 48000 * 10 || bytes.length !== 44 + frames * 4)
        throw Error(`Game SFX exceeds the source budget: ${sample.id}`);
      const channels = [new Float32Array(frames), new Float32Array(frames)];
      let peak = 0;
      for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) {
        const value = bytes.readInt16LE(44 + i * 4 + c * 2) / 32768;
        channels[c][i] = value; peak = Math.max(peak, Math.abs(value));
      }
      if (peak === 0) throw Error(`Silent game SFX: ${sample.id}`);
      // These independent SFX are level-matched for mixing. Versioned WAVs keep
      // the publisher's recording dynamics; generated assets get safe headroom.
      assets[sample.id] = { id: sample.id, name: path.basename(sample.wavFile), sampleRate: 48000,
        channels: channels.map(channel => encodeSamples(Float32Array.from(channel, x => x * .65 / peak))) };
    }
    inputs.push(makeLayer({ id: `layer-${inputs.length}-${sample.id}`, name: sample.nameKey,
      type: "sample", assetId: sample.id, start, gain, sourceStart: sample.playback.trim, sourceEnd: sample.playback.trim + sample.playback.duration, player: { duration: sample.playback.trim + sample.playback.duration },
      duration: sample.playback.duration, frequency: 440, endFrequency: 440,
      attack: .001, release: Math.min(.025, sample.playback.duration / 4), decay: 0,
      cutoff: 22000, noiseSeed: 2048 }));
  };
  if (!job.scene) await add(job.sample);
  else {
    for (const [i, [, , start, gain]] of job.scene.clips.entries()) await add(job.samples[i], start, gain);
    if (job.scene.bass) inputs.push(makeLayer({ id: "layer-weight", name: "builtin.gameLayer.weight",
      wave: "sine", frequency: 85, endFrequency: 38, start: .02, duration: .18,
      gain: .22, attack: .002, release: .08, decay: 5, cutoff: 800, noiseSeed: 2048 }));
    if (job.scene.motor) inputs.push(makeLayer({ id: "layer-motor", name: "builtin.gameLayer.motor",
      wave: "saw", frequency: 70, endFrequency: 180, start: .09, duration: .32,
      gain: .12, attack: .02, release: .14, decay: 1, cutoff: 900, noiseSeed: 2048 }));
  }
  const project = { schema: "momo.soundforge/v4", name: job.nameKey, seed: 2048, master: .5, echo: 0,
    duration: Math.max(.1, ...inputs.map(layer => layer.start + layer.duration)), assets, inputs };
  if (job.scene?.control) {
    const [name, group, low, high] = job.scene.control;
    project.controls = [{ id: `control-${name}`, name: `builtin.gameControl.${name}`,
      min: 0, max: 1, defaultValue: .5,
      mappings: inputs.filter(layer => layer.player.assetId && job.samples.some(s => s.id === layer.player.assetId && s.groupId === `game-${group}`))
        .map(layer => ({ layerId: layer.id, parameter: "gain", low, high })) }];
  }
  if (job.scene?.quick) {
    const { frequency, detail } = job.scene.quick;
    const body = inputs[0];
    body.name = 'builtin.gameLayer.body';
    Object.assign(body.player, { cutoff: 16000, release: .015 });
    inputs.push(makeLayer({ id: 'layer-weight', name: 'builtin.gameLayer.weight', frequency, endFrequency: 42,
      duration: .16, gain: .2, attack: .002, release: .055, decay: 4, cutoff: 500 }));
    inputs.push(makeLayer({ id: 'layer-detail', name: 'builtin.gameLayer.detail', wave: detail,
      frequency: detail === 'triangle' ? 1700 : 440, endFrequency: detail === 'triangle' ? 1100 : 440,
      start: .018, duration: detail === 'triangle' ? .25 : .1, gain: .06, attack: .005, release: .06, decay: 4, cutoff: 8500 }));
    project.controls = [
      { id: 'impact', name: 'builtin.gameControl.impact', min: 0, max: 100, defaultValue: 50,
        mappings: [{ layerId: 'layer-weight', parameter: 'gain', low: .05, high: .36 }] },
      { id: 'brightness', name: 'builtin.gameControl.brightness', min: 0, max: 100, defaultValue: 65,
        mappings: [{ layerId: body.id, parameter: 'cutoff', low: 1800, high: 20000, logarithmic: true }] },
      { id: 'detail', name: 'builtin.gameControl.detail', min: 0, max: 100, defaultValue: 35,
        mappings: [{ layerId: 'layer-detail', parameter: 'gain', low: 0, high: .15 }] },
    ];
    project.master = 1;
    project.duration = Math.max(.1, ...inputs.map(l => l.start + l.duration));
  }
  return project;
}
