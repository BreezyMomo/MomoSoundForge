# MomoSoundForge user guide

[简体中文](user-guide.md) · [English](user-guide.en.md) · [Home](../README.en.md)

Create layered game sound effects in your browser using procedural synthesis and local samples. Audio processing and project storage run on your device; no account or online inference service is required.

## Track selection and compact notes

Instrument tracks show a compact note thumbnail by default. Click Notes or double-click an instrument clip to expand the piano roll; Collapse all returns to compact tracks.

Ctrl / Cmd-click toggles selection and Shift-click selects a contiguous range of sibling tracks. A plain click selects one clip. Click empty timeline space or press Esc to clear selection; during a drag, Esc cancels that drag. Drag a selected clip to move the selection together, preserving spacing at project boundaries. Hold Shift while dragging to disable snapping temporarily.

## Product goal

Help game developers without audio expertise create good-sounding everyday effects they can use directly in their games. Learn from mature sound tools and adapt their capabilities through scenario presets, intuitive descriptions, macro controls and useful defaults, while preserving room for detailed editing. An optional professional mode is a future direction.

See [Product goals and design principles (Chinese)](product-vision.md) for the full direction and decision criteria for future AI work. This section describes the long-term goal; implemented features are listed below.

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

After building, run `node tools/audit-builtin-library.mjs` to write `test-results/builtin-audit.json`. It checks each entry's engine output, file checksum and embedded recordings. Outputs below −36 dBFS peak or −42 dBFS in their loudest 100 ms RMS window are flagged. Standalone notes additionally target −20 dBFS active RMS when boosting, with a −6 dBFS peak ceiling, so merely avoiding near-silence is insufficient. Quiet raw velocity layers are reported separately, never individually normalized. Level checks do not replace listening review.

Legacy standalone notes restore authored gain, then receive an audible default level per independent library entry. Performance character and note velocity control remain, but separate standalone entries no longer preserve the original soft/loud level differences. Original WAV files are unchanged. Multisample velocity layers and mappings remain intact; an unusually quiet default note is replaced with an audible nearby root in the same range. Library generation rejects quiet defaults. Updates affect newly opened or added factory resources, not independent copies already saved in user projects.

## Included in v0.1

- Eight editable presets: crystal impact, UI confirm, UI deny, sparkle pickup, laser shot, energy charge, air whoosh and deep explosion.
- Up to 16 direct layers per sound, using synthesis, samples or editable nested sounds, with mute, solo, duplicate, delete and variation locks.
- Group a tuned sound into one layer, or embed another saved project. Up to six nesting levels and 128 layers across the entire project.
- Sine, triangle, sawtooth, square and white noise; exponential frequency sweeps, fades, decay, low-pass filtering, saturation, gain and pan.
- Browser-supported audio import, source offset, speed/pitch adjustment, reverse and envelopes. The first two channels are retained. Up to 5.76 million samples per channel and 24 MiB of decoded sample data per project.
- Projects default to 10 seconds with user-defined duration, layered timing, master gain, echo, loop playback and a separate monitor level.
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

Times are in seconds. Preview and default export use the work duration. Extend to content end to retain effect tails, or use the loop-authoring controls for crossfaded loops. Sample speed also changes pitch; independent time stretching is not implemented.

Drag the middle of a timeline clip to move it, or its edge handles to resize it. Moving preserves duration; the left handle preserves the end, and the right handle preserves the start. Adjustments use 0.01-second steps, or 0.001 seconds while holding Shift. Focus a clip or handle and use the left/right arrow keys for keyboard adjustment. Releasing updates the properties and audio with one undo step per drag. Escape or pointer cancellation discards the gesture. Resizing clip edges changes both playback speed and pitch; independent pitch-preserving time stretching is not implemented.

If the mix exceeds full scale, both channels receive one shared gain reduction. Its amount is shown in the editor. Monitor level affects playback only. Layer thumbnails show audio before mixing; the main waveform represents the final output.

Drafts belong to the current browser and origin. Download a complete project for backup or transfer. Browser data deletion can remove drafts. Preset loads, project imports and layer deletion support undo. History holds up to 50 steps and does not survive a reload. Layout, language, theme and monitor level are not part of sound projects.

The mix waveform has a persistent playhead. Click the waveform or ruler, or drag the playhead, to seek. The current time shows milliseconds. Pause retains the position; playback resumes there. Seeking during playback resumes when released. Back to start jumps to zero. With the waveform focused, arrow keys adjust by 0.01 seconds, Shift by 0.001 seconds, and Home/End jump to the boundaries. The playhead is not part of project data or undo history; exports always include the whole project.

Shortcuts: Space to play/pause; Ctrl/Cmd+Z to undo; Ctrl/Cmd+Shift+Z to redo; Ctrl/Cmd+S to save. Text fields retain normal editing shortcuts.

## Use the sound library

Rejected takes are deleted from the library and source files. `tools/builtin-quality.json` retains only the rejection reason to prevent reintroduction. The amplified F♯2 timpani lacked a clear drum attack; its original and working copies have been deleted. The timpani card and bundled examples now use C♯3, and the audition reel and distribution archive are cleaned as well. Review records distinguish listening feedback from signal measurements: passing level checks is not a sound-quality certification.

The library separates **Basic sounds**, **Combinations** and **My sounds**. Basic sounds contains 100 choices: 48 instrument/articulation combinations, 44 CC0 sound-effect groups and 8 synthesis presets. Instruments use 725 distinct recordings; sound effects use 106. Alternate recordings of the same action share one card with a Recording selector. Different actions, materials and impact strengths keep separate cards. Instruments are grouped by instrument and articulation, with ranges selected within the card. Browse the 24 editable combinations separately. Categories, bilingual search, favorites and recent items work within each section.

The new game SFX starter adds five footstep surfaces, punches and material impacts, doors and mechanisms, and blade actions, plus eight editable scene combinations. Defaults have trimmed playback ranges and matched levels; combinations retain their layers and controls such as Landing weight and Impact. Recordings come from two Kenney CC0 packs. Originals, licenses, archive paths and conversion details are retained in [the collection notes](../samples/game-sfx-starter-20261105/使用说明.txt).

The 682 usable recordings for piano, flute, violin section, cello section, horn and trumpet are available as 20 articulations across 88 selectable ranges. Each range retains its velocity layers and alternate takes, selected automatically when editing notes. Author mappings and remaining coverage gaps are preserved; see `samples/orchestra-expanded-20261105/coverage.json`.

Each new range uses at most 10 MiB of decoded samples. Long recordings use the first four seconds, disclosed on the card; shorter recordings remain complete. Note length and transposition must fit the available source; no unverified loops are enabled. Full originals remain in the source collection. Other instruments retain their existing individual takes. Bundled resources load on demand and projects embed their selected assets. Development and production builds generate `public/sound-library/` with source and CC0 notices. The total project sample budget remains 24 MiB.

After tuning a sound, choose **Save to library** beside the editor title, name it and save. Its card appears in the unified sound list, retaining the current sound's layers, nested sounds, parameters and samples. Saving to the library always stores the complete work.

Use the card's play button to audition it, **Open to edit** to open it as a full project, or **Add to current** to insert an editable instrument layer (for instruments) or a composition layer. Saving switches to My sounds. Saving the same name offers **Update saved sound** or **Save a copy**. Library originals, opened projects and inserted sounds are independent. Save back to the library to update an original.

The card's additional actions include Rename, Export project and Remove sound. Removed sounds remain in **Recently removed** and can be restored. The library persists across reloads in the current browser and origin. Use **Export project** for backup or transfer; open the project on another device and save it to that device's library.

## Compose and reuse sounds

The layer area is an expandable node tree. Select siblings with Ctrl / Shift and choose **Group selected nodes**. Drag the six-dot grip on the left: row edges reorder and group centers nest. An insertion line or group highlight shows the destination. Esc cancels, Alt + arrows on a focused grip reorder, and the destination selector remains available. Moving across groups preserves absolute timing. Unbind macro mappings before moving or grouping affected nodes.

Each sound and group has **Post-processing**. Children are processed first, mixed, then processed by their group. Group all nodes when you want a shared effect. The document root is neutral; final peak protection runs once. Before/after audition bypasses only the selected node, retaining child effects and leaving exports unchanged.

Group durations follow child content. Groups can be moved; stretch and crop individual sound nodes. Pale extensions represent automatic effect tails, included in audition and default export. Each effect tail is limited to four seconds with a fade and notice at the limit; overall rendering also has length and resource budgets.

Row playback starts at the node and includes its descendants and effects, excluding ancestors. Top playback and export always use the complete work. Playheads, snapping, multiselection movement, undo and variation locks remain available. Collapse and before/after states are not saved or recorded in undo.

**Embed sound** inserts an editable copy with nested groups and samples. **Save project**, Ctrl/Cmd+S and **Save to library** save the complete work. Inside a group, **Save this sound** saves that group with its effects.

Limits: 16 direct nodes per scope, six nesting levels, 128 total nodes and 24 MiB of decoded samples. During development, legacy processing and timing semantics are not guaranteed.

## Current boundaries

This version supports multivoice notes and piano-roll editing for game effects and short melodies. Realtime MIDI input, speech generation, online AI models, MCP, plugin hosting and game engine runtime integration are not implemented.

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

Open `examples/instruments/flute/phrase.soundforge` for an editable five-note example using 18 real VSCO 2 CE flute recordings (CC0). The matching WAV, portable instrument, event JSON and conversion provenance are included. See [instrument format and integration guide](instruments.md). The 10-second project window and 24 MiB decoded asset budget remain in force. This is a note-event editor, not a full MIDI sequencer or a general SFZ engine; pitch shifting uses ordinary resampling.

Preview, add or open instruments from the sound library. Each is a regular instrument node with notes, rhythm, velocity and sample mappings in the inspector; grouping, post-processing and saving to the library use the normal workflow.

## Video reference

Open Video reference in the header and import a local video. Select a start and segment length without a fixed seconds cap; sound time zero maps to the selected start. Frame steps use decoded presentation timestamps, including variable frame rates. Video shares the sound playhead, with synchronized and looping segment preview. Original audio defaults to muted and is excluded from exports. Named markers appear on the timeline and support clip snapping. Projects and drafts save alignment and markers; relink the original video after reopening (video bytes are not bundled). Videos must be playable by the browser and local decoder, up to 80 MB and 4K. Indexing is cancellable and time-bounded. The panel supports docking and floating.

### Work duration and resources

New project creates an empty 10-second work. Enter its duration below the timeline; Enter or blur applies the value. Clips, groups and notes can exceed 10 seconds. Zoom and horizontal scrolling support long timelines. Extend to content end includes rendered effect tails. Shortening the work preserves clips and notes outside the range and shows a notice. Preview, waveform and default export use the same work range; extra export tail time extends rendering explicitly.

There is no fixed creative duration cap. Layer counts, nesting, decoded assets and rendering allocations remain budgeted; exceeding a resource budget reports an error instead of silently truncating content. Rendering still uses complete buffers, not unlimited streaming. Superseded previews are cancelled; identical audio uses a bounded cache, including when only video markers or names change.

## Workspace layouts and shared controls

The Layout menu provides Sound design, Video sound design and Note editing layouts. Video sound design places the reference picture and sound timeline in the center. Note editing gives the piano roll its own main workspace, with instrument-track selection and project playback. Double-click a note in a track to open the note workspace; return to arrangement through its tab. Layouts, docking, panel visibility, language and appearance are browser preferences and do not change the project, notes or undo history.

Help and export use shared dialogs with contained Tab focus, Escape dismissal and focus restoration. Video and note toolbars use Workbench controls. Numeric fields allow incomplete text while editing and commit on Enter or blur; Escape cancels an uncommitted edit.
