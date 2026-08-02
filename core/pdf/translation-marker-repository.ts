import type {
  PersistedPdfTranslationMarker,
  PersistedPdfTranslationMarkerAnchor,
  TranslationMarkerContent,
} from '../content/session-translation-markers';
import {
  persistedPdfMarkerKey,
} from '../content/session-translation-markers';
import { pdfReadingStateId } from './reading-state';

const PDF_TRANSLATION_MARKERS_KEY = 'piPdfTranslationMarkersV1';
const MAX_MARKER_DOCUMENTS = 30;
const MAX_MARKERS_PER_DOCUMENT = 100;
const MAX_MARKER_TEXT_LENGTH = 4_000;
const MAX_MARKER_STORAGE_BYTES = 4_000_000;

export interface PdfTranslationMarkerState {
  enabled: boolean;
  markers: PersistedPdfTranslationMarker[];
  updatedAt: number;
}

type PdfTranslationMarkerStateMap = Record<string, PdfTranslationMarkerState>;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.slice(0, MAX_MARKER_TEXT_LENGTH);
  return text.trim() ? text : undefined;
}

function normalizedRatio(value: unknown): number | undefined {
  return finiteNumber(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function normalizeAnchor(value: unknown): PersistedPdfTranslationMarkerAnchor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const anchor = value as Partial<PersistedPdfTranslationMarkerAnchor>;
  const pageNumber = finiteNumber(anchor.pageNumber)
    ? Math.max(1, Math.round(anchor.pageNumber))
    : undefined;
  if (!pageNumber) return undefined;
  if (anchor.kind === 'text-quote') {
    const sourceText = boundedText(anchor.sourceText);
    if (!sourceText) return undefined;
    return {
      kind: 'text-quote',
      pageNumber,
      sourceText,
      prefix: typeof anchor.prefix === 'string' ? anchor.prefix.slice(-96) : '',
      suffix: typeof anchor.suffix === 'string' ? anchor.suffix.slice(0, 96) : '',
    };
  }
  if (anchor.kind !== 'region') return undefined;
  const leftRatio = normalizedRatio(anchor.leftRatio);
  const topRatio = normalizedRatio(anchor.topRatio);
  const widthRatio = normalizedRatio(anchor.widthRatio);
  const heightRatio = normalizedRatio(anchor.heightRatio);
  if (
    leftRatio === undefined ||
    topRatio === undefined ||
    widthRatio === undefined ||
    heightRatio === undefined ||
    widthRatio <= 0 ||
    heightRatio <= 0
  ) return undefined;
  const boundedWidth = Math.min(widthRatio, 1 - leftRatio);
  const boundedHeight = Math.min(heightRatio, 1 - topRatio);
  if (boundedWidth <= 0 || boundedHeight <= 0) return undefined;
  return {
    kind: 'region',
    pageNumber,
    leftRatio,
    topRatio,
    widthRatio: boundedWidth,
    heightRatio: boundedHeight,
  };
}

function normalizeContent(value: unknown): TranslationMarkerContent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const content = value as Partial<TranslationMarkerContent>;
  const originalText = boundedText(content.originalText);
  const translatedText = boundedText(content.translatedText);
  const sourceTitle = boundedText(content.sourceTitle);
  if (!originalText || !translatedText || !sourceTitle) return undefined;
  const pageNumber = finiteNumber(content.pageNumber)
    ? Math.max(1, Math.round(content.pageNumber))
    : undefined;
  return {
    originalText,
    translatedText,
    sourceTitle: sourceTitle.slice(0, 500),
    ...(typeof content.sourceUrl === 'string' && /^https?:/iu.test(content.sourceUrl)
      ? { sourceUrl: content.sourceUrl.slice(0, 4_000) }
      : {}),
    ...(pageNumber ? { pageNumber } : {}),
  };
}

export function normalizePersistedPdfTranslationMarker(
  value: unknown,
): PersistedPdfTranslationMarker | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const marker = value as Partial<PersistedPdfTranslationMarker>;
  const anchor = normalizeAnchor(marker.anchor);
  const content = normalizeContent(marker.content);
  if (typeof marker.markerId !== 'string' || !marker.markerId.trim() || !anchor || !content) {
    return undefined;
  }
  return {
    markerId: marker.markerId.slice(0, 200),
    anchor,
    content,
    createdAt: finiteNumber(marker.createdAt) ? marker.createdAt : Date.now(),
  };
}

export function normalizePdfTranslationMarkerState(
  value: unknown,
): PdfTranslationMarkerState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as Partial<PdfTranslationMarkerState>;
  const candidates = Array.isArray(state.markers)
    ? state.markers.map(normalizePersistedPdfTranslationMarker).filter(Boolean)
    : [];
  const unique = new Map<string, PersistedPdfTranslationMarker>();
  for (const marker of candidates as PersistedPdfTranslationMarker[]) {
    const key = persistedPdfMarkerKey(marker.anchor, marker.content);
    const existing = unique.get(key);
    if (!existing || marker.createdAt > existing.createdAt) unique.set(key, marker);
  }
  const markers = [...unique.values()]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_MARKERS_PER_DOCUMENT)
    .sort((left, right) => (
      left.anchor.pageNumber - right.anchor.pageNumber || left.createdAt - right.createdAt
    ));
  return {
    enabled: state.enabled === true,
    markers,
    updatedAt: finiteNumber(state.updatedAt) ? state.updatedAt : Date.now(),
  };
}

function stateMap(value: unknown): PdfTranslationMarkerStateMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, candidate]) => {
      const state = normalizePdfTranslationMarkerState(candidate);
      return state ? [[id, state]] : [];
    }),
  );
}

function retainedStateMap(states: PdfTranslationMarkerStateMap): PdfTranslationMarkerStateMap {
  const retained: PdfTranslationMarkerStateMap = {};
  let retainedBytes = 2;
  for (const [id, state] of Object.entries(states)
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, MAX_MARKER_DOCUMENTS)) {
    const serializedBytes = new TextEncoder().encode(JSON.stringify({ [id]: state })).byteLength;
    if (Object.keys(retained).length > 0 && retainedBytes + serializedBytes > MAX_MARKER_STORAGE_BYTES) {
      continue;
    }
    retained[id] = state;
    retainedBytes += serializedBytes;
  }
  return retained;
}

async function updateDocumentState(
  identity: string,
  update: (current: PdfTranslationMarkerState) => PdfTranslationMarkerState,
): Promise<PdfTranslationMarkerState> {
  const [id, stored] = await Promise.all([
    pdfReadingStateId(identity),
    browser.storage.local.get(PDF_TRANSLATION_MARKERS_KEY),
  ]);
  const states = stateMap(stored[PDF_TRANSLATION_MARKERS_KEY]);
  const current = states[id] ?? { enabled: false, markers: [], updatedAt: Date.now() };
  const next = normalizePdfTranslationMarkerState(update(current))!;
  states[id] = next;
  const retained = retainedStateMap(states);
  await browser.storage.local.set({ [PDF_TRANSLATION_MARKERS_KEY]: retained });
  return next;
}

export async function getPdfTranslationMarkerState(
  identity: string,
): Promise<PdfTranslationMarkerState> {
  const [id, stored] = await Promise.all([
    pdfReadingStateId(identity),
    browser.storage.local.get(PDF_TRANSLATION_MARKERS_KEY),
  ]);
  return stateMap(stored[PDF_TRANSLATION_MARKERS_KEY])[id] ?? {
    enabled: false,
    markers: [],
    updatedAt: 0,
  };
}

export async function setPdfTranslationMarkerPersistence(
  identity: string,
  enabled: boolean,
): Promise<PdfTranslationMarkerState> {
  return updateDocumentState(identity, (current) => ({
    ...current,
    enabled,
    updatedAt: Date.now(),
  }));
}

export async function savePdfTranslationMarkers(
  identity: string,
  markers: PersistedPdfTranslationMarker[],
): Promise<PdfTranslationMarkerState> {
  return updateDocumentState(identity, (current) => ({
    ...current,
    markers,
    updatedAt: Date.now(),
  }));
}

export async function clearPdfTranslationMarkers(
  identity: string,
): Promise<PdfTranslationMarkerState> {
  return updateDocumentState(identity, (current) => ({
    ...current,
    markers: [],
    updatedAt: Date.now(),
  }));
}
