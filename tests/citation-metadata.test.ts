import {afterEach,describe,expect,it,vi} from 'vitest';
import {lookupCitationMetadata} from '../core/content/citation-metadata';

afterEach(()=>vi.unstubAllGlobals());
const doi='10.1038/nature14539';
const body={message:{DOI:doi,title:['Deep learning'],published:{'date-parts':[[2015]]}}};

describe('DOI lookup transport contract (offline)',()=>{
  it('sends only the normalized DOI with no credentials, referrer, body or authorization',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify(body)));vi.stubGlobal('fetch',fetch);
    const signal=new AbortController().signal;
    await expect(lookupCitationMetadata(`https://doi.org/${doi}`,signal)).resolves.toEqual({title:'Deep learning',year:'2015',doi});
    expect(fetch.mock.calls).toEqual([[`https://api.crossref.org/works/10.1038%2Fnature14539`,{signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}}]]);
  });
  it('rejects invalid input before any request',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(lookupCitationMetadata('not a DOI',new AbortController().signal)).rejects.toThrow('有效 DOI');expect(fetch).not.toHaveBeenCalled();
  });
  it('does not accept a different DOI returned by the service',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({message:{...body.message,DOI:'10.1234/other'}}))));
    await expect(lookupCitationMetadata(doi,new AbortController().signal)).rejects.toThrow('不符');
  });
  it('rejects an oversized streamed response and cancels the reader',async()=>{
    const cancel=vi.fn(async()=>undefined),read=vi.fn().mockResolvedValueOnce({done:false,value:new Uint8Array(128000)}).mockResolvedValueOnce({done:false,value:new Uint8Array(128001)});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,body:{getReader:()=>({read,cancel})}})));
    await expect(lookupCitationMetadata(doi,new AbortController().signal)).rejects.toThrow('容量');expect(cancel).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledTimes(2);
  });
  it('keeps the stream byte boundary valid when UTF-8 characters cross chunks',async()=>{
    const bytes=new TextEncoder().encode(JSON.stringify({message:{...body.message,title:['中文标题']}}));
    const split=bytes.indexOf(0xe4)+1;
    const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes.slice(0,split));controller.enqueue(bytes.slice(split));controller.close()}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(stream)));
    await expect(lookupCitationMetadata(doi,new AbortController().signal)).resolves.toMatchObject({title:'中文标题'});
  });
  it('propagates cancellation and cancels the reader without returning metadata',async()=>{
    const controller=new AbortController(),cancel=vi.fn(async()=>undefined);
    const read=vi.fn(()=>new Promise((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true})));
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,body:{getReader:()=>({read,cancel})}})));
    const result=lookupCitationMetadata(doi,controller.signal),assertion=expect(result).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());controller.abort();await assertion;expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects service failures and empty response streams without inventing fields',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response(null));vi.stubGlobal('fetch',fetch);
    await expect(lookupCitationMetadata(doi,new AbortController().signal)).rejects.toThrow('手工');
    await expect(lookupCitationMetadata(doi,new AbortController().signal)).rejects.toThrow('为空');
  });
});
