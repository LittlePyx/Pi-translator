export interface RetainedTranslationStorageSummary {
  documentCount: number;
  translationCharacters: number;
  estimatedBytes: number;
  maximumDocuments: number;
  maximumTranslationCharacters: number;
  nearingCapacity: boolean;
  newestUpdatedAt?: number;
}

interface RetainedTranslationSessionLike {
  blocks: readonly { translatedText: string }[];
  updatedAt: number;
}

export function summarizeRetainedTranslationStorage(
  sessions: readonly RetainedTranslationSessionLike[],
  storageKey: string,
  maximumDocuments: number,
  maximumTranslationCharacters: number,
): RetainedTranslationStorageSummary {
  const translationCharacters = sessions.reduce(
    (total, session) => total + session.blocks.reduce(
      (blockTotal, block) => blockTotal + block.translatedText.length,
      0,
    ),
    0,
  );
  const newestUpdatedAt = sessions.reduce<number | undefined>(
    (newest, session) => newest === undefined || session.updatedAt > newest
      ? session.updatedAt
      : newest,
    undefined,
  );
  const serialized = sessions.length ? JSON.stringify({ [storageKey]: sessions }) : '';
  const estimatedBytes = serialized
    ? new TextEncoder().encode(serialized).byteLength
    : 0;
  return {
    documentCount: sessions.length,
    translationCharacters,
    estimatedBytes,
    maximumDocuments,
    maximumTranslationCharacters,
    nearingCapacity: sessions.length >= maximumDocuments ||
      translationCharacters >= maximumTranslationCharacters * .9,
    ...(newestUpdatedAt === undefined ? {} : { newestUpdatedAt }),
  };
}
