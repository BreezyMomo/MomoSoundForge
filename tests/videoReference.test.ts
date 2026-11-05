import { describe, it, expect } from 'vitest';
import { frameIndex, stepFrame, validateVideoReference } from '../src/videoReference';
import { parseProject, projectForSave } from '../src/model';
import { fromPreset } from '../src/presets';
const reference = () => ({name:'action.mp4',size:1024,duration:30,start:12,end:14,markers:[{id:'hit',name:'命中',time:.35}]});
describe('video reference', () => {
  it('steps across actual variable frame timestamps in both directions', () => {
    const times=[0,.033,.067,.117,.133];
    expect(frameIndex(times,.08)).toBe(2);
    expect(stepFrame(times,.067,1)).toBe(.117);
    expect(stepFrame(times,.117,-1)).toBe(.067);
    expect(stepFrame(times,0,-1)).toBe(0);
    expect(stepFrame(times,.133,1)).toBe(.133);
    expect(stepFrame(times,.15,-1)).toBe(.133);
    expect(stepFrame(times,.08,-1)).toBe(.067);
  });
  it('rejects unbounded and malformed external references', () => {
    for(const patch of [{duration:Infinity},{size:100*1024*1024},{start:-1},{end:31},{markers:Array(65).fill({id:'x',name:'x',time:1})},{markers:[{id:'x',name:'x',time:NaN}]}])
      expect(()=>validateVideoReference({...reference(),...patch})).toThrow();
  });
  it('round-trips alignment and named markers without requiring a local video path', () => {
    const p={...fromPreset('ice','Ice',k=>k),videoReference:reference()};
    const saved=parseProject(JSON.parse(JSON.stringify(projectForSave(p))));
    expect(saved.videoReference).toEqual(reference());
    expect(saved.layers).toEqual(p.layers);
  });
});
