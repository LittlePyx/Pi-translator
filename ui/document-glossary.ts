import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import type {DocumentMemoryLocator,RuntimeMessage,RuntimeResponse} from '../core/messaging/messages';
import {documentIdentity} from '../core/document/document-identity';
import {GENERAL_GLOSSARY_ID,type DocumentGlossarySelection} from '../core/settings/glossary-profiles';

// Bounded to this reader/page lifetime; never stored in settings or browsing history.
const ignoredSuggestions=new Map<string,Set<string>>();

/** Shown only inside the existing document terminology surface. No browsing log. */
export function documentGlossaryControl(locator:DocumentMemoryLocator,signal:AbortSignal,options:{evidenceText?:()=>string;targetLanguage?:()=>string;onChange?:()=>void}={}){
  const section=document.createElement('div');section.className='document-glossary';
  const label=document.createElement('label'),caption=document.createElement('span'),select=document.createElement('select');caption.textContent=t('本文术语方案');select.ariaLabel=t('本文术语方案');select.disabled=true;label.append(caption,select);
  const status=document.createElement('p');status.role='status';status.textContent=t('正在读取术语方案…');const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent=t('重新读取');retry.hidden=true;section.append(label,status,retry);
  const suggestion=document.createElement('div');suggestion.className='document-glossary-suggestion';suggestion.hidden=true;section.append(suggestion);
  let current:DocumentGlossarySelection|undefined,busy=false,revision=0,currentEvidence='',readFailed=false;
  const scopeKey=()=>JSON.stringify([locator.glossaryDocumentId??documentIdentity(locator).documentId,options.targetLanguage?.()??'']);
  const proposalKey=(data:DocumentGlossarySelection)=>JSON.stringify([data.defaultId,data.suggestion?.profileId,data.suggestion?.revision]);
  const name=(id:string)=>id===GENERAL_GLOSSARY_ID?t('通用（原词表）'):current?.profiles.find(p=>p.id===id)?.name??t('已删除的方案');
  function render(data:DocumentGlossarySelection,keepMessage=false){
    const previousMessage=status.textContent;
    current=data;select.replaceChildren();section.hidden=!data.profiles.length&&!data.missing&&!keepMessage;
    const choices=[{id:'',name:msg`跟随默认：${name(data.defaultId)}`},{id:GENERAL_GLOSSARY_ID,name:t('通用（原词表）')},...data.profiles];
    if(data.missing&&data.selectedId)choices.push({id:data.selectedId,name:t('已删除的方案（使用通用词表）')});
    for(const choice of choices){const option=document.createElement('option');option.value=choice.id;option.textContent=choice.name;option.title=choice.name;select.append(option)}
    select.value=data.selectedId;select.disabled=busy;status.textContent=data.missing?t('原术语方案已删除，当前使用通用词表；本文已确认术语保留。'):t(data.selectedId?'本文固定方案；已确认术语优先，旧译文和人工修正保留。':'跟随默认方案；已确认术语优先，旧译文和人工修正保留。');
    suggestion.replaceChildren();suggestion.hidden=!data.suggestion||Boolean(ignoredSuggestions.get(scopeKey())?.has(proposalKey(data)));
    if(data.suggestion&&!suggestion.hidden){
      const proposed=data.suggestion,explanation=document.createElement('p'),use=document.createElement('button');use.type='button';
      explanation.textContent=msg`本文匹配“${proposed.name}”：${proposed.matchedTerms.join('、')}`+t('。采用后立即保存，仅影响本文后续翻译。');
      use.textContent=t('仅本文采用');use.disabled=busy;use.addEventListener('click',()=>{if(signal.aborted||busy||current?.suggestion!==proposed)return;apply(proposed.profileId,{defaultId:data.defaultId,evidenceText:currentEvidence,profileSnapshot:proposed.profileSnapshot})});const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent=t('本次忽略');dismiss.disabled=busy;
      dismiss.addEventListener('click',()=>{
        if(signal.aborted||busy||current?.suggestion!==proposed)return;
        const key=scopeKey(),ignored=ignoredSuggestions.get(key)??new Set<string>();ignored.add(proposalKey(data));
        if(ignored.size>24)ignored.delete(ignored.values().next().value!);
        ignoredSuggestions.delete(key);ignoredSuggestions.set(key,ignored);if(ignoredSuggestions.size>32)ignoredSuggestions.delete(ignoredSuggestions.keys().next().value!);
        render(data,true);select.focus({preventScroll:true});
      });suggestion.append(explanation,use,dismiss);
    }
    options.onChange?.();
    if(keepMessage&&!data.missing)status.textContent=previousMessage;
  }
  const error=(value:unknown)=>{status.textContent=localizeErrorMessage(value instanceof Error?value.message:String(value))};
  async function refresh(keepMessage=false){
    if(signal.aborted||busy)return;const version=++revision,scope=scopeKey();retry.disabled=true;
    try{const evidenceText=options.evidenceText?.().slice(0,6000);const response=await browser.runtime.sendMessage({type:'GET_DOCUMENT_GLOSSARY',payload:{...locator,...(evidenceText?{evidenceText}:{})}} satisfies RuntimeMessage) as RuntimeResponse<DocumentGlossarySelection>;
      if(signal.aborted||version!==revision)return;if(scope!==scopeKey()){void refresh(keepMessage);return}if(!response.ok)throw new Error(response.error.message);
      currentEvidence=evidenceText??'';const recovered=readFailed;readFailed=false;retry.hidden=true;if(recovered||JSON.stringify(current)!==JSON.stringify(response.data))render(response.data,recovered?false:keepMessage);
    }catch{if(!signal.aborted&&version===revision){readFailed=true;section.hidden=false;select.disabled=true;suggestion.hidden=true;status.textContent=t('暂时无法读取术语方案，相关建议已暂停；本文词条草稿仍保留。');retry.hidden=false;options.onChange?.()}}
    finally{if(!signal.aborted&&version===revision)retry.disabled=false}
  }
  retry.addEventListener('click',()=>void refresh());
  function apply(profileId:string,expectedSuggestion?:{defaultId:string;evidenceText:string;profileSnapshot:string}){if(!current||signal.aborted||busy)return;const expectedId=current.selectedId;select.value=profileId;busy=true;revision++;select.disabled=true;suggestion.querySelectorAll('button').forEach(button=>button.disabled=true);void browser.runtime.sendMessage({type:'SET_DOCUMENT_GLOSSARY',payload:{...locator,profileId,expectedId,...(expectedSuggestion?{expectedSuggestion}:{})}} satisfies RuntimeMessage).then((response:RuntimeResponse<DocumentGlossarySelection>)=>{
    if(signal.aborted)return;if(!response.ok)throw new Error(response.error.message);render(response.data);status.textContent=response.data.missing?t('原术语方案已删除，当前使用通用词表；本文已确认术语保留。'):t('本文方案已保存；旧译文和人工修正保留。');
  }).catch(value=>{if(!signal.aborted){select.value=expectedId;error(value)}}).finally(()=>{busy=false;if(signal.aborted)return;select.disabled=!current;suggestion.querySelectorAll('button').forEach(button=>button.disabled=false);void refresh(true)})}
  select.addEventListener('change',()=>apply(select.value));
  const onSettingsChanged=(changes:Record<string,unknown>,area:string)=>{if(area==='local'&&changes.extensionSettings)void refresh()};
  if(!signal.aborted){browser.storage.onChanged.addListener(onSettingsChanged);signal.addEventListener('abort',()=>{revision++;browser.storage.onChanged.removeListener(onSettingsChanged)},{once:true});void refresh()}
  return {element:section,refresh,unavailable:()=>readFailed,termHints:()=>readFailed?[]:current?.termHints??[]};
}
