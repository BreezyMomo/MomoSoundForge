import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "../src/audio";
import type { RenderResult } from "../src/model";
afterEach(() => vi.unstubAllGlobals());
describe("audition cancellation", () => {
  it("starts at the requested offset, preserves pause position, and rebases loop changes", async () => {
    const sources: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      onended: (() => void) | null;
      loop: boolean;
    }[] = [];
    const context = {
      state: "running",
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
      createGain: vi.fn(() => ({
        gain: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createBufferSource: vi.fn(() => {
        const source = {
          buffer: null,
          loop: false,
          onended: null as (() => void) | null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        sources.push(source);
        return source;
      }),
    };
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          return context;
        }
      },
    );
    const player = new AudioPlayer(),
      result: RenderResult = {
        left: new Float32Array(1000),
        right: new Float32Array(1000),
        sampleRate: 100,
        peak: 0,
        sourcePeak: 0,
        gainReduction: 1,
        rms: 0,
        layers: {},
      };
    await player.play(
      result,
      false,
      0.7,
      () => {},
      () => true,
      2.5,
    );
    expect(sources[0].start).toHaveBeenCalledWith(0, 2.5);
    context.currentTime = 5;
    expect(player.position()).toBe(7.5);
    player.stop();
    context.currentTime = 20;
    expect(player.position()).toBe(7.5);
    await player.play(
      result,
      true,
      0.7,
      () => {},
      () => true,
      9,
    );
    context.currentTime = 23;
    expect(player.position()).toBe(2);
    player.setLoop(false);
    context.currentTime = 24;
    expect(player.position()).toBe(3);
    expect(sources[1].loop).toBe(false);
    sources[1].onended?.();
    expect(player.position()).toBe(10);
    expect(player.source).toBe(null);
    // Region playback must drive both Web Audio's loop boundaries and the UI clock.
    const region = { start: 2, end: 5 };
    await player.play(result, true, 0.7, () => {}, () => true, 8, region);
    expect(sources[2].start).toHaveBeenCalledWith(0, 2);
    expect(player.source?.loopStart).toBe(2);
    expect(player.source?.loopEnd).toBe(5);
    context.currentTime = 28;
    expect(player.position()).toBe(3);
    player.setLoop(false);
    context.currentTime = 31;
    expect(player.position()).toBe(6);
    await player.play(result, true, 0.7, () => {}, () => true, 4, region);
    expect(sources[3].start).toHaveBeenCalledWith(0, 4);
    context.currentTime = 32;
    expect(player.position()).toBe(2);
    await player.play(result, true, 0.7, () => {}, () => true, 0, region);
    expect(sources[4].start).toHaveBeenCalledWith(0, 2);
    await player.play(result, true, 0.7, () => {}, () => true, 0, { start: 12, end: 14 });
    expect(player.source?.loopStart).toBe(0);
    expect(player.source?.loopEnd).toBe(10);
  });
  it("does not replace or stop active audio when a cancelled request resumes later", async () => {
    const source = {
      buffer: null,
      loop: false,
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const context = {
      state: "running",
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
      createGain: vi.fn(() => ({
        gain: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createBufferSource: vi.fn(() => source),
    };
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          return context;
        }
      },
    );
    const player = new AudioPlayer(),
      result: RenderResult = {
        left: new Float32Array(32),
        right: new Float32Array(32),
        sampleRate: 48000,
        peak: 0,
        sourcePeak: 0,
        gainReduction: 1,
        rms: 0,
        layers: {},
      };
    expect(await player.play(result, false, 0.7, () => {})).toBe(true);
    let release!: () => void;
    context.state = "suspended";
    context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    let current = true;
    const cancelled = player.play(
      result,
      false,
      0.7,
      () => {},
      () => current,
    );
    current = false;
    release();
    expect(await cancelled).toBe(false);
    expect(player.source).toBe(source);
    expect(source.stop).not.toHaveBeenCalled();
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    player.stop();
    expect(source.stop).toHaveBeenCalledTimes(1);
  });
});
