import type {RuntimeMessage,RuntimeResponse} from '../core/messaging/messages';

/** Keep native new-tab gestures. A normal click may focus an identified reader. */
export function reuseReadingSource(link:HTMLAnchorElement,onOpened?:()=>void):void{
  let busy=false,native=false;
  const openNative=()=>{if(!link.isConnected)return false;native=true;try{link.click();return true}finally{native=false}};
  link.addEventListener('click',event=>{
    if(native||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();if(busy)return;busy=true;const url=link.href;link.setAttribute('aria-busy','true');
    void browser.runtime.sendMessage({type:'OPEN_READING_SOURCE',payload:{url}} satisfies RuntimeMessage).then((response:RuntimeResponse<{reused:boolean}>)=>{
      if(!response.ok)throw new Error(response.error.message);
      if(response.data.reused||openNative())onOpened?.();
    }).catch(()=>{if(openNative())onOpened?.()}).finally(()=>{busy=false;link.removeAttribute('aria-busy')});
  });
}
