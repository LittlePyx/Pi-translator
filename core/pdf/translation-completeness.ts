import { isLikelyTargetLanguage } from '../language/target-language';
import { extractDelimitedFormulae } from '../translation/formula-output-validation';

/** Local evidence of missing prose, not a semantic translation score. Math,
 * citations and names must not count as untranslated sentences. */
export function pdfTranslationProse(text: string): string {
  let prose = text;
  for (const snippet of extractDelimitedFormulae(text).snippets) prose = prose.replace(snippet, ' ');
  return prose.replace(/\\texttt\s*\{([^{}]+)\}/gu, '$1').replace(/\\([{}])/gu, '$1')
    .replace(/\{[A-Za-z0-9.,+_-]+\}@[\w.-]+\.[A-Za-z]{2,}/gu, ' ')
    .replace(/\{\{m[1-9]\d{0,2}\}\}|〔[^〕]*(?:待核对|见原文)[^〕]*〕/gu, ' ')
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, ' ')
    .replace(/\\[A-Za-z]+|\\[^\s]|[_^{}$]/gu, ' ')
    .replace(/^\s*(?:以下(?:是|为)?(?:翻译|译文)(?:结果)?|译文|翻译结果|translation)\s*[:：]\s*/iu, '')
    .replace(/\s+/gu, ' ').trim();
}

const compact = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const words = (text: string) => (text.match(/\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu) ?? []).filter(word => word.length > 1);
const hanCount = (text: string) => text.match(/\p{Script=Han}/gu)?.length ?? 0;
const kanaCount = (text: string) => text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;

function isIdentifierOrNameList(text: string, raw: string): boolean {
  if (/^(?:\d+-(?:shot|way)[\s|,;]*)+$/iu.test(text)) return true;
  const tokens = words(text);
  if (!tokens.length) return !/\p{L}{2}/u.test(text);
  if (tokens.every(token => /^[A-Z\d]+$/u.test(token) || token.length === 1)) return true;
  // Dataset/model identifiers such as CelebA or ResNet need no invented name.
  if (tokens.length === 1 && /[a-z][A-Z]/u.test(tokens[0]!)) return true;
  // Explicit affiliation numbers/initials distinguish author lists from titles.
  return tokens.length >= 4 && /\d|\b[A-Z]\./u.test(raw) &&
    tokens.every(token => /^[A-Z][a-z]+$|^[A-Z]+$|^(?:van|von|de)$/u.test(token));
}

function isStandaloneMath(text: string): boolean {
  if (!/[=≈≠≤≥∈]/u.test(text) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ||
      /\b(?:the|and|is|are|of|to|in|that|with|for|we|where|from|it|as|by|if|or)\b/iu.test(text)) return false;
  return words(text).every(word => word.length <= 2 || /^[A-Z]+(?:-[A-Z]+)*$/u.test(word) ||
    /^(?:sigmoid|relu|softmax|concat|sin|cos|tan|exp|log|lim|max|min|det|diag|tr|vec)$/iu.test(word));
}

/** Author/affiliation metadata can retain Latin names while translating only
 * the city. Require the names and institution to survive; a shortened body or
 * a model's unrelated recognition must not qualify for this exception. */
function retainedAuthorMetadata(source:string,target:string,recognized?:string):boolean{
  const raw=recognized??source;
  if(compact(pdfTranslationProse(raw))!==compact(pdfTranslationProse(source)))return false;
  const match=/^([\s\S]+),\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s*$/u.exec(raw.trim());
  if(!match)return false;
  const names=words(match[1]!),city=words(match[2]!);
  if(names.length<6||names.length>24||!names.every(w=>/^[A-Z][A-Za-z]*$|^(?:van|von|de)$/u.test(w))||
      names.some(w=>/^(?:The|This|These|We|Our|For|From|With|Using|On|In|Of|And|To|Is|Are)$/u.test(w)))return false;
  const lines=match[1]!.split(/\n+/u).map(s=>words(s)).filter(s=>s.length);
  const authorLines=lines.length>=3&&lines.slice(0,-1).every(line=>line.length>=2&&line.length<=6);
  const institution=names.some(w=>/University|Institute|Department|Laboratory|College|Research|[A-Z][a-z]+[A-Z]/u.test(w));
  const kept=compact(target);
  return(authorLines||institution)&&names.every(w=>kept.includes(compact(w)))&&
    (city.every(w=>kept.includes(compact(w)))||hanCount(target)>=2);
}

export function pdfHasTargetProse(text: string, language: string): boolean {
  const prose = pdfTranslationProse(text);
  if (language === 'zh-CN' || language === 'zh' || language === 'zh-TW') return hanCount(prose) > 0 && !kanaCount(prose);
  if (language === 'ja') return kanaCount(prose) > 0 || (hanCount(prose) > 0 && words(prose).length < 4);
  if (['en', 'de', 'fr'].includes(language)) {
    const latin = prose.match(/\p{Script=Latin}/gu)?.length ?? 0;
    if (latin < 2 || latin / Math.max(1, latin + hanCount(prose) + kanaCount(prose)) < .6) return false;
    // Technical headings often have no function words. Treat that as unknown,
    // rather than rejecting valid Latin-language prose for lack of a score.
    return isLikelyTargetLanguage(prose, language) ||
      !['en', 'de', 'fr'].some(other => other !== language && isLikelyTargetLanguage(prose, other));
  }
  return isLikelyTargetLanguage(prose, language);
}

export function pdfTranslationProseIssues(source: string, translation: string, language: string,
  recognizedText?: string): string[] {
  if (!translation.trim()) return ['模型未返回译文'];
  const original = pdfTranslationProse(source), target = pdfTranslationProse(translation);
  if(retainedAuthorMetadata(source,translation,recognizedText))return [];
  if (!/\p{L}{2}/u.test(original) || isIdentifierOrNameList(original, source) || isStandaloneMath(original)) return [];
  const sourceIsTarget = pdfHasTargetProse(original, language);
  const echo = compact(target) === compact(original) || Boolean(recognizedText &&
    compact(target) === compact(pdfTranslationProse(recognizedText)));
  if (echo && !sourceIsTarget) return ['模型返回内容与原文相同，未翻译正文'];
  if (!target || !/\p{L}/u.test(target)) return ['模型仅返回公式或符号，遗漏正文译文'];
  if (!pdfHasTargetProse(target, language)) return ['模型正文未通过目标语言校验'];
  const issues: string[] = [];
  const sourceWords = words(original).length;
  const targetUnits = language.startsWith('zh') ? hanCount(target) : language === 'ja'
    ? hanCount(target) + kanaCount(target) : words(target).length;
  const latinTarget = ['en', 'de', 'fr'].includes(language);
  const sourceUnits = sourceWords + (hanCount(original) + kanaCount(original)) * (latinTarget ? .5 : 1);
  // Deliberately only extreme shortening. Short headings and concise equation
  // introductions must remain visible, even when completeness needs review.
  if ((sourceUnits >= 8 && targetUnits < (latinTarget ? 3 : 6)) ||
      (sourceUnits >= 24 && (targetUnits < 8 || (sourceUnits >= 60 && targetUnits < sourceUnits * .16)))) {
    issues.push('正文译文较短，完整性待核对；已保留返回内容');
  }
  if (!sourceIsTarget && (language.startsWith('zh') || language === 'ja')) {
    const normalizedSource = words(original).map(word => word.toLocaleLowerCase()).join(' ');
    for (const run of target.matchAll(/[A-Za-z][A-Za-z\s,'’()-]{45,}/gu)) {
      const tokens = words(run[0]);
      if (tokens.length < 12 || tokens.filter(token => /^(?:the|and|is|are|of|to|in|that|with|for)$/iu.test(token)).length < 3) continue;
      if (normalizedSource.includes(tokens.map(token => token.toLocaleLowerCase()).join(' '))) {
        issues.push('译文中仍保留较长的原文句子，可能存在局部漏译'); break;
      }
    }
  }
  return issues;
}
