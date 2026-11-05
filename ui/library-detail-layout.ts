import {t} from '../core/i18n/ui-language';

/** Presentation only: keep the original reading links, menus and detail nodes. */
export function bindLibraryDetailLayout(list:HTMLElement,pane:HTMLElement){
  const layout=list.parentElement!,compact=matchMedia('(max-width: 900px)');
  let selected:string|undefined;
  let explicitSelection=false;
  let entries:{key:string;row:HTMLElement;button:HTMLButtonElement;title:string;body:()=>HTMLElement}[]=[];
  const heading=document.createElement('h3'),back=document.createElement('button'),content=document.createElement('div'),header=document.createElement('header');
  heading.id='library-detail-title';heading.tabIndex=-1;
  back.type='button';back.className='library-detail-back';back.textContent='←';back.title=back.ariaLabel=t('返回');
  content.className='library-detail-content';header.append(back,heading);pane.append(header,content);pane.setAttribute('aria-labelledby',heading.id);
  function show(key:string|undefined,focus=false):void{
    selected=key;
    if(focus)explicitSelection=true;
    if(!key)explicitSelection=false;
    for(const menu of list.querySelectorAll<HTMLDetailsElement>('details.library-menu[open]'))menu.open=false;
    const item=entries.find(entry=>entry.key===key);
    for(const entry of entries){const active=entry===item;entry.row.classList.toggle('library-selected',active);entry.button.setAttribute('aria-expanded',String(active))}
    pane.hidden=!item;layout.dataset.libraryView=item?'detail':'list';content.replaceChildren();
    if(!item)return;
    heading.textContent=item.title;content.append(item.body());pane.scrollTop=0;
    if(focus&&compact.matches)heading.focus({preventScroll:true});
  }
  back.addEventListener('click',()=>{const item=entries.find(entry=>entry.key===selected);show(undefined);item?.button.focus({preventScroll:true})});
  compact.addEventListener('change',()=>{
    if(compact.matches)for(const menu of list.querySelectorAll<HTMLDetailsElement>('details.library-menu[open]'))menu.open=false;
    if(compact.matches&&!explicitSelection){show(undefined);return}
    if(!compact.matches&&!selected&&entries.length)show(entries[0]?.key);
    if(compact.matches&&list.contains(document.activeElement)&&selected)heading.focus({preventScroll:true});
    if(!compact.matches&&document.activeElement===back)heading.focus({preventScroll:true});
  });
  return {showList:()=>show(undefined),update(bodyForDocument:(row:HTMLElement)=>HTMLElement):void{
    entries=[];
    const rows=[...list.querySelectorAll<HTMLElement>(':scope > .library-entry')].sort((a,b)=>Number(b.dataset.libraryPinned==='true')-Number(a.dataset.libraryPinned==='true')||Number(b.dataset.updatedAt??0)-Number(a.dataset.updatedAt??0));
    for(const row of rows){
      const preview=row.querySelector<HTMLElement>('.library-preview')!;
      const original=preview.querySelector<HTMLElement>(':scope > summary, :scope > .library-open')!;
      const title=row.querySelector('.library-title')?.textContent??'';
      const key=row.dataset.sourceResult??row.dataset.libraryId!;
      const detail=row.querySelector<HTMLElement>('.library-source-detail');detail?.remove();
      const select=document.createElement('button');select.type='button';select.className='library-select';select.setAttribute('aria-controls',pane.id);select.setAttribute('aria-expanded','false');
      select.title=title;
      select.append(...original.childNodes);
      select.querySelector('.library-continue')?.remove();
      const wrapper=document.createElement('div');wrapper.className='library-preview';wrapper.append(select);
      if(original instanceof HTMLAnchorElement){
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.6');
        const line=document.createElementNS(icon.namespaceURI,'path');line.setAttribute('d','M7 17 17 7M7 7h10v10');icon.append(line);
        original.replaceChildren(icon);original.ariaLabel=original.title||t('继续阅读');original.dataset.piIcon='glyph';wrapper.append(original);
      }
      preview.replaceWith(wrapper);list.append(row);
      let cached=detail;
      const entry={key,row,button:select,title,body:()=>cached??=(bodyForDocument(row))};entries.push(entry);
      select.addEventListener('click',()=>show(key,true));
    }
    if(!entries.some(entry=>entry.key===selected)){selected=compact.matches?undefined:entries[0]?.key;explicitSelection=false}
    show(selected);
  }};
}
