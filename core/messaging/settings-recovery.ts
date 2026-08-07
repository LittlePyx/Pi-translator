import type { TranslationErrorCode } from './errors';
import type { SettingsFocus, TranslationProviderRole } from './user-facing-error';

const STORAGE_KEY = 'settingsRecoveryTickets';
export const SETTINGS_RECOVERY_TTL_MS = 30 * 60 * 1000;
const MAX_TICKETS = 8;
const DELIVERY_LOCK_MS = 30 * 1000;

export type SettingsRecoveryTargetKind = 'content-script' | 'extension-page' | 'native-pdf';

export interface SettingsRecoveryTicket {
  token: string;
  targetKind: SettingsRecoveryTargetKind;
  sourceTabId: number;
  sourceWindowId?: number;
  sourceFrameId?: number;
  clientId?: string;
  failedRequestId: string;
  role: TranslationProviderRole;
  focus: SettingsFocus;
  errorCode: TranslationErrorCode;
  hadPartialOutput: boolean;
  autoResume: boolean;
  createdAt: number;
  expiresAt: number;
  optionsTabId?: number;
  deliveryStartedAt?: number;
}

type TicketMap = Record<string, SettingsRecoveryTicket>;

let mutationTail: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationTail.then(operation, operation);
  mutationTail = next.catch(() => undefined);
  return next;
}

function isTicket(value: unknown): value is SettingsRecoveryTicket {
  if (!value || typeof value !== 'object') return false;
  const ticket = value as Partial<SettingsRecoveryTicket>;
  return Boolean(
    typeof ticket.token === 'string' &&
      ['content-script', 'extension-page', 'native-pdf'].includes(ticket.targetKind ?? '') &&
      Number.isInteger(ticket.sourceTabId) &&
      typeof ticket.failedRequestId === 'string' &&
      ['text', 'vision'].includes(ticket.role ?? '') &&
      typeof ticket.focus === 'string' &&
      typeof ticket.errorCode === 'string' &&
      typeof ticket.hadPartialOutput === 'boolean' &&
      typeof ticket.autoResume === 'boolean' &&
      typeof ticket.createdAt === 'number' &&
      typeof ticket.expiresAt === 'number',
  );
}

function copyTicket(value: SettingsRecoveryTicket): SettingsRecoveryTicket {
  return {
    token: value.token,
    targetKind: value.targetKind,
    sourceTabId: value.sourceTabId,
    ...(Number.isInteger(value.sourceWindowId)
      ? { sourceWindowId: value.sourceWindowId }
      : {}),
    ...(Number.isInteger(value.sourceFrameId)
      ? { sourceFrameId: value.sourceFrameId }
      : {}),
    ...(typeof value.clientId === 'string' ? { clientId: value.clientId } : {}),
    failedRequestId: value.failedRequestId,
    role: value.role,
    focus: value.focus,
    errorCode: value.errorCode,
    hadPartialOutput: value.hadPartialOutput,
    autoResume: value.autoResume,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    ...(Number.isInteger(value.optionsTabId)
      ? { optionsTabId: value.optionsTabId }
      : {}),
    ...(typeof value.deliveryStartedAt === 'number'
      ? { deliveryStartedAt: value.deliveryStartedAt }
      : {}),
  };
}

function normalizedTickets(value: unknown, now = Date.now()): TicketMap {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, SettingsRecoveryTicket] => (
        isTicket(entry[1]) &&
        entry[0] === entry[1].token &&
        entry[1].expiresAt > now
      ))
      .sort((left, right) => right[1].createdAt - left[1].createdAt)
      .slice(0, MAX_TICKETS)
      .map(([token, ticket]) => [token, copyTicket(ticket)]),
  );
}

async function readTickets(now = Date.now()): Promise<TicketMap> {
  const stored = await browser.storage.session.get(STORAGE_KEY);
  return normalizedTickets(stored[STORAGE_KEY], now);
}

async function writeTickets(tickets: TicketMap): Promise<void> {
  await browser.storage.session.set({ [STORAGE_KEY]: tickets });
}

export function createSettingsRecoveryTicket(
  ticket: Omit<SettingsRecoveryTicket, 'token' | 'createdAt' | 'expiresAt'>,
  now = Date.now(),
): Promise<SettingsRecoveryTicket> {
  return serialized(async () => {
    const tickets = await readTickets(now);
    const token = crypto.randomUUID();
    const createdAt = Math.max(
      now,
      ...Object.values(tickets).map((existing) => existing.createdAt + 1),
    );
    const created = copyTicket({
      token,
      targetKind: ticket.targetKind,
      sourceTabId: ticket.sourceTabId,
      ...(ticket.sourceWindowId !== undefined
        ? { sourceWindowId: ticket.sourceWindowId }
        : {}),
      ...(ticket.sourceFrameId !== undefined
        ? { sourceFrameId: ticket.sourceFrameId }
        : {}),
      ...(ticket.clientId ? { clientId: ticket.clientId } : {}),
      failedRequestId: ticket.failedRequestId,
      role: ticket.role,
      focus: ticket.focus,
      errorCode: ticket.errorCode,
      hadPartialOutput: ticket.hadPartialOutput,
      autoResume: ticket.autoResume,
      createdAt,
      expiresAt: now + SETTINGS_RECOVERY_TTL_MS,
    });
    tickets[token] = created;
    await writeTickets(normalizedTickets(tickets, now));
    return { ...created };
  });
}

export function claimSettingsRecoveryTicket(
  token: string,
  optionsTabId: number,
  now = Date.now(),
): Promise<SettingsRecoveryTicket | undefined> {
  return serialized(async () => {
    const tickets = await readTickets(now);
    const ticket = tickets[token];
    if (!ticket || (ticket.optionsTabId !== undefined && ticket.optionsTabId !== optionsTabId)) {
      await writeTickets(tickets);
      return undefined;
    }
    const claimed = { ...ticket, optionsTabId };
    tickets[token] = claimed;
    await writeTickets(tickets);
    return claimed;
  });
}

/**
 * Atomically locks a claimed ticket for delivery without deleting it. A stale
 * lock can be reclaimed after a service-worker interruption.
 */
export function beginSettingsRecoveryDelivery(
  token: string,
  optionsTabId: number,
  now = Date.now(),
): Promise<SettingsRecoveryTicket | undefined> {
  return serialized(async () => {
    const tickets = await readTickets(now);
    const ticket = tickets[token];
    if (
      !ticket ||
      ticket.optionsTabId !== optionsTabId ||
      (ticket.deliveryStartedAt !== undefined &&
        now - ticket.deliveryStartedAt < DELIVERY_LOCK_MS)
    ) {
      await writeTickets(tickets);
      return undefined;
    }
    const delivering = { ...ticket, deliveryStartedAt: now };
    tickets[token] = delivering;
    await writeTickets(tickets);
    return { ...delivering };
  });
}

/** Delete a delivered ticket, or unlock it when the target did not receive it. */
export function finishSettingsRecoveryDelivery(
  token: string,
  optionsTabId: number,
  delivered: boolean,
  now = Date.now(),
): Promise<void> {
  return serialized(async () => {
    const tickets = await readTickets(now);
    const ticket = tickets[token];
    if (!ticket || ticket.optionsTabId !== optionsTabId) {
      await writeTickets(tickets);
      return;
    }
    if (delivered) {
      delete tickets[token];
    } else {
      const unlocked = { ...ticket };
      delete unlocked.deliveryStartedAt;
      tickets[token] = unlocked;
    }
    await writeTickets(tickets);
  });
}

export function discardSettingsRecoveryTicket(token: string): Promise<void> {
  return serialized(async () => {
    const tickets = await readTickets();
    if (!(token in tickets)) return;
    delete tickets[token];
    await writeTickets(tickets);
  });
}

export function clearSettingsRecoveryTicketsForTab(tabId: number): Promise<void> {
  return serialized(async () => {
    const tickets = await readTickets();
    let changed = false;
    for (const [token, ticket] of Object.entries(tickets)) {
      if (ticket.sourceTabId !== tabId && ticket.optionsTabId !== tabId) continue;
      delete tickets[token];
      changed = true;
    }
    if (changed) await writeTickets(tickets);
  });
}
