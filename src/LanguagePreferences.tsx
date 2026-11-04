import {useLayoutEffect,useRef} from 'react';
import {createLanguageSelector} from '@momo/workbench/language-selector';
import {language,t} from './i18n';
export function LanguagePreferences(){
 const select=useRef<HTMLSelectElement>(null);
 useLayoutEffect(()=>{
  const selector=createLanguageSelector({select:select.current!,language,ui:{text:t}});
  return()=>selector.dispose();
 },[]);
 return <select ref={select}/>;
}
