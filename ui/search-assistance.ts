import {t,msg} from '../core/i18n/ui-language';
import {alternativeSearchTerms} from '../core/translation/search-assistance';
import type {GlossaryEntry} from '../core/translation/types';

export function appendSearchAssistance(host:HTMLElement,options:{query:string;terms:readonly GlossaryEntry[];onQuery:(query:string)=>void;broaden?:{label:string;run:()=>void};restore?:()=>void;matchedTerms?:readonly string[]}):void{
  const alternatives=alternativeSearchTerms(options.query,options.terms);if(!alternatives.length&&!options.broaden&&!options.restore&&!options.matchedTerms?.length)return;
  const row=document.createElement('div');row.className='pi-search-assistance';
  const style=document.createElement('style');style.textContent='.pi-search-assistance{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 0;font-size:11px;grid-column:1/-1;min-width:0}.pi-search-assistance button{max-width:100%;min-height:32px;padding:4px 8px;border:1px solid var(--pi-line,#ddd);border-radius:5px;background:var(--pi-surface,#fff);color:var(--pi-text,#333);font:inherit;overflow-wrap:anywhere;cursor:pointer}.pi-search-assistance button:hover{background:var(--pi-subtle,#eee)}.pi-search-assistance button:focus-visible{outline:2px solid var(--pi-focus,#6c85b5);outline-offset:2px}.pdf-search .pi-search-assistance button{width:auto;height:auto;flex:0 1 auto;line-height:1.5}.pi-search-assistance span{color:var(--pi-muted,#666)}';row.append(style);
  const button=(label:string,action:()=>void)=>{const element=document.createElement('button');element.type='button';element.textContent=label;element.addEventListener('click',action);row.append(element);return element};
  if(options.matchedTerms?.length){const notice=document.createElement('span');notice.className='search-assistance-matched';notice.textContent=msg`按已确认译法补查：${options.matchedTerms.join(' · ')}`;notice.title=notice.textContent;Object.assign(notice.style,{maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'});row.append(notice)}
  if(options.restore)button(t('还原本次搜索'),options.restore).className='search-assistance-restore';
  if(options.broaden)button(options.broaden.label,options.broaden.run).className='search-assistance-broaden';
  if(alternatives.length){const hint=document.createElement('span');hint.textContent=t('试试已确认译法：');row.append(hint);for(const query of alternatives)button(query,()=>options.onQuery(query)).className='search-assistance-term'}
  host.append(row);
}
