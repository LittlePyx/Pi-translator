import {recoveryFingerprint,recoveryLockAvailable} from './recovery-journal';
import {exportDocumentLibraryBackup,previewDocumentLibraryBackup,importDocumentLibraryBackup,type DocumentLibraryImportPreview} from './document-library-backup';
import {listOriginalPdfs,readOriginalPdf,previewOriginalPdfImport,MAX_TOTAL_ORIGINAL_PDF_BYTES,MAX_ORIGINAL_PDF_FILES,type OriginalPdfImportEntry,type OriginalPdfImportPreview,type OriginalPdfMetadata} from '../pdf/original-file-repository';

const MAGIC=new TextEncoder().encode('PI-BACKUP-PDF-1\n');
const MAX_HEADER=65_536,MAX_LIBRARY=20_000_000;
export const MAX_LIBRARY_BACKUP_FILE_BYTES=MAX_LIBRARY+MAX_TOTAL_ORIGINAL_PDF_BYTES+MAX_HEADER+MAGIC.length+4;
interface Progress {signal?:AbortSignal;onProgress?:(done:number,total:number)=>void}
export interface LibraryBackupFile {libraryText:string;originals:OriginalPdfImportEntry[];hasOriginals:boolean}
export interface LibraryBackupFilePreview {library:DocumentLibraryImportPreview;originals?:OriginalPdfImportPreview}
const hash=async(bytes:ArrayBuffer):Promise<string>=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function originalPdfBackupSummary():Promise<{count:number;bytes:number}>{
  const records=await listOriginalPdfs();return {count:records.length,bytes:records.reduce((sum,item)=>sum+item.size,0)};
}
export async function createLibraryBackupFile(includeOriginals=false,progress:Progress={}):Promise<{blob:Blob;name:string}>{
  progress.signal?.throwIfAborted();const text=await exportDocumentLibraryBackup();progress.signal?.throwIfAborted();
  const library=new TextEncoder().encode(text);
  if(library.byteLength>MAX_LIBRARY)throw new Error('备份资料超过 20 MB。');
  if(!includeOriginals)return {blob:new Blob([library],{type:'application/json;charset=utf-8'}),name:'pi-translator-document-library.json'};
  const metadata:OriginalPdfMetadata[]=[],files:Blob[]=[];
  const records=await listOriginalPdfs();
  if(records.reduce((sum,item)=>sum+item.size,0)>MAX_TOTAL_ORIGINAL_PDF_BYTES)throw new Error('原 PDF 备份超过 200 MB。');
  for(let index=0;index<records.length;index++){
    progress.signal?.throwIfAborted();const expected=records[index]!,record=await readOriginalPdf(expected.id);progress.signal?.throwIfAborted();
    if(!record||JSON.stringify(record.metadata)!==JSON.stringify(expected))throw new Error('本机原 PDF 已变化，请重新导出备份。');
    metadata.push(record.metadata);files.push(record.file);progress.onProgress?.(index+1,records.length);
  }
  const header=new TextEncoder().encode(JSON.stringify({format:'pi-translator-original-backup',version:1,libraryBytes:library.byteLength,librarySha256:await hash(library.buffer),originals:metadata}));
  if(header.byteLength>MAX_HEADER)throw new Error('原 PDF 备份信息过大。');
  const length=new ArrayBuffer(4);new DataView(length).setUint32(0,header.byteLength,true);progress.signal?.throwIfAborted();
  return {blob:new Blob([MAGIC,length,header,library,...files],{type:'application/octet-stream'}),name:'pi-translator-document-library.pibackup'};
}
export async function readLibraryBackupFile(file:Blob,progress:Progress={}):Promise<LibraryBackupFile>{
  progress.signal?.throwIfAborted();if(file.size>MAX_LIBRARY_BACKUP_FILE_BYTES)throw new Error('备份文件超过容量上限。');
  const prefix=new Uint8Array(await file.slice(0,MAGIC.length+4).arrayBuffer());progress.signal?.throwIfAborted();
  const bundled=MAGIC.every((byte,index)=>prefix[index]===byte);
  if(!bundled){
    if(file.size>MAX_LIBRARY)throw new Error('备份文件超过 20 MB。');
    const libraryText=await file.text();progress.signal?.throwIfAborted();return {libraryText,originals:[],hasOriginals:false};
  }
  if(prefix.length!==MAGIC.length+4)throw new Error('原 PDF 备份不完整，未导入任何记录。');
  const length=new DataView(prefix.buffer).getUint32(MAGIC.length,true),start=MAGIC.length+4;
  if(!length||length>MAX_HEADER||start+length>file.size)throw new Error('原 PDF 备份信息无效。');
  const header=JSON.parse(await file.slice(start,start+length).text()) as Record<string,unknown>;
  if(!header||header.format!=='pi-translator-original-backup'||header.version!==1||!Number.isSafeInteger(header.libraryBytes)||Number(header.libraryBytes)<=0||Number(header.libraryBytes)>MAX_LIBRARY||typeof header.librarySha256!=='string'||!/^[a-f0-9]{64}$/.test(header.librarySha256)||!Array.isArray(header.originals)||header.originals.length>MAX_ORIGINAL_PDF_FILES)throw new Error('原 PDF 备份信息无效。');
  let cursor=start+length;const library=await file.slice(cursor,cursor+Number(header.libraryBytes)).arrayBuffer();cursor+=Number(header.libraryBytes);
  progress.signal?.throwIfAborted();if(await hash(library)!==header.librarySha256)throw new Error('备份资料校验失败，未导入任何记录。');
  const originals:OriginalPdfImportEntry[]=[];let total=0;
  for(const raw of header.originals){
    if(!raw||typeof raw!=='object'||!Number.isSafeInteger(raw.size)||raw.size<=0||raw.size>50*1024*1024)throw new Error('原 PDF 备份信息无效。');
    total+=raw.size;if(total>MAX_TOTAL_ORIGINAL_PDF_BYTES||cursor+raw.size>file.size)throw new Error('原 PDF 备份不完整或超过容量上限。');
    const metadata:OriginalPdfMetadata={id:raw.id,name:raw.name,fingerprint:raw.fingerprint,size:raw.size,savedAt:raw.savedAt};
    originals.push({metadata,file:file.slice(cursor,cursor+raw.size,'application/pdf')});cursor+=raw.size;
  }
  if(cursor!==file.size)throw new Error('原 PDF 备份长度不符，未导入任何记录。');
  return {libraryText:new TextDecoder('utf-8',{fatal:true}).decode(library),originals,hasOriginals:true};
}
export async function previewLibraryBackupFile(data:LibraryBackupFile,progress:Progress={}):Promise<LibraryBackupFilePreview>{
  progress.signal?.throwIfAborted();const library=await previewDocumentLibraryBackup(data.libraryText);progress.signal?.throwIfAborted();
  const originals=data.hasOriginals?await previewOriginalPdfImport(data.originals,progress.signal,progress.onProgress):undefined;
  progress.signal?.throwIfAborted();return {library,...(originals?{originals}:{})};
}
export async function importLibraryBackupFile(data:LibraryBackupFile,preview:LibraryBackupFilePreview):Promise<number>{
  if(data.hasOriginals&&!preview.originals)throw new Error('请先预览原 PDF 备份。');
  return importDocumentLibraryBackup(data.libraryText,preview.library.token,preview.originals?{entries:data.originals,token:preview.originals.token}:undefined,recoveryLockAvailable()?await recoveryFingerprint(data):undefined);
}
