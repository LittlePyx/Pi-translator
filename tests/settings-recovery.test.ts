import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SETTINGS_RECOVERY_TTL_MS,
  beginSettingsRecoveryDelivery,
  claimSettingsRecoveryTicket,
  clearSettingsRecoveryTicketsForTab,
  createSettingsRecoveryTicket,
  discardSettingsRecoveryTicket,
  finishSettingsRecoveryDelivery,
  type SettingsRecoveryTicket,
} from '../core/messaging/settings-recovery';

const STORAGE_KEY = 'settingsRecoveryTickets';

type StorageRecord = Record<string, unknown>;

function recoveryTicket(
  patch: Partial<Omit<SettingsRecoveryTicket, 'token' | 'createdAt' | 'expiresAt'>> = {},
): Omit<SettingsRecoveryTicket, 'token' | 'createdAt' | 'expiresAt'> {
  return {
    targetKind: 'content-script',
    sourceTabId: 7,
    sourceWindowId: 3,
    sourceFrameId: 0,
    clientId: 'content-client-1',
    failedRequestId: 'failed-request-1',
    role: 'text',
    focus: 'api',
    errorCode: 'NO_API_KEY',
    hadPartialOutput: false,
    autoResume: true,
    ...patch,
  };
}

describe('settings recovery session repository', () => {
  let storage: StorageRecord;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('browser', {
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (values: StorageRecord) => Object.assign(storage, values)),
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('expires tickets at the TTL boundary', async () => {
    const createdAt = 10_000;
    const ticket = await createSettingsRecoveryTicket(recoveryTicket(), createdAt);

    expect(ticket.createdAt).toBe(createdAt);
    expect(ticket.expiresAt).toBe(createdAt + SETTINGS_RECOVERY_TTL_MS);
    await expect(claimSettingsRecoveryTicket(
      ticket.token,
      90,
      ticket.expiresAt - 1,
    )).resolves.toMatchObject({ token: ticket.token, optionsTabId: 90 });

    await expect(claimSettingsRecoveryTicket(
      ticket.token,
      90,
      ticket.expiresAt,
    )).resolves.toBeUndefined();
    expect(storage[STORAGE_KEY]).toEqual({});
  });

  it('allows an idempotent claim by one options tab and rejects another claimant', async () => {
    const ticket = await createSettingsRecoveryTicket(recoveryTicket(), 20_000);

    await expect(claimSettingsRecoveryTicket(ticket.token, 91, 20_001))
      .resolves.toMatchObject({ optionsTabId: 91 });
    await expect(claimSettingsRecoveryTicket(ticket.token, 91, 20_002))
      .resolves.toMatchObject({ optionsTabId: 91 });
    await expect(claimSettingsRecoveryTicket(ticket.token, 92, 20_003))
      .resolves.toBeUndefined();
  });

  it('keeps a ticket until delivery is acknowledged and unlocks failed delivery', async () => {
    const ticket = await createSettingsRecoveryTicket(recoveryTicket(), 35_000);
    await claimSettingsRecoveryTicket(ticket.token, 91, 35_001);

    await expect(beginSettingsRecoveryDelivery(ticket.token, 92, 35_002))
      .resolves.toBeUndefined();
    await expect(beginSettingsRecoveryDelivery(ticket.token, 91, 35_002))
      .resolves.toMatchObject({ token: ticket.token, deliveryStartedAt: 35_002 });
    await expect(beginSettingsRecoveryDelivery(ticket.token, 91, 35_003))
      .resolves.toBeUndefined();

    await finishSettingsRecoveryDelivery(ticket.token, 91, false, 35_004);
    await expect(beginSettingsRecoveryDelivery(ticket.token, 91, 35_005))
      .resolves.toMatchObject({ token: ticket.token, deliveryStartedAt: 35_005 });

    await finishSettingsRecoveryDelivery(ticket.token, 91, true, 35_006);
    await expect(claimSettingsRecoveryTicket(ticket.token, 91, 35_007))
      .resolves.toBeUndefined();
  });

  it('retains only the eight newest live tickets', async () => {
    const tickets: SettingsRecoveryTicket[] = [];
    for (let index = 0; index < 10; index += 1) {
      tickets.push(await createSettingsRecoveryTicket(
        recoveryTicket({ sourceTabId: index + 1, failedRequestId: `request-${index + 1}` }),
        40_000,
      ));
    }

    const retained = Object.values(
      storage[STORAGE_KEY] as Record<string, SettingsRecoveryTicket>,
    );
    expect(retained).toHaveLength(8);
    expect(retained.map((ticket) => ticket.token)).toEqual(
      tickets.slice(2).reverse().map((ticket) => ticket.token),
    );
    await expect(claimSettingsRecoveryTicket(tickets[0]!.token, 91, 40_100))
      .resolves.toBeUndefined();
    await expect(claimSettingsRecoveryTicket(tickets.at(-1)!.token, 91, 40_100))
      .resolves.toBeDefined();
  });

  it('never serializes selected text, translations, API keys, URLs, or image data', async () => {
    const sensitive = recoveryTicket() as ReturnType<typeof recoveryTicket> & {
      sourceText: string;
      partialText: string;
      apiKey: string;
      pageUrl: string;
      imageDataUrl: string;
    };
    sensitive.sourceText = 'private selected source';
    sensitive.partialText = 'private partial translation';
    sensitive.apiKey = 'private-api-credential';
    sensitive.pageUrl = 'https://private.example/paper?id=secret';
    sensitive.imageDataUrl = 'data:image/png;base64,PRIVATE_IMAGE';

    const created = await createSettingsRecoveryTicket(sensitive, 50_000);
    const serialized = JSON.stringify({ created, stored: storage[STORAGE_KEY] });

    expect(serialized).not.toContain('private selected source');
    expect(serialized).not.toContain('private partial translation');
    expect(serialized).not.toContain('private-api-credential');
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('data:image/');
  });

  it('discards a token and clears tickets owned by either the source or options tab', async () => {
    const now = Date.now();
    const discarded = await createSettingsRecoveryTicket(
      recoveryTicket({ sourceTabId: 11, failedRequestId: 'discarded' }),
      now,
    );
    const sourceOwned = await createSettingsRecoveryTicket(
      recoveryTicket({ sourceTabId: 22, failedRequestId: 'source-owned' }),
      now + 1,
    );
    const optionsOwned = await createSettingsRecoveryTicket(
      recoveryTicket({ sourceTabId: 33, failedRequestId: 'options-owned' }),
      now + 2,
    );
    const retained = await createSettingsRecoveryTicket(
      recoveryTicket({ sourceTabId: 44, failedRequestId: 'retained' }),
      now + 3,
    );
    await claimSettingsRecoveryTicket(optionsOwned.token, 22, now + 4);

    await discardSettingsRecoveryTicket(discarded.token);
    await clearSettingsRecoveryTicketsForTab(22);

    const stored = storage[STORAGE_KEY] as Record<string, SettingsRecoveryTicket>;
    expect(stored[discarded.token]).toBeUndefined();
    expect(stored[sourceOwned.token]).toBeUndefined();
    expect(stored[optionsOwned.token]).toBeUndefined();
    expect(stored[retained.token]).toBeDefined();
  });
});
