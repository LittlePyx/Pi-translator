import {describe,it,expect} from 'vitest';
import {recoveryFingerprint,recoveryJournal} from '../core/translation/recovery-journal';
import type {LibraryBackupFile} from '../core/translation/document-library-backup-file';

describe('restore journal',()=>{
  it('stores only valid, unique pending fingerprints and refuses malformed records',()=>{
    const id='a'.repeat(64);
    expect(recoveryJournal(undefined)).toBeUndefined();
    expect(recoveryJournal({version:1,pending:[id]})).toEqual({version:1,pending:[id]});
    for(const value of [null,{}, {version:1,pending:[id,id]}, {version:1,pending:['bad']}, {version:2,pending:[]}])expect(()=>recoveryJournal(value)).toThrow();
  });
  it('identifies the backup contents and original metadata without storing them',async()=>{
    const data:LibraryBackupFile={libraryText:'private note',hasOriginals:false,originals:[]};
    const id=await recoveryFingerprint(data);
    expect(id).toMatch(/^[a-f0-9]{64}$/);expect(id).toBe(await recoveryFingerprint({...data}));
    expect(id).not.toBe(await recoveryFingerprint({...data,libraryText:'changed note'}));
    expect(id).not.toBe(await recoveryFingerprint({...data,hasOriginals:true}));
  });
});
