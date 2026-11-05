import {useLayoutEffect,useRef} from 'react';
import {createAppearance} from '@momo/workbench/appearance';
import {createAppearanceSettings} from '@momo/workbench/appearance-settings';
import {createAppearanceTrigger} from '@momo/workbench/header-controls';
import {t,language} from './i18n';
export function AppearancePreferences(){
 const button=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{
  let storage:Storage|undefined;try{storage=localStorage;}catch{/* Session preview remains available. */}
  const appearance=createAppearance({storage,root:document.documentElement,storageKey:'momo-sound-forge:appearance:v1'});
  const settings=createAppearanceSettings({appearance,ui:{text:t,format:t,onLanguageChange:language.onLanguageChange}});
  const trigger=createAppearanceTrigger({button:button.current!,appearance,settings,ui:{text:t,onLanguageChange:language.onLanguageChange}});
  return()=>{trigger.dispose();settings.dispose();appearance.dispose();};
 },[]);
 return <button ref={button} className="appearance-trigger"/>;
}
