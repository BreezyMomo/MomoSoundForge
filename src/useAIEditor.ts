import { packProject } from './resourcePackage';
import { prepareProjectSamples } from './prepareSamples';
import { projectDocument } from './model';
import { useEffect, useRef, useState } from 'react';
import { createAIConnection, type ConnectionStatus } from './aiConnection';
import { applyEdits, AUTHORING_SCHEMA, describeProject, projectScoreIssues, type EditOperation } from './aiAuthoring';
import { createRenderer } from './audio';
import { encodeWav } from './engine';
import { builtinSoundName, BUILTIN_SOUNDS, loadBuiltinSound } from './builtinLibrary';
import { PRESETS, fromPreset } from './presets';
import { download, safeFilename } from './storage';
import { listSavedSounds, readSavedSound, saveSoundToLibrary } from './localSoundStorage';
import { folderLibrary, libraryReady } from './folderLibrary';
import { importResource, resourceFromDefinition, resourceFromProject, resourceFromRecording, resourceProject, RESOURCE_BYTES } from './soundResources';
import { BASIC_SYNTH } from './synthesizers';
import { makeProject, makeLayer, encodeSamples, MAX_ASSET_BYTES, MAX_SAMPLE_FRAMES, uid, parseProject, projectForSave, updateProjectAtPath, type Project, type RenderResult } from './model';
import { isolatedNode, nodeParent, normalizeGroups } from './nodeTree';
import { reconcileAdvanced } from './advanced';
import { generateVariants, strictExportSettings } from './aiCapabilities';
import { renderExport } from './exportPipeline';
import { encodeAudio, AUDIO_MIME } from './encodeAudio';
import { type ExportSettings } from './exportAudio';
import { beforeSoundPolish } from './polishAudition';
import JSZip from 'jszip';
import { validateSampleSource } from './sampleSource';
import { t } from './i18n';
import { BUILTIN_RECORDINGS, loadBuiltinRecording } from './builtinRecordings';
import { pitchName } from './noteEditing';

export function bytesBase64(bytes: Uint8Array) {
  let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
type Props = { project: Project; commit: (expected: Project, next: Project) => void; undo: () => void; redo: () => void; ready: boolean; exportSettings: ExportSettings;
  publishVariants: (base: Project, items: { project: Project; result: RenderResult }[], path: string[]) => void };
export function useAIEditor(props: Props) {
  const latest = useRef(props); latest.current = props;
  const version = useRef({ project: props.project, revision: 0 });
  if (version.current.project !== props.project) version.current = { project: props.project, revision: version.current.revision + 1 };
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'disconnected' });
  const snapshots = useRef(new Map<string, { project: Project; revision: number }>());
  const render = useRef<ReturnType<typeof createRenderer> | null>(null);
  const decode = useRef<AudioContext | null>(null);
  const connection = useRef<ReturnType<typeof createAIConnection> | null>(null);
  const variants = useRef<{ id: string; root: Project; revision: number; path: string[]; projects: Project[] } | null>(null);
  const variantEpoch = useRef(0);
  const invalidateVariants = () => { variantEpoch.current++; variants.current = null; };
  useEffect(() => {
    render.current = createRenderer();
    connection.current = createAIConnection(async (op, args, active) => {
      if (!latest.current.ready || !active()) throw Error('ai.notReady');
      const capture = () => {
        const id = uid();
        snapshots.current.clear(); // One bounded, immutable snapshot per page.
        snapshots.current.set(id, { ...version.current });
        return { snapshotId: id, revision: version.current.revision, project: describeProject(version.current.project), instrumentIssues: projectScoreIssues(version.current.project) };
      };
      const snapshot = () => {
        const found = snapshots.current.get(args.snapshotId);
        if (!found) throw Error('ai.stale');
        return found;
      };
      const fresh = () => {
        const s = snapshot();
        if (!active() || s.revision !== version.current.revision || s.project !== latest.current.project) throw Error('ai.stale');
        return s.project;
      };
      const variantSet = (id: string) => {
        const set = variants.current;
        if (!set || set.id !== id || set.root !== snapshot().project) throw Error('ai.stale');
        return set;
      };
      const candidate = (id: string, index: number) => {
        const set = variantSet(id);
        if (!Number.isInteger(index) || index < 0 || index >= set.projects.length) throw Error('ai.invalidEdit');
        return set.projects[index];
      };
      const target = (compare = false) => {
        let p = args.variant ? candidate(args.variant.setId, args.variant.index) : snapshot().project;
        if (compare && args.beforePolish) {
          if (!nodeParent(p, args.beforePolish.path).inputs.some(l => l.id === args.beforePolish.id)) throw Error('ai.missingNode');
          p = beforeSoundPolish(p, args.beforePolish);
        }
        return args.node ? isolatedNode(p, args.node) : p;
      };
      if (op === 'capture') return capture();
      if (op === 'schema') return { ...AUTHORING_SCHEMA, currentExportSettings: latest.current.exportSettings };
      if (op === 'resources') {
        await libraryReady;
        const local=args.scope==='local';
        if(args.resourceId) {
          const id=String(args.resourceId);
          if(local){if(!id.startsWith('local:'))throw Error('resources.invalid');return {resource:await folderLibrary.load(id.slice(6)),destination:folderLibrary.destination};}
          if(id==='generator:oscillator')return {resource:resourceFromDefinition(BASIC_SYNTH,'builtin-synth-oscillator')};
          if(id.startsWith('preset:'))return {resource:resourceFromProject(fromPreset(id.slice(7),id.slice(7),k=>k),[],'builtin-preset-'+id.slice(7))};
          if(id.startsWith('recording:')) {
            const r=BUILTIN_RECORDINGS.find(r=>'recording:'+r.id===id);if(!r)throw Error('resources.missing');
            const name=t('resources.recordingTitle',t(r.nameKey)+' · '+t('builtin.articulation.'+r.articulation),r.unpitched?t('resources.unpitched'):pitchName(r.rootMidi),r.velocityLow,r.velocityHigh,r.variant);
            return {resource:await loadBuiltinRecording(r.id,name)};
          }
          const entry=BUILTIN_SOUNDS.find(s=>'builtin:'+s.id===id);if(!entry)throw Error('resources.missing');
          const p=await loadBuiltinSound(entry.id,builtinSoundName(entry));
          if(entry.kind==='instrument'){
            const parent=resourceFromDefinition({schema:'momo.instrument/v1',instrument:p.inputs[0].player.score!.instruments[0],assets:p.assets},'builtin-'+entry.id);
            return {resource:{...parent,version:entry.revision??1,category:entry.category}};
          }
          if(entry.kind==='sample'){
            const audio=await render.current!.render(p),assetId='builtin-'+entry.id;
            return {resource:resourceFromRecording({id:assetId,name:builtinSoundName(entry),sampleRate:audio.sampleRate,channels:[encodeSamples(audio.left),encodeSamples(audio.right)]},null,assetId)};
          }
          return {resource:resourceFromProject(p,[],'builtin-'+entry.id)};
        }
        const items=local?(await folderLibrary.list()).map(e=>({...e,id:'local:'+e.id})): [
          {id:'generator:oscillator',name:t('resources.oscillator'),kind:'synth',category:'uncategorized'},
          ...PRESETS.map(p=>({id:'preset:'+p.id,name:t('preset.'+p.id),kind:'sound',category:p.category})),
          ...BUILTIN_SOUNDS.map(s=>({id:'builtin:'+s.id,name:builtinSoundName(s),kind:s.kind==='instrument'?'instrument':s.kind==='sample'?'recording':'sound',category:s.category})),
          ...BUILTIN_RECORDINGS.map(r=>({id:'recording:'+r.id,name:t('resources.recordingTitle',t(r.nameKey)+' · '+t('builtin.articulation.'+r.articulation),r.unpitched?t('resources.unpitched'):pitchName(r.rootMidi),r.velocityLow,r.velocityHigh,r.variant),kind:'recording',category:r.category,duration:r.duration})),
        ];
        const q=String(args.query??'').toLowerCase(),filtered=items.filter(e=>(!args.kind||e.kind===args.kind)&&JSON.stringify(e).toLowerCase().includes(q));
        const offset=Math.max(0,Number(args.offset)||0);
        return {total:filtered.length,entries:filtered.slice(offset,offset+40),nextOffset:offset+40<filtered.length?offset+40:null,
          ...(local?{destination:folderLibrary.destination,connected:folderLibrary.connected,libraryName:folderLibrary.name}:{})};
      }
      if (op === 'import_resource') {
        fresh();await libraryReady;
        if(new TextEncoder().encode(JSON.stringify(args.resource)).length>RESOURCE_BYTES)throw Error('resources.budget');
        const r=importResource(args.resource);r.id=uid();r.version=1;fresh();
        const entry=await folderLibrary.save(r,undefined,args.destination,()=>{try{fresh();return active();}catch{return false;}});
        return {saved:true,id:'local:'+entry.id,version:entry.version,scope:'local-library-only',workChanged:false};
      }
      if (op === 'variants') {
        const root = fresh(), path = args.path ?? [], base = nodeParent(root, path);
        const epoch = ++variantEpoch.current;
        const projects = generateVariants(base, { count: args.count, amount: args.amount, seed: args.seed });
        const items = []; let bytes = 0;
        for (const project of projects) {
          const result = await render.current!.render(project); fresh();
          if (epoch !== variantEpoch.current) throw Error('ai.stale');
          bytes += [...new Set([result.left, result.right, ...Object.values(result.inputs), ...Object.values(result.processedLayers ?? {})])].reduce((n, a) => n + a.byteLength, 0);
          if (bytes > 64 * 1024 * 1024) throw Error('ai.variantBudget');
          items.push({ project, result });
        }
        const id = uid(); variants.current = { id, root, revision: version.current.revision, path, projects };
        latest.current.publishVariants(base, items, path);
        return { setId: id, snapshotId: args.snapshotId, path, applied: false, variants: projects.map((p, index) => ({ index, project: describeProject(p), instrumentIssues: projectScoreIssues(p) })) };
      }
      if (op === 'apply-variant') {
        const old = fresh(), set = variantSet(args.setId), project = candidate(args.setId, args.index);
        if (set.revision !== version.current.revision) throw Error('ai.stale');
        const next = parseProject(projectForSave(reconcileAdvanced(normalizeGroups(updateProjectAtPath(old, set.path, () => project)))));
        latest.current.commit(old, next); return capture();
      }
      if (op === 'catalog') {
        const q = String(args.query ?? '').toLowerCase();
        const personal = args.scope === 'personal';
        const entries = personal ? (await listSavedSounds()).filter(s => !s.deleted).map(s => ({ ...s, id: `saved:${s.id}` })) : [
          ...PRESETS.map(p => ({ id: `preset:${p.id}`, name: t(`preset.${p.id}`), category: p.category, duration: p.duration })),
          ...BUILTIN_SOUNDS.map(s => ({ id: `builtin:${s.id}`, name: builtinSoundName(s), kind: s.kind, category: s.category, articulation: s.articulation, keyLow: s.keyLow, keyHigh: s.keyHigh, duration: s.duration, keywords: s.keywords })),
        ];
        const filtered = entries.filter(s => JSON.stringify(s).toLowerCase().includes(q));
        const offset = Math.max(0, Number(args.offset) || 0);
        return { total: filtered.length, entries: filtered.slice(offset, offset + 40), nextOffset: offset + 40 < filtered.length ? offset + 40 : null };
      }
      if (op === 'edit') {
        const old = fresh();
        const operations = structuredClone(args.operations) as EditOperation[];
        if (!Array.isArray(operations) || operations.length > 64) throw Error('ai.invalidEdit');
        for (const action of operations) if (action.op === 'insert' && action.soundId) {
          const [source, ...rest] = action.soundId.split(':'); const id = rest.join(':');
          if (source === 'builtin') {
            const entry = BUILTIN_SOUNDS.find(s => s.id === id); if (!entry) throw Error('ai.missingNode');
            action.project = await loadBuiltinSound(id, builtinSoundName(entry));
          } else if (source === 'preset' && PRESETS.some(s => s.id === id)) action.project = fromPreset(id, t(`preset.${id}`), key => t(`layer.${key}`));
          else if (source === 'saved') action.project = await readSavedSound(id);
          else if (source === 'local') action.project = resourceProject(await folderLibrary.load(id));
          else if (source === 'generator' && id === 'oscillator') action.project=resourceProject(resourceFromDefinition(BASIC_SYNTH,'builtin-synth-oscillator'));
          else throw Error('ai.missingNode');
        }
        const base = args.mode === 'create' ? makeProject(args.name || 'Untitled') : old;
        const next = applyEdits(base, operations);
        fresh(); latest.current.commit(old, next); return capture();
      }
      if (op === 'history') {
        fresh(); if (args.action === 'undo') latest.current.undo(); else if (args.action === 'redo') latest.current.redo(); else throw Error('ai.invalidEdit');
        return capture();
      }
      if (op === 'export' || (op === 'render' && args.output === 'export')) {
        const settings = strictExportSettings(args.settings ?? {}, latest.current.exportSettings);
        const batch = args.variantSetId !== undefined;
        if (batch && (args.variant || args.node)) throw Error('ai.invalidEdit');
        const projects = batch ? variantSet(args.variantSetId).projects : [target()];
        if (op === 'render' && (args.start !== undefined || args.end !== undefined || args.beforePolish)) throw Error('ai.invalidExport');
        if (settings.loopOnly && projects.some(p => !p.loopRegion)) throw Error('ai.loopRequired');
        const zip = batch ? new JSZip() : null, manifest = [];
        let totalBytes = 0;
        for (const [i, project] of projects.entries()) {
          const audio = await renderExport(project, settings, p => render.current!.render(p));
          if (!active()) throw Error('ai.stale');
          if (op === 'render' && audio.left.length * (settings.mono ? 2 : 4) > 8 * 1024 * 1024) throw Error('ai.previewBudget');
          const bytes = await encodeAudio(audio, settings);
          if (!active()) throw Error('ai.stale');
          const name = `${safeFilename(settings.prefix || project.name)}_${String(i + 1).padStart(2, '0')}`;
          if (op === 'render') {
            if (bytes.byteLength > 8 * 1024 * 1024) throw Error('ai.previewBudget');
            return { audio: bytesBase64(bytes), mimeType: AUDIO_MIME[settings.format], settings, snapshotId: args.snapshotId, duration: audio.left.length / audio.sampleRate, metrics: { peak: audio.peak, rms: audio.rms, gainReduction: audio.gainReduction }, metricsScope: 'prepared audio before codec encoding; returned audio is encoded export', instrumentIssues: projectScoreIssues(project) };
          }
          const document = args.includeProject !== false ? await packProject(project) : undefined;
          totalBytes += bytes.byteLength + (document?.length ?? 0) * 2;
          if (totalBytes > 128 * 1024 * 1024) throw Error('ai.exportBudget');
          if (zip) {
            zip.file(`${name}.${settings.format}`, bytes); if (document) zip.file(`${name}.soundforge`, document);
          } else {
            download(bytes, `${name}.${settings.format}`, AUDIO_MIME[settings.format]);
            if (document) download(new Uint8Array(document).buffer, `${name}.soundforge`, 'application/zip');
          }
          manifest.push({ file: `${name}.${settings.format}`, ...(document ? { project: `${name}.soundforge` } : {}), seed: project.seed, sampleRate: audio.sampleRate, duration: audio.left.length / audio.sampleRate });
        }
        if (zip) {
          zip.file('manifest.json', JSON.stringify({ schema: 'momo.soundforge-pack/v1', format: settings.format, channels: settings.mono ? 1 : 2, settings, variations: manifest }, null, 2));
          const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
          if (!active()) throw Error('ai.stale');
          download(blob, `${safeFilename(settings.prefix || snapshot().project.name)}-variations.zip`, 'application/zip');
        }
        return { downloaded: true, settings, files: manifest, archive: !!zip };
      }
      if (op === 'render' || op === 'save-library') {
        if (op === 'render' && args.settings !== undefined) throw Error('ai.invalidExport');
        const project = target(op === 'render');
        const audio = await render.current!.render(project);
        if (!active()) throw Error('ai.stale');
        if (op === 'save-library') {
          fresh();
          const entry = await saveSoundToLibrary({ ...project, name: args.name || project.name }, audio);
          window.dispatchEvent(new Event('soundforge-library-updated'));
          return { savedId: entry.id, name: entry.name };
        }
        const start = args.start ?? 0, end = args.end ?? audio.left.length / audio.sampleRate;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > audio.left.length / audio.sampleRate + 1e-6) throw Error('ai.invalidRange');
        if ((end - start) * audio.sampleRate * 4 > 8 * 1024 * 1024) throw Error('ai.previewBudget');
        const a = Math.floor(start * audio.sampleRate), b = Math.floor(end * audio.sampleRate);
        return { audio: bytesBase64(new Uint8Array(encodeWav({ ...audio, left: audio.left.slice(a, b), right: audio.right.slice(a, b) }))), mimeType: 'audio/wav',
          snapshotId: args.snapshotId, start, end, instrumentIssues: projectScoreIssues(project), metrics: { peak: audio.peak, sourcePeak: audio.sourcePeak, rms: audio.rms, gainReduction: audio.gainReduction, tailLimited: audio.tailLimited }, metricsScope: 'whole requested project or node; listening still required' };
      }
      if (op === 'project') return { project: projectDocument(await prepareProjectSamples(target())) };
      if (op === 'import-audio') {
        const old = fresh();
        if (typeof args.base64 !== 'string' || args.base64.length > 16 * 1024 * 1024) throw Error('error.fileSize');
        const binary = atob(args.base64), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        decode.current ??= new AudioContext();
        const buffer = await decode.current.decodeAudioData(bytes.buffer);
        if (buffer.length > MAX_SAMPLE_FRAMES || buffer.length * Math.min(2, buffer.numberOfChannels) * 4 > MAX_ASSET_BYTES) throw Error('error.budget');
        const id = uid(), source = validateSampleSource(args.source), name = String(args.name || 'Sample').slice(0, 120);
        const project = makeProject(name);
        project.duration = Math.max(0.1, buffer.duration);
        project.assets[id] = { id, name, sampleRate: buffer.sampleRate, source, channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => encodeSamples(buffer.getChannelData(i))) };
        project.inputs = [makeLayer({ name, type: 'sample', assetId: id, duration: Math.max(0.01, buffer.duration), frequency: 440, endFrequency: 440, decay: 0, gain: 0.8, attack: 0.002, release: 0.02 })];
        const next = applyEdits(old, [{ op: 'insert', project: parseProject(project), start: args.start ?? 0, path: args.path ?? [] }]);
        fresh(); latest.current.commit(old, next); return capture();
      }
      throw Error('ai.invalidEdit');
    }, setStatus, () => latest.current.project.name);
    return () => { void connection.current?.disconnect(); render.current?.dispose(); void decode.current?.close(); snapshots.current.clear(); };
  }, []);
  return { status, invalidateVariants, connect: (origin: string) => connection.current!.connect(origin, latest.current.project.name), disconnect: () => connection.current!.disconnect() };
}
