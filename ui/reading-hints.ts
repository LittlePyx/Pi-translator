import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import {newReadingHighlights,selectReadingRecap,type ReadingRecapSource} from '../core/content/reading-hints';
import type {NoteSummaryTarget,NoteSummarySource} from '../core/content/note-summary';
import type {RuntimeMessage,RuntimeResponse} from '../core/messaging/messages';
import {hasReadingDraft,type ReadingSummaryReturn} from '../core/content/reading-navigation';
import {openNoteSummary,disposeNoteSummary} from './note-summary';
import {layoutTaskDialog} from './task-dialog';
import {reuseReadingSource} from './reading-source-link';
import summaryStyles from './note-summary.css?inline';
import hintStyles from './reading-hints.css?inline';

interface Snapshot {sources:ReadingRecapSource[];pageNumber?:number}
export function bindReadingHints(options:{host:HTMLElement|ShadowRoot;target:()=>NoteSummaryTarget|undefined;resumePage?:()=>number|undefined;locate?:(source:NoteSummarySource,summaryReturn?:ReadingSummaryReturn)=>Promise<boolean>}){
  const style=document.createElement('style');style.textContent=hintStyles;options.host.append(style);
  let key='',epoch=0,initialized=false,refreshAgain=false,baseline=new Set<string>(),snapshot:Snapshot={sources:[]},resumePage:number|undefined,offered=false,pending:'recap'|'organize'|undefined,due=0,notice:HTMLElement|undefined,opened:HTMLDialogElement|undefined,loading=false,claiming=false,disposed=false;
  let disposeRecap:(()=>void)|undefined;
  const send=async<T>(action:'snapshot'|'claim'|'dismiss',target:NoteSummaryTarget):Promise<T>=>{const response=await browser.runtime.sendMessage({type:'READING_HINT',payload:{target,action}} satisfies RuntimeMessage) as RuntimeResponse<T>;if(!response.ok)throw new Error(response.error.message);return response.data};
  const targetKey=()=>JSON.stringify(options.target()??null);
  const highlights=()=>snapshot.sources.filter(source=>source.originalText.trim());
  function reset():void{epoch++;disposeRecap?.();key='';initialized=false;refreshAgain=false;baseline.clear();snapshot={sources:[]};resumePage=undefined;pending=undefined;offered=false;loading=false;notice?.remove();notice=undefined;opened?.close();opened=undefined}
  async function refresh(changed=false):Promise<void>{
    if(disposed)return;const target=options.target(),next=targetKey();if(!target){if(key)reset();return}
    if(next!==key){reset();key=next}else if(!changed)return;
    // A save notification must not replace the first in-flight baseline snapshot.
    if(!initialized&&loading){refreshAgain=true;return}
    const current=++epoch;loading=true;
    try{const data=await send<Snapshot>('snapshot',target);if(current!==epoch||targetKey()!==key||disposed)return;snapshot=data;
      const ids=highlights().map(source=>source.id);
      if(!initialized){initialized=true;resumePage=options.resumePage?options.resumePage():data.pageNumber;baseline=new Set(ids);if(snapshot.sources.length&&!offered){pending='recap';due=Date.now()+1500}}
      else if(newReadingHighlights(ids,baseline).length>=3&&!offered){pending='organize';due=Date.now()+1500}
      if(!snapshot.sources.length){pending=undefined;notice?.remove();notice=undefined;if(!disposeRecap)opened?.close()}
    }catch{/* Optional local hints must never block reading or expose storage errors. */}finally{if(current===epoch){loading=false;if(refreshAgain){refreshAgain=false;void refresh(true)}}}
  }
  const blocked=()=>document.visibilityState==='hidden'||hasReadingDraft()||Boolean(document.querySelector('dialog[open],#pdf-link-return:not([hidden]),#pdf-research-return:not([hidden])')||options.host.querySelector('dialog[open],.source-reading-return'))||Boolean(getSelection()?.toString().trim())||Boolean((options.host instanceof ShadowRoot?options.host.activeElement:document.activeElement)?.matches('input,textarea,select,[contenteditable=true]'));
  const showSummary=(target:NoteSummaryTarget,selected?:string[])=>{opened=openNoteSummary(target,{host:options.host,isCurrent:()=>!disposed&&targetKey()===JSON.stringify(target),...(selected?{initialSelection:selected}:{}),...(options.locate?{onLocateSource:options.locate}:{})})};
  function recap(target:NoteSummaryTarget):void{
    disposeRecap?.();
    const origin=options.host instanceof ShadowRoot?options.host.activeElement:document.activeElement,dialog=document.createElement('dialog');opened=dialog;dialog.className='pi-note-summary pi-reading-recap';dialog.ariaLabel=t('阅读回顾');
    const css=document.createElement('style');css.textContent=summaryStyles+hintStyles;const title=document.createElement('h2');title.textContent=t('阅读回顾');const description=document.createElement('p');
    const content=document.createElement('section');
    const status=document.createElement('p');status.setAttribute('role','status');
    const actions=document.createElement('div');actions.className='note-summary-actions';const close=document.createElement('button'),summary=document.createElement('button');close.type=summary.type='button';close.textContent=t('继续阅读');summary.textContent=t('整理本篇笔记');actions.append(close,summary);
    layoutTaskDialog(dialog,title,[description,content],actions,status);dialog.append(css);options.host.append(dialog);
    let closed=false,locating=false,pendingCloses=0,scrollTop=0,checking=0,recapData=snapshot,child:HTMLDialogElement|undefined,focus:HTMLElement=close,focusId:string|undefined;
    const returnCleanups=new Set<()=>void>(),current=()=>!closed&&!disposed&&targetKey()===JSON.stringify(target)&&options.host.isConnected;
    const body=dialog.querySelector<HTMLElement>('.pi-task-body')!;
    const clearReturns=()=>{for(const cleanup of returnCleanups)cleanup();returnCleanups.clear()};
    const revisionKey=(data:Snapshot)=>JSON.stringify(data.sources.map(({id,revision})=>({id,revision})));
    function restoreFocus():void{const link=focusId?[...content.querySelectorAll<HTMLElement>('[data-recap-source]')].find(row=>row.dataset.recapSource===focusId)?.querySelector<HTMLAnchorElement>('a'):undefined;(focus.isConnected&&dialog.contains(focus)?focus:link??close).focus({preventScroll:true})}
    function remember():void{scrollTop=body.scrollTop;const active=options.host instanceof ShadowRoot?options.host.activeElement:document.activeElement;if(active instanceof HTMLElement&&dialog.contains(active)){focus=active;focusId=active.closest<HTMLElement>('[data-recap-source]')?.dataset.recapSource}}
    function suspend():void{remember();checking++;dialog.hidden=true;if(dialog.open){pendingCloses++;dialog.close()}}
    function dispose():void{
      if(closed)return;closed=true;checking++;clearReturns();if(child)disposeNoteSummary(options.host,child);window.removeEventListener('pagehide',dispose);dialog.remove();
      if(disposeRecap===dispose)disposeRecap=undefined;if(opened===dialog||opened===child)opened=undefined;
      if(origin instanceof HTMLElement&&origin.isConnected&&!hasReadingDraft())origin.focus({preventScroll:true});
    }
    function resume():void{
      if(!current()){dispose();return}clearReturns();opened=dialog;if(!dialog.isConnected)options.host.append(dialog);dialog.hidden=false;if(!dialog.open)dialog.showModal();body.scrollTop=scrollTop;restoreFocus();
      const check=++checking;void send<Snapshot>('snapshot',target).then(data=>{
        if(!current()||check!==checking||!dialog.open||dialog.hidden)return;
        if(revisionKey(data)!==revisionKey(recapData)){remember();recapData=data;render();body.scrollTop=scrollTop;restoreFocus();status.textContent=t('已更新回顾中的标记，原笔记未改变。')}
      }).catch(()=>{/* Keep the saved recap when this optional local refresh is unavailable. */});
    }
    const recapReturn:ReadingSummaryReturn={kind:'recap',resume,onCancel:cleanup=>{if(closed)cleanup();else returnCleanups.add(cleanup)}};
    function render():void{
      description.textContent=msg`本篇有 ${recapData.sources.length} 条已保存标记。`;summary.disabled=!recapData.sources.length&&!child;content.replaceChildren();
      if(resumePage){const position=document.createElement('p');position.textContent=msg`已保存阅读位置：第 ${resumePage} 页`;content.append(position)}
      for(const {source,reason} of selectReadingRecap(recapData.sources,resumePage)){const row=document.createElement('article'),quote=document.createElement('blockquote');row.dataset.recapSource=source.id;row.dataset.recapReason=reason;
      if(reason!=='saved'){const context=document.createElement('span');context.className='pi-recap-context';context.textContent=reason==='nearby'?t('停留处附近'):t('最近笔记');row.append(context)}
      const text=source.originalText||source.translatedText||'';quote.textContent=text.length>220?text.slice(0,220)+'…':text;quote.hidden=!text.trim();row.append(quote);
      if(source.note){const note=document.createElement('p');note.className='pi-recap-note';note.textContent=t('个人笔记')+'：'+(source.note.length>180?source.note.slice(0,180)+'…':source.note);row.append(note)}
      if(source.href){const link=document.createElement('a');link.href=source.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.pageNumber?(source.endPageNumber&&source.endPageNumber>source.pageNumber?msg`第 ${source.pageNumber}–${source.endPageNumber} 页 · 查看出处`:msg`第 ${source.pageNumber} 页 · 查看出处`):t('查看出处');
        link.addEventListener('click',event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;if(hasReadingDraft()){event.preventDefault();event.stopImmediatePropagation();status.textContent=t('草稿仍保留，请先完成编辑再查看出处。')}});
        if(options.locate){link.addEventListener('click',event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();if(locating)return;clearReturns();locating=true;focus=link;focusId=source.id;void options.locate!(source,recapReturn).then(found=>{if(!current()||!dialog.open||dialog.hidden){clearReturns();return}if(found&&!hasReadingDraft())suspend();else{clearReturns();status.textContent=hasReadingDraft()?t('草稿仍保留，请先完成编辑再查看出处。'):t('当前原文位置已变化，笔记和小结仍保留。')}}).catch(error=>{clearReturns();if(current())status.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error))}).finally(()=>{locating=false})})}else reuseReadingSource(link);row.append(link)}content.append(row)}
    }
    close.addEventListener('click',()=>dialog.close());summary.addEventListener('click',()=>{suspend();child=openNoteSummary(target,{host:options.host,isCurrent:current,onReturn:resume,...(options.locate?{onLocateSource:options.locate}:{})});opened=child});
    dialog.addEventListener('close',()=>{if(pendingCloses){pendingCloses--;return}dispose()});window.addEventListener('pagehide',dispose);disposeRecap=dispose;
    render();dialog.showModal();close.focus({preventScroll:true});
  }
  async function tick():Promise<void>{
    if(disposed)return;if(targetKey()!==key){void refresh();return}if(notice)notice.hidden=blocked();
    if(!pending||offered||loading||claiming||Date.now()<due||blocked())return;
    const target=options.target(),current=epoch,kind=pending;if(!target)return;claiming=true;
    try{const result=await send<{show:boolean}>('claim',target);if(disposed||current!==epoch||targetKey()!==key)return;offered=true;pending=undefined;if(!result.show||blocked())return;
      const row=document.createElement('aside');row.className='pi-reading-hint';row.dataset.piReadingHint='';row.ariaLabel=t('阅读辅助');const text=document.createElement('span'),action=document.createElement('button'),ignore=document.createElement('button');action.type=ignore.type='button';
      text.textContent=kind==='organize'?t('已积累几处新标记，可以整理重点。'):t('本篇有已保存的阅读重点。');action.textContent=kind==='organize'?t('整理重点'):t('阅读回顾');ignore.textContent=t('忽略');ignore.className='pi-reading-ignore';ignore.title=ignore.ariaLabel=t('本篇不再自动提示');
      action.addEventListener('click',()=>{if(blocked())return;row.remove();notice=undefined;if(kind==='organize')showSummary(target,newReadingHighlights(highlights().map(source=>source.id),baseline));else recap(target)});
      ignore.addEventListener('click',()=>{row.remove();notice=undefined;void send('dismiss',target).catch(()=>undefined)});row.append(text,action,ignore);notice=row;options.host.append(row);
    }catch{offered=true;pending=undefined}finally{claiming=false}
  }
  const onChange=(changes:Record<string,unknown>,area:string)=>{if(area==='local'&&['piPdfReadingAnnotationsV1','piPdfTranslationMarkersV1','piPdfAreaNotesV1','piWebExcerptsV1'].some(name=>name in changes))void refresh(true)};
  // Capture existing marks at binding, before a quick first save becomes the baseline.
  void refresh();
  const timer=setInterval(()=>void tick(),500);browser.storage.onChanged.addListener(onChange);
  return {refresh,reset,dispose:()=>{disposed=true;reset();clearInterval(timer);browser.storage.onChanged.removeListener(onChange);style.remove()}};
}
