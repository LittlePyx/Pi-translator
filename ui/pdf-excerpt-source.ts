import {t} from '../core/i18n/ui-language';
import {revealPdfSource} from './pdf-source-location';
import {listResearchExcerpts} from '../core/content/research-excerpt-repository';
import {rangeFromTextQuote} from '../core/content/session-translation-markers';
import {pdfReadingStateId} from '../core/pdf/reading-state';
import {rotatePdfViewRect,type PdfViewRotation} from '../core/pdf/reader-view';
import {hasReadingDraft,type ReadingSummaryReturn} from '../core/content/reading-navigation';

/** Resolve an existing record by ID, then verify the selected file before locating it. */
export function bindPdfExcerptSource(options:{
  empty:HTMLElement;viewer:HTMLElement;
  current:()=>{fingerprint:string;identity:string|undefined;rotation:PdfViewRotation}|undefined;
  navigate:(page:number,remember?:boolean,summaryReturn?:ReadingSummaryReturn)=>Promise<void>;notice:(text:string)=>void;
  openCopy?:(id:string,canOpen:()=>boolean)=>Promise<boolean>;
  canAutoOpen?:()=>boolean;
}){
  let requested=new URL(location.href).searchParams.get('excerpt');
  const read=async(id=requested)=>{
    if(!id)return undefined;
    const item=(await listResearchExcerpts()).find(item=>item.id===id);
    if(!item||item.kind!=='pdf')throw new Error(t('这条资料已移除或无法读取，原有文件未改变。'));
    return item;
  };
  async function prepare():Promise<void>{
    if(!requested)return;
    try{
      const item=await read();if(!item)return;
      // Stored copies are keyed and verified by content identity. Legacy note
      // identities therefore stay on the explicit file-selection path.
      try{
        if(options.openCopy&&await options.openCopy(item.documentId,()=>!options.current()&&!hasReadingDraft()&&(options.canAutoOpen?.()??true)))return;
      }catch(error){if(options.canAutoOpen?.()??true)options.notice(error instanceof Error?error.message:String(error))}
      if(options.current()||!(options.canAutoOpen?.()??true))return;
      options.empty.querySelector('h1')!.textContent=t('选择原 PDF 定位资料');
      options.empty.querySelector('p')!.textContent=t('核验文件后返回原文位置；不会重新翻译或修改笔记。');
      const preview=document.createElement('div');preview.className='pdf-excerpt-source-preview';
      const title=document.createElement('strong'),quote=document.createElement('blockquote');title.textContent=item.content.sourceTitle;quote.textContent=item.content.originalText;
      preview.append(title,quote);
      if(item.content.note){const note=document.createElement('p');note.textContent=item.content.note;preview.append(note)}
      options.empty.querySelector('button')!.before(preview);
    }catch(error){options.notice(error instanceof Error?error.message:String(error))}
  }
  async function locate(id:string,reuse=false,summaryReturn?:ReadingSummaryReturn):Promise<{matched:boolean;draft?:true}>{
    try{
      const item=await read(id),current=options.current();if(!item||!current)return {matched:false};
      // Legacy filename/size/time identities remain available after explicit file
      // selection, but cannot prove content identity for automatic window reuse.
      const ids=await Promise.all([pdfReadingStateId(`pdf-content:${current.fingerprint}`),...(!reuse&&current.identity?[pdfReadingStateId(current.identity)]:[])]);
      if(options.current()?.fingerprint!==current.fingerprint)return {matched:false};
      if(!ids.includes(item.documentId)){
        if(!reuse)options.notice(t('所选 PDF 与这条资料的文件身份不符，请选择原文件；原记录未改变。'));return {matched:false};
      }
      if(reuse&&hasReadingDraft())return {matched:true,draft:true};
      const anchor='area' in item?item.area.anchor:'annotation' in item?item.annotation.anchor:item.marker.anchor;
      await options.navigate(anchor.pageNumber,reuse,summaryReturn);
      if(options.current()?.fingerprint!==current.fingerprint)return {matched:false};
      const page=options.viewer.querySelector<HTMLElement>(`.pdf-page[data-page-number="${anchor.pageNumber}"]`);
      if(!page){options.notice(t('原页码在此文件中不存在，已保存的资料仍保留。'));return {matched:true}}
      const boxes:{left:number;top:number;width:number;height:number}[]=[];
      if(anchor.kind==='text-quote'){
        const text=page.querySelector('.textLayer'),range=text?rangeFromTextQuote(text,anchor.sourceText,anchor.prefix,anchor.suffix):undefined;
        if(range){
          // Keep the passage near the reading point. Centering a quote at the
          // top of a page can expose mostly the preceding page and select it.
          if(range.startContainer.parentElement)revealPdfSource(options.viewer,range.startContainer.parentElement);
          const base=page.getBoundingClientRect(),scale=base.width/page.offsetWidth;
          for(const rect of range.getClientRects())if(rect.width>.5&&rect.height>.5)boxes.push({left:(rect.left-base.left)/scale,top:(rect.top-base.top)/scale,width:rect.width/scale,height:rect.height/scale});
        }
      }else{
        const rect=rotatePdfViewRect(anchor,current.rotation);
        boxes.push({left:rect.leftRatio*page.clientWidth,top:rect.topRatio*page.clientHeight,width:rect.widthRatio*page.clientWidth,height:rect.heightRatio*page.clientHeight});
      }
      const marks=boxes.map(box=>{
        const mark=document.createElement('div');mark.className='region-source-highlight';mark.dataset.librarySource=item.markerId;mark.ariaHidden='true';
        Object.assign(mark.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});page.append(mark);return mark;
      });
      if(anchor.kind==='region'&&marks[0])revealPdfSource(options.viewer,marks[0]);
      setTimeout(()=>marks.forEach(mark=>mark.remove()),8000);
      options.notice(boxes.length?t('已定位原文，资料与笔记未改变。'):t('暂时无法精确定位，已返回记录页码；原文与笔记仍保留。'));
      return {matched:true};
    }catch(error){if(!reuse)options.notice(error instanceof Error?error.message:String(error));return {matched:false}}
  }
  async function restore():Promise<void>{
    if(!requested)return;
    if((await locate(requested)).matched){
      requested=null;
      const url=new URL(location.href);url.searchParams.delete('excerpt');history.replaceState(null,'',url);
    }
  }
  return {prepare,restore,tryReuse:(id:string,summaryReturn?:ReadingSummaryReturn)=>locate(id,true,summaryReturn)};
}
