import type {
  GlossaryEntry,
  PdfSourceLocation,
  TranslateResult,
  TranslationStyle,
} from '../translation/types';
import type { DocumentIdentity } from './document-identity';

const STORAGE_KEY = 'documentTranslationMemoryV1';
const SCHEMA_VERSION = 1;
const MAX_DOCUMENTS = 40;
const MAX_TRANSLATIONS = 20;
const MAX_CONFIRMED_TERMS = 100;
const MAX_CANDIDATE_TERMS = 20;
const MAX_DISMISSED_TERMS = 60;
const MAX_ENTRY_TEXT = 2_400;
const MAX_REFERENCE_CONTEXT = 1_600;

export interface DocumentConfirmedTerm extends GlossaryEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentTermCandidate extends GlossaryEntry {
  id: string;
  createdAt: number;
}

export interface DocumentMemoryTranslation {
  id: string;
  requestId: string;
  originalText: string;
  translatedText: string;
  completedAt: number;
  targetLanguage?: string;
  style?: TranslationStyle;
  sourceKind?: TranslateResult['sourceKind'];
  sourceLocation?: PdfSourceLocation;
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
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
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
      ? record.recentTranslations.slice(0, MAX_TRANSLATIONS)
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

async function mutate(
  identity: DocumentIdentity,
  updater: (memory: StoredDocumentMemory) => StoredDocumentMemory,
): Promise<DocumentMemorySnapshot> {
  let snapshot = publicSnapshot(emptyMemory(identity));
  const operation = writeQueue.then(async () => {
    const all = await readAll();
    const current = sanitizeMemory(all[identity.documentId], identity);
    const proposed = updater(current);
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
  return snapshot;
}

export async function getDocumentMemory(
  identity: DocumentIdentity,
): Promise<DocumentMemorySnapshot> {
  await writeQueue;
  const all = await readAll();
  return publicSnapshot(sanitizeMemory(all[identity.documentId], identity));
}

export async function rememberDocumentTranslation(
  identity: DocumentIdentity,
  result: TranslateResult,
): Promise<DocumentMemorySnapshot> {
  return mutate(identity, (memory) => {
    const now = Date.now();
    const entry: DocumentMemoryTranslation = {
      id: stableId('translation', `${result.requestId}:${result.originalText}`),
      requestId: result.requestId,
      originalText: compactText(result.originalText),
      translatedText: compactText(result.translatedText),
      completedAt: result.completedAt ?? now,
      ...(result.targetLanguage ? { targetLanguage: result.targetLanguage } : {}),
      ...(result.style ? { style: result.style } : {}),
      ...(result.sourceKind ? { sourceKind: result.sourceKind } : {}),
      ...(result.sourceLocation ? { sourceLocation: result.sourceLocation } : {}),
    };
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
      recentTranslations: [
        entry,
        ...memory.recentTranslations.filter(
          (previous) => normalizedTerm(previous.originalText) !== normalizedTerm(entry.originalText),
        ),
      ].slice(0, MAX_TRANSLATIONS),
    };
  });
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
  const clean = sanitizeTerm(input.source, input.target);
  if (!clean) return getDocumentMemory(identity);
  return mutate(identity, (memory) => {
    const now = Date.now();
    const id = input.id ?? stableId('term', normalizedTerm(clean.source));
    const existing = memory.confirmedTerms.find((term) => term.id === id);
    const term: DocumentConfirmedTerm = {
      ...clean,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return {
      ...memory,
      updatedAt: now,
      confirmedTerms: [term, ...memory.confirmedTerms.filter((item) => item.id !== id)]
        .slice(0, MAX_CONFIRMED_TERMS),
      candidateTerms: memory.candidateTerms.filter(
        (candidate) => normalizedTerm(candidate.source) !== normalizedTerm(term.source),
      ),
    };
  });
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
