import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const state=vi.hoisted(()=>({records:[] as any[],files:new Map<string,File>()}));
vi.mock('../core/translation/document-library-backup',()=>({
  exportDocumentLibraryBackup:vi.fn(async()=>JSON.stringify({format:'pi-translator-document-library',version:7,documents:[],recentReadingOverrides:{}})),
  previewDocumentLibraryBackup:vi.fn(async()=>({token:'library-token'})),
  importDocumentLibraryBackup:vi.fn(async()=>0),
}));
vi.mock('../core/pdf/original-file-repository',async importOriginal=>({
  ...await importOriginal<object>(),
  listOriginalPdfs:vi.fn(async()=>state.records),
  readOriginalPdf:vi.fn(async(id:string)=>({metadata:state.records.find(row=>row.id===id),file:state.files.get(id)})),
}));
import {createLibraryBackupFile,readLibraryBackupFile,previewLibraryBackupFile,MAX_LIBRARY_BACKUP_FILE_BYTES} from '../core/translation/document-library-backup-file';
import {validateOriginalPdfEntries,listOriginalPdfs,type OriginalPdfImportEntry} from '../core/pdf/original-file-repository';
import {importDocumentLibraryBackup} from '../core/translation/document-library-backup';
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
function entry(name='paper.pdf'):OriginalPdfImportEntry{
  const bytes=Buffer.from(`%PDF-1.4\nA local source file: ${name}.\n%%EOF`),fingerprint=hash(bytes),id=hash(`pdf-content:${fingerprint}`).slice(0,32);
  return {metadata:{id,fingerprint,name,size:bytes.length,savedAt:12},file:new Blob([bytes],{type:'application/pdf'})};
}
beforeEach(()=>{state.records=[];state.files.clear();vi.clearAllMocks()});
async function bundle(){const row=entry();state.records=[row.metadata];state.files.set(row.metadata.id,new File([row.file],row.metadata.name));return createLibraryBackupFile(true)}
describe('bounded optional original PDF backup container (offline)',()=>{
  it('keeps default JSON export and legacy preview independent of original PDF storage',async()=>{
    const result=await createLibraryBackupFile();expect(result.name).toMatch(/\.json$/);expect(listOriginalPdfs).not.toHaveBeenCalled();
    const parsed=await readLibraryBackupFile(result.blob);expect(parsed.hasOriginals).toBe(false);expect(JSON.parse(parsed.libraryText).version).toBe(7);
    expect((await previewLibraryBackupFile(parsed)).originals).toBeUndefined();expect(importDocumentLibraryBackup).not.toHaveBeenCalled();
  });
  it('round trips exact binary source, fingerprint, file name and saved time without base64',async()=>{
    const result=await bundle(),parsed=await readLibraryBackupFile(result.blob);expect(result.name).toMatch(/\.pibackup$/);expect(parsed.hasOriginals).toBe(true);
    expect(parsed.originals[0]!.metadata).toEqual(entry().metadata);expect(Buffer.from(await parsed.originals[0]!.file.arrayBuffer())).toEqual(Buffer.from(await entry().file.arrayBuffer()));
    await expect(validateOriginalPdfEntries(parsed.originals)).resolves.toBeUndefined();expect(importDocumentLibraryBackup).not.toHaveBeenCalled();
  });
  it('rejects altered PDF bytes before any record import',async()=>{
    const result=await bundle(),bytes=new Uint8Array(await result.blob.arrayBuffer());bytes[bytes.length-1]=bytes[bytes.length-1]!^1;
    const parsed=await readLibraryBackupFile(new Blob([bytes]));await expect(validateOriginalPdfEntries(parsed.originals)).rejects.toThrow('校验失败');expect(importDocumentLibraryBackup).not.toHaveBeenCalled();
  });
  it('rejects altered library data and truncated or appended container bytes',async()=>{
    const result=await bundle(),bytes=new Uint8Array(await result.blob.arrayBuffer());const header=new DataView(bytes.buffer).getUint32(16,true);bytes[20+header]=bytes[20+header]!^1;
    await expect(readLibraryBackupFile(new Blob([bytes]))).rejects.toThrow('资料校验失败');
    await expect(readLibraryBackupFile(result.blob.slice(0,result.blob.size-1))).rejects.toThrow('不完整');
    await expect(readLibraryBackupFile(new Blob([result.blob,'x']))).rejects.toThrow('长度不符');
  });
  it('rejects excessive headers, file sizes and unsupported bundle versions',async()=>{
    const result=await bundle(),bytes=new Uint8Array(await result.blob.arrayBuffer());new DataView(bytes.buffer).setUint32(16,65_537,true);
    await expect(readLibraryBackupFile(new Blob([bytes]))).rejects.toThrow('信息无效');
    const huge=new Blob();Object.defineProperty(huge,'size',{value:MAX_LIBRARY_BACKUP_FILE_BYTES+1});await expect(readLibraryBackupFile(huge)).rejects.toThrow('容量上限');
    const text=new TextEncoder().encode(JSON.stringify({format:'pi-translator-original-backup',version:2})),length=new ArrayBuffer(4);new DataView(length).setUint32(0,text.length,true);
    await expect(readLibraryBackupFile(new Blob(['PI-BACKUP-PDF-1\n',length,text]))).rejects.toThrow('信息无效');
  });
  it('enforces identity, duplicate, 50 MB and 30-file limits before writes',async()=>{
    const original=entry();await expect(validateOriginalPdfEntries([original,original])).rejects.toThrow('重复');
    await expect(validateOriginalPdfEntries([{...original,metadata:{...original.metadata,id:'a'.repeat(32)}}])).rejects.toThrow('校验失败');
    await expect(validateOriginalPdfEntries([{...original,metadata:{...original.metadata,size:50*1024*1024+1}}])).rejects.toThrow('信息不完整');
    await expect(validateOriginalPdfEntries(Array.from({length:31},()=>original))).rejects.toThrow('信息不完整');
    await expect(validateOriginalPdfEntries(Array.from({length:5},(_,i)=>({...original,metadata:{...original.metadata,id:String(i).padStart(32,'0'),size:50*1024*1024}})))).rejects.toThrow('超过 200 MB');
    expect(importDocumentLibraryBackup).not.toHaveBeenCalled();
  });
  it('honors cancellation before export, parse and after a checked file',async()=>{
    const controller=new AbortController();controller.abort();await expect(createLibraryBackupFile(true,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    await expect(readLibraryBackupFile(new Blob(),{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    const next=new AbortController();await expect(validateOriginalPdfEntries([entry(),entry('another.pdf')],next.signal,()=>next.abort())).rejects.toMatchObject({name:'AbortError'});
  });
});
