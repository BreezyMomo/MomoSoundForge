# Sound resources and local libraries

[简体中文](sound-resources.md) · [User guide](user-guide.en.md)

## Resource types and workflow

Recordings are individual audio sources with original pitch, tuning and gain. Synthesizers contain generating algorithms, parameter declarations and defaults. Instruments contain names and note mappings to recordings or synthesizer snapshots, without melodies. Music/sound resources contain editable recordings, synth instances, scores, compositions and effects. Instances in a work are independent of library updates, deletion and folder switching.

Recordings and synthesizers are sound sources; instruments are named note-to-source definitions. No instrument-package type is exposed. Every factory recording has its own item, with pitch, strength and take labels, deduplicated by audio asset. The default source view reports the total count, searches all resources and loads 48 cards at a time through Show more. Use the type filter to browse instrument definitions separately.

Open **Manage resources** beside the sidebar search field. Creation, imports and folder management live in this window; **More actions** on each card applies only to that resource. Both views show the same built-in and local resources, searchable by type, source, category and name, with favorites and recent use. Cards offer **Create with synthesizer**, **Write notes with instrument**, or **Add to work**. Factory instruments retain their existing recording ranges.

Under **Manage resources**:

1. **Create / open local library…** selects a folder. An empty folder receives a new index; an existing index is validated first.
2. **Import recording…** adds one audio source. Select the actual original pitch of a single-note recording, or leave it unpitched to keep original speed. There is no automatic pitch detection. **New synthesizer** offers the basic oscillator or a custom numeric sound expression with parameters, defaults and preview.
3. **New instrument** starts with a name and a lowest/highest note range (C4–C5 by default; existing instruments infer their mapped range). Assign at least one note to save or compose; filling every note is optional. **Unassigned only** helps find empty notes. Note names span their strength, playing-style and alternate-take rows. Click **Add sound source** or an existing source name to select a recording or synthesizer from the shared library. Its creation shortcut also supports drafts. Audition each row separately; **⋯** opens that row's optional controls.
4. **Start blank music / sound** opens a work for composition; **Create music / sound from audio…** opens an imported recording for review and saving or insertion.
5. **Save current work as resource** captures the entire current work. Works opened from a local resource default to a new version in the current session; Save as creates a new resource. Layer selection does not silently change the save scope.

A synthesizer creates a configurable generated sound. An instrument creates an empty score; add melody notes afterward. Editing factory resources creates personal copies. Closing with unsaved edits opens a centered confirmation. Keep editing or Escape preserves the draft; Discard changes and close exits only the current editor.

An individual assignment changes only its row for that note; other velocity layers are preserved. Existing shared ranges stay intact; removing the individual setting restores shared coverage. Synthesizers retain generator snapshots. Recordings retain their original audio, pitch, tuning and gain. Assigning C3 audio to C4 transposes it up an octave, with a row label explaining the source pitch. Unpitched recordings keep their original speed, including shared key ranges. Library updates and deletion do not alter embedded copies. Canceling selection/creation leaves mappings unchanged. If a new resource saves successfully but assignment fails, the saved source is retained with a message to select it again.

Instrument auditions are controlled per row. The playing row shows Stop; choosing another note switches the audition, and completion restores Play. The footer contains save, export and composition actions, without global Preview/Stop buttons.

### Extend an instrument as needed

One source initially responds to every velocity at different volumes; three strength levels are not mandatory. Velocity in a recording's name describes the original material. The row's **Trigger velocity** controls its assignment in this instrument.

- **Add strength level** splits the current band into two contiguous ranges. Existing sounds and takes stay in the softer range; choose a new source for the stronger range. Cancel leaves the mapping unchanged; one undo restores the whole operation.
- **Add alternate take** adds a source to the same note, strength and playing style. Repeated notes rotate deterministically. Row auditions isolate the selected take.
- **Add playing style** names a style such as plucked or short, then assigns a source. The note editor offers that style. Other notes do not acquire it automatically.
- **Use for other notes…** copies the note's entire performance set into empty notes in a chosen range. Existing assignments are skipped. Recordings transpose from their original pitch, synthesizers generate at the target pitch, and unpitched recordings keep their original speed. No new recordings or articulations are generated.
- **Recording playback** defaults to **Follow note length**, fading after note-off; short recordings are not automatically extended. **Play through on trigger** plays the recording to its end, ignoring note length and bypassing sustain loops and release samples. Those settings remain available when switching back. Parent crops and the work window can still cut playback short.

Narrowing a range cannot silently delete assigned sources. More settings retains shared ranges and precise velocity/gain controls, affecting every covered note. Extension actions reject ambiguous overlapping velocity mappings outside alternate groups; resolve them explicitly before copying so pitch priorities cannot silently select a different source.

## Folder storage

The v2 folder separates `index.json` (listings), `resources/*.sfresource` (listing manifests), `objects/*.json` (immutable definitions), and `audio/*.pcm.gz` (shared audio). Content IDs change with sound data, while names and attribution stay in metadata. Listing IDs and versions handle concurrent saves; they are not content IDs.

Saving an instrument creates independently usable source listings; opening an imported package does not. Repeated audio is stored once. Deleting a listing retains shared objects and snapshots, so other works and undo remain valid. There is no automatic garbage collection.

Downloaded `.sfresource` and `.soundforge` files are ZIP packages containing the complete dependency closure, including unused instrument notes. They differ from the folder's small listing manifests. IndexedDB caches shared compressed audio for open works and drafts; keep packages or the whole folder as durable backups.

Legacy files and libraries are unsupported before release. Packages allow 768 MiB compressed and 1.5 GiB complete PCM dependencies; active rendering keeps its 24 MiB PCM budget. See [the immutable resource specification](immutable-resource-architecture.md).

## Custom synthesizers

`oscillator-v1` retains the existing oscillator behavior. `expression-v1` uses the same `momo.synth/v1` container and adds a `program` with `expression` and `parameters`. Example:

```text
sin(2*pi*phase + brightness*sin(6*pi*phase)*exp(-3*t))
```

Declare `brightness` with a stable variable, display name, minimum, maximum, step and default. Instance values remain separate from the library definition.

Variables: `t` (seconds), accumulated `phase` (0…1), `frequency` (Hz), `duration` (seconds), `velocity` (0…1), `pi`. Numeric literals, parentheses and `+ - * /` are supported, with `sin`, `cos`, `tanh`, `abs`, `exp`, `sqrt`, `floor`, `fract`, `min`, `max`, `pow`, `clamp`, and seeded `noise()`.

Finite output is clamped to −1…1 and enters the existing envelope, filter, drive and processing chain. Limits: 2048 characters, 256 tokens, 128 operations, depth 16, 16 parameters and a whole-render operation budget. This is not JavaScript; properties, assignments, loops, external access, custom state feedback and plugin code are unsupported. New analytic formulas such as FM, additive harmonics and noise combinations are supported. There is no visual node graph or real-time streaming performance. Preview, waveforms and exports share the renderer; fixed seeds reproduce. Automated checks do not establish subjective sound quality.

Synth instrument regions inline `synth` and optional `synthValues`, with `assetId: ""`. Notes supply pitch/velocity and regions supply release duration. Recording regions retain their existing mapping, release and verified loop capabilities. Arbitrary recursive players are not allowed as note sources.

## Import and AI authoring

**Import resource file…** accepts `.sfresource`, `.sfsynth`, `.sfinstrument` and `.soundforge`. Review and preview before saving. Matching IDs never silently overwrite; save as a new resource or edit the local original.

Resource headers contain `schema`, stable `id`, positive `version`, `name`, `kind` (`recording`, `synth`, `instrument`, `sound`), `category`, `description`, `preview` (up to 160 finite −1…1 values) and `payload`. Recording payloads use `{schema:"momo.recording/v1",asset:SampleAsset,rootMidi:number|null,tuneCents,gainDb,releaseSeconds,loop?}`. Null pitch produces a `fixedPitch:true` note mapping that keeps original speed. Other payloads contain the full synth definition, portable instrument definition, or native root-player project. Resource identity and internal definition identity remain separate; work instances carry snapshots. See [examples](../examples/resources/) and `sound_schema.resources` for complete structures.

```sh
node cli.mjs schema
node cli.mjs resource-validate --input fm-bell.sfsynth
node cli.mjs resource-pack --input fm-bell.sfsynth --out fm-bell.sfresource
node cli.mjs resource-render --input fm-bell.sfresource --out preview.wav
node cli.mjs resource-project --input fm-bell.sfresource --out editable.soundforge
```

Commands refuse to overwrite. Resource rendering creates temporary audition notes; instrument project creation produces an empty score. MCP `sound_resources` queries factory resources or explicitly requested local resources. `sound_import_resource` saves a NEW resource to the user-connected folder with a fresh work snapshot and current destination token; it cannot choose folders, overwrite resources or alter the work. `sound_edit` can insert `local:<ID>`. Web and AI inputs share validation and budgets.


## Verification scope

2026-11-07: 36 test files / 330 tests, production build and static deployment verification pass. Chrome verifies six separate C3 recordings, preview, recording pitch editing, C3-to-C4 binding and per-row audition. Audio upload, first folder permission and subjective listening quality were not revalidated.

## Resource editing updates (2026-11-07)

Creation, preview, export and use do not require a library connection; only saving to the library does. Draft sources can be assigned directly to instrument notes. Resource dialogs have independent undo/redo with up to 30 steps. Text inputs retain native text undo; elsewhere in the dialog use Ctrl/Cmd+Z, Shift+Z or Ctrl/Cmd+Y.

Instrument notes show separate rows for soft/hard velocity layers, playing styles and alternate takes. Each row previews and replaces its own sound, preserving its performance settings and neighboring notes. Shared ranges get per-note overrides, with overridden fallback rows hidden. Advanced controls can explicitly replace an entire shared region. Identical recording audio is stored once inside an instrument, with independent pitch/gain per mapping.

Opening a local music/sound resource remembers its save destination during this session. Saving the work defaults to a new version of that resource; Save as creates a new identity. New/imported projects and switching libraries start a new save destination. This provenance is not serialized and is not restored after reload. Version conflicts are still rejected.

When a search matches instruments hidden by the type filter, View instruments switches that filter while retaining the search and other filters.
