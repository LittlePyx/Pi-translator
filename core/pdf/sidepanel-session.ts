import {
  isTranslationCorrectionReceipt,
  type PdfSidePanelSession,
} from '../messaging/messages';
import { edgePdfSourceUrl, pdfDocumentIdentity, pdfInitialPage } from './source';

const PDF_SIDE_PANEL_SESSIONS_KEY = 'pdfSidePanelSessionsByTab';

type StoredPdfSessions = Record<string, PdfSidePanelSession>;

let storageTail: Promise<void> = Promise.resolve();

function validSession(value: unknown): value is PdfSidePanelSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<PdfSidePanelSession>;
  const recovery = session.settingsRecoveryConfirmation;
  return (
    Number.isSafeInteger(session.tabId) &&
    (session.tabId ?? -1) >= 0 &&
    typeof session.requestId === 'string' &&
    typeof session.sourceText === 'string' &&
    typeof session.pageUrl === 'string' &&
    typeof session.sourceLabel === 'string' &&
    typeof session.startedAt === 'number' &&
    ['translating', 'complete', 'error'].includes(session.status ?? '') &&
    (recovery === undefined || Boolean(
      recovery &&
      typeof recovery.failedRequestId === 'string' &&
      typeof recovery.hadPartialOutput === 'boolean'
    ))
  );
}

function sanitizeCorrectionReceipt(
  session: PdfSidePanelSession,
): PdfSidePanelSession {
  const receipt = session.correctionReceipt;
  if (receipt === undefined) return session;
  const result = session.result;
  const matchesResult = Boolean(
    session.status === 'complete' &&
    result &&
    result.requestId === receipt.correctedRequestId &&
    result.translatedText === receipt.correctedTranslation &&
    result.revision?.kind === 'manual' &&
    result.revision.scope === receipt.scope,
  );
  if (isTranslationCorrectionReceipt(receipt) && matchesResult) return session;
  const { correctionReceipt: _invalidReceipt, ...safeSession } = session;
  return safeSession;
}

function validStoredSessions(value: unknown): StoredPdfSessions {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, session]) => (
      /^\d+$/.test(key) && validSession(session)
        ? [[key, sanitizeCorrectionReceipt(session)] as const]
        : []
    )),
  );
}

async function readStoredSessions(): Promise<StoredPdfSessions> {
  const stored = await browser.storage.session.get(PDF_SIDE_PANEL_SESSIONS_KEY);
  return validStoredSessions(stored[PDF_SIDE_PANEL_SESSIONS_KEY]);
}

function queueStorageTask<T>(task: () => Promise<T>): Promise<T> {
  const result = storageTail.catch(() => undefined).then(task);
  storageTail = result.then(() => undefined, () => undefined);
  return result;
}

function queueStorageUpdate(update: (sessions: StoredPdfSessions) => void): Promise<void> {
  return queueStorageTask(async () => {
    const sessions = await readStoredSessions();
    update(sessions);
    await browser.storage.session.set({ [PDF_SIDE_PANEL_SESSIONS_KEY]: sessions });
  });
}

export function storePdfSidePanelSession(session: PdfSidePanelSession): Promise<void> {
  return queueStorageUpdate((sessions) => {
    sessions[String(session.tabId)] = session;
  });
}

export function removeStoredPdfSidePanelSession(tabId: number): Promise<void> {
  return queueStorageUpdate((sessions) => {
    delete sessions[String(tabId)];
  });
}

export async function restorePdfSidePanelSessions(
  tabs: Array<{ id?: number | undefined; url?: string | undefined }>,
): Promise<PdfSidePanelSession[]> {
  return queueStorageTask(async () => {
    const stored = await readStoredSessions();
    const tabsById = new Map(
      tabs.flatMap((tab) => tab.id === undefined ? [] : [[tab.id, tab] as const]),
    );
    const restored: PdfSidePanelSession[] = [];

    for (const session of Object.values(stored)) {
      const tab = tabsById.get(session.tabId);
      const currentSource = edgePdfSourceUrl({
        ...(tab?.url ? { tabUrl: tab.url } : {}),
      }) ?? tab?.url;
      const storedIdentity = pdfDocumentIdentity(session.pageUrl);
      const currentIdentity = pdfDocumentIdentity(currentSource);
      if (!tab || !storedIdentity || storedIdentity !== currentIdentity) continue;
      const currentPage = pdfInitialPage(tab.url) ?? pdfInitialPage(currentSource);
      const currentSession = currentPage ? { ...session, pageNumber: currentPage } : session;
      restored.push(
        currentSession.status === 'translating'
          ? {
              ...currentSession,
              status: 'error',
              error: {
                code: 'REQUEST_ABORTED',
                message: '扩展后台已重新启动，上一次翻译已停止，请点击重试。',
                retryable: true,
              },
            }
          : currentSession,
      );
    }

    const cleaned = Object.fromEntries(
      restored.map((session) => [String(session.tabId), session]),
    );
    await browser.storage.session.set({ [PDF_SIDE_PANEL_SESSIONS_KEY]: cleaned });
    return restored;
  });
}

export interface LatestRequestGate {
  begin(): () => boolean;
  invalidate(): void;
}

export function createLatestRequestGate(): LatestRequestGate {
  let revision = 0;
  return {
    begin() {
      revision += 1;
      const current = revision;
      return () => current === revision;
    },
    invalidate() {
      revision += 1;
    },
  };
}

export function isSamePdfSidePanelSession(
  current: PdfSidePanelSession | null | undefined,
  expected: Pick<PdfSidePanelSession, 'tabId' | 'requestId'>,
): current is PdfSidePanelSession {
  return (
    current?.tabId === expected.tabId &&
    current.requestId === expected.requestId
  );
}

export interface PdfSidePanelGestureTab {
  id?: number | undefined;
  windowId?: number | undefined;
}

export interface PdfSidePanelGestureRecovery {
  matchedSession: boolean;
  openPromise?: Promise<unknown> | undefined;
}

/**
 * Starts reopening an existing tab-specific PDF panel without crossing an
 * asynchronous boundary. Callers must invoke this directly from a browser
 * user-gesture listener such as commands.onCommand or contextMenus.onClicked.
 */
export function reopenExistingPdfSidePanelFromUserGesture(
  tab: PdfSidePanelGestureTab | undefined,
  hasSession: (tabId: number) => boolean,
  open: (tab: PdfSidePanelGestureTab) => Promise<unknown> | undefined,
): PdfSidePanelGestureRecovery {
  if (tab?.id === undefined || tab.id < 0 || !hasSession(tab.id)) {
    return { matchedSession: false };
  }
  return {
    matchedSession: true,
    openPromise: open(tab),
  };
}
