import type {
  ApiDiagnosticReport,
  ApiDiagnosticResponse,
  CompleteSettingsRecoveryResponse,
  ConnectionTestResponse,
  VisionCapabilityTestResponse,
  LocalDiagnosticReportResponse,
  ModelListResponse,
  RuntimeMessage,
  SettingsRecoveryDescriptor,
  SettingsRecoveryResponse,
} from '../../core/messaging/messages';
import { runtimeConnectionErrorMessage, translationErrorMessage } from '../../core/messaging/user-facing-error';
import { apiOriginPattern, normalizeApiBaseUrl } from '../../core/settings/api-access';
import {
  recommendedTextModel,
  recommendedVisionModelCandidates,
} from '../../core/settings/api-model-selection';
import { API_PRESETS } from '../../core/settings/api-presets';
import {
  exportSettingsConfiguration,
  importSettingsConfiguration,
} from '../../core/settings/config-transfer';
import {
  changedApiCredentialProfileIds,
  clearApiKey,
  getSettings,
  hasApiKey,
  mutateApiConfiguration,
  mutateSettings,
} from '../../core/settings/repository';
import { mergeSettingsDraft } from '../../core/settings/draft-merge';
import type {
  ApiKeyStorageMode,
  ApiProfile,
  ContentMode,
  ContextMode,
  ExtensionSettings,
  GeneralPageMode,
  HistoryLimit,
  SidebarSide,
} from '../../core/settings/schema';
import { getAutoInjectionPatterns, normalizeSiteAllowlist } from '../../core/settings/site-access';
import { normalizePdfRegionShortcutKey } from '../../core/pdf/region-shortcuts';
import { supportsQwenCoordinateOcr } from '../../core/pdf/qwen-endpoint';
import {
  formatGlossaryEntries,
  parseGlossaryText,
} from '../../core/translation/glossary';
import type { TranslationStyle } from '../../core/translation/types';

function element<T extends HTMLElement>(id: string): T {
  const value=document.getElementById(id);if(!value)throw new Error(`Missing options element #${id}`);return value as T;
}

const form=element<HTMLFormElement>('settings-form');
const profileSelect=element<HTMLSelectElement>('api-profile');
const addProfileButton=element<HTMLButtonElement>('add-profile');
const deleteProfileButton=element<HTMLButtonElement>('delete-profile');
const profileRoleStatus=element<HTMLElement>('profile-role-status');
const backToTextProfileButton=element<HTMLButtonElement>('back-to-text-profile');
const useTextProfileButton=element<HTMLButtonElement>('use-text-profile');
const profileName=element<HTMLInputElement>('profile-name');
const apiPreset=element<HTMLSelectElement>('api-preset');
const apiProviderHint=element<HTMLElement>('api-provider-hint');
const apiBaseUrl=element<HTMLInputElement>('api-base-url');
const connectionAdvanced=element<HTMLDetailsElement>('connection-advanced');
const apiPermissionState=element<HTMLElement>('api-permission-state');
const apiKeyInput=element<HTMLInputElement>('api-key');
const apiKeyState=element<HTMLElement>('api-key-state');
const persistKey=element<HTMLInputElement>('persist-key');
const modelInput=element<HTMLInputElement>('model');
const modelList=element<HTMLDataListElement>('model-list');
const refreshModelsButton=element<HTMLButtonElement>('refresh-models');
const connectionSummary=element<HTMLElement>('connection-summary');
const connectionTextStatus=element<HTMLElement>('connection-text-status');
const connectionFormatStatus=element<HTMLElement>('connection-format-status');
const connectionVisionStatus=element<HTMLElement>('connection-vision-status');
const setupQwenButton=element<HTMLButtonElement>('setup-qwen');
const visionSetupStatus=element<HTMLElement>('vision-setup-status');
const visionSetupDetails=element<HTMLDetailsElement>('vision-setup-details');
const sourceLanguage=element<HTMLSelectElement>('source-language');
const targetLanguage=element<HTMLSelectElement>('target-language');
const styleSelect=element<HTMLSelectElement>('style');
const contentMode=element<HTMLSelectElement>('content-mode');
const academicGlossary=element<HTMLTextAreaElement>('academic-glossary');
const visionApiProfile=element<HTMLSelectElement>('vision-api-profile');
const visionModel=element<HTMLInputElement>('vision-model');
const testVisionCapabilityButton=element<HTMLButtonElement>('test-vision-capability');
const visionTestStatus=element<HTMLElement>('vision-test-status');
const rememberHistory=element<HTMLInputElement>('remember-history');
const historyLimit=element<HTMLSelectElement>('history-limit');
const sessionCache=element<HTMLInputElement>('session-cache');
const alignmentDefault=element<HTMLInputElement>('alignment-default');
const autoRenderLatex=element<HTMLInputElement>('auto-render-latex');
const sidebarSide=element<HTMLSelectElement>('sidebar-side');
const contextMode=element<HTMLSelectElement>('context-mode');
const enableStreaming=element<HTMLInputElement>('enable-streaming');
const protectSensitiveFields=element<HTMLInputElement>('protect-sensitive-fields');
const pdfKeyboardShortcuts=element<HTMLInputElement>('pdf-keyboard-shortcuts');
const pdfRegionShortcutKey=element<HTMLInputElement>('pdf-region-shortcut-key');
const pdfRegionShortcutField=element<HTMLElement>('pdf-region-shortcut-field');
const generalPageMode=element<HTMLSelectElement>('general-page-mode');
const pageModeHelp=element<HTMLElement>('page-mode-help');
const siteAllowlistField=element<HTMLElement>('site-allowlist-field');
const siteAllowlist=element<HTMLTextAreaElement>('site-allowlist');
const floatingButton=element<HTMLInputElement>('floating-button');
const hideTargetLanguageTrigger=element<HTMLInputElement>('hide-target-language-trigger');
const contextMenu=element<HTMLInputElement>('context-menu');
const testButton=element<HTMLButtonElement>('test-connection');
const diagnoseButton=element<HTMLButtonElement>('diagnose-api');
const clearButton=element<HTMLButtonElement>('clear-key');
const status=element<HTMLParagraphElement>('status');
const settingsRecoveryBanner=element<HTMLElement>('settings-recovery-banner');
const settingsRecoveryTitle=element<HTMLElement>('settings-recovery-title');
const settingsRecoveryDescription=element<HTMLParagraphElement>('settings-recovery-description');
const settingsRecoveryStatus=element<HTMLParagraphElement>('settings-recovery-status');
const diagnosticReport=element<HTMLElement>('diagnostic-report');
const shortcutsButton=element<HTMLButtonElement>('open-shortcuts');
const onboardingDialog=element<HTMLDialogElement>('onboarding-dialog');
const onboardingPreset=element<HTMLSelectElement>('onboarding-preset');
const onboardingBaseUrlField=element<HTMLElement>('onboarding-base-url-field');
const onboardingBaseUrl=element<HTMLInputElement>('onboarding-base-url');
const onboardingApiKey=element<HTMLInputElement>('onboarding-api-key');
const onboardingPersistKey=element<HTMLInputElement>('onboarding-persist-key');
const onboardingKeyHint=element<HTMLElement>('onboarding-key-hint');
const onboardingModel=element<HTMLInputElement>('onboarding-model');
const onboardingModelList=element<HTMLDataListElement>('onboarding-model-list');
const onboardingStatus=element<HTMLElement>('onboarding-status');
const onboardingBack=element<HTMLButtonElement>('onboarding-back');
const onboardingNext=element<HTMLButtonElement>('onboarding-next');
const onboardingSkip=element<HTMLButtonElement>('onboarding-skip');
const restartOnboardingButton=element<HTMLButtonElement>('restart-onboarding');
const exportSettingsButton=element<HTMLButtonElement>('export-settings');
const importSettingsButton=element<HTMLButtonElement>('import-settings');
const importSettingsFile=element<HTMLInputElement>('import-settings-file');
const copyDiagnosticReportButton=element<HTMLButtonElement>('copy-diagnostic-report');
const supportStatus=element<HTMLElement>('support-status');
const navProfileName=element<HTMLElement>('nav-profile-name');
const navKeyStatus=element<HTMLElement>('nav-key-status');
const saveState=element<HTMLElement>('save-state');
const extensionVersion=element<HTMLElement>('extension-version');
const settingsNavButtons=[...document.querySelectorAll<HTMLButtonElement>('[data-settings-target]')];
const settingsSections=[...document.querySelectorAll<HTMLElement>('[data-settings-section]')];

let originalMode:ApiKeyStorageMode='session';
let loadedSettingsBaseline:ExtensionSettings|undefined;
let profiles:ApiProfile[]=[];
let currentProfileId='default';
let activeTextProfileId='default';
let visionProfileId='';
let visionSelectionTouched=false;
let visionSetupIntentProfileId='';
let onboardingStep=1;
let onboardingAvailableModels:string[]=[];
let formDirty=false;
let nonConnectionDirty=false;
let activeSettingsRecovery:SettingsRecoveryDescriptor|undefined;
let settingsRecoveryCompleting=false;
const SETTINGS_RECOVERY_TOKEN_KEY='piTranslatorSettingsRecoveryToken';

for(const select of [apiPreset,onboardingPreset]){
  for(const preset of API_PRESETS){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.id==='qwen'?`${preset.name}（PDF 图像推荐）`:preset.name;select.append(option)}
  const custom=document.createElement('option');custom.value='custom';custom.textContent='自定义 OpenAI 兼容 API';select.append(custom);
}
extensionVersion.textContent=browser.runtime.getManifest().version;

function setStatus(message:string,error=false):void{status.textContent=message;status.classList.toggle('error',error)}
function setOnboardingStatus(message:string,error=false):void{onboardingStatus.textContent=message;onboardingStatus.classList.toggle('error',error)}
function setSupportStatus(message:string,error=false):void{supportStatus.textContent=message;supportStatus.classList.toggle('error',error)}
function setSettingsRecoveryStatus(message:string,state:'idle'|'progress'|'success'|'error'='idle'):void{
  settingsRecoveryStatus.textContent=message;
  settingsRecoveryBanner.classList.toggle('in-progress',state==='progress');
  settingsRecoveryBanner.classList.toggle('success',state==='success');
  settingsRecoveryBanner.classList.toggle('error',state==='error');
}
function clearRecoveryTokenFromUrl():void{
  const url=new URL(location.href);
  if(!url.searchParams.has('recovery'))return;
  url.searchParams.delete('recovery');
  history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);
}
function renderSettingsRecovery(recovery:SettingsRecoveryDescriptor):void{
  settingsRecoveryBanner.hidden=false;
  settingsRecoveryTitle.textContent=recovery.role==='vision'
    ? '完成 PDF 图像 API 配置后继续'
    : '完成文字 API 配置后继续';
  settingsRecoveryDescription.textContent=recovery.hadPartialOutput
    ? '刚才的请求已经产生部分译文。验证并保存成功后会返回原页面，由你确认是否重新翻译，避免重复请求。'
    : recovery.autoResume
      ? '验证并保存成功后会返回原页面，继续刚才的翻译，无需重新选择内容。'
      : '刚才的请求可能已经产生部分译文，或需要你确认下一步。验证并保存成功后会返回原页面；扩展不会自动重新发送请求。';
  const remainingMinutes=Math.max(1,Math.ceil((recovery.expiresAt-Date.now())/60_000));
  setSettingsRecoveryStatus(`请完成下方连接验证；恢复通道约在 ${remainingMinutes} 分钟后失效。`);
  refreshModelsButton.textContent='验证、保存并继续';
}
async function claimRequestedSettingsRecovery():Promise<void>{
  const tokenParam=new URLSearchParams(location.search).get('recovery');
  const storedToken=sessionStorage.getItem(SETTINGS_RECOVERY_TOKEN_KEY);
  if(tokenParam===null&&storedToken===null)return;
  const rawToken=(tokenParam??storedToken??'').trim();
  if(tokenParam!==null&&rawToken)sessionStorage.setItem(SETTINGS_RECOVERY_TOKEN_KEY,rawToken);
  clearRecoveryTokenFromUrl();
  if(!rawToken||rawToken.length>256){
    sessionStorage.removeItem(SETTINGS_RECOVERY_TOKEN_KEY);
    settingsRecoveryBanner.hidden=false;
    settingsRecoveryTitle.textContent='无法恢复刚才的翻译';
    settingsRecoveryDescription.textContent='恢复信息无效。你仍可保存 API 设置，然后回到原页面重新选择内容。';
    setSettingsRecoveryStatus('恢复信息无效。','error');
    return;
  }
  let response:SettingsRecoveryResponse;
  try{
    response=await browser.runtime.sendMessage({
      type:'GET_SETTINGS_RECOVERY',
      payload:{token:rawToken},
    } satisfies RuntimeMessage) as SettingsRecoveryResponse;
  }catch(error){
    settingsRecoveryBanner.hidden=false;
    settingsRecoveryTitle.textContent='无法恢复刚才的翻译';
    settingsRecoveryDescription.textContent='暂时无法连接扩展后台。你仍可保存 API 设置，然后手动返回原页面。';
    setSettingsRecoveryStatus(runtimeConnectionErrorMessage(error),'error');
    return;
  }
  if(!response.ok){
    sessionStorage.removeItem(SETTINGS_RECOVERY_TOKEN_KEY);
    settingsRecoveryBanner.hidden=false;
    settingsRecoveryTitle.textContent='无法恢复刚才的翻译';
    settingsRecoveryDescription.textContent='恢复任务可能已经过期。你仍可保存 API 设置，然后回到原页面重新选择内容。';
    setSettingsRecoveryStatus(translationErrorMessage(response.error.code,response.error.message),'error');
    return;
  }
  activeSettingsRecovery=response.data.recovery;
  renderSettingsRecovery(response.data.recovery);
}
async function completeSettingsRecovery(validation:{text:boolean;vision:boolean},configurationRevision:string):Promise<boolean>{
  const recovery=activeSettingsRecovery;
  if(!recovery||settingsRecoveryCompleting)return false;
  const validated=recovery.role==='vision'?validation.vision:validation.text;
  if(!validated)return false;
  settingsRecoveryCompleting=true;
  setSettingsRecoveryStatus(
    recovery.hadPartialOutput||!recovery.autoResume
      ? 'API 已验证并保存，正在返回原页面等待你的确认…'
      : 'API 已验证并保存，正在返回并继续翻译…',
    'progress',
  );
  try{
    const response=await browser.runtime.sendMessage({
      type:'COMPLETE_SETTINGS_RECOVERY',
      payload:{token:recovery.token,configurationRevision},
    } satisfies RuntimeMessage) as CompleteSettingsRecoveryResponse;
    if(!response.ok){
      setSettingsRecoveryStatus(translationErrorMessage(response.error.code,response.error.message),'error');
      return false;
    }
    if(!response.data.returned){
      setSettingsRecoveryStatus('API 已保存，但暂时无法送回原页面。请确认原标签页或 PDF 侧栏仍打开，然后再次点击“验证、保存并继续”。','error');
      return false;
    }
    activeSettingsRecovery=undefined;
    sessionStorage.removeItem(SETTINGS_RECOVERY_TOKEN_KEY);
    refreshModelsButton.textContent='连接并保存';
    setSettingsRecoveryStatus(
      response.data.requiresConfirmation
        ? '已返回原页面；请在那里确认是否重新翻译。'
        : response.data.resumed
          ? '已返回原页面并继续翻译。'
          : '已返回原页面，请继续刚才的操作。',
      'success',
    );
    return true;
  }catch(error){
    setSettingsRecoveryStatus(runtimeConnectionErrorMessage(error),'error');
    return false;
  }finally{
    settingsRecoveryCompleting=false;
  }
}
function currentApiBaseUrl():string{return normalizeApiBaseUrl(apiBaseUrl.value)}
function currentProfile():ApiProfile|undefined{return profiles.find(profile=>profile.id===currentProfileId)}
function activeTextProfile():ApiProfile|undefined{return profiles.find(profile=>profile.id===activeTextProfileId)}
function officialQwenPreset(){return API_PRESETS.find(preset=>preset.id==='qwen')}
function isOfficialQwenProfile(profile:ApiProfile|undefined):boolean{
  return Boolean(profile&&supportsQwenCoordinateOcr(profile.apiBaseUrl));
}
function setDirty():void{formDirty=true;saveState.textContent='有未保存的更改';saveState.classList.add('unsaved')}
function setSaved():void{formDirty=false;nonConnectionDirty=false;saveState.textContent='所有设置已保存';saveState.classList.remove('unsaved')}
function setApiConnectionSaved():void{
  if(nonConnectionDirty){formDirty=true;saveState.textContent='API 已保存，其他更改未保存';saveState.classList.add('unsaved');return}
  setSaved();
}
function showSettingsSection(target:string):void{for(const button of settingsNavButtons){const active=button.dataset.settingsTarget===target;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1}for(const section of settingsSections)section.hidden=section.dataset.settingsSection!==target;if(location.hash!==`#${target}`)history.replaceState(null,'',`#${target}`)}

function activeOnboardingPreset(){return API_PRESETS.find(preset=>preset.id===onboardingPreset.value)}
function providerHint(presetId:string):string {
  const preset=API_PRESETS.find(item=>item.id===presetId);
  if(!preset)return '自定义接口需要在“高级接口设置”中填写 API Base URL；模型可读取或手动输入。';
  return preset.keyHint??`将使用 ${preset.name} 的预设接口地址；连接后读取此 Key 实际可用的模型。`;
}
function refreshProviderHint():void{apiProviderHint.textContent=providerHint(apiPreset.value)}
function applyOnboardingPreset():void{onboardingAvailableModels=[];const preset=activeOnboardingPreset();onboardingBaseUrlField.hidden=Boolean(preset);if(!preset){onboardingBaseUrl.value='';onboardingModel.value='';onboardingKeyHint.textContent='自定义接口需要填写 Base URL；随后会尝试读取当前 Key 可用的模型。';return}onboardingBaseUrl.value=preset.apiBaseUrl;onboardingModel.value=preset.model;onboardingKeyHint.textContent=preset.keyHint??'Key 不会发送给 P&I Lab，也不会写入配置导出文件。';if(preset.id==='ollama'&&!onboardingApiKey.value)onboardingApiKey.value='ollama'}
function showOnboardingStep(step:number):void{onboardingStep=Math.min(3,Math.max(1,step));for(const section of document.querySelectorAll<HTMLElement>('[data-onboarding-step]'))section.hidden=Number(section.dataset.onboardingStep)!==onboardingStep;for(const dot of document.querySelectorAll<HTMLElement>('[data-onboarding-dot]')){const index=Number(dot.dataset.onboardingDot);dot.classList.toggle('active',index===onboardingStep);dot.classList.toggle('complete',index<onboardingStep)}onboardingBack.hidden=onboardingStep===1;onboardingNext.textContent=onboardingStep===1?'下一步':onboardingStep===2?'连接并读取模型':'测试并完成';setOnboardingStatus('')}

async function finishOnboarding():Promise<void>{
  const base=normalizeApiBaseUrl(onboardingBaseUrl.value);
  const apiKey=onboardingApiKey.value.trim();
  const model=onboardingModel.value.trim();
  if(!apiKey)throw new Error('请填写 API Key。');
  if(!model)throw new Error('请填写模型名称。');
  setOnboardingStatus('正在测试文字与图片输入能力…');
  const response=await browser.runtime.sendMessage({type:'TEST_API_CONNECTION',payload:{apiKey,apiBaseUrl:base,model}} satisfies RuntimeMessage) as ConnectionTestResponse;
  if(!response.ok)throw new Error(translationErrorMessage(response.error.code,response.error.message));
  const current=await getSettings();
  const preset=activeOnboardingPreset();
  const profile:ApiProfile={id:current.apiProfiles[0]?.id??crypto.randomUUID(),name:preset?.name??'自定义 API',apiBaseUrl:base,model};
  const visionDetection=await detectVisionModel(profile,onboardingAvailableModels,model,apiKey);
  const visionSupported=Boolean(visionDetection.model);
  const mode:ApiKeyStorageMode=onboardingPersistKey.checked?'local':'session';
  const transaction=await mutateApiConfiguration((latest)=>({
    nextSettings:{...latest,schemaVersion:8,apiProfiles:[profile],activeApiProfileId:profile.id,visionApiProfileId:visionSupported?profile.id:'',visionModel:visionDetection.model??latest.visionModel,apiBaseUrl:base,model,apiKeyStorage:mode,onboardingCompleted:true},
    credentials:{clearAllApiKeys:true,saveApiKey:{apiKey,mode,profileId:profile.id}},
    value:undefined,
  }));
  onboardingApiKey.value='';
  onboardingDialog.close();
  await load();
  if(requestedFocusDeferred)await applyRequestedSettingsFocus();
  setStatus(visionSupported
    ? `首次设置已完成；文字模型为 ${model}，PDF 图像模型为 ${visionDetection.model}。`
    : '首次设置已完成，网页、Overleaf 和可选文字 PDF 已可翻译；需要框选扫描件或使用“识别本页”时，再在连接页配置 Qwen。');
  if(!transaction.revisionId)throw new Error('首次设置未能提交。');
  await completeSettingsRecovery({text:true,vision:visionSupported},transaction.revisionId);
}

function validatedProfiles():ApiProfile[] {
  updateCurrentProfile();
  return profiles.map((profile,index)=>{
    const name=profile.name.trim()||`翻译接口 ${index+1}`;
    let normalizedBaseUrl:string;
    try{normalizedBaseUrl=normalizeApiBaseUrl(profile.apiBaseUrl)}catch{throw new Error(`“${name}”的 API Base URL 不正确。`)}
    const model=profile.model.trim();
    if(!model)throw new Error(`请为“${name}”填写模型名称。`);
    return {...profile,name,apiBaseUrl:normalizedBaseUrl,model};
  });
}

function updateCurrentProfile(normalize=false):void {
  const index=profiles.findIndex(profile=>profile.id===currentProfileId);if(index<0)return;
  const base=normalize?currentApiBaseUrl():apiBaseUrl.value.trim();
  profiles[index]={...profiles[index]!,name:profileName.value.trim()||'未命名配置',apiBaseUrl:base,model:modelInput.value.trim()};
}

function renderProfileSelect():void {
  profileSelect.replaceChildren(...profiles.map(profile=>{const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;return option}));
  profileSelect.value=currentProfileId;deleteProfileButton.disabled=profiles.length<=1;navProfileName.textContent=activeTextProfile()?.name??'未命名配置';renderVisionProfileSelect();
}

function renderProfileRole():void {
  const roles:string[]=[];
  if(currentProfileId===activeTextProfileId)roles.push('文字翻译');
  if(currentProfileId===visionProfileId)roles.push('PDF 图像');
  profileRoleStatus.textContent=`当前配置用途：${roles.length?roles.join(' · '):'尚未分配'}`;
  backToTextProfileButton.hidden=currentProfileId===activeTextProfileId;
  useTextProfileButton.hidden=currentProfileId===activeTextProfileId;
}

function renderVisionProfileSelect():void {
  const empty=document.createElement('option');empty.value='';empty.textContent='尚未配置';
  visionApiProfile.replaceChildren(empty,...profiles.map(profile=>{const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;return option}));
  if(!profiles.some(profile=>profile.id===visionProfileId))visionProfileId='';visionApiProfile.value=visionProfileId;renderProfileRole();void refreshVisionSetupStatus();
}

async function refreshVisionSetupStatus():Promise<void>{
  const profile=profiles.find(item=>item.id===visionProfileId);
  const pendingProfile=profiles.find(item=>item.id===visionSetupIntentProfileId);
  if(!profile){
    setupQwenButton.textContent='配置 Qwen';
    if(pendingProfile){
      const pendingKeyConfigured=(currentProfileId===pendingProfile.id&&Boolean(apiKeyInput.value.trim()))||await hasApiKey(pendingProfile.id);
      if(pendingProfile.id!==visionSetupIntentProfileId)return;
      visionSetupStatus.textContent=pendingKeyConfigured
        ? `正在配置“${pendingProfile.name}”；Key 已填写，连接成功后会自动用于 PDF 图像，文字翻译配置不会改变。`
        : `正在配置“${pendingProfile.name}”；填写 Key 并连接成功后会自动用于 PDF 图像，文字翻译配置不会改变。`;
    }else{
      visionSetupStatus.textContent='尚未配置，不影响普通文字翻译。需要扫描件功能时再补充 Qwen Key 即可。';
    }
    return;
  }
  const profileId=profile.id;
  const keyConfigured=(currentProfileId===profileId&&Boolean(apiKeyInput.value.trim()))||await hasApiKey(profileId);
  if(profileId!==visionProfileId)return;
  const model=visionModel.value.trim()||profile.model;
  const scope=isOfficialQwenProfile(profile)?'框选翻译与“识别本页”':'可用于框选翻译；“识别本页”仍需官方 Qwen';
  visionSetupStatus.textContent=`已配置：${profile.name} · ${model||'待选择模型'} · ${keyConfigured?'Key 已配置':'Key 尚未配置'} · ${scope}`;
  setupQwenButton.textContent=isOfficialQwenProfile(profile)?'管理 Qwen':'配置 Qwen';
}

async function loadProfile(profileId:string):Promise<void>{
  const profile=profiles.find(item=>item.id===profileId);if(!profile)return;currentProfileId=profile.id;profileName.value=profile.name;apiBaseUrl.value=profile.apiBaseUrl;modelInput.value=profile.model;apiPreset.value=API_PRESETS.find(preset=>preset.apiBaseUrl===profile.apiBaseUrl)?.id??'custom';connectionAdvanced.open=apiPreset.value==='custom';refreshProviderHint();apiKeyInput.value='';renderProfileSelect();diagnosticReport.hidden=true;await Promise.all([refreshKeyState(),refreshApiPermissionState()]);
  connectionSummary.hidden=true;
}

function refreshPageModeFields():void {
  const mode=generalPageMode.value as GeneralPageMode;siteAllowlistField.hidden=mode!=='allowlist';
  const messages:Record<GeneralPageMode,string>={off:'普通网页不会显示菜单或浮动按钮。','on-demand':'仅在使用右键菜单、快捷键或手动打开侧栏时临时访问当前网页。',allowlist:'只在指定网站持续启用划词按钮；其他普通网页仍可按需翻译。','all-sites':'会请求所有 HTTP/HTTPS 网站的长期访问权限，以显示划词按钮。'};pageModeHelp.textContent=messages[mode];
}

function refreshPdfShortcutField():void {
  const enabled=pdfKeyboardShortcuts.checked;
  pdfRegionShortcutKey.disabled=!enabled;
  pdfRegionShortcutField.classList.toggle('disabled',!enabled);
}

async function refreshKeyState():Promise<void>{const [configured,activeConfigured]=await Promise.all([hasApiKey(currentProfileId),hasApiKey(activeTextProfileId)]);apiKeyState.textContent=configured?'当前配置已保存 Key；留空可保留':'当前配置尚未保存 Key';navKeyStatus.textContent=activeConfigured?'● Key 已配置':'○ 尚未配置 Key';navKeyStatus.classList.toggle('configured',activeConfigured);await refreshVisionSetupStatus()}
async function refreshApiPermissionState():Promise<void>{try{const base=currentApiBaseUrl();const pattern=apiOriginPattern(base);const granted=await browser.permissions.contains({origins:[pattern]});apiPermissionState.className=`permission-state ${granted?'granted':'pending'}`;apiPermissionState.textContent=granted?`已授权访问 ${new URL(base).origin}`:'保存、测试或诊断时，浏览器会请求访问该 API 域名。'}catch{apiPermissionState.className='permission-state invalid';apiPermissionState.textContent='请填写有效的 API Base URL。'}}

async function requestApiAccess(baseUrl:string):Promise<void>{const granted=await browser.permissions.request({origins:[apiOriginPattern(baseUrl)]});if(!granted)throw new Error('未获得 API 域名访问权限。');await refreshApiPermissionState()}
function enabledApiProfiles(apiProfiles:ApiProfile[],activeProfileId:string,visionProfileId:string,additionalProfileIds:string[]=[]):ApiProfile[]{const requiredIds=new Set([activeProfileId,visionProfileId,...additionalProfileIds].filter(Boolean));return apiProfiles.filter(profile=>requiredIds.has(profile.id))}
async function requestSaveAccess(apiProfiles:ApiProfile[],activeProfileId:string,visionProfileId:string,mode:GeneralPageMode,allowlist:string[],additionalProfileIds:string[]=[]):Promise<void>{const origins=[...enabledApiProfiles(apiProfiles,activeProfileId,visionProfileId,additionalProfileIds).map(profile=>apiOriginPattern(profile.apiBaseUrl)),...getAutoInjectionPatterns(mode,allowlist)];const granted=await browser.permissions.request({origins:[...new Set(origins)]});if(!granted)throw new Error('未获得当前翻译接口或网页所需的访问权限，设置没有保存。');await refreshApiPermissionState()}

async function requestVisionCapabilityTest(profile:ApiProfile,model:string,apiKey=''):Promise<VisionCapabilityTestResponse>{
  return browser.runtime.sendMessage({
    type:'TEST_VISION_CAPABILITY',
    payload:{apiBaseUrl:profile.apiBaseUrl,model,profileId:profile.id,...(apiKey.trim()?{apiKey:apiKey.trim()}: {})},
  } satisfies RuntimeMessage) as Promise<VisionCapabilityTestResponse>;
}

interface VisionDetectionResult {
  model?:string;
  latencyMs?:number;
  error?:string;
  preserved?:boolean;
}

async function detectVisionModel(
  profile:ApiProfile,
  availableModels:string[],
  textModel:string,
  apiKey='',
  preferred='',
):Promise<VisionDetectionResult>{
  const candidates=recommendedVisionModelCandidates(availableModels,textModel,preferred);
  let lastError='当前接口未返回明显支持图片输入的模型。';
  for(const candidate of candidates){
    const response=await requestVisionCapabilityTest(profile,candidate,apiKey);
    if(response.ok)return {model:candidate,latencyMs:response.data.latencyMs};
    lastError=translationErrorMessage(response.error.code,response.error.message);
    if(!['VISION_MODEL_UNSUPPORTED','MODEL_NOT_FOUND'].includes(response.error.code))break;
  }
  return {error:lastError};
}

function setCapabilityStatus(element:HTMLElement,text:string,state:'success'|'muted'='success'):void{
  element.textContent=text;
  element.classList.toggle('success',state==='success');
  element.classList.toggle('muted',state==='muted');
}

function renderConnectionSummary(
  report:ApiDiagnosticReport,
  textModel:string,
  vision:VisionDetectionResult,
):void{
  setCapabilityStatus(connectionTextStatus,report.chatCompletion?`可用 · ${textModel}`:'对话接口验证失败',report.chatCompletion?'success':'muted');
  const formats=[report.structuredOutput?'结构化输出':'完整译文降级',report.sentenceAlignment?'逐句对照':'逐句自动降级'];
  setCapabilityStatus(connectionFormatStatus,formats.join(' · '),report.structuredOutput&&report.sentenceAlignment?'success':'muted');
  if(vision.model){
    const latency=vision.latencyMs?` · ${vision.latencyMs} ms`:'';
    setCapabilityStatus(connectionVisionStatus,`${vision.preserved?'保留现有配置':'可用'} · ${vision.model}${latency}`,vision.preserved?'muted':'success');
  }else{
    setCapabilityStatus(connectionVisionStatus,'未自动启用；文字翻译不受影响','muted');
  }
  connectionSummary.hidden=false;
}

async function autoConfigureVisionProfile(active:ApiProfile):Promise<{attempted:boolean;configured:boolean}>{
  const explicitQwenSetup=visionSetupIntentProfileId===active.id;
  if(!explicitQwenSetup&&(visionProfileId||visionSelectionTouched))return {attempted:false,configured:Boolean(visionProfileId)};
  const model=active.model.trim();
  if(!model)return {attempted:false,configured:false};
  setVisionTestStatus('正在自动检测当前模型的图片输入能力…');
  const response=await requestVisionCapabilityTest(active,model,apiKeyInput.value);
  if(!response.ok){
    setVisionTestStatus(`未自动启用：${translationErrorMessage(response.error.code,response.error.message)}`);
    return {attempted:true,configured:false};
  }
  visionProfileId=active.id;
  visionSetupIntentProfileId='';
  visionModel.value=model;
  renderVisionProfileSelect();
  setVisionTestStatus(`已自动启用 PDF 图像区域翻译 · ${response.data.latencyMs} ms`,'success');
  return {attempted:true,configured:true};
}

async function removeUnusedApiAccess(previous:ApiProfile[],next:ApiProfile[],activeProfileId:string,visionProfileId:string,mode:GeneralPageMode,allowlist:string[]):Promise<void>{
  const retained=new Set([...enabledApiProfiles(next,activeProfileId,visionProfileId).map(profile=>apiOriginPattern(profile.apiBaseUrl)),...getAutoInjectionPatterns(mode,allowlist)]);
  await Promise.allSettled(previous.map(profile=>apiOriginPattern(profile.apiBaseUrl)).filter(origin=>!retained.has(origin)).map(origin=>browser.permissions.remove({origins:[origin]})));
}

async function load():Promise<void>{
  const settings=await getSettings();loadedSettingsBaseline=settings;profiles=settings.apiProfiles.map(profile=>({...profile}));activeTextProfileId=settings.activeApiProfileId;currentProfileId=activeTextProfileId;visionProfileId=settings.visionApiProfileId;visionSelectionTouched=false;visionSetupIntentProfileId='';visionModel.value=settings.visionModel;originalMode=settings.apiKeyStorage;persistKey.checked=settings.apiKeyStorage==='local';sourceLanguage.value=settings.sourceLanguage;targetLanguage.value=settings.targetLanguage;styleSelect.value=settings.style;contentMode.value=settings.contentMode;academicGlossary.value=formatGlossaryEntries(settings.academicGlossary);rememberHistory.checked=settings.rememberRecentTranslations;historyLimit.value=String(settings.historyLimit);sessionCache.checked=settings.enableSessionCache;alignmentDefault.checked=settings.sentenceAlignmentDefault;autoRenderLatex.checked=settings.autoRenderLatex;sidebarSide.value=settings.sidebarSide;contextMode.value=settings.contextMode;enableStreaming.checked=settings.enableStreaming;protectSensitiveFields.checked=settings.protectSensitiveFields;pdfKeyboardShortcuts.checked=settings.pdfKeyboardShortcutsEnabled;pdfRegionShortcutKey.value=settings.pdfRegionShortcutKey.toUpperCase();refreshPdfShortcutField();generalPageMode.value=settings.generalPageMode;siteAllowlist.value=settings.siteAllowlist.join('\n');floatingButton.checked=settings.showFloatingButtonOnOverleaf;hideTargetLanguageTrigger.checked=settings.hideFloatingButtonForTargetLanguage;contextMenu.checked=settings.enableContextMenu;refreshPageModeFields();await loadProfile(currentProfileId);setSaved();if(!settings.onboardingCompleted&&!onboardingDialog.open){onboardingPreset.value=API_PRESETS[0]?.id??'';applyOnboardingPreset();showOnboardingStep(1);onboardingDialog.showModal()}
}

for(const [index,button] of settingsNavButtons.entries()){
  const target=button.dataset.settingsTarget??'connection';button.setAttribute('aria-controls',`settings-${target}`);
  button.addEventListener('click',()=>showSettingsSection(target));
  button.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key))return;event.preventDefault();const delta=event.key==='ArrowDown'||event.key==='ArrowRight'?1:-1;const next=settingsNavButtons[(index+delta+settingsNavButtons.length)%settingsNavButtons.length];if(!next)return;showSettingsSection(next.dataset.settingsTarget??'connection');next.focus()});
}
const requestedSection=location.hash.slice(1);showSettingsSection(settingsSections.some(section=>section.dataset.settingsSection===requestedSection)?requestedSection:'connection');
function markFormDirty(event:Event):void{
  const target=event.target;
  if(target instanceof Element&&!target.closest('#settings-connection'))nonConnectionDirty=true;
  setDirty();
}
form.addEventListener('input',markFormDirty);
form.addEventListener('change',markFormDirty);
window.addEventListener('beforeunload',event=>{if(!formDirty)return;event.preventDefault();event.returnValue=''});

onboardingPreset.addEventListener('change',applyOnboardingPreset);
onboardingBack.addEventListener('click',()=>showOnboardingStep(onboardingStep-1));
onboardingSkip.addEventListener('click',()=>{void(async()=>{await mutateSettings((settings)=>({nextSettings:{...settings,onboardingCompleted:true},value:undefined}));onboardingDialog.close();await load();if(requestedFocusDeferred)await applyRequestedSettingsFocus();setStatus('已进入完整设置，保存后即可开始翻译。')})().catch(()=>setOnboardingStatus('无法关闭首次设置，请重新加载页面。',true))});
onboardingDialog.addEventListener('cancel',()=>{setTimeout(()=>{if(requestedFocusDeferred)void applyRequestedSettingsFocus()},0)});
onboardingNext.addEventListener('click',()=>{void(async()=>{onboardingNext.disabled=true;if(onboardingStep===1){showOnboardingStep(2);return}const base=normalizeApiBaseUrl(onboardingBaseUrl.value);const apiKey=onboardingApiKey.value.trim();if(!apiKey)throw new Error('请填写 API Key。');if(onboardingStep===2){const granted=await browser.permissions.request({origins:[apiOriginPattern(base)]});if(!granted)throw new Error('需要 API 域名访问权限才能继续。');setOnboardingStatus('正在验证 Key 并读取可用模型…');const response=await browser.runtime.sendMessage({type:'LIST_API_MODELS',payload:{apiKey,apiBaseUrl:base}} satisfies RuntimeMessage) as ModelListResponse;let message:string;let error=false;if(response.ok){onboardingAvailableModels=response.data.models;onboardingModelList.replaceChildren(...response.data.models.map(model=>{const option=document.createElement('option');option.value=model;return option}));const suggested=recommendedTextModel(response.data.models,onboardingModel.value);if(suggested)onboardingModel.value=suggested;message=response.data.models.length?`连接成功，已自动推荐文字模型 ${onboardingModel.value}；下一步会检测图片输入能力。`:'Key 验证成功，但接口未返回模型列表，请手动填写模型 ID。'}else{onboardingAvailableModels=[];message=`${translationErrorMessage(response.error.code,response.error.message)} 仍可在下一步核对并手动填写模型。`;error=true}showOnboardingStep(3);setOnboardingStatus(message,error);return}await finishOnboarding()})().catch((error:unknown)=>setOnboardingStatus(error instanceof Error?error.message:'首次设置失败。',true)).finally(()=>{onboardingNext.disabled=false})});

apiBaseUrl.addEventListener('input',()=>{apiPreset.value='custom';connectionAdvanced.open=true;connectionSummary.hidden=true;refreshProviderHint();void refreshApiPermissionState()});generalPageMode.addEventListener('change',refreshPageModeFields);
pdfKeyboardShortcuts.addEventListener('change',refreshPdfShortcutField);
pdfRegionShortcutKey.addEventListener('input',()=>{
  const letter=pdfRegionShortcutKey.value.match(/[a-z]/i)?.[0]??'';
  pdfRegionShortcutKey.value=letter.toUpperCase();
});
apiPreset.addEventListener('change',()=>{connectionSummary.hidden=true;const preset=API_PRESETS.find(item=>item.id===apiPreset.value);if(!preset){apiBaseUrl.value='';modelInput.value='';connectionAdvanced.open=true;refreshProviderHint();updateCurrentProfile();void refreshApiPermissionState();setStatus('请在高级接口设置中填写自定义 API Base URL，然后连接并保存。');queueMicrotask(()=>apiBaseUrl.focus());return}apiBaseUrl.value=preset.apiBaseUrl;modelInput.value=preset.model;if(/^(?:默认接口|未命名配置)$/u.test(profileName.value.trim()))profileName.value=preset.name;connectionAdvanced.open=false;refreshProviderHint();updateCurrentProfile();void refreshApiPermissionState();setStatus(`已配置 ${preset.name} 接口；填写 Key 后点击“连接并保存”。`)});
profileSelect.addEventListener('change',()=>{if(apiKeyInput.value.trim()){profileSelect.value=currentProfileId;setStatus('请先保存当前输入的 API Key，再切换配置。',true);return}updateCurrentProfile();void loadProfile(profileSelect.value)});
profileName.addEventListener('input',()=>{const profile=currentProfile();if(profile){profile.name=profileName.value.trim()||'未命名配置';renderProfileSelect()}});
visionApiProfile.addEventListener('change',()=>{visionProfileId=visionApiProfile.value;visionSetupIntentProfileId='';visionSelectionTouched=true;const profile=profiles.find(item=>item.id===visionProfileId);if(profile)visionModel.value=profile.model;renderProfileRole();void refreshVisionSetupStatus();setDirty()});
function setVisionTestStatus(message:string,state:'idle'|'success'|'error'='idle'):void{visionTestStatus.textContent=message;visionTestStatus.classList.toggle('success',state==='success');visionTestStatus.classList.toggle('error',state==='error')}
visionApiProfile.addEventListener('change',()=>setVisionTestStatus('发送一张内置的 130×58 高对比字符测试图，不含文档内容。'));
visionModel.addEventListener('input',()=>setVisionTestStatus('模型已更改，请重新测试视觉能力。'));

setupQwenButton.addEventListener('click',()=>{void(async()=>{
  updateCurrentProfile();
  const preset=officialQwenPreset();
  if(!preset)throw new Error('当前版本缺少 Qwen 官方接口预设。');
  let profile=profiles.find(item=>isOfficialQwenProfile(item));
  let created=false;
  if(!profile){
    if(profiles.length>=6)throw new Error('API 配置已达到 6 个上限，请先删除一个不再使用的配置。');
    profile={id:crypto.randomUUID(),name:preset.name,apiBaseUrl:preset.apiBaseUrl,model:preset.model};
    profiles.push(profile);
    created=true;
  }
  visionSetupIntentProfileId=profile.id;
  await loadProfile(profile.id);
  apiPreset.value='qwen';
  refreshProviderHint();
  visionSetupDetails.open=false;
  if(created)setDirty();
  const textProfile=activeTextProfile();
  const keyConfigured=await hasApiKey(profile.id);
  const nextAction=keyConfigured?'Qwen Key 已保存，请点击“连接并保存”重新读取模型。':'请填写 Qwen Key，然后点击“连接并保存”。';
  setStatus(textProfile?.id===profile.id
    ? `Qwen 也将继续用于文字翻译。${nextAction}`
    : `${nextAction} 文字翻译仍使用“${textProfile?.name??'现有配置'}”，不会被替换。`);
  queueMicrotask(()=>apiKeyInput.focus());
})().catch((error:unknown)=>setStatus(error instanceof Error?error.message:'无法开始配置 Qwen。',true))});

addProfileButton.addEventListener('click',()=>{if(profiles.length>=6){setStatus('最多保存 6 个 API 配置。',true);return}updateCurrentProfile();const id=crypto.randomUUID();profiles.push({id,name:`翻译接口 ${profiles.length+1}`,apiBaseUrl:apiBaseUrl.value.trim(),model:modelInput.value.trim()});void loadProfile(id);setDirty();setStatus('已创建新配置，填写后请保存设置。')});
backToTextProfileButton.addEventListener('click',()=>{
  if(apiKeyInput.value.trim()){setStatus('当前输入的 Key 尚未连接保存；请先点击“连接并保存”，再返回文字 API。',true);apiKeyInput.focus();return}
  const textProfile=activeTextProfile();
  if(!textProfile){setStatus('当前没有可返回的文字翻译 API。',true);return}
  updateCurrentProfile();
  void loadProfile(textProfile.id).then(()=>setStatus(visionProfileId?`已返回文字 API“${textProfile.name}”；PDF 图像配置仍保留。`:`已返回文字 API“${textProfile.name}”。`));
});
useTextProfileButton.addEventListener('click',()=>{updateCurrentProfile();activeTextProfileId=currentProfileId;renderProfileSelect();setDirty();setStatus(`保存后将使用“${currentProfile()?.name??'当前配置'}”进行文字翻译。`)});
deleteProfileButton.addEventListener('click',()=>{if(profiles.length<=1)return;const deletedId=currentProfileId;profiles=profiles.filter(profile=>profile.id!==currentProfileId);if(visionProfileId===deletedId)visionProfileId='';if(visionSetupIntentProfileId===deletedId)visionSetupIntentProfileId='';if(activeTextProfileId===deletedId)activeTextProfileId=profiles[0]!.id;void loadProfile(profiles[0]!.id);setDirty();setStatus('配置已从草稿中删除，点击“保存设置”后生效。')});

form.addEventListener('submit',event=>{event.preventDefault();const mode=generalPageMode.value as GeneralPageMode;const allowlist=normalizeSiteAllowlist(siteAllowlist.value.split(/\r?\n|,/));const glossary=parseGlossaryText(academicGlossary.value);try{profiles=validatedProfiles();renderProfileSelect()}catch(error){showSettingsSection('connection');setStatus(error instanceof Error?error.message:'API 配置不正确。',true);return}if(mode==='allowlist'&&!allowlist.length){showSettingsSection('pages');siteAllowlist.focus();setStatus('请至少填写一个有效的网站域名。',true);return}if(glossary.errors.length){showSettingsSection('translation');const details=academicGlossary.closest('details');if(details)details.open=true;academicGlossary.focus();setStatus(glossary.errors[0]??'术语表格式不正确。',true);return}
  if(pdfKeyboardShortcuts.checked&&!/^[a-z]$/i.test(pdfRegionShortcutKey.value.trim())){showSettingsSection('results');const details=pdfRegionShortcutKey.closest('details');if(details)details.open=true;pdfRegionShortcutKey.focus();setStatus('Pi PDF 框选键需要是一个英文字母。',true);return}
  void(async()=>{
    const editing=currentProfile()!;
    const active=activeTextProfile()??editing;
    const pendingKey=apiKeyInput.value.trim();
    await requestSaveAccess(profiles,active.id,visionProfileId,mode,allowlist,pendingKey?[editing.id]:[]);
    const autoVision=await autoConfigureVisionProfile(editing);
    const keyMode:ApiKeyStorageMode=persistKey.checked?'local':'session';
    const baseline=loadedSettingsBaseline??await getSettings();
    const visionProfile=profiles.find(profile=>profile.id===visionProfileId);
    const draft:ExtensionSettings={
      ...baseline,
      schemaVersion:8,
      apiProfiles:profiles.map(profile=>({...profile})),
      activeApiProfileId:active.id,
      visionApiProfileId:visionProfileId,
      visionModel:visionModel.value.trim()||visionProfile?.model||active.model,
      apiBaseUrl:active.apiBaseUrl,
      model:active.model,
      sourceLanguage:sourceLanguage.value,
      targetLanguage:targetLanguage.value,
      style:styleSelect.value as TranslationStyle,
      contentMode:contentMode.value as ContentMode,
      apiKeyStorage:keyMode,
      academicGlossary:glossary.entries,
      rememberRecentTranslations:rememberHistory.checked,
      historyLimit:Number(historyLimit.value) as HistoryLimit,
      enableSessionCache:sessionCache.checked,
      sentenceAlignmentDefault:alignmentDefault.checked,
      autoRenderLatex:autoRenderLatex.checked,
      sidebarSide:sidebarSide.value as SidebarSide,
      contextMode:contextMode.value as ContextMode,
      enableStreaming:enableStreaming.checked,
      protectSensitiveFields:protectSensitiveFields.checked,
      pdfKeyboardShortcutsEnabled:pdfKeyboardShortcuts.checked,
      pdfRegionShortcutKey:normalizePdfRegionShortcutKey(pdfRegionShortcutKey.value),
      showFloatingButtonOnOverleaf:floatingButton.checked,
      hideFloatingButtonForTargetLanguage:hideTargetLanguageTrigger.checked,
      generalPageMode:mode,
      siteAllowlist:allowlist,
      enableContextMenu:contextMenu.checked,
      onboardingCompleted:true,
    };
    const transaction=await mutateApiConfiguration((latest)=>{
      const merged=mergeSettingsDraft(baseline,draft,latest);
      if(pendingKey)merged.settings.apiKeyStorage=keyMode;
      const clearProfileIds=changedApiCredentialProfileIds(latest.apiProfiles,merged.settings.apiProfiles);
      const baselineEditingProfile=baseline.apiProfiles.find(profile=>profile.id===editing.id);
      return {
        nextSettings:merged.settings,
        credentials:{
          ...(pendingKey&&baselineEditingProfile?{requireCurrentProfiles:[{id:baselineEditingProfile.id,apiBaseUrl:baselineEditingProfile.apiBaseUrl}]}:{}),
          clearProfileIds,
          ...(keyMode!==latest.apiKeyStorage?{moveApiKeysTo:keyMode}:{}),
          ...(pendingKey?{saveApiKey:{apiKey:pendingKey,mode:keyMode,profileId:editing.id}}:{}),
        },
        value:{
          previous:latest,
          next:merged.settings,
          removedProfileIds:merged.removedProfileIds,
        },
      };
    });
    const {previous:current,next}=transaction.value;
    if(pendingKey)apiKeyInput.value='';
    await removeUnusedApiAccess(current.apiProfiles,next.apiProfiles,next.activeApiProfileId,next.visionApiProfileId,next.generalPageMode,next.siteAllowlist);
    activeTextProfileId=active.id;
    originalMode=keyMode;
    // Keep the baseline aligned with what the form still shows. Unseen
    // concurrent changes remain outside it and will be preserved next time.
    loadedSettingsBaseline=draft;
    visionSelectionTouched=false;
    renderProfileSelect();
    await refreshKeyState();
    setSaved();
    const roleMessage=active.id!==editing.id&&visionProfileId===editing.id
      ?`设置已保存：文字继续使用“${active.name}”，PDF 图像使用“${editing.name}”。`
      :autoVision.configured&&autoVision.attempted
        ?'设置已保存，并已自动启用 PDF 图像区域翻译。'
        :autoVision.attempted
          ?'设置已保存；当前模型未通过图片输入检测，文字翻译不受影响。'
          :'设置已保存，并已同步到打开的页面。';
    setStatus(roleMessage);
  })().catch((error:unknown)=>setStatus(error instanceof Error?error.message:'保存设置失败。',true));
});

async function persistConnectedApiConfiguration(message:string):Promise<string>{
  profiles=validatedProfiles();
  const editing=currentProfile();
  const active=activeTextProfile()??editing;
  if(!editing||!active)throw new Error('当前 API 配置不存在，请重新加载设置页。');
  const keyMode:ApiKeyStorageMode=persistKey.checked?'local':'session';
  const pendingKey=apiKeyInput.value.trim();
  const visionProfile=profiles.find(profile=>profile.id===visionProfileId);
  const baseline=loadedSettingsBaseline??await getSettings();
  const draft:ExtensionSettings={
    ...baseline,
    schemaVersion:8,
    apiProfiles:profiles.map(profile=>({...profile})),
    activeApiProfileId:active.id,
    visionApiProfileId:visionProfileId,
    visionModel:visionProfile?(visionModel.value.trim()||visionProfile.model):'',
    apiBaseUrl:active.apiBaseUrl,
    model:active.model,
    apiKeyStorage:keyMode,
    onboardingCompleted:true,
  };
  const transaction=await mutateApiConfiguration((latest)=>{
    const merged=mergeSettingsDraft(baseline,draft,latest);
    if(pendingKey)merged.settings.apiKeyStorage=keyMode;
    const clearProfileIds=changedApiCredentialProfileIds(latest.apiProfiles,merged.settings.apiProfiles);
    const baselineEditingProfile=baseline.apiProfiles.find(profile=>profile.id===editing.id);
    return {
      nextSettings:merged.settings,
      credentials:{
        ...(pendingKey&&baselineEditingProfile?{requireCurrentProfiles:[{id:baselineEditingProfile.id,apiBaseUrl:baselineEditingProfile.apiBaseUrl}]}:{}),
        clearProfileIds,
        ...(keyMode!==latest.apiKeyStorage?{moveApiKeysTo:keyMode}:{}),
        ...(pendingKey?{saveApiKey:{apiKey:pendingKey,mode:keyMode,profileId:editing.id}}:{}),
      },
      value:{
        previous:latest,
        next:merged.settings,
        removedProfileIds:merged.removedProfileIds,
      },
    };
  });
  const {previous:current,next}=transaction.value;
  if(pendingKey)apiKeyInput.value='';
  if(!transaction.revisionId)throw new Error('API 配置未能提交。');
  const configurationRevision=transaction.revisionId;
  await removeUnusedApiAccess(current.apiProfiles,next.apiProfiles,next.activeApiProfileId,next.visionApiProfileId,next.generalPageMode,next.siteAllowlist);
  activeTextProfileId=active.id;
  originalMode=keyMode;
  loadedSettingsBaseline=draft;
  visionSelectionTouched=false;
  renderProfileSelect();
  await refreshKeyState();
  setApiConnectionSaved();
  setStatus(message);
  return configurationRevision;
}

async function callModels():Promise<void>{
  const apiKey=apiKeyInput.value.trim();
  if(!apiKey&&!await hasApiKey(currentProfileId))throw new Error('请先填写 API Key，再连接并保存。');
  const base=currentApiBaseUrl();
  await requestApiAccess(base);
  refreshModelsButton.disabled=true;
  connectionSummary.hidden=true;
  setStatus('正在读取可用模型…');
  const response=await browser.runtime.sendMessage({type:'LIST_API_MODELS',payload:{apiBaseUrl:base,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ModelListResponse;
  if(!response.ok){setStatus(translationErrorMessage(response.error.code,response.error.message),true);return}
  modelList.replaceChildren(...response.data.models.map(model=>{const option=document.createElement('option');option.value=model;return option}));
  const suggested=recommendedTextModel(response.data.models,modelInput.value.trim())??modelInput.value.trim();
  if(!suggested){setStatus('接口没有返回模型列表，请手动填写模型 ID 后使用“仅验证当前模型”。',true);return}
  if(suggested!==modelInput.value.trim()){modelInput.value=suggested;updateCurrentProfile();setDirty()}
  const active={...(currentProfile()??{id:currentProfileId,name:'当前接口',apiBaseUrl:base,model:suggested}),apiBaseUrl:base,model:suggested};
  setStatus(`已读取 ${response.data.models.length} 个模型，正在验证文字模型 ${suggested}…`);
  const diagnostic=await browser.runtime.sendMessage({type:'DIAGNOSE_API',payload:{apiBaseUrl:base,model:suggested,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ApiDiagnosticResponse;
  if(!diagnostic.ok){setStatus(translationErrorMessage(diagnostic.error.code,diagnostic.error.message),true);return}
  let vision:VisionDetectionResult;
  const guidedTextRecovery=activeSettingsRecovery?.role==='text';
  const configureCurrentForVision=!guidedTextRecovery&&(
    activeSettingsRecovery?.role==='vision'||!visionProfileId||visionSetupIntentProfileId===active.id
  );
  if(!configureCurrentForVision){
    const configuredProfile=profiles.find(profile=>profile.id===visionProfileId);
    const configuredModel=visionModel.value.trim()||configuredProfile?.model;
    vision=configuredModel?{model:configuredModel,preserved:true}:{preserved:true};
  }else{
    setStatus(`文字模型 ${suggested} 可用，正在检测 PDF 图片输入能力…`);
    vision=await detectVisionModel(active,response.data.models,suggested,apiKey,visionModel.value);
    if(vision.model){visionProfileId=active.id;visionSetupIntentProfileId='';visionModel.value=vision.model;renderVisionProfileSelect();setVisionTestStatus(`已自动启用 PDF 图像区域翻译 · ${vision.model}${vision.latencyMs?` · ${vision.latencyMs} ms`:''}`,'success')}
    else setVisionTestStatus('当前接口未检测到可用的图片模型；文字翻译不受影响。');
  }
  renderConnectionSummary(diagnostic.data,suggested,vision);
  void refreshVisionSetupStatus();
  setDirty();
  const separateText=vision.model&&activeTextProfileId!==active.id?activeTextProfile():undefined;
  const configuredVision=profiles.find(profile=>profile.id===visionProfileId);
  const savedMessage=vision.preserved
    ? configuredVision
      ? `自动配置完成并已保存：保留现有 PDF 图像配置“${configuredVision.name}”。`
      : `文字模型 ${suggested} 已连接并保存；本次只修复文字翻译，PDF 图像能力可稍后按需配置。`
    : separateText
      ? `自动配置完成并已保存：PDF 图像使用“${active.name}”，文字继续使用“${separateText.name}”。`
      : vision.model
        ? `自动配置完成并已保存：文字使用 ${suggested}，PDF 图像使用 ${vision.model}。`
        : `文字模型 ${suggested} 已连接并保存；普通文字翻译可用。需要扫描件功能时再配置 Qwen。`;
  const configurationRevision=await persistConnectedApiConfiguration(savedMessage);
  await completeSettingsRecovery({text:true,vision:Boolean(vision.model)&&!vision.preserved},configurationRevision);
}
refreshModelsButton.addEventListener('click',()=>void callModels().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{refreshModelsButton.disabled=false}));

testButton.addEventListener('click',()=>{
  const model=modelInput.value.trim();
  if(!model){setStatus('请先填写模型名称。',true);return}
  void(async()=>{
    const base=currentApiBaseUrl();
    await requestApiAccess(base);
    testButton.disabled=true;
    setStatus('正在测试 API、Key 与模型…');
    const apiKey=apiKeyInput.value.trim();
    const response=await browser.runtime.sendMessage({type:'TEST_API_CONNECTION',payload:{apiBaseUrl:base,model,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ConnectionTestResponse;
    if(!response.ok){setStatus(translationErrorMessage(response.error.code,response.error.message),true);return}
    if(activeSettingsRecovery?.role==='text'){
      const configurationRevision=await persistConnectedApiConfiguration('连接成功，API Key 与模型可用，当前配置已保存。');
      await completeSettingsRecovery({text:true,vision:false},configurationRevision);
      return;
    }
    setStatus('连接成功，API Key 与模型可用。');
  })().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{testButton.disabled=false});
});

testVisionCapabilityButton.addEventListener('click',()=>{void(async()=>{
  updateCurrentProfile();
  const profile=profiles.find(item=>item.id===visionProfileId);
  const model=visionModel.value.trim();
  if(!profile){setVisionTestStatus('请先选择视觉 API 配置。','error');return}
  if(!model){setVisionTestStatus('请先填写支持图片输入的视觉模型。','error');return}
  await requestApiAccess(profile.apiBaseUrl);
  testVisionCapabilityButton.disabled=true;
  setVisionTestStatus('正在验证图片输入、API Key 与模型…');
  const pendingKey=profile.id===currentProfileId?apiKeyInput.value.trim():'';
  const response=await requestVisionCapabilityTest(profile,model,pendingKey);
  if(!response.ok){setVisionTestStatus(translationErrorMessage(response.error.code,response.error.message),'error');return}
  setVisionTestStatus(`视觉能力可用 · ${response.data.latencyMs} ms`,'success');
  if(activeSettingsRecovery?.role==='vision'){
    visionProfileId=profile.id;
    visionModel.value=model;
    visionSelectionTouched=true;
    renderVisionProfileSelect();
    const configurationRevision=await persistConnectedApiConfiguration('视觉能力验证成功，当前 PDF 图像配置已保存。');
    await completeSettingsRecovery({text:false,vision:true},configurationRevision);
  }
})().catch((error:unknown)=>setVisionTestStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),'error')).finally(()=>{testVisionCapabilityButton.disabled=false})});

function diagnosticItem(label:string,value:string):HTMLElement{const item=document.createElement('div');item.className='diagnostic-item';item.textContent=label;const strong=document.createElement('strong');strong.textContent=value;item.append(strong);return item}
function renderDiagnostic(report:ApiDiagnosticReport):void{diagnosticReport.replaceChildren();const heading=document.createElement('h3');heading.textContent=`兼容性诊断 · ${report.origin}`;const grid=document.createElement('div');grid.className='diagnostic-grid';grid.append(diagnosticItem('域名权限',report.permissionGranted?'通过':'未授权'),diagnosticItem('鉴权与模型',report.authenticated&&report.configuredModelAvailable?'通过':'需检查'),diagnosticItem('模型数量',String(report.modelCount)),diagnosticItem('对话接口',report.chatCompletion?'通过':'失败'),diagnosticItem('结构化输出',report.structuredOutput?'支持':'自动降级'),diagnosticItem('逐句对照',report.sentenceAlignment?'支持':'自动降级'),diagnosticItem('诊断耗时',report.latencyMs?`${report.latencyMs} ms`:'—'));diagnosticReport.append(heading,grid);if(report.notes.length){const notes=document.createElement('ul');notes.className='diagnostic-notes';for(const message of report.notes){const item=document.createElement('li');item.textContent=message;notes.append(item)}diagnosticReport.append(notes)}diagnosticReport.hidden=false}
diagnoseButton.addEventListener('click',()=>{const model=modelInput.value.trim();if(!model){setStatus('请先填写模型名称。',true);return}void(async()=>{const base=currentApiBaseUrl();await requestApiAccess(base);diagnoseButton.disabled=true;diagnosticReport.hidden=true;setStatus('正在执行一次低消耗兼容性诊断…');const apiKey=apiKeyInput.value.trim();const response=await browser.runtime.sendMessage({type:'DIAGNOSE_API',payload:{apiBaseUrl:base,model,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ApiDiagnosticResponse;if(!response.ok){setStatus(translationErrorMessage(response.error.code,response.error.message),true);return}renderDiagnostic(response.data);setStatus('诊断完成。逐句或结构化输出不支持时，扩展会自动降级为完整译文。')})().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{diagnoseButton.disabled=false})});

clearButton.addEventListener('click',()=>void clearApiKey(currentProfileId).then(async()=>{apiKeyInput.value='';await refreshKeyState();setStatus('当前 API 配置的 Key 已清除。')}).catch(()=>setStatus('清除 API Key 失败。',true)));
shortcutsButton.addEventListener('click',()=>void browser.tabs.create({url:'edge://extensions/shortcuts'}));
restartOnboardingButton.addEventListener('click',()=>{const current=currentProfile();const matching=API_PRESETS.find(preset=>preset.apiBaseUrl===current?.apiBaseUrl);onboardingPreset.value=matching?.id??'custom';applyOnboardingPreset();if(current){onboardingBaseUrl.value=current.apiBaseUrl;onboardingModel.value=current.model}onboardingApiKey.value='';showOnboardingStep(1);onboardingDialog.showModal()});
exportSettingsButton.addEventListener('click',()=>{void(async()=>{const settings=await getSettings();const content=exportSettingsConfiguration(settings);const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`pi-translator-settings-${new Date().toISOString().slice(0,10)}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setSupportStatus('配置已导出，文件中不包含任何 API Key。')})().catch(()=>setSupportStatus('导出配置失败。',true))});
importSettingsButton.addEventListener('click',()=>importSettingsFile.click());
importSettingsFile.addEventListener('change',()=>{const file=importSettingsFile.files?.[0];if(!file)return;void(async()=>{const serialized=await file.text();await mutateApiConfiguration((latest)=>({nextSettings:importSettingsConfiguration(serialized,latest),credentials:{clearAllApiKeys:true},value:undefined}));await load();setSupportStatus('配置已导入。出于安全考虑，所有 API Key 已清除；请重新填写 Key 并保存以授权接口域名。')})().catch((error:unknown)=>setSupportStatus(error instanceof Error?error.message:'导入配置失败。',true)).finally(()=>{importSettingsFile.value=''})});
copyDiagnosticReportButton.addEventListener('click',()=>{void(async()=>{const response=await browser.runtime.sendMessage({type:'GET_LOCAL_DIAGNOSTIC_REPORT'} satisfies RuntimeMessage) as LocalDiagnosticReportResponse;if(!response.ok)throw new Error(response.error.message);await navigator.clipboard.writeText(response.data.report);setSupportStatus('诊断报告已复制；不包含 API Key、选区、译文或网站名称。')})().catch(()=>setSupportStatus('复制诊断报告失败，请检查剪贴板权限。',true))});
let requestedFocusDeferred=false;
async function applyRequestedSettingsFocus():Promise<void>{
  if(onboardingDialog.open){requestedFocusDeferred=true;return}
  requestedFocusDeferred=false;
  const focus=new URLSearchParams(location.search).get('focus');
  if(focus==='vision-ocr'){
    showSettingsSection('connection');visionSetupDetails.open=true;setupQwenButton.scrollIntoView({block:'center'});queueMicrotask(()=>setupQwenButton.focus());return;
  }
  if(focus==='vision'||focus==='vision-model'||focus==='vision-permission'){
    showSettingsSection('connection');visionSetupDetails.open=true;
    if(visionProfileId&&profiles.some(profile=>profile.id===visionProfileId)){
      if(currentProfileId!==visionProfileId)await loadProfile(visionProfileId);
      const target=focus==='vision-model'
        ? visionModel
        : focus==='vision-permission'
          ? testVisionCapabilityButton
          : apiKeyInput;
      target.scrollIntoView({block:'center'});queueMicrotask(()=>target.focus());return;
    }
    visionSetupDetails.scrollIntoView({block:'center'});queueMicrotask(()=>setupQwenButton.focus());return;
  }
  if(focus==='support'){
    showSettingsSection('support');const disclosure=copyDiagnosticReportButton.closest<HTMLDetailsElement>('details');if(disclosure)disclosure.open=true;copyDiagnosticReportButton.scrollIntoView({block:'center'});queueMicrotask(()=>copyDiagnosticReportButton.focus());return;
  }
  if(focus==='api'||focus==='api-model'||focus==='api-permission'){
    const target=focus==='api-model'
      ? modelInput
      : focus==='api-permission'
        ? testButton
        : apiKeyInput;
    showSettingsSection('connection');queueMicrotask(()=>{target.scrollIntoView({block:'center'});target.focus()});
  }
}
void load()
  .then(async()=>{
    await claimRequestedSettingsRecovery();
    await applyRequestedSettingsFocus();
  })
  .catch(()=>setStatus('读取设置失败，请重新加载页面。',true));
