import { t,msg } from '../core/i18n/ui-language';
import {buildResearchReferenceIndex,researchReferenceMatches,type ResearchReferenceBlock,type ResearchReferenceTarget} from '../core/pdf/research-references';

export function bindPdfResearchReferences<T>(container:HTMLElement,back:HTMLButtonElement,options:{
  documentKey:()=>string;blocks:()=>readonly ResearchReferenceBlock[];
  capture:()=>T;restore:(state:T)=>void;navigate:(target:ResearchReferenceTarget)=>void;
  preview?:(target:ResearchReferenceTarget,host:HTMLElement,signal:AbortSignal)=>Promise<void>;
}):void{
  let identity='',frame=0;
  let previewDialog:HTMLDialogElement|undefined;
  const history:{state:T;origin:HTMLElement}[]=[];
  function decorate():void{
    frame=0;
    const next=options.documentKey();if(next!==identity){identity=next;history.length=0;back.hidden=true;previewDialog?.close()}
    const index=buildResearchReferenceIndex(options.blocks());
    const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT,{acceptNode(node){
      const parent=node.parentElement;
      return parent?.closest('.pdf-document-translation-block[data-status="done"]')&&
        !parent.closest('a,button,summary,math,mjx-container,code,pre,textarea,input,[data-translation-mode="review"],[data-translation-mode="preserved"],[data-reference-role="source"],[data-paper-role],.pdf-formula-reference-inline,.pdf-formula-reference-display,.pdf-formula-reference-review,.pdf-retranslation-note')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
    }});
    const nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);
    for(const node of nodes){
      const own=node.parentElement?.closest<HTMLElement>('[data-translation-block]')?.dataset.translationBlock;
      const matches=researchReferenceMatches(node.data,index).filter(match=>match.target.blockId!==own);
      if(!matches.length)continue;
      const fragment=document.createDocumentFragment();let offset=0;
      for(const match of matches){
        fragment.append(node.data.slice(offset,match.start));const link=document.createElement('button');link.type='button';link.className='pdf-research-reference';
        link.textContent=node.data.slice(match.start,match.end);link.dataset.referenceKey=JSON.stringify(match.target);link.title=msg`查看${match.target.label} · 第 ${match.target.pageNumber} 页`+(options.preview?` · ${t('Alt + 单击或 Alt + Enter 预览')}`:'');link.ariaLabel=link.title;
        fragment.append(link);offset=match.end;
      }
      fragment.append(node.data.slice(offset));node.replaceWith(fragment);
    }
  }
  new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(decorate)}).observe(container,{childList:true,subtree:true,characterData:true});
  function valid(target:ResearchReferenceTarget){return [...buildResearchReferenceIndex(options.blocks()).values()].some(item=>JSON.stringify(item)===JSON.stringify(target))}
  function showPreview(link:HTMLElement){
    if(!options.preview)return;
    const target=JSON.parse(link.dataset.referenceKey!) as ResearchReferenceTarget;if(!valid(target))return;
    previewDialog?.close();const key=options.documentKey(),dialog=document.createElement('dialog'),controller=new AbortController();previewDialog=dialog;dialog.className='pdf-reference-preview';dialog.ariaLabel=t('引用目标预览');
    const title=document.createElement('h2');title.textContent=msg`${target.label} · 第 ${target.pageNumber} 页`;
    const host=document.createElement('div');host.className='pdf-reference-preview-content';
    const status=document.createElement('p');status.role='status';status.textContent=t('正在读取来源…');
    const actions=document.createElement('div');actions.className='pdf-annotation-actions';const close=document.createElement('button'),jump=document.createElement('button');close.type=jump.type='button';close.textContent=t('关闭');jump.textContent=t('跳转到来源');actions.append(close,jump);dialog.append(title,host,status,actions);document.body.append(dialog);
    close.addEventListener('click',()=>dialog.close());jump.addEventListener('click',()=>{if(options.documentKey()!==key||!valid(target)){dialog.close();return}history.push({state:options.capture(),origin:link});if(history.length>20)history.shift();back.hidden=false;dialog.close();options.navigate(target)});
    dialog.addEventListener('close',()=>{controller.abort();for(const canvas of dialog.querySelectorAll('canvas'))canvas.width=canvas.height=0;dialog.remove();if(previewDialog===dialog)previewDialog=undefined;if(link.isConnected)link.focus({preventScroll:true})},{once:true});dialog.showModal();close.focus();
    void options.preview(target,host,controller.signal).then(()=>{status.textContent=''}).catch(error=>{if(!controller.signal.aborted)status.textContent=error instanceof Error?error.message:String(error)});
  }
  container.addEventListener('keydown',event=>{if(event.altKey&&event.key==='Enter'){const link=event.target instanceof Element?event.target.closest<HTMLElement>('.pdf-research-reference'):null;if(link){event.preventDefault();event.stopPropagation();showPreview(link)}}},true);
  container.addEventListener('click',event=>{
    const link=event.target instanceof Element?event.target.closest<HTMLElement>('.pdf-research-reference'):null;
    if(!link||!container.contains(link)||getSelection()?.toString())return;
    const target=JSON.parse(link.dataset.referenceKey!) as ResearchReferenceTarget;
    // Recheck against current source data; range changes can invalidate a link.
    if(!valid(target))return;
    if(event.altKey&&options.preview){event.preventDefault();event.stopPropagation();showPreview(link);return}
    event.preventDefault();event.stopPropagation();history.push({state:options.capture(),origin:link});if(history.length>20)history.shift();back.hidden=false;options.navigate(target);
  },true);
  back.addEventListener('click',()=>{if(options.documentKey()!==identity){history.length=0;back.hidden=true;return}const previous=history.pop();back.hidden=!history.length;if(!previous)return;options.restore(previous.state);if(previous.origin.isConnected)previous.origin.focus({preventScroll:true})});
}
