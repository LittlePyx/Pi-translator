import {lookupCitationMetadata} from '../core/content/citation-metadata';
import {layoutTaskDialog} from './task-dialog';
import {t,localizeErrorMessage} from '../core/i18n/ui-language';
import {buildCitationExport,type CitationExportFields} from '../core/content/citation-export';
import type {ExcerptCitation} from '../core/content/excerpt-citation';

export function citationExportAction(citation:ExcerptCitation):HTMLButtonElement{
  const button=document.createElement('button');button.type='button';button.textContent=t('导出引用…');
  button.addEventListener('click',()=>{
    const menu=button.closest('details');if(menu)menu.open=false;
    const origin=menu?.querySelector<HTMLElement>('summary')??button;
    const dialog=document.createElement('dialog');dialog.className='citation-export-dialog';dialog.setAttribute('aria-labelledby','citation-export-title');
    const form=document.createElement('form'),heading=document.createElement('h2'),hint=document.createElement('p');heading.id='citation-export-title';heading.textContent=t('导出引用');
    hint.textContent=t('核对后导出；未知字段可留空，仅用于本次导出，不改动笔记。');form.append(heading,hint);
    const formatLabel=document.createElement('label'),formatText=document.createElement('span'),format=document.createElement('select');formatText.textContent=t('格式');format.ariaLabel=t('格式');
    for(const [value,text] of [['bibtex','BibTeX'],['ris','RIS']]){const option=document.createElement('option');option.value=value!;option.textContent=text!;format.append(option)}
    formatLabel.append(formatText,format);form.append(formatLabel);
    const inputs={} as Record<keyof CitationExportFields,HTMLInputElement|HTMLTextAreaElement>;
    const fields:[keyof CitationExportFields,string,string,number][]=[['title',t('来源标题'),citation.sourceTitle,500],['authors',t('作者（每行一位，可选）'),citation.authors??'',6030],['year',t('年份（可选）'),citation.year??'',4],['doi',t('DOI（可选）'),citation.doi??'',200],['url',t('来源链接'),citation.sourceUrl??'',4000]];
    for(const [key,text,value,maxLength] of fields){
      const label=document.createElement('label'),caption=document.createElement('span'),input=key==='authors'?document.createElement('textarea'):document.createElement('input');caption.textContent=text;input.value=value;input.maxLength=maxLength;
      if(input instanceof HTMLInputElement){input.type=key==='url'?'url':'text';input.required=key==='title';if(key==='year')input.inputMode='numeric'}else input.rows=2;
      inputs[key]=input;label.append(caption,input);form.append(label);
    }
    const status=document.createElement('p');status.setAttribute('role','status');status.hidden=true;
    const lookup=document.createElement('button');lookup.type='button';lookup.textContent=t('按 DOI 获取来源信息…');form.append(lookup);
    const metadataPreview=document.createElement('div');metadataPreview.className='citation-metadata-preview';form.append(metadataPreview);
    const controller=new AbortController();dialog.addEventListener('close',()=>controller.abort(),{once:true});
    lookup.addEventListener('click',()=>{
      lookup.disabled=true;status.hidden=false;status.textContent=t('仅查询所填 DOI；确认后补全空白字段。');const doi=inputs.doi.value;
      void(async()=>{
        if(!/^10\./u.test(doi.trim())&&!/doi\.org\//u.test(doi))throw new Error('请先填写有效 DOI。');
        const origins=['https://api.crossref.org/*'];if(!await browser.permissions.contains({origins})&&!await browser.permissions.request({origins}))throw new Error('未授权来源信息查询，手工内容保持不变。');
        const metadata=await lookupCitationMetadata(doi,controller.signal);if(!dialog.open||inputs.doi.value!==doi)return;
        metadataPreview.replaceChildren();const explanation=document.createElement('p');explanation.textContent='Crossref · '+(metadata.doi??'');const preview=document.createElement('textarea');preview.readOnly=true;preview.rows=5;preview.ariaLabel=t('来源信息预览');preview.value=[metadata.title,metadata.authors,metadata.year,metadata.url].filter(Boolean).join('\n');
        const apply=document.createElement('button');apply.type='button';apply.textContent=t('补全空白字段');apply.addEventListener('click',()=>{if(inputs.doi.value!==doi)return;for(const key of ['title','authors','year','url'] as const)if(!inputs[key].value.trim()&&metadata[key])inputs[key].value=metadata[key]!;metadataPreview.replaceChildren();status.textContent=t('已补全空白字段，请核对后导出。')});metadataPreview.append(explanation,preview,apply);status.textContent='';
      })().catch(error=>{if(!controller.signal.aborted){status.hidden=false;status.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error))}}).finally(()=>{lookup.disabled=false});
    });
    form.addEventListener('input',()=>{status.textContent='';status.hidden=true});
    const actions=document.createElement('div');actions.className='support-task-actions';
    const cancel=document.createElement('button'),confirm=document.createElement('button');cancel.type='button';cancel.textContent=t('取消');confirm.type='submit';confirm.className='primary';confirm.textContent=t('确认导出');actions.append(cancel,confirm);layoutTaskDialog(dialog,heading,[...form.childNodes].filter(node=>node!==heading),actions,status,form);document.body.append(dialog);
    cancel.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{dialog.remove();if(origin.isConnected)origin.focus({preventScroll:true})},{once:true});
    form.addEventListener('submit',event=>{
      event.preventDefault();
      try{
        const fields=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])) as unknown as CitationExportFields;
        const kind=format.value==='ris'?'ris':'bibtex',text=buildCitationExport(fields,kind);
        const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`pi-source.${kind==='ris'?'ris':'bib'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);dialog.close();
      }catch(error){status.textContent=localizeErrorMessage(error instanceof Error?error.message:t('导出失败。'));status.hidden=false}
    });
    dialog.showModal();inputs.title.focus();
  });
  return button;
}

export function citationExportMenu(citation:ExcerptCitation):HTMLDetailsElement{
  const menu=document.createElement('details');menu.className='library-menu';
  const toggle=document.createElement('summary');toggle.textContent='···';toggle.dataset.piIcon='more';toggle.title=toggle.ariaLabel=t('引用操作');
  const actions=document.createElement('div');actions.className='library-actions';actions.append(citationExportAction(citation));menu.append(toggle,actions);
  return menu;
}
