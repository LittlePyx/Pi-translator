import {listResearchExcerpts} from '../content/research-excerpt-repository';
import {excerptSourceHref} from '../translation/library-search';
import {webExcerptPageUrl} from '../content/web-excerpt-repository';
import {readingPageUrl} from '../content/reading-navigation';
import {assertSummarySize,noteSummaryHash,noteSummarySourceContent,summaryPurpose,type NoteSummaryTarget} from '../content/note-summary';
import {getSettings,getApiKey} from '../settings/repository';
import {apiOriginPattern} from '../settings/api-access';
import {TranslationError} from '../messaging/errors';
import {errorResponse} from './runtime-response';
import {READING_HINT_PREFERENCES_KEY,readingHintPreferences,claimReadingHint,readingRecapMetadata,readingRecapPage,type ReadingRecapSource} from '../content/reading-hints';
import {withDocumentStorageLock} from '../translation/document-storage-lock';
import {PDF_READING_STATES_KEY,normalizePdfReadingState} from '../pdf/reading-state';
import type {OpenAiCompatibleTranslator} from '../translation/openai-compatible-translator';
import type {RuntimeMessageHandlers,RuntimeMessageSender} from './runtime-message-router';

export function createNoteSummaryHandlers(provider:Pick<OpenAiCompatibleTranslator,'summarizeNotes'>):Required<Pick<RuntimeMessageHandlers,'PREVIEW_NOTE_SUMMARY'|'GENERATE_NOTE_SUMMARY'|'CANCEL_NOTE_SUMMARY'|'READING_HINT'>>{
  const jobs=new Map<string,{requestId:string;controller:AbortController;tabId:number|undefined}>();
  const owner=(sender:RuntimeMessageSender)=>(sender as RuntimeMessageSender&{documentId?:string}).documentId??`${sender.tab?.id??sender.url}:${sender.frameId??0}`;
  function checkTarget(target:NoteSummaryTarget,sender:RuntimeMessageSender):void{
    const url=sender.url??sender.tab?.url??'',extension=new URL(browser.runtime.getURL('/'));
    let trusted=false;try{const source=new URL(url);trusted=source.protocol===extension.protocol&&source.host===extension.host&&['/pdf.html','/options.html'].includes(source.pathname)}catch{/* Reject below. */}
    if(!trusted&&(target.kind!=='web'||!readingPageUrl(url)||readingPageUrl(url)!==readingPageUrl(target.pageUrl)))throw new TranslationError('UNSUPPORTED_PAGE','请从当前文档的笔记入口生成小结。',false);
  }
  async function readSources(target:NoteSummaryTarget,recap=false):Promise<ReadingRecapSource[]>{
    const records=(await listResearchExcerpts()).filter(item=>target.kind==='pdf'?item.kind==='pdf'&&item.documentId===target.documentId:item.kind==='web'&&webExcerptPageUrl(item.item.pageUrl)===webExcerptPageUrl(target.pageUrl));
    return Promise.all(records.map(async item=>{const content=noteSummarySourceContent(item),href=excerptSourceHref(item);return {id:item.id,revision:await noteSummaryHash(item),...content,...(href?{href}:{}),...(recap?readingRecapMetadata(item):{})}}));
  }
  async function configuration(){
    const settings=await getSettings(),profile=settings.apiProfiles.find(item=>item.id===settings.activeApiProfileId);
    if(!profile)throw new TranslationError('REQUEST_ABORTED','请先配置文字翻译接口。',false);
    const purpose=summaryPurpose(settings.purposePreferences?.purposes),model=profile.model,targetLanguage=settings.targetLanguage;
    return {settings,profile,purpose,model,targetLanguage,configuration:await noteSummaryHash({profile,language:targetLanguage,purpose})};
  }
  browser.tabs.onRemoved.addListener(tabId=>{for(const job of jobs.values())if(job.tabId===tabId)job.controller.abort()});
  browser.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading'||change.url)for(const job of jobs.values())if(job.tabId===tabId)job.controller.abort()});
  browser.storage.onChanged.addListener(changes=>{if(['extensionSettings','apiKey','apiKeysByProfile'].some(key=>key in changes))for(const job of jobs.values())job.controller.abort()});
  return {
    READING_HINT:async(message,sender)=>{try{
      const {target,action}=message.payload;checkTarget(target,sender);
      if(action==='snapshot'){
        const sources=await readSources(target,true);
        const stored=target.kind==='pdf'?(await browser.storage.local.get(PDF_READING_STATES_KEY))[PDF_READING_STATES_KEY] as Record<string,unknown>|undefined:undefined;
        const state=target.kind==='pdf'?normalizePdfReadingState(stored?.[target.documentId]):undefined;
        const pageNumber=readingRecapPage(state);
        return {ok:true as const,data:{sources,...(pageNumber?{pageNumber}:{})}};
      }
      const key=await noteSummaryHash(target.kind==='web'?{kind:'web',pageUrl:webExcerptPageUrl(target.pageUrl)}:target);
      return await withDocumentStorageLock(async()=>{
        const preferences=readingHintPreferences((await browser.storage.local.get(READING_HINT_PREFERENCES_KEY))[READING_HINT_PREFERENCES_KEY]),now=Date.now();
        const show=action==='claim'&&claimReadingHint(preferences,key,now);
        if(show||action==='dismiss'&&(key in preferences||Object.keys(preferences).length<500)){
          preferences[key]={shownAt:now,...(action==='dismiss'?{dismissed:true as const}:{})};await browser.storage.local.set({[READING_HINT_PREFERENCES_KEY]:preferences});
        }
        return {ok:true as const,data:{show}};
      });
    }catch(error){return errorResponse(error)}},
    PREVIEW_NOTE_SUMMARY:async(message,sender)=>{try{
      checkTarget(message.payload.target,sender);const [sources,config]=await Promise.all([readSources(message.payload.target),configuration()]);
      return {ok:true as const,data:{sources,configuration:config.configuration,model:config.model,targetLanguage:config.targetLanguage,purpose:config.purpose}};
    }catch(error){return errorResponse(error)}},
    CANCEL_NOTE_SUMMARY:async(message,sender)=>{const job=jobs.get(owner(sender)),cancelled=job?.requestId===message.payload.requestId;if(cancelled)job.controller.abort();return {ok:true as const,data:{cancelled}}},
    GENERATE_NOTE_SUMMARY:async(message,sender)=>{
      const key=owner(sender);let job:{requestId:string;controller:AbortController;tabId:number|undefined}|undefined;
      try{
        checkTarget(message.payload.target,sender);if(jobs.has(key))throw new TranslationError('REQUEST_ABORTED','本窗口已有小结任务，请等待或取消后继续。',false);
        job={requestId:message.payload.requestId,controller:new AbortController(),tabId:sender.tab?.id};jobs.set(key,job);
        const current=()=>{if(job!.controller.signal.aborted)throw new TranslationError('REQUEST_ABORTED','小结已取消，原笔记未改变。',false)};
        const config=await configuration();current();if(config.configuration!==message.payload.configuration)throw new TranslationError('REQUEST_ABORTED','接口或用途偏好已变化，请重新打开小结预览。',false);
        const select=async()=>{const all=await readSources(message.payload.target);return message.payload.selections.map(selection=>{const source=all.find(item=>item.id===selection.id);if(!source||source.revision!==selection.revision)throw new TranslationError('REQUEST_ABORTED','选中的笔记已修改或删除，请重新打开小结预览；原资料未改变。',false);return source})};
        const sources=await select();current();assertSummarySize(sources);
        const apiKey=await getApiKey(config.profile.id,config.profile.apiBaseUrl);current();if(!apiKey)throw new TranslationError('NO_API_KEY','请先配置文字翻译接口的 API Key。',false);
        if(!await browser.permissions.contains({origins:[apiOriginPattern(config.profile.apiBaseUrl)]}))throw new TranslationError('API_PERMISSION_REQUIRED','当前文字接口尚未授权，请在设置中完成配置。',false);
        current();const latest=await configuration();current();if(latest.configuration!==config.configuration)throw new TranslationError('REQUEST_ABORTED','接口或用途偏好已变化，请重新打开小结预览。',false);
        const points=await provider.summarizeNotes(sources,config.targetLanguage,message.payload.purpose??config.purpose,config.model,{apiBaseUrl:config.profile.apiBaseUrl,apiKey},job.controller.signal);
        current();await select();current();return {ok:true as const,data:{points,sources}};
      }catch(error){return errorResponse(error)}finally{if(job&&jobs.get(key)===job)jobs.delete(key)}
    }
  };
}
