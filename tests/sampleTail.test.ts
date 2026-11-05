import { expect, it } from "vitest";
import { instrumentPlaybackRange } from "../src/sampleTail";
import { makeLayer, encodeSamples, type Project } from "../src/model";
import { renderProject } from "../src/engine";

const rate = 8000;
const signal = (seconds: number, amplitude: (time: number) => number) => Float32Array.from(
  { length: Math.round(seconds * rate) }, (_, i) => amplitude(i / rate) * Math.sin(2 * Math.PI * 220 * i / rate),
);
it("ends a decaying piano note above its noise bed and excludes a late recording click", () => {
  const audio = signal(8, t => .4 * Math.exp(-t * 2) + .0008);
  audio[7 * rate] = .15;
  const original = audio.slice();
  const range = instrumentPlaybackRange([audio], rate, "upright-piano");
  expect(range.duration).toBeGreaterThan(2);
  expect(range.duration).toBeLessThan(4);
  expect(range.release).toBe(.18);
  expect(audio).toEqual(original);
  const scaled = Float32Array.from(audio, x => x * .02);
  expect(instrumentPlaybackRange([scaled], rate, "upright-piano").duration).toBe(range.duration);
});
it("keeps resonance that returns after a short quiet interval", () => {
  const audio = signal(5, t => t < .5 ? .4 : t < .7 ? 0 : t < 2 ? .03 : 0);
  expect(instrumentPlaybackRange([audio], rate, "upright-piano").duration).toBeGreaterThan(2);
});
it("preserves long sustained playing and internal rests", () => {
  const audio = signal(9, t => t < 2 || (t > 3 && t < 8) ? .08 : 0);
  const range = instrumentPlaybackRange([audio], rate, "flute");
  expect(range.duration).toBeCloseTo(8.18, 2);
  expect(instrumentPlaybackRange([signal(12, () => .08)], rate, "violin-section").duration).toBe(12);
});
it("uses either stereo channel and retains even very quiet ringing", () => {
  const left = signal(5, t => t < .3 ? .2 : 0);
  const right = signal(5, t => t < 3 ? -.1 : 0);
  expect(instrumentPlaybackRange([left, right], rate, "glockenspiel").duration).toBeCloseTo(3.18, 2);
  expect(instrumentPlaybackRange([Float32Array.from(right, x => x * .0001)], rate, "timpani").duration).toBeCloseTo(3.18, 2);
});
it("does not extend short recordings and handles silence", () => {
  expect(instrumentPlaybackRange([signal(.2, () => .2)], rate, "snare-drum").duration).toBe(.2);
  expect(instrumentPlaybackRange([new Float32Array(rate * 3)], rate, "upright-piano").duration).toBe(.1);
});
it("renders a smooth ending while keeping the original embedded recording available", () => {
  const audio = signal(6, t => .3 * Math.exp(-t * 3) + .0006);
  const range = instrumentPlaybackRange([audio], rate, "upright-piano");
  const project: Project = {
    schema: "momo.soundforge/v2", name: "Tail", seed: 1, duration: range.duration, master: 1, echo: 0,
    assets: { note: { id: "note", name: "note.wav", sampleRate: rate, channels: [encodeSamples(audio)] } },
    layers: [makeLayer({ type: "sample", assetId: "note", frequency: 440, endFrequency: 440, ...range, decay: 0 })],
  };
  const rendered = renderProject(project, rate);
  expect(rendered.left.length).toBe(Math.round(range.duration * rate));
  expect(Math.max(...rendered.left.slice(-80).map(Math.abs))).toBeLessThan(.0001);
  expect(project.assets.note.channels[0]).toBe(encodeSamples(audio));
  expect(renderProject(project, rate).left).toEqual(rendered.left);
});
