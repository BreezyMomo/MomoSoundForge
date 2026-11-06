import { describe, expect, it } from "vitest";
import { DEFAULT_EFFECTS, resolveControls } from "../src/advanced";
import {
  encodeSamples,
  makeComposition,
  makeLayer,
  makeProject,
  parseProject,
  projectForSave,
} from "../src/model";
import { renderProject } from "../src/engine";
import {
  contentCandidate,
  contentReplacementError,
  localContentCandidate,
  replaceContent,
} from "../src/contentReplacement";

it("distinguishes library loading, audio decoding and project validation errors", () => {
  expect(contentReplacementError(new Error("library.builtinLoadError"), "error.sample"))
    .toBe("library.builtinLoadError");
  expect(contentReplacementError(new Error("Invalid SoundForge project"), "error.replaceProject"))
    .toBe("error.replaceProject");
  expect(contentReplacementError(new Error("decode failed"), "error.sample"))
    .toBe("error.sample");
  expect(contentReplacementError(new Error("error.budget"), "error.replaceProject"))
    .toBe("error.budget");
});

function fixture() {
  const asset = {
    id: "shared",
    name: "old.wav",
    sampleRate: 12000,
    channels: [
      encodeSamples(
        Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i * 0.13) * 0.3),
      ),
    ],
  };
  const first = makeLayer({
    id: "first",
    name: "My layer",
    type: "sample",
    assetId: asset.id,
    start: 0.1,
    duration: 0.2,
    frequency: 880,
    sourceStart: 0.05, sourceEnd: 0.37, speed: 1.6, player: { duration: 0.4 },
    gain: 0.25,
    cutoff: 3000,
    effects: { ...DEFAULT_EFFECTS, low: 3 },
    automation: {
      pan: [
        { time: 0, value: -0.5 },
        { time: 1, value: 0.5 },
      ],
    },
  });
  const root = parseProject({
    ...makeProject("Test"),
    duration: 1,
    assets: { shared: asset },
    inputs: [
      first,
      makeLayer({ ...first, id: "second", name: "Sibling", start: 0.5 }),
    ],
    controls: [
      {
        id: "loud",
        name: "Weight",
        min: 0,
        max: 1,
        defaultValue: 0.5,
        mappings: [
          { layerId: "first", parameter: "gain", low: 0.1, high: 0.6 },
          { layerId: "second", parameter: "gain", low: 0.2, high: 0.5 },
        ],
      },
    ],
  });
  const candidate = localContentCandidate(
    {
      ...asset,
      id: "other",
      name: "new.wav",
      channels: [
        encodeSamples(
          Float32Array.from(
            { length: 6000 },
            (_, i) => Math.sin(i * 0.07) * 0.2,
          ),
        ),
      ],
      source: {
        provider: "Test",
        author: "Author",
        url: "https://example.com/sample",
        license: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        quality: "original",
        retrievedAt: "2026-11-06T00:00:00Z",
      },
    },
    0.5,
  );
  return { root, candidate, address: { path: [], id: "first" } };
}

describe("independent sound content", () => {
  it("replaces audio without changing outer settings, shared assets, sibling inputs or the input", () => {
    const { root, candidate, address } = fixture(),
      before = JSON.stringify(root);
    const next = replaceContent(root, address, candidate),
      layer = next.inputs[0];
    expect(JSON.stringify(root)).toBe(before);
    expect(layer).toMatchObject({
      id: "first",
      name: "My layer",
      start: 0.1,
      gain: 0.25,
      duration: 0.2, sourceStart: 0.05, sourceEnd: 0.37, speed: 1.6,
      automation: root.inputs[0].automation,
      player: candidate.player,
    });
    expect(layer.player.duration).toBe(candidate.player.duration);
    expect(layer.sourceStart).toBe(root.inputs[0].sourceStart);
    expect(next.inputs[1]).toEqual(root.inputs[1]);
    expect(next.assets.shared).toEqual(root.assets.shared);
    expect(next.controls).toEqual(root.controls);
    expect(next.duration).toBe(1);
    expect(renderProject(next, 12000).left).not.toEqual(
      renderProject(root, 12000).left,
    );
  });

  it("replaces a whole nested combination with audio and removes its internal resources", () => {
    const { root: child, candidate } = fixture();
    const group = makeComposition(child, {
      id: "group",
      start: 0.2,
      gain: 0.4,
      effects: { ...DEFAULT_EFFECTS, reverb: 0.2 },
    });
    const root = { ...makeProject("Outer"), duration: 0.4, inputs: [group] };
    const next = replaceContent(root, { path: [], id: "group" }, candidate);
    expect(next.inputs[0]).toMatchObject({
      id: "group",
      start: 0.2,
      gain: 0.4,
      player: { type: "sample" },
    });
    expect(next.inputs[0].player.mix).toBeUndefined();
    expect(Object.keys(next.assets)).toEqual(Object.keys(candidate.assets));
    expect(next.duration).toBe(0.4);
    expect(root.inputs[0].player.mix).toEqual(child);
  });

  it("replaces a sample with an editable combination, including its internal mix and effects once", () => {
    const { root, address } = fixture();
    const inner = {
      ...makeProject("New combination"),
      duration: 0.2,
      master: 0.7,
      effects: { ...DEFAULT_EFFECTS, low: 4 },
      inputs: [makeLayer({ id: "tone", duration: 0.2, wave: "noise" })],
    };
    const candidate = contentCandidate(inner, true);
    const next = replaceContent(root, address, candidate);
    expect(next.inputs[0].player.mix).toEqual(inner);
    expect(next.inputs[0].player.effects).toEqual(candidate.player.effects);
    const expected = {
      ...root,
      inputs: [
        makeComposition(inner, {
          ...root.inputs[0],
          player: candidate.player,
          duration: 0.2,
        }),
        root.inputs[1],
      ],
    };
    expect(renderProject(next, 12000).left).toEqual(
      renderProject(expected, 12000).left,
    );
  });

  it("detaches old content controls even when the new group reuses the same control ID", () => {
    const { root: child, candidate } = fixture();
    child.controls!.push({
      id: "rate",
      name: "Speed",
      min: 0,
      max: 1,
      defaultValue: 0,
      mappings: [
        { layerId: "first", parameter: "frequency", low: 440, high: 880 },
      ],
    });
    const group = makeComposition(child, { id: "group" });
    const root = {
      ...makeProject("Outer"),
      inputs: [group],
      controls: [
        {
          id: "macro",
          name: "Macro",
          min: 0,
          max: 1,
          defaultValue: 1,
          mappings: [
            {
              layerId: "group",
              parameter: "control" as const,
              controlId: "rate",
              low: 0,
              high: 1,
            },
            {
              layerId: "group",
              parameter: "start" as const,
              low: 0.1,
              high: 0.3,
            },
          ],
        },
      ],
    };
    const next = replaceContent(
      root,
      { path: [], id: "group" },
      contentCandidate(child, true),
    );
    expect(next.controls![0].mappings).toEqual([root.controls[0].mappings[1]]);
    expect(resolveControls(next).inputs[0].start).toBe(0.3);
    const nested = replaceContent(
      root,
      { path: ["group"], id: "first" },
      candidate,
    );
    expect(
      nested.inputs[0].player.mix!.controls!.find((c) => c.id === "rate")!
        .mappings,
    ).toEqual([]);
    expect(nested.inputs[0].player.mix!.inputs[0].player.frequency).toBe(
      440,
    );
  });

  it("retains volume/pan automation but removes the old filter curve and source bindings", () => {
    const { root, candidate, address } = fixture();
    root.inputs[0].automation!.cutoff = [{ time: 0, value: 1000 }];
    root.controls![0].mappings.push({
      layerId: "first",
      parameter: "frequency",
      low: 440,
      high: 880,
    });
    const next = replaceContent(root, address, candidate);
    expect(next.inputs[0].automation?.cutoff).toBeUndefined();
    expect(next.inputs[0].automation?.pan).toEqual(
      root.inputs[0].automation?.pan,
    );
    expect(
      next.controls![0].mappings.some((m) => m.parameter === "frequency"),
    ).toBe(false);
    expect(resolveControls(next).inputs[0].gain).toBe(
      resolveControls(root).inputs[0].gain,
    );
  });

  it("supports replacing synth and instrument content while retaining variation locks", () => {
    const { root, candidate, address } = fixture();
    root.inputs[0] = makeLayer({ id: "first", locked: true });
    expect(replaceContent(root, address, candidate).inputs[0]).toMatchObject({
      locked: true,
      player: { type: "sample" },
    });
  });

  it("preserves candidate recording level inside the content instead of overwriting destination gain", () => {
    const { root, address } = fixture();
    const p = {
      ...root,
      inputs: [
        makeLayer({
          type: "sample",
          assetId: "shared",
          duration: 0.2,
          gain: 0.4,
        }),
      ],
      controls: undefined,
      master: 0.5,
    };
    const candidate = contentCandidate(p);
    expect(candidate.player.level).toBe(0.2);
    expect(replaceContent(root, address, candidate).inputs[0].gain).toBe(0.25);
  });

  it("rejects invalid content, collisions and resource budget overflow without touching the original", () => {
    const { root, candidate, address } = fixture(),
      before = JSON.stringify(root);
    expect(() =>
      replaceContent(root, address, { ...candidate, assets: root.assets }),
    ).toThrow();
    const invalid = structuredClone(candidate);
    Object.values(invalid.assets)[0].channels = ["invalid PCM"];
    expect(() => replaceContent(root, address, invalid)).toThrow();
    expect(() =>
      replaceContent(root, address, { ...candidate, duration: NaN }),
    ).toThrow();
    const deep = makeProject("Deep");
    let p = deep;
    for (let i = 0; i < 7; i++) {
      const child = makeProject("Child");
      p.inputs = [makeLayer({ type: "composition", mix: child })];
      p = child;
    }
    expect(() => contentCandidate(deep, true)).toThrow();
    expect(JSON.stringify(root)).toBe(before);
  });

  it("keeps portable assets and renders identical preview audio after save/reopen", () => {
    const { root, candidate, address } = fixture();
    const next = replaceContent(root, address, candidate);
    const reopened = parseProject(
      JSON.parse(JSON.stringify(projectForSave(next))),
    );
    expect(reopened.assets[candidate.player.assetId!].source).toEqual(
      candidate.assets[candidate.player.assetId!].source,
    );
    expect(renderProject(next, 12000).left).toEqual(
      renderProject(reopened, 12000).left,
    );
    expect(renderProject(next, 12000).right).toEqual(
      renderProject(reopened, 12000).right,
    );
  });

  it("accepts only the new document structure, with content inside each layer", () => {
    const { root } = fixture();
    for (const schema of ["momo.soundforge/v1", "momo.soundforge/v2"])
      expect(() => parseProject({ ...root, schema })).toThrow();
    expect(() =>
      parseProject({
        ...root,
        inputs: [{ ...root.inputs[0], player: undefined }],
      }),
    ).toThrow();
    expect(root.schema).toBe("momo.soundforge/v4");
    expect(() =>
      parseProject({
        ...root,
        inputs: [{ ...root.inputs[0], cutoff: 16000 }],
      }),
    ).toThrow();
  });
});
