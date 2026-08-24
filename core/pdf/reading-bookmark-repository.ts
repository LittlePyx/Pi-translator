import { pdfReadingStateId } from './reading-state';

const PDF_READING_BOOKMARKS_KEY = 'piPdfReadingBookmarksV1';
export const MAX_PDF_BOOKMARK_DOCUMENTS = 30;
export const MAX_PDF_BOOKMARKS_PER_DOCUMENT = 50;
export const MAX_PDF_BOOKMARK_LABEL_LENGTH = 60;
export const MAX_PDF_BOOKMARK_NOTE_LENGTH = 240;

export interface PdfReadingBookmark {
  id: string;
  pageNumber: number;
  label: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface PdfReadingBookmarkState {
  bookmarks: PdfReadingBookmark[];
  updatedAt: number;
}

type PdfReadingBookmarkStateMap = Record<string, PdfReadingBookmarkState>;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizedLabel(value: unknown, pageNumber: number): string {
  if (typeof value !== 'string') return `第 ${pageNumber} 页`;
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_PDF_BOOKMARK_LABEL_LENGTH) || `第 ${pageNumber} 页`;
}

function normalizedNote(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .trim()
    .slice(0, MAX_PDF_BOOKMARK_NOTE_LENGTH);
}

export function normalizePdfReadingBookmark(
  value: unknown,
): PdfReadingBookmark | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const bookmark = value as Partial<PdfReadingBookmark>;
  if (
    typeof bookmark.id !== 'string' ||
    !bookmark.id.trim() ||
    !finiteNumber(bookmark.pageNumber)
  ) return undefined;
  const pageNumber = Math.max(1, Math.round(bookmark.pageNumber));
  const createdAt = finiteNumber(bookmark.createdAt) ? bookmark.createdAt : Date.now();
  return {
    id: bookmark.id.trim().slice(0, 120),
    pageNumber,
    label: normalizedLabel(bookmark.label, pageNumber),
    note: normalizedNote(bookmark.note),
    createdAt,
    updatedAt: finiteNumber(bookmark.updatedAt) ? bookmark.updatedAt : createdAt,
  };
}

export function normalizePdfReadingBookmarkState(
  value: unknown,
): PdfReadingBookmarkState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as Partial<PdfReadingBookmarkState>;
  const candidates = Array.isArray(state.bookmarks)
    ? state.bookmarks
      .map(normalizePdfReadingBookmark)
      .filter((bookmark): bookmark is PdfReadingBookmark => Boolean(bookmark))
    : [];
  const byPage = new Map<number, PdfReadingBookmark>();
  for (const bookmark of candidates) {
    const current = byPage.get(bookmark.pageNumber);
    if (!current || bookmark.updatedAt >= current.updatedAt) {
      byPage.set(bookmark.pageNumber, bookmark);
    }
  }
  const bookmarks = [...byPage.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_PDF_BOOKMARKS_PER_DOCUMENT)
    .sort((left, right) => left.pageNumber - right.pageNumber || left.createdAt - right.createdAt);
  return {
    bookmarks,
    updatedAt: finiteNumber(state.updatedAt) ? state.updatedAt : Date.now(),
  };
}

function stateMap(value: unknown): PdfReadingBookmarkStateMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, candidate]) => {
      const state = normalizePdfReadingBookmarkState(candidate);
      return state ? [[id, state]] : [];
    }),
  );
}

export function retainPdfReadingBookmarkStates(
  states: PdfReadingBookmarkStateMap,
): PdfReadingBookmarkStateMap {
  return Object.fromEntries(
    Object.entries(states)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_PDF_BOOKMARK_DOCUMENTS),
  );
}

export async function getPdfReadingBookmarkState(
  identity: string,
): Promise<PdfReadingBookmarkState> {
  const [id, stored] = await Promise.all([
    pdfReadingStateId(identity),
    browser.storage.local.get(PDF_READING_BOOKMARKS_KEY),
  ]);
  return stateMap(stored[PDF_READING_BOOKMARKS_KEY])[id] ?? {
    bookmarks: [],
    updatedAt: 0,
  };
}

export async function savePdfReadingBookmarks(
  identity: string,
  bookmarks: PdfReadingBookmark[],
): Promise<PdfReadingBookmarkState> {
  const [id, stored] = await Promise.all([
    pdfReadingStateId(identity),
    browser.storage.local.get(PDF_READING_BOOKMARKS_KEY),
  ]);
  const states = stateMap(stored[PDF_READING_BOOKMARKS_KEY]);
  const next = normalizePdfReadingBookmarkState({ bookmarks, updatedAt: Date.now() })!;
  states[id] = next;
  await browser.storage.local.set({
    [PDF_READING_BOOKMARKS_KEY]: retainPdfReadingBookmarkStates(states),
  });
  return next;
}
