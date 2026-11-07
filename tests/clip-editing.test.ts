import { describe, expect, it } from "vitest";
import {
  makeLayer,
  encodeSamples,
  parseProject,
  projectForSave,
  type Project,
} from "../src/model";
import { renderProject } from "../src/engine";
import { adjustCrop, stretchClip, editClip, cropReference, boundedSelection } from "../src/timeline";

const project = (type: "synth" | "sample" | "composition"): Project => {
  const child: Project = {
    schema: "momo.soundforge/v4",
    name: "child",
    seed: 1,
    duration: 1,
    master: 0.5,
    echo: 0,
    assets: {},
    inputs: [
      makeLayer({
        id: "tone",
        duration: 1,
        frequency: 300,
        endFrequency: 900,
        gain: 0.4,
      }),
    ],
  };
  return {
    ...child,
    name: "test",
    duration: 2,
    inputs: [
      makeLayer({
        id: "clip",
        type,
        duration: 1,
        gain: 0.5,
        frequency: type === "synth" ? 300 : 440,
        endFrequency: 900,
        wave: "noise",
        ...(type === "composition"
          ? {
              player: {
                mix: child,
              },
            }
          : {}),
        ...(type === "sample"
          ? {
              player: {
                assetId: "sample",
              },
            }
          : {}),
      }),
    ],
    assets:
      type === "sample"
        ? {
            sample: {
              id: "sample",
              name: "test.wav",
              sampleRate: 8000,
              channels: [
                encodeSamples(
                  Float32Array.from(
                    { length: 8000 },
                    (_, i) => Math.sin(i * 0.13) * 0.3,
                  ),
                ),
              ],
            },
          }
        : {},
  };
};
describe("non-destructive crop and whole-clip stretch", () => {
  for (const type of ["synth", "sample"] as const) {
    it(`stretches the complete ${type} waveform instead of truncating it`, () => {
      const p = project(type),
        before = renderProject(p, 6000),
        layer = p.inputs[0];
      p.inputs[0] = {
        ...layer,
        ...stretchClip(layer, { start: 0, duration: 0.5 }),
      };
      expect(parseProject(projectForSave(p))).toEqual(p);
      const after = renderProject(p, 6000);
      expect(after.inputs.clip.length).toBe(3000);
      for (let i = 0; i < 3000; i++)
        expect(after.inputs.clip[i]).toBe(before.inputs.clip[i * 2]);
      p.inputs[0] = {
        ...p.inputs[0],
        ...stretchClip(p.inputs[0], { start: 0, duration: 1 }),
      };
      expect(renderProject(p, 6000).left).toEqual(before.left);
    });
    it(`crops the ${type} read range without changing the source`, () => {
      const p = project(type),
        before = renderProject(p, 6000);
      p.inputs[0] = {
        ...p.inputs[0],
        start: 0.2, duration: 0.6, sourceStart: 0.2, sourceEnd: 0.8,
      };
      const cropped = renderProject(p, 6000);
      expect(cropped.inputs.clip.length).toBe(3600);
      expect(cropped.left.slice(0, 1200).every((x) => x === 0)).toBe(true);
      expect(cropped.left.slice(4800).every((x) => x === 0)).toBe(true);
      expect(cropped.left.slice(1200, 4800)).toEqual(
        before.left.slice(1200, 4800),
      );
      expect(parseProject(projectForSave(p))).toEqual(p);
      p.inputs[0] = {
        ...p.inputs[0],
        start: 0, duration: 1, sourceStart: 0, sourceEnd: 1,
      };
      expect(renderProject(p, 6000).left).toEqual(before.left);
    });
  }
  it("keeps crop fractions through resizing and constrains internal handles", () => {
    const l = makeLayer({ duration: 1, sourceStart: 0.2, sourceEnd: 0.8 });
    const resized = { ...l, ...stretchClip(l, { start: 0.3, duration: 2 }) };
    expect(resized).toMatchObject({
      duration: 2,
      player: { duration: 1 }, sourceStart: 0.2, sourceEnd: 0.8, speed: 0.5,
    });
    expect(adjustCrop(l, "cropStart", 20).sourceStart).toBeLessThan(0.8);
    expect(adjustCrop(l, "cropEnd", -20).sourceEnd).toBeGreaterThan(0.2);
  });
  it("rejects invalid stored crop and source durations", () => {
    for (const patch of [
      { sourceStart: 0.9, sourceEnd: 0.2 },
      { sourceStart: NaN },
      { sourceEnd: Infinity },
      { speed: 0 },
      { speed: Infinity },
    ]) {
      const p = project("synth");
      Object.assign(p.inputs[0], patch);
      expect(() => parseProject(p)).toThrow();
    }
  });
});


describe('default edge trimming and retained-clip placement',()=>{
  it('takes source seconds 1–2 and moves them to zero with identical rendered samples',()=>{
    const p=project('synth');p.duration=5;
    const original=makeLayer({id:'clip',duration:3,wave:'noise',gain:0.4});
    p.inputs=[original];
    const full=renderProject(p,8000).inputs.clip;
    let clip={...original,...editClip(original,'end',-1,5)};
    clip={...clip,...editClip(clip,'start',1,5)};
    expect(clip).toMatchObject({start:1,duration:1,sourceStart:1,sourceEnd:2,speed:1});
    const moved={...clip,...editClip(clip,'move',-20,5)};
    p.inputs=boundedSelection([clip],['clip'],clip,moved,5);
    expect(p.inputs[0]).toMatchObject({start:0,duration:1,sourceStart:1,sourceEnd:2,speed:1});
    expect(cropReference(moved)).toMatchObject({start:-1,before:1,after:1});
    expect(renderProject(p,8000).inputs.clip).toEqual(full.slice(8000,16000));
    expect(parseProject(projectForSave(p))).toEqual(p);
    const restored={...moved,...editClip(moved,'end',20,5)};
    expect(restored).toMatchObject({sourceStart:1,sourceEnd:3,duration:2,speed:1});
  });
  it('trims reversed, sped-up clips without changing playback speed or source identity',()=>{
    const original={...makeLayer({id:'clip',duration:3,wave:'noise'}),reverse:true,speed:2,duration:1.5};
    const p={...project('synth'),duration:4,inputs:[original]};
    const full=renderProject(p,8000).inputs.clip;
    let clip={...original,...editClip(original,'start',0.25,4)};
    clip={...clip,...editClip(clip,'end',-0.25,4)};
    clip={...clip,...editClip(clip,'move',-10,4)};
    expect(clip).toMatchObject({start:0,duration:1,sourceStart:0.5,sourceEnd:2.5,speed:2});
    expect(cropReference(clip)).toMatchObject({before:0.25,after:0.25,start:-0.25});
    expect(renderProject({...p,inputs:[clip]},8000).inputs.clip).toEqual(full.slice(2000,10000));
    expect(clip.player).toBe(original.player);
  });
  it('extends loop occupation without changing its source window or speed',()=>{
    const clip={...makeLayer({duration:1}),loop:true};
    expect(editClip(clip,'end',2,5)).toEqual({duration:3});
  });
});
