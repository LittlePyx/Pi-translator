import {documentIdentity} from '../core/document/document-identity';
import {t,msg} from '../core/i18n/ui-language';
import type {CorrectionTermSuggestion} from '../core/translation/correction-term-suggestions';
import {termAppliesToLanguage} from '../core/document/term-provenance';
import type {DocumentMemorySnapshot} from '../core/document/document-memory-repository';
import type {GlossaryEntry} from '../core/translation/types';
import type {DocumentMemoryLocator,DocumentMemoryResponse,RuntimeMessage,RuntimeResponse} from '../core/messaging/messages';
import type {DocumentGlossarySelection} from '../core/settings/glossary-profiles';

/** Local reads only. Disposal and generations keep older document replies out
 * of a new correction editor, without re-rendering its input fields. */
export function watchCorrectionTerms(options:{locator:DocumentMemoryLocator;language:string;evidence:string;signal:AbortSignal;onChange:(terms:GlossaryEntry[],memory:DocumentMemorySnapshot)=>void;onUnavailable?:()=>void;onPending?:()=>void}):()=>Promise<void>{
  let generation=0;
  const refresh=async()=>{
    if(options.signal.aborted)return;
    const revision=++generation;
    options.onPending?.();
    try{
      const [memory,glossary]=await Promise.all([
        browser.runtime.sendMessage({type:'GET_DOCUMENT_MEMORY',payload:options.locator} satisfies RuntimeMessage) as Promise<DocumentMemoryResponse>,
        browser.runtime.sendMessage({type:'GET_DOCUMENT_GLOSSARY',payload:{...options.locator,evidenceText:options.evidence.slice(0,6000)}} satisfies RuntimeMessage) as Promise<RuntimeResponse<DocumentGlossarySelection>>,
      ]);
      if(options.signal.aborted||generation!==revision)return;if(!memory.ok||!glossary.ok){options.onUnavailable?.();return}
      options.onChange([...memory.data.memory.confirmedTerms.filter(term=>termAppliesToLanguage(term,options.language)),...(glossary.data.termHints??[])],memory.data.memory);
    }catch{if(!options.signal.aborted&&generation===revision)options.onUnavailable?.()}
  };
  const changed=(changes:Record<string,unknown>,area:string)=>{if(area==='local'&&(changes.documentTranslationMemoryV1||changes.extensionSettings))void refresh()};
  const notified=(message:unknown)=>{
    const update=message as {type?:string;payload?:{documentId?:string}};
    if(update?.type==='PUBLIC_SETTINGS_UPDATED'||update?.type==='DOCUMENT_MEMORY_UPDATED'&&update.payload?.documentId===documentIdentity(options.locator).documentId)void refresh();
  };
  if(options.signal.aborted)return async()=>{};
  browser.runtime.onMessage.addListener(notified);
  browser.storage.onChanged.addListener(changed);
  options.signal.addEventListener('abort',()=>{generation++;browser.storage.onChanged.removeListener(changed);browser.runtime.onMessage.removeListener(notified)},{once:true});
  void refresh();
  return refresh;
}
export function renderCorrectionTermReadFailure(host:HTMLElement,retry:()=>Promise<void>):void{
  host.classList.add('correction-term-suggestions');host.replaceChildren();host.hidden=false;const status=document.createElement('p');status.role='status';status.textContent=t('暂时无法核对术语建议，当前草稿仍保留。');const button=document.createElement('button');button.type='button';button.textContent=t('重新读取术语建议');button.addEventListener('click',()=>{button.disabled=true;void retry().finally(()=>{if(button.isConnected)button.disabled=false})});host.append(status,button);
}
export function renderCorrectionTermSuggestions(host:HTMLElement,items:readonly (CorrectionTermSuggestion&{context?:string})[],choose:(item:CorrectionTermSuggestion)=>void):void{
  host.classList.add('correction-term-suggestions');host.replaceChildren();host.hidden=!items.length;
  if(!items.length)return;
  const hint=document.createElement('p');hint.textContent=t('从人工修正整理，尚未保存为术语。');host.append(hint);
  for(const item of items){
    const button=document.createElement('button');button.type='button';button.dataset.termSource=item.source;
    button.textContent=msg`填入词条：${item.source} → ${item.target}`;button.title=msg`修正前译法：${item.previousTarget}`;
    button.addEventListener('click',()=>choose(item));host.append(button);
    if(item.context){const context=document.createElement('p');context.className='correction-term-context';context.textContent=item.context;host.append(context)}
  }
}
