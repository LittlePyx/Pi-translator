export const CONFIGURATION_REVISION_STORAGE_KEY = 'configurationRevision';
export const APPLIED_CONFIGURATION_REVISION_STORAGE_KEY =
  'appliedConfigurationRevision';

export interface ConfigurationRevision {
  id: string;
  committedAt: number;
  invalidatesTranslationState: boolean;
}

type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown } | undefined>;

export class ConfigurationRevisionMismatchError extends Error {
  constructor() {
    super('The saved configuration changed before recovery could resume.');
    this.name = 'ConfigurationRevisionMismatchError';
  }
}

export function isConfigurationRevision(value: unknown): value is ConfigurationRevision {
  if (!value || typeof value !== 'object') return false;
  const revision = value as Partial<ConfigurationRevision>;
  return Boolean(
    typeof revision.id === 'string' &&
      revision.id.length > 0 &&
      revision.id.length <= 128 &&
      typeof revision.committedAt === 'number' &&
      Number.isFinite(revision.committedAt) &&
      typeof revision.invalidatesTranslationState === 'boolean',
  );
}

export function configurationRevisionFromStorageChange(
  areaName: string,
  changes: StorageChanges,
): ConfigurationRevision | undefined {
  if (areaName !== 'local') return undefined;
  const value = changes[CONFIGURATION_REVISION_STORAGE_KEY]?.newValue;
  return isConfigurationRevision(value) ? value : undefined;
}

/**
 * Commit marker written only after all settings/credential writes in a logical
 * save have completed. The marker contains no configuration values or secrets.
 */
export async function commitConfigurationRevision(
  invalidatesTranslationState: boolean,
): Promise<string> {
  const revision: ConfigurationRevision = {
    id: crypto.randomUUID(),
    committedAt: Date.now(),
    invalidatesTranslationState,
  };
  await browser.storage.local.set({
    [CONFIGURATION_REVISION_STORAGE_KEY]: revision,
  });
  return revision.id;
}

export async function getConfigurationRevision(): Promise<ConfigurationRevision | undefined> {
  const stored = await browser.storage.local.get(CONFIGURATION_REVISION_STORAGE_KEY);
  const value = stored[CONFIGURATION_REVISION_STORAGE_KEY];
  return isConfigurationRevision(value) ? value : undefined;
}

async function getAppliedConfigurationRevision(): Promise<string | undefined> {
  const stored = await browser.storage.session.get(
    APPLIED_CONFIGURATION_REVISION_STORAGE_KEY,
  );
  const value = stored[APPLIED_CONFIGURATION_REVISION_STORAGE_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function setAppliedConfigurationRevision(revisionId: string): Promise<void> {
  await browser.storage.session.set({
    [APPLIED_CONFIGURATION_REVISION_STORAGE_KEY]: revisionId,
  });
}

interface ConfigurationRevisionBarrierOptions {
  apply: (revision: ConfigurationRevision) => Promise<void>;
  readCurrent?: () => Promise<ConfigurationRevision | undefined>;
  readApplied?: () => Promise<string | undefined>;
  writeApplied?: (revisionId: string) => Promise<void>;
}

/**
 * Serializes revision application and provides an explicit acknowledgement to
 * recovery callers. The applied id is kept in storage.session so a restarted
 * MV3 worker can distinguish an already-applied commit from an interrupted one.
 */
export class ConfigurationRevisionBarrier {
  private tail: Promise<void> = Promise.resolve();
  private appliedRevisionId: string | undefined;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly apply: ConfigurationRevisionBarrierOptions['apply'];
  private readonly readCurrent: NonNullable<ConfigurationRevisionBarrierOptions['readCurrent']>;
  private readonly readApplied: NonNullable<ConfigurationRevisionBarrierOptions['readApplied']>;
  private readonly writeApplied: NonNullable<ConfigurationRevisionBarrierOptions['writeApplied']>;

  constructor(options: ConfigurationRevisionBarrierOptions) {
    this.apply = options.apply;
    this.readCurrent = options.readCurrent ?? getConfigurationRevision;
    this.readApplied = options.readApplied ?? getAppliedConfigurationRevision;
    this.writeApplied = options.writeApplied ?? setAppliedConfigurationRevision;
  }

  observe(revision: ConfigurationRevision): Promise<void> {
    const existing = this.pending.get(revision.id);
    if (existing) return existing;

    const operation = this.tail.then(async () => {
      const current = await this.readCurrent();
      // A newer commit superseded this storage event before it was applied.
      if (!current || current.id !== revision.id) return;
      if (
        this.appliedRevisionId === revision.id ||
        (await this.readApplied()) === revision.id
      ) {
        this.appliedRevisionId = revision.id;
        return;
      }

      await this.apply(revision);
      const latest = await this.readCurrent();
      // Do not acknowledge an old configuration when another save completed
      // while its invalidation was running.
      if (!latest || latest.id !== revision.id) return;
      await this.writeApplied(revision.id);
      this.appliedRevisionId = revision.id;
    });
    const settled = operation.finally(() => {
      this.pending.delete(revision.id);
    });
    this.pending.set(revision.id, settled);
    this.tail = settled.catch(() => undefined);
    return settled;
  }

  async applyCurrent(): Promise<void> {
    const revision = await this.readCurrent();
    if (revision) await this.observe(revision);
  }

  async waitFor(revisionId: string): Promise<void> {
    const current = await this.readCurrent();
    if (!current || current.id !== revisionId) {
      throw new ConfigurationRevisionMismatchError();
    }
    await this.observe(current);
    const latest = await this.readCurrent();
    if (
      !latest ||
      latest.id !== revisionId ||
      (this.appliedRevisionId !== revisionId &&
        (await this.readApplied()) !== revisionId)
    ) {
      throw new ConfigurationRevisionMismatchError();
    }
  }
}
