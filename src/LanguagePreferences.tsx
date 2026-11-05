import {WorkbenchProvider,WorkbenchLanguageSelect} from '@momo/workbench/react';
import {appearance} from './AppearancePreferences';
import {language,t} from './i18n';
export function LanguagePreferences(){
 return <WorkbenchProvider appearance={appearance} language={language} ui={{text:t,onLanguageChange:language.onLanguageChange}}><WorkbenchLanguageSelect/></WorkbenchProvider>;
}
