import type { Project } from './model';
import type { SoundResource } from './soundResources';

/** Session-only save destination, never embedded in a project or resource snapshot. */
export type ResourceOrigin = Pick<SoundResource,'id'|'version'|'category'|'description'> & { destination:number };
export const resourceOrigin = (r:SoundResource,destination:number):ResourceOrigin => ({id:r.id,version:r.version,category:r.category,description:r.description,destination});
export class ProjectResourceOrigins {
  private origins=new WeakMap<Project,ResourceOrigin>();
  get(project:Project){return this.origins.get(project);}
  inherit(previous:Project,next:Project,origin:ResourceOrigin|null|undefined=undefined){
    const value=origin===undefined?this.get(previous):origin;
    if(value)this.origins.set(next,value);
  }
  saved(project:Project,origin:ResourceOrigin){
    const previous=this.get(project);
    if(previous?.id===origin.id&&previous.destination===origin.destination)Object.assign(previous,origin);
    else this.origins.set(project,origin);
  }
}
