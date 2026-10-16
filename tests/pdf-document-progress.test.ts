import {describe,it,expect} from 'vitest';
import {pdfDocumentProgress,pdfSavedDocumentProgress} from '../core/pdf/document-progress';
import {pdfReviewConfirmation,type PdfReviewBlock} from '../core/pdf/review-queue';
import type {PdfDocumentTranslationSessionSnapshot} from '../core/pdf/document-translation-session';

const signatures=Array.from({length:129},(_,i)=>`block-${i.toString(36)}`);
const saved:PdfDocumentTranslationSessionSnapshot={documentKey:'doc-abc',targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',activity:'complete',updatedAt:1,
  documentSignatures:signatures,blocks:signatures.slice(0,86).map(signature=>({signature,translatedText:'保留译文'}))};

describe('shared PDF completion and review counts',()=>{
  it('counts intentionally preserved references as processed without claiming they were translated',()=>{
    expect(pdfSavedDocumentProgress({...saved,scopeSignatures:signatures,preservedSignatures:signatures.slice(86)})).toMatchObject({
      total:129,processed:129,translated:86,preserved:43,complete:true,coverageKnown:true,review:0});
    expect(pdfSavedDocumentProgress(saved)).toMatchObject({processed:86,total:129,complete:false,coverageKnown:false});
  });
  it('keeps partial ranges separate from whole-document completion',()=>{
    expect(pdfSavedDocumentProgress({...saved,scopeSignatures:signatures.slice(0,50),preservedSignatures:[]})).toMatchObject({
      total:50,processed:50,complete:true,coverageKnown:true});
  });
  it('keeps warnings after confirmation and requires review again when the target changes',()=>{
    const block:PdfReviewBlock={id:'a',pageNumber:1,included:true,status:'done',translatedText:'译文',formulaReviewMessage:'请核对公式'};
    block.reviewConfirmation=pdfReviewConfirmation(block);
    expect(pdfDocumentProgress([block])).toMatchObject({processed:1,review:0,confirmed:1});
    expect(block.formulaReviewMessage).toBe('请核对公式');
    expect(pdfDocumentProgress([{...block,translatedText:'修正后译文'}])).toMatchObject({review:1,confirmed:0});
    expect(pdfSavedDocumentProgress({...saved,blocks:[{signature:signatures[0]!,translatedText:block.translatedText!,formulaReviewMessage:block.formulaReviewMessage!,reviewConfirmation:block.reviewConfirmation}]})).toMatchObject({review:0,confirmed:1});
  });
  it('does not count excluded, pending or failed blocks as completed',()=>{
    const block:PdfReviewBlock={id:'a',pageNumber:1,included:true,status:'idle'};
    expect(pdfDocumentProgress([block,{...block,id:'b',status:'error'},{...block,id:'c',status:'done',included:false}])).toMatchObject({
      total:2,processed:0,pending:1,failed:1,complete:false});
  });
});
