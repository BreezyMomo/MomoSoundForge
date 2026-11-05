import { useState } from 'react';
import { Button, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@momo/workbench/react';
import JSZip from 'jszip';
import { t } from './i18n';
import type { ConnectionStatus } from './aiConnection';
import { BUILTIN_SOUNDS, builtinSoundName } from './builtinLibrary';
import { PRESETS } from './presets';
import { download } from './storage';
import type { Project } from './model';
import './ai-tools.css';

type Directory = { getDirectoryHandle: (name: string, options: { create: boolean }) => Promise<Directory>; getFileHandle: (name: string, options?: { create: boolean }) => Promise<{ getFile: () => Promise<File>; createWritable: () => Promise<{ write: (bytes: Uint8Array) => Promise<void>; close: () => Promise<void> }> }> };
export function AITools({ project, status, connect, disconnect }: { project: Project; status: ConnectionStatus; connect: (origin: string) => Promise<void>; disconnect: () => Promise<void> }) {
  const [origin, setOrigin] = useState('http://127.0.0.1:8799');
  const [notice, setNotice] = useState(''), [installing, setInstalling] = useState(false);
  const archive = `${import.meta.env.BASE_URL}ai/momo-sound-forge.zip`;
  let port = '8799'; try { port = new URL(origin).port || '80'; } catch { /* Validated on connect. */ }
  const prompt = t('ai.startPrompt', port, location.origin);
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setNotice('ai.copied'); } catch { setNotice('ai.copyFailed'); } };
  const picker = (window as unknown as { showDirectoryPicker?: (options: object) => Promise<Directory> }).showDirectoryPicker;
  const install = async () => {
    try {
      const directory = await picker!({ mode: 'readwrite' }); setInstalling(true);
      const response = await fetch(archive); if (!response.ok) throw Error();
      const zip = await JSZip.loadAsync(await response.arrayBuffer());
      const backup = `.backup-${Date.now()}`;
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const parts = entry.name.split('/');
        if (parts.some(p => !p || p === '..' || p === '.' || p.includes('\\') || p.includes(':'))) throw Error();
        let folder = directory;
        for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
        const filename = parts.at(-1)!, bytes = await entry.async('uint8array');
        let previous: Uint8Array | undefined;
        try { previous = new Uint8Array(await (await (await folder.getFileHandle(filename)).getFile()).arrayBuffer()); } catch (e) { if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e; }
        if (previous && previous.length === bytes.length && previous.every((v, i) => v === bytes[i])) continue;
        if (previous) {
          const backups = await folder.getDirectoryHandle(backup, { create: true });
          const writer = await (await backups.getFileHandle(filename, { create: true })).createWritable(); await writer.write(previous); await writer.close();
        }
        const writer = await (await folder.getFileHandle(filename, { create: true })).createWritable(); await writer.write(bytes); await writer.close();
      }
      setNotice('ai.installed');
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setNotice('ai.installFailed'); }
    finally { setInstalling(false); }
  };
  const exportCredits = () => {
    const sources: object[] = [];
    const walk = (p: Project) => { for (const a of Object.values(p.assets)) sources.push({ name: a.name, ...(a.source ?? { status: 'No provenance recorded in this project; check the original source.' }) }); for (const l of p.layers) if (l.project) walk(l.project); };
    walk(project); download(JSON.stringify({ project: project.name, sources }, null, 2), 'sound-credits.json', 'application/json');
  };
  return <Dialog>
    <DialogTrigger render={<Button variant="outline" />}>{t('ai.title')}</DialogTrigger>
    <DialogContent showCloseButton={false} className="sound-ai-dialog">
      <DialogHeader><DialogTitle>{t('ai.title')}</DialogTitle><DialogDescription>{t('ai.intro')}</DialogDescription></DialogHeader>
      <section><h3>{t('ai.skill')}</h3><p>{t('ai.skillHelp')}</p>
        <div className="sound-ai-actions"><Button nativeButton={false} variant="outline" render={<a href={archive} download />}>{t('ai.download')}</Button>
          {picker && <Button variant="outline" disabled={installing} onClick={() => void install()}>{t('ai.install')}</Button>}</div>
      </section>
      <section><h3>{t('ai.start')}</h3><p>{t('ai.startHelp')}</p>
        <textarea readOnly aria-label={t('ai.start')} value={prompt} rows={3} />
        <Button variant="outline" onClick={() => void copy(prompt)}>{t('ai.copy')}</Button>
      </section>
      <section><h3>{t('ai.connectStep')}</h3><p>{t('ai.connectHelp')}</p>
        <details><summary>{t('ai.advanced')}</summary><label>{t('ai.advanced')}<input value={origin} disabled={status.state === 'connected' || status.state === 'connecting'} onChange={e => setOrigin(e.target.value)} /></label></details>
        <div className="sound-ai-actions"><Button variant="outline" disabled={status.state === 'connected' || status.state === 'connecting'} onClick={() => void connect(origin).catch(() => setNotice('ai.localOnly'))}>{t('ai.connect')}</Button>
          {['connected', 'connecting'].includes(status.state) && <Button variant="outline" onClick={() => void disconnect()}>{t('ai.disconnect')}</Button>}
          <span role="status">{t(status.state === 'error' ? 'ai.disconnected' : `ai.${status.state}`, project.name)}</span></div>
        {status.error && <p role="alert">{t(status.error)}</p>}
        {status.configuration && <><label>{t('ai.config')}<textarea readOnly rows={6} value={JSON.stringify(status.configuration, null, 2)} /></label><Button variant="outline" onClick={() => void copy(JSON.stringify(status.configuration, null, 2))}>{t('ai.copyConfig')}</Button></>}
        {status.lastAction && <p>{t('ai.lastAction', t(`ai.operation.${status.lastAction}`))}</p>}
      </section>
      <section><h3>{t('ai.try')}</h3><p>{t('ai.example')}</p><p>{t('ai.privacy')}</p></section>
      <details><summary>{t('ai.catalog')}</summary><p>{t('ai.catalogHelp')}</p><div className="sound-ai-actions"><Button variant="outline" onClick={() => download(JSON.stringify({ schema: 'momo.soundforge.catalog/v1', presets: PRESETS.map(p => ({ ...p, layers: undefined, id: `preset:${p.id}` })), sounds: BUILTIN_SOUNDS.map(s => ({ ...s, waveform: undefined, name: builtinSoundName(s), id: `builtin:${s.id}` })) }, null, 2), 'sound-catalog.json', 'application/json')}>{t('ai.catalog')}</Button><Button variant="outline" onClick={exportCredits}>{t('ai.credits')}</Button></div></details>
      {notice && <p role="status">{t(notice)}</p>}
      <DialogFooter><DialogClose render={<Button variant="outline" />}>{t('action.close')}</DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>;
}
