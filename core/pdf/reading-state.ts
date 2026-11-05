import {withDocumentStorageLock} from '../translation/document-storage-lock';
import {RECENT_PDF_DOCUMENTS_KEY,updatedRecentPdfDocuments,type RecentPdfDocument} from './recent-documents';
import {RECENT_PDF_OVERRIDES_KEY,recentPdfOverrides} from './recent-reading-overrides';
export const PDF_READING_STATES_KEY = 'piPdfReadingStatesV1';
const MAX_PDF_READING_STATES = 30;

export interface PdfReadingState {
  pageNumber: number;
  pageRatio: number;
  zoomLevel: number;
  fitWidth: boolean;
  sidebarExpanded: boolean;
  updatedAt: number;
  translation?: PdfTranslationReadingAnchor;
  rotation?: 90 | 180 | 270;
  fitPage?: true;
}

export interface PdfTranslationReadingAnchor {
  mode: 'reading' | 'compare';
  signature?: string;
  pageNumber: number;
  offsetRatio: number;
}

export function normalizePdfTranslationReadingAnchor(value: unknown): PdfTranslationReadingAnchor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const anchor = value as Partial<PdfTranslationReadingAnchor>;
  if (!['reading', 'compare'].includes(anchor.mode ?? '') || !Number.isFinite(anchor.pageNumber) ||
      !Number.isFinite(anchor.offsetRatio)) return undefined;
  return {mode: anchor.mode!, pageNumber: Math.max(1, Math.round(anchor.pageNumber!)),
    offsetRatio: Math.max(0, Math.min(1, anchor.offsetRatio!)),
    ...(typeof anchor.signature === 'string' && /^block-[a-z0-9]+$/u.test(anchor.signature) ? {signature: anchor.signature} : {})};
}

type PdfReadingStateMap = Record<string, PdfReadingState>;

export function normalizePdfReadingState(value: unknown): PdfReadingState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as Partial<PdfReadingState>;
  if (
    typeof state.pageNumber !== 'number' ||
    !Number.isFinite(state.pageNumber) ||
    typeof state.pageRatio !== 'number' ||
    !Number.isFinite(state.pageRatio) ||
    typeof state.zoomLevel !== 'number' ||
    !Number.isFinite(state.zoomLevel)
  ) return undefined;
  const translation=normalizePdfTranslationReadingAnchor(state.translation);
  return {
    pageNumber: Math.max(1, Math.round(state.pageNumber)),
    pageRatio: Math.min(1, Math.max(0, state.pageRatio)),
    zoomLevel: Math.min(3, Math.max(state.fitWidth === true || state.fitPage === true ? 0.1 : 0.5, state.zoomLevel)),
    fitWidth: state.fitWidth === true,
    sidebarExpanded: state.sidebarExpanded === true,
    updatedAt:
      typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt)
        ? state.updatedAt
        : Date.now(),
    ...(translation ? {translation} : {}),
    ...([90,180,270].includes(state.rotation ?? 0) ? {rotation:state.rotation!} : {}),
    ...(state.fitPage === true && state.fitWidth !== true ? {fitPage:true as const} : {}),
  };
}

export async function pdfReadingStateId(identity: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stateMap(value: unknown): PdfReadingStateMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, candidate]) => {
      const normalized = normalizePdfReadingState(candidate);
      return normalized ? [[key, normalized]] : [];
    }),
  );
}

export async function getPdfReadingState(
  identity: string,
): Promise<PdfReadingState | undefined> {
  const [id, stored] = await Promise.all([
    pdfReadingStateId(identity),
    browser.storage.local.get(PDF_READING_STATES_KEY),
  ]);
  return stateMap(stored[PDF_READING_STATES_KEY])[id];
}

let readingWriteTail: Promise<unknown> = Promise.resolve();
export function savePdfReadingState(
  identity: string,
  state: PdfReadingState,
  document?:Omit<RecentPdfDocument,'updatedAt'>,
  opened=false,
): Promise<void> {
  const write = async () => {
  const [id, stored] = await Promise.all([
    pdfReadingStateId(identity),
    browser.storage.local.get(document?[PDF_READING_STATES_KEY,RECENT_PDF_DOCUMENTS_KEY,...(opened?[RECENT_PDF_OVERRIDES_KEY]:[])]:PDF_READING_STATES_KEY),
  ]);
  const states = stateMap(stored[PDF_READING_STATES_KEY]);
  const next = normalizePdfReadingState(state);
  if (!next || (states[id]?.updatedAt ?? 0) > next.updatedAt) return;
  states[id] = next;
  const retained = Object.fromEntries(
    Object.entries(states)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_PDF_READING_STATES),
  );
  const recent=document?updatedRecentPdfDocuments(stored[RECENT_PDF_DOCUMENTS_KEY],id,{...document,updatedAt:next.updatedAt}):undefined;
  const overrides=document&&opened?recentPdfOverrides(stored[RECENT_PDF_OVERRIDES_KEY]):undefined;
  const removed=overrides?.[id];
  if(overrides&&removed?.hidden)overrides[id]={...removed,hidden:false,updatedAt:Math.max(Date.now(),removed.updatedAt+1)};
  await browser.storage.local.set({ [PDF_READING_STATES_KEY]: retained,...(recent?{[RECENT_PDF_DOCUMENTS_KEY]:recent}:{}),...(removed?.hidden?{[RECENT_PDF_OVERRIDES_KEY]:overrides}:{}) });
  };
  const run = readingWriteTail.catch(() => undefined).then(()=>withDocumentStorageLock(write));
  readingWriteTail = run;
  return run;
}
