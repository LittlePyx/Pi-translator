import {buildResearchReferenceIndex,researchReferenceMatches,type ResearchReferenceBlock,type ResearchReferenceTarget} from '../core/pdf/research-references';

export function bindPdfResearchReferences<T>(container:HTMLElement,back:HTMLButtonElement,options:{
  documentKey:()=>string;blocks:()=>readonly ResearchReferenceBlock[];
  capture:()=>T;restore:(state:T)=>void;navigate:(target:ResearchReferenceTarget)=>void;
}):void{
  let identity='',frame=0;
  const history:{state:T;origin:HTMLElement}[]=[];
  function decorate():void{
    frame=0;
    const next=options.documentKey();if(next!==identity){identity=next;history.length=0;back.hidden=true}
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
        link.textContent=node.data.slice(match.start,match.end);link.dataset.referenceKey=JSON.stringify(match.target);link.title=`查看${match.target.label} · 第 ${match.target.pageNumber} 页`;link.ariaLabel=link.title;
        fragment.append(link);offset=match.end;
      }
      fragment.append(node.data.slice(offset));node.replaceWith(fragment);
    }
  }
  new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(decorate)}).observe(container,{childList:true,subtree:true,characterData:true});
  container.addEventListener('click',event=>{
    const link=event.target instanceof Element?event.target.closest<HTMLElement>('.pdf-research-reference'):null;
    if(!link||!container.contains(link)||getSelection()?.toString())return;
    const target=JSON.parse(link.dataset.referenceKey!) as ResearchReferenceTarget;
    // Recheck against current source data; range changes can invalidate a link.
    if(![...buildResearchReferenceIndex(options.blocks()).values()].some(item=>JSON.stringify(item)===JSON.stringify(target)))return;
    event.preventDefault();event.stopPropagation();history.push({state:options.capture(),origin:link});if(history.length>20)history.shift();back.hidden=false;options.navigate(target);
  },true);
  back.addEventListener('click',()=>{if(options.documentKey()!==identity){history.length=0;back.hidden=true;return}const previous=history.pop();back.hidden=!history.length;if(!previous)return;options.restore(previous.state);if(previous.origin.isConnected)previous.origin.focus({preventScroll:true})});
}
