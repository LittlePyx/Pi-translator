import {formulaDocumentIssues,isFormulaDocument,type FormulaDocument} from '../translation/formula-document';
import {hasUnregisteredMath} from '../translation/formula-template';
import type {PreparedTranslationInput,TranslationStyle,TranslationBatchItemResult} from '../translation/types';
import {TranslationError} from '../messaging/errors';
import {pdfTranslationProseIssues} from './translation-completeness';
import {PDF_CITATION,pdfFormulaProseIssues,pdfProseBindingIssues,pdfProseUnits} from './prose-bindings';
const REF=/\{\{(m[1-9]\d{0,2})\}\}/gu;
const protectedToken=(index:number)=>`⟦PDF_MATH_${String(index+1).padStart(4,'0')}⟧`;
export interface RepairPdfFormulaProseRequest {requestId:string;document:FormulaDocument;targetLanguage:string;sourceLanguage:string;style:TranslationStyle;sourceTabId?:number}
interface LogicalUnit {id:string;text:string;after:string;parts:Array<{id:string;text:string;role?:'head'|'condition'|'conclusion'}>}
function logicalUnits(document:FormulaDocument,targetLanguage:string):LogicalUnit[]{
  return pdfProseUnits(document.sourceTemplate).map(unit=>{
    const branch=targetLanguage.startsWith('zh')&&!/\bif and only if\b/iu.test(unit.text)?/\bif\b/iu.exec(unit.text):null;
    if(branch){
      const prefix=unit.text.slice(0,branch.index).trim(),rest=unit.text.slice(branch.index+branch[0].length).trim(),then=/\bthen\b/iu.exec(rest);
      if(!/\bif\b/iu.test(rest)&&(then||/\{\{m\d+\}\}/u.test(prefix))){
        const condition=then?rest.slice(0,then.index).trim():rest,conclusion=then?rest.slice(then.index+then[0].length).trim():prefix;
        const head=then?prefix:'';
        return{...unit,parts:[...(head?[{id:unit.id+'_HEAD',text:head,role:'head' as const}]:[]),{id:unit.id+'_IF',text:condition,role:'condition' as const},{id:unit.id+'_THEN',text:conclusion,role:'conclusion' as const}]};
      }
    }
    return{...unit,parts:[{id:unit.id,text:unit.text}]};
  });
}
function repairUnits(document:FormulaDocument,targetLanguage:string){
  let citation=0,anaphora=0;
  return logicalUnits(document,targetLanguage).flatMap(unit=>unit.parts.map(part=>{
    const tokens:Array<{token:string;source:string}>=[];
    const text=part.text.replace(REF,(source,id:string)=>{
      const token=protectedToken(Number(id.slice(1))-1);tokens.push({token,source});return token;
    }).replace(PDF_CITATION,source=>{
      const token=`⟦PDF_CITE_${String(++citation).padStart(4,'0')}⟧`;tokens.push({token,source});return token;
    }).replace(/(?<=\bcounters\s)another\b/giu,source=>{
      if(!targetLanguage.startsWith('zh')||!/-tuples?\b/iu.test(part.text))return source;
      const token=`⟦PDF_ANAPHORA_${String(++anaphora).padStart(4,'0')}⟧`;tokens.push({token,source:'另一组'});return token;
    });
    return{...part,protectedText:text,tokens};
  }));
}
export function preparePdfFormulaProseRepair(value:unknown,targetLanguage='zh-CN'):{document:FormulaDocument;input:PreparedTranslationInput}|undefined{
  if(!isFormulaDocument(value))return undefined;
  const issues=formulaDocumentIssues(value);
  if(issues.some(issue=>!/^m\d+: 原文或译文中的编号缺失或重复$/u.test(issue)))return undefined;
  if(!issues.length&&!pdfFormulaProseIssues(value,targetLanguage).length)return undefined;
  if(formulaDocumentIssues({...value,translationTemplate:value.sourceTemplate}).length)return undefined;
  if([...value.sourceTemplate.matchAll(REF)].some(match=>!value.formulas.some(entry=>entry.id===match[1]))||hasUnregisteredMath(value.sourceTemplate.replace(REF,'')))return undefined;
  if((value.sourceTemplate.replace(REF,'').match(/[A-Za-z\p{Script=Han}]/gu)?.length??0)<12)return undefined;
  const formulas:FormulaDocument['formulas']=[],seen=new Set<string>();
  const sourceTemplate=value.sourceTemplate.replace(REF,(_,id:string)=>{
    const source=value.formulas.find(entry=>entry.id===id)!;
    if(source.sourceEquationId&&seen.has(source.sourceEquationId))return '{{invalid}}';
    if(source.sourceEquationId)seen.add(source.sourceEquationId);
    const entry={...source,id:`m${formulas.length+1}`};formulas.push(entry);return `{{${entry.id}}}`;
  });
  if(formulas.length>96||sourceTemplate.includes('{{invalid}}'))return undefined;
  const document:FormulaDocument={version:1,sourceTemplate,translationTemplate:sourceTemplate,formulas,issues:[]},units=repairUnits(document,targetLanguage);
  const gameContext=/-tuples?\b/iu.test(sourceTemplate)&&/\bplayers?\b/iu.test(sourceTemplate)&&/\bstrategies\b/iu.test(sourceTemplate);
  return{document,input:{text:units.map(unit=>unit.protectedText).join('\n'),segments:units.map(unit=>({id:unit.id,text:unit.protectedText})),
    placeholderTokens:units.flatMap(unit=>unit.tokens.map(item=>item.token)),strictPlaceholderPreservation:true,allowPlaceholderReordering:true,
    contextText:JSON.stringify({formulaMeanings:formulas.map((entry,index)=>({token:protectedToken(index),latex:entry.latex})),anaphoraMeanings:units.flatMap(unit=>unit.tokens.filter(item=>item.token.includes('ANAPHORA')).map(item=>({token:item.token,meaning:'another tuple / 另一组, an anaphor without an added formula'}))),...(gameContext?{termMeanings:{counter:'反制',countering:'反制的',countered:'被反制的'}}:{})}),
    adjustmentInstruction:'Each segment is a COMPLETE source sentence or a complete logical proposition, never a fragment between formulas. IDs ending _IF and _THEN are the condition and conclusion of one original sentence. Translate each as an independent statement, WITHOUT adding outer if/then connectors or copying another proposition. The application constructs 如果 [IF]，则 [THEN] locally. A _HEAD is the introduction to that conditional statement. Copy every protected math, citation and anaphora token exactly once WITHIN its segment; tokens may move with meaning within that proposition only. The locally protected anaphor already means another tuple, so do not expand it with a variable or an extra noun phrase. Formula meanings and termMeanings in referenceContext are comprehension data; translate the prose predicates too, and respect any explicit user glossary. Never substitute LaTeX or bare variables for tokens. Preserve the noun and owner that each variable modifies, including quantities of participants versus strategies. Preserve every condition, conclusion, negation, final qualification and footnote. Return every segment id once. The application restores unchanged formulas and original paragraphs locally.'}};
}
export function finishPdfFormulaProseRepair(document:FormulaDocument,segments:TranslationBatchItemResult[]|undefined,warnings:readonly string[]=[],targetLanguage='zh-CN'):FormulaDocument{
  if(warnings.length)throw new TranslationError('LATEX_VALIDATION_FAILED','正文修复未通过公式对应校验：模型返回了待核对提示。');
  const units=repairUnits(document,targetLanguage),values=new Map<string,string>();
  if(!segments||segments.length!==units.length)throw new TranslationError('LATEX_VALIDATION_FAILED','正文修复未通过公式对应校验：文字片段缺失或重复。');
  for(const segment of segments){
    const unit=units.find(item=>item.id===segment.id);
    if(!unit||values.has(segment.id)||!segment.translatedText.trim())throw new TranslationError('LATEX_VALIDATION_FAILED','正文修复未通过公式对应校验：文字片段缺失或重复。');
    let restored=segment.translatedText.trim();
    if(/\{\{m\d+\}\}/u.test(restored))throw new TranslationError('LATEX_VALIDATION_FAILED','正文修复未通过公式对应校验：文字片段新增了数学内容。');
    for(const {token,source} of unit.tokens){
      if(restored.split(token).length!==2)throw new TranslationError('LATEX_VALIDATION_FAILED','正文修复未通过公式对应校验：公式或脚注离开了所属句子。');
      restored=restored.replace(token,source);
    }
    if(/[⟦⟧]/u.test(restored)||hasUnregisteredMath(restored.replace(REF,'')))throw new TranslationError('LATEX_VALIDATION_FAILED','正文修复未通过公式对应校验：文字片段新增了数学内容。');
    const sourceProse=unit.text.replace(REF,''),targetProse=restored.replace(REF,'');
    if(unit.role&&targetLanguage.startsWith('zh')&&/^(?:如果|假如|若|那么|则)/u.test(restored))throw new TranslationError('LATEX_VALIDATION_FAILED',`正文修复未通过语义单元校验（${unit.id}）：逻辑分句重复添加连接词`);
    if(targetLanguage.startsWith('zh')&&document.formulas.some(entry=>/^[A-Za-z]$/u.test(entry.latex)&&
      new RegExp(`(?<![A-Za-z])${entry.latex}(?![A-Za-z])`,'u').test(targetProse)&&!new RegExp(`(?<![A-Za-z])${entry.latex}(?![A-Za-z])`,'u').test(sourceProse)))throw new TranslationError('LATEX_VALIDATION_FAILED','正文修复未通过公式对应校验：出现未绑定的变量。');
    const issues=[...pdfTranslationProseIssues(unit.text,restored,targetLanguage),...pdfProseBindingIssues(unit.text,restored,targetLanguage)];
    if(issues.length)throw new TranslationError('LATEX_VALIDATION_FAILED',`正文修复未通过语义单元校验（${unit.id}）：${issues.join('；')}`);
    values.set(segment.id,restored);
  }
  const unpunctuate=(text:string)=>text.replace(/[。.,，:：;；]+$/u,'');
  const restored=logicalUnits(document,targetLanguage).map(unit=>{
    if(unit.parts.length===1)return values.get(unit.id)!+unit.after;
    const head=values.get(unit.id+'_HEAD'),condition=values.get(unit.id+'_IF')!,conclusion=values.get(unit.id+'_THEN')!;
    return (head?unpunctuate(head)+'：':'')+'如果'+unpunctuate(condition)+'，则'+unpunctuate(conclusion)+'。'+unit.after;
  }).join('').trim(),next={...document,translationTemplate:restored};
  if(!isFormulaDocument(next)||formulaDocumentIssues(next).length||pdfFormulaProseIssues(next,targetLanguage).length)throw new TranslationError('LATEX_VALIDATION_FAILED','正文修复未通过公式对应校验。');
  return next;
}
