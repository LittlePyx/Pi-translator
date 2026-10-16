export interface ExcerptCitation { sourceTitle: string; sourceUrl?: string; doi?: string; note?: string }
export function citationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) return undefined;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function citationDoi(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const doi = value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/iu, '');
  return doi.length <= 200 && /^10\.\d{4,9}\/[^\s<>]+$/u.test(doi) ? doi : undefined;
}
export function normalizeExcerptCitation(value: ExcerptCitation): ExcerptCitation {
  const sourceTitle = value.sourceTitle.trim();
  if (!sourceTitle || sourceTitle.length > 500) throw new Error('请填写 1–500 字符的来源标题。');
  const sourceUrl = citationUrl(value.sourceUrl);
  const doi = citationDoi(value.doi);
  if (value.sourceUrl?.trim() && !sourceUrl) throw new Error('来源链接需为有效的 HTTP 或 HTTPS 地址。');
  if (value.doi?.trim() && !doi) throw new Error('DOI 应以 10. 开头，也可粘贴 doi.org 链接。');
  const note = value.note?.trim();
  if (note && note.length > 2000) throw new Error('个人笔记最多 2000 字符。');
  return {sourceTitle, ...(sourceUrl ? {sourceUrl} : {}), ...(doi ? {doi} : {}), ...(note ? {note} : {})};
}
export function escapeCitationText(value: string): string {
  return value.replace(/[\r\n]/gu, ' ').replace(/([\\`*_\[\]<>#])/gu, '\\$1');
}
export function citationMarkdownUrl(value: string): string {
  return value.replace(/[()<>\s\\]/gu, (character) => character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character));
}
