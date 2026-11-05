import {readingPageUrl,pdfReadingTarget} from '../content/reading-navigation';
import type {RuntimeMessage} from '../messaging/messages';

interface SourceTab {id?:number|undefined;windowId?:number|undefined;url?:string|undefined;active?:boolean|undefined;lastAccessed?:number|undefined}
interface SourceBrowser {
  runtime:{getURL:(path:'/pdf.html')=>string;sendMessage:(message:RuntimeMessage)=>Promise<unknown>};
  tabs:{query:(query:{})=>Promise<SourceTab[]>;sendMessage:(id:number,message:RuntimeMessage)=>Promise<unknown>;update:(id:number,properties:{active:true})=>Promise<unknown>};
  windows:{update:(id:number,properties:{focused:true})=>Promise<unknown>};
}
export async function openReadingSource(value:string,api:SourceBrowser):Promise<{opened:boolean;reused:boolean;draft?:boolean}>{
  const viewer=new URL(api.runtime.getURL('/pdf.html'));
  const pdf=pdfReadingTarget(value,viewer.href);
  const web=readingPageUrl(value);
  if(!pdf&&!web)throw new Error('来源链接无效。');
  const tabs=(await api.tabs.query({})).filter(tab=>{
    if(tab.id===undefined||!tab.url)return false;
    if(!pdf)return readingPageUrl(tab.url)===web;
    try{const candidate=new URL(tab.url);return candidate.protocol===viewer.protocol&&candidate.host===viewer.host&&candidate.pathname===viewer.pathname}catch{return false}
  }).sort((a,b)=>Number(Boolean(b.active))-Number(Boolean(a.active))||(b.lastAccessed??0)-(a.lastAccessed??0));
  for(const tab of tabs){
    try{
      const message:RuntimeMessage={type:'REUSE_READING_SOURCE',payload:{url:value,tabId:tab.id!}};
      // Extension readers receive runtime messages; web content scripts receive tab messages.
      const response=await (pdf?api.runtime.sendMessage(message):api.tabs.sendMessage(tab.id!,message)) as {ok?:boolean;data?:{matched?:boolean;draft?:boolean}};
      if(!response?.ok||response.data?.matched!==true)continue;
      await api.tabs.update(tab.id!,{active:true});if(tab.windowId!==undefined)await api.windows.update(tab.windowId,{focused:true}).catch(()=>undefined);
      return {opened:true,reused:true,...(response.data.draft?{draft:true}:{})};
    }catch{/* A closed tab or a page without the reader uses the original open path. */}
  }
  // The original anchor owns fallback, including native opener/new-tab behavior.
  return {opened:false,reused:false};
}
