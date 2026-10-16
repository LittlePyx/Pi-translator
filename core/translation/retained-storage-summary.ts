import {retainedDocumentStorageCost,RETAINED_DOCUMENT_BYTES_PER_KIND,type RetainedDocumentStorageContent} from './fixed-document-storage';

export interface RetainedTranslationStorageSummary {
  documentCount: number;
  translationCharacters: number;
  capacityCharacters: number;
  estimatedBytes: number;
  maximumBytes: number;
  maximumDocuments: number;
  maximumTranslationCharacters: number;
  nearingCapacity: boolean;
  fixedDocuments: number;
  recentDocuments: number;
  newestUpdatedAt?: number;
}

interface RetainedTranslationSessionLike extends RetainedDocumentStorageContent {
  updatedAt: number;
}

export function summarizeRetainedTranslationStorage(
  sessions: readonly RetainedTranslationSessionLike[],
  _storageKey: string,
  maximumDocuments: number,
  maximumTranslationCharacters: number,
  fixedDocuments = 0,
): RetainedTranslationStorageSummary {
  const costs=sessions.map(retainedDocumentStorageCost);
  const translationCharacters=costs.reduce((total,cost)=>total+cost.translationCharacters,0);
  const capacityCharacters=costs.reduce((total,cost)=>total+cost.capacityCharacters,0);
  const estimatedBytes=costs.reduce((total,cost)=>total+cost.estimatedBytes,0);
  const newestUpdatedAt = sessions.reduce<number | undefined>(
    (newest, session) => newest === undefined || session.updatedAt > newest
      ? session.updatedAt
      : newest,
    undefined,
  );
  return {
    documentCount: sessions.length,
    translationCharacters,
    capacityCharacters,
    estimatedBytes,
    maximumBytes: RETAINED_DOCUMENT_BYTES_PER_KIND,
    maximumDocuments,
    maximumTranslationCharacters,
    fixedDocuments, recentDocuments: Math.max(0,sessions.length-fixedDocuments),
    nearingCapacity: estimatedBytes >= RETAINED_DOCUMENT_BYTES_PER_KIND * .9 || capacityCharacters >= maximumTranslationCharacters * .9,
    ...(newestUpdatedAt === undefined ? {} : { newestUpdatedAt }),
  };
}
