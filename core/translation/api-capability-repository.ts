import { normalizeApiBaseUrl } from '../settings/api-access';

const CAPABILITY_STORE_KEY = 'apiModelCapabilities';
const CAPABILITY_STORE_VERSION = 2;
const CAPABILITY_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_CAPABILITY_ENTRIES = 64;

export interface ApiModelCapabilities {
  textStreaming?: boolean;
  imageStreaming?: boolean;
  responseFormatJson?: boolean;
  thinkingControl?: boolean;
  vision?: boolean;
}

interface StoredCapabilityEntry extends ApiModelCapabilities {
  key: string;
  updatedAt: number;
  expiresAt: number;
}

interface CapabilityStore {
  version: number;
  entries: StoredCapabilityEntry[];
}

let capabilityWriteTail: Promise<void> = Promise.resolve();

function serializeCapabilityWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = capabilityWriteTail.catch(() => undefined).then(operation);
  capabilityWriteTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function sessionStorage(): typeof browser.storage.session | undefined {
  try {
    return typeof browser === 'undefined' ? undefined : browser.storage.session;
  } catch {
    return undefined;
  }
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function storedEntry(value: unknown): value is StoredCapabilityEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<StoredCapabilityEntry>;
  return typeof entry.key === 'string' &&
    typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) &&
    typeof entry.expiresAt === 'number' && Number.isFinite(entry.expiresAt) &&
    isOptionalBoolean(entry.textStreaming) &&
    isOptionalBoolean(entry.imageStreaming) &&
    isOptionalBoolean(entry.responseFormatJson) &&
    isOptionalBoolean(entry.thinkingControl) &&
    isOptionalBoolean(entry.vision);
}

function parseStore(value: unknown): CapabilityStore {
  if (!value || typeof value !== 'object') {
    return { version: CAPABILITY_STORE_VERSION, entries: [] };
  }
  const candidate = value as Partial<CapabilityStore>;
  if (candidate.version !== CAPABILITY_STORE_VERSION || !Array.isArray(candidate.entries)) {
    return { version: CAPABILITY_STORE_VERSION, entries: [] };
  }
  return {
    version: CAPABILITY_STORE_VERSION,
    entries: candidate.entries.filter(storedEntry),
  };
}

async function readStore(): Promise<CapabilityStore> {
  const storage = sessionStorage();
  if (!storage) return { version: CAPABILITY_STORE_VERSION, entries: [] };
  try {
    const stored = await storage.get(CAPABILITY_STORE_KEY);
    return parseStore(stored[CAPABILITY_STORE_KEY]);
  } catch {
    // Capability hints are an optimization. Storage failures must never block
    // translation or connection tests.
    return { version: CAPABILITY_STORE_VERSION, entries: [] };
  }
}

export function apiModelCapabilityKey(apiBaseUrl: string, model: string): string {
  return JSON.stringify([normalizeApiBaseUrl(apiBaseUrl), model.trim()]);
}

export async function getApiModelCapabilities(
  apiBaseUrl: string,
  model: string,
): Promise<ApiModelCapabilities> {
  await capabilityWriteTail.catch(() => undefined);
  const key = apiModelCapabilityKey(apiBaseUrl, model);
  const now = Date.now();
  const entry = (await readStore()).entries.find(
    (candidate) => candidate.key === key && candidate.expiresAt > now,
  );
  if (!entry) return {};
  const { textStreaming, imageStreaming, responseFormatJson, thinkingControl, vision } = entry;
  return {
    ...(textStreaming === undefined ? {} : { textStreaming }),
    ...(imageStreaming === undefined ? {} : { imageStreaming }),
    ...(responseFormatJson === undefined ? {} : { responseFormatJson }),
    ...(thinkingControl === undefined ? {} : { thinkingControl }),
    ...(vision === undefined ? {} : { vision }),
  };
}

export async function updateApiModelCapabilities(
  apiBaseUrl: string,
  model: string,
  patch: ApiModelCapabilities,
): Promise<void> {
  const storage = sessionStorage();
  if (!storage || Object.keys(patch).length === 0) return;
  const key = apiModelCapabilityKey(apiBaseUrl, model);
  await serializeCapabilityWrite(async () => {
    const now = Date.now();
    const store = await readStore();
    const previous = store.entries.find((entry) => entry.key === key && entry.expiresAt > now);
    const entry: StoredCapabilityEntry = {
      ...(previous ?? {}),
      ...patch,
      key,
      updatedAt: now,
      expiresAt: now + CAPABILITY_TTL_MS,
    };
    const entries = [
      entry,
      ...store.entries.filter((candidate) => candidate.key !== key && candidate.expiresAt > now),
    ]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_CAPABILITY_ENTRIES);
    try {
      await storage.set({
        [CAPABILITY_STORE_KEY]: {
          version: CAPABILITY_STORE_VERSION,
          entries,
        } satisfies CapabilityStore,
      });
    } catch {
      // See readStore: losing a hint is preferable to failing a user request.
    }
  });
}
