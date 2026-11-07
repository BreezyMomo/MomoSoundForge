import { describe, expect, it } from 'vitest';
import { createTrack } from '../src/createTrack';
import { makeProject, parseProject, projectForSave } from '../src/model';
import { bindDefinition, noteTrackDefinition } from '../src/soundDefinitions';
import { BASIC_SYNTH } from '../src/synthesizers';
import { renderProject } from '../src/engine';
import { packProject, unpackProject } from '../src/resourcePackage';

describe('empty tracks and groups', () => {
  it('keeps an empty group and nested unbound note track through saving and rendering', async () => {
    const group = createTrack(makeProject('test'), [], 'group', 'group');
    const track = createTrack(group.root, [group.id], 'notes', 'notes');
    expect(group.root.inputs[0].player.mix!.inputs).toHaveLength(0);
    const restored = await unpackProject(await packProject(track.root));
    const layer = restored.inputs[0].player.mix!.inputs[0];
    expect(layer.id).toBe(track.id);
    expect(layer.player.score).toMatchObject({ instruments: [], notes: [] });
    expect(renderProject(restored, 6000).left.every(v => v === 0)).toBe(true);
  });
  it('binds a synth to an empty track and preserves notes and timing on replacement', () => {
    const { root, id } = createTrack(makeProject('test'), [], 'notes', 'notes');
    const definition = noteTrackDefinition(BASIC_SYNTH);
    let bound = bindDefinition(root, id, definition);
    const layer = bound.inputs[0];
    layer.player.score!.notes.push({ id: 'note', instrumentId: definition.instrument.id, midi: 60, velocity: 90, articulation: 'normal', start: 0, duration: 1 });
    const before = renderProject(bound, 6000).left;
    expect(before.some(v => v !== 0)).toBe(true);
    bound = bindDefinition(bound, id, noteTrackDefinition(BASIC_SYNTH));
    expect(bound.inputs[0].player.score!.notes[0]).toMatchObject({ id: 'note', midi: 60, duration: 1 });
    expect(bound.inputs[0].duration).toBe(layer.duration);
    expect(renderProject(parseProject(projectForSave(bound)), 6000).left).toEqual(before);
  });
});
