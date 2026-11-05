import {t} from '../core/i18n/ui-language';
import {pdfReadingStateId} from '../core/pdf/reading-state';
import {listOriginalPdfs,readOriginalPdf,removeOriginalPdf,saveOriginalPdf} from '../core/pdf/original-file-repository';
import {showUndoNotice} from './action-feedback';

export function bindPdfOriginalCopy(options:{current:()=>{data:Uint8Array;name:string;fingerprint:string}|undefined;open:(file:File,canOpen?:()=>boolean)=>Promise<void>;notice:(text:string)=>void}){
  const button=document.querySelector<HTMLButtonElement>('#pdf-original-copy')!;
  let revision=0;
  async function refresh():Promise<void>{
    const doc=options.current(),epoch=++revision;button.hidden=!doc;if(!doc)return;
    try{
      const id=await pdfReadingStateId(`pdf-content:${doc.fingerprint}`),record=(await listOriginalPdfs()).find(item=>item.id===id);
      if(epoch!==revision||options.current()?.fingerprint!==doc.fingerprint)return;
      button.textContent=record?t('移除本机原文件副本'):t('在本机保留原 PDF');
      button.title=record?t('只移除副本，译文、笔记和阅读位置仍保留。'):t('仅保存到本机，便于下次直接打开。每份最多 50 MB；导出备份时可勾选包含原 PDF。');
    }catch(error){options.notice(error instanceof Error?error.message:String(error))}
  }
  button.addEventListener('click',()=>{
    const doc=options.current();if(!doc||button.disabled)return;button.disabled=true;
    void(async()=>{
      const id=await pdfReadingStateId(`pdf-content:${doc.fingerprint}`),record=(await listOriginalPdfs()).find(item=>item.id===id);
      if(record){await removeOriginalPdf(record);showUndoNotice(t('已移除本机原文件副本'),async()=>{await saveOriginalPdf(doc.data,record.name);await refresh()})}
      else {await saveOriginalPdf(doc.data,doc.name);options.notice(t('原 PDF 已保留在本机，下次可从最近阅读直接打开。'))}
      await refresh();
    })().catch(error=>options.notice(error instanceof Error?error.message:String(error))).finally(()=>{button.disabled=false});
  });
  async function open(id:string,canOpen:()=>boolean=()=>true):Promise<boolean>{const record=await readOriginalPdf(id);if(!record||!canOpen())return false;await options.open(record.file,canOpen);return true}
  return {refresh,open};
}
