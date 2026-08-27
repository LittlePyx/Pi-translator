import { isSupportedTargetLanguage, type SupportedTargetLanguage } from '../language/supported-target-languages';
import {
  summarizeRetainedTranslationStorage,
  type RetainedTranslationStorageSummary,
} from '../translation/retained-storage-summary';
import type { TranslationContentMode, TranslationStyle } from '../translation/types';

export const PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY =
  'pdfDocumentTranslationSessionsV1';
export const PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY =
  'pdfDocumentTranslationRetainedV1';

const MAX_DOCUMENT_SIGNATURES = 4_000;
const MAX_TRANSLATION_LENGTH = 20_000;
const MAX_STORED_SESSIONS = 8;
const MAX_TOTAL_TRANSLATION_CHARACTERS = 2_000_000;
const MAX_RETAINED_SESSIONS = 6;
const MAX_RETAINED_TRANSLATION_CHARACTERS = 1_000_000;

export type PdfDocumentTranslationSessionActivity =
  | 'active'
  | 'paused'
  | 'stopped'
  | 'complete';

export interface PdfDocumentTranslationSessionDescriptor {
  documentKey: string;
  targetLanguage: SupportedTargetLanguage;
  sourceLanguage: string;
  style: TranslationStyle;
  contentMode: TranslationContentMode;
}

export interface PdfDocumentTranslationSessionBlock {
  signature: string;
  translatedText: string;
}

export interface PdfDocumentTranslationSessionSnapshot
  extends PdfDocumentTranslationSessionDescriptor {
  documentSignatures: string[];
  blocks: PdfDocumentTranslationSessionBlock[];
  activity: PdfDocumentTranslationSessionActivity;
  updatedAt: number;
}

export interface PdfDocumentTranslationSessionUpdate {
  descriptor: PdfDocumentTranslationSessionDescriptor;
  documentSignatures: string[];
  blocks?: PdfDocumentTranslationSessionBlock[];
  replaceBlocks?: boolean;
  activity: PdfDocumentTranslationSessionActivity;
}

interface StoredPdfDocumentTranslationSession
  extends PdfDocumentTranslationSessionSnapshot {
  behaviorKey: string;
}

let sessionWriteTail: Promise<void> = Promise.resolve();

function serializeSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = sessionWriteTail.catch(() => undefined).then(operation);
  sessionWriteTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function stableHash(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function privateFingerprint(value: string): string {
  return `${stableHash(value, 0x811c9dc5)}${stableHash(value, 0x9e3779b9)}`;
}

export function pdfDocumentTranslationSessionDocumentKey(identity: string): string {
  return `pdf-${privateFingerprint(identity.trim())}`;
}

export function pdfDocumentTranslationSessionBehaviorKey(value: string): string {
  return `behavior-${privateFingerprint(value)}`;
}

export function pdfDocumentTranslationSessionBlockSignature(
  pageNumber: number,
  sourceText: string,
  occurrence: number,
): string {
  return `block-${privateFingerprint(
    `${Math.max(1, Math.round(pageNumber))}\u0000${sourceText}\u0000${Math.max(0, Math.round(occurrence))}`,
  )}`;
}

function validStyle(value: unknown): value is TranslationStyle {
  return value === 'academic' || value === 'general' || value === 'literal';
}

function validContentMode(value: unknown): value is TranslationContentMode {
  return value === 'auto' || value === 'plain' || value === 'latex';
}

function validDocumentKey(value: unknown): value is string {
  return typeof value === 'string' && /^pdf-[a-z0-9]{2,32}$/u.test(value);
}

function validBehaviorKey(value: unknown): value is string {
  return typeof value === 'string' && /^behavior-[a-z0-9]{2,32}$/u.test(value);
}

function validBlockSignature(value: unknown): value is string {
  return typeof value === 'string' && /^block-[a-z0-9]{2,32}$/u.test(value);
}

function uniqueSignatures(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length <= MAX_DOCUMENT_SIGNATURES &&
    value.every(validBlockSignature) &&
    new Set(value).size === value.length;
}

function validActivity(value: unknown): value is PdfDocumentTranslationSessionActivity {
  return ['active', 'paused', 'stopped', 'complete'].includes(String(value));
}

export function isPdfDocumentTranslationSessionDescriptor(
  value: unknown,
): value is PdfDocumentTranslationSessionDescriptor {
  if (!value || typeof value !== 'object') return false;
  const descriptor = value as Record<string, unknown>;
  return Boolean(
    Object.keys(descriptor).every((key) => [
      'documentKey',
      'targetLanguage',
      'sourceLanguage',
      'style',
      'contentMode',
    ].includes(key)) &&
    validDocumentKey(descriptor.documentKey) &&
    isSupportedTargetLanguage(descriptor.targetLanguage) &&
    typeof descriptor.sourceLanguage === 'string' &&
    descriptor.sourceLanguage.trim().length > 0 &&
    descriptor.sourceLanguage.length <= 80 &&
    validStyle(descriptor.style) &&
    validContentMode(descriptor.contentMode)
  );
}

export function isPdfDocumentTranslationSessionBlock(
  value: unknown,
): value is PdfDocumentTranslationSessionBlock {
  if (!value || typeof value !== 'object') return false;
  const block = value as Record<string, unknown>;
  return Boolean(
    Object.keys(block).every((key) => ['signature', 'translatedText'].includes(key)) &&
    validBlockSignature(block.signature) &&
    typeof block.translatedText === 'string' &&
    block.translatedText.trim().length > 0 &&
    block.translatedText.length <= MAX_TRANSLATION_LENGTH
  );
}

function descriptorMatches(
  session: PdfDocumentTranslationSessionDescriptor,
  descriptor: PdfDocumentTranslationSessionDescriptor,
): boolean {
  return session.documentKey === descriptor.documentKey &&
    session.targetLanguage === descriptor.targetLanguage &&
    session.sourceLanguage === descriptor.sourceLanguage &&
    session.style === descriptor.style &&
    session.contentMode === descriptor.contentMode;
}

function validStoredSession(value: unknown): value is StoredPdfDocumentTranslationSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  const descriptor = {
    documentKey: session.documentKey,
    targetLanguage: session.targetLanguage,
    sourceLanguage: session.sourceLanguage,
    style: session.style,
    contentMode: session.contentMode,
  };
  return Boolean(
    isPdfDocumentTranslationSessionDescriptor(descriptor) &&
    uniqueSignatures(session.documentSignatures) &&
    Array.isArray(session.blocks) &&
    session.blocks.length <= MAX_DOCUMENT_SIGNATURES &&
    session.blocks.every(isPdfDocumentTranslationSessionBlock) &&
    session.blocks.every((block) => (
      (session.documentSignatures as string[]).includes(
        (block as PdfDocumentTranslationSessionBlock).signature,
      )
    )) &&
    validActivity(session.activity) &&
    typeof session.updatedAt === 'number' &&
    Number.isFinite(session.updatedAt) &&
    validBehaviorKey(session.behaviorKey)
  );
}

function storedSessions(value: unknown): StoredPdfDocumentTranslationSession[] {
  if (!Array.isArray(value)) return [];
  return value.filter(validStoredSession);
}

function cloneSession(
  session: StoredPdfDocumentTranslationSession,
): PdfDocumentTranslationSessionSnapshot {
  const { behaviorKey: _behaviorKey, ...snapshot } = session;
  return {
    ...snapshot,
    documentSignatures: [...snapshot.documentSignatures],
    blocks: snapshot.blocks.map((block) => ({ ...block })),
  };
}

async function readAll(): Promise<StoredPdfDocumentTranslationSession[]> {
  const stored = await browser.storage.session.get(
    PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY,
  );
  return storedSessions(stored[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]);
}

function prunedSessions(
  sessions: StoredPdfDocumentTranslationSession[],
  maximumSessions = MAX_STORED_SESSIONS,
  maximumCharacters = MAX_TOTAL_TRANSLATION_CHARACTERS,
): StoredPdfDocumentTranslationSession[] {
  const ordered = [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
  const retained: StoredPdfDocumentTranslationSession[] = [];
  let retainedCharacters = 0;
  for (const session of ordered) {
    const characters = session.blocks.reduce(
      (total, block) => total + block.translatedText.length,
      0,
    );
    if (
      retained.length >= maximumSessions ||
      retainedCharacters + characters > maximumCharacters
    ) continue;
    retained.push(session);
    retainedCharacters += characters;
  }
  return retained;
}

export function getPdfDocumentTranslationSession(
  descriptor: PdfDocumentTranslationSessionDescriptor,
  behaviorKey: string,
): Promise<PdfDocumentTranslationSessionSnapshot | undefined> {
  return serializeSessionOperation(async () => {
    const sessions = await readAll();
    const session = sessions.find((candidate) => descriptorMatches(candidate, descriptor));
    if (!session) return undefined;
    if (session.behaviorKey === behaviorKey) return cloneSession(session);
    const retained = sessions.filter((candidate) => candidate !== session);
    if (retained.length) {
      await browser.storage.session.set({
        [PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]: retained,
      });
    } else {
      await browser.storage.session.remove(PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY);
    }
    return undefined;
  });
}

export function savePdfDocumentTranslationSession(
  update: PdfDocumentTranslationSessionUpdate,
  behaviorKey: string,
): Promise<PdfDocumentTranslationSessionSnapshot> {
  if (
    !isPdfDocumentTranslationSessionDescriptor(update.descriptor) ||
    !uniqueSignatures(update.documentSignatures) ||
    !validActivity(update.activity) ||
    !validBehaviorKey(behaviorKey) ||
    (update.replaceBlocks !== undefined && typeof update.replaceBlocks !== 'boolean') ||
    (update.blocks !== undefined && (
      !Array.isArray(update.blocks) ||
      update.blocks.length > MAX_DOCUMENT_SIGNATURES ||
      !update.blocks.every(isPdfDocumentTranslationSessionBlock)
    ))
  ) return Promise.reject(new Error('Invalid PDF document translation session update.'));
  const documentSet = new Set(update.documentSignatures);
  if (update.blocks?.some((block) => !documentSet.has(block.signature))) {
    return Promise.reject(new Error('PDF translation block is not part of this document.'));
  }

  return serializeSessionOperation(async () => {
    const sessions = await readAll();
    const previous = sessions.find((candidate) => (
      descriptorMatches(candidate, update.descriptor) && candidate.behaviorKey === behaviorKey
    ));
    let blocks = update.replaceBlocks
      ? []
      : previous?.blocks
        .filter((block) => documentSet.has(block.signature))
        .map((block) => ({ ...block })) ?? [];
    for (const block of update.blocks ?? []) {
      blocks = [
        { ...block, translatedText: block.translatedText.trim() },
        ...blocks.filter((candidate) => candidate.signature !== block.signature),
      ];
    }
    const next: StoredPdfDocumentTranslationSession = {
      ...update.descriptor,
      documentSignatures: [...update.documentSignatures],
      blocks: blocks.slice(0, MAX_DOCUMENT_SIGNATURES),
      activity: update.activity,
      behaviorKey,
      updatedAt: Date.now(),
    };
    const retained = prunedSessions([
      next,
      ...sessions.filter((candidate) => !descriptorMatches(candidate, update.descriptor)),
    ]);
    if (retained.includes(next)) {
      await browser.storage.session.set({
        [PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]: retained,
      });
    }
    return cloneSession(next);
  });
}

export function clearPdfDocumentTranslationSession(
  descriptor?: PdfDocumentTranslationSessionDescriptor,
): Promise<void> {
  return serializeSessionOperation(async () => {
    if (!descriptor) {
      await browser.storage.session.remove(PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY);
      return;
    }
    const sessions = await readAll();
    const retained = sessions.filter((candidate) => !descriptorMatches(candidate, descriptor));
    if (retained.length === sessions.length) return;
    if (retained.length) {
      await browser.storage.session.set({
        [PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]: retained,
      });
    } else {
      await browser.storage.session.remove(PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY);
    }
  });
}

async function readRetained(): Promise<StoredPdfDocumentTranslationSession[]> {
  const stored = await browser.storage.local.get(
    PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,
  );
  return storedSessions(stored[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]);
}

/**
 * Reads an explicitly retained translation without deleting older results when
 * the active model changes. The caller may replace that result after the user
 * enables retention for the new behavior.
 */
export function getRetainedPdfDocumentTranslationSession(
  descriptor: PdfDocumentTranslationSessionDescriptor,
  behaviorKey: string,
): Promise<PdfDocumentTranslationSessionSnapshot | undefined> {
  return serializeSessionOperation(async () => {
    const sessions = await readRetained();
    const session = sessions.find((candidate) => (
      descriptorMatches(candidate, descriptor) && candidate.behaviorKey === behaviorKey
    ));
    return session ? cloneSession(session) : undefined;
  });
}

export function getRetainedPdfDocumentTranslationStorageSummary(): Promise<
  RetainedTranslationStorageSummary
> {
  return serializeSessionOperation(async () => summarizeRetainedTranslationStorage(
    await readRetained(),
    PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,
    MAX_RETAINED_SESSIONS,
    MAX_RETAINED_TRANSLATION_CHARACTERS,
  ));
}

export function saveRetainedPdfDocumentTranslationSession(
  update: PdfDocumentTranslationSessionUpdate,
  behaviorKey: string,
): Promise<PdfDocumentTranslationSessionSnapshot> {
  if (
    !isPdfDocumentTranslationSessionDescriptor(update.descriptor) ||
    !uniqueSignatures(update.documentSignatures) ||
    !validActivity(update.activity) ||
    !validBehaviorKey(behaviorKey) ||
    (update.replaceBlocks !== undefined && typeof update.replaceBlocks !== 'boolean') ||
    (update.blocks !== undefined && (
      !Array.isArray(update.blocks) ||
      update.blocks.length > MAX_DOCUMENT_SIGNATURES ||
      !update.blocks.every(isPdfDocumentTranslationSessionBlock)
    ))
  ) return Promise.reject(new Error('Invalid retained PDF translation update.'));
  const documentSet = new Set(update.documentSignatures);
  if (update.blocks?.some((block) => !documentSet.has(block.signature))) {
    return Promise.reject(new Error('Retained PDF translation block is not part of this document.'));
  }

  return serializeSessionOperation(async () => {
    const sessions = await readRetained();
    const previous = sessions.find((candidate) => (
      descriptorMatches(candidate, update.descriptor) && candidate.behaviorKey === behaviorKey
    ));
    let blocks = update.replaceBlocks
      ? []
      : previous?.blocks
        .filter((block) => documentSet.has(block.signature))
        .map((block) => ({ ...block })) ?? [];
    for (const block of update.blocks ?? []) {
      blocks = [
        { ...block, translatedText: block.translatedText.trim() },
        ...blocks.filter((candidate) => candidate.signature !== block.signature),
      ];
    }
    const next: StoredPdfDocumentTranslationSession = {
      ...update.descriptor,
      documentSignatures: [...update.documentSignatures],
      blocks: blocks.slice(0, MAX_DOCUMENT_SIGNATURES),
      activity: update.activity,
      behaviorKey,
      updatedAt: Date.now(),
    };
    const retained = prunedSessions([
      next,
      ...sessions.filter((candidate) => !descriptorMatches(candidate, update.descriptor)),
    ], MAX_RETAINED_SESSIONS, MAX_RETAINED_TRANSLATION_CHARACTERS);
    if (!retained.includes(next)) {
      throw new Error('This PDF translation is too large to retain locally.');
    }
    await browser.storage.local.set({
      [PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]: retained,
    });
    return cloneSession(next);
  });
}

export function clearRetainedPdfDocumentTranslationSession(
  descriptor?: PdfDocumentTranslationSessionDescriptor,
): Promise<void> {
  return serializeSessionOperation(async () => {
    if (!descriptor) {
      await browser.storage.local.remove(PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY);
      return;
    }
    const sessions = await readRetained();
    const retained = sessions.filter((candidate) => !descriptorMatches(candidate, descriptor));
    if (retained.length === sessions.length) return;
    if (retained.length) {
      await browser.storage.local.set({
        [PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]: retained,
      });
    } else {
      await browser.storage.local.remove(PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY);
    }
  });
}
