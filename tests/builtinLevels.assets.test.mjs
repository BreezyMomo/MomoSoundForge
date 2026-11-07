import { projectFromGraph, prepareTestProject } from './helpers/resourceGraph';
import { expect, it } from 'vitest';
import { legacyInstrumentLevels, standaloneBoostDb } from '../tools/builtin-levels.mjs';
import { levels } from '../tools/audit-builtin-library.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseProject } from '../src/model';
import { renderProject } from '../src/engine';


it('renders the shipped timpani at usable default loudness and retains velocity control', async () => {
    const catalog = JSON.parse(readFileSync('src/data/builtin-catalog.json', 'utf8'));
    expect(catalog.sounds.some(s => s.id === 'instrument-17-timpani-1-Fs2-single-hit')).toBe(false);
    const sound = catalog.sounds.find(s => s.id === 'instrument-17-timpani-2-Cs3-single-hit');
    const project = await projectFromGraph(JSON.parse(gunzipSync(readFileSync(`public/sound-library/${sound.file}`))));
    const ready=await prepareTestProject(project);project.assets=ready.assets;
    const normal = renderProject(project);
    const measured = levels([normal.left, normal.right], normal.sampleRate);
    expect(measured.activeRmsDb).toBeGreaterThanOrEqual(-20.1);
    expect(normal.peak).toBeGreaterThan(.2);
    (project.inputs[0].player.score).notes[0].velocity = 50;
    expect(renderProject(project).peak / normal.peak).toBeCloseTo(.5, 4);
    (project.inputs[0].player.score).notes[0].velocity = 127;
    expect(renderProject(project).sourcePeak).toBeLessThan(.8);
});
