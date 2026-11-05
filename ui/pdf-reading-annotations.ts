import {dialogReturnTarget} from './dialog-navigation';
import {openNoteSummary} from './note-summary';
import {fillMissingCitationFields} from '../core/content/local-citation';
import type {CitationMetadata} from '../core/content/citation-metadata';
import {PDF_AREA_NOTES_KEY} from '../core/pdf/area-note-repository';
import {revealPdfSource} from './pdf-source-location';
import {createPdfAreaNotes} from './pdf-area-notes';
import type {PdfAreaAnchor} from '../core/pdf/area-note-repository';
import {t,msg} from '../core/i18n/ui-language';
import {showUndoNotice} from './action-feedback';
import {rangeFromTextQuote,buildTranslationMarkerMarkdown} from '../core/content/session-translation-markers';
import {citationUrl} from '../core/content/excerpt-citation';
import {pdfReadingStateId} from '../core/pdf/reading-state';
import {PDF_READING_ANNOTATIONS_KEY,getPdfReadingAnnotations,mutatePdfReadingAnnotation,pdfReadingAnnotationAnchors,pdfReadingAnnotationText,pdfReadingAnnotationEndPage,type PdfReadingAnnotation} from '../core/pdf/reading-annotation-repository';
import {capturePdfReadingAnnotation} from '../core/pdf/reading-annotation-selection';
import {bindAnchoredMenus} from './anchored-menu';

interface DocumentContext { identity: string; title: string; url: string; citation?:CitationMetadata }
export function bindPdfReadingAnnotations(options:{
  viewer:HTMLElement;
  modeHost:HTMLElement;
  currentDocument:()=>DocumentContext|undefined;
  navigate:(page:number)=>Promise<void>;
  rotation?:()=>number;
  notice:(text:string,transient?:boolean)=>void;
  onModeChange:(enabled:boolean)=>Promise<void>;
  onNewProjectNote?:(kind:'pdf-note'|'pdf-area',documentId:string,noteId:string)=>Promise<string|undefined>;
}) {
  const dialog=document.createElement('dialog');dialog.id='pdf-annotations-dialog';dialog.className='pdf-annotations-dialog';dialog.setAttribute('aria-labelledby','pdf-annotations-title');
  const heading=document.createElement('header'),title=document.createElement('strong'),close=document.createElement('button');
  const headingCopy=document.createElement('div'),documentLabel=document.createElement('p');documentLabel.className='pdf-annotation-document';
  title.id='pdf-annotations-title';title.textContent=t('阅读批注');close.type='button';close.className='pdf-annotation-close';close.append(icon('close'));close.title=close.ariaLabel=t('关闭阅读批注');headingCopy.append(title,documentLabel);heading.append(headingCopy,close);
  const help=document.createElement('footer');help.className='pdf-annotation-help';help.textContent=t('仅本机保存 · 不改动原 PDF');help.title=t('仅保存在本机，不改动原 PDF。可在设置的摘录管理中检索，并随文档库一起备份。');
  help.hidden=true;help.id='pdf-annotation-storage-help';title.title=help.title;dialog.setAttribute('aria-describedby',help.id);
  const body=document.createElement('div');body.className='pdf-annotations-body';dialog.append(heading,body,help);document.body.append(dialog);
  bindAnchoredMenus('#pdf-annotations-dialog .pdf-annotation-menu',':scope > div');
  const areas=createPdfAreaNotes({viewer:options.viewer,current:options.currentDocument,rotation:options.rotation??(()=>0),navigate:options.navigate,notice:options.notice,...(options.onNewProjectNote?{onNewProjectNote:options.onNewProjectNote}:{})});
  let records:PdfReadingAnnotation[]=[], loadedIdentity:string|undefined, revision=0, frame:number|undefined;
  let draft:{document:DocumentContext;expected?:PdfReadingAnnotation;item:PdfReadingAnnotation}|undefined;
  let busy=false,returnFocus:HTMLElement|undefined;
  let annotationMode=false;
  const mode=button(t('批注'),()=>{
    mode.disabled=true;
    const next=!annotationMode;
    void options.onModeChange(next).then(()=>{
      annotationMode=next;refreshMode();
      options.notice(annotationMode?t('批注模式：选文只显示高亮与笔记，不自动翻译。'):t('已结束批注模式；继续翻译请重新打开连续翻译。'),true);
    }).catch(error=>options.notice(error instanceof Error?error.message:String(error))).finally(refreshMode);
  });mode.id='pdf-annotation-mode';mode.hidden=true;options.modeHost.append(mode);
  function refreshMode():void{
    mode.hidden=!options.currentDocument();mode.disabled=mode.hidden;
    mode.dataset.piIcon='glyph';mode.replaceChildren(icon('edit'),document.createTextNode(annotationMode?t('批注中'):t('批注')));mode.ariaLabel=annotationMode?t('结束批注'):t('开始批注');
    mode.title=annotationMode?t('结束批注'):t('开始批注：选文不会自动翻译');mode.setAttribute('aria-pressed',String(annotationMode));
  }
  close.addEventListener('click',()=>{if(!busy)dialog.close()});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
  dialog.addEventListener('close',()=>{draft=undefined;returnFocus?.focus({preventScroll:true})});
  function button(label:string,action:()=>void):HTMLButtonElement {
    const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);return b;
  }
  function icon(kind:'close'|'more'|'copy'|'check'|'locate'|'edit'):SVGSVGElement {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','16');svg.setAttribute('height','16');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
    const paths={close:'m6 6 12 12M6 18 18 6',more:'M5 12h.01M12 12h.01M19 12h.01',copy:'M9 9h11v11H9zM15 5V3H3v12h2',check:'m5 12 4 4L19 6',locate:'M7 17 17 7M7 7h10v10',edit:'m15 5 4 4M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z'};
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[kind]);svg.append(path);return svg;
  }
  function show():void {
    const name=options.currentDocument()?.title??'';documentLabel.textContent=name;documentLabel.title=name;
    if(!dialog.open){returnFocus=dialogReturnTarget();dialog.showModal()}
  }
  function schedulePaint():void {
    if(frame!==undefined)return;
    frame=requestAnimationFrame(()=>{frame=undefined;paint()});
  }
  function paint():void {
    areas.paint();
    const doc=options.currentDocument();
    options.viewer.querySelectorAll('.pdf-reading-highlight-layer').forEach(el=>el.remove());
    if(!doc||doc.identity!==loadedIdentity)return;
    for(const page of options.viewer.querySelectorAll<HTMLElement>('.pdf-page[data-rendered="ready"]')){
      const text=page.querySelector('.textLayer');if(!text)continue;
      const annotations=records.flatMap(item=>pdfReadingAnnotationAnchors(item).filter(anchor=>anchor.pageNumber===Number(page.dataset.pageNumber)).map(anchor=>({item,anchor})));if(!annotations.length)continue;
      const layer=document.createElement('div');layer.className='pdf-reading-highlight-layer';layer.ariaHidden='true';
      const base=page.getBoundingClientRect(),scale=base.width/page.offsetWidth;
      for(const {item,anchor} of annotations){
        const range=rangeFromTextQuote(text,anchor.sourceText,anchor.prefix,anchor.suffix);if(!range)continue;
        for(const rect of range.getClientRects()){
          if(rect.width<.5||rect.height<.5)continue;
          const mark=document.createElement('span');mark.dataset.annotationId=item.id;
          Object.assign(mark.style,{left:`${(rect.left-base.left)/scale}px`,top:`${(rect.top-base.top)/scale}px`,width:`${rect.width/scale}px`,height:`${rect.height/scale}px`});layer.append(mark);
        }
      }
      page.append(layer);
    }
  }
  async function reload():Promise<void> {
    const doc=options.currentDocument(),current=++revision;
    if(!doc){loadedIdentity=undefined;records=[];schedulePaint();return}
    const next=await getPdfReadingAnnotations(doc.identity);await areas.reload();
    if(current!==revision||options.currentDocument()?.identity!==doc.identity)return;
    records=next;loadedIdentity=doc.identity;schedulePaint();
    refreshMode();
    if(dialog.open&&!draft)renderList();
  }
  async function locate(item:PdfReadingAnnotation,pageNumber=item.anchor.pageNumber):Promise<void> {
    const identity=loadedIdentity;if(!identity||identity!==options.currentDocument()?.identity)return;
    const anchor=pdfReadingAnnotationAnchors(item).find(a=>a.pageNumber===pageNumber);if(!anchor)return;
    dialog.close();await options.navigate(anchor.pageNumber);
    if(identity!==options.currentDocument()?.identity)return;
    paint();
    const text=options.viewer.querySelector(`.pdf-page[data-page-number="${anchor.pageNumber}"] .textLayer`);
    const range=text?rangeFromTextQuote(text,anchor.sourceText,anchor.prefix,anchor.suffix):undefined;
    const rect=range?.getBoundingClientRect();
    if(!rect||rect.height<.5){options.notice(t('这条批注暂时无法精确定位，已返回记录页码。原文与笔记仍保留。'));return}
    const page=text!.closest<HTMLElement>('.pdf-page')!;
    const marker=page.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(item.id)}"]`);
    if(marker)revealPdfSource(options.viewer,marker);schedulePaint();
  }
  function renderList():void {
    body.replaceChildren();
    const tools=document.createElement('div');tools.className='pdf-annotation-toolbar';
    const count=document.createElement('span');count.textContent=String(records.length);count.title=count.ariaLabel=msg`${records.length} / 100 条阅读批注`;tools.append(count);body.append(tools);
    const summary=button(t('本篇笔记小结…'),()=>{const doc=options.currentDocument();if(!doc)return;summary.disabled=true;void pdfReadingStateId(doc.identity).then(documentId=>{if(options.currentDocument()?.identity===doc.identity)openNoteSummary({kind:'pdf',documentId},{isCurrent:()=>options.currentDocument()?.identity===doc.identity,onSourceOpen:()=>{if(!draft)dialog.close()}})}).catch(error=>showError(body,error)).finally(()=>{summary.disabled=false})});summary.className='note-summary-action';tools.append(summary);
    const areaCount=areas.appendList(body,()=>dialog.close());count.textContent=String(records.length+areaCount);if(areaCount)count.title=count.ariaLabel=msg`${records.length} 条文字批注 · ${areaCount} 条区域笔记`;
    if(!records.length){if(areaCount)return;const empty=document.createElement('div');empty.className='pdf-annotation-empty';const label=document.createElement('strong');label.textContent=t('留下阅读时的想法');const instruction=document.createElement('p');instruction.textContent=t('选中 PDF 原文后，点击“高亮 / 笔记”保存。');empty.append(label,instruction);body.append(empty);return}
    const copy=button(t('复制全部'),()=>{
      const text=buildTranslationMarkerMarkdown(records.map(item=>({...item,originalText:pdfReadingAnnotationText(item),pageNumber:item.anchor.pageNumber,...(item.continuations?{endPageNumber:pdfReadingAnnotationEndPage(item)}:{})})));
      void navigator.clipboard.writeText(text).then(()=>{copy.replaceChildren(icon('check'),document.createTextNode(t('已复制')));copy.title=copy.ariaLabel=t('已复制');setTimeout(()=>{if(copy.isConnected){copy.replaceChildren(icon('copy'),document.createTextNode(t('复制全部')));copy.title=copy.ariaLabel=t('复制批注（含出处）')}},1800)}).catch(error=>showError(body,error));
    });copy.className='pdf-annotation-copy';copy.dataset.piIcon='glyph';copy.title=copy.ariaLabel=t('复制批注（含出处）');copy.prepend(icon('copy'));tools.append(copy);
    for(const item of [...records].sort((a,b)=>a.anchor.pageNumber-b.anchor.pageNumber||a.createdAt-b.createdAt)){
      const row=document.createElement('article');row.className='pdf-reading-annotation';row.dataset.annotationId=item.id;
      const meta=document.createElement('div');meta.className='pdf-annotation-meta';const label=document.createElement('small');label.className='pdf-annotation-page';label.textContent=pageLabel(item);
      const quote=document.createElement('blockquote');quote.textContent=pdfReadingAnnotationText(item);
      const note=document.createElement('p');note.className='pdf-reading-annotation-note';note.textContent=item.note??'';note.hidden=!item.note;
      const noteLabel=document.createElement('span');noteLabel.className='pdf-annotation-note-label';noteLabel.textContent=t('笔记');noteLabel.hidden=true;
      const actions=document.createElement('div');actions.className='pdf-annotation-actions';
      const edit=button(t('编辑笔记'),()=>{const doc=options.currentDocument();if(doc){draft={document:doc,expected:item,item};renderEditor()}});
      edit.className='pdf-annotation-edit';edit.dataset.piIcon='glyph';edit.title=edit.ariaLabel=t('编辑笔记');edit.prepend(icon('edit'));
      const more=document.createElement('details');more.className='pdf-annotation-menu';const summary=document.createElement('summary');summary.ariaLabel=t('批注更多操作');summary.title=t('批注更多操作');summary.append(icon('more'));const menu=document.createElement('div');
      const remove=button(t('删除'),()=>{
        if(remove.dataset.confirm!=='true'){remove.dataset.confirm='true';remove.textContent=t('确认删除');return}
        const doc=options.currentDocument();if(!doc)return;remove.disabled=true;
        void pdfReadingStateId(doc.identity).then(async id=>{await mutatePdfReadingAnnotation(id,undefined,item);await reload();showUndoNotice(t('批注已删除'),async()=>{await mutatePdfReadingAnnotation(id,item);await reload()})}).catch(error=>{remove.disabled=false;showError(row,error)});
      });
      remove.className='pdf-annotation-delete';more.addEventListener('toggle',()=>{if(!more.open){delete remove.dataset.confirm;remove.textContent=t('删除')}});menu.append(remove);more.append(summary,menu);meta.append(label,more);
      remove.addEventListener('blur',()=>{delete remove.dataset.confirm;remove.textContent=t('删除')});
      const pageSelect=document.createElement('select');pageSelect.className='pdf-annotation-page-select';pageSelect.ariaLabel=t('批注页码');
      if(item.continuations){for(const anchor of pdfReadingAnnotationAnchors(item)){const option=document.createElement('option');option.value=String(anchor.pageNumber);option.textContent=msg`第 ${anchor.pageNumber} 页`;pageSelect.append(option)}actions.append(pageSelect)}
      const locateButton=button(t('定位原文'),()=>{void locate(item,item.continuations?Number(pageSelect.value):item.anchor.pageNumber).catch(error=>options.notice(String(error)))});locateButton.className='pdf-annotation-locate';locateButton.dataset.piIcon='glyph';locateButton.title=locateButton.ariaLabel=t('定位原文');locateButton.append(icon('locate'));actions.append(locateButton,edit);
      row.append(meta,noteLabel,note,quote,actions);body.append(row);
    }
  }
  function showError(container:HTMLElement,error:unknown):void {
    let message=container.querySelector<HTMLElement>('.pdf-annotation-error');
    if(!message){message=document.createElement('p');message.className='pdf-annotation-error';message.setAttribute('role','status');container.append(message)}
    message.textContent=error instanceof Error?error.message:String(error);
  }
  function pageLabel(item:PdfReadingAnnotation):string{return item.continuations?msg`第 ${item.anchor.pageNumber}–${pdfReadingAnnotationEndPage(item)} 页`:msg`第 ${item.anchor.pageNumber} 页`}
  function renderEditor():void {
    const active=draft;if(!active)return;body.replaceChildren();
    const form=document.createElement('form');form.className='pdf-annotation-editor';
    const source=document.createElement('blockquote');source.textContent=pdfReadingAnnotationText(active.item);
    const page=document.createElement('small');page.className='pdf-annotation-page';page.textContent=pageLabel(active.item);
    const label=document.createElement('label');label.textContent=t('个人笔记（可选）');const note=document.createElement('textarea');note.name='note';note.maxLength=2000;note.rows=4;note.value=active.item.note??'';label.append(note);
    const actions=document.createElement('div');actions.className='pdf-annotation-actions';
    const save=document.createElement('button');save.type='submit';save.textContent=active.expected?t('保存笔记'):t('保存高亮');
    const cancel=button(t('取消'),()=>{draft=undefined;dialog.close()});actions.append(cancel,save);form.append(page,source,label,actions);body.append(form);close.disabled=false;
    form.addEventListener('submit',event=>{
      event.preventDefault();if(busy)return;
      if(options.currentDocument()?.identity!==active.document.identity){showError(form,t('文档已切换，尚未保存。请重新选择原文。'));return}
      if(!active.expected){
        const metadata=options.currentDocument()?.citation??{};
        active.item=fillMissingCitationFields({...active.item,sourceTitle:metadata.title??active.item.sourceTitle},metadata);
      }
      busy=true;note.readOnly=true;save.disabled=cancel.disabled=close.disabled=true;active.item={...active.item,note:note.value,updatedAt:Math.max(Date.now(),active.item.updatedAt+1)};
      let projectFailed=false,projectName:string|undefined;void pdfReadingStateId(active.document.identity).then(async id=>{await mutatePdfReadingAnnotation(id,active.item,active.expected);if(!active.expected&&options.onNewProjectNote)try{projectName=await options.onNewProjectNote('pdf-note',id,active.item.id)}catch{projectFailed=true}}).then(async()=>{
        draft=undefined;dialog.close();await reload();options.notice(projectFailed?t('笔记已保存，但未加入项目；可在文档库重新选择。'):projectName?msg`阅读批注已保存 · 已加入项目 ${projectName}`:t('阅读批注已保存。'));
      }).catch(error=>showError(form,error)).finally(()=>{busy=false;note.readOnly=false;save.disabled=cancel.disabled=close.disabled=false});
    });
    note.focus();
  }
  function annotateSelection():void {
    const doc=options.currentDocument(),selection=getSelection();
    if(draft){show();options.notice(t('未保存的笔记仍在编辑，请先保存或取消。'));return}
    if(!doc||!selection||selection.rangeCount!==1||selection.isCollapsed)return;
    if(loadedIdentity!==doc.identity){options.notice(t('正在读取已有批注，请稍后再选。'));return}
    let anchors:ReturnType<typeof capturePdfReadingAnnotation>;
    try{anchors=capturePdfReadingAnnotation(options.viewer,selection)}catch(error){options.notice(t(error instanceof Error?error.message:String(error)));return}
    const anchor=anchors[0];if(!anchor)return;
    const existing=records.find(item=>JSON.stringify(pdfReadingAnnotationAnchors(item))===JSON.stringify(anchors));
    const now=Date.now(),sourceUrl=citationUrl(doc.url);draft={document:doc,...(existing?{expected:existing}:{}),item:existing??fillMissingCitationFields({id:crypto.randomUUID(),kind:'highlight' as const,anchor,...(anchors.length>1?{continuations:anchors.slice(1)}:{}),sourceTitle:doc.citation?.title??doc.title,...(sourceUrl?{sourceUrl}:{}),createdAt:now,updatedAt:now},doc.citation??{})};
    show();renderEditor();
    if(existing)options.notice(t('这段原文已有笔记，已打开原记录。'));
  }
  const observer=new MutationObserver(changes=>{
    if(changes.some(change=>change.type==='attributes'||(!(change.target instanceof Element&&change.target.closest('.pdf-reading-highlight-layer,.pdf-area-note-mark'))&&
      [...change.addedNodes,...change.removedNodes].some(node=>!(node instanceof Element&&node.matches('.pdf-reading-highlight-layer,.pdf-area-note-mark'))))))schedulePaint();
  });observer.observe(options.viewer,{childList:true,subtree:true,attributes:true,attributeFilter:['data-rendered']});
  window.addEventListener('resize',schedulePaint);
  browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(PDF_READING_ANNOTATIONS_KEY in changes||PDF_AREA_NOTES_KEY in changes))void reload().catch(error=>options.notice(String(error)))});
  return {
    annotateSelection,
    annotateArea:(anchor:PdfAreaAnchor)=>areas.edit(anchor),
    contains:(node:Node)=>dialog.contains(node),
    open:()=>{if(!options.currentDocument())return;draft=undefined;show();renderList();void reload().catch(error=>showError(body,error))},
    reload,
    reset:()=>{revision++;loadedIdentity=undefined;records=[];draft=undefined;annotationMode=false;void options.onModeChange(false);refreshMode();dialog.close();schedulePaint()},
  };
}
