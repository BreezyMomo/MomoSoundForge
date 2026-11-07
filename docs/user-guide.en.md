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

## Layers and sound content

A work contains layers. Each layer has outer settings and replaceable content: synthesized sound, an audio clip, an instrument performance, or an editable combination. Instruments currently use recordings; notes describe the performance.

Open the **Sound** tab in layer properties to choose a synthesizer or instrument, edit notes, or **Replace content**. A combination's **Edit content** opens its internal timeline. Replacement accepts built-in recordings, combination examples, current group assets and local audio. A whole combination can become an audio clip, and an audio clip can become an editable combination. Synth and instrument layers can also receive those contents.

The property header shows the current layer's editable name, content type and containing mix. Four task tabs contain collapsible sections:

- **Sound**: source, synthesis or notes, sound shape and tone.
- **Playback**: placement and playback length in the current mix, source range, speed, looping and reverse.
- **Mix & FX**: the layer's level and position, plus effects belonging to its sound content.
- **Automation**: changes to volume, pan or low-pass frequency over playback time.

Tab and section preferences stay on this device, outside projects and undo history. Switching tabs preserves the note editor's current state.

Replacement retains name, placement, read range, speed, loop, playback length, volume, pan, mute/solo, variation lock and volume/pan curves. The new player replaces the old sound, children, notes and own effects; parent mix effects stay. Old content bindings and filter automation are removed. Out-of-range reads play silence without shortening the loop period. Fit to new sound length is an explicit action and preserves loop playback length. The work window stays fixed.

Audition in the full work before confirming. Cancel makes no document change; confirmation is one undoable edit. Group multiple layers before replacing them as a whole. Native documents use v4 with a root player; unpublished older formats are not supported. Built-in resources have been updated.

## Workflow

1. Find a sound in the library. Use Open to edit for a standalone project, Add to current for a composition layer, or its play button to audition it.
2. Select a layer and adjust its source, pitch, timing, envelope and processing. The play button between its name and waveform auditions that layer from its own start for its own duration, skipping the timeline lead-in. Click again to stop; loop mode repeats only that layer. Auditioning leaves project timing, mute and solo settings unchanged.
3. Add sound resources or import recordings.
4. Set variation seed and amount, then generate five variations. Locked layers preserve their parameters and noise seeds. A zero amount produces identical audio.
5. Save the editable project or export a final WAV.

Times are in seconds. Preview and default export use the work duration. Extend to content end to retain effect tails, or use the loop-authoring controls for crossfaded loops. Sample speed also changes pitch; independent time stretching is not implemented.

With a loop region set, the main Loop playback option repeats only the outlined range; without one it repeats the full work. Starting outside the range jumps to its start, and the playhead wraps there at the end. Turning looping off continues through the remaining work. Use the loop-authoring preview to hear the crossfaded seam.

Drag the middle of a timeline clip to move it, or its edge handles to resize it. Moving preserves duration; the left handle preserves the end, and the right handle preserves the start. Adjustments use 0.01-second steps, or 0.001 seconds while holding Shift. Focus a clip or handle and use the left/right arrow keys for keyboard adjustment. Releasing updates the properties and audio with one undo step per drag. Escape or pointer cancellation discards the gesture. Resizing clip edges changes both playback speed and pitch; independent pitch-preserving time stretching is not implemented.

If the mix exceeds full scale, both channels receive one shared gain reduction. Its amount is shown in the editor. Monitor level affects playback only. Layer thumbnails show audio before mixing; the main waveform represents the final output.

Drafts belong to the current browser and origin. Download a complete project for backup or transfer. Browser data deletion can remove drafts. Preset loads, project imports and layer deletion support undo. History holds up to 50 steps and does not survive a reload. Layout, language, theme and monitor level are not part of sound projects.

The mix waveform has a persistent playhead. Click the waveform or ruler, or drag the playhead, to seek. The current time shows milliseconds. Pause retains the position; playback resumes there. Seeking during playback resumes when released. Back to start jumps to zero. With the waveform focused, arrow keys adjust by 0.01 seconds, Shift by 0.001 seconds, and Home/End jump to the boundaries. The playhead is not part of project data or undo history; exports always include the whole project.

Shortcuts: Space to play/pause; Ctrl/Cmd+Z to undo; Ctrl/Cmd+Shift+Z to redo; Ctrl/Cmd+S to save. Text fields retain normal editing shortcuts.

## Use sound resources

The sidebar browses factory and local resources. Use **Manage resources** beside its search field to open the single management window for creation, imports and library connections. The default source view shows recordings and synthesizers; filter recordings, synthesizers, instrument definitions and music/sounds by type, source or category, with search, favorites and recent use. Each recording is a separate counted item, labeled with original pitch, strength and take. Instruments define note bindings. Search covers the entire library; Show more loads the next group of cards.

Use **Create with synthesizer**, **Write notes with instrument** or **Add to work**. Instrument insertion starts with an empty score. Resource management offers editing/export; local resources can be deleted. Library changes never update existing work instances.

**New instrument** starts with its name and note range, then source assignments. One assigned note is enough to compose; filling the range is optional. Audition or replace individual rows. Use **⋯** to add strength levels, styles or alternating takes, or fill other empty notes. Recording playback can follow note length or play through on trigger. Instrument edits have their own undo/redo history.

Open a local folder in **Manage resources** before saving personal resources. Create synthesizers, define instruments, import resource files or upload audio. **Save current work as resource** captures the whole work; explicitly select an existing sound to publish a new version or save a new resource. Packages and indexes are read-verified after writing. Factory resources and work editing remain usable without a connected folder.

Legacy browser sounds and definitions can be migrated to the folder, keeping originals as backup. Remote libraries, sync, trash and history browsing are not implemented. See [Sound resources and local libraries](sound-resources.en.md) for creation steps, formats and budgets.

## Compose and reuse sounds

The layer area is an expandable node tree. Select siblings with Ctrl / Shift and open **Selection** and choose **Group selected**. Drag the six-dot grip on the left: row edges reorder and group centers nest. An insertion line or group highlight shows the destination. Esc cancels, Alt + arrows on a focused grip reorder, and **Selection** also offers a destination selector with **Move to group**. Moving across groups preserves absolute timing. Unbind macro mappings before moving or grouping affected nodes.

Each sound and group has **Post-processing**. Children are processed first, mixed, then processed by their group. Group all nodes when you want a shared effect. The document root is neutral; final peak protection runs once. Before/after audition bypasses only the selected node, retaining child effects and leaving exports unchanged.

Groups also support crop, speed, loop and reverse. Edit a transformed group on its local timeline using Edit content. A full read includes the child’s effect tail; an explicit crop may truncate it. Each effect tail is limited to four seconds with a fade and notice at the limit; overall rendering also has length and resource budgets.

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

The unified sound list supports search, All / Favorites / Recent filters, collapsible categories, and list / waveform-grid views. Category buttons support multiple selections, showing sounds from any selected category. Click again to deselect; All clears the category filter. Collapse the category controls to save space; the heading still shows the selected categories. Favorites and the latest 24 played, added or opened sounds are local preferences outside project history. Choose a category when saving or renaming; older saved sounds start uncategorized.

Use **Display → Sound variants** to choose **Grouped** or **Expanded**. Grouped mode puts ranges or recordings of the same sound in one card; Expanded mode gives each option its own card for playback, favorites and insertion. This setting is saved in the current browser, outside the project and undo history.

Outer clip edges change playback speed and pitch. Enable Crop to edit the read range and occupied time using the lower handles; the original source and other layers remain intact. Read from/to in properties use seconds. Restore full clip reads the entire child output. For loops, the right crop handle changes occupied playback length; properties define the repeated read interval. Both operations support undo and persist in projects and library snapshots.

## Sample instruments and note parts

Use **Add instrument part** to create a playable multi-sample part. Import a portable `.sfinstrument` package, then add notes or import a `momo.note-events/v1` / `melody-design/recipe-v1` JSON file. Notes expose MIDI pitch, beat position, duration, velocity, instrument and articulation; BPM converts beats to seconds. Sample mapping supports key/velocity zones, deterministic round robin, verified sustain loops and recorded release samples. Missing coverage is silent with an explicit notice.

Open `examples/instruments/flute/phrase.soundforge` for an editable five-note example using 18 real VSCO 2 CE flute recordings (CC0). The matching WAV, portable instrument, event JSON and conversion provenance are included. See [instrument format and integration guide](instruments.md). The 10-second project window and 24 MiB decoded asset budget remain in force. This is a note-event editor, not a full MIDI sequencer or a general SFZ engine; pitch shifting uses ordinary resampling.

Preview, add or open instruments from the sound library. Each is a regular instrument node with notes, rhythm, velocity and sample mappings in the inspector; grouping, post-processing and saving to the library use the normal workflow.

## Video reference

Open Video reference beside Save to library in the work heading and import a local video. Select a start and segment length without a fixed seconds cap; sound time zero maps to the selected start. Frame steps use decoded presentation timestamps, including variable frame rates. Video shares the sound playhead, with synchronized and looping segment preview. Original audio defaults to muted and is excluded from exports. Named markers appear on the timeline and support clip snapping. Projects and drafts save alignment and markers; relink the original video after reopening (video bytes are not bundled). Videos must be playable by the browser and local decoder, up to 80 MB and 4K. Indexing is cancellable and time-bounded. The panel supports docking and floating.

### Work duration and resources

New project creates an empty 10-second work. Enter its duration below the timeline; Enter or blur applies the value. Clips, groups and notes can exceed 10 seconds. Zoom and horizontal scrolling support long timelines. Extend to content end includes rendered effect tails. Shortening the work preserves clips and notes outside the range and shows a notice. Preview, waveform and default export use the same work range; extra export tail time extends rendering explicitly.

There is no fixed creative duration cap. Layer counts, nesting, decoded assets and rendering allocations remain budgeted; exceeding a resource budget reports an error instead of silently truncating content. Rendering still uses complete buffers, not unlimited streaming. Superseded previews are cancelled; identical audio uses a bounded cache, including when only video markers or names change.

## Workspace layouts and shared controls

The Layout menu provides Sound design, Video sound design and Note editing layouts. Video sound design places the reference picture and sound timeline in the center. Note editing gives the piano roll its own main workspace, with instrument-track selection and project playback. Double-click a note in a track to open the note workspace; return to arrangement through its tab. Layouts, docking, panel visibility, language and appearance are browser preferences and do not change the project, notes or undo history.

Help and export use shared dialogs with contained Tab focus, Escape dismissal and focus restoration. Video and note toolbars use Workbench controls. Numeric fields allow incomplete text while editing and commit on Enter or blur; Escape cancels an uncommitted edit.

The Work duration and Loop range buttons below the mix waveform open compact settings popovers. Work duration displays milliseconds and offers Keep full sound; a truncation notice stays visible beside the buttons. Loop range contains start/end values and cursor shortcuts, with crossfade and audition under Seam processing. Drag waveform range edges to preview a change and release to commit one undo step; Escape or pointer cancellation discards it. Arrow keys adjust by 0.01 seconds, or 0.001 with Shift. Popover visibility is a UI preference and does not enter project data or undo history.

The Sound layers section has one compact toolbar for Crop, Snap, Duplicate selection, Delete selected, Selection, View and Editing help. Restore full clip appears only when the active layer is cropped; crop mode keeps a short instruction visible. Selection contains grouping, destination selection, alignment and numeric scaling. View contains timeline zoom, Fit width and Collapse all note editors. Shortcut and waveform explanations live in Editing help, while the processing state remains beside the heading with a tooltip. Opening these panels or changing view/snap preferences does not alter the project or undo history.

Selection (N layers) shows the selected count. Delete selected removes the selected sibling layers in one undo step, including nested contents of selected groups. Selection clears afterward. Delete is scoped to the sound layers area and ignores text fields, popovers and note editors. The inspector delete button still removes only the active layer.

Each layer row also has a trash icon that deletes only that row, independently of the current multi-selection. Nested child layers can be deleted individually, and Undo restores them.

## Nature ambience

Wind, rain & thunder and Birds & nature provide 20 working clips in eight groups, selected from 11 publisher originals. Rain is separated into water and ground surfaces; the publisher describes the three isolated thunder recordings as being without rain. Ambient loops use 10–12 seconds with processed cycle boundaries; bird calls and thunder events retain their attacks and natural tails. Multiple selections can come from one long recording. Forest morning, Rainstorm and Crickets by the stream are editable combinations. See [collection notes](../samples/nature-ambience-20261105/使用说明.txt) for originals, licensing, processing and source formats.


## Create synthesizers and instruments

Use **Sound resources → Manage resources**. Synthesizers can use the basic oscillator or a custom numeric expression with declared parameters. Instruments map recordings or synth snapshots to notes without storing melodies. Create an empty instrument score and write the performance in the note editor. Mapping edits update the resource draft directly; audition with the keyboard before saving.

Existing layers offer same-type resource selection. Timing and effects survive; instrument changes preserve notes. Cross-algorithm synth switches remove obsolete source-parameter macro mappings and cutoff automation, retaining start/gain/pan mappings. The work edit is undoable.

See [Sound resources and local libraries](sound-resources.en.md) for folder storage, detailed steps and AI imports.

Resource editors have independent undo/redo. Create, preview and use drafts without a library connection; choose a folder when saving. Instrument velocity layers and alternate takes have separate preview/replace rows. Works opened from a local resource default to saving a new version during the current session; Save as creates a new resource.
