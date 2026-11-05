import {createHash} from 'node:crypto';
import type {BrowserContext} from '@playwright/test';

/** Inspect the executed script, rather than fetching files that a stale worker can also read. */
export async function executedExtensionBackground(context:BrowserContext,extensionId:string):Promise<string>{
  const cdp=await context.browser()!.newBrowserCDPSession(),url=`chrome-extension://${extensionId}/background.js`;
  const {targetInfos}=await cdp.send('Target.getTargets');
  const target=targetInfos.find(t=>t.type==='service_worker'&&t.url===url);
  if(!target)throw new Error('Extension background target absent');
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
  let serial=0;
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  const scripts:{url:string;scriptId:string}[]=[];
  cdp.on('Target.receivedMessageFromTarget',event=>{
    if(event.sessionId!==sessionId)return;
    const message=JSON.parse(event.message);
    if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result)}}
    else if(message.method==='Debugger.scriptParsed')scripts.push(message.params);
  });
  const send=(method:string,params:Record<string,unknown>={}):Promise<any>=>new Promise((resolve,reject)=>{
    const id=++serial;pending.set(id,{resolve,reject});
    void cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
  });
  try{
    await send('Debugger.enable');
    for(let i=0;i<100&&!scripts.some(script=>script.url===url);i++)await new Promise(resolve=>setTimeout(resolve,50));
    const script=scripts.find(script=>script.url===url);
    if(!script)throw new Error('Executed extension background script absent');
    const {scriptSource}=await send('Debugger.getScriptSource',{scriptId:script.scriptId});
    return createHash('sha256').update(scriptSource).digest('hex');
  }finally{await cdp.send('Target.detachFromTarget',{sessionId});await cdp.detach()}
}
