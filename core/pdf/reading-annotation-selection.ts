import type {PdfReadingAnnotationAnchor} from './reading-annotation-repository';

/** Read only native text, clipping the selection separately to each fully rendered page. */
export function capturePdfReadingAnnotation(viewer:HTMLElement,selection:Selection):PdfReadingAnnotationAnchor[]{
  if(selection.rangeCount!==1||selection.isCollapsed)return [];
  const range=selection.getRangeAt(0),element=(node:Node)=>node instanceof Element?node:node.parentElement;
  const start=element(range.startContainer)?.closest<HTMLElement>('.textLayer'),end=element(range.endContainer)?.closest<HTMLElement>('.textLayer');
  if(!start||!end||!viewer.contains(start)||!viewer.contains(end))throw new Error('请选择 PDF 原生文字；扫描页批注暂不支持。');
  const first=Number(start.closest<HTMLElement>('.pdf-page')?.dataset.pageNumber),last=Number(end.closest<HTMLElement>('.pdf-page')?.dataset.pageNumber);
  if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last-first>15)throw new Error('一次批注最多跨 16 页，请缩小选区。');
  const anchors:PdfReadingAnnotationAnchor[]=[];
  for(let number=first;number<=last;number++){
    const page=viewer.querySelector<HTMLElement>(`.pdf-page[data-page-number="${number}"]`),text=page?.querySelector('.textLayer');
    if(page?.dataset.rendered!=='ready'||page.dataset.hasNativeText!=='true'||!text)throw new Error('选区包含未加载或没有原生文字的页面，请先加载原文再批注。');
    const part=document.createRange();part.selectNodeContents(text);
    if(number===first)part.setStart(range.startContainer,range.startOffset);
    if(number===last)part.setEnd(range.endContainer,range.endOffset);
    const sourceText=part.toString();if(!sourceText.trim())throw new Error('跨页选区中有空白页，请缩小选区。');
    const before=document.createRange();before.selectNodeContents(text);before.setEnd(part.startContainer,part.startOffset);
    const offset=before.toString().length,all=text.textContent??'';
    anchors.push({kind:'text-quote',pageNumber:number,sourceText,prefix:all.slice(Math.max(0,offset-48),offset),suffix:all.slice(offset+sourceText.length,offset+sourceText.length+48)});
  }
  if(anchors.map(a=>a.sourceText).join('\n\n').length>4000)throw new Error('单条阅读批注原文最多 4000 字符，请缩小选区。');
  return anchors;
}
