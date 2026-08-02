import type {
  ApiDiagnosticReport,
  ApiDiagnosticResponse,
  ConnectionTestResponse,
  VisionCapabilityTestResponse,
  LocalDiagnosticReportResponse,
  ModelListResponse,
  RuntimeMessage,
} from '../../core/messaging/messages';
import { runtimeConnectionErrorMessage, translationErrorMessage } from '../../core/messaging/user-facing-error';
import { apiOriginPattern, normalizeApiBaseUrl } from '../../core/settings/api-access';
import { API_PRESETS } from '../../core/settings/api-presets';
import {
  exportSettingsConfiguration,
  importSettingsConfiguration,
} from '../../core/settings/config-transfer';
import {
  clearApiKey,
  getSettings,
  hasApiKey,
  moveApiKey,
  saveApiKey,
  saveSettings,
} from '../../core/settings/repository';
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
import { formatGlossaryEntries, parseGlossaryText } from '../../core/translation/glossary';
import type { TranslationStyle } from '../../core/translation/types';

function element<T extends HTMLElement>(id: string): T {
  const value=document.getElementById(id);if(!value)throw new Error(`Missing options element #${id}`);return value as T;
}

const form=element<HTMLFormElement>('settings-form');
const profileSelect=element<HTMLSelectElement>('api-profile');
const addProfileButton=element<HTMLButtonElement>('add-profile');
const deleteProfileButton=element<HTMLButtonElement>('delete-profile');
const profileName=element<HTMLInputElement>('profile-name');
const apiPreset=element<HTMLSelectElement>('api-preset');
const apiBaseUrl=element<HTMLInputElement>('api-base-url');
const apiPermissionState=element<HTMLElement>('api-permission-state');
const apiKeyInput=element<HTMLInputElement>('api-key');
const apiKeyState=element<HTMLElement>('api-key-state');
const persistKey=element<HTMLInputElement>('persist-key');
const modelInput=element<HTMLInputElement>('model');
const modelList=element<HTMLDataListElement>('model-list');
const refreshModelsButton=element<HTMLButtonElement>('refresh-models');
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
const diagnosticReport=element<HTMLElement>('diagnostic-report');
const shortcutsButton=element<HTMLButtonElement>('open-shortcuts');
const onboardingDialog=element<HTMLDialogElement>('onboarding-dialog');
const onboardingPreset=element<HTMLSelectElement>('onboarding-preset');
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
const settingsNavButtons=[...document.querySelectorAll<HTMLButtonElement>('[data-settings-target]')];
const settingsSections=[...document.querySelectorAll<HTMLElement>('[data-settings-section]')];

let originalMode:ApiKeyStorageMode='session';
let loadedSettings:ExtensionSettings|undefined;
let profiles:ApiProfile[]=[];
let currentProfileId='default';
let visionProfileId='';
let visionSelectionTouched=false;
let onboardingStep=1;
let formDirty=false;

for(const preset of API_PRESETS){for(const select of [apiPreset,onboardingPreset]){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.name;select.append(option)}}

function setStatus(message:string,error=false):void{status.textContent=message;status.classList.toggle('error',error)}
function setOnboardingStatus(message:string,error=false):void{onboardingStatus.textContent=message;onboardingStatus.classList.toggle('error',error)}
function setSupportStatus(message:string,error=false):void{supportStatus.textContent=message;supportStatus.classList.toggle('error',error)}
function currentApiBaseUrl():string{return normalizeApiBaseUrl(apiBaseUrl.value)}
function currentProfile():ApiProfile|undefined{return profiles.find(profile=>profile.id===currentProfileId)}
function setDirty():void{formDirty=true;saveState.textContent='有未保存的更改';saveState.classList.add('unsaved')}
function setSaved():void{formDirty=false;saveState.textContent='所有设置已保存';saveState.classList.remove('unsaved')}
function showSettingsSection(target:string):void{for(const button of settingsNavButtons){const active=button.dataset.settingsTarget===target;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1}for(const section of settingsSections)section.hidden=section.dataset.settingsSection!==target;if(location.hash!==`#${target}`)history.replaceState(null,'',`#${target}`)}

function activeOnboardingPreset(){return API_PRESETS.find(preset=>preset.id===onboardingPreset.value)}
function applyOnboardingPreset():void{const preset=activeOnboardingPreset();if(!preset){onboardingBaseUrl.value='';onboardingModel.value='';onboardingKeyHint.textContent='填写任意 OpenAI 兼容接口的 Base URL、API Key 与模型名称。';return}onboardingBaseUrl.value=preset.apiBaseUrl;onboardingModel.value=preset.model;onboardingKeyHint.textContent=preset.keyHint??'Key 不会发送给 P&I Lab，也不会写入配置导出文件。';if(preset.id==='ollama'&&!onboardingApiKey.value)onboardingApiKey.value='ollama'}
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
  const visionResponse=await requestVisionCapabilityTest(profile,model,apiKey);
  const visionSupported=visionResponse.ok;
  const mode:ApiKeyStorageMode=onboardingPersistKey.checked?'local':'session';
  const next:ExtensionSettings={...current,schemaVersion:8,apiProfiles:[profile],activeApiProfileId:profile.id,visionApiProfileId:visionSupported?profile.id:'',visionModel:visionSupported?model:current.visionModel,apiBaseUrl:base,model,apiKeyStorage:mode,onboardingCompleted:true};
  await saveSettings(next);
  await saveApiKey(apiKey,mode,profile.id);
  onboardingApiKey.value='';
  onboardingDialog.close();
  await load();
  setStatus(visionSupported?'首次设置已完成，并已自动启用 PDF 图像框选翻译。':'首次设置已完成；当前模型未通过图片输入检测，文字翻译可以正常使用。');
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
  profileSelect.value=currentProfileId;deleteProfileButton.disabled=profiles.length<=1;navProfileName.textContent=currentProfile()?.name??'未命名配置';renderVisionProfileSelect();
}

function renderVisionProfileSelect():void {
  const empty=document.createElement('option');empty.value='';empty.textContent='尚未配置';
  visionApiProfile.replaceChildren(empty,...profiles.map(profile=>{const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;return option}));
  if(!profiles.some(profile=>profile.id===visionProfileId))visionProfileId='';visionApiProfile.value=visionProfileId;
}

async function loadProfile(profileId:string):Promise<void>{
  const profile=profiles.find(item=>item.id===profileId);if(!profile)return;currentProfileId=profile.id;profileName.value=profile.name;apiBaseUrl.value=profile.apiBaseUrl;modelInput.value=profile.model;apiPreset.value=API_PRESETS.find(preset=>preset.apiBaseUrl===profile.apiBaseUrl&&(!preset.model||preset.model===profile.model))?.id??'custom';apiKeyInput.value='';renderProfileSelect();diagnosticReport.hidden=true;await Promise.all([refreshKeyState(),refreshApiPermissionState()]);
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

async function refreshKeyState():Promise<void>{const configured=await hasApiKey(currentProfileId);apiKeyState.textContent=configured?'当前配置已保存 Key；留空可保留':'当前配置尚未保存 Key';navKeyStatus.textContent=configured?'● Key 已配置':'○ 尚未配置 Key';navKeyStatus.classList.toggle('configured',configured)}
async function refreshApiPermissionState():Promise<void>{try{const base=currentApiBaseUrl();const pattern=apiOriginPattern(base);const granted=await browser.permissions.contains({origins:[pattern]});apiPermissionState.className=`permission-state ${granted?'granted':'pending'}`;apiPermissionState.textContent=granted?`已授权访问 ${new URL(base).origin}`:'保存、测试或诊断时，浏览器会请求访问该 API 域名。'}catch{apiPermissionState.className='permission-state invalid';apiPermissionState.textContent='请填写有效的 API Base URL。'}}

async function requestApiAccess(baseUrl:string):Promise<void>{const granted=await browser.permissions.request({origins:[apiOriginPattern(baseUrl)]});if(!granted)throw new Error('未获得 API 域名访问权限。');await refreshApiPermissionState()}
function enabledApiProfiles(apiProfiles:ApiProfile[],activeProfileId:string,visionProfileId:string):ApiProfile[]{const requiredIds=new Set([activeProfileId,visionProfileId].filter(Boolean));return apiProfiles.filter(profile=>requiredIds.has(profile.id))}
async function requestSaveAccess(apiProfiles:ApiProfile[],activeProfileId:string,visionProfileId:string,mode:GeneralPageMode,allowlist:string[]):Promise<void>{const origins=[...enabledApiProfiles(apiProfiles,activeProfileId,visionProfileId).map(profile=>apiOriginPattern(profile.apiBaseUrl)),...getAutoInjectionPatterns(mode,allowlist)];const granted=await browser.permissions.request({origins:[...new Set(origins)]});if(!granted)throw new Error('未获得当前翻译接口或网页所需的访问权限，设置没有保存。');await refreshApiPermissionState()}

async function requestVisionCapabilityTest(profile:ApiProfile,model:string,apiKey=''):Promise<VisionCapabilityTestResponse>{
  return browser.runtime.sendMessage({
    type:'TEST_VISION_CAPABILITY',
    payload:{apiBaseUrl:profile.apiBaseUrl,model,profileId:profile.id,...(apiKey.trim()?{apiKey:apiKey.trim()}: {})},
  } satisfies RuntimeMessage) as Promise<VisionCapabilityTestResponse>;
}

async function autoConfigureVisionProfile(active:ApiProfile):Promise<{attempted:boolean;configured:boolean}>{
  if(visionProfileId||visionSelectionTouched)return {attempted:false,configured:Boolean(visionProfileId)};
  const model=active.model.trim();
  if(!model)return {attempted:false,configured:false};
  setVisionTestStatus('正在自动检测当前模型的图片输入能力…');
  const response=await requestVisionCapabilityTest(active,model,apiKeyInput.value);
  if(!response.ok){
    setVisionTestStatus(`未自动启用：${translationErrorMessage(response.error.code,response.error.message)}`);
    return {attempted:true,configured:false};
  }
  visionProfileId=active.id;
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
  const settings=await getSettings();loadedSettings=settings;profiles=settings.apiProfiles.map(profile=>({...profile}));currentProfileId=settings.activeApiProfileId;visionProfileId=settings.visionApiProfileId;visionSelectionTouched=false;visionModel.value=settings.visionModel;originalMode=settings.apiKeyStorage;persistKey.checked=settings.apiKeyStorage==='local';sourceLanguage.value=settings.sourceLanguage;targetLanguage.value=settings.targetLanguage;styleSelect.value=settings.style;contentMode.value=settings.contentMode;academicGlossary.value=formatGlossaryEntries(settings.academicGlossary);rememberHistory.checked=settings.rememberRecentTranslations;historyLimit.value=String(settings.historyLimit);sessionCache.checked=settings.enableSessionCache;alignmentDefault.checked=settings.sentenceAlignmentDefault;autoRenderLatex.checked=settings.autoRenderLatex;sidebarSide.value=settings.sidebarSide;contextMode.value=settings.contextMode;enableStreaming.checked=settings.enableStreaming;protectSensitiveFields.checked=settings.protectSensitiveFields;pdfKeyboardShortcuts.checked=settings.pdfKeyboardShortcutsEnabled;pdfRegionShortcutKey.value=settings.pdfRegionShortcutKey.toUpperCase();refreshPdfShortcutField();generalPageMode.value=settings.generalPageMode;siteAllowlist.value=settings.siteAllowlist.join('\n');floatingButton.checked=settings.showFloatingButtonOnOverleaf;hideTargetLanguageTrigger.checked=settings.hideFloatingButtonForTargetLanguage;contextMenu.checked=settings.enableContextMenu;refreshPageModeFields();await loadProfile(currentProfileId);setSaved();if(!settings.onboardingCompleted&&!onboardingDialog.open){onboardingPreset.value=API_PRESETS[0]?.id??'';applyOnboardingPreset();showOnboardingStep(1);onboardingDialog.showModal()}
}

for(const [index,button] of settingsNavButtons.entries()){
  const target=button.dataset.settingsTarget??'connection';button.setAttribute('aria-controls',`settings-${target}`);
  button.addEventListener('click',()=>showSettingsSection(target));
  button.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key))return;event.preventDefault();const delta=event.key==='ArrowDown'||event.key==='ArrowRight'?1:-1;const next=settingsNavButtons[(index+delta+settingsNavButtons.length)%settingsNavButtons.length];if(!next)return;showSettingsSection(next.dataset.settingsTarget??'connection');next.focus()});
}
const requestedSection=location.hash.slice(1);showSettingsSection(settingsSections.some(section=>section.dataset.settingsSection===requestedSection)?requestedSection:'connection');
form.addEventListener('input',setDirty);
form.addEventListener('change',setDirty);
window.addEventListener('beforeunload',event=>{if(!formDirty)return;event.preventDefault();event.returnValue=''});

onboardingPreset.addEventListener('change',applyOnboardingPreset);
onboardingBack.addEventListener('click',()=>showOnboardingStep(onboardingStep-1));
onboardingSkip.addEventListener('click',()=>{void(async()=>{const settings=await getSettings();await saveSettings({...settings,onboardingCompleted:true});onboardingDialog.close();await load();setStatus('已进入完整设置，保存后即可开始翻译。')})().catch(()=>setOnboardingStatus('无法关闭首次设置，请重新加载页面。',true))});
onboardingNext.addEventListener('click',()=>{void(async()=>{onboardingNext.disabled=true;if(onboardingStep===1){showOnboardingStep(2);return}const base=normalizeApiBaseUrl(onboardingBaseUrl.value);const apiKey=onboardingApiKey.value.trim();if(!apiKey)throw new Error('请填写 API Key。');if(onboardingStep===2){const granted=await browser.permissions.request({origins:[apiOriginPattern(base)]});if(!granted)throw new Error('需要 API 域名访问权限才能继续。');setOnboardingStatus('正在读取可用模型…');const response=await browser.runtime.sendMessage({type:'LIST_API_MODELS',payload:{apiKey,apiBaseUrl:base}} satisfies RuntimeMessage) as ModelListResponse;let message:string;let error=false;if(response.ok){onboardingModelList.replaceChildren(...response.data.models.map(model=>{const option=document.createElement('option');option.value=model;return option}));if(!onboardingModel.value&&response.data.models[0])onboardingModel.value=response.data.models[0];message=response.data.models.length?`已读取 ${response.data.models.length} 个模型。`:'接口未返回模型列表，请手动填写。'}else{message=`${translationErrorMessage(response.error.code,response.error.message)} 仍可在下一步手动填写模型。`;error=true}showOnboardingStep(3);setOnboardingStatus(message,error);return}await finishOnboarding()})().catch((error:unknown)=>setOnboardingStatus(error instanceof Error?error.message:'首次设置失败。',true)).finally(()=>{onboardingNext.disabled=false})});

apiBaseUrl.addEventListener('input',()=>{apiPreset.value='custom';void refreshApiPermissionState()});generalPageMode.addEventListener('change',refreshPageModeFields);
pdfKeyboardShortcuts.addEventListener('change',refreshPdfShortcutField);
pdfRegionShortcutKey.addEventListener('input',()=>{
  const letter=pdfRegionShortcutKey.value.match(/[a-z]/i)?.[0]??'';
  pdfRegionShortcutKey.value=letter.toUpperCase();
});
apiPreset.addEventListener('change',()=>{const preset=API_PRESETS.find(item=>item.id===apiPreset.value);if(!preset)return;apiBaseUrl.value=preset.apiBaseUrl;modelInput.value=preset.model;updateCurrentProfile();void refreshApiPermissionState();setStatus(preset.keyHint??`已填入 ${preset.name} 接口，可读取模型后再保存。`)});
profileSelect.addEventListener('change',()=>{if(apiKeyInput.value.trim()){profileSelect.value=currentProfileId;setStatus('请先保存当前输入的 API Key，再切换配置。',true);return}updateCurrentProfile();void loadProfile(profileSelect.value)});
profileName.addEventListener('input',()=>{const profile=currentProfile();if(profile){profile.name=profileName.value.trim()||'未命名配置';renderProfileSelect()}});
visionApiProfile.addEventListener('change',()=>{visionProfileId=visionApiProfile.value;visionSelectionTouched=true;const profile=profiles.find(item=>item.id===visionProfileId);if(profile)visionModel.value=profile.model;setDirty()});
function setVisionTestStatus(message:string,state:'idle'|'success'|'error'='idle'):void{visionTestStatus.textContent=message;visionTestStatus.classList.toggle('success',state==='success');visionTestStatus.classList.toggle('error',state==='error')}
visionApiProfile.addEventListener('change',()=>setVisionTestStatus('发送一张内置的 130×58 高对比字符测试图，不含文档内容。'));
visionModel.addEventListener('input',()=>setVisionTestStatus('模型已更改，请重新测试视觉能力。'));

addProfileButton.addEventListener('click',()=>{if(profiles.length>=6){setStatus('最多保存 6 个 API 配置。',true);return}updateCurrentProfile();const id=crypto.randomUUID();profiles.push({id,name:`翻译接口 ${profiles.length+1}`,apiBaseUrl:apiBaseUrl.value.trim(),model:modelInput.value.trim()});void loadProfile(id);setDirty();setStatus('已创建新配置，填写后请保存设置。')});
deleteProfileButton.addEventListener('click',()=>{if(profiles.length<=1)return;const deletedId=currentProfileId;profiles=profiles.filter(profile=>profile.id!==currentProfileId);if(visionProfileId===deletedId)visionProfileId='';void loadProfile(profiles[0]!.id);setDirty();setStatus('配置已从草稿中删除，点击“保存设置”后生效。')});

form.addEventListener('submit',event=>{event.preventDefault();const mode=generalPageMode.value as GeneralPageMode;const allowlist=normalizeSiteAllowlist(siteAllowlist.value.split(/\r?\n|,/));const glossary=parseGlossaryText(academicGlossary.value);try{profiles=validatedProfiles();renderProfileSelect()}catch(error){showSettingsSection('connection');setStatus(error instanceof Error?error.message:'API 配置不正确。',true);return}if(mode==='allowlist'&&!allowlist.length){showSettingsSection('pages');siteAllowlist.focus();setStatus('请至少填写一个有效的网站域名。',true);return}if(glossary.errors.length){showSettingsSection('translation');const details=academicGlossary.closest('details');if(details)details.open=true;academicGlossary.focus();setStatus(glossary.errors[0]??'术语表格式不正确。',true);return}
  if(pdfKeyboardShortcuts.checked&&!/^[a-z]$/i.test(pdfRegionShortcutKey.value.trim())){showSettingsSection('results');const details=pdfRegionShortcutKey.closest('details');if(details)details.open=true;pdfRegionShortcutKey.focus();setStatus('Pi PDF 框选键需要是一个英文字母。',true);return}
  void(async()=>{const active=currentProfile()!;await requestSaveAccess(profiles,active.id,visionProfileId,mode,allowlist);const autoVision=await autoConfigureVisionProfile(active);const keyMode:ApiKeyStorageMode=persistKey.checked?'local':'session';const current=loadedSettings??await getSettings();const removedProfileIds=current.apiProfiles.filter(profile=>!profiles.some(item=>item.id===profile.id)).map(profile=>profile.id);const next:ExtensionSettings={...current,schemaVersion:8,apiProfiles:profiles.map(profile=>({...profile})),activeApiProfileId:active.id,visionApiProfileId:visionProfileId,visionModel:visionModel.value.trim()||active.model,apiBaseUrl:active.apiBaseUrl,model:active.model,sourceLanguage:sourceLanguage.value,targetLanguage:targetLanguage.value,style:styleSelect.value as TranslationStyle,contentMode:contentMode.value as ContentMode,apiKeyStorage:keyMode,academicGlossary:glossary.entries,rememberRecentTranslations:rememberHistory.checked,historyLimit:Number(historyLimit.value) as HistoryLimit,enableSessionCache:sessionCache.checked,sentenceAlignmentDefault:alignmentDefault.checked,autoRenderLatex:autoRenderLatex.checked,sidebarSide:sidebarSide.value as SidebarSide,contextMode:contextMode.value as ContextMode,enableStreaming:enableStreaming.checked,protectSensitiveFields:protectSensitiveFields.checked,pdfKeyboardShortcutsEnabled:pdfKeyboardShortcuts.checked,pdfRegionShortcutKey:normalizePdfRegionShortcutKey(pdfRegionShortcutKey.value),showFloatingButtonOnOverleaf:floatingButton.checked,hideFloatingButtonForTargetLanguage:hideTargetLanguageTrigger.checked,generalPageMode:mode,siteAllowlist:allowlist,enableContextMenu:contextMenu.checked,onboardingCompleted:true};await saveSettings(next);if(apiKeyInput.value.trim()){await saveApiKey(apiKeyInput.value,keyMode,currentProfileId);apiKeyInput.value=''}else if(keyMode!==originalMode)await moveApiKey(keyMode);await Promise.all(removedProfileIds.map(profileId=>clearApiKey(profileId)));await removeUnusedApiAccess(current.apiProfiles,next.apiProfiles,active.id,visionProfileId,mode,allowlist);originalMode=keyMode;loadedSettings=next;visionSelectionTouched=false;await refreshKeyState();setSaved();setStatus(autoVision.configured&&autoVision.attempted?'设置已保存，并已自动启用 PDF 图像区域翻译。':autoVision.attempted?'设置已保存；当前模型未通过图片输入检测，文字翻译不受影响。':'设置已保存，并已同步到打开的页面。')})().catch((error:unknown)=>setStatus(error instanceof Error?error.message:'保存设置失败。',true));
});

async function callModels():Promise<void>{const base=currentApiBaseUrl();await requestApiAccess(base);refreshModelsButton.disabled=true;setStatus('正在读取可用模型…');const apiKey=apiKeyInput.value.trim();const response=await browser.runtime.sendMessage({type:'LIST_API_MODELS',payload:{apiBaseUrl:base,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ModelListResponse;if(!response.ok){setStatus(translationErrorMessage(response.error.code,response.error.message),true);return}modelList.replaceChildren(...response.data.models.map(model=>{const option=document.createElement('option');option.value=model;return option}));setStatus(response.data.models.length?`已读取 ${response.data.models.length} 个模型，可在输入框中选择。`:'接口没有返回模型列表，请手动填写模型名称。')}
refreshModelsButton.addEventListener('click',()=>void callModels().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{refreshModelsButton.disabled=false}));

testButton.addEventListener('click',()=>{const model=modelInput.value.trim();if(!model){setStatus('请先填写模型名称。',true);return}void(async()=>{const base=currentApiBaseUrl();await requestApiAccess(base);testButton.disabled=true;setStatus('正在测试 API、Key 与模型…');const apiKey=apiKeyInput.value.trim();const response=await browser.runtime.sendMessage({type:'TEST_API_CONNECTION',payload:{apiBaseUrl:base,model,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ConnectionTestResponse;setStatus(response.ok?'连接成功，API Key 与模型可用。':translationErrorMessage(response.error.code,response.error.message),!response.ok)})().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{testButton.disabled=false})});

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
  setVisionTestStatus(response.ok?`视觉能力可用 · ${response.data.latencyMs} ms`:translationErrorMessage(response.error.code,response.error.message),response.ok?'success':'error');
})().catch((error:unknown)=>setVisionTestStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),'error')).finally(()=>{testVisionCapabilityButton.disabled=false})});

function diagnosticItem(label:string,value:string):HTMLElement{const item=document.createElement('div');item.className='diagnostic-item';item.textContent=label;const strong=document.createElement('strong');strong.textContent=value;item.append(strong);return item}
function renderDiagnostic(report:ApiDiagnosticReport):void{diagnosticReport.replaceChildren();const heading=document.createElement('h3');heading.textContent=`兼容性诊断 · ${report.origin}`;const grid=document.createElement('div');grid.className='diagnostic-grid';grid.append(diagnosticItem('域名权限',report.permissionGranted?'通过':'未授权'),diagnosticItem('鉴权与模型',report.authenticated&&report.configuredModelAvailable?'通过':'需检查'),diagnosticItem('模型数量',String(report.modelCount)),diagnosticItem('对话接口',report.chatCompletion?'通过':'失败'),diagnosticItem('结构化输出',report.structuredOutput?'支持':'自动降级'),diagnosticItem('逐句对照',report.sentenceAlignment?'支持':'自动降级'),diagnosticItem('诊断耗时',report.latencyMs?`${report.latencyMs} ms`:'—'));diagnosticReport.append(heading,grid);if(report.notes.length){const notes=document.createElement('ul');notes.className='diagnostic-notes';for(const message of report.notes){const item=document.createElement('li');item.textContent=message;notes.append(item)}diagnosticReport.append(notes)}diagnosticReport.hidden=false}
diagnoseButton.addEventListener('click',()=>{const model=modelInput.value.trim();if(!model){setStatus('请先填写模型名称。',true);return}void(async()=>{const base=currentApiBaseUrl();await requestApiAccess(base);diagnoseButton.disabled=true;diagnosticReport.hidden=true;setStatus('正在执行一次低消耗兼容性诊断…');const apiKey=apiKeyInput.value.trim();const response=await browser.runtime.sendMessage({type:'DIAGNOSE_API',payload:{apiBaseUrl:base,model,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ApiDiagnosticResponse;if(!response.ok){setStatus(translationErrorMessage(response.error.code,response.error.message),true);return}renderDiagnostic(response.data);setStatus('诊断完成。逐句或结构化输出不支持时，扩展会自动降级为完整译文。')})().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{diagnoseButton.disabled=false})});

clearButton.addEventListener('click',()=>void clearApiKey(currentProfileId).then(async()=>{apiKeyInput.value='';await refreshKeyState();setStatus('当前 API 配置的 Key 已清除。')}).catch(()=>setStatus('清除 API Key 失败。',true)));
shortcutsButton.addEventListener('click',()=>void browser.tabs.create({url:'edge://extensions/shortcuts'}));
restartOnboardingButton.addEventListener('click',()=>{const current=currentProfile();const matching=API_PRESETS.find(preset=>preset.apiBaseUrl===current?.apiBaseUrl);onboardingPreset.value=matching?.id??'custom';applyOnboardingPreset();if(current){onboardingBaseUrl.value=current.apiBaseUrl;onboardingModel.value=current.model}onboardingApiKey.value='';showOnboardingStep(1);onboardingDialog.showModal()});
exportSettingsButton.addEventListener('click',()=>{void(async()=>{const settings=await getSettings();const content=exportSettingsConfiguration(settings);const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`pi-translator-settings-${new Date().toISOString().slice(0,10)}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setSupportStatus('配置已导出，文件中不包含任何 API Key。')})().catch(()=>setSupportStatus('导出配置失败。',true))});
importSettingsButton.addEventListener('click',()=>importSettingsFile.click());
importSettingsFile.addEventListener('change',()=>{const file=importSettingsFile.files?.[0];if(!file)return;void(async()=>{const current=await getSettings();const next=importSettingsConfiguration(await file.text(),current);await clearApiKey();await saveSettings(next);await load();setSupportStatus('配置已导入。出于安全考虑，所有 API Key 已清除；请重新填写 Key 并保存以授权接口域名。')})().catch((error:unknown)=>setSupportStatus(error instanceof Error?error.message:'导入配置失败。',true)).finally(()=>{importSettingsFile.value=''})});
copyDiagnosticReportButton.addEventListener('click',()=>{void(async()=>{const response=await browser.runtime.sendMessage({type:'GET_LOCAL_DIAGNOSTIC_REPORT'} satisfies RuntimeMessage) as LocalDiagnosticReportResponse;if(!response.ok)throw new Error(response.error.message);await navigator.clipboard.writeText(response.data.report);setSupportStatus('诊断报告已复制；不包含 API Key、选区、译文或网站名称。')})().catch(()=>setSupportStatus('复制诊断报告失败，请检查剪贴板权限。',true))});
void load().catch(()=>setStatus('读取设置失败，请重新加载页面。',true));
