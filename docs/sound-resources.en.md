# Sound resources and local libraries

[简体中文](sound-resources.md) · [User guide](user-guide.en.md)

## Resource types and workflow

Recordings are individual audio sources with original pitch, tuning and gain. Synthesizers contain generating algorithms, parameter declarations and defaults. Instruments contain names and note mappings to recordings or synthesizer snapshots, without melodies. Music/sound resources contain editable recordings, synth instances, scores, compositions and effects. Instances in a work are independent of library updates, deletion and folder switching.

Recordings and synthesizers are sound sources; instruments are named note-to-source definitions. No instrument-package type is exposed. Every factory recording has its own item, with pitch, strength and take labels, deduplicated by audio asset. The default source view reports the total count, searches all resources and loads 48 cards at a time through Show more. Use the type filter to browse instrument definitions separately.

Open **Sound resources** or **Manage resources** in the sidebar. Both views show the same built-in and local resources, searchable by type, source, category and name, with favorites and recent use. Cards offer **Create with synthesizer**, **Write notes with instrument**, or **Add to work**. Factory instruments retain their existing recording ranges.

Under **Manage resources**:

1. **Create / open local library…** selects a folder. An empty folder receives a new index; an existing index is validated first.
2. **Import recording…** adds one audio source. Select the actual original pitch of a single-note recording, or leave it unpitched to keep original speed. There is no automatic pitch detection. **New synthesizer** offers the basic oscillator or a custom numeric sound expression with parameters, defaults and preview.
3. **New instrument** shows all notes from C-1 to G9 in one continuously scrolling list, with each note appearing once and its source on the right. There are no range switches, groups or jump controls. Click **Add sound source** for an empty note, or an existing source name to change it. The shared library offers built-in and local recordings and synthesizers. Its **Add sound source** shortcut reuses normal library creation/upload/import; a successful save automatically assigns the source to the target note. Rows have audition buttons. Shared ranges, strength and playing style remain under collapsed **More settings**.
4. **Start blank music / sound** opens a work for composition; **Create music / sound from audio…** opens an imported recording for review and saving or insertion.
5. **Save current work as resource** captures the entire current work. Explicitly select an existing sound as the save destination to publish a new version, or save as a new resource. Layer selection does not silently change the save scope.

A synthesizer creates a configurable generated sound. An instrument creates an empty score; add melody notes afterward. Editing factory resources creates personal copies. Closing with unsaved edits opens a centered confirmation. Keep editing or Escape preserves the draft; Discard changes and close exits only the current editor.

An individual assignment changes only its note. Existing shared ranges stay intact; removing the individual setting restores shared coverage. Synthesizers retain generator snapshots. Recordings retain their original audio, pitch, tuning and gain. Assigning C3 audio to C4 transposes it up an octave, with a row label explaining the source pitch. Unpitched recordings keep their original speed, including shared key ranges. Library updates and deletion do not alter embedded copies. Canceling selection/creation leaves mappings unchanged. If a new resource saves successfully but assignment fails, the saved source is retained with a message to select it again.

Instrument auditions are controlled per row. The playing row shows Stop; choosing another note switches the audition, and completion restores Play. The footer contains save, export and composition actions, without global Preview/Stop buttons.

## Folder storage and migration

```text
My sound library/
  index.json
  resources/
    <resourceID>-v<version>-<SHA256>.sfresource
```

The `momo.sound-library/v1` index contains library identity and metadata/preview arrays. Saving/importing an instrument also saves its recordings and synthesizers as independent library entries. Matching audio/settings reuse existing entries. Deleting an instrument retains its sources, while embedded snapshots keep works portable and stable. Older folder libraries offer Add older instrument sources to the library, which adds sources/index metadata without changing instrument files or versions.

Each `momo.sound-resource/v1` JSON file contains all algorithms, definitions and recordings required for editing. Saves write and read-verify a new package before publishing the index. Version conflicts are rejected; browser locks serialize writes and commits recheck the index and folder connection. Deletion confirms and removes only that resource's tool-owned files. There is no trash or version-history browser.

Closing a library disconnects it. Switching folders does not copy or merge resources. IndexedDB stores folder connections and work drafts; ordinary resource reads/writes never fall back to the old browser stores. Folder access requires desktop Chrome/Edge; embedded browser support depends on its host. Reauthorize expired access. Back up by copying the folder or exporting packages. Opening the same folder from another origin reads the same resources.

**Migrate old browser resources** imports legacy sounds and definitions, verifies each round trip, and retains originals as backup. Stable migration IDs make retries idempotent; differing content is reported as a conflict. Legacy originals are not a second editable library.

Each package is limited to 40 MiB. Existing decoded recording, note, nesting and layer limits still apply. Indexes allow 2000 resources and 4 MiB. Remote-provider identity and reading interfaces are reserved; remote subscription, fetching, updating and synchronization are not implemented.

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
