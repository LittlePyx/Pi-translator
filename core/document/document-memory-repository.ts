import type {
  AppliedGlossaryTerm,
  GlossaryEntry,
  PdfSourceLocation,
  ScopedGlossaryTerm,
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
  appliedGlossaryTerms?: AppliedGlossaryTerm[];
  glossaryTermsNeedingReview?: ScopedGlossaryTerm[];
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

/**
 * A reversible, conditional change to one translation subject in a document.
 *
 * `applied` is the exact entry which must still be current before this change
 * can be rolled back. `previous` is the entry which rollback restores (or is
 * absent when the correction introduced a new subject). Capacity evictions are
 * recorded as well so a rollback can restore them when the reverted change
 * frees enough room. A receipt never evicts entries written after it merely to
 * restore an older capacity eviction.
 *
 * The same shape is used for the compensation returned by rollback: applying
 * that compensation reverses the rollback without overwriting a later edit.
 */
export interface DocumentTranslationChangeReceipt {
  subject: DocumentMemoryTranslation;
  applied?: DocumentMemoryTranslation;
  previous?: DocumentMemoryTranslation;
  evicted: DocumentMemoryTranslation[];
  introduced: DocumentMemoryTranslation[];
}

/** Exact document-term transition used by the combined correction receipt. */
export interface DocumentTermChangeReceipt {
  sourceKey: string;
  applied?: DocumentConfirmedTerm;
  previous?: DocumentConfirmedTerm;
  removedCandidates: DocumentTermCandidate[];
  introducedCandidates: DocumentTermCandidate[];
}

/** One atomic document correction, including its optional terminology edit. */
export interface DocumentCorrectionChangeReceipt {
  translationChange: DocumentTranslationChangeReceipt;
  termChange?: DocumentTermChangeReceipt;
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

function sameSourceLocation(
  left: PdfSourceLocation | undefined,
  right: PdfSourceLocation | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.documentId === right.documentId &&
    left.pageNumber === right.pageNumber &&
    left.leftRatio === right.leftRatio &&
    left.topRatio === right.topRatio &&
    left.widthRatio === right.widthRatio &&
    left.heightRatio === right.heightRatio
  );
}

function sameReview(
  left: DocumentTranslationReview | undefined,
  right: DocumentTranslationReview | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.formulaNeedsReview === right.formulaNeedsReview &&
    left.updatedAt === right.updatedAt &&
    left.reviewedAt === right.reviewedAt &&
    left.uncertainSpans.length === right.uncertainSpans.length &&
    left.uncertainSpans.every((span, index) => span === right.uncertainSpans[index])
  );
}

/** Equality for conditional mutation receipts; any later edit must win. */
function sameTranslationEntry(
  left: DocumentMemoryTranslation | undefined,
  right: DocumentMemoryTranslation | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.requestId === right.requestId &&
    left.rootRequestId === right.rootRequestId &&
    left.originalText === right.originalText &&
    left.translatedText === right.translatedText &&
    left.completedAt === right.completedAt &&
    left.targetLanguage === right.targetLanguage &&
    left.style === right.style &&
    left.sourceKind === right.sourceKind &&
    sameSourceLocation(left.sourceLocation, right.sourceLocation) &&
    sameReview(left.review, right.review)
  );
}

function sameConfirmedTerm(
  left: DocumentConfirmedTerm | undefined,
  right: DocumentConfirmedTerm | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.source === right.source &&
    left.target === right.target &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  );
}

function sameCandidateTerm(
  left: DocumentTermCandidate,
  right: DocumentTermCandidate,
): boolean {
  return (
    left.id === right.id &&
    left.source === right.source &&
    left.target === right.target &&
    left.createdAt === right.createdAt
  );
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

function withRememberedDocumentTranslationChange(
  memory: StoredDocumentMemory,
  identity: DocumentIdentity,
  result: TranslateResult,
): { memory: StoredDocumentMemory; change: DocumentTranslationChangeReceipt } {
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
    ...(result.appliedGlossaryTerms?.length
      ? { appliedGlossaryTerms: result.appliedGlossaryTerms.map((term) => ({ ...term })) }
      : {}),
    ...(result.glossaryTermsNeedingReview?.length
      ? { glossaryTermsNeedingReview: result.glossaryTermsNeedingReview.map((term) => ({ ...term })) }
      : {}),
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
  const recentTranslations = retainRecentTranslations([
    entry,
    ...memory.recentTranslations.filter((candidate) => (
      !sameTranslationSubject(candidate, entry)
    )),
  ]);
  const retainedIds = new Set(recentTranslations.map((candidate) => candidate.id));
  const evicted = memory.recentTranslations.filter((candidate) => (
    candidate !== previous &&
    candidate.id !== previous?.id &&
    !retainedIds.has(candidate.id)
  ));
  return {
    memory: {
      ...memory,
      label: identity.label,
      updatedAt: now,
      candidateTerms: candidates.slice(0, MAX_CANDIDATE_TERMS),
      recentTranslations,
    },
    change: {
      subject: entry,
      applied: entry,
      ...(previous ? { previous } : {}),
      evicted,
      introduced: [],
    },
  };
}

function withRememberedDocumentTranslation(
  memory: StoredDocumentMemory,
  identity: DocumentIdentity,
  result: TranslateResult,
): StoredDocumentMemory {
  return withRememberedDocumentTranslationChange(memory, identity, result).memory;
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
    ...(entry.appliedGlossaryTerms?.length
      ? { appliedGlossaryTerms: entry.appliedGlossaryTerms.map((term) => ({ ...term })) }
      : {}),
    ...(entry.glossaryTermsNeedingReview?.length
      ? { glossaryTermsNeedingReview: entry.glossaryTermsNeedingReview.map((term) => ({ ...term })) }
      : {}),
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
  return (await upsertDocumentTermWithReceipt(identity, input)).memory;
}

function withUpsertedDocumentTerm(
  memory: StoredDocumentMemory,
  input: { id?: string; source: string; target: string },
): {
  memory: StoredDocumentMemory;
  receipt?: TranslationCorrectionTermReceipt;
  change?: DocumentTermChangeReceipt;
} {
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
  const removedCandidates = memory.candidateTerms.filter(
    (candidate) => normalizedTerm(candidate.source) === sourceKey,
  );
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
    change: {
      sourceKey,
      applied: term,
      ...(existing ? { previous: existing } : {}),
      removedCandidates,
      introducedCandidates: [],
    },
  };
}

/**
 * Applies a document term and captures the exact conditional rollback receipt
 * in the same storage mutation. This avoids a read-then-write window when a
 * correction is committed from more than one tab of the same document.
 */
export async function upsertDocumentTermWithReceipt(
  identity: DocumentIdentity,
  input: { id?: string; source: string; target: string },
): Promise<{
  memory: DocumentMemorySnapshot;
  termChange?: TranslationCorrectionTermReceipt;
}> {
  const update = await mutateWithValue(identity, (memory) => {
    const next = withUpsertedDocumentTerm(memory, input);
    return { memory: next.memory, value: next.receipt };
  });
  return {
    memory: update.snapshot,
    ...(update.value ? { termChange: update.value } : {}),
  };
}

/**
 * Rolls a document term back only while the value written by the matching
 * correction is still current. A later user edit always wins.
 */
export async function rollbackDocumentTermChange(
  identity: DocumentIdentity,
  change: TranslationCorrectionTermReceipt,
): Promise<{ memory: DocumentMemorySnapshot; rolledBack: boolean }> {
  const update = await mutateWithValue(identity, (memory) => {
    if (change.scope !== 'document') return { memory, value: false };
    const sourceKey = normalizedTerm(change.source);
    const current = memory.confirmedTerms.find(
      (term) => normalizedTerm(term.source) === sourceKey,
    );
    if (
      !current ||
      current.target !== change.appliedTarget ||
      (change.documentTermId !== undefined && current.id !== change.documentTermId)
    ) return { memory, value: false };

    if (change.previousTarget !== undefined) {
      return {
        memory: withUpsertedDocumentTerm(memory, {
          id: current.id,
          source: change.source,
          target: change.previousTarget,
        }).memory,
        value: true,
      };
    }
    return {
      memory: {
        ...memory,
        updatedAt: Date.now(),
        confirmedTerms: memory.confirmedTerms.filter((term) => term.id !== current.id),
      },
      value: true,
    };
  });
  return { memory: update.snapshot, rolledBack: update.value };
}

function withAppliedTranslationChange(
  memory: StoredDocumentMemory,
  change: DocumentTranslationChangeReceipt,
): {
  memory: StoredDocumentMemory;
  applied: boolean;
  compensation?: DocumentTranslationChangeReceipt;
} {
  const current = memory.recentTranslations.find((entry) => (
    sameTranslationSubject(entry, change.subject)
  ));
  if (!sameTranslationEntry(current, change.applied)) {
    return { memory, applied: false };
  }

  const introducedIds = new Set(change.introduced.map((entry) => entry.id));
  const actuallyRemovedIntroduced = memory.recentTranslations.filter((entry) => (
    introducedIds.has(entry.id) &&
    change.introduced.some((candidate) => sameTranslationEntry(candidate, entry))
  ));
  const remaining = memory.recentTranslations.filter((entry) => (
    entry !== current &&
    !actuallyRemovedIntroduced.some((candidate) => candidate.id === entry.id)
  ));
  const additions: DocumentMemoryTranslation[] = [];
  let pendingReviewCount = remaining.filter((entry) => (
    entry.review && !entry.review.reviewedAt
  )).length;
  const restoreWithoutEviction = (entry: DocumentMemoryTranslation): boolean => {
    if (
      additions.some((candidate) => sameTranslationSubject(candidate, entry)) ||
      remaining.some((candidate) => sameTranslationSubject(candidate, entry)) ||
      additions.length + remaining.length >= MAX_TRANSLATIONS
    ) return false;
    if (entry.review && !entry.review.reviewedAt) {
      // retainRecentTranslations deliberately keeps at most twelve pending
      // reviews. Do not displace a newer pending review to restore an old one.
      if (pendingReviewCount >= 12) return false;
      pendingReviewCount += 1;
    }
    additions.push(entry);
    return true;
  };
  // Restoring the previous value of the changed subject is the core mutation.
  // If later unrelated writes consumed every released slot, fail closed rather
  // than evicting one of those writes and claiming a successful compensation.
  if (change.previous && !restoreWithoutEviction(change.previous)) {
    return { memory, applied: false };
  }
  for (const entry of change.evicted) {
    // Capacity evictions are best-effort history restoration. They are older
    // than the receipt, so a later unrelated translation always wins the slot.
    restoreWithoutEviction(entry);
  }
  const recentTranslations = retainRecentTranslations([...additions, ...remaining]);
  const retainedIds = new Set(recentTranslations.map((entry) => entry.id));
  const restoredEntries = change.evicted.filter((entry) => retainedIds.has(entry.id));
  const excludedIds = new Set([
    ...(current ? [current.id] : []),
    ...actuallyRemovedIntroduced.map((entry) => entry.id),
  ]);
  const newlyEvicted = memory.recentTranslations.filter((entry) => (
    !excludedIds.has(entry.id) && !retainedIds.has(entry.id)
  ));
  const replacement = change.previous && retainedIds.has(change.previous.id)
    ? change.previous
    : undefined;
  const next: StoredDocumentMemory = {
    ...memory,
    updatedAt: Date.now(),
    recentTranslations,
  };
  return {
    memory: next,
    applied: true,
    compensation: {
      subject: change.subject,
      ...(replacement ? { applied: replacement } : {}),
      ...(current ? { previous: current } : {}),
      evicted: newlyEvicted,
      introduced: restoredEntries,
    },
  };
}

function withAppliedTermChange(
  memory: StoredDocumentMemory,
  change: DocumentTermChangeReceipt,
): {
  memory: StoredDocumentMemory;
  applied: boolean;
  compensation?: DocumentTermChangeReceipt;
} {
  const current = memory.confirmedTerms.find((term) => (
    normalizedTerm(term.source) === change.sourceKey
  ));
  if (!sameConfirmedTerm(current, change.applied)) {
    return { memory, applied: false };
  }

  const remainingTerms = memory.confirmedTerms.filter((term) => term !== current);
  const confirmedTerms = change.previous
    ? [change.previous, ...remainingTerms.filter((term) => term.id !== change.previous!.id)]
      .slice(0, MAX_CONFIRMED_TERMS)
    : remainingTerms;
  const actuallyRemovedCandidates = memory.candidateTerms.filter((candidate) => (
    change.introducedCandidates.some((entry) => sameCandidateTerm(candidate, entry))
  ));
  const remainingCandidates = memory.candidateTerms.filter((candidate) => (
    !actuallyRemovedCandidates.some((entry) => entry.id === candidate.id)
  ));
  const restoredCandidates = change.removedCandidates.filter((candidate) => (
    !remainingCandidates.some((entry) => (
      entry.id === candidate.id || termKey(entry.source, entry.target) === termKey(candidate.source, candidate.target)
    ))
  ));
  const candidateTerms = [...restoredCandidates, ...remainingCandidates]
    .slice(0, MAX_CANDIDATE_TERMS);
  const retainedCandidateIds = new Set(candidateTerms.map((candidate) => candidate.id));
  const newlyEvictedCandidates = memory.candidateTerms.filter((candidate) => (
    !actuallyRemovedCandidates.some((entry) => entry.id === candidate.id) &&
    !retainedCandidateIds.has(candidate.id)
  ));
  const restoredAndRetained = restoredCandidates.filter((candidate) => (
    retainedCandidateIds.has(candidate.id)
  ));
  const replacement = change.previous && confirmedTerms.some((term) => (
    sameConfirmedTerm(term, change.previous)
  )) ? change.previous : undefined;
  return {
    memory: {
      ...memory,
      updatedAt: Date.now(),
      confirmedTerms,
      candidateTerms,
    },
    applied: true,
    compensation: {
      sourceKey: change.sourceKey,
      ...(replacement ? { applied: replacement } : {}),
      ...(current ? { previous: current } : {}),
      removedCandidates: newlyEvictedCandidates,
      introducedCandidates: restoredAndRetained,
    },
  };
}

/**
 * Conditionally applies a correction receipt in reverse. Translation and term
 * checks happen in one storage mutation. If the translation was changed by a
 * later tab, nothing is touched. A later terminology edit is preserved while
 * the still-current translation can still be restored.
 *
 * The returned `compensation` is another receipt of the same shape; applying it
 * conditionally reverses this rollback if a later commit step fails.
 */
export async function rollbackDocumentCorrectionChange(
  identity: DocumentIdentity,
  change: DocumentCorrectionChangeReceipt,
): Promise<{
  memory: DocumentMemorySnapshot;
  rolledBack: boolean;
  termRolledBack: boolean;
  compensation?: DocumentCorrectionChangeReceipt;
}> {
  type RollbackValue = {
    rolledBack: boolean;
    termRolledBack: boolean;
    compensation?: DocumentCorrectionChangeReceipt;
  };
  const update = await mutateWithValue<RollbackValue>(identity, (memory) => {
    const translation = withAppliedTranslationChange(memory, change.translationChange);
    if (!translation.applied || !translation.compensation) {
      return {
        memory,
        value: { rolledBack: false, termRolledBack: false },
      };
    }
    const term = change.termChange
      ? withAppliedTermChange(translation.memory, change.termChange)
      : undefined;
    const next = term?.applied ? term.memory : translation.memory;
    const compensation: DocumentCorrectionChangeReceipt = {
      translationChange: translation.compensation,
      ...(term?.applied && term.compensation ? { termChange: term.compensation } : {}),
    };
    return {
      memory: next,
      value: {
        rolledBack: true,
        termRolledBack: change.termChange ? Boolean(term?.applied) : true,
        compensation,
      },
    };
  });
  return {
    memory: update.snapshot,
    ...update.value,
  };
}

export async function rememberDocumentCorrection(
  identity: DocumentIdentity,
  result: TranslateResult,
  term?: GlossaryEntry,
): Promise<{
  memory: DocumentMemorySnapshot;
  translationChange: DocumentTranslationChangeReceipt;
  change: DocumentCorrectionChangeReceipt;
  termChange?: TranslationCorrectionTermReceipt;
}> {
  const update = await mutateWithValue(identity, (memory) => {
    const translationUpdate = withRememberedDocumentTranslationChange(memory, identity, result);
    let next = translationUpdate.memory;
    let termChange: TranslationCorrectionTermReceipt | undefined;
    let detailedTermChange: DocumentTermChangeReceipt | undefined;
    if (term) {
      const termUpdate = withUpsertedDocumentTerm(next, term);
      next = termUpdate.memory;
      termChange = termUpdate.receipt;
      detailedTermChange = termUpdate.change;
    }
    const change: DocumentCorrectionChangeReceipt = {
      translationChange: translationUpdate.change,
      ...(detailedTermChange ? { termChange: detailedTermChange } : {}),
    };
    return { memory: next, value: { change, termChange } };
  });
  return {
    memory: update.snapshot,
    translationChange: update.value.change.translationChange,
    change: update.value.change,
    ...(update.value.termChange ? { termChange: update.value.termChange } : {}),
  };
}

function translationEntryMatchesResult(
  entry: DocumentMemoryTranslation | undefined,
  result: TranslateResult,
): boolean {
  if (!entry) return false;
  return (
    entry.requestId === result.requestId &&
    (entry.rootRequestId ?? entry.requestId) ===
      (result.revision?.rootRequestId ?? result.requestId) &&
    entry.originalText === compactText(result.originalText) &&
    entry.translatedText === compactText(result.translatedText) &&
    entry.sourceKind === result.sourceKind &&
    sameSourceLocation(entry.sourceLocation, result.sourceLocation)
  );
}

/**
 * Restores a document correction only while the exact corrected translation is
 * still current. This is the document-wide counterpart to the per-tab result
 * head: an undo from one tab must never overwrite a later edit from another
 * tab viewing the same PDF.
 *
 * The returned change can be passed to rollbackDocumentCorrectionChange when a
 * later commit step fails, so the undo itself is also conditionally reversible.
 * Pass the detailed `rememberDocumentCorrection(...).change.termChange` receipt
 * when available. The legacy term receipt remains accepted for compatibility,
 * but it cannot restore candidate terms removed when the correction was saved.
 */
export async function restoreDocumentCorrectionIfCurrent(
  identity: DocumentIdentity,
  expectedCorrectedResult: TranslateResult,
  restoredResult: TranslateResult,
  termChange?: TranslationCorrectionTermReceipt | DocumentTermChangeReceipt,
): Promise<{
  memory: DocumentMemorySnapshot;
  restored: boolean;
  termRolledBack: boolean;
  change?: DocumentCorrectionChangeReceipt;
}> {
  type RestoreValue = {
    restored: boolean;
    termRolledBack: boolean;
    change?: DocumentCorrectionChangeReceipt;
  };
  const update = await mutateWithValue<RestoreValue>(identity, (memory) => {
    const expectedSubject = withRememberedDocumentTranslationChange(
      memory,
      identity,
      expectedCorrectedResult,
    ).change.subject;
    const current = memory.recentTranslations.find((entry) => (
      sameTranslationSubject(entry, expectedSubject)
    ));
    if (!translationEntryMatchesResult(current, expectedCorrectedResult)) {
      return {
        memory,
        value: { restored: false, termRolledBack: false },
      };
    }

    const translation = withRememberedDocumentTranslationChange(
      memory,
      identity,
      restoredResult,
    );
    let next = translation.memory;
    let termRolledBack = true;
    let detailedTermChange: DocumentTermChangeReceipt | undefined;
    if (termChange && 'sourceKey' in termChange) {
      const restoredTerm = withAppliedTermChange(next, termChange);
      if (!restoredTerm.applied || !restoredTerm.compensation) {
        termRolledBack = false;
      } else {
        next = restoredTerm.memory;
        detailedTermChange = restoredTerm.compensation;
      }
    } else if (termChange?.scope === 'document') {
      const sourceKey = normalizedTerm(termChange.source);
      const currentTerm = next.confirmedTerms.find((term) => (
        normalizedTerm(term.source) === sourceKey
      ));
      if (
        !currentTerm ||
        currentTerm.target !== termChange.appliedTarget ||
        (termChange.documentTermId !== undefined &&
          currentTerm.id !== termChange.documentTermId)
      ) {
        termRolledBack = false;
      } else if (termChange.previousTarget !== undefined) {
        const restoredTerm = withUpsertedDocumentTerm(next, {
          id: currentTerm.id,
          source: termChange.source,
          target: termChange.previousTarget,
        });
        next = restoredTerm.memory;
        detailedTermChange = restoredTerm.change;
      } else {
        next = {
          ...next,
          updatedAt: Date.now(),
          confirmedTerms: next.confirmedTerms.filter((term) => term.id !== currentTerm.id),
        };
        detailedTermChange = {
          sourceKey,
          previous: currentTerm,
          removedCandidates: [],
          introducedCandidates: [],
        };
      }
    }

    const change: DocumentCorrectionChangeReceipt = {
      translationChange: translation.change,
      ...(detailedTermChange ? { termChange: detailedTermChange } : {}),
    };
    return {
      memory: next,
      value: { restored: true, termRolledBack, change },
    };
  });
  return { memory: update.snapshot, ...update.value };
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
  return mergeDocumentGlossaryWithScope(globalGlossary, memory)
    .map(({ source, target }) => ({ source, target }));
}

export function mergeDocumentGlossaryWithScope(
  globalGlossary: GlossaryEntry[],
  memory: Pick<DocumentMemorySnapshot, 'confirmedTerms'>,
): AppliedGlossaryTerm[] {
  const documentSources = new Set(memory.confirmedTerms.map((term) => normalizedTerm(term.source)));
  return [
    ...memory.confirmedTerms.map(({ source, target }) => ({
      source,
      target,
      scope: 'document' as const,
    })),
    ...globalGlossary
      .filter((term) => !documentSources.has(normalizedTerm(term.source)))
      .map((term) => ({ ...term, scope: 'global' as const })),
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
