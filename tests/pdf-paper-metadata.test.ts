import {describe,it,expect} from 'vitest';
import {classifyPdfPaperBlocks,isPdfPaperRole,isPdfPublicationText} from '../core/pdf/paper-metadata';
import type {PdfDocumentTranslationBlock as Block} from '../core/pdf/document-translation';
import {isPdfDocumentTranslationSessionBlock,pdfDocumentTranslationSessionBlockSignature} from '../core/pdf/document-translation-session';
const block=(id:string,text:string,top:number,kind?:Block['kind']):Block=>({id,pageNumber:1,blockIndex:Number(id.slice(1)),text,sourceAnchor:{leftRatio:.1,topRatio:top,widthRatio:.8,heightRatio:.04},...(kind?{kind}:{})});
describe('source-derived academic paper display roles',()=>{
  it('distinguishes title, authors/affiliations and publication without changing source identity',()=>{
    const blocks=[block('b0','A demonstration of inference for science',.1),block('b1','Alice Researcher Bob Scholar Institute of Science alice@example.edu',.18),block('b2','Abstract',.28),block('b3','We consider a statistical problem. We show that our method works.',.34),block('b4','Proceedings of the Conference on Learning, 2024. Copyright 2024 by the authors.',.91,'footnote')];
    const output=classifyPdfPaperBlocks(blocks,[]);
    expect(output.map(b=>b.paperRole)).toEqual(['title','authors',undefined,undefined,'publication']);
    expect(output.map(({paperRole:_,...b})=>b)).toEqual(blocks);
    expect(blocks.every(b=>!b.paperRole)).toBe(true);
  });
  it('supports Chinese affiliations and DOI/date metadata at the first-page edge',()=>{
    const blocks=[block('b0','面向学术文献的演示方法',.1),block('b1','张三 李四 北京大学 计算机学院',.18),block('b2','摘要',.29),block('b3','DOI: 10.1000/example. Received 2024.',.92,'footnote')];
    expect(classifyPdfPaperBlocks(blocks,[]).map(b=>b.paperRole)).toEqual(['title','authors',undefined,'publication']);
  });
  it('keeps author particles and conjunctions in the byline and never folds figure captions as publication metadata',()=>{
    const blocks=[block('b0','An example of academic reading',.1),block('b1','Alice van Dijk and Bob de Silva¹',.18),block('b2','Abstract',.28),block('b3','Figure 1. Published in Journal of Science, 2024.',.92,'figure')];
    expect(classifyPdfPaperBlocks(blocks,[]).map(b=>b.paperRole)).toEqual(['title','authors',undefined,undefined]);
  });
  it('does not classify cited authors, journal discussion, body-only fragments or later-page bibliography as front matter',()=>{
    const blocks=[block('b0','1. Introduction',.1),block('b1','Alice Researcher',.2),block('b2','In this paper we consider a journal of science. We show why it was published in 2024.',.3),{...block('b3','Journal of Science, 2024. DOI: 10.1000/example',.12),pageNumber:9}];
    expect(classifyPdfPaperBlocks(blocks,[]).every(b=>!b.paperRole)).toBe(true);
    expect(classifyPdfPaperBlocks([block('b0','A short ordinary paragraph.',.1),block('b1','Another ordinary paragraph.',.2)],[]).every(b=>!b.paperRole)).toBe(true);
  });
  it('keeps role data bounded and compatible with old saved records',()=>{
    const saved={signature:pdfDocumentTranslationSessionBlockSignature(1,'Author',0),translatedText:'作者'};
    expect(isPdfDocumentTranslationSessionBlock(saved)).toBe(true);
    for(const paperRole of ['title','authors','publication'])expect(isPdfDocumentTranslationSessionBlock({...saved,paperRole})).toBe(true);
    for(const paperRole of ['<img>',null,{},'body']){expect(isPdfPaperRole(paperRole)).toBe(false);expect(isPdfDocumentTranslationSessionBlock({...saved,paperRole})).toBe(false)}
    expect(isPdfPublicationText('Figure 1. An author uses a model in 2024.')).toBe(false);
  });
});
