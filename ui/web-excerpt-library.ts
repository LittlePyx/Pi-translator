import {WEB_EXCERPTS_KEY} from '../core/content/web-excerpt-repository';
import {PDF_TRANSLATION_MARKERS_KEY} from '../core/pdf/translation-marker-repository';
import {filterResearchExcerpts,listResearchExcerpts,removeResearchExcerpt,updateResearchExcerptCitation,researchExcerptSourceUrl,type ResearchExcerpt} from '../core/content/research-excerpt-repository';
import {normalizeExcerptCitation,type ExcerptCitation} from '../core/content/excerpt-citation';
import {buildTranslationMarkerMarkdown} from '../core/content/session-translation-markers';
import {renderTranslationContent} from './translation-content';
export function bindWebExcerptLibrary():void{
  const panel=document.querySelector<HTMLDetailsElement>('#web-excerpts-library')!,search=document.querySelector<HTMLInputElement>('#web-excerpts-search')!,status=document.querySelector<HTMLElement>('#web-excerpts-status')!,list=document.querySelector<HTMLElement>('#web-excerpts-list')!;
  const count=document.querySelector<HTMLElement>('#web-excerpts-count')!,matches=document.querySelector<HTMLElement>('#web-excerpts-matches')!,searchField=document.querySelector<HTMLElement>('#web-excerpts-search-field')!;
  const drafts=new Map<string,{item:ResearchExcerpt;citation:ExcerptCitation;error?:string;saving?:boolean}>();
  const sourceFilter=document.querySelector<HTMLSelectElement>('#research-excerpts-kind')!;
  const expanded=new Set<string>();
  let revision=0;
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
      for(const draft of drafts.values())if(!all.some(item=>item.id===draft.item.id)&&filterResearchExcerpts([draft.item],query,sourceFilter.value).length){draft.error='这条摘录已在其他窗口删除。编辑内容仍保留，请先复制笔记或取消编辑。';records.push(draft.item)}
      feedback('');count.hidden=false;count.textContent=String(all.length);count.ariaLabel=`${all.length} 条已保存`;
      searchField.hidden=!all.length&&!drafts.size;matches.hidden=!query||!records.length;matches.textContent=`${records.length} 条匹配`;list.replaceChildren();
      sourceFilter.hidden=!all.length&&!drafts.size;
      if(!records.length){
        const empty=document.createElement('div');empty.className='web-excerpts-empty';
        const title=document.createElement('p');title.textContent=query||all.length?'没有找到匹配的摘录':'还没有保存的摘录';
        const help=document.createElement('p');help.textContent=query||all.length?'试试其他来源、原文、译文或笔记中的词。':'在网页或 Pi PDF 的「本文标记」中保存后，会出现在这里。';empty.append(title,help);list.append(empty);return;
      }
      for(const item of records){
        const row=document.createElement('article');row.className='saved-web-excerpt';row.dataset.excerptId=item.markerId;row.dataset.researchExcerptId=item.id;row.dataset.excerptKind=item.kind;
        const heading=document.createElement('div');heading.className='saved-web-excerpt-heading';
        const origin=document.createElement('span');origin.className='saved-web-excerpt-origin';origin.textContent=item.content.sourceTitle+(item.kind==='pdf'?` · 第 ${item.content.pageNumber} 页`:'');origin.title=origin.textContent;
        const actions=document.createElement('div');actions.className='saved-web-excerpt-actions';
        const copy=document.createElement('button');copy.type='button';copy.className='saved-web-excerpt-copy';copy.ariaLabel='复制摘录（含出处）';copy.title='复制摘录（含出处）';copy.append(excerptIcon());
        copy.addEventListener('click',()=>{const url=researchExcerptSourceUrl(item);void navigator.clipboard.writeText(buildTranslationMarkerMarkdown([{...item.content,...(url?{sourceUrl:url}:{})}])).then(()=>{
          feedback('带出处的摘录已复制。');copy.replaceChildren(excerptIcon('check'));copy.title='已复制';setTimeout(()=>{copy.replaceChildren(excerptIcon());copy.title='复制摘录（含出处）'},1800);
        }).catch(()=>feedback('复制失败，请重试。',true))});
        const sourceUrl=researchExcerptSourceUrl(item);
        const open=document.createElement('a');if(sourceUrl)open.href=sourceUrl;open.target='_blank';open.rel='noopener noreferrer';open.textContent=item.kind==='web'?'打开原网页':'打开来源链接';
        const more=document.createElement('details');more.className='library-menu';const toggle=document.createElement('summary');toggle.textContent='···';toggle.ariaLabel=item.kind==='web'?'这条网页摘录的更多操作':'这条 PDF 摘录的更多操作';const menu=document.createElement('div');menu.className='library-actions';
        const remove=document.createElement('button');remove.type='button';remove.className='danger-text';remove.textContent='删除摘录';
        const resetDelete=()=>{delete remove.dataset.confirm;remove.textContent='删除摘录'};
        more.addEventListener('toggle',()=>{if(!more.open)resetDelete()});remove.addEventListener('blur',resetDelete);
        remove.addEventListener('click',()=>{if(remove.dataset.confirm!=='true'){remove.dataset.confirm='true';remove.textContent='确认删除';return}remove.disabled=true;void removeResearchExcerpt(item).then(()=>{drafts.delete(item.id);return render()}).then(()=>panel.querySelector<HTMLElement>(':scope > summary')?.focus({preventScroll:true})).catch(error=>{remove.disabled=false;feedback(error instanceof Error?error.message:'删除失败。',true)})});
        if(sourceUrl)menu.append(open);menu.append(remove);more.append(toggle,menu);actions.append(copy,more);heading.append(origin,actions);
        const draftKey=item.id;
        const detail=document.createElement('details');detail.className='saved-web-excerpt-content';detail.open=Boolean(query)||drafts.has(draftKey)||expanded.has(draftKey);
        detail.addEventListener('toggle',()=>{if(detail.isConnected){if(detail.open)expanded.add(draftKey);else expanded.delete(draftKey)}});
        const summary=document.createElement('summary');summary.title='展开或收起原文与笔记';summary.ariaLabel=`查看摘录详情：${item.content.translatedText.slice(0,80)}`;
        const target=document.createElement('div');target.className='saved-web-excerpt-target';void renderTranslationContent(target,item.content.translatedText,true);
        const chevron=excerptIcon('chevron');chevron.setAttribute('class','saved-web-excerpt-expand');summary.append(target,chevron);
        const body=document.createElement('div');body.className='saved-web-excerpt-detail';
        const sourceLabel=document.createElement('span');sourceLabel.className='saved-web-excerpt-label';sourceLabel.textContent='原文';
        const source=document.createElement('blockquote');source.textContent=item.content.originalText;const sourceGroup=document.createElement('div');sourceGroup.append(sourceLabel,source);body.append(sourceGroup);
        if(item.content.note){const noteGroup=document.createElement('div'),noteLabel=document.createElement('span'),note=document.createElement('p');noteGroup.className='saved-web-excerpt-note';noteLabel.className='saved-web-excerpt-label';noteLabel.textContent='笔记';note.textContent=item.content.note;noteGroup.append(noteLabel,note);body.append(noteGroup)}
        const citations=document.createElement('div');citations.className='saved-web-excerpt-citations';
        if(sourceUrl){const citation=document.createElement('a');citation.className='saved-web-excerpt-citation';citation.href=sourceUrl;citation.target='_blank';citation.rel='noopener noreferrer';citation.textContent=new URL(sourceUrl).hostname;citation.title=item.content.sourceTitle;citations.append(citation)}
        else if(item.kind==='pdf'){const location=document.createElement('span');location.textContent=`PDF 第 ${item.content.pageNumber} 页 · 原文件由你保留`;citations.append(location)}
        if(item.content.doi){const doi=document.createElement('a');doi.className='saved-web-excerpt-citation';doi.href=`https://doi.org/${item.content.doi}`;doi.target='_blank';doi.rel='noopener noreferrer';doi.textContent=`DOI: ${item.content.doi}`;citations.append(doi)}
        const edit=document.createElement('button');edit.type='button';edit.className='saved-web-excerpt-edit';edit.textContent='编辑笔记与出处';citations.append(edit);body.append(citations);
        const showEditor=()=>{
          let draft=drafts.get(draftKey);
          if(!draft){draft={item,citation:normalizeExcerptCitation(item.content)};drafts.set(draftKey,draft)}
          const active=draft;
          const form=document.createElement('form');form.className='saved-web-excerpt-editor';form.ariaLabel='编辑摘录笔记与出处';
          const fields:[keyof ExcerptCitation,string,number][]=[['note','个人笔记',2000],['sourceTitle','来源标题',500],['sourceUrl','来源链接',4000],['doi','DOI（可选）',200]];
          for(const [key,labelText,maxLength] of fields){
            const label=document.createElement('label'),caption=document.createElement('span');caption.textContent=labelText;
            const input=key==='note'?document.createElement('textarea'):document.createElement('input');input.value=active.citation[key]??'';input.maxLength=maxLength;input.name=key;
            if(input instanceof HTMLTextAreaElement)input.rows=3;
            if(input instanceof HTMLInputElement){input.type=key==='sourceUrl'?'url':'text';input.required=key==='sourceTitle'}
            input.addEventListener('input',()=>{active.citation[key]=input.value});label.append(caption,input);form.append(label);
          }
          const message=document.createElement('p');message.className='saved-web-excerpt-editor-error';message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.textContent=active.error??'';message.hidden=!active.error;
          const buttons=document.createElement('div');buttons.className='saved-web-excerpt-editor-actions';const save=document.createElement('button'),cancel=document.createElement('button');save.type='submit';save.textContent=active.saving?'正在保存…':'保存';cancel.type='button';cancel.textContent='取消';save.disabled=cancel.disabled=Boolean(active.saving);buttons.append(save,cancel);
          form.append(message,buttons);
          const note=body.querySelector<HTMLElement>('.saved-web-excerpt-note');if(note)note.hidden=true;citations.hidden=true;body.append(form);
          const focusEdit=()=>{for(const candidate of list.querySelectorAll<HTMLElement>('.saved-web-excerpt'))if(candidate.dataset.researchExcerptId===item.id)candidate.querySelector<HTMLButtonElement>('.saved-web-excerpt-edit')?.focus({preventScroll:true})};
          cancel.addEventListener('click',()=>{drafts.delete(draftKey);void render().then(focusEdit)});
          form.addEventListener('submit',event=>{
            event.preventDefault();if(active.saving)return;active.saving=true;save.disabled=cancel.disabled=true;save.textContent='正在保存…';
            void updateResearchExcerptCitation(active.item,active.citation).then(async()=>{drafts.delete(draftKey);await render();focusEdit();feedback('笔记与出处已保存。')}).catch(error=>{
              active.error=error instanceof Error?error.message:'保存失败，编辑内容仍保留。';message.textContent=active.error;message.hidden=false;
            }).finally(()=>{active.saving=false;save.disabled=cancel.disabled=false;save.textContent='保存'});
          });
          return form;
        };
        edit.addEventListener('click',()=>{showEditor().querySelector<HTMLTextAreaElement>('textarea')?.focus()});
        if(drafts.has(draftKey))showEditor();
        detail.append(summary,body);row.append(heading,detail);list.append(row);
      }
    }catch(error){feedback(error instanceof Error?error.message:'读取摘录失败，原记录未改变。',true)}
  }
  panel.addEventListener('toggle',()=>{if(panel.open)void render()});search.addEventListener('input',()=>{void render()});
  sourceFilter.addEventListener('change',()=>{void render()});
  // Keep the live editor and its focus intact while another window saves. Save checks the current record under the shared lock.
  browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(WEB_EXCERPTS_KEY in changes||PDF_TRANSLATION_MARKERS_KEY in changes)&&panel.open&&!drafts.size)void render()});
  const exportButton=document.querySelector<HTMLButtonElement>('#export-web-excerpts')!;
  exportButton.addEventListener('click',()=>{
    exportButton.disabled=true;
    void(async()=>{
      const query=search.value,records=filterResearchExcerpts(await listResearchExcerpts(),query,sourceFilter.value);
      if(!records.length)throw new Error('当前搜索条件下没有可导出的已保存摘录。');
      const text=buildTranslationMarkerMarkdown(records.map(item=>{const sourceUrl=researchExcerptSourceUrl(item);return {...item.content,...(sourceUrl?{sourceUrl}:{})}}));
      const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`pi-translator-excerpts-${new Date().toISOString().slice(0,10)}.md`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      const menu=document.querySelector<HTMLDetailsElement>('#library-storage-tools');if(menu)menu.open=false;
      panel.open=true;feedback(`已导出 ${records.length} 条已保存摘录${query.trim()?'（按当前搜索条件）':''}。`);
    })().catch(error=>{panel.open=true;feedback(error instanceof Error?error.message:'导出失败。',true)}).finally(()=>{exportButton.disabled=false});
  });
}
