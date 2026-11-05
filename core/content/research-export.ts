import {buildTranslationMarkerMarkdown} from './session-translation-markers';
import {researchExcerptSourceUrl,type ResearchExcerpt} from './research-excerpt-repository';
import {isLexicalLookupCandidate} from '../translation/lexical-lookup';
import {citationUrl} from './excerpt-citation';

export type ResearchExportPreset='research'|'obsidian'|'anki-basic'|'anki';
const html=(text:string)=>text.replace(/[&<>"'\[\]]/gu,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','[':'&#91;',']':'&#93;'}[value]!)).replace(/\r?\n/gu,'<br>');
/** Export saved evidence only. No inference, storage update or model request. */
export function buildResearchExport(items:readonly ResearchExcerpt[],preset:ResearchExportPreset){
  if(!items.length)throw new Error('当前搜索条件下没有可导出的已保存摘录。');
  const anki=preset==='anki'||preset==='anki-basic';
  const eligible=anki?items.filter(item=>item.content.translatedText&&isLexicalLookupCandidate({text:item.content.originalText,contentMode:'plain'})):items;
  if(!eligible.length)throw new Error('没有可导出的短词或短语，请先保存带译义的词条。');
  if(!anki){const markdown=buildTranslationMarkerMarkdown(eligible.map(item=>{const sourceUrl=researchExcerptSourceUrl(item);return {...item.content,...(sourceUrl?{sourceUrl}:{})}}));return {text:preset==='obsidian'?`---\ntype: research-excerpts\n---\n\n${markdown}`:markdown,included:eligible.length,excluded:items.length-eligible.length,extension:'md'}}
  const text=eligible.map(item=>{
    const sourceUrl=researchExcerptSourceUrl(item),content={...item.content,...(sourceUrl?{sourceUrl}:{})};
    {
      // Context may be a fragment; never label it as a complete example sentence.
      const anchor=item.kind==='web'?item.item.anchor:'area' in item?item.area.anchor:'annotation' in item?item.annotation.anchor:item.marker.anchor;
      const context='prefix' in anchor&&'suffix' in anchor?anchor.prefix+anchor.sourceText+anchor.suffix:content.originalText;
      if(preset==='anki-basic'){
        const url=citationUrl(sourceUrl),back=[html(content.translatedText??''),`Context fragment: ${html(context)}`,
          content.note?`Note: ${html(content.note)}`:'',`Source: ${html(content.sourceTitle)}`,
          sourceUrl?`URL: ${url?`<a href="${html(url)}">${html(sourceUrl)}</a>`:html(sourceUrl)}`:'',
          content.pageNumber?`Page: ${content.pageNumber}`:'',content.doi?`DOI: ${html(content.doi)}`:''].filter(Boolean).join('<br><br>');
        return [html(content.originalText),back].map(value=>`"${value.replace(/"/gu,'""')}"`).join('\t');
      }
      return [content.originalText,content.translatedText??'',context,content.note??'',content.sourceTitle,sourceUrl??'',content.pageNumber?String(content.pageNumber):'',content.doi??'']
        .map(value=>`"${value.replace(/"/gu,'""')}"`).join('\t');
    }
  }).join('\n');
  const header=preset==='anki-basic'?'#separator:Tab\n#html:true\n#notetype:Basic\n#columns:Front\tBack':'#separator:Tab\n#html:false\n#columns:Word\tMeaning\tContext fragment\tNote\tSource\tURL\tPage\tDOI';
  return {text:`${header}\n${text}`,
    included:eligible.length,excluded:items.length-eligible.length,extension:'txt'};
}
