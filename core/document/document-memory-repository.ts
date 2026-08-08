import type {
  GlossaryEntry,
  PdfSourceLocation,
  TranslateResult,
  TranslationCorrectionTermReceipt,
  TranslationStyle,
} from '../translation/types';
import type { DocumentIdentity } from './document-identity';
import { normalizeGlossaryTermKey } from '../translation/glossary';

const STORAGE_KEY = 'documentTranslationMemoryV1';
const SCHEMA_VERSION = 1;
const MAX_DOCUMENTS = 40;
const MAX_TRANSLATIONS = 20;
const MAX_CONFIRMED_TERMS = 100;
const MAX_CANDIDATE_TERMS = 20;
const MAX_DISMISSED_TERMS = 60;
const MAX_ENTRY_TEXT = 2_400;
const MAX_REFERENCE_CONTEXT = 1_600;

export class DocumentTermCapacityError extends Error {
  constructor() {
    super(`A document can keep at most ${MAX_CONFIRMED_TERMS} confirmed terms.`);
    this.name = 'DocumentTermCapacityError';
  }
}

export interface DocumentConfirmedTerm extends GlossaryEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentTermCandidate extends GlossaryEntry {
  id: string;
  createdAt: number;
}

export interface DocumentTranslationReview {
  /** Stable per-region identifier; revisions of the same box replace this item. */
  id: string;
  formulaNeedsReview: boolean;
  uncertainSpans: string[];
  updatedAt: number;
  reviewedAt?: number;
}

export interface DocumentMemoryTranslation {
  id: string;
  requestId: string;
  /** Stable lineage for replacing an earlier OCR/translation revision. */
  rootRequestId?: string;
  originalText: string;
  translatedText: string;
  completedAt: number;
  targetLanguage?: string;
  style?: TranslationStyle;
  sourceKind?: TranslateResult['sourceKind'];
  sourceLocation?: PdfSourceLocation;
  review?: DocumentTranslationReview;
}

export interface DocumentMemorySnapshot {
  documentId: string;
  label: string;
  updatedAt: number;
  confirmedTerms: DocumentConfirmedTerm[];
  candidateTerms: DocumentTermCandidate[];
  recentTranslations: DocumentMemoryTranslation[];
}

interface StoredDocumentMemory extends DocumentMemorySnapshot {
  schemaVersion: 1;
  dismissedTermKeys: string[];
}

type StoredDocumentMemories = Record<string, StoredDocumentMemory>;

let writeQueue: Promise<void> = Promise.resolve();
let lastUpdatedAt = 0;

function compactText(value: string, maximum = MAX_ENTRY_TEXT): string {
  const text = value.trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function normalizedTerm(value: string): string {
  return normalizeGlossaryTermKey(value);
}

function termKey(source: string, target: string): string {
  return `${normalizedTerm(source)}\u0000${normalizedTerm(target)}`;
}

function stableId(prefix: string, value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function sourceLocationKey(location: PdfSourceLocation): string {
  return [
    location.pageNumber,
    location.leftRatio.toFixed(5),
    location.topRatio.toFixed(5),
    location.widthRatio.toFixed(5),
    location.heightRatio.toFixed(5),
  ].join(':');
}

function sameImageRegion(
  left: DocumentMemoryTranslation,
  right: DocumentMemoryTranslation,
): boolean {
  return Boolean(
    left.sourceKind === 'image-region' &&
    right.sourceKind === 'image-region' &&
    left.sourceLocation &&
    right.sourceLocation &&
    sourceLocationKey(left.sourceLocation) === sourceLocationKey(right.sourceLocation),
  );
}

function sameTranslationSubject(
  previous: DocumentMemoryTranslation,
  next: DocumentMemoryTranslation,
): boolean {
  const nextRoot = next.rootRequestId ?? next.requestId;
  const previousRoot = previous.rootRequestId ?? previous.requestId;
  if (
    previous.requestId === nextRoot ||
    previousRoot === nextRoot ||
    previousRoot === next.requestId
  ) return true;
  if (sameImageRegion(previous, next)) return true;
  if (previous.sourceKind === 'image-region' || next.sourceKind === 'image-region') return false;
  return normalizedTerm(previous.originalText) === normalizedTerm(next.originalText);
}

function compactUncertainSpans(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = compactText(value, 180);
    const key = normalizedTerm(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= 6) break;
  }
  return output;
}

function reviewForResult(
  result: TranslateResult,
  updatedAt: number,
): DocumentTranslationReview | undefined {
  if (result.sourceKind !== 'image-region' || !result.sourceLocation) return undefined;
  const formulaNeedsReview = Boolean(result.formulaNeedsReview);
  const uncertainSpans = compactUncertainSpans(result.uncertainSpans ?? []);
  if (!formulaNeedsReview && !uncertainSpans.length) return undefined;
  return {
    id: stableId('review', sourceLocationKey(result.sourceLocation)),
    formulaNeedsReview,
    uncertainSpans,
    updatedAt,
  };
}

function sameReviewEvidence(
  previous: DocumentMemoryTranslation | undefined,
  originalText: string,
  translatedText: string,
  review: DocumentTranslationReview,
): boolean {
  const earlier = previous?.review;
  if (!previous || !earlier) return false;
  return (
    normalizedTerm(previous.originalText) === normalizedTerm(originalText) &&
    normalizedTerm(previous.translatedText) === normalizedTerm(translatedText) &&
    earlier.formulaNeedsReview === review.formulaNeedsReview &&
    earlier.uncertainSpans.length === review.uncertainSpans.length &&
    earlier.uncertainSpans.every((span, index) => (
      normalizedTerm(span) === normalizedTerm(review.uncertainSpans[index] ?? '')
    ))
  );
}

function sanitizeReview(value: unknown): DocumentTranslationReview | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const review = value as Partial<DocumentTranslationReview>;
  if (typeof review.id !== 'string' || !review.id.trim()) return undefined;
  const formulaNeedsReview = review.formulaNeedsReview === true;
  const uncertainSpans = Array.isArray(review.uncertainSpans)
    ? compactUncertainSpans(review.uncertainSpans.filter(
        (span): span is string => typeof span === 'string',
      ))
    : [];
  if (!formulaNeedsReview && !uncertainSpans.length) return undefined;
  return {
    id: compactText(review.id, 80),
    formulaNeedsReview,
    uncertainSpans,
    updatedAt: typeof review.updatedAt === 'number' ? review.updatedAt : 0,
    ...(typeof review.reviewedAt === 'number' && Number.isFinite(review.reviewedAt)
      ? { reviewedAt: review.reviewedAt }
      : {}),
  };
}

function retainRecentTranslations(
  entries: DocumentMemoryTranslation[],
): DocumentMemoryTranslation[] {
  const pending = entries.filter((entry) => entry.review && !entry.review.reviewedAt).slice(0, 12);
  const others = entries.filter((entry) => !entry.review || Boolean(entry.review.reviewedAt));
  return [...pending, ...others.slice(0, MAX_TRANSLATIONS - pending.length)]
    .sort((left, right) => right.completedAt - left.completedAt)
    .slice(0, MAX_TRANSLATIONS);
}

function emptyMemory(identity: DocumentIdentity): StoredDocumentMemory {
  return {
    schemaVersion: SCHEMA_VERSION,
    documentId: identity.documentId,
    label: identity.label,
    updatedAt: 0,
    confirmedTerms: [],
    candidateTerms: [],
    recentTranslations: [],
    dismissedTermKeys: [],
  };
}

function sanitizeTerm(source: string, target: string): GlossaryEntry | undefined {
  const cleanSource = compactText(source, 120);
  const cleanTarget = compactText(target, 120);
  if (!cleanSource || !cleanTarget || normalizedTerm(cleanSource) === normalizedTerm(cleanTarget)) {
    return undefined;
  }
  return { source: cleanSource, target: cleanTarget };
}

function sanitizeConfirmedTerm(source: string, target: string): GlossaryEntry | undefined {
  const cleanSource = compactText(source, 120);
  const cleanTarget = compactText(target, 120);
  if (!cleanSource || !cleanTarget) return undefined;
  return { source: cleanSource, target: cleanTarget };
}

function sanitizeMemory(value: unknown, identity: DocumentIdentity): StoredDocumentMemory {
  if (!value || typeof value !== 'object') return emptyMemory(identity);
  const record = value as Partial<StoredDocumentMemory>;
  if (record.schemaVersion !== SCHEMA_VERSION || record.documentId !== identity.documentId) {
    return emptyMemory(identity);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    documentId: identity.documentId,
    label: typeof record.label === 'string' ? compactText(record.label, 160) : identity.label,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    confirmedTerms: Array.isArray(record.confirmedTerms)
      ? record.confirmedTerms.slice(0, MAX_CONFIRMED_TERMS)
      : [],
    candidateTerms: Array.isArray(record.candidateTerms)
      ? record.candidateTerms.slice(0, MAX_CANDIDATE_TERMS)
      : [],
    recentTranslations: Array.isArray(record.recentTranslations)
      ? record.recentTranslations.slice(0, MAX_TRANSLATIONS).map((entry) => {
          const review = sanitizeReview(entry.review);
          const { review: _review, ...translation } = entry;
          return review ? { ...translation, review } : translation;
        })
      : [],
    dismissedTermKeys: Array.isArray(record.dismissedTermKeys)
      ? record.dismissedTermKeys.filter((item): item is string => typeof item === 'string').slice(0, MAX_DISMISSED_TERMS)
      : [],
  };
}

async function readAll(): Promise<StoredDocumentMemories> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return value && typeof value === 'object' ? value as StoredDocumentMemories : {};
}

function publicSnapshot(memory: StoredDocumentMemory): DocumentMemorySnapshot {
  const { dismissedTermKeys: _dismissed, schemaVersion: _version, ...snapshot } = memory;
  return snapshot;
}

async function mutateWithValue<T>(
  identity: DocumentIdentity,
  updater: (memory: StoredDocumentMemory) => { memory: StoredDocumentMemory; value: T },
): Promise<{ snapshot: DocumentMemorySnapshot; value: T }> {
  let snapshot = publicSnapshot(emptyMemory(identity));
  let value: T | undefined;
  const operation = writeQueue.then(async () => {
    const all = await readAll();
    const current = sanitizeMemory(all[identity.documentId], identity);
    const update = updater(current);
    const proposed = update.memory;
    value = update.value;
    const newestStoredTimestamp = Object.values(all).reduce(
      (latest, memory) => Math.max(latest, memory.updatedAt || 0),
      0,
    );
    const next = proposed === current
      ? current
      : {
        ...proposed,
        updatedAt: Math.max(
          proposed.updatedAt,
          Date.now(),
          newestStoredTimestamp + 1,
          lastUpdatedAt + 1,
        ),
      };
    lastUpdatedAt = Math.max(lastUpdatedAt, next.updatedAt);
    const ordered = Object.values({ ...all, [identity.documentId]: next })
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_DOCUMENTS);
    const compacted = Object.fromEntries(ordered.map((memory) => [memory.documentId, memory]));
    await browser.storage.local.set({ [STORAGE_KEY]: compacted });
    snapshot = publicSnapshot(next);
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
  return { snapshot, value: value as T };
}

async function mutate(
  identity: DocumentIdentity,
  updater: (memory: StoredDocumentMemory) => StoredDocumentMemory,
): Promise<DocumentMemorySnapshot> {
  const { snapshot } = await mutateWithValue(identity, (memory) => ({
    memory: updater(memory),
    value: undefined,
  }));
  return snapshot;
}

export async function getDocumentMemory(
  identity: DocumentIdentity,
): Promise<DocumentMemorySnapshot> {
  await writeQueue;
  const all = await readAll();
  return publicSnapshot(sanitizeMemory(all[identity.documentId], identity));
}

function withRememberedDocumentTranslation(
  memory: StoredDocumentMemory,
  identity: DocumentIdentity,
  result: TranslateResult,
): StoredDocumentMemory {
    const now = Date.now();
    const baseEntry: DocumentMemoryTranslation = {
      id: stableId('translation', `${result.requestId}:${result.originalText}`),
      requestId: result.requestId,
      rootRequestId: result.revision?.rootRequestId ?? result.requestId,
      originalText: compactText(result.originalText),
      translatedText: compactText(result.translatedText),
      completedAt: result.completedAt ?? now,
      ...(result.targetLanguage ? { targetLanguage: result.targetLanguage } : {}),
      ...(result.style ? { style: result.style } : {}),
      ...(result.sourceKind ? { sourceKind: result.sourceKind } : {}),
      ...(result.sourceLocation ? { sourceLocation: result.sourceLocation } : {}),
    };
    const previous = memory.recentTranslations.find((candidate) => (
      sameTranslationSubject(candidate, baseEntry)
    ));
    const proposedReview = reviewForResult(result, now);
    const review = proposedReview && sameReviewEvidence(
      previous,
      baseEntry.originalText,
      baseEntry.translatedText,
      proposedReview,
    ) && previous?.review?.reviewedAt
      ? { ...proposedReview, reviewedAt: previous.review.reviewedAt }
      : proposedReview;
    const entry: DocumentMemoryTranslation = review
      ? { ...baseEntry, review }
      : baseEntry;
    const candidateKeys = new Set(memory.candidateTerms.map((term) => termKey(term.source, term.target)));
    const confirmedSources = new Set(memory.confirmedTerms.map((term) => normalizedTerm(term.source)));
    const dismissed = new Set(memory.dismissedTermKeys);
    const candidates = [...memory.candidateTerms];
    for (const candidate of result.termCandidates ?? []) {
      const clean = sanitizeTerm(candidate.source, candidate.target);
      if (!clean) continue;
      const key = termKey(clean.source, clean.target);
      if (confirmedSources.has(normalizedTerm(clean.source)) || dismissed.has(key) || candidateKeys.has(key)) {
        continue;
      }
      candidates.unshift({ ...clean, id: stableId('candidate', key), createdAt: now });
      candidateKeys.add(key);
    }
    return {
      ...memory,
      label: identity.label,
      updatedAt: now,
      candidateTerms: candidates.slice(0, MAX_CANDIDATE_TERMS),
      recentTranslations: retainRecentTranslations([
        entry,
        ...memory.recentTranslations.filter((candidate) => (
          !sameTranslationSubject(candidate, entry)
        )),
      ]),
    };
}

export async function rememberDocumentTranslation(
  identity: DocumentIdentity,
  result: TranslateResult,
): Promise<DocumentMemorySnapshot> {
  return mutate(identity, (memory) => withRememberedDocumentTranslation(memory, identity, result));
}

export async function resolveDocumentReview(
  identity: DocumentIdentity,
  reviewId: string,
): Promise<DocumentMemorySnapshot> {
  return mutate(identity, (memory) => {
    let changed = false;
    const reviewedAt = Date.now();
    const recentTranslations = memory.recentTranslations.map((entry) => {
      if (entry.review?.id !== reviewId) return entry;
      changed = true;
      return {
        ...entry,
        review: { ...entry.review, reviewedAt, updatedAt: reviewedAt },
      };
    });
    if (!changed) return memory;
    return { ...memory, updatedAt: Date.now(), recentTranslations };
  });
}

export function documentMemoryTranslationResult(
  entry: DocumentMemoryTranslation,
  sourceHost?: string,
): TranslateResult {
  const uncertainSpans = entry.review?.uncertainSpans ?? [];
  return {
    requestId: entry.requestId,
    originalText: entry.originalText,
    translatedText: entry.translatedText,
    warnings: [],
    ...(sourceHost ? { sourceHost } : {}),
    ...(entry.targetLanguage ? { targetLanguage: entry.targetLanguage } : {}),
    ...(entry.style ? { style: entry.style } : {}),
    ...(entry.sourceKind ? { sourceKind: entry.sourceKind } : {}),
    ...(entry.sourceLocation ? { sourceLocation: entry.sourceLocation } : {}),
    ...(entry.review?.formulaNeedsReview ? { formulaNeedsReview: true } : {}),
    ...(uncertainSpans.length
      ? { uncertainSpans: [...uncertainSpans] }
      : {}),
    ...(entry.rootRequestId && entry.rootRequestId !== entry.requestId
      ? {
          revision: {
            rootRequestId: entry.rootRequestId,
            kind: 'custom',
            label: '本文记录',
            scope: 'document',
          },
        }
      : {}),
    completedAt: entry.completedAt,
    cached: true,
  };
}

export async function confirmDocumentTerm(
  identity: DocumentIdentity,
  candidateId: string,
): Promise<DocumentMemorySnapshot> {
  return mutate(identity, (memory) => {
    const candidate = memory.candidateTerms.find((term) => term.id === candidateId);
    if (!candidate) return memory;
    const now = Date.now();
    const existing = memory.confirmedTerms.find(
      (term) => normalizedTerm(term.source) === normalizedTerm(candidate.source),
    );
    const confirmed: DocumentConfirmedTerm = existing
      ? { ...existing, target: candidate.target, updatedAt: now }
      : { ...candidate, id: stableId('term', normalizedTerm(candidate.source)), updatedAt: now };
    return {
      ...memory,
      updatedAt: now,
      confirmedTerms: [
        confirmed,
        ...memory.confirmedTerms.filter((term) => term.id !== confirmed.id),
      ].slice(0, MAX_CONFIRMED_TERMS),
      candidateTerms: memory.candidateTerms.filter((term) => term.id !== candidateId),
    };
  });
}

export async function upsertDocumentTerm(
  identity: DocumentIdentity,
  input: { id?: string; source: string; target: string },
): Promise<DocumentMemorySnapshot> {
  return mutate(identity, (memory) => withUpsertedDocumentTerm(memory, input).memory);
}

function withUpsertedDocumentTerm(
  memory: StoredDocumentMemory,
  input: { id?: string; source: string; target: string },
): { memory: StoredDocumentMemory; receipt?: TranslationCorrectionTermReceipt } {
  const clean = sanitizeConfirmedTerm(input.source, input.target);
  if (!clean) return { memory };
  const sourceKey = normalizedTerm(clean.source);
  const existingBySource = memory.confirmedTerms.find(
    (term) => normalizedTerm(term.source) === sourceKey,
  );
  if (!existingBySource && memory.confirmedTerms.length >= MAX_CONFIRMED_TERMS) {
    throw new DocumentTermCapacityError();
  }
  const now = Date.now();
  const id = input.id ?? existingBySource?.id ?? stableId('term', sourceKey);
  const existing = memory.confirmedTerms.find((term) => term.id === id) ?? existingBySource;
  const term: DocumentConfirmedTerm = {
    ...clean,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    memory: {
      ...memory,
      updatedAt: now,
      confirmedTerms: [term, ...memory.confirmedTerms.filter((item) => item.id !== id)],
      candidateTerms: memory.candidateTerms.filter(
        (candidate) => normalizedTerm(candidate.source) !== sourceKey,
      ),
    },
    receipt: {
      scope: 'document',
      source: clean.source,
      appliedTarget: clean.target,
      ...(existing ? { previousTarget: existing.target } : {}),
      documentTermId: id,
    },
  };
}

export async function rememberDocumentCorrection(
  identity: DocumentIdentity,
  result: TranslateResult,
  term?: GlossaryEntry,
): Promise<{
  memory: DocumentMemorySnapshot;
  termChange?: TranslationCorrectionTermReceipt;
}> {
  const update = await mutateWithValue(identity, (memory) => {
    let next = withRememberedDocumentTranslation(memory, identity, result);
    let termChange: TranslationCorrectionTermReceipt | undefined;
    if (term) {
      const termUpdate = withUpsertedDocumentTerm(next, term);
      next = termUpdate.memory;
      termChange = termUpdate.receipt;
    }
    return { memory: next, value: termChange };
  });
  return {
    memory: update.snapshot,
    ...(update.value ? { termChange: update.value } : {}),
  };
}

export async function restoreDocumentCorrection(
  identity: DocumentIdentity,
  result: TranslateResult,
  change?: TranslationCorrectionTermReceipt,
): Promise<{ memory: DocumentMemorySnapshot; termRolledBack: boolean }> {
  const update = await mutateWithValue(identity, (memory) => {
    let next = withRememberedDocumentTranslation(memory, identity, result);
    if (!change || change.scope !== 'document') {
      return { memory: next, value: true };
    }
    const sourceKey = normalizedTerm(change.source);
    const current = next.confirmedTerms.find(
      (term) => normalizedTerm(term.source) === sourceKey,
    );
    if (
      !current ||
      current.target !== change.appliedTarget ||
      (change.documentTermId !== undefined && current.id !== change.documentTermId)
    ) {
      return { memory: next, value: false };
    }
    if (change.previousTarget !== undefined) {
      next = withUpsertedDocumentTerm(next, {
        id: current.id,
        source: change.source,
        target: change.previousTarget,
      }).memory;
    } else {
      next = {
        ...next,
        updatedAt: Date.now(),
        confirmedTerms: next.confirmedTerms.filter((term) => term.id !== current.id),
      };
    }
    return { memory: next, value: true };
  });
  return { memory: update.snapshot, termRolledBack: update.value };
}

export async function removeDocumentTerm(
  identity: DocumentIdentity,
  termId: string,
): Promise<DocumentMemorySnapshot> {
  return mutate(identity, (memory) => ({
    ...memory,
    updatedAt: Date.now(),
    confirmedTerms: memory.confirmedTerms.filter((term) => term.id !== termId),
  }));
}

export async function dismissDocumentTermCandidate(
  identity: DocumentIdentity,
  candidateId: string,
): Promise<DocumentMemorySnapshot> {
  return mutate(identity, (memory) => {
    const candidate = memory.candidateTerms.find((term) => term.id === candidateId);
    if (!candidate) return memory;
    const key = termKey(candidate.source, candidate.target);
    return {
      ...memory,
      updatedAt: Date.now(),
      candidateTerms: memory.candidateTerms.filter((term) => term.id !== candidateId),
      dismissedTermKeys: [key, ...memory.dismissedTermKeys.filter((item) => item !== key)]
        .slice(0, MAX_DISMISSED_TERMS),
    };
  });
}

export async function clearDocumentMemory(identity: DocumentIdentity): Promise<DocumentMemorySnapshot> {
  return mutate(identity, () => ({ ...emptyMemory(identity), updatedAt: Date.now() }));
}

export function mergeDocumentGlossary(
  globalGlossary: GlossaryEntry[],
  memory: Pick<DocumentMemorySnapshot, 'confirmedTerms'>,
): GlossaryEntry[] {
  const documentSources = new Set(memory.confirmedTerms.map((term) => normalizedTerm(term.source)));
  return [
    ...memory.confirmedTerms.map(({ source, target }) => ({ source, target })),
    ...globalGlossary.filter((term) => !documentSources.has(normalizedTerm(term.source))),
  ];
}

function tokens(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase();
  const latin = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? [];
  const cjk = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) ?? [];
  return new Set([...latin, ...cjk]);
}

export function buildDocumentReferenceContext(
  selectedText: string,
  explicitContext: string | undefined,
  memory: Pick<DocumentMemorySnapshot, 'recentTranslations'>,
  maximum = MAX_REFERENCE_CONTEXT,
): string | undefined {
  const parts: string[] = [];
  if (explicitContext?.trim()) parts.push(compactText(explicitContext, Math.floor(maximum * 0.55)));
  const selectedTokens = tokens(selectedText);
  const relevant = memory.recentTranslations
    .filter((entry) => !entry.review || Boolean(entry.review.reviewedAt))
    .filter((entry) => normalizedTerm(entry.originalText) !== normalizedTerm(selectedText))
    .map((entry) => ({
      entry,
      score: [...tokens(entry.originalText)].filter((token) => selectedTokens.has(token)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.entry.completedAt - left.entry.completedAt)
    .slice(0, 2);
  for (const { entry } of relevant) {
    parts.push(`Earlier in this document:\n${compactText(entry.originalText, 360)}\n=> ${compactText(entry.translatedText, 360)}`);
  }
  if (!parts.length) return undefined;
  return compactText(parts.join('\n\n'), maximum);
}
