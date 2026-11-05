/** A page-local return hook; never stored with reading positions or notes. */
export interface ReadingSummaryReturn {kind?:'recap'|'summary';resume():void;onCancel(cleanup:()=>void):void}

/** Match the actual page, preserving normal fragments and query parameters.
 * Only Pi's excerpt marker and the browser text directive are transient. */
export function readingPageUrl(value:string):string|undefined{
  try{
    const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;
    const fragment=url.hash.slice(1).split(':~:')[0]!.split('&').filter(part=>!part.startsWith('pi-excerpt=')).join('&');
    url.hash=fragment;return url.href;
  }catch{return}
}

export function pdfReadingTarget(value:string,viewer:string):{kind:'recent'|'excerpt';id:string}|undefined{
  try{
    const url=new URL(value),base=new URL(viewer),keys=[...url.searchParams.keys()];
    if(url.protocol!==base.protocol||url.host!==base.host||url.pathname!==base.pathname||url.hash||keys.length!==1)return;
    const kind=keys[0],id=url.searchParams.get(kind!)??'';
    if(kind==='recent'&&/^[a-f0-9]{32}$/u.test(id)||kind==='excerpt'&&id.trim()&&id.length<=2000)return {kind:kind as 'recent'|'excerpt',id};
  }catch{return}
}

export function selectedReadingQuery(text:string,manuallyEdited:boolean):string|undefined{
  const query=text.replace(/\s+/gu,' ').trim();
  return !manuallyEdited&&query.length>0&&query.length<=160?query:undefined;
}

export function readingSelectionText(selection:Selection|null,roots:readonly HTMLElement[],active:Element|null):string{
  if(!selection||selection.isCollapsed||selection.rangeCount!==1||active?.closest('input,textarea,[contenteditable]:not([contenteditable="false"])'))return '';
  const range=selection.getRangeAt(0);
  if(!roots.some(root=>root.contains(range.startContainer)&&root.contains(range.endContainer)))return '';
  const element=range.startContainer instanceof Element?range.startContainer:range.startContainer.parentElement;
  const excluded='input,textarea,[contenteditable]:not([contenteditable="false"]),math,.katex,mjx-container';
  const end=range.endContainer instanceof Element?range.endContainer:range.endContainer.parentElement;
  if(element?.closest(excluded)||end?.closest(excluded)||range.cloneContents().querySelector(excluded))return '';
  return selection.toString();
}

/** Read a boolean only; no form values leave the current document. */
export function hasReadingDraft(root:Document|ShadowRoot=document):boolean{
  const visible=(node:Element)=>Boolean(node.getClientRects().length);
  if([...root.querySelectorAll('.correction-editor,.pdf-annotation-editor,.document-edit,.library-name-editor')].some(visible))return true;
  for(const field of root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')){
    if(field.disabled||field.readOnly||!visible(field))continue;
    if(field instanceof HTMLInputElement&&(['hidden','search','number','range','checkbox','radio','button','submit','file'].includes(field.type)||field.id==='pdf-search-query'))continue;
    if(field.value!==field.defaultValue)return true;
  }
  if([...root.querySelectorAll('[contenteditable]:not([contenteditable="false"])')].some(visible))return true;
  return [...root.querySelectorAll('*')].some(node=>node.shadowRoot&&hasReadingDraft(node.shadowRoot));
}
