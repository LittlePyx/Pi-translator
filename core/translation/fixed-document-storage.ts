export type RetainedDocumentKind = 'pdf' | 'web';
export interface RetainedDocumentIdentity {
  targetLanguage: string; sourceLanguage: string; style: string; contentMode: string;
  documentKey?: string; pageKey?: string;
}
const FIXED_PREFIX = 'fixedDocumentTranslationV1:';
export const RETAINED_DOCUMENT_BYTES_PER_KIND = 3_000_000;
export interface RetainedDocumentStorageContent {
  blocks: readonly {translatedText:string;formulaDocument?:unknown;revisions?:unknown}[];
  archivedBlocks?: readonly {translatedText:string;formulaDocument?:unknown;revisions?:unknown}[];
}
/** The same budget for retention decisions and library capacity reporting. */
export function retainedDocumentStorageCost(session: RetainedDocumentStorageContent): {translationCharacters:number;capacityCharacters:number;estimatedBytes:number} {
  let translationCharacters=0,capacityCharacters=0;
  for(const block of [...session.blocks,...(session.archivedBlocks??[])]){
    translationCharacters+=block.translatedText.length;
    capacityCharacters+=block.translatedText.length+
      (block.formulaDocument?JSON.stringify(block.formulaDocument).length:0)+
      (block.revisions?JSON.stringify(block.revisions).length:0);
  }
  return {translationCharacters,capacityCharacters,estimatedBytes:new TextEncoder().encode(JSON.stringify(session)).byteLength};
}
export function retainedDocumentId(kind: RetainedDocumentKind, session: RetainedDocumentIdentity): string {
  return JSON.stringify([kind, kind === 'pdf' ? session.documentKey : session.pageKey,
    session.targetLanguage, session.sourceLanguage, session.style, session.contentMode]);
}
export function fixedDocumentKey(kind: RetainedDocumentKind, session: RetainedDocumentIdentity): string {
  return FIXED_PREFIX + retainedDocumentId(kind, session);
}
export async function readFixedDocumentRecords(kind: RetainedDocumentKind): Promise<Record<string, unknown>> {
  const stored = await browser.storage.local.get(null);
  return Object.fromEntries(Object.entries(stored).filter(([key]) => key.startsWith(`${FIXED_PREFIX}["${kind}",`)));
}
/** Fixed copies have individual keys, so rolling-cache writes cannot evict them. */
export function retainDocumentSessions<T extends RetainedDocumentIdentity & {updatedAt:number;blocks:readonly {translatedText:string;formulaDocument?:unknown}[];archivedBlocks?:readonly {translatedText:string;formulaDocument?:unknown}[]}>(
  kind: RetainedDocumentKind, sessions: readonly T[], fixedKeys: ReadonlySet<string>, maximumDocuments:number, maximumCharacters:number,
): T[] {
  const costs=new Map(sessions.map(session=>[session,retainedDocumentStorageCost(session)]));
  const ordered=[...sessions].sort((a,b)=>b.updatedAt-a.updatedAt);
  const fixed=ordered.filter(session=>fixedKeys.has(fixedDocumentKey(kind,session)));
  let characters=fixed.reduce((total,session)=>total+costs.get(session)!.capacityCharacters,0);
  let storedBytes = fixed.reduce((total,session)=>total+costs.get(session)!.estimatedBytes,0);
  if(characters>maximumCharacters||storedBytes>RETAINED_DOCUMENT_BYTES_PER_KIND)throw new Error('固定文档已达到保存容量上限，请先备份或清理后再保存。');
  const retained=[...fixed];
  let recentCount=0;
  for(const session of ordered){
    if(fixed.includes(session))continue;
    const {capacityCharacters:size,estimatedBytes:byteSize}=costs.get(session)!;
    if(recentCount>=maximumDocuments||characters+size>maximumCharacters||storedBytes+byteSize>RETAINED_DOCUMENT_BYTES_PER_KIND)continue;
    retained.push(session);characters+=size;storedBytes+=byteSize;recentCount++;
  }
  return retained;
}
