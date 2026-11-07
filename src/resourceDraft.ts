import type { SoundResource } from './soundResources';

export type ResourceDraft = { past: SoundResource[]; present: SoundResource; future: SoundResource[]; baseline: SoundResource };
export const createResourceDraft = (resource: SoundResource): ResourceDraft => ({past:[],present:resource,future:[],baseline:resource});
export function changeResourceDraft(state:ResourceDraft, resource:SoundResource, coalesce=false):ResourceDraft {
  if(resource===state.present)return state;
  return {...state,past:coalesce&&state.present!==state.baseline?state.past:[...state.past,state.present].slice(-30),present:resource,future:[]};
}
export function travelResourceDraft(state:ResourceDraft, redo=false):ResourceDraft {
  const from=redo?state.future:state.past;
  if(!from.length)return state;
  return redo?{...state,past:[...state.past,state.present],present:from[0],future:from.slice(1)}:
    {...state,past:from.slice(0,-1),present:from.at(-1)!,future:[state.present,...state.future]};
}
