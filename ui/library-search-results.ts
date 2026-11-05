import {reuseReadingSource} from './reading-source-link';
import {openNoteSummary} from './note-summary';
import {researchExportAction} from './research-export';
import {t,msg} from '../core/i18n/ui-language';
import {excerptSourceHref,textSourceUrl,type LibrarySourceResult} from '../core/translation/library-search';
import {renderTranslationContent} from './translation-content';
import {citationExportMenu} from './citation-export';

export function appendLibrarySourceResults(container:HTMLElement,items:LibrarySourceResult[],query:string,onEdit?:(id:string)=>void,matchedQueries?:ReadonlyMap<string,string>):Map<string,()=>HTMLElement>{
  const bodies=new Map<string,()=>HTMLElement>();
  for(const item of items){
    const row=document.createElement('article');row.className='library-entry library-source-result';row.dataset.sourceResult=item.id;row.dataset.sourceKind=item.kind;row.dataset.updatedAt=String(item.updatedAt);
    const detail=document.createElement('details');detail.className='library-preview';
    const summary=document.createElement('summary'),kind=document.createElement('span');kind.className='library-kind';
    kind.textContent=item.kind==='term'?t('术语'):item.item.kind==='web'?'WEB':'PDF';
    const description=document.createElement('span');description.className='library-description';
    const title=document.createElement('strong');title.className='library-title';title.textContent=item.kind==='term'?`${item.term.source} → ${item.term.target}`:item.title;
    const meta=document.createElement('span');meta.className='library-meta';meta.textContent=item.kind==='term'?`${t('确认术语')} · ${item.title}`:item.item.kind==='pdf'?(item.item.content.endPageNumber?msg`第 ${item.item.content.pageNumber}–${item.item.content.endPageNumber} 页`:msg`第 ${item.item.content.pageNumber} 页`):'';meta.hidden=!meta.textContent;
    if(item.kind==='excerpt'&&'area' in item.item)meta.textContent=`${t('区域笔记')} · ${meta.textContent}`;
    const snippet=document.createElement('span');snippet.className='library-match-snippet';
    const needle=(matchedQueries?.get(item.id)??query).trim().toLocaleLowerCase(),index=item.text.toLocaleLowerCase().indexOf(needle),start=Math.max(0,index-25),end=Math.min(item.text.length,Math.max(0,index)+needle.length+90);
    const preview=item.kind==='excerpt'?(item.item.content.note||item.item.content.translatedText||item.item.content.originalText):item.text;
    const value=needle?item.text.slice(start,end):preview.slice(0,140),match=needle?value.toLocaleLowerCase().indexOf(needle):-1;
    if(start)snippet.append('…');
    if(match>=0){const mark=document.createElement('mark');mark.textContent=value.slice(match,match+needle.length);snippet.append(value.slice(0,match),mark,value.slice(match+needle.length))}else snippet.append(value);
    if(needle?end<item.text.length:preview.length>140)snippet.append('…');
    const action=document.createElement('span');action.className='library-continue';action.textContent=t('查看详情与来源');
    description.append(title,meta,snippet,action);summary.append(kind,description);detail.append(summary);
    bodies.set(item.id,()=>{
    const body=document.createElement('div');body.className='library-source-detail';
    const paragraph=(label:string,text:string)=>{const heading=document.createElement('strong'),p=document.createElement('p');heading.textContent=label;p.textContent=text;body.append(heading,p)};
    const link=(href:string|undefined,label:string)=>{if(!href)return;const a=document.createElement('a');a.className='library-source-open';a.href=href;a.target='_blank';a.rel='noopener noreferrer';reuseReadingSource(a);a.textContent=label;body.append(a)};
    if(item.kind==='excerpt'){
      const content=item.item.content;
      if(content.note){const note=document.createElement('p');note.className='library-personal-note';note.textContent=content.note;body.append(note)}
      if(content.translatedText!==undefined){const target=document.createElement('div');target.className='library-source-translation';void renderTranslationContent(target,content.translatedText,true);body.append(target)}
      if(content.originalText)paragraph(t('原文'),content.originalText);else paragraph(t('区域笔记'),t('未识别文字，仅保存区域位置和笔记。'));
      const citationUrl=content.sourceUrl??(item.item.kind==='web'?item.item.item.pageUrl:undefined);
      const citationMenu=citationExportMenu({...content,...(citationUrl?{sourceUrl:citationUrl}:{})});citationMenu.querySelector('.library-actions')!.append(researchExportAction([item.item]));
      const summary=document.createElement('button');summary.type='button';summary.className='note-summary-action';summary.textContent=t('本篇笔记小结…');summary.addEventListener('click',()=>{citationMenu.open=false;openNoteSummary(item.item.kind==='pdf'?{kind:'pdf',documentId:item.item.documentId}:{kind:'web',pageUrl:item.item.item.pageUrl})});citationMenu.querySelector('.library-actions')!.append(summary);body.append(citationMenu);
      link(excerptSourceHref(item.item),item.item.kind==='pdf'?t('定位原 PDF'):t('定位原网页'));
      const sourceLink=body.querySelector<HTMLAnchorElement>('.library-source-open');if(sourceLink)sourceLink.title=item.item.kind==='pdf'?t('优先返回已打开的原 PDF；需重新选择时会核验文件，保留笔记与译文。'):t('优先返回已打开的原网页；内容变化时可能无法精确定位。');
      if(onEdit){const edit=document.createElement('button');edit.type='button';edit.className='library-detail-edit';edit.textContent=t('编辑笔记与出处');edit.addEventListener('click',()=>onEdit(item.id));body.append(edit)}
    }else{
      const provenance=item.term.provenance;
      if(provenance){
        const describe=(source:typeof provenance.origin)=>`${source.title}${source.pageNumber?msg` · 第 ${source.pageNumber} 页`:''}`;
        paragraph(t('原始来源：'),describe(provenance.origin));
        paragraph(t('本文确认：'),`${describe(provenance.confirmed)} · ${provenance.confirmed.targetLanguage}`);
        if(provenance.via)paragraph(t('复用来源'),provenance.via.title);
        link(textSourceUrl(provenance.origin.sourceUrl,item.term.source),t('打开术语来源'));
        if(!provenance.origin.sourceUrl){const p=document.createElement('p');p.className='library-preview-note';p.textContent=t('此词条未保存可打开的原文件地址；来源记录仍保留。');body.append(p)}
      }else paragraph(t('来源'),t('旧词条未记录来源和目标语言；不会自动推测。'));
    }
    return body;
    });
    row.append(detail);container.append(row);
  }
  return bodies;
}
