import {createAppearance} from '@momo/workbench/appearance';
import {WorkbenchProvider,WorkbenchAppearance} from '@momo/workbench/react';
import {t,language} from './i18n';
let storage:Storage|undefined;try{storage=localStorage;}catch{/* Session preview remains available. */}
export const appearance=createAppearance({storage,root:document.documentElement,storageKey:'momo-sound-forge:appearance:v1'});
export function AppearancePreferences(){return <WorkbenchProvider appearance={appearance} language={language} ui={{text:t,format:t,onLanguageChange:language.onLanguageChange}}><WorkbenchAppearance/></WorkbenchProvider>;}
