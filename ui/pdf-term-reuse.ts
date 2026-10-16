import type {DocumentConfirmedTerm,DocumentMemorySnapshot,DocumentTermSource,DocumentTermSelection} from '../core/document/document-memory-repository';
import type {DocumentMemoryLocator,DocumentMemoryResponse,DocumentTermSourcesResponse,RuntimeMessage} from '../core/messaging/messages';
import {type TermSource,termSourceUrl,normalizeReusedTermKey} from '../core/document/term-provenance';
import {supportedTargetLanguageLabel,type SupportedTargetLanguage} from '../core/language/supported-target-languages';

function describeSource(container:HTMLElement,source:TermSource):void{
  const text=`${source.title} · ${source.documentId}${source.pageNumber?` · 第 ${source.pageNumber} 页`:''}`;
  const url=termSourceUrl(source.sourceUrl);
  if(url){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=text;container.append(link)}else container.append(document.createTextNode(text));
}
export function bindPdfTermReuse(options:{locator:()=>DocumentMemoryLocator;context:()=>TermSource;language:()=>SupportedTargetLanguage;onMemory:(memory:DocumentMemorySnapshot)=>void}){
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const panel=el<HTMLDetailsElement>('pdf-term-reuse'),source=el<HTMLSelectElement>('pdf-term-reuse-source'),list=el<HTMLElement>('pdf-term-reuse-list');
  const confirm=el<HTMLInputElement>('pdf-term-reuse-confirm'),apply=el<HTMLButtonElement>('pdf-term-reuse-apply'),status=el<HTMLElement>('pdf-term-reuse-status');
  const selected=new Map<string,DocumentTermSelection>();let terms:DocumentConfirmedTerm[]=[],sources:DocumentTermSource[]=[],loadedKey='',generation=0,pending=false;
  const key=()=>JSON.stringify([options.context().documentId,options.language()]);
  function sync(){apply.disabled=pending||!confirm.checked||!selected.size;confirm.disabled=pending;el<HTMLButtonElement>('pdf-term-reuse-refresh').disabled=pending;apply.textContent=`确认复用${selected.size?`（${selected.size}）`:''}`}
  function render(){
    selected.clear();confirm.checked=false;list.replaceChildren();sync();
    const item=sources.find(item=>item.documentId===source.value);if(!item)return;
    const existing=new Map(terms.map(term=>[normalizeReusedTermKey(term.source),term]));
    for(const term of item.terms){
      const row=document.createElement('label');row.className='pdf-term-reuse-row';
      const check=document.createElement('input');check.type='checkbox';const conflict=existing.get(normalizeReusedTermKey(term.source));check.disabled=Boolean(conflict)||pending;
      const description=document.createElement('span'),title=document.createElement('strong');title.textContent=`${term.source} → ${term.target}`;
      const evidence=document.createElement('small');
      if(term.provenance){evidence.append('原始来源：');describeSource(evidence,term.provenance.origin);evidence.append(`；已确认用于${supportedTargetLanguageLabel(term.provenance.confirmed.targetLanguage)}`)}
      else evidence.textContent=`来源：${item.label} · ${item.documentId}；旧词条未记录语言与原页码，请核实。`;
      if(conflict)evidence.append(conflict.target===term.target?'；本文已有相同约定，不重复导入。':`；与本文“${conflict.target}”冲突，保留本文约定。`);
      description.append(title,evidence);row.append(check,description);list.append(row);
      check.addEventListener('change',()=>{confirm.checked=false;if(check.checked)selected.set(term.id,{documentId:item.documentId,term});else selected.delete(term.id);sync()});
    }
  }
  async function load(){
    const revision=++generation,current=key();loadedKey='';pending=true;sources=[];source.replaceChildren();list.replaceChildren();selected.clear();confirm.checked=false;sync();status.textContent='正在读取本机已确认词条…';
    try{
      const response=await browser.runtime.sendMessage({type:'LIST_DOCUMENT_TERM_SOURCES',payload:{...options.locator(),targetLanguage:options.language()}} satisfies RuntimeMessage) as DocumentTermSourcesResponse;
      if(revision!==generation||current!==key())return;if(!response.ok)throw new Error(response.error.message);
      sources=response.data.sources;loadedKey=current;
      for(const item of sources){const option=document.createElement('option');option.value=item.documentId;option.textContent=`${item.label} · ${item.documentId}（${item.terms.length}）`;source.append(option)}
      status.textContent=sources.length?'仅列出已确认词条；旧词条须自行核实适用语言。选择不会修改译文。':'其他文档中还没有适用的已确认词条。';
    }catch(error){if(revision===generation)status.textContent=error instanceof Error?error.message:'无法读取词条，请刷新。'}
    finally{if(revision===generation){pending=false;source.disabled=!sources.length;render()}}
  }
  function update(memory:DocumentMemorySnapshot){
    terms=memory.confirmedTerms;
    const current=el<HTMLElement>('pdf-confirmed-terms-list');current.replaceChildren();
    for(const term of terms){const details=document.createElement('details'),summary=document.createElement('summary'),evidence=document.createElement('p');summary.textContent=`${term.source} → ${term.target}`;
      if(term.provenance){evidence.append('原始来源：');describeSource(evidence,term.provenance.origin);evidence.append(`；本文确认：${new Date(term.provenance.confirmed.at).toLocaleString()} · ${supportedTargetLanguageLabel(term.provenance.confirmed.targetLanguage)}`);if(term.provenance.via)evidence.append(`；本次从 ${term.provenance.via.title} · ${term.provenance.via.documentId} 的已确认词条复用。`)}
      else evidence.textContent='旧词条未记录来源和目标语言；不会自动推测。';details.append(summary,evidence);current.append(details);
    }
  }
  panel.addEventListener('toggle',()=>{if(panel.open)void load()});source.addEventListener('change',render);confirm.addEventListener('change',sync);
  el<HTMLButtonElement>('pdf-term-reuse-refresh').addEventListener('click',()=>void load());
  apply.addEventListener('click',()=>{const submissionGeneration=generation;void(async()=>{
    if(pending||!confirm.checked||!selected.size)return;
    if(loadedKey!==key())throw new Error('当前文档或语言已变化，请刷新后重新确认。');
    const revision=generation,current=key();pending=true;sync();source.disabled=true;list.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.disabled=true);
    try{
      const response=await browser.runtime.sendMessage({type:'REUSE_DOCUMENT_TERMS',payload:{...options.locator(),context:options.context(),targetLanguage:options.language(),selections:[...selected.values()]}} satisfies RuntimeMessage) as DocumentMemoryResponse;
      if(revision!==generation||current!==key())return;if(!response.ok)throw new Error(response.error.message);
      options.onMemory(response.data.memory);update(response.data.memory);status.textContent='已确认并保存为本文术语，后续翻译可使用；旧译文未改变。修改现有段落仍须预览并确认。';
    }finally{if(revision===generation){pending=false;source.disabled=!sources.length;render()}}
  })().catch(error=>{if(submissionGeneration===generation)status.textContent=error instanceof Error?error.message:'复用未保存，请刷新后重新确认。'})});
  return {update,reset(memory:DocumentMemorySnapshot){
    generation++;pending=false;update(memory);panel.open=false;selected.clear();sources=[];loadedKey='';source.replaceChildren();list.replaceChildren();confirm.checked=false;status.textContent='';sync();
    el<HTMLElement>('pdf-term-reuse-language').textContent=`我已核对所选词条适用于本文${supportedTargetLanguageLabel(options.language())}译文。`;
  }};
}
