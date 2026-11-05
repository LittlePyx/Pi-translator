import {isRuntimeMessage} from '../core/messaging/messages';
import {describe,it,expect} from 'vitest';
import {pdfCitationMetadata,fillMissingCitationFields} from '../core/content/local-citation';
import {recommendGlossaryProfile} from '../core/settings/glossary-recommendation';
import {correctionTermSuggestions,deduplicateCorrectionTerms,paragraphCorrectionTerms} from '../core/translation/correction-term-suggestions';
describe('local reading assistance',()=>{
 it('extracts explicit PDF fields without treating creation year as publication year',()=>{expect(pdfCitationMetadata({Title:'A retained paper',Author:'Jane Doe;John Roe',CreationDate:'D:20260101'},{'prism:publicationdate':'2024-02-03'},'doi: 10.1234/paper.')).toEqual({title:'A retained paper',authors:'Jane Doe\nJohn Roe',year:'2024',doi:'10.1234/paper'})});
 it('keeps ambiguous DOI and missing publication fields empty',()=>{expect(pdfCitationMetadata({Title:'Untitled',CreationDate:'D:2026'}, {},'doi: 10.1234/one doi: 10.1234/two')).toEqual({});expect(pdfCitationMetadata({}, {},'A reference mentions 10.1234/one')).toEqual({})});
 it('prefers explicit DOI over incidental first-page identifiers',()=>{expect(pdfCitationMetadata({DOI:'10.1234/real'}, {},'10.1234/reference')).toEqual({doi:'10.1234/real'})});
 it('preserves valid DOI parentheses and removes only unmatched closing punctuation',()=>{expect(pdfCitationMetadata({}, {},'(doi: 10.1234/a(b)).')).toEqual({doi:'10.1234/a(b)'})});
 it('fills draft blanks while preserving every nonempty manual field and the input object',()=>{const before={sourceTitle:'人工标题',authors:'人工作者',year:'2023',doi:'10.1234/manual',sourceUrl:'https://example.org/manual',note:'旧笔记'};expect(fillMissingCitationFields(before,{title:'建议标题',authors:'候选',year:'2026',doi:'10.1234/new',url:'https://example.org/new'})).toEqual(before);expect(fillMissingCitationFields({sourceTitle:'',note:'保留'}, {title:'标题',year:'2024'})).toEqual({sourceTitle:'标题',note:'保留',year:'2024'})});
 const profiles=[{id:'stats',name:'统计学',entries:[{source:'power',target:'功效'},{source:'sample size',target:'样本量'},{source:'confidence interval',target:'置信区间'}]},{id:'energy',name:'能源',entries:[{source:'power',target:'功率'},{source:'voltage',target:'电压'}]}];
 it('recommends an existing scheme from several distinct bounded source terms',()=>{expect(recommendGlossaryProfile(profiles,'The power depends on sample size and confidence interval.')).toMatchObject({profileId:'stats',matchedTerms:['power','sample size','confidence interval']})});
 it('refuses shared single-word evidence, near ties, duplicates and word fragments',()=>{expect(recommendGlossaryProfile(profiles,'The power changes.')).toBeUndefined();expect(recommendGlossaryProfile(profiles,'power sample size confidence interval voltage')).toBeUndefined();expect(recommendGlossaryProfile(profiles,'powerful sample sizes')).toBeUndefined();expect(recommendGlossaryProfile([{...profiles[0]!,entries:[{source:'Power',target:'A'},{source:'power',target:'B'}]}],'power')).toBeUndefined()});
 it('prepares a short selected term without confirming or writing it',()=>{expect(correctionTermSuggestions('adaptive sensing','自适应传感','自适应感知')).toEqual([{source:'adaptive sensing',target:'自适应感知',previousTarget:'自适应传感'}])});
 it('uses an existing bilingual mapping for a single exact paragraph replacement',()=>{expect(correctionTermSuggestions('The kernel maps a sample.','内核映射样本。','核函数映射样本。',[{source:'kernel',target:'内核'}])).toEqual([{source:'kernel',target:'核函数',previousTarget:'内核'}])});
 it('refuses two possible source terms for the same changed translation',()=>{expect(correctionTermSuggestions('The kernel and core are discussed.','内核正在讨论。','核函数正在讨论。',[{source:'kernel',target:'内核'},{source:'core',target:'内核'}])).toEqual([])});
 it('does not treat words inside formulas as evidence for a corrected source term',()=>{expect(correctionTermSuggestions('Consider $kernel(x)$ in this equation.','内核用于计算。','核函数用于计算。',[{source:'kernel',target:'内核'}])).toEqual([]);expect(correctionTermSuggestions('The kernel acts on $x$.','内核用于计算 $x$。','核函数用于计算 $x$。',[{source:'kernel',target:'内核'}])).toEqual([{source:'kernel',target:'核函数',previousTarget:'内核'}])});
 it('does not recommend a field from formula-internal words alone',()=>{expect(recommendGlossaryProfile(profiles,'Consider $power + sample size + confidence interval$.')).toBeUndefined()});
 it('does not guess source alignment, sentence rewrites, formulas, duplicate targets or unchanged text',()=>{expect(correctionTermSuggestions('A long source paragraph.','旧句子。','新句子。')).toEqual([]);expect(correctionTermSuggestions('kernel','内核 $x$','核函数 $x$')).toEqual([]);expect(correctionTermSuggestions('The kernel maps.','内核和内核。','核函数和内核。',[{source:'kernel',target:'内核'}])).toEqual([]);expect(correctionTermSuggestions('kernel','内核','内核')).toEqual([])});
});

describe('correction term continuity',()=>{
 it('deduplicates normalized source pairs and preserves a genuinely different correction',()=>{
  const candidate={source:' Kernel ',target:'核函数',previousTarget:'内核'};
  expect(deduplicateCorrectionTerms([candidate,{...candidate,source:'kernel'}],[{source:'KERNEL',target:'核函数'}])).toEqual([]);
  expect(deduplicateCorrectionTerms([candidate],[{source:'kernel',target:'内核'}])).toEqual([candidate]);
  expect(deduplicateCorrectionTerms([candidate,{...candidate,target:'核心'}],[])).toEqual([]);
 });
 it('derives restored corrections from their original accepted baseline, not the outgoing revision',()=>{
  const original={id:'revision-original',createdAt:1,reason:'correction' as const,translatedText:'内核映射样本。'};
  const corrected={id:'revision-corrected',createdAt:2,reason:'restore' as const,translatedText:'核函数映射样本。',manualCorrection:true as const};
  const known=[{source:'kernel',target:'内核'}];
  expect(paragraphCorrectionTerms('The kernel maps a sample.',{translatedText:original.translatedText,manualCorrection:true,revisions:[corrected,original]},known)).toEqual([]);
  const restored={translatedText:corrected.translatedText,manualCorrection:true as const,revisions:[{...corrected,translatedText:original.translatedText},original]};
  expect(paragraphCorrectionTerms('The kernel maps a sample.',restored,known)).toEqual([{source:'kernel',target:'核函数',previousTarget:'内核'}]);
  expect(paragraphCorrectionTerms('The kernel maps a sample.',{...restored,revisions:[{...corrected,reason:'correction'},original]},known)).toHaveLength(1);
  expect(restored.revisions).toEqual([{...corrected,translatedText:original.translatedText},original]);
  expect(paragraphCorrectionTerms('The kernel maps a sample.',{...restored,revisions:[corrected]},known)).toEqual([]);
 });
 it('changes the read-only scheme revision when its translations change',()=>{
  const profiles=[{id:'stats',name:'Statistics',entries:[{source:'power',target:'功效'},{source:'sample size',target:'样本量'},{source:'confidence interval',target:'置信区间'}]}];
  const first=recommendGlossaryProfile(profiles,'power sample size confidence interval')!;
  const next=recommendGlossaryProfile([{...profiles[0]!,entries:profiles[0]!.entries.map(term=>({...term,target:term.target+'新'}))}], 'power sample size confidence interval')!;
  expect(first.revision).not.toBe(next.revision);
 });
});

it('accepts only an identity in document-memory update notifications',()=>{
 expect(isRuntimeMessage({type:'DOCUMENT_MEMORY_UPDATED',payload:{documentId:'doc-reader'}})).toBe(true);
 expect(isRuntimeMessage({type:'DOCUMENT_MEMORY_UPDATED',payload:{documentId:'invalid'}})).toBe(false);
 expect(isRuntimeMessage({type:'DOCUMENT_MEMORY_UPDATED',payload:{documentId:'doc-reader',note:'private'}})).toBe(false);
});
