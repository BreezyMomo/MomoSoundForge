import { describe, expect, it } from "vitest";
import { makeProject, makeLayer, type Project } from "../src/model";
import { renderProject } from "../src/engine";
import { DEFAULT_EFFECTS } from "../src/advanced";
import {
  audioResult,
  DEFAULT_EXPORT,
  exportWav,
  parseExportSettings,
  prepareExport,
  renderExport,
} from "../src/exportAudio";

const project = (): Project => ({
  ...makeProject("Export test"),
  duration: 0.2,
  layers: [
    makeLayer({
      id: "tone",
      duration: 0.2,
      gain: 0.15,
      attack: 0,
      release: 0.01,
      decay: 0,
      effects: {
        ...DEFAULT_EFFECTS,
        delayTime: 0.1,
        delayFeedback: 0.25,
        delayWet: 0.5,
      },
    }),
  ],
});
const render = async (p: Project) => renderProject(p, 4000);

describe("export content, tails and pure silence", () => {
  it("appends exact zeros without rendering extra source or changing normalized sound", async () => {
    const p = project();
    p.layers.push(
      makeLayer({ id: "outside", start: 0.3, duration: 0.2, gain: 0.3 }),
    );
    const base = await renderExport(
      p,
      { ...DEFAULT_EXPORT, normalize: true },
      render,
    );
    const padded = await renderExport(
      p,
      { ...DEFAULT_EXPORT, normalize: true, tail: 0.25 },
      render,
    );
    expect(padded.left.slice(0, base.left.length)).toEqual(base.left);
    expect(padded.right.slice(0, base.right.length)).toEqual(base.right);
    expect(padded.left.slice(base.left.length).every((v) => v === 0)).toBe(
      true,
    );
    expect(padded.right.slice(base.right.length).every((v) => v === 0)).toBe(
      true,
    );
    expect(padded.left.length - base.left.length).toBe(12000);
    expect(p.duration).toBe(0.2);
  });
  it("trims before appending silence and encodes the displayed WAV duration", () => {
    const channel = new Float32Array(1000);
    channel.fill(0.1, 100, 800);
    const output = prepareExport(audioResult(channel, channel, 1000), {
      ...DEFAULT_EXPORT,
      sampleRate: 22050,
      trimSilence: true,
      tail: 0.2,
    });
    expect(output.exportInfo).toMatchObject({
      audioSeconds: 0.7,
      silenceSeconds: 0.2,
    });
    expect(output.left.length).toBe(19845);
    expect(output.left.slice(15435).every((v) => v === 0)).toBe(true);
    const wav = new DataView(exportWav(output, false));
    expect(wav.getUint32(40, true) / wav.getUint32(28, true)).toBe(0.9);
  });
  it("retains audible effect tails and adds separate silence after them", async () => {
    const p = project();
    const before = structuredClone(p);
    const tail = await renderExport(
      p,
      { ...DEFAULT_EXPORT, preserveTail: true },
      render,
    );
    const padded = await renderExport(
      p,
      { ...DEFAULT_EXPORT, preserveTail: true, tail: 0.1 },
      render,
    );
    expect(tail.left.length).toBeGreaterThan(0.2 * 48000);
    expect(tail.left.slice(0.2 * 48000).some((v) => Math.abs(v) > 0.001)).toBe(
      true,
    );
    expect(padded.left.slice(0, tail.left.length)).toEqual(tail.left);
    expect(padded.left.slice(tail.left.length).every((v) => v === 0)).toBe(
      true,
    );
    expect(padded.left.length).toBe(tail.left.length + 4800);
    expect(p).toEqual(before);
  });
  it("does not add arbitrary tail silence to dry audio or extend for muted content", async () => {
    const p = project();
    p.layers[0].effects = undefined;
    p.layers.push(makeLayer({ muted: true, start: 1, duration: 0.1 }));
    const a = await renderExport(
      p,
      { ...DEFAULT_EXPORT, preserveTail: true },
      render,
    );
    const b = await renderExport(p, DEFAULT_EXPORT, render);
    expect(a.left).toEqual(b.left);
  });
  it("honors solos when determining full content range", async () => {
    const p = project();
    p.layers[0].effects = undefined;
    p.layers[0].solo = true;
    p.layers.push(makeLayer({ id: "not-solo", start: 1, duration: 0.1 }));
    const output = await renderExport(
      p,
      { ...DEFAULT_EXPORT, preserveTail: true },
      render,
    );
    expect(output.left.length).toBe(9600);
  });
  it("supports nested tails and legacy root echo", async () => {
    const p = project();
    const nested: Project = {
      ...makeProject("nested"),
      duration: 0.2,
      echo: 0.4,
      layers: [
        makeLayer({
          type: "composition",
          id: "group",
          duration: 0.2,
          project: p,
        }),
      ],
    };
    const output = await renderExport(
      nested,
      { ...DEFAULT_EXPORT, preserveTail: true },
      render,
    );
    expect(output.left.length).toBeGreaterThan(9600);
    expect(output.left.slice(9600).some((v) => Math.abs(v) > 0.001)).toBe(true);
  });
  it("ignores tail, trim and padding for loops and restores them when a loop is removed", async () => {
    const p = project();
    p.loopRegion = { start: 0, end: 0.2, crossfade: 0.02 };
    const settings = {
      ...DEFAULT_EXPORT,
      loopOnly: true,
      preserveTail: true,
      trimSilence: true,
      tail: 1,
    };
    const loop = await renderExport(p, settings, render);
    expect(loop.left.length).toBe(8640);
    expect(loop.exportInfo?.silenceSeconds).toBe(0);
    const full = await renderExport(
      { ...p, loopRegion: undefined },
      settings,
      render,
    );
    expect(full.exportInfo?.silenceSeconds).toBe(1);
    expect(full.left.length).toBeGreaterThan(48000);
  });
  it("validates preferences and rejects oversized resampling before allocation", () => {
    expect(parseExportSettings({ preserveTail: "yes", tail: NaN })).toEqual(
      DEFAULT_EXPORT,
    );
    expect(parseExportSettings({ preserveTail: true, tail: 9 })).toMatchObject({
      preserveTail: true,
      tail: 2,
    });
    const input = audioResult(
      new Float32Array(100000),
      new Float32Array(100000),
      100,
    );
    expect(() => prepareExport(input, DEFAULT_EXPORT)).toThrow(
      "error.renderBudget",
    );
  });
});
