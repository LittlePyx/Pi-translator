import {
  isSupportedTargetLanguage,
  type SupportedTargetLanguage,
} from '../language/supported-target-languages';
import type { TranslationContentMode, TranslationStyle } from './types';

export const BILINGUAL_PAGE_SESSIONS_STORAGE_KEY = 'bilingualPageSessionsByTabV1';

const MAX_DOCUMENT_SIGNATURES = 240;
const MAX_TRANSLATION_LENGTH = 20_000;
const MAX_SESSIONS_PER_TAB = 8;
const MAX_STORED_SESSIONS = 20;
const MAX_TOTAL_TRANSLATION_CHARACTERS = 1_500_000;

export type BilingualPageSessionActivity = 'active' | 'paused' | 'stopped';

export interface BilingualPageSessionDescriptor {
  pageKey: string;
  targetLanguage: SupportedTargetLanguage;
  sourceLanguage: string;
  style: TranslationStyle;
  contentMode: TranslationContentMode;
}

export interface BilingualPageSessionBlock {
  signature: string;
  translatedText: string;
  hidden: boolean;
}

export interface BilingualPageSessionSnapshot extends BilingualPageSessionDescriptor {
  documentSignatures: string[];
  excludedSignatures: string[];
  translationsHidden: boolean;
  activity: BilingualPageSessionActivity;
  blocks: BilingualPageSessionBlock[];
  updatedAt: number;
}

export interface BilingualPageSessionUpdate {
  descriptor: BilingualPageSessionDescriptor;
  documentSignatures: string[];
  excludedSignatures: string[];
  translationsHidden: boolean;
  activity: BilingualPageSessionActivity;
  block?: BilingualPageSessionBlock;
}

interface StoredBilingualPageSession extends BilingualPageSessionSnapshot {
  behaviorKey: string;
}

type SessionsByTab = Record<string, StoredBilingualPageSession[]>;

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

export function bilingualPageSessionPageKey(pageIdentity: string): string {
  return `page-${privateFingerprint(pageIdentity.trim())}`;
}

export function bilingualPageSessionBehaviorKey(value: string): string {
  return `behavior-${privateFingerprint(value)}`;
}

export function bilingualPageSessionBlockSignature(
  tagName: string,
  sourceText: string,
  occurrence: number,
): string {
  return `block-${privateFingerprint(
    `${tagName.toUpperCase()}\u0000${sourceText}\u0000${Math.max(0, Math.floor(occurrence))}`,
  )}`;
}

function validStyle(value: unknown): value is TranslationStyle {
  return value === 'academic' || value === 'general' || value === 'literal';
}

function validContentMode(value: unknown): value is TranslationContentMode {
  return value === 'auto' || value === 'plain' || value === 'latex';
}

function validSignature(value: unknown): value is string {
  return typeof value === 'string' && /^block-[a-z0-9]{2,32}$/u.test(value);
}

function uniqueSignatures(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length <= MAX_DOCUMENT_SIGNATURES &&
    value.every(validSignature) &&
    new Set(value).size === value.length;
}

export function isBilingualPageSessionDescriptor(
  value: unknown,
): value is BilingualPageSessionDescriptor {
  if (!value || typeof value !== 'object') return false;
  const descriptor = value as Record<string, unknown>;
  return Boolean(
    Object.keys(descriptor).every((key) => [
      'pageKey',
      'targetLanguage',
      'sourceLanguage',
      'style',
      'contentMode',
    ].includes(key)) &&
    typeof descriptor.pageKey === 'string' &&
    /^page-[a-z0-9]{2,32}$/u.test(descriptor.pageKey) &&
    isSupportedTargetLanguage(descriptor.targetLanguage) &&
    typeof descriptor.sourceLanguage === 'string' &&
    descriptor.sourceLanguage.trim().length > 0 &&
    descriptor.sourceLanguage.length <= 80 &&
    validStyle(descriptor.style) &&
    validContentMode(descriptor.contentMode)
  );
}

export function isBilingualPageSessionBlock(
  value: unknown,
): value is BilingualPageSessionBlock {
  if (!value || typeof value !== 'object') return false;
  const block = value as Record<string, unknown>;
  return Boolean(
    Object.keys(block).every((key) => ['signature', 'translatedText', 'hidden'].includes(key)) &&
    validSignature(block.signature) &&
    typeof block.translatedText === 'string' &&
    block.translatedText.trim().length > 0 &&
    block.translatedText.length <= MAX_TRANSLATION_LENGTH &&
    typeof block.hidden === 'boolean'
  );
}

export function isBilingualPageSessionUpdate(
  value: unknown,
): value is BilingualPageSessionUpdate {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  if (!Object.keys(update).every((key) => [
    'descriptor',
    'documentSignatures',
    'excludedSignatures',
    'translationsHidden',
    'activity',
    'block',
  ].includes(key))) return false;
  if (
    !isBilingualPageSessionDescriptor(update.descriptor) ||
    !uniqueSignatures(update.documentSignatures) ||
    !uniqueSignatures(update.excludedSignatures) ||
    typeof update.translationsHidden !== 'boolean' ||
    !['active', 'paused', 'stopped'].includes(String(update.activity)) ||
    (update.block !== undefined && !isBilingualPageSessionBlock(update.block))
  ) return false;
  const documentSignatures = new Set(update.documentSignatures);
  return update.excludedSignatures.every((signature) => documentSignatures.has(signature)) &&
    (update.block === undefined || documentSignatures.has(update.block.signature));
}

function descriptorMatches(
  session: BilingualPageSessionDescriptor,
  descriptor: BilingualPageSessionDescriptor,
): boolean {
  return session.pageKey === descriptor.pageKey &&
    session.targetLanguage === descriptor.targetLanguage &&
    session.sourceLanguage === descriptor.sourceLanguage &&
    session.style === descriptor.style &&
    session.contentMode === descriptor.contentMode;
}

function validStoredSession(value: unknown): value is StoredBilingualPageSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  const descriptor = {
    pageKey: session.pageKey,
    targetLanguage: session.targetLanguage,
    sourceLanguage: session.sourceLanguage,
    style: session.style,
    contentMode: session.contentMode,
  };
  return Boolean(
    isBilingualPageSessionDescriptor(descriptor) &&
    uniqueSignatures(session.documentSignatures) &&
    uniqueSignatures(session.excludedSignatures) &&
    session.excludedSignatures.every((signature) => (
      (session.documentSignatures as string[]).includes(signature)
    )) &&
    typeof session.translationsHidden === 'boolean' &&
    ['active', 'paused', 'stopped'].includes(String(session.activity)) &&
    Array.isArray(session.blocks) &&
    session.blocks.length <= MAX_DOCUMENT_SIGNATURES &&
    session.blocks.every(isBilingualPageSessionBlock) &&
    typeof session.updatedAt === 'number' &&
    Number.isFinite(session.updatedAt) &&
    typeof session.behaviorKey === 'string' &&
    /^behavior-[a-z0-9]{2,32}$/u.test(session.behaviorKey)
  );
}

function sessionsByTab(value: unknown): SessionsByTab {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const result: SessionsByTab = {};
  for (const [tabId, sessions] of Object.entries(source)) {
    if (!/^\d+$/u.test(tabId) || !Array.isArray(sessions)) continue;
    const valid = sessions.filter(validStoredSession).slice(0, MAX_SESSIONS_PER_TAB);
    if (valid.length) result[tabId] = valid;
  }
  return result;
}

function cloneSession(session: StoredBilingualPageSession): BilingualPageSessionSnapshot {
  const { behaviorKey: _behaviorKey, ...snapshot } = session;
  return {
    ...snapshot,
    documentSignatures: [...snapshot.documentSignatures],
    excludedSignatures: [...snapshot.excludedSignatures],
    blocks: snapshot.blocks.map((block) => ({ ...block })),
  };
}

async function readAll(): Promise<SessionsByTab> {
  const stored = await browser.storage.session.get(BILINGUAL_PAGE_SESSIONS_STORAGE_KEY);
  return sessionsByTab(stored[BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]);
}

function pruneSessions(all: SessionsByTab): SessionsByTab {
  for (const [tabId, sessions] of Object.entries(all)) {
    const retained = [...sessions]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS_PER_TAB);
    if (retained.length) all[tabId] = retained;
    else delete all[tabId];
  }
  const ordered = Object.entries(all)
    .flatMap(([tabId, sessions]) => sessions.map((session) => ({ tabId, session })))
    .sort((left, right) => right.session.updatedAt - left.session.updatedAt);
  let retainedCharacters = 0;
  const keep = new Set<StoredBilingualPageSession>();
  for (const { session } of ordered) {
    const characters = session.blocks.reduce(
      (total, block) => total + block.translatedText.length,
      0,
    );
    if (
      keep.size >= MAX_STORED_SESSIONS ||
      retainedCharacters + characters > MAX_TOTAL_TRANSLATION_CHARACTERS
    ) continue;
    keep.add(session);
    retainedCharacters += characters;
  }
  for (const [tabId, sessions] of Object.entries(all)) {
    const retained = sessions.filter((session) => keep.has(session));
    if (retained.length) all[tabId] = retained;
    else delete all[tabId];
  }
  return all;
}

export function getBilingualPageSession(
  tabId: number,
  descriptor: BilingualPageSessionDescriptor,
  behaviorKey: string,
): Promise<BilingualPageSessionSnapshot | undefined> {
  return serializeSessionOperation(async () => {
    const all = await readAll();
    const key = String(tabId);
    const session = all[key]?.find((candidate) => descriptorMatches(candidate, descriptor));
    if (!session) return undefined;
    if (session.behaviorKey === behaviorKey) return cloneSession(session);
    all[key] = all[key]!.filter((candidate) => candidate !== session);
    if (!all[key]!.length) delete all[key];
    await browser.storage.session.set({ [BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]: all });
    return undefined;
  });
}

export function saveBilingualPageSession(
  tabId: number,
  update: BilingualPageSessionUpdate,
  behaviorKey: string,
): Promise<BilingualPageSessionSnapshot> {
  return serializeSessionOperation(async () => {
    const all = await readAll();
    const key = String(tabId);
    const sessions = all[key] ?? [];
    const previous = sessions.find((candidate) => (
      descriptorMatches(candidate, update.descriptor) && candidate.behaviorKey === behaviorKey
    ));
    const documentSignatures = [...update.documentSignatures];
    const documentSet = new Set(documentSignatures);
    let blocks = previous?.blocks
      .filter((block) => documentSet.has(block.signature))
      .map((block) => ({ ...block })) ?? [];
    if (update.block) {
      blocks = [
        { ...update.block },
        ...blocks.filter((block) => block.signature !== update.block!.signature),
      ].slice(0, MAX_DOCUMENT_SIGNATURES);
    }
    const next: StoredBilingualPageSession = {
      ...update.descriptor,
      behaviorKey,
      documentSignatures,
      excludedSignatures: [...update.excludedSignatures],
      translationsHidden: update.translationsHidden,
      activity: update.activity,
      blocks,
      updatedAt: Date.now(),
    };
    all[key] = [
      next,
      ...sessions.filter((candidate) => !descriptorMatches(candidate, update.descriptor)),
    ];
    const pruned = pruneSessions(all);
    await browser.storage.session.set({ [BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]: pruned });
    return cloneSession(next);
  });
}

export function clearBilingualPageSession(
  tabId?: number,
  descriptor?: BilingualPageSessionDescriptor,
): Promise<void> {
  return serializeSessionOperation(async () => {
    if (tabId === undefined) {
      await browser.storage.session.remove(BILINGUAL_PAGE_SESSIONS_STORAGE_KEY);
      return;
    }
    const all = await readAll();
    const key = String(tabId);
    if (!(key in all)) return;
    if (!descriptor) delete all[key];
    else {
      all[key] = all[key]!.filter((session) => !descriptorMatches(session, descriptor));
      if (!all[key]!.length) delete all[key];
    }
    await browser.storage.session.set({ [BILINGUAL_PAGE_SESSIONS_STORAGE_KEY]: all });
  });
}

export function bilingualPageSessionMatchesDocument(
  storedSignatures: readonly string[],
  currentSignatures: readonly string[],
): boolean {
  const baseline = Math.min(storedSignatures.length, currentSignatures.length);
  if (!baseline) return false;
  const current = new Set(currentSignatures);
  const matched = storedSignatures.filter((signature) => current.has(signature)).length;
  if (baseline <= 2) return matched >= 1;
  return matched / baseline >= .34;
}
