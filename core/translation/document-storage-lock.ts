let tail:Promise<unknown>=Promise.resolve();
/** Shared by imports and normal writes, including other extension windows. */
export function withDocumentStorageLock<T>(operation:()=>Promise<T>):Promise<T>{
  const run=tail.catch(()=>undefined).then(async()=>{
    if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request('pi-document-storage-v1',operation);
    return operation();
  });
  tail=run;
  return run as Promise<T>;
}
