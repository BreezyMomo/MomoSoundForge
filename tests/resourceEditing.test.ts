import {expect,it} from 'vitest';
import {createResourceDraft,changeResourceDraft,travelResourceDraft} from '../src/resourceDraft';
import {ProjectResourceOrigins,resourceOrigin} from '../src/resourceOrigin';
import {resourceFromProject} from '../src/soundResources';
import {makeProject,projectDocument} from '../src/model';

it('keeps independent undo/redo, discards redo after branching, and recognizes the saved baseline',()=>{
  const a=resourceFromProject(makeProject('A')),b={...a,name:'B'},c={...a,name:'C'};
  let h=createResourceDraft(a);
  h=changeResourceDraft(h,b);
  h={...h,baseline:h.present};
  h=changeResourceDraft(h,c,true); // Saving ends the text edit group.
  expect(h.past).toEqual([a,b]);
  h=travelResourceDraft(h);
  expect(h.present).toBe(h.baseline);
  h=travelResourceDraft(h);
  expect(h.present).toBe(a);
  expect(h.present).not.toBe(h.baseline);
  h=travelResourceDraft(h,true);
  expect(h.present).toBe(b);
  h=changeResourceDraft(h,{...a,name:'Other'});
  expect(h.future).toHaveLength(0);
  expect(a.name).toBe('A');
});

it('coalesces consecutive text edits and bounds resource history',()=>{
  const a=resourceFromProject(makeProject('A'));
  let h=changeResourceDraft(createResourceDraft(a),{...a,name:'B'});
  h=changeResourceDraft(h,{...a,name:'BC'},true);
  expect(h.past).toEqual([a]);
  for(let i=0;i<50;i++)h=changeResourceDraft(h,{...a,name:String(i)});
  expect(h.past).toHaveLength(30);
});

it('tracks save identity through edits and undo, but resets it for another opened work',()=>{
  const origins=new ProjectResourceOrigins(),initial=makeProject('Initial'),opened=makeProject('Local');
  const r=resourceFromProject(opened),origin=resourceOrigin(r,3);
  origins.inherit(initial,opened,origin);
  const edited={...opened,name:'Edited'};
  origins.inherit(opened,edited);
  expect(origins.get(edited)).toEqual(origin);
  origins.saved(edited,{...origin,version:2});
  expect(origins.get(opened)?.version).toBe(2); // Undo must not use an obsolete expected version.
  const other=makeProject('Other');
  origins.inherit(edited,other,null);
  expect(origins.get(other)).toBeUndefined();
  expect(origins.get(edited)?.destination).toBe(3);
  expect(projectDocument(edited)).not.toHaveProperty('origin');
  const copy={...origin,id:'copy',version:1};
  origins.saved(edited,copy);
  expect(origins.get(edited)?.id).toBe('copy');
  expect(origins.get(opened)?.id).toBe(r.id);
});
