import { useState, useSyncExternalStore } from 'react';
import { Button } from '@momo/workbench/react';
import { remoteLibraries } from './remoteSubscriptions';
import { t } from './i18n';

export function RemoteLibrarySettings(){
  const sources=useSyncExternalStore(remoteLibraries.subscribe,remoteLibraries.snapshot);
  const [name,setName]=useState(''),[url,setUrl]=useState(''),[editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async()=>{setBusy(true);setError('');try{if(editing)await remoteLibraries.edit(editing,name,url);else await remoteLibraries.add(name,url);setName('');setUrl('');setEditing(null);}catch(e){setError(e instanceof Error&&e.message.startsWith('remote.')?e.message:'remote.network');}finally{setBusy(false);}};
  return <details className="remote-settings"><summary>{t('remote.title')}</summary>
    <p className="field-help">{t('remote.help')}</p>
    <div className="remote-sources">{sources.map(s=><section key={s.id} aria-label={s.name} className="remote-source">
      <div className="remote-source-info"><strong>{s.name}</strong><span className="field-help">{s.url}</span>
        <span role={s.error?'alert':'status'}>{s.error?t(s.error)+(s.index?' · '+t('remote.retained'):''):!s.enabled?t('remote.disabled'):s.loading?t('remote.refreshing'):s.index?t('remote.count',s.index.entries.length):t('remote.pending')}</span></div>
      <div className="button-group"><label><input type="checkbox" checked={s.enabled} aria-label={t('remote.enable',s.name)} onChange={e=>remoteLibraries.enable(s.id,e.target.checked)}/>{t('remote.enabled')}</label>
        <Button variant="outline" disabled={s.loading||!s.enabled} onClick={()=>void remoteLibraries.refresh(s.id)}>{t('remote.refresh')}</Button>
        <Button variant="outline" disabled={busy} onClick={()=>{setEditing(s.id);setName(s.name);setUrl(s.url);setError('');}}>{t('remote.edit')}</Button>
        <Button variant="outline" disabled={busy} onClick={()=>{remoteLibraries.remove(s.id);if(editing===s.id){setEditing(null);setName('');setUrl('');}}}>{t('remote.remove')}</Button></div>
    </section>)}</div>
    <form className="remote-add" onSubmit={e=>{e.preventDefault();void submit();}}>
      <label className="resource-field"><span>{t('remote.name')}</span><input value={name} maxLength={120} required onChange={e=>setName(e.target.value)}/></label>
      <label className="resource-field"><span>{t('remote.address')}</span><input type="url" value={url} maxLength={2048} required placeholder="https://example.com/sounds/index.json" onChange={e=>setUrl(e.target.value)}/></label>
      <div className="button-group"><Button type="submit" disabled={busy||!name.trim()||!url.trim()}>{t(busy?'remote.checking':editing?'remote.save':'remote.add')}</Button>{editing&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{setEditing(null);setName('');setUrl('');setError('');}}>{t('resources.cancel')}</Button>}</div>
    </form>{error&&<p role="alert">{t(error)}</p>}
  </details>;
}
