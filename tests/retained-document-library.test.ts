import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {listRetainedDocuments,renameRetainedDocument,deleteRetainedDocument,RETAINED_DOCUMENT_NAMES_KEY} from '../core/translation/retained-document-library';
import {saveRetainedPdfDocumentTranslationSession,pdfDocumentTranslationSessionDocumentKey,pdfDocumentTranslationSessionBlockSignature,pdfDocumentTranslationSessionBehaviorKey,clearRetainedPdfDocumentTranslationSession} from '../core/pdf/document-translation-session';
import {saveRetainedBilingualPageSession,bilingualPageSessionPageKey,bilingualPageSessionBlockSignature,bilingualPageSessionBehaviorKey} from '../core/translation/bilingual-page-session';
import {parseFormulaDocument} from '../core/translation/formula-document';
const local:Record<string,unknown>={};
beforeEach(()=>{for(const key of Object.keys(local))delete local[key];vi.stubGlobal('browser',{storage:{local:{get:async(key:string)=>({[key]:local[key]}),set:async(value:Record<string,unknown>)=>{Object.assign(local,value)},remove:async(key:string)=>{delete local[key]}}}})});
afterEach(()=>vi.unstubAllGlobals());
async function seed(){
  const descriptor={documentKey:pdfDocumentTranslationSessionDocumentKey('private-file.pdf'),targetLanguage:'zh-CN' as const,sourceLanguage:'auto',style:'academic' as const,contentMode:'auto' as const};
  const signatures=[pdfDocumentTranslationSessionBlockSignature(1,'Private first',0),pdfDocumentTranslationSessionBlockSignature(2,'Private second',0)];
  const formulaDocument=parseFormulaDocument({recognizedText:'Private second {{m1}}.',translation:'后段 {{m1}}。',formulas:[{id:'m1',latex:'x=y',display:false}]});
  await saveRetainedPdfDocumentTranslationSession({descriptor,documentSignatures:signatures,activity:'complete',blocks:[
    {signature:signatures[1]!,translatedText:'后段',formulaDocument,formulaReviewMessage:'请核对'},
    {signature:signatures[0]!,translatedText:'前段'},
  ]},pdfDocumentTranslationSessionBehaviorKey('model'));
  const webSignature=bilingualPageSessionBlockSignature('P','Private web source',0);
  const {documentKey: _key,...sharedDescriptor}=descriptor;
  await saveRetainedBilingualPageSession({descriptor:{...sharedDescriptor,pageKey:bilingualPageSessionPageKey('https://private.example/page')},documentSignatures:[webSignature],excludedSignatures:[],displayMode:'bilingual',translationsHidden:false,controlCollapsed:false,activity:'paused',blocks:[{signature:webSignature,translatedText:'网页译文',hidden:false}]},bilingualPageSessionBehaviorKey('model'));
  return{descriptor,signatures};
}
describe('local retained-document library',()=>{
  it('exports source-order translations, expanded formulas and review notes without source identities',async()=>{
    await seed();const entries=await listRetainedDocuments();expect(entries).toHaveLength(2);
    const pdf=entries.find(entry=>entry.kind==='pdf')!;
    expect(pdf.markdown.indexOf('前段')).toBeLessThan(pdf.markdown.indexOf('后段'));
    expect(pdf.markdown).toContain('$x=y$');expect(pdf.markdown).toContain('待核对：请核对');
    expect(pdf.text).toContain('$x=y$');expect(pdf.text).toContain('待核对：请核对');expect(pdf.text).not.toContain('仅导出保留的译文');
    expect(JSON.stringify(local)).not.toContain('private-file.pdf');expect(JSON.stringify(entries)).not.toContain('private.example');
    expect(pdf.markdown).not.toContain('Private second');expect(pdf.markdown).not.toContain('{{m1}}');
  });
  it('keeps explicit names across translation writes, deletes one entry and its name only',async()=>{
    const {descriptor,signatures}=await seed();let entries=await listRetainedDocuments();const pdf=entries.find(entry=>entry.kind==='pdf')!;
    await renameRetainedDocument(pdf.id,'我的论文');
    await saveRetainedPdfDocumentTranslationSession({descriptor,documentSignatures:signatures,activity:'complete',blocks:[{signature:signatures[0]!,translatedText:'更新译文'}]},pdfDocumentTranslationSessionBehaviorKey('model'));
    entries=await listRetainedDocuments();expect(entries.find(entry=>entry.id===pdf.id)?.name).toBe('我的论文');
    await deleteRetainedDocument(pdf.id);expect((await listRetainedDocuments()).map(entry=>entry.kind)).toEqual(['web']);
    expect(local[RETAINED_DOCUMENT_NAMES_KEY]).toBeUndefined();
    await expect(renameRetainedDocument(pdf.id,'已移除')).rejects.toThrow('移除');
  });
  it('does not create names for missing records or accept empty/oversized aliases',async()=>{
    await seed();const entry=(await listRetainedDocuments())[0]!;
    await expect(renameRetainedDocument(entry.id,' ')).rejects.toThrow();
    await expect(renameRetainedDocument(entry.id,'a'.repeat(121))).rejects.toThrow();
    await clearRetainedPdfDocumentTranslationSession();
    expect((await listRetainedDocuments()).map(item=>item.kind)).toEqual(['web']);
  });
});
