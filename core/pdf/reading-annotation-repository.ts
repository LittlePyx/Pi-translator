import {normalizeExcerptCitation, type ExcerptCitation} from '../content/excerpt-citation';
import type {PersistedPdfTranslationMarkerAnchor} from '../content/session-translation-markers';
import {withDocumentStorageLock} from '../translation/document-storage-lock';
import {pdfReadingStateId} from './reading-state';

export const PDF_READING_ANNOTATIONS_KEY = 'piPdfReadingAnnotationsV1';
export type PdfReadingAnnotationAnchor = Extract<PersistedPdfTranslationMarkerAnchor, {kind: 'text-quote'}>;
export interface PdfReadingAnnotation extends ExcerptCitation {
  id: string;
  kind: 'highlight';
  anchor: PdfReadingAnnotationAnchor;
  continuations?: PdfReadingAnnotationAnchor[];
  createdAt: number;
  updatedAt: number;
}
export interface PdfReadingAnnotationState { annotations: PdfReadingAnnotation[]; updatedAt: number }
export type PdfReadingAnnotationMap = Record<string, PdfReadingAnnotationState>;
const invalid = () => new Error('PDF 阅读批注格式无效，原记录未改变。');
function bounded(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && value.length <= max && (empty || Boolean(value.trim()));
}
export function pdfReadingAnnotationAnchors(item:PdfReadingAnnotation):PdfReadingAnnotationAnchor[]{return [item.anchor,...(item.continuations??[])]}
export function pdfReadingAnnotationText(item:PdfReadingAnnotation):string{return pdfReadingAnnotationAnchors(item).map(a=>a.sourceText).join('\n\n')}
export function pdfReadingAnnotationEndPage(item:PdfReadingAnnotation):number{return item.continuations?.at(-1)?.pageNumber??item.anchor.pageNumber}
function normalizeAnchor(a:PdfReadingAnnotationAnchor):PdfReadingAnnotationAnchor{
  if(!a||a.kind!=='text-quote'||!Number.isSafeInteger(a.pageNumber)||a.pageNumber<1||
    !bounded(a.sourceText,4000)||!bounded(a.prefix,96,true)||!bounded(a.suffix,96,true))throw invalid();
  return {kind:'text-quote',pageNumber:a.pageNumber,sourceText:a.sourceText,prefix:a.prefix,suffix:a.suffix};
}
export function normalizePdfReadingAnnotation(value: unknown): PdfReadingAnnotation {
  if (!value || typeof value !== 'object') throw invalid();
  const item = value as PdfReadingAnnotation, a = item.anchor;
  if (item.kind !== 'highlight' || !bounded(item.id, 80) || !a || a.kind !== 'text-quote' ||
      !Number.isSafeInteger(a.pageNumber) || a.pageNumber < 1 ||
      !bounded(a.sourceText, 4000) || !bounded(a.prefix, 96, true) || !bounded(a.suffix, 96, true) ||
      !Number.isFinite(item.createdAt) || item.createdAt < 0 ||
      !Number.isFinite(item.updatedAt) || item.updatedAt < item.createdAt) throw invalid();
  const citation = normalizeExcerptCitation(item);
  const anchor=normalizeAnchor(a);
  let continuations:PdfReadingAnnotationAnchor[]|undefined;
  if(item.continuations!==undefined){
    if(!Array.isArray(item.continuations)||!item.continuations.length||item.continuations.length>15)throw invalid();
    continuations=item.continuations.map(normalizeAnchor);
    if(continuations.some((part,index)=>part.pageNumber!==anchor.pageNumber+index+1)||
      [anchor,...continuations].map(a=>a.sourceText).join('\n\n').length>4000)throw invalid();
  }
  return {id:item.id,kind:'highlight',anchor,...(continuations?{continuations}:{}),...citation,createdAt:item.createdAt,updatedAt:item.updatedAt};
}
/** Strict validation: no eviction, truncation, or silently discarded annotations. */
export function validatePdfReadingAnnotationMap(value: unknown): PdfReadingAnnotationMap {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const entries = Object.entries(value);
  if (entries.length > 30) throw new Error('阅读批注最多保存 30 份 PDF，请先备份并清理。');
  const result: PdfReadingAnnotationMap = {};
  for (const [id, raw] of entries) {
    const state = raw as PdfReadingAnnotationState;
    if (!/^[a-f0-9]{32}$/u.test(id) || !state || !Array.isArray(state.annotations) ||
        !Number.isFinite(state.updatedAt) || state.updatedAt < 0) throw invalid();
    if (state.annotations.length > 100) throw new Error('每份 PDF 最多保存 100 条阅读批注。');
    const annotations = state.annotations.map(normalizePdfReadingAnnotation);
    if (new Set(annotations.map(a => a.id)).size !== annotations.length) throw invalid();
    result[id] = {annotations,updatedAt:state.updatedAt};
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 4_000_000)
    throw new Error('阅读批注超过 4 MB，请先备份并清理。原记录未改变。');
  return result;
}
export function mergePdfReadingAnnotationMaps(local: unknown, incoming: unknown): PdfReadingAnnotationMap {
  const result = validatePdfReadingAnnotationMap(local);
  for (const [id, state] of Object.entries(validatePdfReadingAnnotationMap(incoming))) {
    const current = result[id];
    if (!current) { result[id] = state; continue; }
    const records = new Map(current.annotations.map(a => [a.id,a]));
    for (const item of state.annotations) {
      const old = records.get(item.id);
      if (old && JSON.stringify(old) !== JSON.stringify(item))
        throw new Error('备份与本机的同一条阅读批注存在冲突，请先分别导出笔记核对。原记录未改变。');
      records.set(item.id,item);
    }
    result[id] = {annotations:[...records.values()],updatedAt:Math.max(current.updatedAt,state.updatedAt)};
  }
  return validatePdfReadingAnnotationMap(result);
}
export async function listPdfReadingAnnotationMap(): Promise<PdfReadingAnnotationMap> {
  return validatePdfReadingAnnotationMap((await browser.storage.local.get(PDF_READING_ANNOTATIONS_KEY))[PDF_READING_ANNOTATIONS_KEY]);
}
export async function getPdfReadingAnnotations(identity: string): Promise<PdfReadingAnnotation[]> {
  return (await listPdfReadingAnnotationMap())[await pdfReadingStateId(identity)]?.annotations ?? [];
}
/** Only the edited record is replaced; sibling edits from other windows survive. */
export async function mutatePdfReadingAnnotation(documentId: string, next: PdfReadingAnnotation | undefined, expected?: PdfReadingAnnotation): Promise<void> {
  await withDocumentStorageLock(async () => {
    if (!/^[a-f0-9]{32}$/u.test(documentId)) throw invalid();
    const map = await listPdfReadingAnnotationMap(), state = map[documentId];
    const normalized = next ? normalizePdfReadingAnnotation(next) : undefined;
    const id = expected?.id ?? normalized?.id;
    if (!id || (normalized && normalized.id !== id)) throw invalid();
    if (normalized && expected && (normalized.createdAt !== expected.createdAt ||
        JSON.stringify(pdfReadingAnnotationAnchors(normalized)) !== JSON.stringify(pdfReadingAnnotationAnchors(expected)))) throw invalid();
    const old = state?.annotations.find(a => a.id === id);
    if (expected ? !old || JSON.stringify(old) !== JSON.stringify(normalizePdfReadingAnnotation(expected)) : Boolean(old))
      throw new Error('这条阅读批注已在其他窗口修改或删除。编辑内容仍保留，请先复制笔记再重新打开。');
    const annotations = (state?.annotations ?? []).filter(a => a.id !== id);
    if (normalized) annotations.push(normalized);
    const updatedAt = Math.max(Date.now(),(state?.updatedAt ?? 0)+1);
    if (annotations.length) map[documentId] = {annotations,updatedAt};
    else delete map[documentId];
    validatePdfReadingAnnotationMap(map);
    await browser.storage.local.set({[PDF_READING_ANNOTATIONS_KEY]:map});
  });
}
