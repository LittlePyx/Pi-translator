import type {Page} from '@playwright/test';

/** Commit a real isolated write, then hold its acknowledgement until the test releases it. */
export async function delayStorageWrite(page:Page,key:string,reject=false):Promise<void>{
  await page.evaluate(({key,reject})=>{
    const g=globalThis as any,area=g.chrome.storage.local,set=area.set.bind(area);
    g.storageWriteReady=false;let held=false;
    area.set=async(values:any,...args:any[])=>{
      if(reject&&!held&&key in values){held=true;g.storageWriteReady=true;await new Promise<void>(resolve=>g.releaseStorageWrite=resolve);throw new Error('Offline fixture: storage unavailable')}
      const result=await set(values,...args);
      if(!held&&key in values){held=true;g.storageWriteReady=true;await new Promise<void>(resolve=>g.releaseStorageWrite=resolve)}
      return result;
    };
  },{key,reject});
}
export async function releaseStorageWrite(page:Page):Promise<void>{await page.evaluate(()=>(globalThis as any).releaseStorageWrite?.())}
