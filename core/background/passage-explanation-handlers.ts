import {getSettings,getApiKey} from '../settings/repository';
import {apiOriginPattern} from '../settings/api-access';
import {noteSummaryHash} from '../content/note-summary';
import type {PassageInput} from '../content/passage-explanation';
import {TranslationError} from '../messaging/errors';
import {errorResponse} from './runtime-response';
import type {OpenAiCompatibleTranslator} from '../translation/openai-compatible-translator';
import type {RuntimeMessageHandlers,RuntimeMessageSender} from './runtime-message-router';

export function createPassageExplanationHandlers(provider:Pick<OpenAiCompatibleTranslator,'explainPassage'>):Required<Pick<RuntimeMessageHandlers,'PREVIEW_PASSAGE_EXPLANATION'|'GENERATE_PASSAGE_EXPLANATION'|'CANCEL_PASSAGE_EXPLANATION'>>{
  const jobs=new Map<string,{id:string;controller:AbortController;tabId:number|undefined}>();
  const owner=(sender:RuntimeMessageSender)=>(sender as RuntimeMessageSender&{documentId?:string}).documentId??`${sender.tab?.id??sender.url}:${sender.frameId??0}`;
  function check(sender:RuntimeMessageSender){
    const url=new URL(sender.url??sender.tab?.url??''),extension=new URL(browser.runtime.getURL('/'));
    if(!['http:','https:'].includes(url.protocol)&&!(url.origin===extension.origin&&url.host===extension.host&&['/pdf.html','/sidepanel.html'].includes(url.pathname)))throw new TranslationError('UNSUPPORTED_PAGE','请从当前译文打开解释。',false);
  }
  async function configuration(input:PassageInput){
    const settings=await getSettings(),profile=settings.apiProfiles.find(p=>p.id===settings.activeApiProfileId);
    if(!profile)throw new TranslationError('REQUEST_ABORTED','请先配置文字翻译接口。',false);
    const memory=(await browser.storage.local.get('documentTranslationMemoryV1')).documentTranslationMemoryV1;
    return {profile,language:settings.targetLanguage,configuration:await noteSummaryHash({input,settings,memory})};
  }
  browser.tabs.onRemoved.addListener(id=>{for(const job of jobs.values())if(job.tabId===id)job.controller.abort()});
  browser.tabs.onUpdated.addListener((id,change)=>{if(change.url||change.status==='loading')for(const job of jobs.values())if(job.tabId===id)job.controller.abort()});
  browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&['extensionSettings','apiKey','apiKeysByProfile','documentTranslationMemoryV1'].some(k=>k in changes))for(const job of jobs.values())job.controller.abort()});
  return {
    PREVIEW_PASSAGE_EXPLANATION:async(message,sender)=>{try{check(sender);const c=await configuration(message.payload.input);return{ok:true,data:{configuration:c.configuration,model:c.profile.model,language:c.language}}}catch(e){return errorResponse(e)}},
    CANCEL_PASSAGE_EXPLANATION:async(message,sender)=>{const job=jobs.get(owner(sender));if(job?.id===message.payload.requestId)job.controller.abort();return {ok:true,data:{cancelled:job?.id===message.payload.requestId}}},
    GENERATE_PASSAGE_EXPLANATION:async(message,sender)=>{
      const key=owner(sender);let job:{id:string;controller:AbortController;tabId:number|undefined}|undefined;
      try{
        check(sender);if(jobs.has(key))throw new TranslationError('REQUEST_ABORTED','本窗口已有解释任务，请等待或取消。',false);
        job={id:message.payload.requestId,controller:new AbortController(),tabId:sender.tab?.id};jobs.set(key,job);
        const current=()=>{if(job!.controller.signal.aborted)throw new TranslationError('REQUEST_ABORTED','解释已取消。',false)};
        const config=await configuration(message.payload.input);current();
        if(config.configuration!==message.payload.configuration)throw new TranslationError('REQUEST_ABORTED','上下文或设置已变化，请重新预览。',false);
        const apiKey=await getApiKey(config.profile.id,config.profile.apiBaseUrl);current();if(!apiKey)throw new TranslationError('NO_API_KEY','请先配置文字翻译接口的 API Key。',false);
        if(!await browser.permissions.contains({origins:[apiOriginPattern(config.profile.apiBaseUrl)]}))throw new TranslationError('API_PERMISSION_REQUIRED','当前文字接口尚未授权，请在设置中完成配置。',false);
        current();if((await configuration(message.payload.input)).configuration!==config.configuration)throw new TranslationError('REQUEST_ABORTED','上下文或设置已变化，请重新预览。',false);current();
        const points=await provider.explainPassage(message.payload.input,config.language,config.profile.model,{apiBaseUrl:config.profile.apiBaseUrl,apiKey},job.controller.signal);current();
        if((await configuration(message.payload.input)).configuration!==config.configuration)throw new TranslationError('REQUEST_ABORTED','上下文或设置已变化，请重新预览。',false);current();return {ok:true,data:{points}};
      }catch(e){return errorResponse(e)}finally{if(job&&jobs.get(key)===job)jobs.delete(key)}
    }
  };
}
