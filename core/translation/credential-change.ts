import { API_KEYS_STORAGE_KEY } from '../settings/repository';

type StorageChanges = Record<string, unknown>;

export function isApiKeyStorageChange(
  areaName: string,
  changes: StorageChanges,
): boolean {
  return (
    (areaName === 'local' || areaName === 'session') &&
    Object.prototype.hasOwnProperty.call(changes, API_KEYS_STORAGE_KEY)
  );
}

/**
 * API keys are deliberately excluded from translation identities. Instead,
 * invalidate all in-flight/checkpoint state whenever the credential map changes
 * so a resumed result can never combine output produced under two credentials.
 */
export async function invalidateTranslationStateForApiKeyChange(
  areaName: string,
  changes: StorageChanges,
  abortActiveRequests: () => void,
  clearCheckpoints: () => Promise<void>,
): Promise<boolean> {
  if (!isApiKeyStorageChange(areaName, changes)) return false;
  abortActiveRequests();
  await clearCheckpoints();
  return true;
}
