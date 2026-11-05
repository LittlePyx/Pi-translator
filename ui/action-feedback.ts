import {t} from '../core/i18n/ui-language';

let activeNotice:HTMLElement|undefined;
/** One recent action, in memory only. Never replace a newer record to make undo succeed. */
export function showUndoNotice(message:string,undo:()=>Promise<void>):void{
  activeNotice?.remove();
  const notice=document.createElement('div'),text=document.createElement('span'),button=document.createElement('button');
  activeNotice=notice;notice.className='pi-undo-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
  notice.style.cssText='position:fixed;z-index:2147483647;bottom:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:16px;width:max-content;max-width:calc(100vw - 32px);box-sizing:border-box;padding:10px 14px;border:1px solid #788499;border-radius:10px;background:var(--pi-surface,#fff);color:var(--pi-text,#263247);box-shadow:0 4px 20px #0002;font:13px/1.5 system-ui';
  text.style.cssText='min-width:0;overflow-wrap:anywhere';
  text.textContent=message;button.type='button';button.textContent=t('撤销');button.style.cssText='flex:none;border:0;background:transparent;color:inherit;text-decoration:underline;min-height:32px;padding:4px 8px;cursor:pointer';
  notice.append(text,button);(document.querySelector('dialog[open]')??document.body).append(notice);
  let timer:ReturnType<typeof setTimeout>;const stop=()=>clearTimeout(timer),start=()=>{stop();timer=setTimeout(()=>{if(!notice.contains(document.activeElement))notice.remove()},12000)};
  notice.addEventListener('pointerenter',stop);notice.addEventListener('pointerleave',start);notice.addEventListener('focusin',stop);notice.addEventListener('focusout',start);start();
  button.addEventListener('click',()=>{stop();button.disabled=true;void undo().then(()=>{text.textContent=t('已撤销');button.remove();setTimeout(()=>notice.remove(),1800)}).catch(error=>{text.textContent=error instanceof Error?t(error.message):t('撤销失败，现有资料未改变。');button.disabled=false})});
}

/** Native hover titles remain; keyboard focus gets the same visible, described hint. */
export function bindActionHints(root:Document|ShadowRoot=document):void{
  let hint:HTMLElement|undefined,target:HTMLElement|undefined,priorDescription:string|null=null;
  const hide=()=>{hint?.remove();hint=undefined;if(target){if(priorDescription===null)target.removeAttribute('aria-describedby');else target.setAttribute('aria-describedby',priorDescription)}target=undefined};
  const show=(event:Event)=>{
    hide();const item=event.composedPath().find(node=>node instanceof HTMLElement&&node.matches('button[title],summary[title],a[title]')) as HTMLElement|undefined;
    if(!item||item.getRootNode()!==root||!item.matches(':focus-visible')||!item.title.trim())return;
    target=item;priorDescription=item.getAttribute('aria-describedby');hint=document.createElement('div');hint.id=`pi-keyboard-hint-${++hintSerial}`;hint.setAttribute('role','tooltip');hint.textContent=item.title;
    hint.style.cssText='position:fixed;z-index:2147483647;max-width:min(280px,calc(100vw - 24px));box-sizing:border-box;padding:7px 10px;border-radius:6px;background:#263247;color:#fff;font:12px/1.5 system-ui;pointer-events:none;box-shadow:0 3px 12px #0003;overflow-wrap:anywhere';
    (root instanceof Document?(item.closest('dialog[open]')??root.body):root).append(hint);item.setAttribute('aria-describedby',[priorDescription,hint.id].filter(Boolean).join(' '));
    const rect=item.getBoundingClientRect(),box=hint.getBoundingClientRect();hint.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-box.width-12))}px`;hint.style.top=`${Math.max(8,rect.bottom+8+box.height<innerHeight?rect.bottom+8:rect.top-box.height-8)}px`;
  };
  root.addEventListener('focusin',show);root.addEventListener('focusout',hide);root.addEventListener('pointerdown',hide);root.addEventListener('keydown',event=>{if((event as KeyboardEvent).key==='Escape')hide()});
}
let hintSerial=0;
