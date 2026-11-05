import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import {validPassageInput,type PassageInput} from '../core/content/passage-explanation';
import type {TranslateResult} from '../core/translation/types';
import type {NoteSummaryPoint} from '../core/content/note-summary';
import type {RuntimeMessage,RuntimeResponse} from '../core/messaging/messages';
import {layoutTaskDialog} from './task-dialog';
import styles from './note-summary.css?inline';

export function resultPassageInput(result:TranslateResult):PassageInput{
  return {title:'',sources:[{originalText:result.originalText,translatedText:result.translatedText,label:t('当前原文')}],terms:(result.appliedGlossaryTerms??[]).slice(0,20).map(({source,target})=>({source,target}))};
}
const sessions=new WeakMap<HTMLElement|ShadowRoot,{key:string;resume:()=>void;dispose:()=>void;isCurrent:()=>boolean}>();
export function openPassageExplanation(input:PassageInput,options:{host?:HTMLElement|ShadowRoot;isCurrent:()=>boolean;refreshInput?:()=>Promise<PassageInput>;onLocate?:(index:number)=>void}):void{
  const host=options.host??document.body;let key=JSON.stringify(input);const existing=sessions.get(host);
  if(existing?.key===key&&existing.isCurrent()){existing.resume();return}existing?.dispose();
  const origin=host instanceof ShadowRoot?host.activeElement:document.activeElement;
  const dialog=document.createElement('dialog');dialog.className='pi-note-summary pi-passage-explanation';dialog.ariaLabel=t('解释本段');
  const style=document.createElement('style');style.textContent=styles+'\n.pi-passage-explanation:not([open]){display:none}.pi-passage-explanation .passage-preview{white-space:pre-wrap;max-height:160px;overflow:auto;color:var(--pi-muted,#666)}';
  const title=document.createElement('h2'),intro=document.createElement('p'),range=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('div'),status=document.createElement('p'),result=document.createElement('section'),actions=document.createElement('div'),close=document.createElement('button'),generate=document.createElement('button');
  title.textContent=t('解释本段');intro.textContent=t('结合所列上下文解释含义与译法；AI 解释供参考，可返回原文核对。');summary.textContent=t('查看发送内容');range.append(summary,content);status.role='status';actions.className='note-summary-actions';close.type=generate.type='button';close.textContent=t('关闭');generate.textContent=t('生成解释');generate.className='primary';actions.append(close,generate);
  function renderInput(){content.replaceChildren();if(input.title){const p=document.createElement('p');p.textContent=input.title;content.append(p)}
  for(const source of input.sources){const heading=document.createElement('strong'),p=document.createElement('p');heading.textContent=source.label;p.className='passage-preview';p.textContent=[source.originalText,source.translatedText].filter(Boolean).join('\n\n');content.append(heading,p)}
  if(input.terms.length){const p=document.createElement('p');p.textContent=input.terms.map(term=>`${term.source} → ${term.target}`).join(' · ');content.append(p)}}renderInput();
  layoutTaskDialog(dialog,title,[intro,range,result],actions,status);dialog.append(style);host.append(dialog);
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent=t('重新预览');refresh.hidden=true;actions.insertBefore(refresh,generate);
  const resultNote=document.createElement('p');resultNote.className='note-summary-snapshot';resultNote.hidden=true;result.before(resultNote);
  let preview:{configuration:string;model:string;language:string}|undefined,busy=false,loading=false,disposed=false,requestId:string|undefined,epoch=0,hasResult=false,stale=false,contextDirty=false,resultConfiguration:string|undefined;
  const send=async<T>(message:RuntimeMessage)=>{const r=await browser.runtime.sendMessage(message) as RuntimeResponse<T>;if(!r.ok)throw new Error(r.error.message);return r.data};
  const current=()=>!disposed&&options.isCurrent();
  const sync=()=>{generate.hidden=hasResult&&(!stale||!preview);generate.textContent=t(hasResult?'更新解释':'生成解释');generate.disabled=busy||loading||!preview||!current()||hasResult&&!stale;refresh.hidden=Boolean(preview);refresh.disabled=busy||loading;resultNote.hidden=!hasResult||!stale;resultNote.textContent=t('先前解释 · 上下文或设置已变化，请核对后更新。');close.textContent=busy?t('取消生成'):t('关闭')};
  const cancel=()=>{if(requestId){void send({type:'CANCEL_PASSAGE_EXPLANATION',payload:{requestId}}).catch(()=>undefined);requestId=undefined}};
  async function load(){const revision=++epoch;loading=true;sync();try{
    if(options.refreshInput&&contextDirty){const nextInput=await options.refreshInput();if(disposed||revision!==epoch)return;if(!current())throw new Error('本段或上下文已变化，请从当前段落重新打开解释。');if(!validPassageInput(nextInput))throw new Error('本段上下文超出范围，请缩小内容后重试。');input=nextInput;key=JSON.stringify(input);sessions.set(host,{key,resume,dispose,isCurrent:current});renderInput()}
    if(!validPassageInput(input))throw new Error('本段上下文超出范围，请缩小内容后重试。');
    const next=await send<typeof preview & {}>({type:'PREVIEW_PASSAGE_EXPLANATION',payload:{input}});
    if(disposed||revision!==epoch)return;if(!current())throw new Error('本段或上下文已变化，请从当前段落重新打开解释。');
    stale=hasResult&&resultConfiguration!==next.configuration;preview=next;contextDirty=false;
    status.textContent=hasResult&&!stale?t('已复用本次阅读中的解释。'):msg`点击生成后发送所列内容至 ${next.model}，可能产生 API 费用；不自动重试。`;
  }catch(e){if(!disposed&&revision===epoch){preview=undefined;status.textContent=localizeErrorMessage(e instanceof Error?e.message:String(e))}}finally{if(revision===epoch){loading=false;sync()}}}
  function resume(){if(!current()){dispose();return}if(!dialog.open)dialog.showModal();close.focus({preventScroll:true});void load()}
  function dispose(){if(disposed)return;disposed=true;epoch++;cancel();browser.storage.onChanged.removeListener(changed);window.removeEventListener('pagehide',dispose);dialog.remove();if(sessions.get(host)?.key===key)sessions.delete(host)}
  function changed(changes:Record<string,unknown>,area:string){if(area==='local'&&['extensionSettings','documentTranslationMemoryV1','apiKey','apiKeysByProfile'].some(k=>k in changes)){epoch++;cancel();busy=loading=false;preview=undefined;contextDirty=true;stale=hasResult;status.textContent=t(hasResult?'设置或术语已变化，先前解释保留；请重新预览后更新。':'设置或术语已变化，请重新预览。');sync()}}
  browser.storage.onChanged.addListener(changed);window.addEventListener('pagehide',dispose,{once:true});
  refresh.addEventListener('click',()=>{if(!busy&&!loading)void load()});
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{epoch++;cancel();busy=loading=false;sync();if(origin instanceof HTMLElement&&origin.isConnected)origin.focus({preventScroll:true})});
  generate.addEventListener('click',()=>{if(busy||loading||!preview||!current()||hasResult&&!stale)return;const revision=++epoch,configuration=preview.configuration;busy=true;requestId=crypto.randomUUID();sync();status.textContent=t('正在解释，可随时取消…');
    void send<{points:NoteSummaryPoint[]}>({type:'GENERATE_PASSAGE_EXPLANATION',payload:{input,requestId,configuration}}).then(data=>{
      if(disposed||revision!==epoch)return;if(!current())throw new Error('本段或上下文已变化，请从当前段落重新打开解释。');result.replaceChildren();
      for(const point of data.points){const article=document.createElement('article'),p=document.createElement('p'),sources=document.createElement('div');p.textContent=point.text;sources.className='note-summary-sources';for(const id of point.sources){const index=Number(id.slice(1))-1,source=input.sources[index];if(!source)continue;const button=document.createElement('button');button.type='button';button.textContent=source.label;button.addEventListener('click',()=>{if(!current()){status.textContent=t('本段或上下文已变化，请从当前段落重新打开解释。');return}if(options.onLocate){dialog.close();options.onLocate(index)}else{range.open=true;content.scrollIntoView({block:'nearest'})}});sources.append(button)}article.append(p,sources);result.append(article)}hasResult=true;stale=false;resultConfiguration=configuration;range.open=false;status.textContent=t('AI 解释已生成，原译文未改变。');
    }).catch(e=>{if(!disposed&&revision===epoch)status.textContent=localizeErrorMessage(e instanceof Error?e.message:String(e))}).finally(()=>{if(!disposed&&revision===epoch){busy=false;requestId=undefined;sync()}});
  });
  sessions.set(host,{key,resume,dispose,isCurrent:current});resume();
}
