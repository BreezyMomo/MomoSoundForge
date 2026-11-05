import {useLayoutEffect,useRef} from 'react';
import {createAppearance} from '@momo/workbench/appearance';
import {createAppearanceSettings,type AppearanceSettings} from '@momo/workbench/appearance-settings';
import {t,language} from './i18n';
export function AppearancePreferences(){
 const settings=useRef<AppearanceSettings|null>(null);
 useLayoutEffect(()=>{
  let storage:Storage|undefined;try{storage=localStorage;}catch{/* Session preview remains available. */}
  const appearance=createAppearance({storage,root:document.documentElement,storageKey:'momo-sound-forge:appearance:v1'});
  const controller=createAppearanceSettings({appearance,ui:{text:t,format:t,onLanguageChange:language.onLanguageChange}});
  settings.current=controller;
  return()=>{controller.dispose();appearance.dispose();settings.current=null;};
 },[]);
 return <button className="text-button appearance-trigger" onClick={()=>settings.current?.open()}>{t('appearance.title')}</button>;
}
