import {reuseReadingSource} from './reading-source-link';
import {appendSearchAssistance} from './search-assistance';
import {PDF_AREA_NOTES_KEY} from '../core/pdf/area-note-repository';
import {openResearchExport,researchExportAction} from './research-export';
import { t, msg } from '../core/i18n/ui-language';
import {WEB_EXCERPTS_KEY} from '../core/content/web-excerpt-repository';
import {PDF_TRANSLATION_MARKERS_KEY} from '../core/pdf/translation-marker-repository';
import {PDF_READING_ANNOTATIONS_KEY} from '../core/pdf/reading-annotation-repository';
import {filterResearchExcerpts,listResearchExcerpts,removeResearchExcerptWithUndo,updateResearchExcerptCitation,researchExcerptSourceUrl,type ResearchExcerpt} from '../core/content/research-excerpt-repository';
import {showUndoNotice} from './action-feedback';
import {normalizeExcerptCitation,type ExcerptCitation} from '../core/content/excerpt-citation';
import {buildTranslationMarkerMarkdown} from '../core/content/session-translation-markers';
import {renderTranslationContent} from './translation-content';
import {updateCompactFilter} from './compact-filter';
import {citationExportAction} from './citation-export';
export function bindWebExcerptLibrary():{openItem:(id:string,onClose?:()=>void)=>Promise<void>}{
  const panel=document.querySelector<HTMLDetailsElement>('#web-excerpts-library')!,search=document.querySelector<HTMLInputElement>('#web-excerpts-search')!,status=document.querySelector<HTMLElement>('#web-excerpts-status')!,list=document.querySelector<HTMLElement>('#web-excerpts-list')!;
  const count=document.querySelector<HTMLElement>('#web-excerpts-count')!,matches=document.querySelector<HTMLElement>('#web-excerpts-matches')!,searchField=document.querySelector<HTMLElement>('#web-excerpts-search-field')!;
  const drafts=new Map<string,{item:ResearchExcerpt;citation:ExcerptCitation;error?:string;saving?:boolean}>();
  const editorReturns=new Map<string,()=>void>();
  const sourceFilter=document.querySelector<HTMLSelectElement>('#research-excerpts-kind')!;
  const expanded=new Set<string>();
  let revision=0;
  let searchOrigin:{query:string;kind:string}|undefined;
  function feedback(text:string,error=false):void{status.textContent=text;status.hidden=!text;status.classList.toggle('visually-hidden',!error);status.classList.toggle('error',error)}
  function excerptIcon(kind:'copy'|'check'|'chevron'='copy'):SVGSVGElement{
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','16');svg.setAttribute('height','16');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',kind==='check'?'m5 12 4 4L19 6':kind==='chevron'?'m6 9 6 6 6-6':'M9 9h11v11H9z M15 5V3H3v12h2');svg.append(path);return svg;
  }
  async function render():Promise<void>{
    const current=++revision;
    try{
      const all=await listResearchExcerpts();if(current!==revision)return;
      const query=search.value.trim(),records=filterResearchExcerpts(all,query,sourceFilter.value);
      for(const draft of drafts.values())if(!all.some(item=>item.id===draft.item.id)&&filterResearchExcerpts([draft.item],query,sourceFilter.value).length){draft.error=t('这条摘录已在其他窗口删除。编辑内容仍保留，请先复制笔记或取消编辑。');records.push(draft.item)}
      feedback('');count.hidden=false;count.textContent=String(all.length);count.title=count.ariaLabel=msg`${all.length} 条已保存`;
      searchField.hidden=!all.length&&!drafts.size;matches.hidden=(!query&&sourceFilter.value==='all')||!records.length;matches.textContent=String(records.length);matches.title=matches.ariaLabel=msg`${records.length} 条匹配`;list.replaceChildren();
      if(searchOrigin&&(searchOrigin.query!==search.value||sourceFilter.value!=='all'))searchOrigin=undefined;
      if(searchOrigin)appendSearchAssistance(list,{query:'',terms:[],onQuery:()=>undefined,restore:()=>{const saved=searchOrigin;if(!saved)return;searchOrigin=undefined;search.value=saved.query;sourceFilter.value=saved.kind;void render()}});
      sourceFilter.hidden=!all.length&&!drafts.size;
      updateCompactFilter(sourceFilter);
      if(!records.length){
        const empty=document.createElement('div');empty.className='web-excerpts-empty';
        const title=document.createElement('p');title.textContent=query||all.length?t('没有找到匹配的摘录'):t('还没有保存的摘录');
        const help=document.createElement('p');help.textContent=query||all.length?t('试试其他来源、原文、译文或笔记中的词。'):t('在网页或 Pi PDF 的「本文标记」中保存后，会出现在这里。');empty.append(title,help);if(sourceFilter.value!=='all')appendSearchAssistance(empty,{query:'',terms:[],onQuery:()=>undefined,broaden:{label:t('在全部来源中搜索'),run:()=>{searchOrigin={query:search.value,kind:sourceFilter.value};sourceFilter.value='all';void render()}}});list.append(empty);return;
      }
      for(const item of records){
        const row=document.createElement('article');row.className='saved-web-excerpt';row.dataset.excerptId=item.markerId;row.dataset.researchExcerptId=item.id;row.dataset.excerptKind=item.kind;
        const heading=document.createElement('div');heading.className='saved-web-excerpt-heading';
        const origin=document.createElement('span');origin.className='saved-web-excerpt-origin';origin.textContent=item.content.sourceTitle+(item.kind==='pdf'?(item.content.endPageNumber?msg` · 第 ${item.content.pageNumber}–${item.content.endPageNumber} 页`:msg` · 第 ${item.content.pageNumber} 页`):'');origin.title=origin.textContent;
        const actions=document.createElement('div');actions.className='saved-web-excerpt-actions';
        const copy=document.createElement('button');copy.type='button';copy.className='saved-web-excerpt-copy';copy.ariaLabel=t('复制摘录（含出处）');copy.title=t('复制摘录（含出处）');copy.append(excerptIcon());
        copy.addEventListener('click',()=>{const url=researchExcerptSourceUrl(item);void navigator.clipboard.writeText(buildTranslationMarkerMarkdown([{...item.content,...(url?{sourceUrl:url}:{})}])).then(()=>{
          feedback(t('带出处的摘录已复制。'));copy.replaceChildren(excerptIcon('check'));copy.title=copy.ariaLabel=t('已复制');setTimeout(()=>{copy.replaceChildren(excerptIcon());copy.title=copy.ariaLabel=t('复制摘录（含出处）')},1800);
        }).catch(()=>feedback(t('复制失败，请重试。'),true))});
        const sourceUrl=researchExcerptSourceUrl(item);
        const open=document.createElement('a');if(sourceUrl){open.href=sourceUrl;reuseReadingSource(open);}open.target='_blank';open.rel='noopener noreferrer';open.textContent=item.kind==='web'?t('打开原网页'):t('打开来源链接');
        const more=document.createElement('details');more.className='library-menu';const toggle=document.createElement('summary');toggle.textContent='···';toggle.dataset.piIcon='more';toggle.title=toggle.ariaLabel=item.kind==='web'?t('这条网页摘录的更多操作'):t('这条 PDF 摘录的更多操作');const menu=document.createElement('div');menu.className='library-actions';
        const remove=document.createElement('button');remove.type='button';remove.className='danger-text';remove.textContent=t('删除摘录');
        const resetDelete=()=>{delete remove.dataset.confirm;remove.textContent=t('删除摘录')};
        more.addEventListener('toggle',()=>{if(!more.open)resetDelete()});remove.addEventListener('blur',resetDelete);
        remove.addEventListener('click',()=>{if(remove.dataset.confirm!=='true'){remove.dataset.confirm='true';remove.textContent=t('确认删除');return}remove.disabled=true;void removeResearchExcerptWithUndo(item).then(async undo=>{drafts.delete(item.id);await render();panel.querySelector<HTMLElement>(':scope > summary')?.focus({preventScroll:true});showUndoNotice(t('摘录已删除'),async()=>{await undo();await render()})}).catch(error=>{remove.disabled=false;feedback(error instanceof Error?error.message:t('删除失败。'),true)})});
        if(sourceUrl)menu.append(open);menu.append(researchExportAction([item]),citationExportAction({...item.content,...(sourceUrl?{sourceUrl}:{})}),remove);more.append(toggle,menu);actions.append(copy,more);heading.append(origin,actions);
        const draftKey=item.id;
        const detail=document.createElement('details');detail.className='saved-web-excerpt-content';detail.open=Boolean(query)||drafts.has(draftKey)||expanded.has(draftKey);
        detail.addEventListener('toggle',()=>{if(detail.isConnected){if(detail.open)expanded.add(draftKey);else expanded.delete(draftKey)}});
        const displayText=item.content.translatedText??(item.content.originalText||t('区域笔记'));
        const summary=document.createElement('summary');summary.title=t('展开或收起原文与笔记');summary.ariaLabel=msg`查看摘录详情：${displayText.slice(0,80)}`;
        const target=document.createElement('div');target.className='saved-web-excerpt-target';
        if(item.content.translatedText===undefined){const label=document.createElement('small');label.textContent='area' in item?t('区域笔记'):t('原文高亮');const quote=document.createElement('div');quote.textContent=displayText;target.append(label,quote)}else void renderTranslationContent(target,displayText,true);
        const chevron=excerptIcon('chevron');chevron.setAttribute('class','saved-web-excerpt-expand');summary.append(target,chevron);
        const body=document.createElement('div');body.className='saved-web-excerpt-detail';
        const sourceLabel=document.createElement('span');sourceLabel.className='saved-web-excerpt-label';sourceLabel.textContent=t('原文');
        const source=document.createElement('blockquote');source.textContent=item.content.originalText;const sourceGroup=document.createElement('div');sourceGroup.append(sourceLabel,source);sourceGroup.hidden=!item.content.originalText;body.append(sourceGroup);
        if(item.content.note){const noteGroup=document.createElement('div'),noteLabel=document.createElement('span'),note=document.createElement('p');noteGroup.className='saved-web-excerpt-note';noteLabel.className='saved-web-excerpt-label';noteLabel.textContent=t('笔记');note.textContent=item.content.note;noteGroup.append(noteLabel,note);body.append(noteGroup)}
        const citations=document.createElement('div');citations.className='saved-web-excerpt-citations';
        if(sourceUrl){const citation=document.createElement('a');citation.className='saved-web-excerpt-citation';citation.href=sourceUrl;citation.target='_blank';citation.rel='noopener noreferrer';citation.textContent=new URL(sourceUrl).hostname;citation.title=item.content.sourceTitle;citations.append(citation)}
        else if(item.kind==='pdf'){const location=document.createElement('span');location.textContent=item.content.endPageNumber?msg`PDF 第 ${item.content.pageNumber}–${item.content.endPageNumber} 页 · 原文件由你保留`:msg`PDF 第 ${item.content.pageNumber} 页 · 原文件由你保留`;citations.append(location)}
        if(item.content.doi){const doi=document.createElement('a');doi.className='saved-web-excerpt-citation';doi.href=`https://doi.org/${item.content.doi}`;doi.target='_blank';doi.rel='noopener noreferrer';doi.textContent=`DOI: ${item.content.doi}`;citations.append(doi)}
        const edit=document.createElement('button');edit.type='button';edit.className='saved-web-excerpt-edit';edit.textContent=t('编辑笔记与出处');citations.append(edit);body.append(citations);
        const showEditor=()=>{
          let draft=drafts.get(draftKey);
          if(!draft){draft={item,citation:normalizeExcerptCitation(item.content)};drafts.set(draftKey,draft)}
          const active=draft;
          const form=document.createElement('form');form.className='saved-web-excerpt-editor';form.ariaLabel=t('编辑摘录笔记与出处');form.dataset.excerptId=draftKey;
          const currentForm=()=>[...list.querySelectorAll<HTMLFormElement>('.saved-web-excerpt-editor')].find(form=>form.dataset.excerptId===draftKey)??form;
          const fields:[keyof ExcerptCitation,string,number][]=[['note',t('个人笔记'),2000],['sourceTitle',t('来源标题'),500],['sourceUrl',t('来源链接'),4000],['doi',t('DOI（可选）'),200]];
          for(const [key,labelText,maxLength] of fields){
            const label=document.createElement('label'),caption=document.createElement('span');caption.textContent=labelText;
            const input=key==='note'?document.createElement('textarea'):document.createElement('input');input.value=active.citation[key]??'';input.maxLength=maxLength;input.name=key;input.readOnly=Boolean(active.saving);
            if(input instanceof HTMLTextAreaElement)input.rows=3;
            if(input instanceof HTMLInputElement){input.type=key==='sourceUrl'?'url':'text';input.required=key==='sourceTitle'}
            input.addEventListener('input',()=>{active.citation[key]=input.value});label.append(caption,input);form.append(label);
          }
          const message=document.createElement('p');message.className='saved-web-excerpt-editor-error';message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.textContent=active.error??'';message.hidden=!active.error;
          const buttons=document.createElement('div');buttons.className='saved-web-excerpt-editor-actions';const save=document.createElement('button'),cancel=document.createElement('button');save.type='submit';save.textContent=active.saving?t('正在保存…'):t('保存');cancel.type='button';cancel.textContent=t('取消');save.disabled=cancel.disabled=Boolean(active.saving);buttons.append(save,cancel);
          form.append(message,buttons);
          const note=body.querySelector<HTMLElement>('.saved-web-excerpt-note');if(note)note.hidden=true;citations.hidden=true;body.append(form);
          const focusEdit=()=>{const returnToSource=editorReturns.get(item.id);if(returnToSource){editorReturns.delete(item.id);returnToSource();return}for(const candidate of list.querySelectorAll<HTMLElement>('.saved-web-excerpt'))if(candidate.dataset.researchExcerptId===item.id)candidate.querySelector<HTMLButtonElement>('.saved-web-excerpt-edit')?.focus({preventScroll:true})};
          cancel.addEventListener('click',()=>{drafts.delete(draftKey);void render().then(focusEdit)});
          form.addEventListener('submit',event=>{
            event.preventDefault();if(active.saving)return;active.saving=true;save.disabled=cancel.disabled=true;save.textContent=t('正在保存…');
            for(const input of form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea'))input.readOnly=true;
            void updateResearchExcerptCitation(active.item,active.citation).then(async()=>{drafts.delete(draftKey);await render();focusEdit();feedback(t('笔记与出处已保存。'))}).catch(error=>{
              active.error=error instanceof Error?error.message:t('保存失败，编辑内容仍保留。');const message=currentForm().querySelector<HTMLElement>('.saved-web-excerpt-editor-error')!;message.textContent=active.error;message.hidden=false;
            }).finally(()=>{active.saving=false;const current=currentForm();for(const input of current.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea'))input.readOnly=false;for(const button of current.querySelectorAll<HTMLButtonElement>('button'))button.disabled=false;current.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent=t('保存')});
          });
          return form;
        };
        edit.addEventListener('click',()=>{showEditor().querySelector<HTMLTextAreaElement>('textarea')?.focus()});
        if(drafts.has(draftKey))showEditor();
        detail.append(summary,body);row.append(heading,detail);list.append(row);
      }
    }catch(error){feedback(error instanceof Error?error.message:t('读取摘录失败，原记录未改变。'),true)}
  }
  panel.addEventListener('toggle',()=>{if(panel.open)void render()});search.addEventListener('input',()=>{void render()});
  sourceFilter.addEventListener('change',()=>{void render()});
  // Keep the live editor and its focus intact while another window saves. Save checks the current record under the shared lock.
  browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(WEB_EXCERPTS_KEY in changes||PDF_TRANSLATION_MARKERS_KEY in changes||PDF_READING_ANNOTATIONS_KEY in changes||PDF_AREA_NOTES_KEY in changes)&&panel.open&&!drafts.size)void render()});
  const exportButton=document.querySelector<HTMLButtonElement>('#export-web-excerpts')!;
  exportButton.addEventListener('click',()=>{
    exportButton.disabled=true;
    void(async()=>{
      const query=search.value,records=filterResearchExcerpts(await listResearchExcerpts(),query,sourceFilter.value);
      if(!records.length)throw new Error('当前搜索条件下没有可导出的已保存摘录。');
      openResearchExport(records);
      const menu=document.querySelector<HTMLDetailsElement>('#library-storage-tools');if(menu)menu.open=false;
      panel.open=true;feedback(msg`已导出 ${records.length} 条已保存摘录${query.trim()?t('（按当前搜索条件）'):''}。`);
    })().catch(error=>{panel.open=true;feedback(error instanceof Error?error.message:t('导出失败。'),true)}).finally(()=>{exportButton.disabled=false});
  });
  return {async openItem(id:string,onClose?:()=>void):Promise<void>{
    const wasOpen=panel.open,previousSearch=search.value,previousFilter=sourceFilter.value,wasExpanded=expanded.has(id);
    if(!panel.open)await new Promise<void>(resolve=>{panel.addEventListener('toggle',()=>resolve(),{once:true});panel.open=true});
    search.value='';sourceFilter.value='all';expanded.add(id);await render();
    const row=[...list.querySelectorAll<HTMLElement>('.saved-web-excerpt')].find(row=>row.dataset.researchExcerptId===id);
    if(!row){feedback(t('这条摘录已在其他窗口删除。编辑内容仍保留，请先复制笔记或取消编辑。'),true);return}
    if(onClose&&!editorReturns.has(id))editorReturns.set(id,()=>{panel.open=wasOpen;search.value=previousSearch;sourceFilter.value=previousFilter;if(!wasExpanded)expanded.delete(id);onClose()});
    row.querySelector<HTMLDetailsElement>('details.saved-web-excerpt-content')!.open=true;
    row.querySelector<HTMLButtonElement>('.saved-web-excerpt-edit')?.click();row.scrollIntoView({block:'nearest'});
  }};
}
