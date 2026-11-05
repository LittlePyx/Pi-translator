import {withDocumentStorageLock} from './document-storage-lock';
import type {LibraryBackupFile} from './document-library-backup-file';

export const RECOVERY_JOURNAL_KEY='piLibraryRecoveryV1';
export interface RecoveryJournal {version:1;pending:string[]}

export function recoveryJournal(value:unknown):RecoveryJournal|undefined{
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object')throw new Error('恢复状态暂时无法读取，请稍后刷新。');
  const record=value as Partial<RecoveryJournal>;
  if(record.version!==1||!Array.isArray(record.pending)||record.pending.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(record.pending).size!==record.pending.length)throw new Error('恢复状态暂时无法读取，请稍后刷新。');
  return {version:1,pending:record.pending};
}
export function recoveryLockAvailable():boolean{return typeof navigator!=='undefined'&&Boolean(navigator.locks)}
export async function recoveryFingerprint(data:LibraryBackupFile):Promise<string>{
  const input=JSON.stringify([data.libraryText,data.hasOriginals,data.originals.map(entry=>entry.metadata)]);
  const bytes=new TextEncoder().encode(input);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** Wait for an active writer before deciding whether its pending marker is interrupted. */
export function interruptedRecovery():Promise<RecoveryJournal|undefined>{
  if(!recoveryLockAvailable())return Promise.resolve(undefined);
  return withDocumentStorageLock(async()=>{
    const state=recoveryJournal((await browser.storage.local.get(RECOVERY_JOURNAL_KEY))[RECOVERY_JOURNAL_KEY]);
    return state?.pending.length?state:undefined;
  });
}
