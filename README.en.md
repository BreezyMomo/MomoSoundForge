# MomoSoundForge

[简体中文](README.md) · [English](README.en.md)

Create layered game sound effects in your browser using procedural synthesis and local samples. Audio processing and project storage run on your device; no account or online inference service is required.

## Run locally

Requires Node.js 22 or later.

```powershell
npm ci
npm run dev
```

Open the printed local URL, normally `http://127.0.0.1:5180/`, or double-click `start.bat` on Windows. The pinned `@momo/workbench` package is included in `vendor/`; sibling Momo repositories are not required.

```powershell
npm test
npm run build
npm run preview
```

`dist/` is a static site. Serve it over HTTP/HTTPS rather than opening its HTML directly.

## Included in v0.1

- Eight editable presets: crystal impact, UI confirm, UI deny, sparkle pickup, laser shot, energy charge, air whoosh and deep explosion.
- Up to 16 direct layers per sound, using synthesis, samples or editable nested sounds, with mute, solo, duplicate, delete and variation locks.
- Group a tuned sound into one layer, or embed another saved project. Up to six nesting levels and 128 layers across the entire project.
- Sine, triangle, sawtooth, square and white noise; exponential frequency sweeps, fades, decay, low-pass filtering, saturation, gain and pan.
- Browser-supported audio import, source offset, speed/pitch adjustment, reverse and envelopes. The first two channels are retained. Maximum 30 seconds per sample and 24 MiB of decoded sample data per project.
- 0.1–10 second projects, layered timing, master gain, echo, loop playback and a separate monitor level.
- Five seeded variations with audition and apply controls. ZIP exports include five WAVs, five editable projects and a seed manifest.
- 48 kHz, 16-bit stereo PCM WAV. Playback, final waveform and export use the same render.
- `.soundforge` projects with all nested sounds and used samples embedded, legacy project import, IndexedDB drafts, undo and redo.
- A local library of editable sounds with waveform previews, search, audition, opening, insertion as composition layers, updates and separate copies. Removed sounds can be restored.
- Shared MomoWorkbench docking, saved layouts, themes and Chinese/English UI. Narrow screens use workspace tabs.

## Workflow

1. Find a sound in the library. Use Open to edit for a standalone project, Add to current for a composition layer, or its play button to audition it.
2. Select a layer and adjust its source, pitch, timing, envelope and processing. The play button between its name and waveform auditions that layer from its own start for its own duration, skipping the timeline lead-in. Click again to stop; loop mode repeats only that layer. Auditioning leaves project timing, mute and solo settings unchanged.
3. Add synth layers or import samples.
4. Set variation seed and amount, then generate five variations. Locked layers preserve their parameters and noise seeds. A zero amount produces identical audio.
5. Save the editable project or export a final WAV.

Times are in seconds. Effect tails extend automatically beyond authored content. Loop playback repeats the project; it does not author seamless loops. Sample speed also changes pitch; independent time stretching is not implemented.

Drag the middle of a timeline clip to move it, or its edge handles to resize it. Moving preserves duration; the left handle preserves the end, and the right handle preserves the start. Adjustments use 0.01-second steps, or 0.001 seconds while holding Shift. Focus a clip or handle and use the left/right arrow keys for keyboard adjustment. Releasing updates the properties and audio with one undo step per drag. Escape or pointer cancellation discards the gesture. Resizing changes layer duration; sample playback speed remains a separate parameter.

If the mix exceeds full scale, both channels receive one shared gain reduction. Its amount is shown in the editor. Monitor level affects playback only. Layer thumbnails show audio before mixing; the main waveform represents the final output.

Drafts belong to the current browser and origin. Download a complete project for backup or transfer. Browser data deletion can remove drafts. Preset loads, project imports and layer deletion support undo. History holds up to 50 steps and does not survive a reload. Layout, language, theme and monitor level are not part of sound projects.

The mix waveform has a persistent playhead. Click the waveform or ruler, or drag the playhead, to seek. The current time shows milliseconds. Pause retains the position; playback resumes there. Seeking during playback resumes when released. Back to start jumps to zero. With the waveform focused, arrow keys adjust by 0.01 seconds, Shift by 0.001 seconds, and Home/End jump to the boundaries. The playhead is not part of project data or undo history; exports always include the whole project.

Shortcuts: Space to play/pause; Ctrl/Cmd+Z to undo; Ctrl/Cmd+Shift+Z to redo; Ctrl/Cmd+S to save. Text fields retain normal editing shortcuts.

## Use the sound library

The library includes 164 sounds: 8 synthesized presets, 40 CC0 sound-effect samples, 106 instrument samples and 10 editable layered or music examples. Filter by piano and keys, strings, woodwinds, brass, percussion and other categories, or search with Chinese and English keywords. Audition, add or open a sound directly without importing a file first. Factory entries and the copies you open or add remain independent.

Before development and production builds, the bundled resources are generated from the versioned sample collection. They ship with the build and load one sound at a time. `public/sound-library/` is generated; source and CC0 notices ship with it. The instruments provide prototype coverage, not a full-range automatic MIDI instrument player; project duration and sample budgets still apply.

Instrument entries use a trimmed default playback range with a fade at the end. Piano entries detect a continuous quiet interval after the note decays, excluding long noise beds and isolated late recording sounds; other instruments retain sustained playing and natural resonance. Complete samples remain embedded. Source WAVs and existing projects are preserved.

After tuning a sound, choose **Save to library** beside the editor title, name it and save. Its card appears in the unified sound list, retaining the current sound's layers, nested sounds, parameters and samples. Saving to the library always stores the complete work.

Use the card's play button to audition it, **Open to edit** to open it as a full project, or **Add to current** to insert it as a composition layer in the sound you are editing. Saving the same name offers **Update saved sound** or **Save a copy**. Library originals, opened projects and inserted compositions are independent. Save back to the library to update an original.

The card's additional actions include Rename, Export project and Remove sound. Removed sounds remain in **Recently removed** and can be restored. The library persists across reloads in the current browser and origin. Use **Export project** for backup or transfer; open the project on another device and save it to that device's library.

## Compose and reuse sounds

The layer area is an expandable node tree. Select siblings with Ctrl / Shift and choose **Group selected nodes**. Drag the six-dot grip on the left: row edges reorder and group centers nest. An insertion line or group highlight shows the destination. Esc cancels, Alt + arrows on a focused grip reorder, and the destination selector remains available. Moving across groups preserves absolute timing. Unbind macro mappings before moving or grouping affected nodes.

Each sound and group has **Post-processing**. Children are processed first, mixed, then processed by their group. Group all nodes when you want a shared effect. The document root is neutral; final peak protection runs once. Before/after audition bypasses only the selected node, retaining child effects and leaving exports unchanged.

Group durations follow child content. Groups can be moved; stretch and crop individual sound nodes. Pale extensions represent automatic effect tails, included in audition and default export. Each effect tail is limited to four seconds with a fade and notice at the limit; overall rendering also has length and resource budgets.

Row playback starts at the node and includes its descendants and effects, excluding ancestors. Top playback and export always use the complete work. Playheads, snapping, multiselection movement, undo and variation locks remain available. Collapse and before/after states are not saved or recorded in undo.

**Embed sound** inserts an editable copy with nested groups and samples. **Save project**, Ctrl/Cmd+S and **Save to library** save the complete work. Inside a group, **Save this sound** saves that group with its effects.

Limits: 16 direct nodes per scope, six nesting levels, 128 total nodes and 24 MiB of decoded samples. During development, legacy processing and timing semantics are not guaranteed.

## Current boundaries

This version focuses on short sound effects. It does not include music sequencing, speech generation, online AI models, MCP, video synchronization, plugin hosting or game engine runtime integration.

The synth is a lightweight procedural implementation. Sawtooth and square waves may alias at high pitches. Sound quality and suitability should be refined through listening in actual games. Imported material keeps its source licensing.

## Source map

- `src/model.ts`: project format, validation, sample encoding and variation generation.
- `src/engine.ts`: deterministic DSP and WAV encoding.
- `src/render.worker.ts`: background audio rendering.
- `src/App.tsx`: editing, playback, files and variation delivery.
- `src/Workbench.tsx`: shared workbench integration.
- `src/SoundLibrary.tsx`: presets, saved sounds and library interactions.
- `src/storage.ts`: persistent local drafts and sound library.
- `tests/engine.test.ts`: presets, reproducibility, mixing, sample round-trips and WAV checks.
- `tests/compositions.test.ts`: nesting, independent edits, legacy migration, sample round-trips and recursive resource limits.
- `tests/storage.test.ts`: draft migration, library snapshots, updates, restoration and failed-transaction rollback.

The unified sound list supports search, All / Favorites / Recent filters, collapsible categories, and list / waveform-grid views. Favorites and the latest 24 played, added or opened sounds are local preferences outside project history. Choose a category when saving or renaming; older saved sounds start uncategorized.

Outer clip edges stretch the complete waveform with a corresponding pitch change. Enable Crop above the layers to reveal two internal handles on the selected clip. Cropped regions remain visible in gray and contribute no audio; the clip frame and later layers stay in place. Drag the handles back or choose Restore full clip to recover the content. Stretching preserves crop proportions. Both operations support undo and are saved with projects and library snapshots.

## Sample instruments and note parts

Use **Add instrument part** to create a playable multi-sample part. Import a portable `.sfinstrument` package, then add notes or import a `momo.note-events/v1` / `melody-design/recipe-v1` JSON file. Notes expose MIDI pitch, beat position, duration, velocity, instrument and articulation; BPM converts beats to seconds. Sample mapping supports key/velocity zones, deterministic round robin, verified sustain loops and recorded release samples. Missing coverage is silent with an explicit notice.

Open `examples/instruments/flute/phrase.soundforge` for an editable five-note example using 18 real VSCO 2 CE flute recordings (CC0). The matching WAV, portable instrument, event JSON and conversion provenance are included. See [instrument format and integration guide](docs/instruments.md). The 10-second project window and 24 MiB decoded asset budget remain in force. This is a note-event editor, not a full MIDI sequencer or a general SFZ engine; pitch shifting uses ordinary resampling.
