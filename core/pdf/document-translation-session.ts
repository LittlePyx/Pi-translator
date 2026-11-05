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
import {previewPdfTermCorrection} from './term-consistency';

export const PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY =
  'pdfDocumentTranslationSessionsV1';
export const PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY =
  'pdfDocumentTranslationRetainedV1';
export const PDF_REPAIR_GUARD_KEY = 'pdfFormulaRepairGuardV1';
export const PDF_REPAIR_ARCHIVE_KEY = 'pdfFormulaRepairArchivesV1';
export const MAX_PDF_REPAIR_ARCHIVES = 100;
export const MAX_PDF_REPAIR_ARCHIVE_BYTES = 3_000_000;
export interface PdfRepairArchive {id:string;fingerprint:string;descriptor:PdfDocumentTranslationSessionDescriptor;behaviorKey:string;signature:string;createdAt:number;session:PdfDocumentTranslationSessionBlock;local:PdfDocumentTranslationSessionBlock;visible:PdfDocumentTranslationSessionBlock}
export function normalizePdfRepairArchives(value:unknown):PdfRepairArchive[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>MAX_PDF_REPAIR_ARCHIVES||new TextEncoder().encode(JSON.stringify(value)).length>MAX_PDF_REPAIR_ARCHIVE_BYTES)throw new Error('修复版本存档无效或超过容量，原资料未改变。');
  const ids=new Set<string>();
  for(const item of value){
    if(!item||typeof item!=='object'||Object.keys(item).some(key=>!['id','fingerprint','descriptor','behaviorKey','signature','createdAt','session','local','visible'].includes(key))||typeof item.id!=='string'||!/^archive-[a-z0-9-]{1,80}$/u.test(item.id)||ids.has(item.id)||typeof item.fingerprint!=='string'||!/^[a-f0-9]{64}$/u.test(item.fingerprint)||!isPdfDocumentTranslationSessionDescriptor(item.descriptor)||!validBehaviorKey(item.behaviorKey)||typeof item.signature!=='string'||!item.signature||!Number.isSafeInteger(item.createdAt)||item.createdAt<0||!['session','local','visible'].every(key=>isPdfDocumentTranslationSessionBlock(item[key])&&item[key].signature===item.signature))throw new Error('修复版本存档无效或超过容量，原资料未改变。');
    ids.add(item.id);
  }
  return structuredClone(value);
}
export function mergePdfRepairArchives(local:unknown,incoming:unknown):PdfRepairArchive[]{
  const combined=normalizePdfRepairArchives(local),ids=new Map(combined.map(item=>[item.id,item]));
  for(const item of normalizePdfRepairArchives(incoming)){const old=ids.get(item.id);if(old&&repairVersion(old)!==repairVersion(item))throw new Error('修复版本存档冲突，请保留两份备份。');if(!old){combined.push(item);ids.set(item.id,item)}}
  return normalizePdfRepairArchives(combined);
}
export async function listPdfRepairArchives(fingerprint:string,signature?:string):Promise<PdfRepairArchive[]>{
  const data=await browser.storage.local.get(PDF_REPAIR_ARCHIVE_KEY);return normalizePdfRepairArchives(data[PDF_REPAIR_ARCHIVE_KEY]).filter(item=>item.fingerprint===fingerprint&&(!signature||item.signature===signature));
}
export async function pdfRepairArchiveCapacity(fingerprint:string):Promise<{count:number;bytes:number;documentCount:number}>{
  const data=await browser.storage.local.get(PDF_REPAIR_ARCHIVE_KEY),archives=normalizePdfRepairArchives(data[PDF_REPAIR_ARCHIVE_KEY]);
  return {count:archives.length,bytes:new TextEncoder().encode(JSON.stringify(archives)).length,documentCount:archives.filter(item=>item.fingerprint===fingerprint).length};
}
interface PdfRepairGuard { fingerprint:string; documentKey:string; signature:string; descriptor:PdfDocumentTranslationSessionDescriptor; behaviorKey:string; }
async function readRepairGuards():Promise<Record<string,PdfRepairGuard>>{
  const data=await browser.storage.local.get(PDF_REPAIR_GUARD_KEY),raw=data[PDF_REPAIR_GUARD_KEY];
  if(raw===undefined)return {};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('无法核对正文修复状态。');
  const entries=Object.entries(raw);
  if(entries.length>100||entries.some(([key,value])=>!value||typeof value!=='object'||!/^[a-f0-9]{64}$/u.test(key)||(value as PdfRepairGuard).fingerprint!==key||!validDocumentKey((value as PdfRepairGuard).documentKey)||typeof (value as PdfRepairGuard).signature!=='string'||!(value as PdfRepairGuard).signature||!isPdfDocumentTranslationSessionDescriptor((value as PdfRepairGuard).descriptor)||(value as PdfRepairGuard).descriptor.documentKey!==(value as PdfRepairGuard).documentKey||!validBehaviorKey((value as PdfRepairGuard).behaviorKey)))throw new Error('无法核对正文修复状态。');
  return raw as Record<string,PdfRepairGuard>;
}
export async function getPdfRepairGuard(fingerprint:string):Promise<PdfRepairGuard|undefined>{
  const guards=await readRepairGuards();return guards[fingerprint];
}
async function assertNoRepairGuard(descriptor?:PdfDocumentTranslationSessionDescriptor,fingerprint?:string):Promise<void>{
  const guards=await readRepairGuards();
  if(Object.values(guards).some(guard=>!descriptor||guard.documentKey===descriptor.documentKey||Boolean(fingerprint&&guard.fingerprint===fingerprint)))throw new Error('正文修复保存状态待核对，暂不能修改这份译文。');
}
async function writeRepairGuards(guards:Record<string,PdfRepairGuard>):Promise<void>{
  if(Object.keys(guards).length)await browser.storage.local.set({[PDF_REPAIR_GUARD_KEY]:guards});else await browser.storage.local.remove(PDF_REPAIR_GUARD_KEY);
}

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
    await assertNoRepairGuard(update.descriptor,update.sourceFingerprint);
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
    await assertNoRepairGuard(descriptor);
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

/** A short-lived snapshot for a user-initiated formula repair. Never persisted. */
export interface PdfRepairStorageSnapshot {
  descriptor:PdfDocumentTranslationSessionDescriptor; behaviorKey:string; signature:string; retain:boolean;
  sessionRaw:unknown; localRaw:unknown; fixedRaw:unknown; termsRaw:unknown; settingsRaw:unknown;
}
function repairLockRequired():void{
  if(typeof navigator==='undefined'||!navigator.locks)throw new Error('无法安全核对其他窗口，请稍后重试。');
}
function repairBlock(record:unknown,descriptor:PdfDocumentTranslationSessionDescriptor,behaviorKey:string,signature:string):PdfDocumentTranslationSessionBlock|undefined{
  if(!validStoredSession(record)||!descriptorMatches(record,descriptor)||record.behaviorKey!==behaviorKey)return undefined;
  return record.blocks.find(block=>block.signature===signature);
}
function matchingRepairRecord(raw:unknown,descriptor:PdfDocumentTranslationSessionDescriptor):unknown{
  if(!Array.isArray(raw))return undefined;
  const matches=raw.filter(record=>record&&typeof record==='object'&&descriptorMatches(record as PdfDocumentTranslationSessionDescriptor,descriptor));
  return matches.length===1?matches[0]:undefined;
}
function repairVersion(value:unknown):string{
  const ordered=(item:unknown):unknown=>Array.isArray(item)?item.map(ordered):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,ordered(entry)])):item;
  return JSON.stringify(ordered(value))??'undefined';
}
/** Classify differences without relying on revision counts or object key order. */
export function pdfRepairVersionDifferences(left:PdfDocumentTranslationSessionBlock,right:PdfDocumentTranslationSessionBlock):Array<'text'|'formula'|'manual'|'history'|'review'|'other'> {
  const different=(a:unknown,b:unknown)=>repairVersion(a)!==repairVersion(b);
  const differences:Array<'text'|'formula'|'manual'|'history'|'review'|'other'>=[];
  if(different(left.translatedText,right.translatedText))differences.push('text');
  if(different(left.formulaDocument,right.formulaDocument))differences.push('formula');
  if(different(left.manualCorrection,right.manualCorrection))differences.push('manual');
  if(different(left.revisions,right.revisions))differences.push('history');
  if(['reviewConfirmation','formulaReviewMessage','formulaReviewDraft','visualFallbackMessage'].some(key=>different(left[key as keyof PdfDocumentTranslationSessionBlock],right[key as keyof PdfDocumentTranslationSessionBlock])))differences.push('review');
  if(!differences.length&&different(compactBlock(left),compactBlock(right)))differences.push('other');
  return differences;
}
async function readRepairSnapshot(descriptor:PdfDocumentTranslationSessionDescriptor,behaviorKey:string,signature:string,retain:boolean):Promise<PdfRepairStorageSnapshot>{
  const fixedKey=fixedDocumentKey('pdf',descriptor);
  try{
    const [session,local]=await Promise.all([browser.storage.session.get(PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY),browser.storage.local.get([PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,fixedKey,'documentTranslationMemoryV1','extensionSettings'])]);
    return {descriptor,behaviorKey,signature,retain,sessionRaw:session[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY],localRaw:local[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY],fixedRaw:local[fixedKey],termsRaw:local.documentTranslationMemoryV1,settingsRaw:local.extensionSettings};
  }catch{throw new Error('暂时无法核对本机资料，修复未保存。')}
}
function repairRecords(snapshot:PdfRepairStorageSnapshot):{session:StoredPdfDocumentTranslationSession;local:StoredPdfDocumentTranslationSession|undefined;fixed:boolean}{
  const session=matchingRepairRecord(snapshot.sessionRaw,snapshot.descriptor);
  const listed=matchingRepairRecord(snapshot.localRaw,snapshot.descriptor);
  if(snapshot.fixedRaw!==undefined&&listed!==undefined)throw new Error('本机资料存在重复版本，请先检查资料库。');
  const local=snapshot.fixedRaw??listed;
  if(!validStoredSession(session)||!repairBlock(session,snapshot.descriptor,snapshot.behaviorKey,snapshot.signature)||
     (local!==undefined&&(!validStoredSession(local)||!repairBlock(local,snapshot.descriptor,snapshot.behaviorKey,snapshot.signature)))||
     (snapshot.retain&&local===undefined)||(!snapshot.retain&&local!==undefined))throw new Error('本段保存状态已变化，请重新打开核对。');
  return {session,local:local as StoredPdfDocumentTranslationSession|undefined,fixed:snapshot.fixedRaw!==undefined};
}
function relevantRepairVersion(record:StoredPdfDocumentTranslationSession|undefined,signature:string):string{
  return repairVersion(record&&{behaviorKey:record.behaviorKey,sourceFingerprint:record.sourceFingerprint,documentSignatures:record.documentSignatures,scopeSignatures:record.scopeSignatures,preservedSignatures:record.preservedSignatures,block:record.blocks.find(block=>block.signature===signature)});
}
export function capturePdfRepairStorage(descriptor:PdfDocumentTranslationSessionDescriptor,behaviorKey:string,signature:string,expected:PdfDocumentTranslationSessionBlock,retain:boolean,sourceFingerprint?:string):Promise<PdfRepairStorageSnapshot>{
  repairLockRequired();
  return serializeSessionOperation(async()=>{
    const snapshot=await readRepairSnapshot(descriptor,behaviorKey,signature,retain),records=repairRecords(snapshot);
    if(sourceFingerprint&&(records.session.sourceFingerprint!==sourceFingerprint||records.local&&records.local.sourceFingerprint!==sourceFingerprint))throw new Error('本段保存状态已变化，请重新打开核对。');
    await assertNoRepairGuard(descriptor,records.session.sourceFingerprint);
    const current=[records.session,...(records.local?[records.local]:[])].map(record=>repairBlock(record,descriptor,behaviorKey,signature)!);
    if(current.some(block=>block.manualCorrection||block.retranslation||repairVersion(paragraphValue(block))!==repairVersion(paragraphValue(expected))))throw new Error('本段已在其他窗口变化，请重新打开核对。');
    return snapshot;
  });
}
/** Read-only recovery: only unblock when both saved copies agree with the
 * visible passage. Do not choose or overwrite either copy. */
export function verifyPdfRepairStorage(descriptor:PdfDocumentTranslationSessionDescriptor,behaviorKey:string,signature:string,expected:PdfDocumentTranslationSessionBlock,retain:boolean):Promise<boolean>{
  repairLockRequired();
  return serializeSessionOperation(async()=>{
    const snapshot=await readRepairSnapshot(descriptor,behaviorKey,signature,retain),records=repairRecords(snapshot);
    return [records.session,...(records.local?[records.local]:[])].every(record=>repairVersion(compactBlock(repairBlock(record,descriptor,behaviorKey,signature)!))===repairVersion(compactBlock(expected)));
  });
}
/** Return saved versions for display only; no data is changed. */
function inspectRepairRecords(snapshot:PdfRepairStorageSnapshot):{session?:PdfDocumentTranslationSessionBlock;local?:PdfDocumentTranslationSessionBlock}{
  const session=matchingRepairRecord(snapshot.sessionRaw,snapshot.descriptor),listed=matchingRepairRecord(snapshot.localRaw,snapshot.descriptor);
  if(snapshot.fixedRaw!==undefined&&listed!==undefined)throw new Error('本机资料存在重复版本，请先检查资料库。');
  const local=snapshot.fixedRaw??listed;
  const sessionBlock=session===undefined?undefined:repairBlock(session,snapshot.descriptor,snapshot.behaviorKey,snapshot.signature);
  const localBlock=local===undefined?undefined:repairBlock(local,snapshot.descriptor,snapshot.behaviorKey,snapshot.signature);
  if((session!==undefined&&!sessionBlock)||(local!==undefined&&!localBlock)||(snapshot.retain&&!localBlock)||(!snapshot.retain&&(!sessionBlock||local!==undefined)))throw new Error('本段保存状态已变化，请重新打开核对。');
  return {...(sessionBlock?{session:sessionBlock}:{}),...(localBlock?{local:localBlock}:{})};
}
export function inspectPdfRepairStorage(descriptor:PdfDocumentTranslationSessionDescriptor,behaviorKey:string,signature:string,expected:PdfDocumentTranslationSessionBlock,retain:boolean):Promise<{consistent:boolean;session?:PdfDocumentTranslationSessionBlock;local?:PdfDocumentTranslationSessionBlock}>{
  repairLockRequired();
  return serializeSessionOperation(async()=>{
    const snapshot=await readRepairSnapshot(descriptor,behaviorKey,signature,retain),records=inspectRepairRecords(snapshot);
    const session=records.session?structuredClone(records.session):undefined,local=records.local?structuredClone(records.local):undefined;
    const consistent=[...(session?[session]:[]),...(local?[local]:[])].every(block=>repairVersion(compactBlock(block))===repairVersion(compactBlock(expected)));
    return {consistent,...(session?{session}:{}),...(local?{local}:{})};
  });
}
export function confirmPdfRepairStorage(descriptor:PdfDocumentTranslationSessionDescriptor,behaviorKey:string,signature:string,expected:PdfDocumentTranslationSessionBlock,retain:boolean,fingerprint:string,isCurrent:()=>boolean):Promise<boolean>{
  repairLockRequired();
  return serializeSessionOperation(async()=>{
    const guards=await readRepairGuards(),guard=guards[fingerprint];
    if(guard&&(!descriptorMatches(guard.descriptor,descriptor)||guard.behaviorKey!==behaviorKey||guard.signature!==signature))return false;
    const snapshot=await readRepairSnapshot(descriptor,behaviorKey,signature,retain),records=inspectRepairRecords(snapshot);
    const consistent=[...(records.session?[records.session]:[]),...(records.local?[records.local]:[])].every(block=>repairVersion(compactBlock(block))===repairVersion(compactBlock(expected)));
    if(!consistent||!isCurrent())return false;
    if(guard){const next={...guards};delete next[fingerprint];await writeRepairGuards(next)}
    return true;
  });
}
/** Save both divergent versions before replacing either, then keep the guard
 * until both stores have been verified. Caller supplies the preview snapshot. */
export function resolvePdfRepairConflict(descriptor:PdfDocumentTranslationSessionDescriptor,behaviorKey:string,signature:string,fingerprint:string,visible:PdfDocumentTranslationSessionBlock,preview:{session:PdfDocumentTranslationSessionBlock;local:PdfDocumentTranslationSessionBlock},choice:'session'|'local',isCurrent:()=>boolean,restore?:{archive:PdfRepairArchive;branch:'session'|'local'|'visible'}):Promise<{status:'saved';block:PdfDocumentTranslationSessionBlock}|{status:'conflict'|'failed'|'uncertain'}>{
  repairLockRequired();
  return serializeSessionOperation(async()=>{
    const guards=await readRepairGuards(),guard=guards[fingerprint];
    if(!guard||!descriptorMatches(guard.descriptor,descriptor)||guard.behaviorKey!==behaviorKey||guard.signature!==signature||!isCurrent())return {status:'conflict'};
    const snapshot=await readRepairSnapshot(descriptor,behaviorKey,signature,true);let records:ReturnType<typeof repairRecords>;
    try{records=repairRecords(snapshot)}catch{return {status:'conflict'}}
    const session=repairBlock(records.session,descriptor,behaviorKey,signature),local=repairBlock(records.local,descriptor,behaviorKey,signature);
    if(!session||!local||records.session.sourceFingerprint!==fingerprint||records.local?.sourceFingerprint!==fingerprint||repairVersion(compactBlock(session))!==repairVersion(compactBlock(preview.session))||repairVersion(compactBlock(local))!==repairVersion(compactBlock(preview.local))||!isPdfDocumentTranslationSessionBlock(visible)||visible.signature!==signature||!isCurrent())return {status:'conflict'};
    const raw=(await browser.storage.local.get(PDF_REPAIR_ARCHIVE_KEY))[PDF_REPAIR_ARCHIVE_KEY];let previous:PdfRepairArchive[];
    try{previous=normalizePdfRepairArchives(raw)}catch{return {status:'failed'}}
    if(restore&&(!previous.some(item=>repairVersion(item)===repairVersion(restore.archive))||restore.archive.fingerprint!==fingerprint||restore.archive.signature!==signature||restore.archive.behaviorKey!==behaviorKey||!descriptorMatches(restore.archive.descriptor,descriptor)))return {status:'conflict'};
    const selected=structuredClone(restore?restore.archive[restore.branch]:choice==='session'?session:local),now=Date.now(),archive:PdfRepairArchive={id:`archive-${crypto.randomUUID()}`,fingerprint,descriptor:structuredClone(descriptor),behaviorKey,signature,createdAt:now,session:structuredClone(session),local:structuredClone(local),visible:structuredClone(visible)};
    let archives:PdfRepairArchive[];try{archives=normalizePdfRepairArchives([...previous,archive])}catch{return {status:'failed'}}
    const replace=(record:StoredPdfDocumentTranslationSession)=>({...record,updatedAt:now,blocks:record.blocks.map(block=>block.signature===signature?compactBlock(selected):block)});
    const nextSession=(snapshot.sessionRaw as unknown[]).map(item=>item===records.session?replace(records.session):item),fixedKey=fixedDocumentKey('pdf',descriptor);
    const nextLocal:Record<string,unknown>=records.fixed?{[fixedKey]:replace(records.local!)}:{[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]:(snapshot.localRaw as unknown[]).map(item=>item===records.local?replace(records.local!):item)};
    try{
      const sessions=storedSessions(nextSession);if(prunedSessions(sessions).length!==sessions.length)return {status:'failed'};
      const fixed=await readFixedDocumentRecords('pdf'),fixedRecords=storedSessions(Object.values({...fixed,...(records.fixed?nextLocal:{})})),fixedIds=new Set(fixedRecords.map(item=>fixedDocumentKey('pdf',item)));
      const listed=storedSessions(records.fixed?snapshot.localRaw:nextLocal[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]).filter(item=>!fixedIds.has(fixedDocumentKey('pdf',item))),all=[...fixedRecords,...listed];
      if(retainDocumentSessions('pdf',all,fixedIds,MAX_RETAINED_SESSIONS,MAX_RETAINED_TRANSLATION_CHARACTERS).length!==all.length)return {status:'failed'};
    }catch{return {status:'failed'}}
    if(!isCurrent())return {status:'conflict'};
    try{await browser.storage.local.set({[PDF_REPAIR_ARCHIVE_KEY]:archives});const check=normalizePdfRepairArchives((await browser.storage.local.get(PDF_REPAIR_ARCHIVE_KEY))[PDF_REPAIR_ARCHIVE_KEY]);if(!check.some(item=>repairVersion(item)===repairVersion(archive)))return {status:'uncertain'}}catch{return {status:'uncertain'}}
    if(!isCurrent())return {status:'conflict'};
    const restoreStorage=async(area:typeof browser.storage.local,key:string,value:unknown)=>{if(value===undefined)await area.remove(key);else await area.set({[key]:value})};
    try{
      await browser.storage.local.set(nextLocal);if(!isCurrent())throw new Error('cancelled');
      await browser.storage.session.set({[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]:nextSession});if(!isCurrent())throw new Error('cancelled');
      const verified=inspectRepairRecords(await readRepairSnapshot(descriptor,behaviorKey,signature,true));
      if(!verified.session||!verified.local||repairVersion(compactBlock(verified.session))!==repairVersion(compactBlock(selected))||repairVersion(compactBlock(verified.local))!==repairVersion(compactBlock(selected)))throw new Error('verification failed');
      const kept=normalizePdfRepairArchives((await browser.storage.local.get(PDF_REPAIR_ARCHIVE_KEY))[PDF_REPAIR_ARCHIVE_KEY]);if(!kept.some(item=>repairVersion(item)===repairVersion(archive))||!isCurrent())throw new Error('archive changed');
      const nextGuards={...guards};delete nextGuards[fingerprint];await writeRepairGuards(nextGuards);return {status:'saved',block:selected};
    }catch{
      try{await writeRepairGuards(guards);await restoreStorage(browser.storage.local,records.fixed?fixedKey:PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,records.fixed?snapshot.fixedRaw:snapshot.localRaw);await restoreStorage(browser.storage.session,PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY,snapshot.sessionRaw);return {status:'failed'}}catch{return {status:'uncertain'}}
    }
  });
}
/** Establish a guard only after the current session and retained copy still
 * match the displayed passage. The ordinary resolver does the actual write. */
export function beginPdfArchivedRestore(descriptor:PdfDocumentTranslationSessionDescriptor,behaviorKey:string,signature:string,fingerprint:string,expected:PdfDocumentTranslationSessionBlock,isCurrent:()=>boolean):Promise<{status:'ready';preview:{session:PdfDocumentTranslationSessionBlock;local:PdfDocumentTranslationSessionBlock}}|{status:'conflict'|'uncertain'}>{
  repairLockRequired();return serializeSessionOperation(async()=>{
    const guards=await readRepairGuards();if(guards[fingerprint]||Object.values(guards).some(guard=>guard.documentKey===descriptor.documentKey)||Object.keys(guards).length>=100||!isCurrent())return {status:'conflict'};
    const snapshot=await readRepairSnapshot(descriptor,behaviorKey,signature,true);let records:ReturnType<typeof repairRecords>;try{records=repairRecords(snapshot)}catch{return {status:'conflict'}}
    const session=repairBlock(records.session,descriptor,behaviorKey,signature),local=repairBlock(records.local,descriptor,behaviorKey,signature);
    if(!session||!local||records.session.sourceFingerprint!==fingerprint||records.local?.sourceFingerprint!==fingerprint||repairVersion(compactBlock(session))!==repairVersion(compactBlock(expected))||repairVersion(compactBlock(local))!==repairVersion(compactBlock(expected))||!isCurrent())return {status:'conflict'};
    try{await writeRepairGuards({...guards,[fingerprint]:{fingerprint,documentKey:descriptor.documentKey,signature,descriptor,behaviorKey}})}catch{return {status:'uncertain'}}
    return {status:'ready',preview:{session:structuredClone(session),local:structuredClone(local)}};
  });
}
export function samePdfRepairInputs(left:PdfRepairStorageSnapshot,right:PdfRepairStorageSnapshot):boolean{
  return repairVersion(left.termsRaw)===repairVersion(right.termsRaw)&&repairVersion(left.settingsRaw)===repairVersion(right.settingsRaw);
}
/** Compare both storage snapshots under the shared lock; restore exact previous
 * values on a failed write and report if rollback cannot be established. */
export function commitPdfRepairStorage(snapshot:PdfRepairStorageSnapshot,replacement:PdfDocumentTranslationSessionBlock,isCurrent:()=>boolean=()=>true):Promise<{status:'saved';block:PdfDocumentTranslationSessionBlock}|{status:'conflict'|'failed'|'uncertain'}>{
  return commitPdfParagraphStorage(snapshot,replacement,isCurrent,false);
}
export function commitPdfTermCorrection(snapshot:PdfRepairStorageSnapshot,from:string,to:string,isCurrent:()=>boolean):ReturnType<typeof commitPdfRepairStorage>{
  const previous=repairBlock(repairRecords(snapshot).session,snapshot.descriptor,snapshot.behaviorKey,snapshot.signature)!;
  const value=previewPdfTermCorrection(previous,from,to);
  const replacement={...previous,...value,manualCorrection:true as const};delete replacement.reviewConfirmation;
  return commitPdfParagraphStorage(snapshot,replacement,isCurrent,true);
}
function commitPdfParagraphStorage(snapshot:PdfRepairStorageSnapshot,replacement:PdfDocumentTranslationSessionBlock,isCurrent:()=>boolean,manual:boolean):Promise<{status:'saved';block:PdfDocumentTranslationSessionBlock}|{status:'conflict'|'failed'|'uncertain'}>{
  repairLockRequired();
  if(!isPdfDocumentTranslationSessionBlock(replacement)||replacement.signature!==snapshot.signature||Boolean(replacement.manualCorrection)!==manual||replacement.retranslation)throw new Error('无效的正文修复结果。');
  return serializeSessionOperation(async()=>{
    const latest=await readRepairSnapshot(snapshot.descriptor,snapshot.behaviorKey,snapshot.signature,snapshot.retain);
    if(!isCurrent()||repairVersion(latest.termsRaw)!==repairVersion(snapshot.termsRaw)||repairVersion(latest.settingsRaw)!==repairVersion(snapshot.settingsRaw))return {status:'conflict'};
    let records:ReturnType<typeof repairRecords>,before:ReturnType<typeof repairRecords>;
    try{records=repairRecords(latest);before=repairRecords(snapshot)}catch{return {status:'conflict'}}
    if(records.fixed!==before.fixed||relevantRepairVersion(records.session,snapshot.signature)!==relevantRepairVersion(before.session,snapshot.signature)||relevantRepairVersion(records.local,snapshot.signature)!==relevantRepairVersion(before.local,snapshot.signature))return {status:'conflict'};
    const fixedKey=fixedDocumentKey('pdf',snapshot.descriptor);
    const replace=(record:StoredPdfDocumentTranslationSession):StoredPdfDocumentTranslationSession=>({...record,updatedAt:Date.now(),blocks:record.blocks.map(block=>block.signature===snapshot.signature?compactBlock(withParagraphHistory(block,{...replacement,...(block.revisions?{revisions:block.revisions}:{})},manual?'correction':'translation')):block)});
    const updatedSession=replace(records.session),nextSession=(latest.sessionRaw as unknown[]).map(record=>record===records.session?updatedSession:record);
    let updatedLocal=records.local&&snapshot.retain?replace(records.local):undefined;
    if(updatedLocal){
      const sessionBlock=updatedSession.blocks.find(block=>block.signature===snapshot.signature),localBlock=updatedLocal.blocks.find(block=>block.signature===snapshot.signature);
      const sessionRevision=sessionBlock?.revisions?.[0],localRevision=localBlock?.revisions?.[0];
      const previousSession=records.session.blocks.find(block=>block.signature===snapshot.signature),previousLocal=records.local?.blocks.find(block=>block.signature===snapshot.signature);
      if(sessionRevision&&localRevision&&!previousSession?.revisions?.some(item=>item.id===sessionRevision.id)&&!previousLocal?.revisions?.some(item=>item.id===localRevision.id)&&sessionRevision.reason===localRevision.reason&&repairVersion(paragraphValue(sessionRevision))===repairVersion(paragraphValue(localRevision))){
        const shared={...localRevision,id:sessionRevision.id,createdAt:sessionRevision.createdAt};
        updatedLocal={...updatedLocal,blocks:updatedLocal.blocks.map(block=>block.signature===snapshot.signature&&block.revisions?{...block,revisions:[shared,...block.revisions.slice(1)]}:block)};
      }
    }
    const nextLocal:Record<string,unknown>|undefined=updatedLocal?(records.fixed?{[fixedKey]:updatedLocal}:{[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]:(latest.localRaw as unknown[]).map(record=>record===records.local?updatedLocal:record)}):undefined;
    const restore=async(area:typeof browser.storage.local,key:string,value:unknown)=>{if(value===undefined)await area.remove(key);else await area.set({[key]:value})};
    // Never let a repair exceed the existing retention limits or evict other
    // records as a side effect. A full store leaves the old data untouched.
    try{
      const validSession=storedSessions(nextSession);
      if(prunedSessions(validSession).length!==validSession.length)return {status:'failed'};
      if(nextLocal){
        const fixed=await readFixedDocumentRecords('pdf');
        const fixedRecords=storedSessions(Object.values({...fixed,...(records.fixed?nextLocal:{})}));
        const fixedIds=new Set(fixedRecords.map(item=>fixedDocumentKey('pdf',item)));
        const listed=storedSessions(records.fixed?latest.localRaw:nextLocal[PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY]).filter(item=>!fixedIds.has(fixedDocumentKey('pdf',item)));
        const all=[...fixedRecords,...listed];
        if(retainDocumentSessions('pdf',all,fixedIds,MAX_RETAINED_SESSIONS,MAX_RETAINED_TRANSLATION_CHARACTERS).length!==all.length)return {status:'failed'};
      }
    }catch{return {status:'failed'}}
    if(!isCurrent())return {status:'conflict'};
    const fingerprint=records.session.sourceFingerprint;
    if(!fingerprint)return {status:'failed'};
    const guards=await readRepairGuards();
    if(Object.keys(guards).length>=100||guards[fingerprint]||Object.values(guards).some(guard=>guard.documentKey===snapshot.descriptor.documentKey))return {status:'conflict'};
    try{await writeRepairGuards({...guards,[fingerprint]:{fingerprint,documentKey:snapshot.descriptor.documentKey,signature:snapshot.signature,descriptor:snapshot.descriptor,behaviorKey:snapshot.behaviorKey}})}catch{return {status:'uncertain'}}
    try{
      if(nextLocal)await browser.storage.local.set(nextLocal);
      if(!isCurrent())throw new Error('修复已取消。');
      await browser.storage.session.set({[PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY]:nextSession});
      if(!isCurrent())throw new Error('修复已取消。');
      await writeRepairGuards(guards);
      return {status:'saved',block:updatedSession.blocks.find(block=>block.signature===snapshot.signature)!};
    }catch{
      try{
        if(nextLocal)await restore(browser.storage.local,records.fixed?fixedKey:PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,records.fixed?latest.fixedRaw:latest.localRaw);
        await restore(browser.storage.session,PDF_DOCUMENT_TRANSLATION_SESSIONS_STORAGE_KEY,latest.sessionRaw);
        await writeRepairGuards(guards);
        return {status:'failed'};
      }catch{return {status:'uncertain'}}
    }
  });
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
    await assertNoRepairGuard(update.descriptor,update.sourceFingerprint);
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
    await assertNoRepairGuard(descriptor);
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
    await assertNoRepairGuard(descriptor);
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
