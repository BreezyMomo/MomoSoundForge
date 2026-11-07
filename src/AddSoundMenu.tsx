import { useState } from 'react';
import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@momo/workbench/react';
import { Plus, X } from 'lucide-react';
import { t } from './i18n';

export type AddSoundAction = 'library' | 'audio' | 'notes' | 'group' | 'project';
export function AddSoundMenu({ onAdd, disabled, label }: { onAdd: (action: AddSoundAction) => void; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="outline" disabled={disabled} aria-label={label} />}><Plus size={14} />{t('add.title')}</PopoverTrigger>
    <PopoverContent align="start" className="layer-tool-popover">
      <div className="layer-tool-heading"><PopoverTitle>{label ?? t('add.title')}</PopoverTitle><Button variant="ghost" size="icon-sm" aria-label={t('action.close')} onClick={() => setOpen(false)}><X size={14} /></Button></div>
      <div className="layer-selection-settings">{(['library', 'audio', 'notes', 'group', 'project'] as const).map(action => <Button key={action} variant="outline" title={action === "audio" || action === "project" ? t(`add.${action}Help`) : undefined} onClick={() => { setOpen(false); onAdd(action); }}>{t('add.' + action)}</Button>)}</div>
    </PopoverContent>
  </Popover>;
}
