import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import {assertSummarySize,summaryCharacters,type NoteSummaryTarget,type NoteSummaryPreview,type NoteSummarySource,type NoteSummaryPoint} from '../core/content/note-summary';
import type {RuntimeMessage,RuntimeResponse} from '../core/messaging/messages';
import {layoutTaskDialog} from './task-dialog';
import {reuseReadingSource} from './reading-source-link';
import {hasReadingDraft,type ReadingSummaryReturn} from '../core/content/reading-navigation';
import styles from './note-summary.css?inline';
import type {PurposeId} from '../core/settings/purpose-preferences';

const readingSummaries=new WeakMap<HTMLElement|ShadowRoot,{key:string;dialog:HTMLDialogElement;resume:()=>void;dispose:()=>void}>();

/** Dispose only the summary owned by the caller's reading recap. */
export function disposeNoteSummary(host:HTMLElement|ShadowRoot,dialog:HTMLDialogElement):void{
  const session=readingSummaries.get(host);if(session?.dialog===dialog)session.dispose();
}

export function openNoteSummary(target:NoteSummaryTarget,options:{host?:HTMLElement|ShadowRoot;isCurrent?:()=>boolean;initialSelection?:readonly string[];onReturn?:()=>void;onSourceOpen?:()=>void;onLocateSource?:(source:NoteSummarySource,summaryReturn?:ReadingSummaryReturn)=>Promise<boolean>}={}):HTMLDialogElement{
  const host=options.host??document.body,origin=host instanceof ShadowRoot?host.activeElement:document.activeElement;
  const key=JSON.stringify(target),existing=readingSummaries.get(host);
  if(existing?.key===key){existing.resume();return existing.dialog}
  existing?.dispose();
  const dialog=document.createElement('dialog');dialog.className='pi-note-summary';dialog.ariaLabel=t('本篇笔记 AI 小结');
  const style=document.createElement('style');style.textContent=styles;
  const title=document.createElement('h2');title.textContent=t('本篇笔记 AI 小结');
  const explanation=document.createElement('p');explanation.textContent=t('只整理本篇已保存的摘录与笔记，不代表全文总结。未保存草稿不会发送，原资料不会改写。');
  const range=document.createElement('details'),rangeTitle=document.createElement('summary'),list=document.createElement('div');range.className='note-summary-range';rangeTitle.textContent=t('选择并预览发送内容');range.append(rangeTitle,list);
  const rangeActions=document.createElement('div'),selectAll=document.createElement('button'),clearAll=document.createElement('button');rangeActions.className='note-summary-actions';for(const button of [selectAll,clearAll])button.type='button';selectAll.textContent=t('全选');clearAll.textContent=t('清空选择');rangeActions.append(selectAll,clearAll);range.insertBefore(rangeActions,list);
  const purposeField=document.createElement('label'),purposeCaption=document.createElement('span'),purpose=document.createElement('select');purposeCaption.textContent=t('小结用途（仅本次）');purpose.ariaLabel=purposeCaption.textContent;for(const [value,label] of [['auto',t('跟随用途预设')],['research',t('科研')],['learning',t('外语学习')],['daily',t('日常阅读')]]){const option=document.createElement('option');option.value=value!;option.textContent=label!;purpose.append(option)}purposeField.className='note-summary-purpose';purposeField.append(purposeCaption,purpose);range.insertBefore(purposeField,list);
  const count=document.createElement('p'),result=document.createElement('section'),status=document.createElement('p');count.className='note-summary-count';result.className='note-summary-result';result.hidden=true;status.setAttribute('role','status');status.textContent=t('正在读取已保存笔记…');
  const actions=document.createElement('div'),close=document.createElement('button'),refresh=document.createElement('button'),copy=document.createElement('button'),generate=document.createElement('button');actions.className='note-summary-actions';for(const button of [close,refresh,copy,generate])button.type='button';close.textContent=options.onReturn?t('返回回顾'):t('关闭');refresh.textContent=t('重新预览');copy.textContent=t('复制小结');copy.hidden=true;generate.textContent=t('生成小结');generate.className='primary';generate.disabled=true;rangeActions.append(refresh);actions.append(close,copy,generate);
  layoutTaskDialog(dialog,title,[explanation,count,range,result],actions,status);dialog.append(style);host.append(dialog);
  let preview:NoteSummaryPreview|undefined,busy=false,cancelling=false,requestId:string|undefined,revision=0,closed=false,markdown='',suspended=false,pendingSuspendCloses=0,bodyScrollTop=0,previewStale=false,validating=false,validateAgain=false;
  let sourceFocus:HTMLElement|undefined;
  const returnCleanups=new Set<()=>void>();
  const clearReturns=()=>{for(const cleanup of returnCleanups)cleanup();returnCleanups.clear()};
  const checks=new Map<string,HTMLInputElement>();
  const current=()=>options.isCurrent?.()??true;
  const selected=()=>preview?.sources.filter(source=>checks.get(source.id)?.checked)??[];
  const send=async<T>(message:RuntimeMessage):Promise<T>=>{const response=await browser.runtime.sendMessage(message) as RuntimeResponse<T>;if(!response.ok)throw new Error(response.error.message);return response.data};
  function update():void{
    const sources=selected();generate.disabled=busy||!preview||previewStale;refresh.disabled=busy;for(const check of checks.values())check.disabled=busy;
    selectAll.disabled=clearAll.disabled=busy||!preview;
    purpose.disabled=busy||!preview;
    if(preview){const selectedPurpose=purpose.value==='auto'?preview.purpose:purpose.value,label=selectedPurpose==='research'?t('科研'):selectedPurpose==='learning'?t('外语学习'):t('日常阅读');count.textContent=msg`${sources.length} 条 · ${summaryCharacters(sources)} 字符 · ${preview.model} · ${preview.targetLanguage} · ${label}`;try{assertSummarySize(sources)}catch(error){generate.disabled=true;if(!busy)status.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error))}}
    close.textContent=busy&&!cancelling?t('取消生成'):options.onReturn?t('返回回顾'):t('关闭');close.disabled=false;
  }
  async function load():Promise<void>{
    const epoch=++revision;previewStale=false;status.textContent=t('正在读取已保存笔记…');generate.disabled=refresh.disabled=true;
    try{const next=await send<NoteSummaryPreview>({type:'PREVIEW_NOTE_SUMMARY',payload:{target}});if(closed||epoch!==revision)return;if(!current())throw new Error('文档已切换，请从当前文档重新打开小结。');preview=next;checks.clear();list.replaceChildren();
      for(const source of preview.sources){const label=document.createElement('label'),check=document.createElement('input'),description=document.createElement('div'),heading=document.createElement('strong'),text=document.createElement('div');check.type='checkbox';check.checked=options.initialSelection?.includes(source.id)??true;check.ariaLabel=source.pageNumber?msg`第 ${source.pageNumber} 页：${source.title}`:source.title;checks.set(source.id,check);heading.textContent=check.ariaLabel;text.className='note-summary-source-preview';text.textContent=[source.originalText,source.translatedText,source.note?`${t('个人笔记')}：${source.note}`:''].filter(Boolean).join('\n\n');description.append(heading,text);label.append(check,description);list.append(label);check.addEventListener('change',()=>{status.textContent='';update()})}
      status.textContent=t('点击生成后，仅将勾选内容发送到当前文字接口；可能产生 API 费用，不自动重试。');
    }catch(error){if(!closed&&epoch===revision){preview=undefined;range.open=true;status.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error))}}finally{if(!closed&&epoch===revision){refresh.disabled=false;update()}}
  }
  const cancel=()=>{if(requestId&&!cancelling){cancelling=true;status.textContent=t('正在取消生成，原笔记未改变。');update();void send({type:'CANCEL_NOTE_SUMMARY',payload:{requestId}}).catch(()=>undefined)}};
  const returnToRecap=()=>{if(!current()){dispose();return}clearReturns();const active=host instanceof ShadowRoot?host.activeElement:document.activeElement;sourceFocus=active instanceof HTMLElement&&dialog.contains(active)?active:close;suspend();options.onReturn?.()};
  close.addEventListener('click',()=>{if(busy&&!cancelling)cancel();else if(options.onReturn)returnToRecap();else dialog.close()});refresh.addEventListener('click',()=>{close.focus({preventScroll:true});void load()});
  for(const [button,value] of [[selectAll,true],[clearAll,false]] as const)button.addEventListener('click',()=>{for(const check of checks.values())check.checked=value;status.textContent='';update()});
  purpose.addEventListener('change',update);
  function dispose():void{
    if(closed)return;closed=true;revision++;cancel();clearReturns();clearInterval(timer);window.removeEventListener('pagehide',dispose);window.removeEventListener('focus',validateWhenVisible);document.removeEventListener('visibilitychange',validateWhenVisible);browser.storage.onChanged.removeListener(onSavedChange);
    if(readingSummaries.get(host)?.dialog===dialog)readingSummaries.delete(host);
    dialog.remove();if(origin instanceof HTMLElement&&origin.isConnected)origin.focus({preventScroll:true});
  }
  function resume():void{
    if(closed)return;if(!current()||!host.isConnected){dispose();return}
    clearReturns();if(!dialog.isConnected)host.append(dialog);
    suspended=false;dialog.hidden=false;if(!dialog.open)dialog.showModal();
    dialog.querySelector<HTMLElement>('.pi-task-body')!.scrollTop=bodyScrollTop;
    (sourceFocus?.isConnected?sourceFocus:close).focus({preventScroll:true});
    validatePreview();
  }
  function validatePreview():void{
    if(closed||!preview||busy||!current())return;
    if(validating){validateAgain=true;return}
    const epoch=revision;validating=true;validateAgain=false;
    void send<NoteSummaryPreview>({type:'PREVIEW_NOTE_SUMMARY',payload:{target}}).then(next=>{
      if(closed||epoch!==revision||!current()||!preview)return;
      if(next.configuration!==preview.configuration||JSON.stringify(next.sources.map(({id,revision})=>({id,revision})))!==JSON.stringify(preview.sources.map(({id,revision})=>({id,revision})))){
        previewStale=true;range.open=true;status.textContent=t('笔记或接口已变化，本次小结仍保留；重新生成前请重新预览。');update();
      }
    }).catch(()=>{/* Keep the snapshot; generation still revalidates before any model call. */}).finally(()=>{validating=false;if(validateAgain){validateAgain=false;validatePreview()}});
  }
  function validateWhenVisible():void{if(dialog.open&&!suspended&&markdown&&document.visibilityState!=='hidden')validatePreview()}
  function onSavedChange(changes:Record<string,unknown>,area:string):void{
    if(area==='local'&&markdown&&['piPdfReadingAnnotationsV1','piPdfAreaNotesV1','piPdfTranslationMarkersV1','piWebExcerptsV1','extensionSettings'].some(key=>key in changes))validatePreview();
  }
  const summaryReturn:ReadingSummaryReturn={resume,onCancel:cleanup=>{if(closed)cleanup();else returnCleanups.add(cleanup)}};
  function suspend():void{
    bodyScrollTop=dialog.querySelector<HTMLElement>('.pi-task-body')!.scrollTop;
    suspended=true;dialog.hidden=true;if(dialog.open){pendingSuspendCloses++;dialog.close()}
  }
  window.addEventListener('pagehide',dispose);
  window.addEventListener('focus',validateWhenVisible);document.addEventListener('visibilitychange',validateWhenVisible);
  browser.storage.onChanged.addListener(onSavedChange);
  const timer=setInterval(()=>{if(!host.isConnected||!current()){if(suspended||!host.isConnected){dispose();return}cancel();if(!busy)generate.disabled=true;status.textContent=t('文档已切换，请从当前文档重新打开小结。')}},400);
  dialog.addEventListener('close',()=>{if(pendingSuspendCloses){pendingSuspendCloses--;return}dispose()});
  readingSummaries.set(host,{key,dialog,resume,dispose});
  dialog.addEventListener('cancel',event=>{if(options.onReturn){event.preventDefault();if(busy&&!cancelling)cancel();else returnToRecap()}else cancel()});
  generate.addEventListener('click',()=>{
    if(busy||!preview||previewStale)return;if(!current()){status.textContent=t('文档已切换，请从当前文档重新打开小结。');return}
    const sources=selected();try{assertSummarySize(sources)}catch(error){status.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error));return}
    busy=true;cancelling=false;requestId=crypto.randomUUID();const submitted=requestId,configuration=preview.configuration;status.textContent=t('正在生成小结…');update();close.focus({preventScroll:true});
    void send<{points:NoteSummaryPoint[];sources:NoteSummarySource[]}>({type:'GENERATE_NOTE_SUMMARY',payload:{target,requestId:submitted,configuration,selections:sources.map(({id,revision})=>({id,revision})),...(purpose.value!=='auto'?{purpose:purpose.value as PurposeId}:{})}}).then(data=>{
      if(closed||cancelling||!current()||requestId!==submitted)return;
      result.replaceChildren();result.hidden=false;const heading=document.createElement('h3');heading.textContent=t('本次摘录小结');const hint=document.createElement('p');hint.className='note-summary-snapshot';hint.textContent=t('AI 整理，仅基于本次选中的已保存内容；请结合出处核对。');result.append(heading,hint);const lines=[`# ${t('本次摘录小结')}`,'',hint.textContent,''];
      for(const kind of ['source','note'] as const){const points=data.points.filter(point=>point.kind===kind);if(!points.length)continue;const group=document.createElement('h4');group.textContent=kind==='source'?t('原文要点'):t('个人笔记整理');result.append(group);lines.push(`## ${group.textContent}`,'');for(const point of points){const row=document.createElement('article'),text=document.createElement('p'),links=document.createElement('div');text.textContent=point.text;links.className='note-summary-sources';row.append(text,links);const references:string[]=[];
        for(const id of point.sources){const source=data.sources[Number(id.slice(1))-1];if(!source)continue;const label=source.pageNumber?msg`第 ${source.pageNumber} 页 · ${source.title}`:source.title;if(source.href){const link=document.createElement('a');link.href=source.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=label;
          if(options.onLocateSource){let locating=false;link.addEventListener('click',event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();if(locating)return;if(hasReadingDraft()){status.textContent=t('未保存草稿仍保留；请先关闭小结处理草稿，再定位出处。');return}clearReturns();locating=true;sourceFocus=link;link.setAttribute('aria-busy','true');void options.onLocateSource!(source,summaryReturn).then(located=>{if(closed||!current())return;if(located&&hasReadingDraft()){clearReturns();status.textContent=t('未保存草稿仍保留；请先关闭小结处理草稿，再定位出处。');return}if(located){suspend();options.onSourceOpen?.()}else{clearReturns();status.textContent=t('当前原文位置已变化，笔记和小结仍保留。')}}).catch(error=>{clearReturns();if(!closed)status.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error))}).finally(()=>{locating=false;link.removeAttribute('aria-busy')})})}else reuseReadingSource(link);links.append(link);references.push(`[${label.replace(/[\[\]]/gu,'')}](${source.href})`)}else{const span=document.createElement('span');span.textContent=label;links.append(span);references.push(label)}}
        lines.push(`- ${point.text}`,`  ${references.join(' · ')}`);result.append(row)}lines.push('')}
      markdown=lines.join('\n');copy.hidden=!data.points.length;copy.className='primary';generate.className='';generate.textContent=t('重新生成');rangeActions.append(generate);range.open=false;explanation.hidden=true;status.textContent=data.points.length?t('小结已生成，原笔记未改变。'):t('当前材料不足以形成可靠小结，未改写原笔记。');
      const body=dialog.querySelector<HTMLElement>('.pi-task-body')!;body.scrollTop+=result.getBoundingClientRect().top-body.getBoundingClientRect().top-8;
    }).catch(error=>{if(!closed&&!cancelling){range.open=true;status.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error))}}).finally(()=>{if(requestId===submitted){busy=false;requestId=undefined;const wasCancelled=cancelling;cancelling=false;if(!closed){if(wasCancelled)status.textContent=t('小结已取消，原笔记未改变。');update()}}});
  });
  copy.addEventListener('click',()=>{void navigator.clipboard.writeText(markdown).then(()=>{status.textContent=t('已复制')}).catch(()=>{status.textContent=t('复制失败，请检查剪贴板权限')})});
  dialog.showModal();close.focus({preventScroll:true});void load();return dialog;
}
