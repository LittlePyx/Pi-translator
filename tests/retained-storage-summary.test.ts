import { describe, expect, it } from 'vitest';
import { summarizeRetainedTranslationStorage } from '../core/translation/retained-storage-summary';
import {fixedDocumentKey,retainDocumentSessions,retainedDocumentStorageCost} from '../core/translation/fixed-document-storage';

describe('retained translation storage summary', () => {
  it('counts only translated output and reports the newest anonymous record', () => {
    const sessions = [
      {
        updatedAt: 120,
        blocks: [{ translatedText: '第一段' }, { translatedText: '第二段译文' }],
      },
      {
        updatedAt: 240,
        blocks: [{ translatedText: 'PDF translation' }],
      },
    ];
    const summary = summarizeRetainedTranslationStorage(
      sessions,
      'retainedV1',
      6,
      1_000_000,
    );

    expect(summary).toMatchObject({
      documentCount: 2,
      translationCharacters: 23,
      maximumDocuments: 6,
      maximumTranslationCharacters: 1_000_000,
      nearingCapacity: false,
      fixedDocuments:0,recentDocuments:2,
      newestUpdatedAt: 240,
    });
    expect(summary.estimatedBytes).toBeGreaterThan(0);
  });

  it('uses zero space for an absent store and warns near either limit', () => {
    expect(summarizeRetainedTranslationStorage([], 'retainedV1', 6, 100)).toEqual({
      documentCount: 0,
      fixedDocuments:0,recentDocuments:0,
      translationCharacters: 0,
      capacityCharacters: 0,
      estimatedBytes: 0,
      maximumBytes: 3_000_000,
      maximumDocuments: 6,
      maximumTranslationCharacters: 100,
      nearingCapacity: false,
    });
    expect(summarizeRetainedTranslationStorage([
      { updatedAt: 1, blocks: [{ translatedText: 'x'.repeat(90) }] },
    ], 'retainedV1', 6, 100).nearingCapacity).toBe(true);
    expect(summarizeRetainedTranslationStorage(Array.from({ length: 6 }, (_, index) => ({
      updatedAt: index,
      blocks: [{ translatedText: 'x' }],
    })), 'retainedV1', 6, 100).nearingCapacity).toBe(false);
  });

  it('warns for formula, revision and archived content using the retention budget', () => {
    const session = {
      updatedAt: 1,
      blocks: [{ translatedText: '正文', formulaDocument: { latex: 'x'.repeat(45) } }],
      archivedBlocks: [{ translatedText: '旧稿', revisions: [{ translatedText: '原修正'.repeat(10) }] }],
    };
    const before = JSON.stringify(session);
    const summary = summarizeRetainedTranslationStorage([session], 'retainedV1', 6, 100);
    expect(summary.translationCharacters).toBe(4);
    expect(summary.nearingCapacity).toBe(true);
    expect(summary).toMatchObject({
      capacityCharacters: 4 + JSON.stringify(session.blocks[0]!.formulaDocument).length + JSON.stringify(session.archivedBlocks[0]!.revisions).length,
      estimatedBytes: new TextEncoder().encode(before).byteLength,
      maximumBytes: 3_000_000,
    });
    expect(JSON.stringify(session)).toBe(before);
  });

  it('reports the exact character boundary enforced for fixed records without changing them', () => {
    const record={documentKey:'key',targetLanguage:'zh-CN',sourceLanguage:'auto',style:'academic',contentMode:'auto',updatedAt:1,
      blocks:[{translatedText:'修正稿',revisions:[{translatedText:'旧稿'}]}],archivedBlocks:[{translatedText:'旧分段',formulaDocument:{latex:'x=y'}}]};
    const before=JSON.stringify(record),cost=retainedDocumentStorageCost(record),keys=new Set([fixedDocumentKey('pdf',record)]);
    expect(retainDocumentSessions('pdf',[record],keys,6,cost.capacityCharacters)).toEqual([record]);
    expect(()=>retainDocumentSessions('pdf',[record],keys,6,cost.capacityCharacters-1)).toThrow('容量');
    expect(summarizeRetainedTranslationStorage([record],'key',6,cost.capacityCharacters,1)).toMatchObject({...cost,fixedDocuments:1,recentDocuments:0,nearingCapacity:true});
    expect(JSON.stringify(record)).toBe(before);
  });

  it('warns about structured bytes even when translated text is short', () => {
    const record={updatedAt:1,blocks:[{translatedText:'短译文'}],documentSignatures:['x'.repeat(2_700_000)]};
    const summary=summarizeRetainedTranslationStorage([record],'key',6,1_000_000);
    expect(summary.translationCharacters).toBe(3);
    expect(summary.nearingCapacity).toBe(true);
    expect(summary.estimatedBytes).toBe(new TextEncoder().encode(JSON.stringify(record)).byteLength);
  });
});
