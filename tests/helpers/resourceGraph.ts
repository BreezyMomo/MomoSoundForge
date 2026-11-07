import {openResourceGraph} from '../../src/resourceGraph';
import {resourceProject} from '../../src/soundResources';
export async function projectFromGraph(raw:unknown){return resourceProject((await openResourceGraph(raw)).resource);}

import {readFileSync} from 'node:fs';
import {createSamplePreparer} from '../../src/prepareSamples';
export const prepareTestProject=createSamplePreparer(async url=>new Response(readFileSync('public/sound-library/'+url.split('/').at(-1))),'/');
