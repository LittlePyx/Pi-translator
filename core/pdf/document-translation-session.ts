import { isSupportedTargetLanguage, type SupportedTargetLanguage } from '../language/supported-target-languages';
import {
  summarizeRetainedTranslationStorage,
  type RetainedTranslationStorageSummary,
} from '../translation/retained-storage-summary';
import type { TranslationContentMode, TranslationStyle } from '../translation/types';
import { compactFormulaDocument, isFormulaDocument, type FormulaDocument } from '../translation/formula-document';
import { validPdfRequestLimit } from './request-budget';
import {fixedDocumentKey,readFixedDocumentRecords,retainDocumentSessions} from '../translation/fixed-document-storage';
import {withDocumentStorageLock} from '../translation/document-storage-lock';
import {paragraphValue,withParagraphHistory,validParagraphRevision,MAX_PDF_PARAGRAPH_REVISIONS,type PdfParagraphRevision} from './paragraph-history';
import {isPdfPaperRole,type PdfPaperRole} from './paper-metadata';

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
  manualCorrection?:true;
  retranslation?:true;
  revisions?:PdfParagraphRevision[];
  pageNumber?:number;
  headingLevel?:1|2|3;
  paperRole?:PdfPaperRole;
  reviewConfirmation?: string;
  formulaDocument?: FormulaDocument;
  signature: string;
  translatedText: string;
  formulaReviewMessage?: string;
  formulaReviewDraft?: true;
  visualFallbackMessage?: string;
}

function compactBlock(block: PdfDocumentTranslationSessionBlock): PdfDocumentTranslationSessionBlock {
  return { ...block, translatedText: block.formulaDocument?.translationTemplate ?? block.translatedText.trim(),
    ...(block.revisions?{revisions:block.revisions.map(revision=>({...revision,...paragraphValue(revision)}))}:{}),
    ...(block.formulaDocument ? { formulaDocument: compactFormulaDocument(block.formulaDocument) } : {}) };
}

export interface PdfDocumentTranslationPlan {
  mode: 'all' | 'current' | 'custom';
  pages: number[];
  skipReferences: boolean;
  skipAppendix: boolean;
  multimodal: boolean;
  requestLimit: number;
}

function validPlan(value: unknown): value is PdfDocumentTranslationPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Record<string, unknown>;
  return Object.keys(plan).every(key => ['mode', 'pages', 'skipReferences', 'skipAppendix', 'multimodal', 'requestLimit'].includes(key)) &&
    ['all', 'current', 'custom'].includes(String(plan.mode)) && Array.isArray(plan.pages) && plan.pages.length <= MAX_DOCUMENT_SIGNATURES &&
    plan.pages.every(page => Number.isSafeInteger(page) && page >= 1 && page <= 100_000) && new Set(plan.pages).size === plan.pages.length &&
    (plan.mode === 'all' ? plan.pages.length === 0 : plan.mode === 'current' ? plan.pages.length === 1 : plan.pages.length > 0) &&
    ['skipReferences', 'skipAppendix', 'multimodal'].every(key => typeof plan[key] === 'boolean') && validPdfRequestLimit(plan.requestLimit);
}

function clonePlan(plan: PdfDocumentTranslationPlan): PdfDocumentTranslationPlan {
  return {...plan, pages: [...plan.pages]};
}

export interface PdfDocumentTranslationSessionSnapshot
  extends PdfDocumentTranslationSessionDescriptor {
  documentSignatures: string[];
  scopeSignatures?: string[];
  preservedSignatures?: string[];
  blocks: PdfDocumentTranslationSessionBlock[];
  /** Previous segmentation results, kept for inspection rather than presented as current translations. */
  archivedBlocks?: PdfDocumentTranslationSessionBlock[];
  activity: PdfDocumentTranslationSessionActivity;
  updatedAt: number;
  plan?: PdfDocumentTranslationPlan;
  sourceFingerprint?: string;
}

export interface PdfDocumentTranslationSessionUpdate {
  descriptor: PdfDocumentTranslationSessionDescriptor;
  documentSignatures: string[];
  scopeSignatures?: string[];
  preservedSignatures?: string[];
  blocks?: PdfDocumentTranslationSessionBlock[];
  archivedBlocks?: PdfDocumentTranslationSessionBlock[];
  replaceBlocks?: boolean;
  activity: PdfDocumentTranslationSessionActivity;
  plan?: PdfDocumentTranslationPlan;
  sourceFingerprint?: string;
}

interface StoredPdfDocumentTranslationSession
  extends PdfDocumentTranslationSessionSnapshot {
  behaviorKey: string;
}

let sessionWriteTail: Promise<void> = Promise.resolve();

function serializeSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = sessionWriteTail.catch(() => undefined).then(()=>withDocumentStorageLock(operation));
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
    Object.keys(block).every((key) => [
      'signature', 'translatedText', 'formulaReviewMessage', 'visualFallbackMessage', 'formulaReviewDraft', 'formulaDocument', 'reviewConfirmation','manualCorrection','retranslation','revisions','pageNumber','headingLevel','paperRole',
    ].includes(key)) &&
    (block.manualCorrection===undefined||block.manualCorrection===true)&&
    (block.retranslation===undefined||block.retranslation===true)&&
    (block.pageNumber===undefined||Number.isSafeInteger(block.pageNumber)&&Number(block.pageNumber)>=1&&Number(block.pageNumber)<=100_000)&&
    (block.headingLevel===undefined||[1,2,3].includes(Number(block.headingLevel)))&&
    (block.paperRole===undefined||isPdfPaperRole(block.paperRole))&&
    (block.revisions===undefined||Array.isArray(block.revisions)&&block.revisions.length<=MAX_PDF_PARAGRAPH_REVISIONS&&block.revisions.every(validParagraphRevision)&&new Set(block.revisions.map(item=>item.id)).size===block.revisions.length)&&
    (block.formulaDocument === undefined || isFormulaDocument(block.formulaDocument)) &&
    (block.reviewConfirmation === undefined || (typeof block.reviewConfirmation === 'string' && /^review-[a-f0-9]{1,8}$/u.test(block.reviewConfirmation))) &&
    (block.formulaReviewDraft === undefined ||
      (block.formulaReviewDraft === true && typeof block.formulaReviewMessage === 'string')) &&
    ['formulaReviewMessage', 'visualFallbackMessage'].every((key) => (
      block[key] === undefined || (typeof block[key] === 'string' &&
        (block[key] as string).trim().length > 0 && (block[key] as string).length <= 2_000)
    )) &&
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

export function pdfTranslationSourceCompatible(
  saved: PdfDocumentTranslationSessionSnapshot,
  documentSignatures: readonly string[],
  sourceFingerprint: string | undefined,
): boolean {
  if (saved.sourceFingerprint) return saved.sourceFingerprint === sourceFingerprint;
  return JSON.stringify(saved.documentSignatures) === JSON.stringify(documentSignatures);
}

export function reusablePdfTranslationBlocks(
  saved: PdfDocumentTranslationSessionSnapshot | undefined,
  documentSignatures: readonly string[],
  sourceFingerprint: string | undefined,
  options: {allowUpdatedDocument?: boolean} = {},
): PdfDocumentTranslationSessionBlock[] {
  if (!saved) return [];
  const sameSource = pdfTranslationSourceCompatible(saved, documentSignatures, sourceFingerprint);
  if (!sameSource && !options.allowUpdatedDocument) return [];
  const current = new Set(documentSignatures);
  // Updated documents may reuse unchanged active paragraphs at the same identity;
  // archived results require the original file fingerprint/structure gate.
  return [...saved.blocks, ...(sameSource ? saved.archivedBlocks ?? [] : [])].filter(block => current.has(block.signature));
}

export function archivedPdfTranslationBlocks(
  saved: PdfDocumentTranslationSessionSnapshot | undefined,
  documentSignatures: readonly string[],
  sourceFingerprint: string | undefined,
): PdfDocumentTranslationSessionBlock[] {
  if (!saved?.sourceFingerprint || saved.sourceFingerprint !== sourceFingerprint) return [];
  const current = new Set(documentSignatures);
  const archived = new Map((saved.archivedBlocks ?? []).map(block => [block.signature, block]));
  saved.blocks.forEach(block => archived.set(block.signature, block));
  return [...archived.values()].filter(block => !current.has(block.signature)).map(compactBlock);
}

function preservedArchive(previous: StoredPdfDocumentTranslationSession | undefined, update: PdfDocumentTranslationSessionUpdate): PdfDocumentTranslationSessionBlock[] {
  const blocks = new Map(archivedPdfTranslationBlocks(previous, update.documentSignatures, update.sourceFingerprint).map(block => [block.signature, block]));
  update.archivedBlocks?.forEach(block => blocks.set(block.signature, compactBlock(block)));
  return [...blocks.values()];
}

function validArchiveUpdate(update: PdfDocumentTranslationSessionUpdate): boolean {
  return update.archivedBlocks === undefined || (Array.isArray(update.archivedBlocks) &&
    update.archivedBlocks.length <= MAX_DOCUMENT_SIGNATURES &&
    (!update.archivedBlocks.length || Boolean(update.sourceFingerprint)) &&
    update.archivedBlocks.every(isPdfDocumentTranslationSessionBlock) &&
    new Set(update.archivedBlocks.map(block => block.signature)).size === update.archivedBlocks.length &&
    update.archivedBlocks.every(block => !update.documentSignatures.includes(block.signature)));
}

function validProgressSignatures(value: {documentSignatures: string[]; scopeSignatures?: unknown; preservedSignatures?: unknown}): boolean {
  return [value.scopeSignatures, value.preservedSignatures].every(signatures => signatures === undefined ||
    (uniqueSignatures(signatures) && signatures.every(signature => value.documentSignatures.includes(signature))));
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
    validProgressSignatures(session as unknown as PdfDocumentTranslationSessionSnapshot) &&
    Array.isArray(session.blocks) &&
    session.blocks.length <= MAX_DOCUMENT_SIGNATURES &&
    session.blocks.every(isPdfDocumentTranslationSessionBlock) &&
    session.blocks.every((block) => (
      (session.documentSignatures as string[]).includes(
        (block as PdfDocumentTranslationSessionBlock).signature,
      )
    )) &&
    new Set(session.blocks.map(block => (block as PdfDocumentTranslationSessionBlock).signature)).size === session.blocks.length &&
    (session.archivedBlocks === undefined || (
      typeof session.sourceFingerprint === 'string' &&
      Array.isArray(session.archivedBlocks) && session.archivedBlocks.length <= MAX_DOCUMENT_SIGNATURES &&
      session.archivedBlocks.every(isPdfDocumentTranslationSessionBlock) &&
      new Set(session.archivedBlocks.map(block => block.signature)).size === session.archivedBlocks.length &&
      session.archivedBlocks.every(block => !(session.documentSignatures as string[]).includes(block.signature))
    )) &&
    validActivity(session.activity) &&
    (session.sourceFingerprint === undefined || (typeof session.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/u.test(session.sourceFingerprint))) &&
    (session.plan === undefined || validPlan(session.plan)) &&
    typeof session.updatedAt === 'number' &&
    Number.isFinite(session.updatedAt) &&
    validBehaviorKey(session.behaviorKey)
  );
}

function storedSessions(value: unknown): StoredPdfDocumentTranslationSession[] {
  if (!Array.isArray(value)) return [];
  return value.filter(validStoredSession);
}

export function sanitizeRetainedPdfRecord(value:unknown):StoredPdfDocumentTranslationSession|undefined{
  if(!validStoredSession(value)||!Object.keys(value).every(key=>['documentKey','targetLanguage','sourceLanguage','style','contentMode','documentSignatures','scopeSignatures','preservedSignatures','blocks','archivedBlocks','activity','updatedAt','plan','behaviorKey','sourceFingerprint'].includes(key)))return undefined;
  return {...value,documentSignatures:[...value.documentSignatures],...(value.scopeSignatures?{scopeSignatures:[...value.scopeSignatures]}:{}),...(value.preservedSignatures?{preservedSignatures:[...value.preservedSignatures]}:{}),blocks:value.blocks.map(compactBlock),...(value.archivedBlocks?{archivedBlocks:value.archivedBlocks.map(compactBlock)}:{}),...(value.plan?{plan:clonePlan(value.plan)}:{})};
}
export async function retainedPdfRecordsForBackup():Promise<StoredPdfDocumentTranslationSession[]>{return (await readRetained()).flatMap(value=>{const record=sanitizeRetainedPdfRecord(value);return record?[record]:[]})}

function cloneSession(
  session: StoredPdfDocumentTranslationSession,
): PdfDocumentTranslationSessionSnapshot {
  const { behaviorKey: _behaviorKey, ...snapshot } = session;
  return {
    ...snapshot,
    documentSignatures: [...snapshot.documentSignatures],
    ...(snapshot.scopeSignatures ? {scopeSignatures:[...snapshot.scopeSignatures]} : {}),
    ...(snapshot.preservedSignatures ? {preservedSignatures:[...snapshot.preservedSignatures]} : {}),
    blocks: snapshot.blocks.map((block) => ({ ...block })),
    ...(snapshot.archivedBlocks ? {archivedBlocks: snapshot.archivedBlocks.map(compactBlock)} : {}),
    ...(snapshot.plan ? {plan: clonePlan(snapshot.plan)} : {}),
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
    const characters = [...session.blocks, ...(session.archivedBlocks ?? [])].reduce(
      (total, block) => total + block.translatedText.length + (block.formulaDocument ? JSON.stringify(block.formulaDocument).length : 0)+(block.revisions?JSON.stringify(block.revisions).length:0),
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

/** Only restore local task choices here. Translation reuse still requires the
 * active behavior key, and visual sending still requires the Start action. */
export function getPdfDocumentTranslationPlan(
  descriptor: PdfDocumentTranslationSessionDescriptor,
): Promise<PdfDocumentTranslationPlan | undefined> {
  return serializeSessionOperation(async () => {
    const [session, retained] = await Promise.all([readAll(), readRetained()]);
    const latest = [...session, ...retained].filter(candidate => descriptorMatches(candidate, descriptor) && candidate.plan)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return latest?.plan ? clonePlan(latest.plan) : undefined;
  });
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
    return undefined;
  });
}

export function savePdfDocumentTranslationSession(
  update: PdfDocumentTranslationSessionUpdate,
  behaviorKey: string,
): Promise<PdfDocumentTranslationSessionSnapshot> {
  if (
    !isPdfDocumentTranslationSessionDescriptor(update.descriptor) ||
    !uniqueSignatures(update.documentSignatures) || !validProgressSignatures(update) ||
    !validActivity(update.activity) || !validArchiveUpdate(update) ||
    (update.sourceFingerprint !== undefined && !/^[a-f0-9]{64}$/u.test(update.sourceFingerprint)) ||
    !validBehaviorKey(behaviorKey) ||
    (update.plan !== undefined && !validPlan(update.plan)) ||
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
    const previousRecord = sessions.find(candidate => descriptorMatches(candidate, update.descriptor));
    const previous = previousRecord?.behaviorKey === behaviorKey ? previousRecord : undefined;
    const archivedBlocks = preservedArchive(previousRecord, update);
    if (archivedBlocks.length > MAX_DOCUMENT_SIGNATURES) throw new Error('旧分段译文超过保存上限，请先备份当前文档。原记录尚未改动。');
    let blocks = update.replaceBlocks ? [] : reusablePdfTranslationBlocks(previous, update.documentSignatures, update.sourceFingerprint, {allowUpdatedDocument:true}).map(compactBlock);
    for (const block of update.blocks ?? []) {
      blocks = [
        compactBlock(withParagraphHistory(previousRecord?.blocks.find(old=>old.signature===block.signature),block,block.manualCorrection?'correction':'translation')),
        ...blocks.filter((candidate) => candidate.signature !== block.signature),
      ];
    }
    const next: StoredPdfDocumentTranslationSession = {
      ...update.descriptor,
      documentSignatures: [...update.documentSignatures],
      ...((update.scopeSignatures ?? previous?.scopeSignatures) ? {scopeSignatures: [...(update.scopeSignatures ?? previous!.scopeSignatures!)].filter(signature => documentSet.has(signature))} : {}),
      ...((update.preservedSignatures ?? previous?.preservedSignatures) ? {preservedSignatures: [...(update.preservedSignatures ?? previous!.preservedSignatures!)].filter(signature => documentSet.has(signature))} : {}),
      blocks: blocks.slice(0, MAX_DOCUMENT_SIGNATURES),
      ...(archivedBlocks.length ? {archivedBlocks} : {}),
      activity: update.activity,
      ...((update.plan ?? previous?.plan) ? {plan: clonePlan((update.plan ?? previous?.plan)!)} : {}),
      behaviorKey,
      ...((update.sourceFingerprint ?? previous?.sourceFingerprint) ? {sourceFingerprint: (update.sourceFingerprint ?? previous?.sourceFingerprint)!} : {}),
      updatedAt: Date.now(),
    };
    const retained = prunedSessions([
      next,
      ...sessions.filter((candidate) => !descriptorMatches(candidate, update.descriptor)),
    ]);
    if (!retained.includes(next)) throw new Error('会话保存空间不足，原记录尚未改动。请先导出备份。');
    await browser.storage.session.set({[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]: retained});
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
  const fixed = storedSessions(Object.values(await readFixedDocumentRecords('pdf')));
  const fixedIds = new Set(fixed.map(session=>fixedDocumentKey('pdf',session)));
  return [...fixed,...storedSessions(stored[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]).filter(session=>!fixedIds.has(fixedDocumentKey('pdf',session)))];
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
    Object.values(await readFixedDocumentRecords('pdf')).filter(validStoredSession).length,
  ));
}

export function listRetainedPdfDocumentTranslations(): Promise<PdfDocumentTranslationSessionSnapshot[]> {
  return serializeSessionOperation(async () => (await readRetained()).map(cloneSession));
}

export function saveRetainedPdfDocumentTranslationSession(
  update: PdfDocumentTranslationSessionUpdate,
  behaviorKey: string,
): Promise<PdfDocumentTranslationSessionSnapshot> {
  if (
    !isPdfDocumentTranslationSessionDescriptor(update.descriptor) ||
    !uniqueSignatures(update.documentSignatures) || !validProgressSignatures(update) ||
    !validActivity(update.activity) || !validArchiveUpdate(update) ||
    (update.sourceFingerprint !== undefined && !/^[a-f0-9]{64}$/u.test(update.sourceFingerprint)) ||
    !validBehaviorKey(behaviorKey) ||
    (update.plan !== undefined && !validPlan(update.plan)) ||
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
    const previousRecord = sessions.find(candidate => descriptorMatches(candidate, update.descriptor));
    const previous = previousRecord?.behaviorKey === behaviorKey ? previousRecord : undefined;
    const archivedBlocks = preservedArchive(previousRecord, update);
    if (archivedBlocks.length > MAX_DOCUMENT_SIGNATURES) throw new Error('旧分段译文超过保存上限，请先备份当前文档。原记录尚未改动。');
    let blocks = update.replaceBlocks ? [] : reusablePdfTranslationBlocks(previous, update.documentSignatures, update.sourceFingerprint, {allowUpdatedDocument:true}).map(compactBlock);
    for (const block of update.blocks ?? []) {
      blocks = [
        compactBlock(withParagraphHistory(previousRecord?.blocks.find(old=>old.signature===block.signature),block,block.manualCorrection?'correction':'translation')),
        ...blocks.filter((candidate) => candidate.signature !== block.signature),
      ];
    }
    const next: StoredPdfDocumentTranslationSession = {
      ...update.descriptor,
      documentSignatures: [...update.documentSignatures],
      ...((update.scopeSignatures ?? previous?.scopeSignatures) ? {scopeSignatures: [...(update.scopeSignatures ?? previous!.scopeSignatures!)].filter(signature => documentSet.has(signature))} : {}),
      ...((update.preservedSignatures ?? previous?.preservedSignatures) ? {preservedSignatures: [...(update.preservedSignatures ?? previous!.preservedSignatures!)].filter(signature => documentSet.has(signature))} : {}),
      blocks: blocks.slice(0, MAX_DOCUMENT_SIGNATURES),
      ...(archivedBlocks.length ? {archivedBlocks} : {}),
      activity: update.activity,
      ...((update.plan ?? previous?.plan) ? {plan: clonePlan((update.plan ?? previous?.plan)!)} : {}),
      behaviorKey,
      ...((update.sourceFingerprint ?? previous?.sourceFingerprint) ? {sourceFingerprint: (update.sourceFingerprint ?? previous?.sourceFingerprint)!} : {}),
      updatedAt: Date.now(),
    };
    const fixed = await readFixedDocumentRecords('pdf');
    const retained = retainDocumentSessions('pdf',[
      next,
      ...sessions.filter((candidate) => !descriptorMatches(candidate, update.descriptor)),
    ], new Set(Object.keys(fixed)), MAX_RETAINED_SESSIONS, MAX_RETAINED_TRANSLATION_CHARACTERS);
    if (!retained.includes(next)) {
      throw new Error('保存空间不足，请先取消固定或备份清理其他文档。当前会话中的译文仍可阅读。');
    }
    await browser.storage.local.set({
      [PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]: retained.filter(record=>!fixed[fixedDocumentKey('pdf',record)]),
      ...(fixed[fixedDocumentKey('pdf',next)] ? {[fixedDocumentKey('pdf',next)]:next} : {}),
    });
    return cloneSession(next);
  });
}

export function clearRetainedPdfDocumentTranslationSession(
  descriptor?: PdfDocumentTranslationSessionDescriptor,
): Promise<void> {
  return serializeSessionOperation(async () => {
    const fixed = await readFixedDocumentRecords('pdf');
    for(const [key,value] of Object.entries(fixed))if(!descriptor||(validStoredSession(value)&&descriptorMatches(value,descriptor)))await browser.storage.local.remove(key);
    if (!descriptor) {
      await browser.storage.local.remove(PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY);
      return;
    }
    const sessions = await readRetained();
    const retained = sessions.filter((candidate) => !descriptorMatches(candidate, descriptor));
    if (retained.length === sessions.length) return;
    if (retained.length) {
      await browser.storage.local.set({
        [PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]: retained.filter(record=>!fixed[fixedDocumentKey('pdf',record)]),
      });
    } else {
      await browser.storage.local.remove(PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY);
    }
  });
}

export function setRetainedPdfDocumentPinned(descriptor:PdfDocumentTranslationSessionDescriptor,pinned:boolean):Promise<void>{
  return serializeSessionOperation(async()=>{
    const sessions=await readRetained();const session=sessions.find(item=>descriptorMatches(item,descriptor));
    if(!session)throw new Error('这份译文已被移除，请刷新。');
    const key=fixedDocumentKey('pdf',session);const fixed=await readFixedDocumentRecords('pdf');
    session.updatedAt=Date.now();
    if(pinned)fixed[key]=session;else delete fixed[key];
    const retained=retainDocumentSessions('pdf',sessions,new Set(Object.keys(fixed)),MAX_RETAINED_SESSIONS,MAX_RETAINED_TRANSLATION_CHARACTERS);
    await browser.storage.local.set({[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]:retained.filter(record=>!fixed[fixedDocumentKey('pdf',record)]),...(pinned?{[key]:session}:{})});
    if(!pinned)await browser.storage.local.remove(key);
  });
}
