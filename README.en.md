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
- Up to 16 synth or sample layers, with mute, solo, duplicate, delete and variation locks.
- Sine, triangle, sawtooth, square and white noise; exponential frequency sweeps, fades, decay, low-pass filtering, saturation, gain and pan.
- Browser-supported audio import, source offset, speed/pitch adjustment, reverse and envelopes. The first two channels are retained. Maximum 30 seconds per sample and 24 MiB of decoded sample data per project.
- 0.1–10 second projects, layered timing, master gain, echo, loop playback and a separate monitor level.
- Five seeded variations with audition and apply controls. ZIP exports include five WAVs, five editable projects and a seed manifest.
- 48 kHz, 16-bit stereo PCM WAV. Playback, final waveform and export use the same render.
- `.soundforge` projects with embedded used samples, IndexedDB drafts, undo and redo.
- Shared MomoWorkbench docking, saved layouts, themes and Chinese/English UI. Narrow screens use workspace tabs.

## Workflow

1. Choose a preset and press Play or Space.
2. Select a layer and adjust its source, pitch, timing, envelope and processing. The play button between its name and waveform auditions that layer from its own start for its own duration, skipping the timeline lead-in. Click again to stop; loop mode repeats only that layer. Auditioning leaves project timing, mute and solo settings unchanged.
3. Add synth layers or import samples.
4. Set variation seed and amount, then generate five variations. Locked layers preserve their parameters and noise seeds. A zero amount produces identical audio.
5. Save the editable project or export a final WAV.

Times are in seconds. Layers extending beyond the project duration are cut; the editor shows a warning. Leave enough room for echo tails. Loop playback repeats the project; it does not author seamless loops. Sample speed also changes pitch; independent time stretching is not implemented.

Drag the middle of a timeline clip to move it, or its edge handles to resize it. Moving preserves duration; the left handle preserves the end, and the right handle preserves the start. Adjustments use 0.01-second steps, or 0.001 seconds while holding Shift. Focus a clip or handle and use the left/right arrow keys for keyboard adjustment. Releasing updates the properties and audio with one undo step per drag. Escape or pointer cancellation discards the gesture. Resizing changes layer duration; sample playback speed remains a separate parameter.

If the mix exceeds full scale, both channels receive one shared gain reduction. Its amount is shown in the editor. Monitor level affects playback only. Layer thumbnails show audio before mixing; the main waveform represents the final output.

Drafts belong to the current browser and origin. Download a complete project for backup or transfer. Browser data deletion can remove drafts. Preset loads, project imports and layer deletion support undo. History holds up to 50 steps and does not survive a reload. Layout, language, theme and monitor level are not part of sound projects.

The mix waveform has a persistent playhead. Click the waveform or ruler, or drag the playhead, to seek. The current time shows milliseconds. Pause retains the position; playback resumes there. Seeking during playback resumes when released. Back to start jumps to zero. With the waveform focused, arrow keys adjust by 0.01 seconds, Shift by 0.001 seconds, and Home/End jump to the boundaries. The playhead is not part of project data or undo history; exports always include the whole project.

Shortcuts: Space to play/pause; Ctrl/Cmd+Z to undo; Ctrl/Cmd+Shift+Z to redo; Ctrl/Cmd+S to save. Text fields retain normal editing shortcuts.

## Current boundaries

This version focuses on short sound effects. It does not include music sequencing, speech generation, online AI models, MCP, video synchronization, plugin hosting or game engine runtime integration.

The synth is a lightweight procedural implementation. Sawtooth and square waves may alias at high pitches. Sound quality and suitability should be refined through listening in actual games. Imported material keeps its source licensing.

## Source map

- `src/model.ts`: project format, validation, sample encoding and variation generation.
- `src/engine.ts`: deterministic DSP and WAV encoding.
- `src/render.worker.ts`: background audio rendering.
- `src/App.tsx`: editing, playback, files and variation delivery.
- `src/Workbench.tsx`: shared workbench integration.
- `tests/engine.test.ts`: presets, reproducibility, mixing, sample round-trips and WAV checks.
