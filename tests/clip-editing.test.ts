import { describe, expect, it } from "vitest";
import { makeLayer, encodeSamples, parseProject, projectForSave, type Project } from "../src/model";
import { renderProject } from "../src/engine";
import { adjustCrop, stretchClip } from "../src/timeline";

const project = (type: "synth" | "sample" | "composition"): Project => {
  const child: Project = { schema: "momo.soundforge/v2", name: "child", seed: 1, duration: 1, master: 0.5, echo: 0, assets: {}, layers: [makeLayer({id:"tone", duration:1, frequency:300, endFrequency:900, gain:0.4})] };
  return { ...child, name:"test", duration:2, layers:[makeLayer({ id:"clip", type, duration:1, gain:0.5, frequency: type === "synth" ? 300 : 440, endFrequency:900, wave:"noise", ...(type === "composition" ? {project:child} : {}), ...(type === "sample" ? { assetId:"sample" } : {}) })], assets: type === "sample" ? {sample:{id:"sample",name:"test.wav",sampleRate:8000,channels:[encodeSamples(Float32Array.from({length:8000},(_,i)=>Math.sin(i*.13)*.3))]}} : {} };
};
describe("non-destructive crop and whole-clip stretch", () => {
  for (const type of ["synth", "sample"] as const) {
    it(`stretches the complete ${type} waveform instead of truncating it`, () => {
      const p = project(type), before = renderProject(p,6000), layer=p.layers[0];
      p.layers[0] = {...layer,...stretchClip(layer,{start:0,duration:0.5})};
      expect(parseProject(projectForSave(p))).toEqual(p);
      const after=renderProject(p,6000);
      expect(after.layers.clip.length).toBe(3000);
      for(let i=0;i<3000;i++) expect(after.layers.clip[i]).toBe(before.layers.clip[i*2]);
      p.layers[0]={...p.layers[0],...stretchClip(p.layers[0],{start:0,duration:1})};
      expect(renderProject(p,6000).left).toEqual(before.left);
    });
    it(`keeps the full ${type} preview while silencing the cropped regions`, () => {
      const p=project(type), before=renderProject(p,6000);
      p.layers[0]={...p.layers[0],cropStart:.2,cropEnd:.8};
      const cropped=renderProject(p,6000);
      expect(cropped.layers.clip).toEqual(before.layers.clip);
      expect(cropped.left.slice(0,1200).every(x=>x===0)).toBe(true);
      expect(cropped.left.slice(4800).every(x=>x===0)).toBe(true);
      expect(cropped.left.slice(1200,4800)).toEqual(before.left.slice(1200,4800));
      expect(parseProject(projectForSave(p))).toEqual(p);
      p.layers[0]={...p.layers[0],cropStart:0,cropEnd:1};
      expect(renderProject(p,6000).left).toEqual(before.left);
    });
  }
  it("keeps crop fractions through resizing and constrains internal handles", () => {
    const l=makeLayer({duration:1,cropStart:.2,cropEnd:.8});
    const resized={...l,...stretchClip(l,{start:.3,duration:2})};
    expect(resized).toMatchObject({duration:2,sourceDuration:1,cropStart:.2,cropEnd:.8});
    expect(adjustCrop(l,"cropStart",20).cropStart).toBeLessThan(.8);
    expect(adjustCrop(l,"cropEnd",-20).cropEnd).toBeGreaterThan(.2);
  });
  it("rejects invalid stored crop and source durations", () => {
    for(const patch of [{cropStart:.9,cropEnd:.2},{cropStart:NaN},{cropEnd:2},{sourceDuration:Infinity},{sourceDuration:11}]) {
      const p=project("synth");Object.assign(p.layers[0],patch);
      expect(()=>parseProject(p)).toThrow();
    }
  });
});

