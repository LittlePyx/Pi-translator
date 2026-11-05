import {pdfReadingStateId} from './reading-state';

export const ORIGINAL_PDF_DATABASE='pi-original-pdfs-v1';
export const MAX_ORIGINAL_PDF_BYTES=50*1024*1024;
export const MAX_TOTAL_ORIGINAL_PDF_BYTES=200*1024*1024,MAX_ORIGINAL_PDF_FILES=30;
const MAX_TOTAL_BYTES=MAX_TOTAL_ORIGINAL_PDF_BYTES,MAX_FILES=MAX_ORIGINAL_PDF_FILES;
export interface OriginalPdfMetadata {id:string;name:string;fingerprint:string;size:number;savedAt:number}
function metadataList(values:unknown[]):OriginalPdfMetadata[]{
  if(values.length>MAX_FILES||values.some(value=>{const item=value as OriginalPdfMetadata;return !item||typeof item.id!=='string'||!/^[a-f0-9]{32}$/.test(item.id)||typeof item.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(item.fingerprint)||typeof item.name!=='string'||!item.name.trim()||item.name.length>500||!Number.isSafeInteger(item.size)||item.size<=0||item.size>MAX_ORIGINAL_PDF_BYTES||!Number.isFinite(item.savedAt)||item.savedAt<0}))throw new Error('本机 PDF 副本信息不完整，未覆盖任何文件，请重新选择原件。');
  return values as OriginalPdfMetadata[];
}
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  const request=indexedDB.open(ORIGINAL_PDF_DATABASE,1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('metadata',{keyPath:'id'});request.result.createObjectStore('files')};
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};
  request.onerror=()=>reject(new Error('无法访问本机 PDF 副本，请重新选择原文件。'));
  request.onblocked=()=>reject(new Error('请关闭其他阅读窗口后重试，原文件与笔记未改变。'));
})}
function validId(id:string):void{if(!/^[a-f0-9]{32}$/.test(id))throw new Error('PDF 副本标识无效。')}
export async function listOriginalPdfs():Promise<OriginalPdfMetadata[]>{
  const db=await database();try{return await new Promise((resolve,reject)=>{const request=db.transaction('metadata').objectStore('metadata').getAll();request.onsuccess=()=>{try{resolve(metadataList(request.result))}catch(error){reject(error)}};request.onerror=()=>reject(request.error)})}finally{db.close()}
}
let originalTail:Promise<unknown>=Promise.resolve();
function withOriginalPdfLock<T>(operation:()=>Promise<T>):Promise<T>{
  const run=originalTail.catch(()=>undefined).then(async()=>{
    if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request('pi-original-pdfs-v1',operation);
    return operation();
  });
  originalTail=run;return run as Promise<T>;
}
export function saveOriginalPdf(data:Uint8Array,name:string):Promise<OriginalPdfMetadata>{return withOriginalPdfLock(()=>saveOriginalPdfLocked(data,name))}
async function saveOriginalPdfLocked(data:Uint8Array,name:string):Promise<OriginalPdfMetadata>{
  if(!data.byteLength||data.byteLength>MAX_ORIGINAL_PDF_BYTES)throw new Error('每份原 PDF 副本最多 50 MB；原有资料未改变。');
  if(!new TextDecoder().decode(data.slice(0,1024)).includes('%PDF-'))throw new Error('这不是有效的 PDF 原文件。');
  const bytes=data.slice().buffer,fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const record:OriginalPdfMetadata={id:await pdfReadingStateId(`pdf-content:${fingerprint}`),name:name.trim().slice(0,500)||'PDF',fingerprint,size:bytes.byteLength,savedAt:Date.now()};
  const db=await database();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(['metadata','files'],'readwrite'),meta=tx.objectStore('metadata'),request=meta.getAll();let failure:Error|undefined,result=record;
    request.onsuccess=()=>{
      let records:OriginalPdfMetadata[];try{records=metadataList(request.result)}catch(error){failure=error as Error;tx.abort();return}const existing=records.find(item=>item.id===record.id);
      if(existing){if(existing.fingerprint!==fingerprint){failure=new Error('PDF 副本身份冲突，未覆盖现有文件。');tx.abort()}else result=existing;return}
      if(records.length>=MAX_FILES||records.reduce((sum,item)=>sum+item.size,0)+record.size>MAX_TOTAL_BYTES){failure=new Error('原 PDF 副本最多 30 份、合计 200 MB，请先移除不需要的副本；译文和笔记仍保留。');tx.abort();return}
      meta.add(record);tx.objectStore('files').add(bytes,record.id);
    };
    tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(failure??new Error('保存原 PDF 副本失败，可能空间不足；旧资料未改变。'));
  })}finally{db.close()}
}
export async function readOriginalPdf(id:string):Promise<{metadata:OriginalPdfMetadata;file:File}|undefined>{
  validId(id);const db=await database();
  const result=await new Promise<{metadata?:OriginalPdfMetadata;bytes?:ArrayBuffer}>((resolve,reject)=>{
    const tx=db.transaction(['metadata','files']),meta=tx.objectStore('metadata').get(id),file=tx.objectStore('files').get(id);
    tx.oncomplete=()=>resolve({metadata:meta.result,bytes:file.result});tx.onabort=tx.onerror=()=>reject(new Error('读取本机 PDF 副本失败。'));
  }).finally(()=>db.close());
  if(!result.metadata&&!result.bytes)return undefined;
  const {metadata,bytes}=result;
  if(!metadata||!(bytes instanceof ArrayBuffer)||metadata.size!==bytes.byteLength||metadata.id!==id)throw new Error('本机 PDF 副本不完整，请重新选择原文件；笔记未改变。');
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(metadata.fingerprint!==fingerprint||await pdfReadingStateId(`pdf-content:${fingerprint}`)!==id)throw new Error('本机 PDF 副本内容不符，请重新选择原文件；笔记未改变。');
  return {metadata,file:new File([bytes],metadata.name,{type:'application/pdf',lastModified:metadata.savedAt})};
}
export function removeOriginalPdf(expected:OriginalPdfMetadata):Promise<void>{return withOriginalPdfLock(()=>removeOriginalPdfLocked(expected))}
async function removeOriginalPdfLocked(expected:OriginalPdfMetadata):Promise<void>{
  validId(expected.id);const db=await database();try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(['metadata','files'],'readwrite'),meta=tx.objectStore('metadata'),request=meta.get(expected.id);let conflict=false;
    request.onsuccess=()=>{if(JSON.stringify(request.result)!==JSON.stringify(expected)){conflict=true;tx.abort();return}meta.delete(expected.id);tx.objectStore('files').delete(expected.id)};
    tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error(conflict?'副本已在其他窗口变化，原有资料未改变。':'移除副本失败，原有资料未改变。'));
  })}finally{db.close()}
}

export interface OriginalPdfImportEntry {metadata:OriginalPdfMetadata;file:Blob}
export interface OriginalPdfImportPreview {token:string;added:number;existing:number;bytes:number}
const digest=async(bytes:ArrayBuffer):Promise<string>=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const metadataState=(records:OriginalPdfMetadata[]):string=>JSON.stringify([...records].sort((a,b)=>a.id.localeCompare(b.id)));
export async function validateOriginalPdfEntries(entries:OriginalPdfImportEntry[],signal?:AbortSignal,onProgress?:(done:number,total:number)=>void):Promise<void>{
  const records=metadataList(entries.map(entry=>entry.metadata));
  if(new Set(records.map(item=>item.id)).size!==records.length||records.reduce((sum,item)=>sum+item.size,0)>MAX_TOTAL_BYTES)throw new Error('原 PDF 备份包含重复文件或超过 200 MB。');
  for(let index=0;index<entries.length;index++){
    signal?.throwIfAborted();const {metadata,file}=entries[index]!;
    if(!(file instanceof Blob)||file.size!==metadata.size)throw new Error('原 PDF 备份不完整，未导入任何记录。');
    const bytes=await file.arrayBuffer();signal?.throwIfAborted();
    if(!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-')||await digest(bytes)!==metadata.fingerprint||await pdfReadingStateId(`pdf-content:${metadata.fingerprint}`)!==metadata.id)throw new Error('原 PDF 备份校验失败，未导入任何记录。');
    signal?.throwIfAborted();onProgress?.(index+1,entries.length);
  }
}
async function prepareOriginalImport(entries:OriginalPdfImportEntry[]):Promise<{preview:OriginalPdfImportPreview;state:string;added:OriginalPdfImportEntry[]}>{
  const records=await listOriginalPdfs(),state=metadataState(records),added:OriginalPdfImportEntry[]=[];
  for(const entry of entries){
    const existing=records.find(item=>item.id===entry.metadata.id);
    if(existing){if(existing.fingerprint!==entry.metadata.fingerprint||existing.size!==entry.metadata.size)throw new Error('原 PDF 身份冲突，未覆盖本机文件。');await readOriginalPdf(existing.id)}
    else added.push(entry);
  }
  if(records.length+added.length>MAX_FILES||records.reduce((sum,item)=>sum+item.size,0)+added.reduce((sum,item)=>sum+item.metadata.size,0)>MAX_TOTAL_BYTES)throw new Error('恢复后原 PDF 将超过 30 份或 200 MB；现有资料未改变。');
  const token=await digest(new TextEncoder().encode(JSON.stringify([state,entries.map(entry=>entry.metadata)])).buffer);
  return {state,added,preview:{token,added:added.length,existing:entries.length-added.length,bytes:entries.reduce((sum,item)=>sum+item.metadata.size,0)}};
}
export async function previewOriginalPdfImport(entries:OriginalPdfImportEntry[],signal?:AbortSignal,onProgress?:(done:number,total:number)=>void):Promise<OriginalPdfImportPreview>{
  await validateOriginalPdfEntries(entries,signal,onProgress);signal?.throwIfAborted();return (await prepareOriginalImport(entries)).preview;
}
/** Add-only atomic PDF transaction; roll back its additions if the library write fails. */
export function importOriginalPdfs(entries:OriginalPdfImportEntry[],expectedToken:string,commitLibrary:()=>Promise<void>):Promise<void>{return withOriginalPdfLock(async()=>{
  await validateOriginalPdfEntries(entries);const prepared=await prepareOriginalImport(entries);
  if(prepared.preview.token!==expectedToken)throw new Error('本机原 PDF 已变化，请重新预览后导入。');
  const additions=await Promise.all(prepared.added.map(async entry=>({metadata:entry.metadata,bytes:await entry.file.arrayBuffer()})));
  const db=await database();
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['metadata','files'],'readwrite'),meta=tx.objectStore('metadata'),request=meta.getAll();let conflict=false;
      request.onsuccess=()=>{try{if(metadataState(metadataList(request.result))!==prepared.state){conflict=true;tx.abort();return}for(const item of additions){meta.add(item.metadata);tx.objectStore('files').add(item.bytes,item.metadata.id)}}catch{tx.abort()}};
      tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error(conflict?'本机原 PDF 已变化，请重新预览后导入。':'恢复原 PDF 失败，可能空间不足；现有资料未改变。'));
    });
    try{await commitLibrary()}catch(error){
      try{await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction(['metadata','files'],'readwrite'),meta=tx.objectStore('metadata');let conflict=false;
        for(const item of additions){const request=meta.get(item.metadata.id);request.onsuccess=()=>{if(JSON.stringify(request.result)!==JSON.stringify(item.metadata)){conflict=true;tx.abort();return}meta.delete(item.metadata.id);tx.objectStore('files').delete(item.metadata.id)}}
        tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error(conflict?'原 PDF 在恢复期间变化，新增副本未撤回。':'新增原 PDF 副本未能撤回。'));
      })}catch{throw new Error('资料恢复失败；部分新增原 PDF 副本可能仍保留，请检查本机副本。原有文件未被覆盖。')}
      throw error;
    }
  }finally{db.close()}
})}
