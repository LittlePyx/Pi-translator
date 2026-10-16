import type {PdfDocumentTranslationBlock, PdfDocumentTranslationPageInput} from './document-translation';

/** Display semantics only: never part of translation identity or source text. */
export type PdfPaperRole = 'title' | 'authors' | 'publication';
export function isPdfPaperRole(value:unknown):value is PdfPaperRole {
  return value==='title'||value==='authors'||value==='publication';
}
const EMAIL=/[\w.+-]+\s*@\s*[\w.-]+\.[A-Za-z]{2,}/u;
const AFFILIATION=/\b(?:university|institute|department|school of|laborator(?:y|ies)|research cent(?:er|re)|deepmind|microsoft research|google research)\b|大学|学院|研究院|研究所|实验室|实验中心/iu;
const ABSTRACT=/^(?:abstract|摘要|概要)\s*[:：]?$/iu;
const BODY=/^(?:1[.、]?\s*(?:introduction|引言|绪论)|introduction|引言|绪论)\s*[:：]?$/iu;
const normalized=(text:string)=>text.replace(/\s+/gu,' ').trim();
export function isPdfPublicationText(value:string):boolean {
  const text=normalized(value);
  return text.length<=1000&&(
    /\b(?:doi\s*:|issn\s*:|arxiv\s*:)|https?:\/\/(?:dx\.)?doi\.org\/10\.|©|\bcopyright\s*(?:\(c\))?\s*(?:19|20)\d{2}/iu.test(text)||
    /\b(?:proceedings of|journal of|transactions on|published in)\b.+\b(?:19|20)\d{2}\b/iu.test(text)||
    /\b(?:received|accepted|published online)\s*[:：]?\s*(?:\d{1,2}\s+\p{L}+\s+)?(?:19|20)\d{2}\b/iu.test(text)||
    /(?:期刊|出版|发表|录用|收稿|版权|卷\s*\d+|第\s*\d+\s*卷).{0,90}(?:19|20)\d{2}/u.test(text));
}
function authorText(value:string):boolean {
  const text=normalized(value).replace(/^[\d*†‡.,\s]+/u,'');
  if(EMAIL.test(text)||AFFILIATION.test(text)||/^(?:by\s+|authors?\s*[:：]|作者\s*[:：])/iu.test(text))return true;
  const words=text.replace(/\b(?:and|van|von|de|del|der|la)\b|[&,;*†‡\d⁰¹²³⁴⁵⁶⁷⁸⁹]/giu,' ').split(/\s+/u).filter(Boolean);
  return words.length>=2&&words.length<=18&&words.every(word=>/^(?:\p{Lu}[\p{L}’'.-]*|[\p{Script=Han}]{2,4})$/u.test(word));
}
function prose(value:string):boolean {
  return (value.match(/\b(?:we|our|this|these|which|because|show|propose|consider|demonstrate|is|are|was|were)\b/giu)?.length??0)>=3||value.length>900;
}

/** Require a first-page front-matter boundary and local typography/position.
 * Names mentioned in the body and bibliography entries are never candidates.
 * Unknown blocks keep the existing ordinary rendering. */
export function classifyPdfPaperBlocks(blocks:readonly PdfDocumentTranslationBlock[],pages:readonly PdfDocumentTranslationPageInput[]):PdfDocumentTranslationBlock[]{
  const first=blocks.filter(block=>block.pageNumber===1),input=pages.find(page=>page.pageNumber===1);
  if(!first.length)return [...blocks];
  const bounds=(block:PdfDocumentTranslationBlock)=>block.sourceAnchor??block.sourceRegions?.find(region=>region.pageNumber===1)?.sourceAnchor;
  const boundary=first.findIndex(block=>ABSTRACT.test(normalized(block.text))||BODY.test(normalized(block.text)));
  const roles=new Map<string,PdfPaperRole>();
  const front=boundary>=0?first.slice(0,boundary):first.slice(0,6);
  const authorAt=front.findIndex((block,index)=>index>0&&authorText(block.text)&&!prose(block.text));
  const candidates=front.filter(block=>!['figure','table','code','footnote'].includes(block.kind??'')&&
    block.text.length>=10&&block.text.length<=300&&!isPdfPublicationText(block.text)&&!EMAIL.test(block.text)&&!AFFILIATION.test(block.text)&&
    !/^\d+(?:\.\d+)*[.)]?\s/u.test(block.text)&&!ABSTRACT.test(normalized(block.text))&&!BODY.test(normalized(block.text))&&
    (bounds(block)?.topRatio??1)<.35);
  const height=(block:PdfDocumentTranslationBlock)=>{
    const a=bounds(block);if(!a||!input)return 0;
    const heights=input.items.filter(item=>item.height&&item.left!==undefined&&item.top!==undefined&&
      (item.left+(item.width??0)/2)/input.pageWidth>=a.leftRatio&&(item.left+(item.width??0)/2)/input.pageWidth<=a.leftRatio+a.widthRatio&&
      (item.top+item.height/2)/input.pageHeight>=a.topRatio&&(item.top+item.height/2)/input.pageHeight<=a.topRatio+a.heightRatio).map(item=>item.height!);
    return heights.length?Math.max(...heights):0;
  };
  const bodyHeights=input?.items.flatMap(item=>item.height?[item.height]:[]).sort((a,b)=>a-b)??[];
  const typicalHeight=bodyHeights[Math.floor(bodyHeights.length/2)]??0;
  const title=candidates.find(block=>boundary>=0||authorAt>first.indexOf(block)&&height(block)>typicalHeight*1.12);
  if(title){
    roles.set(title.id,'title');
    const start=first.indexOf(title)+1,end=boundary>=0?boundary:front.length;
    for(const block of first.slice(start,end)){
      const author=!prose(block.text)&&authorText(block.text)&&!isPdfPublicationText(block.text);
      if(author)roles.set(block.id,'authors');else if(boundary<0)break;
    }
  }
  for(const block of first){
    const a=bounds(block),index=first.indexOf(block),edge=block.kind==='footnote'||a&&(a.topRatio<.2||a.topRatio+a.heightRatio>.84);
    if(!['figure','table','formula','code'].includes(block.kind??'')&&isPdfPublicationText(block.text)&&!prose(block.text)&&(edge||boundary>=0&&index<boundary))roles.set(block.id,'publication');
  }
  return blocks.map(block=>roles.has(block.id)?{...block,paperRole:roles.get(block.id)!}:block);
}
