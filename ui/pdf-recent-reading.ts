import {t,msg} from '../core/i18n/ui-language';
import {listRecentPdfReadings,type RecentPdfReading} from '../core/translation/recent-reading-library';
import {pdfReadingStateId} from '../core/pdf/reading-state';

/** Original files are selected by the user; the URL contains only a record ID. */
export function bindPdfRecentReading(options:{empty:HTMLElement;notice:(text:string)=>void;openCopy?:(id:string)=>Promise<boolean>}){
  let requested=new URL(location.href).searchParams.get('recent'),target:RecentPdfReading|undefined;
  const read=async()=>{
    if(!requested)return undefined;
    if(!/^[a-f0-9]{32}$/u.test(requested))throw new Error(t('最近阅读记录无效，原有资料未改变。'));
    let unavailable=false;const item=(await listRecentPdfReadings([],()=>{unavailable=true})).find(item=>item.id===requested);
    if(!item&&unavailable)throw new Error(t('原 PDF 副本暂时无法读取，请回到资料库刷新后重试。'));
    if(!item||item.hidden)throw new Error(t('这条阅读记录已移除，原有译文与笔记未改变。'));
    return item;
  };
  return {
    matches:async(fingerprint:string,id:string)=>{
      if(!/^[a-f0-9]{32}$/u.test(id))return false;
      const item=(await listRecentPdfReadings()).find(item=>item.id===id&&!item.hidden);
      return Boolean(item&&await pdfReadingStateId(`pdf-content:${fingerprint}`)===item.id);
    },
    prepare:async()=>{
      if(!requested)return;
      try{
        const item=await read();if(!item)return;
        if(item.hasLocalCopy&&options.openCopy&&await options.openCopy(item.id))return;
        if(item.originalCopyUnavailable)options.notice(t('原 PDF 副本暂时无法读取，请回到资料库刷新后重试。'));
        options.empty.querySelector('h1')!.textContent=t('选择原 PDF 继续阅读');
        options.empty.querySelector('p')!.textContent=t('原文件由你保留；选择后核验内容，恢复阅读位置和笔记，不重新翻译。');
        const preview=document.createElement('p');preview.className='pdf-excerpt-source-preview';preview.textContent=`${item.name}${item.state?msg` · 上次第 ${item.state.pageNumber} 页`:''}`;options.empty.querySelector('button')!.before(preview);
      }catch(error){options.notice(error instanceof Error?error.message:String(error))}
    },
    verify:async(fingerprint:string)=>{
      if(!requested)return;
      const item=await read();if(!item)return;
      if(await pdfReadingStateId(`pdf-content:${fingerprint}`)!==item.id)throw new Error(t('所选 PDF 与这条阅读记录不符，请选择原文件；原有位置和笔记未改变。'));
      target=item;
    },
    fallbackPage:()=>target?.fallbackPage,
    complete:()=>{if(!requested)return;requested=null;target=undefined;const url=new URL(location.href);url.searchParams.delete('recent');history.replaceState(null,'',url)},
  };
}
