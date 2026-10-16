import type {FormulaDocument} from '../translation/formula-document';
import {pdfTranslationProseIssues} from './translation-completeness';
const REF=/\{\{m[1-9]\d{0,2}\}\}/gu;
export const PDF_CITATION=/[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\[\d+(?:\s*[-–,]\s*\d+)*\]|\\(?:cite[pt]?|eqref|ref)\{[^{}]+\}/gu;
const refs=(text:string)=>[...text.matchAll(REF)].map(match=>match[0]);
const sameRefs=(a:string,b:string)=>JSON.stringify(refs(a).sort())===JSON.stringify(refs(b).sort());
export interface PdfProseUnit {id:string;text:string;after:string}

/** Keep offsets against unmodified source; soft wraps cannot split a sentence. */
export function pdfProseUnits(source:string):PdfProseUnit[]{
  let spans:Array<{index:number;segment:string}>;
  try{spans=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(source.replace(/\n+/gu,run=>run.length===1?' ':run))]}
  catch{spans=[{index:0,segment:source}]}
  const chunks:string[]=[];
  for(let index=0;index<spans.length;index++){
    const text=source.slice(spans[index]!.index,spans[index+1]?.index??source.length);
    if(!/\p{L}|\{\{m\d+\}\}/u.test(text)&&chunks.length)chunks[chunks.length-1]+=text;
    else chunks.push(text);
  }
  if(chunks.length>64)chunks.splice(63,chunks.length-63,chunks.slice(63).join(''));
  return chunks.flatMap((raw,index)=>raw.trim()?[{id:`PDF_SENTENCE_${index+1}`,text:raw.trim(),after:raw.match(/\s*$/u)![0]}]:[]);
}
export function pdfCitationIssues(source:string,target:string):string[]{
  const markers=[...source.matchAll(PDF_CITATION)].map(match=>match[0]);
  return [...new Set(markers)].filter(marker=>target.split(marker).length!==source.split(marker).length).map(marker=>`脚注或引文标记未对应：${marker}`);
}
function condition(text:string,chinese=false):{condition:string;conclusion:string}|undefined{
  const start=chinese?/(?:如果|假如|倘若|若)/u.exec(text):/\bif\b/iu.exec(text);
  if(!start)return undefined;
  const rest=text.slice(start.index+start[0].length),then=chinese?/(?:那么|则)/u.exec(rest):/\bthen\b/iu.exec(rest);
  if(then)return{condition:rest.slice(0,then.index),conclusion:text.slice(0,start.index)+rest.slice(then.index+then[0].length)};
  if(refs(text.slice(0,start.index)).length)return{condition:rest,conclusion:text.slice(0,start.index)};
  return undefined;
}

/** Observable binding/omission checks, not a general semantic quality score. */
export function pdfProseBindingIssues(source:string,target:string,language:string):string[]{
  const issues=pdfCitationIssues(source,target),chinese=language.startsWith('zh');
  if(!chinese&&language!=='en')return issues;
  const sourceCondition=condition(source);
  if(sourceCondition&&(refs(sourceCondition.condition).length||refs(sourceCondition.conclusion).length)){
    const translatedCondition=condition(target,chinese);
    if(!translatedCondition)issues.push('条件与结论缺少可核对的边界');
    else if(!sameRefs(sourceCondition.condition,translatedCondition.condition)||!sameRefs(sourceCondition.conclusion,translatedCondition.conclusion))issues.push('条件与结论中的公式指代不对应');
  }
  const negative=chinese?/不|未|无|非|没有/u:/\b(?:not|no|never|neither|without)\b/iu;
  if(/\b(?:not|never|need not)\b/iu.test(source)&&!negative.test(target))issues.push('原文的否定或例外条件可能遗漏');
  if(/^\s*(?:Hence|Therefore|Thus|Consequently)\b/iu.test(source)&&!(chinese?/因此|因而|所以|由此|从而|故|于是/u:/\b(?:hence|therefore|thus|consequently|so)\b/iu).test(target))issues.push('结论句的推导关系可能遗漏');
  if(!chinese)return [...new Set(issues)];
  if(/\bcounter(?:s|ing|ed)?\b/iu.test(source)&&/\bcounter(?:s|ing|ed)?\b/iu.test(target))issues.push('变量关系词仍保留原文');
  for(const match of source.matchAll(REF)){
    const tail=source.slice(match.index!+match[0].length),at=target.indexOf(match[0]);if(at<0)continue;
    const nearby=target.slice(at+match[0].length).split(/\{\{|[。；！？]/u)[0]!.slice(0,28);
    if(/^-?tuple\b/iu.test(tail)&&!/元组|多元组/u.test(nearby))issues.push('元组变量与所指对象可能错位');
    if(/^(?:-person\b|\s+(?:(?:strategy spaces|strategies) of the (?:other )?)?(?:other )?(?:players|participants)\b)/iu.test(tail)&&!/参与者|参与方|玩家|博弈者|选手|人/u.test(nearby))issues.push('参与者数量与策略或元组的指代可能错位');
  }
  for(const pair of source.matchAll(/(\{\{m\d+\}\})\s+counters\s+(\{\{m\d+\}\})/giu)){
    const a=target.indexOf(pair[1]!),b=target.indexOf(pair[2]!);if(a<0||b<0)continue;
    const between=target.slice(Math.min(a,b)+pair[1]!.length,Math.max(a,b));
    if((a>b)!==/被/u.test(between))issues.push('变量关系的主语与对象可能颠倒');
  }
  return [...new Set(issues)];
}
export function pdfFormulaProseIssues(document:FormulaDocument,language:string):string[]{
  // Compact retained registries intentionally omit original prose.
  if(!/[A-Za-z]{3}|\p{Script=Han}{2}/u.test(document.sourceTemplate.replace(REF,'')))return [];
  const source=pdfProseUnits(document.sourceTemplate),target=pdfProseUnits(document.translationTemplate);
  const issues=pdfCitationIssues(document.sourceTemplate,document.translationTemplate);
  for(const unit of source){
    const ids=refs(unit.text),anchors=ids.filter(id=>source.filter(item=>item.text.includes(id)).length===1);if(!anchors.length)continue;
    const text=target.filter(item=>anchors.some(id=>item.text.includes(id))).map(item=>item.text).join(' ');
    if(!sameRefs(unit.text,text)){issues.push('公式跨越了原文句子或语义单元');continue}
    issues.push(...pdfProseBindingIssues(unit.text,text,language));
  }
  const last=source.at(-1),translatedLast=target.at(-1);
  if(last&&translatedLast&&(last.text.replace(REF,'').match(/\p{L}+/gu)?.length??0)>=8){
    issues.push(...pdfTranslationProseIssues(last.text,translatedLast.text,language).map(issue=>`结尾：${issue}`));
    if(!refs(last.text).length)issues.push(...pdfProseBindingIssues(last.text,translatedLast.text,language));
  }
  return [...new Set(issues)];
}
