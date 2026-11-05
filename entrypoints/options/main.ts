import {searchWithConfirmedTerms} from '../../core/translation/search-assistance';
import {PDF_AREA_NOTES_KEY} from '../../core/pdf/area-note-repository';
import {appendSearchAssistance} from '../../ui/search-assistance';
import {bindLibraryOrganization} from '../../ui/library-organization';
import {bindActionGuide} from '../../ui/action-guide';
import {bindPurposePreferences,PurposeRecommendationStaleError} from '../../ui/purpose-preferences';
import {PURPOSE_IDS,PURPOSE_SETTING_KEYS,normalizePurposePreferences,type PurposeSettingKey,type PurposeSettings} from '../../core/settings/purpose-preferences';
import {bindGlossaryProfiles} from '../../ui/glossary-profiles';
import {bindGlossaryTransfer} from '../../ui/glossary-transfer';
import { t, msg, initializeUiLanguage, localizeUiDocument, currentUiLanguagePreference, saveUiLanguagePreference, localizeErrorMessage } from '../../core/i18n/ui-language';
import { bindAnchoredMenus } from '../../ui/anchored-menu';
import {bindWebExcerptLibrary} from '../../ui/web-excerpt-library';
import {updateCompactFilter} from '../../ui/compact-filter';
import {bindCompactHelp} from '../../ui/compact-help';
import {appendLibrarySourceResults} from '../../ui/library-search-results';
import {bindLibraryDetailLayout} from '../../ui/library-detail-layout';
import {renderTranslationContent} from '../../ui/translation-content';
import {renderFormulaDocument} from '../../ui/formula-document-view';
import {appendRecentReadingEntry} from '../../ui/recent-reading-entry';
import {bindActionHints} from '../../ui/action-feedback';
import {listRecentPdfReadings,libraryReadingRows,type RecentPdfReading} from '../../core/translation/recent-reading-library';
import {RECENT_PDF_DOCUMENTS_KEY} from '../../core/pdf/recent-documents';
import {RECENT_PDF_OVERRIDES_KEY} from '../../core/pdf/recent-reading-overrides';
import {PDF_READING_STATES_KEY} from '../../core/pdf/reading-state';
import {listLibrarySources,filterLibrarySources,type LibrarySourceResult} from '../../core/translation/library-search';
import {DOCUMENT_MEMORY_STORAGE_KEY} from '../../core/document/document-memory-repository';
import {WEB_EXCERPTS_KEY} from '../../core/content/web-excerpt-repository';
import {PDF_TRANSLATION_MARKERS_KEY} from '../../core/pdf/translation-marker-repository';
import {PDF_READING_ANNOTATIONS_KEY} from '../../core/pdf/reading-annotation-repository';
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
  MODEL_FAMILIES,
  modelFamily,
  translationModelChoices,
} from '../../core/settings/api-model-selection';
import { API_PRESETS } from '../../core/settings/api-presets';
import {
  exportSettingsConfiguration,
  importSettingsConfiguration,
  importConfigurationReadingPreferences,
} from '../../core/settings/config-transfer';
import { getSiteReadingPreferences, mergeSiteReadingPreferences } from '../../core/settings/site-reading-preferences';
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
  clearRetainedPdfDocumentTranslationSession,
  getRetainedPdfDocumentTranslationStorageSummary,
  PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY,
} from '../../core/pdf/document-translation-session';
import {
  clearRetainedBilingualPageSession,
  getRetainedBilingualPageStorageSummary,
  BILINGUAL_PAGE_RETAINED_STORAGE_KEY,
} from '../../core/translation/bilingual-page-session';
import type { RetainedTranslationStorageSummary } from '../../core/translation/retained-storage-summary';
import { listRetainedDocuments, renameRetainedDocument, deleteRetainedDocument, setRetainedDocumentPinned, pruneRetainedDocumentNames, RETAINED_DOCUMENT_NAMES_KEY, type RetainedLibraryEntry } from '../../core/translation/retained-document-library';
import {bindLibraryBackup} from '../../ui/library-backup';
import { normalizeModelPrices, type ModelTokenPrice } from '../../core/translation/cost-estimate';
import type { TranslationStyle } from '../../core/translation/types';
import {
  assignedTranslationShortcut,
  shortcutKeyParts,
} from '../../core/commands/translation-shortcut';

async function startUi(): Promise<void> {
  await initializeUiLanguage();
  localizeUiDocument();
  bindActionHints();
  bindCompactHelp();
  bindActionGuide(document,['.settings-nav'],[
    {label:t('设置分区'),selector:'#settings-section-select'},
    {label:t('文档库'),selector:'[data-settings-target="storage"]'},
    {label:t('连接 API'),selector:'[data-settings-target="connection"]'},
    {label:t('翻译偏好'),selector:'[data-settings-target="translation"]'},
    {label:t('结果与侧栏'),selector:'[data-settings-target="results"]'},
    {label:t('页面范围'),selector:'[data-settings-target="pages"]'},
    {label:t('更多设置'),selector:'[data-settings-target="support"]'},
    {label:t('搜索'),selector:'#retained-library-search'},
    {label:t('保存'),selector:'#save-button'},
  ]);
  const excerptLibrary=bindWebExcerptLibrary();


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
const modelFamilySelect=element<HTMLSelectElement>('model-family');
const modelCatalogStatus=element<HTMLElement>('model-catalog-status');
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
const glossaryProfiles=bindGlossaryProfiles(academicGlossary,()=>glossaryTransfer.reset());
const glossaryTransfer=bindGlossaryTransfer(academicGlossary,()=>element<HTMLSelectElement>('target-language').value,glossaryProfiles.token);
const visionApiProfile=element<HTMLSelectElement>('vision-api-profile');
const visionModel=element<HTMLInputElement>('vision-model');
const testVisionCapabilityButton=element<HTMLButtonElement>('test-vision-capability');
const visionTestStatus=element<HTMLElement>('vision-test-status');
const rememberHistory=element<HTMLInputElement>('remember-history');
const historyLimit=element<HTMLSelectElement>('history-limit');
const sessionCache=element<HTMLInputElement>('session-cache');
const alignmentDefault=element<HTMLInputElement>('alignment-default');
const autoRenderLatex=element<HTMLInputElement>('auto-render-latex');
const sidebarMode=element<HTMLSelectElement>('sidebar-mode');
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
const openProviderKeyPageButton=element<HTMLButtonElement>('open-provider-key-page');
const status=element<HTMLParagraphElement>('status');
const settingsRecoveryBanner=element<HTMLElement>('settings-recovery-banner');
const settingsRecoveryTitle=element<HTMLElement>('settings-recovery-title');
const settingsRecoveryDescription=element<HTMLParagraphElement>('settings-recovery-description');
const settingsRecoveryStatus=element<HTMLParagraphElement>('settings-recovery-status');
const diagnosticReport=element<HTMLElement>('diagnostic-report');
const shortcutsButton=element<HTMLButtonElement>('open-shortcuts');
const translationShortcutChip=element<HTMLElement>('translation-shortcut-chip');
const translationShortcutHelp=element<HTMLElement>('translation-shortcut-help');
const onboardingDialog=element<HTMLDialogElement>('onboarding-dialog');
const onboardingTitle=element<HTMLElement>('onboarding-title');
const onboardingPreset=element<HTMLSelectElement>('onboarding-preset');
const onboardingWebAccess=element<HTMLElement>('onboarding-web-access');
const onboardingEnableWeb=element<HTMLButtonElement>('onboarding-enable-web');
const onboardingWebStatus=element<HTMLElement>('onboarding-web-status');
const onboardingBaseUrlField=element<HTMLElement>('onboarding-base-url-field');
const onboardingBaseUrl=element<HTMLInputElement>('onboarding-base-url');
const onboardingApiKey=element<HTMLInputElement>('onboarding-api-key');
const onboardingPersistKey=element<HTMLInputElement>('onboarding-persist-key');
const onboardingKeyHint=element<HTMLElement>('onboarding-key-hint');
const onboardingOpenKeyPageButton=element<HTMLButtonElement>('onboarding-open-key-page');
const onboardingModel=element<HTMLInputElement>('onboarding-model');
const onboardingModelList=element<HTMLDataListElement>('onboarding-model-list');
const onboardingModelFamily=element<HTMLSelectElement>('onboarding-model-family');
const onboardingModelCatalogStatus=element<HTMLElement>('onboarding-model-catalog-status');
const onboardingSuccess=element<HTMLElement>('onboarding-success');
const onboardingSampleSource=element<HTMLElement>('onboarding-sample-source');
const onboardingSampleTranslation=element<HTMLElement>('onboarding-sample-translation');
const onboardingStatus=element<HTMLElement>('onboarding-status');
const purposeControls={style:styleSelect,contentMode,contextMode,sentenceAlignmentDefault:alignmentDefault,autoRenderLatex};
const purposeValues=():PurposeSettings=>({style:styleSelect.value as PurposeSettings['style'],contentMode:contentMode.value as PurposeSettings['contentMode'],contextMode:contextMode.value as PurposeSettings['contextMode'],sentenceAlignmentDefault:alignmentDefault.checked,autoRenderLatex:autoRenderLatex.checked,activeGlossaryProfileId:element<HTMLSelectElement>('glossary-profile').value});
const purposePreferences=bindPurposePreferences({host:element('purpose-preferences-host'),values:purposeValues,schemes:glossaryProfiles.choices,latest:getSettings,syncScheme:glossaryProfiles.syncSuggested,manage:()=>{const details=academicGlossary.closest('details');if(details)details.open=true;const select=element<HTMLSelectElement>('glossary-profile');select.scrollIntoView({block:'nearest'});select.focus({preventScroll:true})},dirty:()=>{nonConnectionDirty=true;setDirty()},apply:patch=>{
  for(const key of PURPOSE_SETTING_KEYS){if(patch[key]===undefined)continue;if(key==='activeGlossaryProfileId'){glossaryProfiles.choose(String(patch[key]));continue}const control=purposeControls[key];if(control instanceof HTMLInputElement)control.checked=Boolean(patch[key]);else control.value=String(patch[key]);control.dispatchEvent(new Event('change',{bubbles:true}))}
}});
const onboardingBack=element<HTMLButtonElement>('onboarding-back');
const onboardingNext=element<HTMLButtonElement>('onboarding-next');
const onboardingSkip=element<HTMLButtonElement>('onboarding-skip');
const restartOnboardingButton=element<HTMLButtonElement>('restart-onboarding');
const exportSettingsButton=element<HTMLButtonElement>('export-settings');
const importSettingsButton=element<HTMLButtonElement>('import-settings');
const importSettingsFile=element<HTMLInputElement>('import-settings-file');
const copyDiagnosticReportButton=element<HTMLButtonElement>('copy-diagnostic-report');
const supportStatus=element<HTMLElement>('support-status');
const retainedStorageTitle=element<HTMLElement>('retained-storage-title');
const refreshRetainedStorageButton=element<HTMLButtonElement>('refresh-retained-storage');
const retainedStorageSummary=element<HTMLElement>('retained-storage-summary');
const retainedStorageDocuments=element<HTMLElement>('retained-storage-documents');
const retainedStorageCharacters=element<HTMLElement>('retained-storage-characters');
const retainedStorageBytes=element<HTMLElement>('retained-storage-bytes');
const retainedWebStorageStatus=element<HTMLElement>('retained-web-storage-status');
const retainedPdfStorageStatus=element<HTMLElement>('retained-pdf-storage-status');
const retainedStorageCapacity=element<HTMLElement>('retained-storage-capacity');
const clearRetainedWebButton=element<HTMLButtonElement>('clear-retained-web');
const clearRetainedPdfButton=element<HTMLButtonElement>('clear-retained-pdf');
const clearAllRetainedStorageButton=element<HTMLButtonElement>('clear-all-retained-storage');
const retainedStorageActionStatus=element<HTMLElement>('retained-storage-action-status');
const retainedLibrary=element<HTMLElement>('retained-document-library');
const libraryDetails=bindLibraryDetailLayout(retainedLibrary,element<HTMLElement>('library-detail'));
const retainedLibrarySearch=element<HTMLInputElement>('retained-library-search');
const retainedLibraryFilter=element<HTMLSelectElement>('retained-library-filter');
const organization=bindLibraryOrganization(retainedLibrarySearch,retainedLibraryFilter,renderRetainedLibrary,()=>libraryDetails.showList());
const priceProfile=element<HTMLSelectElement>('price-profile');
const priceModel=element<HTMLInputElement>('price-model');
const priceCurrency=element<HTMLSelectElement>('price-currency');
const priceInput=element<HTMLInputElement>('price-input');
const priceOutput=element<HTMLInputElement>('price-output');
const addModelPriceButton=element<HTMLButtonElement>('add-model-price');
const modelPriceList=element<HTMLElement>('model-price-list');
const modelPriceStatus=element<HTMLElement>('model-price-status');
const navProfileName=element<HTMLElement>('nav-profile-name');
const navKeyStatus=element<HTMLElement>('nav-key-status');
const saveState=element<HTMLElement>('save-state');
const saveButton=element<HTMLButtonElement>('save-button');
const extensionVersion=element<HTMLElement>('extension-version');
const settingsNavButtons=[...document.querySelectorAll<HTMLButtonElement>('[data-settings-target]')];
const settingsSectionSelect=element<HTMLSelectElement>('settings-section-select');
const settingsSections=[...document.querySelectorAll<HTMLElement>('[data-settings-section]')];

let originalMode:ApiKeyStorageMode='session';
let loadedSettingsBaseline:ExtensionSettings|undefined;
let profiles:ApiProfile[]=[];
let modelPrices:ModelTokenPrice[]=[];
let libraryEntries:RetainedLibraryEntry[]=[];
let librarySources:LibrarySourceResult[]=[];
let libraryRecent:RecentPdfReading[]=[];
let librarySourceReadError=false;
const libraryNameDrafts=new Map<string,string>();
let currentProfileId='default';
let activeTextProfileId='default';
let visionProfileId='';
let visionSelectionTouched=false;
let visionSetupIntentProfileId='';
let onboardingStep=1;
let onboardingAvailableModels:string[]=[];
let availableTextModels:string[]=[];
let onboardingComplete=false;
type ApiInputDraft={key:string;base:string;model:string;keyOrigin?:string};
const connectionDrafts=new Map<string,ApiInputDraft>();
const protectedConnectionDrafts=new Set<string>();
let connectionProvider='';
let connectionKeyOrigin:string|undefined;
const wizardDrafts=new Map<string,ApiInputDraft>();
const wizardTouchedProviders=new Set<string>();
let wizardProvider='';
let wizardKeyOrigin:string|undefined;
let wizardInputDirty=false;
let wizardRevision=0;
const draftId=(profile:string,provider:string)=>JSON.stringify([profile,provider]);
function rememberConnectionDraft():void{
  if(!connectionProvider)return;
  connectionDrafts.set(draftId(currentProfileId,connectionProvider),{key:apiKeyInput.value,base:apiBaseUrl.value,model:modelInput.value,...(connectionKeyOrigin?{keyOrigin:connectionKeyOrigin}:{})});
}
function connectionDraftChanged(id:string,draft:ApiInputDraft):boolean{
  if(draft.key.trim()||protectedConnectionDrafts.has(id))return true;
  const [profileId,provider]=JSON.parse(id) as [string,string];
  const profile=loadedSettingsBaseline?.apiProfiles.find(item=>item.id===profileId);
  const baselineProvider=profile?(API_PRESETS.find(item=>item.apiBaseUrl===profile.apiBaseUrl)?.id??'custom'):'';
  const preset=API_PRESETS.find(item=>item.id===provider);
  const base=provider===baselineProvider?profile!.apiBaseUrl:preset?.apiBaseUrl??'';
  const model=provider===baselineProvider?profile!.model:preset?.model??'';
  return draft.base!==base||draft.model!==model;
}
function hasOtherConnectionKeyDrafts():boolean{
  const current=draftId(currentProfileId,connectionProvider);
  return [...connectionDrafts].some(([id,draft])=>id!==current&&connectionDraftChanged(id,draft));
}
function clearSavedConnectionKey(id:string,key:string):void{
  const draft=connectionDrafts.get(id);
  if(draft?.key.trim()===key)connectionDrafts.set(id,{...draft,key:''});
  if(id===draftId(currentProfileId,connectionProvider)&&apiKeyInput.value.trim()===key){apiKeyInput.value='';connectionKeyOrigin=undefined;refreshKeyOriginNotice(false)}
}
function apiInputOrigin(value:string):string|undefined{
  try{const url=new URL(value.trim());return url.protocol==='https:'||url.protocol==='http:'?url.origin:undefined}catch{return undefined}
}
function keyOriginChanged(key:string,origin:string|undefined,base:string):boolean{return Boolean(key.trim()&&origin&&apiInputOrigin(base)!==origin)}
function refreshKeyOriginNotice(wizard:boolean):void{
  const base=wizard?onboardingBaseUrl.value:apiBaseUrl.value;
  const changed=wizard?keyOriginChanged(onboardingApiKey.value,wizardKeyOrigin,base):keyOriginChanged(apiKeyInput.value,connectionKeyOrigin,base);
  const button=element<HTMLButtonElement>(wizard?'onboarding-confirm-key-origin':'confirm-key-origin');
  button.hidden=!changed;button.disabled=!apiInputOrigin(base);
}
function assertKeyOrigin(key:string,origin:string|undefined,base:string):void{
  if(keyOriginChanged(key,origin,base))throw new Error('接口地址已变化，请先确认此 Key 用于当前地址。');
}
type ConnectionSnapshot={profile:string;provider:string;base:string;model:string;key:string;keyOrigin:string|undefined};
function connectionSnapshot():ConnectionSnapshot{return {profile:currentProfileId,provider:connectionProvider,base:apiBaseUrl.value,model:modelInput.value,key:apiKeyInput.value,keyOrigin:connectionKeyOrigin}}
function connectionMatches(snapshot:ConnectionSnapshot):boolean{
  const now=connectionSnapshot();
  return now.profile===snapshot.profile&&now.provider===snapshot.provider&&now.base===snapshot.base&&now.model===snapshot.model&&now.key===snapshot.key&&now.keyOrigin===snapshot.keyOrigin;
}
function assertConnectionCurrent(snapshot:ConnectionSnapshot):void{
  if(!connectionMatches(snapshot))throw new Error('接口输入已变化，请核对草稿后重试。');
  assertKeyOrigin(snapshot.key,snapshot.keyOrigin,snapshot.base);
}
function wizardSnapshot():ApiInputDraft{return {key:onboardingApiKey.value,base:onboardingBaseUrl.value,model:onboardingModel.value,...(wizardKeyOrigin?{keyOrigin:wizardKeyOrigin}:{})}}
function rememberWizardDraft():void{if(wizardProvider)wizardDrafts.set(wizardProvider,wizardSnapshot())}
function resetWizardSkipConfirmation():void{delete onboardingSkip.dataset.confirm;onboardingSkip.textContent=t('稍后手动设置')}
function beginWizardProvider():void{wizardDrafts.clear();wizardTouchedProviders.clear();wizardInputDirty=false;wizardRevision++;wizardProvider=onboardingPreset.value;wizardKeyOrigin=undefined;resetWizardSkipConfirmation();applyOnboardingPreset();refreshKeyOriginNotice(true)}
function changeWizardProvider():void{
  rememberWizardDraft();wizardProvider=onboardingPreset.value;wizardRevision++;resetWizardSkipConfirmation();
  applyOnboardingPreset();const draft=wizardDrafts.get(wizardProvider);wizardKeyOrigin=draft?.keyOrigin;
  if(draft){onboardingApiKey.value=draft.key;onboardingBaseUrl.value=draft.base;onboardingModel.value=draft.model}
  refreshKeyOriginNotice(true);
}
class StaleWizardInputError extends Error{}
function assertWizardCurrent(revision:number,step:number):void{
  if(!onboardingDialog.open||onboardingStep!==step||wizardRevision!==revision)throw new StaleWizardInputError();
}
function wizardHasInput():boolean{return wizardInputDirty}

let retainedStoragePending=false;
let retainedStorageRevision=0;
let retainedStorageConfirmationTimer:ReturnType<typeof setTimeout>|undefined;

function shortcutKeys(shortcut:string):DocumentFragment{
  const fragment=document.createDocumentFragment();
  shortcutKeyParts(shortcut).forEach((part,index)=>{
    if(index)fragment.append(' + ');
    const key=document.createElement('kbd');key.textContent=part;fragment.append(key);
  });
  return fragment;
}

async function refreshTranslationShortcut():Promise<void>{
  try{
    const shortcut=assignedTranslationShortcut(await browser.commands.getAll());
    translationShortcutChip.replaceChildren();
    translationShortcutHelp.replaceChildren();
    if(shortcut){
      translationShortcutChip.classList.remove('missing');
      translationShortcutChip.append(shortcutKeys(shortcut));
      translationShortcutHelp.append(t('选中文本后使用右键菜单或按 '),shortcutKeys(shortcut),'。');
      shortcutsButton.textContent=t('管理快捷键');
      return;
    }
    translationShortcutChip.classList.add('missing');
    translationShortcutChip.textContent=t('翻译快捷键未设置');
    translationShortcutHelp.textContent=t('Edge 未能分配建议快捷键，可能与系统或其他扩展冲突；请手动设置后再使用。');
    shortcutsButton.textContent=t('设置快捷键');
  }catch{
    translationShortcutChip.classList.add('missing');
    translationShortcutChip.textContent=t('快捷键状态未知');
    translationShortcutHelp.textContent=t('暂时无法读取快捷键状态，可打开 Edge 快捷键页面检查。');
    shortcutsButton.textContent=t('检查快捷键');
  }
}
let formDirty=false;
let nonConnectionDirty=false;
let activeSettingsRecovery:SettingsRecoveryDescriptor|undefined;
let settingsRecoveryCompleting=false;
const SETTINGS_RECOVERY_TOKEN_KEY='piTranslatorSettingsRecoveryToken';

for(const select of [apiPreset,onboardingPreset]){
  for(const preset of API_PRESETS){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.id==='qwen'?msg`${t(preset.name)}（图像翻译推荐）`:t(preset.name);select.append(option)}
  const custom=document.createElement('option');custom.value='custom';custom.textContent=t('自定义 OpenAI 兼容 API');select.append(custom);
}
extensionVersion.textContent=browser.runtime.getManifest().version;

function setStatus(message:string,error=false):void{status.textContent=localizeErrorMessage(message);status.classList.toggle('error',error)}
function setOnboardingStatus(message:string,error=false):void{onboardingStatus.textContent=localizeErrorMessage(message);onboardingStatus.classList.toggle('error',error)}
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
    ? t('完成图像翻译 API 配置后继续')
    : t('完成文字 API 配置后继续');
  settingsRecoveryDescription.textContent=recovery.hadPartialOutput
    ? t('刚才的请求已经产生部分译文。验证并保存成功后会返回原页面，由你确认是否重新翻译，避免重复请求。')
    : recovery.autoResume
      ? t('验证并保存成功后会返回原页面，继续刚才的翻译，无需重新选择内容。')
      : t('刚才的请求可能已经产生部分译文，或需要你确认下一步。验证并保存成功后会返回原页面；扩展不会自动重新发送请求。');
  const remainingMinutes=Math.max(1,Math.ceil((recovery.expiresAt-Date.now())/60_000));
  setSettingsRecoveryStatus(msg`请完成下方连接验证；恢复通道约在 ${remainingMinutes} 分钟后失效。`);
  refreshModelsButton.textContent=t('验证、保存并继续');
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
    settingsRecoveryTitle.textContent=t('无法恢复刚才的翻译');
    settingsRecoveryDescription.textContent=t('恢复信息无效。你仍可保存 API 设置，然后回到原页面重新选择内容。');
    setSettingsRecoveryStatus(t('恢复信息无效。'),'error');
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
    settingsRecoveryTitle.textContent=t('无法恢复刚才的翻译');
    settingsRecoveryDescription.textContent=t('暂时无法连接扩展后台。你仍可保存 API 设置，然后手动返回原页面。');
    setSettingsRecoveryStatus(runtimeConnectionErrorMessage(error),'error');
    return;
  }
  if(!response.ok){
    sessionStorage.removeItem(SETTINGS_RECOVERY_TOKEN_KEY);
    settingsRecoveryBanner.hidden=false;
    settingsRecoveryTitle.textContent=t('无法恢复刚才的翻译');
    settingsRecoveryDescription.textContent=t('恢复任务可能已经过期。你仍可保存 API 设置，然后回到原页面重新选择内容。');
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
      ? t('API 已验证并保存，正在返回原页面等待你的确认…')
      : t('API 已验证并保存，正在返回并继续翻译…'),
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
      setSettingsRecoveryStatus(t('API 已保存，但暂时无法送回原页面。请确认原标签页或 PDF 侧栏仍打开，然后再次点击“验证、保存并继续”。'),'error');
      return false;
    }
    activeSettingsRecovery=undefined;
    sessionStorage.removeItem(SETTINGS_RECOVERY_TOKEN_KEY);
    refreshModelsButton.textContent=t('连接并保存');
    setSettingsRecoveryStatus(
      response.data.requiresConfirmation
        ? t('已返回原页面；请在那里确认是否重新翻译。')
        : response.data.resumed
          ? t('已返回原页面并继续翻译。')
          : t('已返回原页面，请继续刚才的操作。'),
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
function setDirty():void{formDirty=true;saveState.textContent=t('有未保存的更改');saveState.classList.add('unsaved');saveButton.disabled=false;saveButton.textContent=t('保存更改')}
function setSaved():void{formDirty=false;nonConnectionDirty=false;saveState.textContent=t('所有设置已保存');saveState.classList.remove('unsaved');saveButton.disabled=true;saveButton.textContent=t('已保存');glossaryTransfer.saved();purposePreferences.saved();if(hasOtherConnectionKeyDrafts())setDirty()}
function setApiConnectionSaved():void{
  if(nonConnectionDirty||hasOtherConnectionKeyDrafts()||apiKeyInput.value.trim()){formDirty=true;saveState.textContent=t('API 已保存，其他更改未保存');saveState.classList.add('unsaved');saveButton.disabled=false;saveButton.textContent=t('保存其他更改');return}
  setSaved();
}
function showSettingsSection(target:string):void{const cost=target==='cost';if(cost){target='connection';element<HTMLDetailsElement>('settings-cost').open=true}const changed=document.body.dataset.section!==target;document.body.dataset.section=target;if(changed)window.scrollTo({top:0,behavior:'instant'});settingsSectionSelect.value=target;for(const button of settingsNavButtons){const active=button.dataset.settingsTarget===target;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1}for(const section of settingsSections)section.hidden=section.dataset.settingsSection!==target;const hash=cost?'cost':target;if(location.hash!==`#${hash}`)history.replaceState(null,'',`#${hash}`);if(target==='storage')void refreshRetainedStorageSummary()}

const retainedStorageNumberFormat=new Intl.NumberFormat('zh-CN');
function formatRetainedStorageBytes(bytes:number):string{
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(bytes<10*1024?1:0)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
function retainedStorageKindStatus(summary:RetainedTranslationStorageSummary):string{
  if(!summary.documentCount)return t('未保留任何译文');
  return msg`${summary.fixedDocuments} 份固定 · ${summary.recentDocuments}/${summary.maximumDocuments} 份最近译文 · 容量 ${retainedStorageNumberFormat.format(summary.capacityCharacters)} / ${retainedStorageNumberFormat.format(summary.maximumTranslationCharacters)} 字符（含公式与历史） · ${formatRetainedStorageBytes(summary.estimatedBytes)} / ${formatRetainedStorageBytes(summary.maximumBytes)}`;
}
function setRetainedStorageActionStatus(message:string,error=false):void{
  retainedStorageActionStatus.textContent=message;
  retainedStorageActionStatus.classList.toggle('error',error);
}
function resetRetainedStorageConfirmation():void{
  if(retainedStorageConfirmationTimer)clearTimeout(retainedStorageConfirmationTimer);
  retainedStorageConfirmationTimer=undefined;
  clearAllRetainedStorageButton.classList.remove('confirming');
  clearAllRetainedStorageButton.textContent=t('清除全部本机译文');
}
function setRetainedStorageControls(
  web:RetainedTranslationStorageSummary|undefined,
  pdf:RetainedTranslationStorageSummary|undefined,
):void{
  refreshRetainedStorageButton.disabled=retainedStoragePending;
  clearRetainedWebButton.disabled=retainedStoragePending||!web?.documentCount;
  clearRetainedPdfButton.disabled=retainedStoragePending||!pdf?.documentCount;
  clearAllRetainedStorageButton.disabled=retainedStoragePending||!(
    (web?.documentCount??0)+(pdf?.documentCount??0)
  );
}
async function refreshRetainedStorageSummary():Promise<boolean>{
  const revision=++retainedStorageRevision;
  retainedStorageSummary.setAttribute('aria-busy','true');
  refreshRetainedStorageButton.disabled=true;
  try{
    const retainedEntries=listRetainedDocuments();
    const [web,pdf,entries,sources,recent]=await Promise.all([
      getRetainedBilingualPageStorageSummary(),
      getRetainedPdfDocumentTranslationStorageSummary(),
      retainedEntries,
      listLibrarySources().then(items=>({items,error:''}),()=>({items:[],error:t('部分资料读取失败，已保存的记录未改变。')})),
      retainedEntries.then(async entries=>{let unavailable=false;const items=await listRecentPdfReadings(entries,()=>{unavailable=true});return {items,error:unavailable?t('原 PDF 副本暂时无法读取，请在文档库管理中刷新。'):''}}).catch(()=>({items:[],error:t('最近阅读暂时无法读取，已保存译文仍可打开。')})),
    ]);
    if(revision!==retainedStorageRevision)return false;
    libraryEntries=entries;
    librarySources=sources.items;
    libraryRecent=recent.items;
    renderRetainedLibrary();
    if(sources.error||recent.error)setRetainedStorageActionStatus(sources.error||recent.error,true);
    else if(librarySourceReadError)setRetainedStorageActionStatus('');
    librarySourceReadError=Boolean(sources.error||recent.error);
    const documentCount=web.documentCount+pdf.documentCount;
    const characters=web.translationCharacters+pdf.translationCharacters;
    const bytes=web.estimatedBytes+pdf.estimatedBytes;
    retainedStorageDocuments.textContent=msg`${retainedStorageNumberFormat.format(documentCount)} 份`;
    retainedStorageCharacters.textContent=retainedStorageNumberFormat.format(characters);
    retainedStorageBytes.textContent=formatRetainedStorageBytes(bytes);
    retainedWebStorageStatus.textContent=retainedStorageKindStatus(web);
    retainedPdfStorageStatus.textContent=retainedStorageKindStatus(pdf);
    retainedStorageCapacity.hidden=!(web.nearingCapacity||pdf.nearingCapacity);
    setRetainedStorageControls(web,pdf);
    return !(sources.error||recent.error);
  }catch{
    if(revision!==retainedStorageRevision)return false;
    retainedStorageDocuments.textContent='—';
    retainedStorageCharacters.textContent='—';
    retainedStorageBytes.textContent='—';
    retainedWebStorageStatus.textContent=t('读取失败');
    retainedPdfStorageStatus.textContent=t('读取失败');
    retainedStorageCapacity.hidden=true;
    setRetainedStorageControls(undefined,undefined);
    setRetainedStorageActionStatus(t('无法读取本机译文，请刷新后重试。'),true);
    return false;
  }finally{
    if(revision===retainedStorageRevision){
      retainedStorageSummary.setAttribute('aria-busy','false');
      if(!retainedStoragePending)refreshRetainedStorageButton.disabled=false;
    }
  }
}

function appendLibraryMatch(container:HTMLElement,text:string,query:string):void{
  const index=query?text.toLocaleLowerCase().indexOf(query):-1;
  if(index<0){container.textContent=text;return}
  const mark=document.createElement('mark');mark.textContent=text.slice(index,index+query.length);
  container.append(document.createTextNode(text.slice(0,index)),mark,document.createTextNode(text.slice(index+query.length)));
}

let librarySearchOrigin:{query:string;kind:string;afterQuery:string;afterKind:string;tag:string;view:string;project:string}|undefined;
function renderRetainedLibrary():void{
  const query=retainedLibrarySearch.value.trim().toLocaleLowerCase();
  const filter=retainedLibraryFilter.value;
  const languages:Record<string,string>={'zh-CN':t('简体中文'),en:'English',ja:t('日本語'),de:'Deutsch',fr:'Français'};
  const recentById=new Map(libraryRecent.map(item=>[item.id,item]));
  const projectParentsByReading=new Map<string,string[]>();for(const entry of libraryEntries)if(entry.kind==='pdf'&&entry.readingId)projectParentsByReading.set(entry.readingId,[...(projectParentsByReading.get(entry.readingId)??[]),entry.id]);
  const projectParents=(item:LibrarySourceResult):string[]=>item.kind==='excerpt'&&item.item.kind==='pdf'?projectParentsByReading.get(item.item.documentId)??[]:[];
  type SearchItem={kind:'reading';id:string;row:ReturnType<typeof libraryReadingRows>[number]}|{kind:'source';id:string;source:LibrarySourceResult};
  const find=(needle:string):SearchItem[]=>{
    const entries=libraryEntries.filter(entry=>organization.matches(entry.id)).filter(entry=>(filter==='all'||filter===entry.kind||filter==='pinned'&&entry.pinned||filter==='review'&&entry.reviewCount>0||filter==='incomplete'&&entry.state!=='complete')&&`${entry.name} ${entry.kind} ${entry.kind==='web'?t('网页'):''} ${entry.targetLanguage} ${languages[entry.targetLanguage]??''} ${entry.text} ${entry.readingId?recentById.get(entry.readingId)?.name??'':''}`.toLocaleLowerCase().includes(needle));
    const recent=libraryRecent.filter(item=>organization.matches(`recent:${item.id}`,projectParentsByReading.get(item.id)??[])).filter(item=>['all','pdf'].includes(filter)&&item.name.toLocaleLowerCase().includes(needle));
    const rows=libraryReadingRows(entries,recent,libraryEntries);
    const sources=filterLibrarySources(librarySources,needle,filter).filter(item=>organization.matches(item.id,projectParents(item))&&(filter==='term'||item.kind!=='term'));
    return [...rows.map(row=>({kind:'reading' as const,id:row.kind==='recent'?`recent:${row.recent.id}`:row.entry.id,row})),...sources.map(source=>({kind:'source' as const,id:source.id,source}))];
  };
  const found=searchWithConfirmedTerms(query,filter==='term'?[]:librarySources.flatMap(item=>item.kind==='term'?[item.term]:[]),value=>find(value.toLocaleLowerCase()),item=>item.id);
  const matchedRows=found.matches.flatMap(({item})=>item.kind==='reading'?[item.row]:[]);
  const rows=libraryReadingRows(matchedRows.flatMap(row=>row.kind==='translation'?[row.entry]:[]),[...new Map(matchedRows.flatMap(row=>row.recent?[[row.recent.id,row.recent] as const]:[])).values()],libraryEntries);
  // A matching dictionary row must not prevent finding the material it names.
  const directTerms=filter==='term'?[]:filterLibrarySources(librarySources,query,filter).filter(item=>item.kind==='term'&&organization.matches(item.id));
  const sources=[...found.matches.flatMap(({item})=>item.kind==='source'?[item.source]:[]),...directTerms].sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
  const matchedQueries=new Map(found.matches.map(({item,query})=>[item.id,query.toLocaleLowerCase()]));
  for(const item of directTerms)matchedQueries.set(item.id,query);
  organization.update(Boolean(rows.length+sources.length));
  const count=element<HTMLElement>('retained-library-count');
  count.textContent=String(rows.length+sources.length);
  count.title=count.ariaLabel=msg`${rows.length+sources.length} 项结果`;
  updateCompactFilter(retainedLibraryFilter);
  retainedLibrary.replaceChildren();
  const tag=document.querySelector<HTMLSelectElement>('#library-tag-filter')?.value??'';
  if(librarySearchOrigin&&(librarySearchOrigin.afterQuery!==retainedLibrarySearch.value||librarySearchOrigin.afterKind!==filter||librarySearchOrigin.tag!==tag||librarySearchOrigin.project!==organization.currentProject()))librarySearchOrigin=undefined;
  const changeSearch=(value:string,kind=filter)=>{librarySearchOrigin??={query:retainedLibrarySearch.value,kind:filter,afterQuery:value,afterKind:kind,tag,view:document.querySelector<HTMLSelectElement>('#library-saved-view')?.value??'',project:organization.currentProject()};librarySearchOrigin.afterQuery=value;librarySearchOrigin.afterKind=kind;retainedLibrarySearch.value=value;retainedLibraryFilter.value=kind;renderRetainedLibrary();retainedLibrarySearch.focus({preventScroll:true})};
  const restore=()=>{const saved=librarySearchOrigin;if(!saved)return;librarySearchOrigin=undefined;retainedLibrarySearch.value=saved.query;retainedLibraryFilter.value=saved.kind;const view=document.querySelector<HTMLSelectElement>('#library-saved-view');if(view&&[...view.options].some(option=>option.value===saved.view))view.value=saved.view;renderRetainedLibrary();retainedLibrarySearch.focus({preventScroll:true})};
  if(found.aliases.length)appendSearchAssistance(retainedLibrary,{query:'',terms:[],onQuery:()=>undefined,matchedTerms:found.aliases});
  if(librarySearchOrigin)appendSearchAssistance(retainedLibrary,{query:'',terms:[],onQuery:()=>undefined,restore});
  if(!rows.length&&!sources.length){
    const empty=document.createElement('div');empty.className='library-empty';
    const searching=Boolean(query||filter!=='all'||organization.active());
    const message=document.createElement('p');message.textContent=searching?t('没有匹配的资料。可以调整关键词或筛选条件。'):libraryRecent.some(item=>item.hidden)?t('最近列表暂无记录；笔记仍可通过搜索或摘录管理查看。'):t('打开 PDF 后可在这里继续阅读；保存的译文和阅读笔记也会出现在这里。');
    const action=document.createElement('button');action.type='button';action.textContent=searching?(filter==='all'&&!organization.active()?t('清除搜索'):t('清除筛选')):t('打开 PDF');
    action.addEventListener('click',()=>{if(searching){organization.clear();renderRetainedLibrary();retainedLibrarySearch.focus()}else{void browser.tabs.create({url:browser.runtime.getURL('/pdf.html')})}});
    empty.append(message,action);appendSearchAssistance(empty,{query,terms:librarySources.flatMap(item=>item.kind==='term'?[item.term]:[]),onQuery:value=>changeSearch(value),...(filter!=='all'?{broaden:{label:t('在全部资料类型中搜索'),run:()=>changeSearch(retainedLibrarySearch.value,'all')}}:{})});retainedLibrary.append(empty);libraryDetails.update(()=>document.createElement('div'));return;
  }
  for(const item of rows){
    if(item.kind==='recent'){appendRecentReadingEntry(retainedLibrary,item.recent,{drafts:libraryNameDrafts,changed:async()=>{await refreshRetainedStorageSummary()},notice:setRetainedStorageActionStatus,focusAfterRemoval:()=>retainedLibrarySearch.focus()});continue}
    const entry=item.entry,recent=item.recent,matchQuery=matchedQueries.get(item.entry.id)??query;
    const row=document.createElement('article');row.className='library-entry';row.dataset.libraryId=entry.id;row.dataset.kind=entry.kind;row.dataset.updatedAt=String(entry.updatedAt);row.dataset.libraryPinned=String(entry.pinned);
    const preview=document.createElement('div');preview.className='library-preview';
    const summary=document.createElement('a');summary.className='library-open';summary.title=msg`继续阅读 ${entry.name}`;
    summary.href=browser.runtime.getURL(`/pdf.html?library=${encodeURIComponent(entry.id)}${matchQuery?`&query=${encodeURIComponent(matchQuery)}`:''}${organization.currentProject()?`&project=${encodeURIComponent(organization.currentProject())}`:''}`);summary.target='_blank';summary.rel='noopener';
    const kind=document.createElement('span');kind.className='library-kind';kind.textContent=entry.kind==='pdf'?'PDF':'WEB';kind.ariaHidden='true';
    const description=document.createElement('span');description.className='library-description';
    const title=document.createElement('strong');title.className='library-title';appendLibraryMatch(title,entry.name,matchQuery);
    const coverage=entry.coverageKnown?msg`${entry.processedCount}/${entry.totalBlocks} 段已处理`:msg`${entry.blockCount} 段已保存`;
    const task=entry.state==='complete'?(entry.coverageKnown?t('处理完成'):t('任务已结束')) :entry.state==='paused'?t('已暂停'):entry.state==='active'?t('翻译中'):entry.state==='incomplete'?t('未完成'):t('已停止');
    const meta=document.createElement('span');meta.className='library-meta';meta.textContent=`${entry.pinned?t('已固定 · '):''}${languages[entry.targetLanguage]??entry.targetLanguage} · ${coverage} · ${task}${entry.reviewCount?msg` · ${entry.reviewCount} 段待核对`:''}${entry.confirmedCount?msg` · ${entry.confirmedCount} 段已核对`:''}`;meta.title=msg`更新于 ${new Date(entry.updatedAt).toLocaleString()}${entry.preservedCount?msg`；${entry.preservedCount} 段参考文献保留原文`:''}`;
    description.append(title,meta);summary.append(kind,description);
    const lastReading=recent?.state??entry.reading;
    const access=document.createElement('span');access.className='library-access';access.textContent=[t('可直接阅读译文'),entry.kind==='pdf'&&lastReading?msg`上次第 ${lastReading.pageNumber} 页`:'',recent?.noteCount?msg`${recent.noteCount} 条批注`:''].filter(Boolean).join(' · ');description.append(access);
    const hit=matchQuery?entry.blocks.find(block=>block.text.toLocaleLowerCase().includes(matchQuery)):undefined;
    if(hit){const index=hit.text.toLocaleLowerCase().indexOf(matchQuery),start=Math.max(0,index-30),end=Math.min(hit.text.length,index+matchQuery.length+65);const snippet=document.createElement('span');snippet.className='library-match-snippet';appendLibraryMatch(snippet,`${start?'…':''}${hit.text.slice(start,end)}${end<hit.text.length?'…':''}`,matchQuery);description.append(snippet)}
    const readLabel=document.createElement('span');readLabel.className='library-continue';readLabel.textContent=hit?t('阅读匹配段落'):t('继续阅读');description.append(readLabel);
    if(hit)summary.href+=`&block=${encodeURIComponent(hit.signature)}`;
    preview.append(summary);
    const menu=document.createElement('details');menu.className='library-menu';
    const menuToggle=document.createElement('summary');menuToggle.textContent='···';menuToggle.dataset.piIcon='more';menuToggle.title=menuToggle.ariaLabel=msg`${entry.name} 的更多操作`;
    const actions=document.createElement('div');actions.className='library-actions';
    const storageDetail=document.createElement('p');storageDetail.className='library-storage-detail';storageDetail.textContent=msg`本机记录 ${formatRetainedStorageBytes(entry.estimatedBytes)}（含公式与历史）\n更新于 ${new Date(entry.updatedAt).toLocaleString()}`;actions.append(storageDetail);
    const nameEditor=document.createElement('div');nameEditor.className='library-name-editor';nameEditor.hidden=true;
    const name=document.createElement('input');name.type='text';name.maxLength=120;name.value=libraryNameDrafts.get(entry.id)??entry.name;name.ariaLabel=t('文档名称');name.addEventListener('input',()=>libraryNameDrafts.set(entry.id,name.value));
    const rename=document.createElement('button');rename.type='button';rename.textContent=t('重命名');rename.addEventListener('click',()=>{menu.open=false;nameEditor.hidden=false;name.focus();name.select()});
    const saveName=document.createElement('button');saveName.type='button';saveName.textContent=t('保存名称');saveName.addEventListener('click',()=>{saveName.disabled=true;void renameRetainedDocument(entry.id,name.value).then(async()=>{libraryNameDrafts.delete(entry.id);setRetainedStorageActionStatus(t('名称已保存到本机。'));await refreshRetainedStorageSummary();Array.from(retainedLibrary.querySelectorAll<HTMLElement>('.library-entry')).find(item=>item.dataset.libraryId===entry.id)?.querySelector<HTMLElement>('.library-open')?.focus()}).catch(error=>{setRetainedStorageActionStatus(error instanceof Error?error.message:t('命名失败，请重试。'),true);saveName.disabled=false})});
    const cancelName=document.createElement('button');cancelName.type='button';cancelName.textContent=t('取消');cancelName.addEventListener('click',()=>{libraryNameDrafts.delete(entry.id);name.value=entry.name;nameEditor.hidden=true;menuToggle.focus()});
    name.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();saveName.click()}else if(event.key==='Escape'){event.preventDefault();cancelName.click()}});
    nameEditor.append(name,saveName,cancelName);
    const exportButton=document.createElement('button');exportButton.type='button';exportButton.textContent=t('导出 Markdown');exportButton.addEventListener('click',()=>{menu.open=false;const url=URL.createObjectURL(new Blob([entry.markdown],{type:'text/markdown;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`${entry.name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').slice(0,80)||'pi-translation'}.md`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setRetainedStorageActionStatus(t('译文已导出；不含原文和来源。'))});
    const remove=document.createElement('button');remove.type='button';remove.className='danger-text';remove.textContent=t('删除');remove.addEventListener('click',()=>{if(remove.dataset.confirm!=='true'){remove.dataset.confirm='true';remove.textContent=t('确认删除');return}remove.disabled=true;void deleteRetainedDocument(entry.id).then(async()=>{libraryNameDrafts.delete(entry.id);setRetainedStorageActionStatus(t('这份本机译文已删除。'));await refreshRetainedStorageSummary()}).catch(()=>{setRetainedStorageActionStatus(t('删除失败，请重试。'),true);remove.disabled=false})});remove.addEventListener('blur',()=>{delete remove.dataset.confirm;remove.textContent=t('删除')});
    menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();menu.open=false;menuToggle.focus()}});
    menu.addEventListener('toggle',()=>{if(menu.open){retainedLibrary.querySelectorAll<HTMLDetailsElement>('.library-menu[open]').forEach(other=>{if(other!==menu)other.open=false})}});
    const pin=document.createElement('button');pin.type='button';pin.textContent=entry.pinned?t('取消固定'):t('固定保存');pin.addEventListener('click',()=>{menu.open=false;void setRetainedDocumentPinned(entry.id,!entry.pinned).then(async()=>{setRetainedStorageActionStatus(entry.pinned?t('已取消固定，可按最近使用规则清理。'):t('已固定，不会被自动清理。'));await refreshRetainedStorageSummary()}).catch(error=>setRetainedStorageActionStatus(error instanceof Error?error.message:t('固定失败，请重试。'),true))});
    actions.append(pin);
    if(entry.kind==='pdf'){
      const restore=document.createElement('button');restore.type='button';restore.textContent=t('选择原 PDF 恢复阅读');restore.addEventListener('click',()=>{menu.open=false;void browser.tabs.create({url:browser.runtime.getURL(`/pdf.html?restore=${encodeURIComponent(entry.id)}${hit?`&block=${encodeURIComponent(hit.signature)}`:''}${organization.currentProject()?`&project=${encodeURIComponent(organization.currentProject())}`:''}`)})});actions.append(restore);
    }
    actions.append(exportButton,rename,remove);menu.append(menuToggle,actions);row.append(preview,menu,nameEditor);retainedLibrary.append(row);
  }
  const sourceBodies=appendLibrarySourceResults(retainedLibrary,sources,query,id=>{void excerptLibrary.openItem(id,()=>{void refreshRetainedStorageSummary().then(()=>{
    if(document.body.dataset.section!=='storage')return;
    const row=[...retainedLibrary.querySelectorAll<HTMLElement>('.library-source-result')].find(item=>item.dataset.sourceResult===id);
    row?.querySelector<HTMLButtonElement>('.library-select')?.click();
    const target=row?element<HTMLElement>('library-detail').querySelector<HTMLButtonElement>('.library-detail-edit'):retainedLibrarySearch;
    target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});
  })}).catch(error=>setRetainedStorageActionStatus(error instanceof Error?error.message:t('读取摘录失败，原记录未改变。'),true))},matchedQueries);
  libraryDetails.update(row=>{
    if(row.dataset.sourceResult){const body=sourceBodies.get(row.dataset.sourceResult)!(),source=librarySources.find(item=>item.id===row.dataset.sourceResult);organization.append(body,row.dataset.sourceResult,source?projectParents(source):[]);return body;}
    const body=document.createElement('div'),entry=libraryEntries.find(item=>item.id===row.dataset.libraryId);
    const metadata=document.createElement('p');metadata.className='library-detail-meta';metadata.textContent=row.querySelector('.library-meta')?.textContent??'';body.append(metadata);
    const access=row.querySelector('.library-access');if(access){const position=document.createElement('p');position.className='library-detail-meta';position.textContent=access.textContent;body.append(position)}
    if(entry){
      const matchQuery=matchedQueries.get(entry.id)??query;const block=entry.blocks.find(block=>matchQuery&&block.text.toLocaleLowerCase().includes(matchQuery))??entry.blocks[0];
      if(block){const label=document.createElement('p');label.className='library-detail-meta';label.textContent=t('译文预览');const preview=document.createElement('div');preview.className='library-detail-translation';body.append(label,preview);if(block.formulaDocument)void renderFormulaDocument(preview,block.formulaDocument,true);else void renderTranslationContent(preview,block.text,true);if(block.warning){const warning=document.createElement('p');warning.textContent=block.warning;body.append(warning)}}
    }
    const original=row.querySelector<HTMLAnchorElement>('.library-open');if(original){const link=original.cloneNode(false) as HTMLAnchorElement;link.removeAttribute('data-pi-icon');link.removeAttribute('aria-label');link.className='library-detail-read';link.textContent=t('继续阅读');body.append(link)}
    const tagId=row.dataset.libraryId??row.dataset.recentId;if(tagId)organization.append(body,tagId);
    return body;
  });
}
retainedLibrarySearch.addEventListener('input',renderRetainedLibrary);
retainedLibraryFilter.addEventListener('change',renderRetainedLibrary);
const settingsMenuSelector='.library-menu, #library-storage-tools, #profile-menu';
document.addEventListener('click',event=>{document.querySelectorAll<HTMLDetailsElement>(settingsMenuSelector).forEach(menu=>{if(!(event.target instanceof Node)||!menu.contains(event.target)||(menu.id==='profile-menu'&&event.target instanceof Element&&event.target.closest('button')))menu.open=false})});
bindAnchoredMenus(settingsMenuSelector, ':scope > .library-actions, :scope > .disclosure-content, :scope > .profile-menu-actions');
bindLibraryBackup({status:setRetainedStorageActionStatus,refresh:refreshRetainedStorageSummary,focus:()=>retainedLibrarySearch.focus()});

function renderModelPrices():void{
  modelPriceList.replaceChildren();
  for(const price of modelPrices){
    const row=document.createElement('article');row.className='model-price-entry';
    const description=document.createElement('div');
    const model=document.createElement('strong');model.textContent=price.model;
    const source=document.createElement('small');source.textContent=new URL(price.apiBaseUrl).host;
    const rates=document.createElement('span');rates.textContent=msg`${price.currency} / 百万 tokens · 输入 ${price.inputPerMillion} · 输出 ${price.outputPerMillion}`;
    description.append(model,source,rates);
    const remove=document.createElement('button');remove.type='button';remove.className='text-button danger-text';remove.textContent=t('删除单价');remove.addEventListener('click',()=>{modelPrices=modelPrices.filter(item=>item!==price);renderModelPrices();nonConnectionDirty=true;setDirty()});row.append(description,remove);modelPriceList.append(row);
  }
}
priceProfile.addEventListener('change',()=>{priceModel.value=profiles.find(profile=>profile.id===priceProfile.value)?.model??''});
addModelPriceButton.addEventListener('click',()=>{
  const profile=profiles.find(profile=>profile.id===priceProfile.value);
  const priceBase=profile?.id===currentProfileId?apiBaseUrl.value.trim():profile?.apiBaseUrl;
  const price=normalizeModelPrices([{apiBaseUrl:priceBase,model:priceModel.value,currency:priceCurrency.value,inputPerMillion:priceInput.valueAsNumber,outputPerMillion:priceOutput.valueAsNumber}])[0];
  if(!price){modelPriceStatus.textContent=t('请填写模型 ID 和有效的非负单价；空值表示未知，免费模型请填 0。');return}
  const previous=modelPrices.filter(item=>!(item.apiBaseUrl===price.apiBaseUrl&&item.model===price.model));
  if(previous.length>=30){modelPriceStatus.textContent=t('最多保存 30 个模型单价，请先删除不用的记录。');return}
  modelPrices=[...previous,price];renderModelPrices();nonConnectionDirty=true;setDirty();modelPriceStatus.textContent=t('单价已加入草稿，点击“保存设置”生效。');
});
async function clearRetainedStorage(kind:'web'|'pdf'|'all'):Promise<void>{
  retainedStoragePending=true;
  setRetainedStorageControls(undefined,undefined);
  refreshRetainedStorageButton.disabled=true;
  setRetainedStorageActionStatus(kind==='all'?t('正在清除全部本机译文…'):t('正在清除本机译文…'));
  try{
    if(kind==='web')await clearRetainedBilingualPageSession();
    else if(kind==='pdf')await clearRetainedPdfDocumentTranslationSession();
    else await Promise.all([
      clearRetainedBilingualPageSession(),
      clearRetainedPdfDocumentTranslationSession(),
    ]);
    await pruneRetainedDocumentNames();
    resetRetainedStorageConfirmation();
    setRetainedStorageActionStatus(
      kind==='web'
        ? t('网页全文译文已从本机清除。')
        : kind==='pdf'
          ? t('PDF 全文译文已从本机清除。')
          : t('所有保留的全文译文已从本机清除。'),
    );
  }catch{
    setRetainedStorageActionStatus(t('清除失败，现有译文未被完整更改，请重试。'),true);
  }finally{
    retainedStoragePending=false;
    await refreshRetainedStorageSummary();
  }
}

function apiSetupError(code:Parameters<typeof translationErrorMessage>[0],message:string,base:string):string{
  const detail=translationErrorMessage(code,message);
  if(code!=='AUTH_FAILED')return detail;
  let host='';try{host=new URL(base).hostname}catch{return detail}
  return host==='dashscope.aliyuncs.com'||host==='dashscope-intl.aliyuncs.com'||host.endsWith('.maas.aliyuncs.com')
    ? msg`${detail} 请核对阿里云 Key 的地域与此接口地址是否一致；模型叫 DeepSeek 时也应使用阿里云地址。`
    : msg`${detail} 请确认 Key 由当前接口的服务商签发；模型名称不代表 Key 的服务商。`;
}
function activeOnboardingPreset(){return API_PRESETS.find(preset=>preset.id===onboardingPreset.value)}
function providerHint(presetId:string):string {
  const preset=API_PRESETS.find(item=>item.id===presetId);
  if(!preset)return t('填写服务商提供的 API Base URL；模型可读取或手动输入。');
  return t(preset.keyHint??msg`将使用 ${t(preset.name)} 的预设接口地址；连接后读取此 Key 实际可用的模型。`);
}
function renderProviderKeyAction(
  button:HTMLButtonElement,
  preset:ReturnType<typeof activeOnboardingPreset>,
):void {
  button.hidden=!preset?.keyUrl;
  button.dataset.keyUrl=preset?.keyUrl??'';
  if(preset?.keyUrl)button.setAttribute('aria-label',msg`前往 ${preset.name} 官方页面获取 API Key`);
  else button.removeAttribute('aria-label');
}
function refreshProviderHint():void{
  const preset=API_PRESETS.find(item=>item.id===apiPreset.value);
  apiProviderHint.textContent=providerHint(apiPreset.value);
  renderProviderKeyAction(openProviderKeyPageButton,preset);
}
function renderModelCatalog(onboarding=false):void{
  const models=onboarding?onboardingAvailableModels:availableTextModels;
  const select=onboarding?onboardingModelFamily:modelFamilySelect;
  const list=onboarding?onboardingModelList:modelList;
  const status=onboarding?onboardingModelCatalogStatus:modelCatalogStatus;
  const all=translationModelChoices(models);
  const families=new Set(all.map(modelFamily));
  const previous=select.value||'all';
  select.replaceChildren(...MODEL_FAMILIES.filter(family=>family.id==='all'||families.has(family.id)).map(family=>{
    const option=document.createElement('option');option.value=family.id;option.textContent=t(family.name);return option;
  }));
  select.value=families.has(previous)?previous:'all';
  select.hidden=families.size<2;
  const shown=translationModelChoices(models,select.value);
  list.replaceChildren(...shown.map(model=>{const option=document.createElement('option');option.value=model;return option}));
  status.textContent=models.length
    ?msg`接口返回 ${all.length} 个文字候选，当前显示 ${shown.length} 个。可筛选系列或输入 ID；能否调用以翻译验证为准。`
    :t('可接入 GPT、Claude、Gemini、Qwen、DeepSeek 等；模型由所选服务商提供，也可手动填写 ID。');
}
function setModelCatalog(models:string[],onboarding=false):void{
  if(onboarding)onboardingAvailableModels=[...models];else availableTextModels=[...models];
  (onboarding?onboardingModelFamily:modelFamilySelect).value='all';
  renderModelCatalog(onboarding);
}
modelFamilySelect.addEventListener('change',()=>renderModelCatalog());
onboardingModelFamily.addEventListener('change',()=>renderModelCatalog(true));
function applyOnboardingPreset():void{
  onboardingAvailableModels=[];
  onboardingApiKey.value='';
  setModelCatalog([],true);
  const preset=activeOnboardingPreset();
  renderProviderKeyAction(onboardingOpenKeyPageButton,preset);
  onboardingBaseUrlField.hidden=Boolean(preset&&preset.id!=='qwen');
  if(!preset){
    onboardingBaseUrl.value='';
    onboardingModel.value='';
    onboardingKeyHint.textContent=t('自定义接口需要填写 Base URL；随后会尝试读取当前 Key 可用的模型。');
    return;
  }
  onboardingBaseUrl.value=preset.apiBaseUrl;
  onboardingModel.value=preset.model;
  onboardingKeyHint.textContent=t(preset.keyHint??t('Key 不会发送给 P&I Lab，也不会写入配置导出文件。'));
  if(preset.id==='ollama'&&!onboardingApiKey.value)onboardingApiKey.value='ollama';
}
function showOnboardingStep(step:number,focusStep=false):void{
  onboardingComplete=false;
  onboardingDialog.classList.remove('complete');
  onboardingTitle.textContent=t('三步开始使用 Pi Translator');
  onboardingSuccess.hidden=true;
  onboardingSkip.hidden=false;
  onboardingStep=Math.min(3,Math.max(1,step));
  onboardingWebAccess.hidden=Boolean(loadedSettingsBaseline?.onboardingCompleted)||loadedSettingsBaseline?.generalPageMode!=='on-demand';
  for(const section of document.querySelectorAll<HTMLElement>('[data-onboarding-step]'))section.hidden=Number(section.dataset.onboardingStep)!==onboardingStep;
  for(const dot of document.querySelectorAll<HTMLElement>('[data-onboarding-dot]')){
    const index=Number(dot.dataset.onboardingDot);
    dot.classList.toggle('active',index===onboardingStep);
    dot.classList.toggle('complete',index<onboardingStep);
  }
  onboardingBack.hidden=onboardingStep===1;
  onboardingNext.textContent=onboardingStep===1?t('下一步'):onboardingStep===2?t('连接并读取模型'):t('完成示例翻译');
  setOnboardingStatus('');
  if(focusStep)queueMicrotask(()=>{
    const target=onboardingStep===1?onboardingPreset:onboardingStep===2?onboardingApiKey:onboardingModel;
    target.focus();
  });
}
function showOnboardingSuccess(sampleSource:string,sampleTranslation:string):void{
  onboardingComplete=true;
  onboardingDialog.classList.add('complete');
  onboardingTitle.textContent=t('Pi Translator 已就绪');
  for(const section of document.querySelectorAll<HTMLElement>('[data-onboarding-step]'))section.hidden=true;
  onboardingSuccess.hidden=false;
  onboardingSampleSource.textContent=sampleSource;
  onboardingSampleTranslation.textContent=sampleTranslation;
  for(const dot of document.querySelectorAll<HTMLElement>('[data-onboarding-dot]')){
    dot.classList.remove('active');
    dot.classList.add('complete');
  }
  onboardingSkip.hidden=true;
  onboardingBack.hidden=true;
  onboardingNext.textContent=t('完成');
  setOnboardingStatus('');
  queueMicrotask(()=>onboardingNext.focus());
}
function openProviderKeyPage(button:HTMLButtonElement):void{
  const url=button.dataset.keyUrl;
  if(url)void browser.tabs.create({url});
}

let onboardingPurposeDirty=false;
let onboardingPurposeBaseline:ReturnType<typeof normalizePurposePreferences>;
const onboardingPurposeChecks=Array.from(document.querySelectorAll<HTMLInputElement>('[name="onboarding-purpose-choice"]'));
const onboardingResearch=element<HTMLElement>('onboarding-research');
const onboardingResearchField=element<HTMLInputElement>('onboarding-research-field');
const onboardingFieldTranslation=element<HTMLInputElement>('onboarding-field-translation');
function initOnboardingPurpose():void{
  onboardingPurposeBaseline=normalizePurposePreferences(loadedSettingsBaseline?.purposePreferences);
  onboardingPurposeDirty=false;
  for(const check of onboardingPurposeChecks)check.checked=Boolean(onboardingPurposeBaseline?.purposes.includes(check.value as typeof PURPOSE_IDS[number]));
  onboardingResearchField.value=onboardingPurposeBaseline?.researchField??'';
  onboardingFieldTranslation.checked=Boolean(onboardingPurposeBaseline?.useFieldInTranslation);
  onboardingResearch.hidden=!onboardingPurposeChecks.find(check=>check.value==='research')?.checked;
  element<HTMLDetailsElement>('onboarding-purpose').open=false;
}
function onboardingPurposeToken():string{return JSON.stringify([onboardingPurposeDirty,onboardingPurposeChecks.map(check=>check.checked),onboardingResearchField.value,onboardingFieldTranslation.checked])}
function onboardingPurposePatch(latest:ExtensionSettings,submission:string):Partial<ExtensionSettings>{
  if(submission!==onboardingPurposeToken())throw new Error('用途选择已变化，请核对当前输入后重试。');
  if(!onboardingPurposeDirty)return {};
  const current=normalizePurposePreferences(latest.purposePreferences);
  if(JSON.stringify(current)!==JSON.stringify(onboardingPurposeBaseline))throw new Error('另一窗口已修改用途偏好，请保留当前输入并核对后重试。');
  const purposes=PURPOSE_IDS.filter(id=>onboardingPurposeChecks.some(check=>check.value===id&&check.checked));
  return {purposePreferences:normalizePurposePreferences({purposes,researchField:onboardingResearchField.value,...(onboardingFieldTranslation.checked?{useFieldInTranslation:true}:{})})!};
}
for(const check of onboardingPurposeChecks)check.addEventListener('change',()=>{onboardingPurposeDirty=true;resetWizardSkipConfirmation();onboardingResearch.hidden=!onboardingPurposeChecks.find(item=>item.value==='research')?.checked});
onboardingResearchField.addEventListener('input',()=>{onboardingPurposeDirty=true;resetWizardSkipConfirmation()});
onboardingFieldTranslation.addEventListener('change',()=>{onboardingPurposeDirty=true;resetWizardSkipConfirmation()});

async function finishOnboarding():Promise<void>{
  const purposeSubmission=onboardingPurposeToken();
  const revision=wizardRevision;assertWizardCurrent(revision,3);
  const base=normalizeApiBaseUrl(onboardingBaseUrl.value);
  const apiKey=onboardingApiKey.value.trim();
  assertKeyOrigin(apiKey,wizardKeyOrigin,base);
  const model=onboardingModel.value.trim();
  if(!apiKey)throw new Error('请填写 API Key。');
  if(!model)throw new Error('请填写模型名称。');
  setOnboardingStatus(t('正在完成文字示例翻译…'));
  const response=await browser.runtime.sendMessage({type:'TEST_API_CONNECTION',payload:{apiKey,apiBaseUrl:base,model}} satisfies RuntimeMessage) as ConnectionTestResponse;
  assertWizardCurrent(revision,3);
  if(!response.ok)throw new Error(apiSetupError(response.error.code,response.error.message,base));
  const preset=activeOnboardingPreset();
  const profile:ApiProfile={id:crypto.randomUUID(),name:preset?.name??t('自定义 API'),apiBaseUrl:base,model};
  // Only an explicit image-recovery flow needs an image capability request.
  const visionDetection:VisionDetectionResult=activeSettingsRecovery?.role==='vision'
    ? await detectVisionModel(profile,onboardingAvailableModels,model,apiKey)
    : {};
  assertWizardCurrent(revision,3);
  const visionSupported=Boolean(visionDetection.model);
  const mode:ApiKeyStorageMode=onboardingPersistKey.checked?'local':'session';
  const transaction=await mutateApiConfiguration(async(latest)=>{
    const emptyDefault=latest.apiProfiles.length===1&&latest.apiProfiles[0]?.id==='default'&&
      latest.apiProfiles[0]?.name==='默认接口'&&!latest.onboardingCompleted&&
      !latest.visionApiProfileId&&!await hasApiKey('default');
    return {
      nextSettings:{...latest,...onboardingPurposePatch(latest,purposeSubmission),schemaVersion:8,apiProfiles:[...(emptyDefault?[]:latest.apiProfiles),profile],activeApiProfileId:profile.id,visionApiProfileId:visionSupported?profile.id:latest.visionApiProfileId,visionModel:visionDetection.model??latest.visionModel,apiBaseUrl:base,model,apiKeyStorage:mode,onboardingCompleted:true},
      credentials:{saveApiKey:{apiKey,mode,profileId:profile.id}},
      value:undefined,
    };
  });
  if(!onboardingDialog.open||onboardingStep!==3||wizardRevision!==revision||onboardingPurposeToken()!==purposeSubmission){
    if(onboardingDialog.open)setOnboardingStatus(t('已保存提交时的接口配置，后续输入仍保留。'));
    return;
  }
  const carriedWizardDrafts=[...wizardDrafts].filter(([provider,draft])=>{const preset=API_PRESETS.find(item=>item.id===provider);return provider!==wizardProvider&&wizardTouchedProviders.has(provider)&&(Boolean(draft.key.trim())||draft.base!==(preset?.apiBaseUrl??'')||draft.model!==(preset?.model??''))});
  onboardingApiKey.value='';wizardKeyOrigin=undefined;wizardDrafts.clear();wizardTouchedProviders.clear();wizardInputDirty=false;wizardRevision++;
  const completionRevision=wizardRevision;
  await load();
  for(const [provider,draft] of carriedWizardDrafts){const id=draftId(profile.id,provider);connectionDrafts.set(id,draft);protectedConnectionDrafts.add(id)}
  if(carriedWizardDrafts.length)setDirty();
  if(!onboardingDialog.open||onboardingStep!==3||wizardRevision!==completionRevision){
    if(onboardingDialog.open)setOnboardingStatus(t('已保存提交时的接口配置，后续输入仍保留。'));
    return;
  }
  if(!transaction.revisionId)throw new Error('首次设置未能提交。');
  const completionMessage=visionSupported
    ? msg`首次设置已完成；文字模型为 ${model}，图像翻译模型为 ${visionDetection.model}。`
    : t('首次设置已完成，普通网页划词、Overleaf 划词和可选文字 PDF 已可翻译；网页框选或框选扫描件需要视觉模型，“识别本页”需要官方 Qwen / 阿里云百炼。');
  setStatus(carriedWizardDrafts.length?t('已完成当前接口；其他服务商输入仍保留在设置页草稿中。'):completionMessage);
  if(activeSettingsRecovery){
    onboardingDialog.close();
    if(requestedFocusDeferred)await applyRequestedSettingsFocus();
    await completeSettingsRecovery({text:true,vision:visionSupported},transaction.revisionId);
    return;
  }
  showOnboardingSuccess(response.data.sampleSource,response.data.sampleTranslation);
  if(carriedWizardDrafts.length)setOnboardingStatus(t('其他服务商输入仍保留在设置页草稿中。'));
}

function validatedProfiles():ApiProfile[] {
  updateCurrentProfile();
  return profiles.map((profile,index)=>{
    const name=profile.name.trim()||msg`翻译接口 ${index+1}`;
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
  profiles[index]={...profiles[index]!,name:profileName.value.trim()||t('未命名配置'),apiBaseUrl:base,model:modelInput.value.trim()};
}

function renderProfileSelect():void {
  profileSelect.replaceChildren(...profiles.map(profile=>{const option=document.createElement('option');option.value=profile.id;const roles=[...(profile.id===activeTextProfileId?[t('文字翻译')]:[]),...(profile.id===visionProfileId?[t('图像翻译')]:[])];option.textContent=roles.length?`${profile.name} · ${roles.join(' / ')}`:profile.name;return option}));
  profileSelect.value=currentProfileId;deleteProfileButton.disabled=profiles.length<=1;navProfileName.textContent=activeTextProfile()?.name??t('未命名配置');renderVisionProfileSelect();
  const previous=priceProfile.value;
  priceProfile.replaceChildren(...profiles.map(profile=>{const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;return option}));
  priceProfile.value=profiles.some(profile=>profile.id===previous)?previous:activeTextProfileId;
  if(!priceModel.value)priceModel.value=profiles.find(profile=>profile.id===priceProfile.value)?.model??'';
}

function renderProfileRole():void {
  const roles:string[]=[];
  if(currentProfileId===activeTextProfileId)roles.push(t('文字翻译'));
  if(currentProfileId===visionProfileId)roles.push(t('图像翻译'));
  profileRoleStatus.textContent=msg`当前配置用途：${roles.length?roles.join(' · '):t('尚未分配')}`;
  const textProfile=profiles.find(profile=>profile.id===activeTextProfileId),visionProfile=profiles.find(profile=>profile.id===visionProfileId);
  element<HTMLElement>('text-profile-summary').textContent=textProfile?`${textProfile.name} · ${(textProfile.id===currentProfileId?modelInput.value.trim():textProfile.model)||t('待选择模型')}`:t('尚未配置');
  element<HTMLElement>('vision-profile-summary').textContent=visionProfile?`${visionProfile.name} · ${visionModel.value.trim()||visionProfile.model||t('待选择模型')}`:t('尚未配置');
  backToTextProfileButton.hidden=currentProfileId===activeTextProfileId;
  useTextProfileButton.hidden=currentProfileId===activeTextProfileId;
}

function renderVisionProfileSelect():void {
  const empty=document.createElement('option');empty.value='';empty.textContent=t('尚未配置');
  visionApiProfile.replaceChildren(empty,...profiles.map(profile=>{const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;return option}));
  if(!profiles.some(profile=>profile.id===visionProfileId))visionProfileId='';visionApiProfile.value=visionProfileId;renderProfileRole();void refreshVisionSetupStatus();
}

async function refreshVisionSetupStatus():Promise<void>{
  const profile=profiles.find(item=>item.id===visionProfileId);
  const pendingProfile=profiles.find(item=>item.id===visionSetupIntentProfileId);
  if(!profile){
    element<HTMLElement>('vision-setup-overview').textContent=pendingProfile?t('配置中'):t('尚未配置');
    setupQwenButton.textContent=t('配置 Qwen');
    if(pendingProfile){
      const pendingKeyConfigured=(currentProfileId===pendingProfile.id&&Boolean(apiKeyInput.value.trim()))||await hasApiKey(pendingProfile.id);
      if(pendingProfile.id!==visionSetupIntentProfileId)return;
      visionSetupStatus.textContent=pendingKeyConfigured
        ? msg`正在配置“${pendingProfile.name}”；Key 已填写，连接成功后会自动用于图像翻译，文字翻译配置不会改变。`
        : msg`正在配置“${pendingProfile.name}”；填写 Key 并连接成功后会自动用于图像翻译，文字翻译配置不会改变。`;
    }else{
      visionSetupStatus.textContent=t('尚未配置，不影响普通文字翻译。需要扫描件功能时再补充 Qwen Key 即可。');
    }
    return;
  }
  const profileId=profile.id;
  const keyConfigured=(currentProfileId===profileId&&Boolean(apiKeyInput.value.trim()))||await hasApiKey(profileId);
  if(profileId!==visionProfileId)return;
  const model=visionModel.value.trim()||profile.model;
  element<HTMLElement>('vision-setup-overview').textContent=keyConfigured&&model?t('已配置'):t('待补充');
  const scope=isOfficialQwenProfile(profile)?t('框选翻译与“识别本页”'):t('可用于框选翻译；“识别本页”仍需官方 Qwen');
  visionSetupStatus.textContent=msg`已配置：${profile.name} · ${model||t('待选择模型')} · ${keyConfigured?t('Key 已配置'):t('Key 尚未配置')} · ${scope}`;
  setupQwenButton.textContent=isOfficialQwenProfile(profile)?t('管理 Qwen'):t('配置 Qwen');
}

async function loadProfile(profileId:string):Promise<void>{
  setModelCatalog([]);
  const profile=profiles.find(item=>item.id===profileId);if(!profile)return;rememberConnectionDraft();currentProfileId=profile.id;profileName.value=profile.name;apiBaseUrl.value=profile.apiBaseUrl;modelInput.value=profile.model;apiPreset.value=API_PRESETS.find(preset=>preset.apiBaseUrl===profile.apiBaseUrl)?.id??'custom';connectionAdvanced.open=apiPreset.value==='custom';refreshProviderHint();connectionProvider=apiPreset.value;const rememberedId=draftId(currentProfileId,connectionProvider),candidate=connectionDrafts.get(rememberedId),remembered=candidate&&connectionDraftChanged(rememberedId,candidate)?candidate:undefined;apiKeyInput.value=remembered?.key??'';connectionKeyOrigin=remembered?.keyOrigin;if(remembered){apiBaseUrl.value=remembered.base;modelInput.value=remembered.model}refreshKeyOriginNotice(false);renderProfileSelect();diagnosticReport.hidden=true;await Promise.all([refreshKeyState(),refreshApiPermissionState()]);
  connectionSummary.hidden=true;
  connectionAdvanced.open=false;
}

function refreshPageModeFields():void {
  const mode=generalPageMode.value as GeneralPageMode;siteAllowlistField.hidden=mode!=='allowlist';
  const messages:Record<GeneralPageMode,string>={off:t('普通网页不会显示菜单或浮动按钮。'),'on-demand':t('默认不自动显示划词按钮；可用右键、快捷键或打开侧栏。需要自动显示时，请选择指定网站或所有网站。'),allowlist:t('只在指定网站持续启用划词按钮；其他普通网页仍可按需翻译。'),'all-sites':t('会请求所有 HTTP/HTTPS 网站的长期访问权限，以显示划词按钮。')};pageModeHelp.textContent=messages[mode];
}

function refreshPdfShortcutField():void {
  const enabled=pdfKeyboardShortcuts.checked;
  pdfRegionShortcutKey.disabled=!enabled;
  pdfRegionShortcutField.classList.toggle('disabled',!enabled);
}

async function refreshKeyState():Promise<void>{
  const profileId=currentProfileId;
  const [configured,activeConfigured]=await Promise.all([hasApiKey(profileId),hasApiKey(activeTextProfileId)]);
  if(profileId!==currentProfileId)return;
  const saved=loadedSettingsBaseline?.apiProfiles.find(profile=>profile.id===profileId);
  let changed=false;
  try{changed=Boolean(saved&&normalizeApiBaseUrl(saved.apiBaseUrl)!==currentApiBaseUrl())}catch{changed=Boolean(saved)}
  apiKeyState.textContent=changed&&configured?t('接口地址已更改，请重新填写对应的 Key；原 Key 不会发送到新地址。'):configured?t('当前配置已保存 Key；留空可保留'):t('当前配置尚未保存 Key');
  navKeyStatus.textContent=activeConfigured?t('● Key 已配置'):t('○ 尚未配置 Key');
  navKeyStatus.classList.toggle('configured',activeConfigured);
  await refreshVisionSetupStatus();
}
async function refreshApiPermissionState():Promise<void>{try{const base=currentApiBaseUrl();const pattern=apiOriginPattern(base);const granted=await browser.permissions.contains({origins:[pattern]});apiPermissionState.className=`permission-state ${granted?'granted':'pending'}`;apiPermissionState.textContent=granted?msg`已授权访问 ${new URL(base).origin}`:t('保存、测试或诊断时，浏览器会请求访问该 API 域名。')}catch{apiPermissionState.className='permission-state invalid';apiPermissionState.textContent=t('请填写有效的 API Base URL。')}}

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
  let lastError=t('当前接口未返回明显支持图片输入的模型。');
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
  setCapabilityStatus(connectionTextStatus,report.chatCompletion?msg`可用 · ${textModel}`:t('对话接口验证失败'),report.chatCompletion?'success':'muted');
  const formats=[report.structuredOutput?t('结构化输出'):t('完整译文降级'),report.sentenceAlignment?t('逐句对照'):t('逐句自动降级')];
  setCapabilityStatus(connectionFormatStatus,formats.join(' · '),report.structuredOutput&&report.sentenceAlignment?'success':'muted');
  if(vision.model){
    const latency=vision.latencyMs?` · ${vision.latencyMs} ms`:'';
    setCapabilityStatus(connectionVisionStatus,`${vision.preserved?t('保留现有配置'):t('可用')} · ${vision.model}${latency}`,vision.preserved?'muted':'success');
  }else{
    setCapabilityStatus(connectionVisionStatus,t('未自动启用；文字翻译不受影响'),'muted');
  }
  connectionSummary.hidden=false;
}

async function autoConfigureVisionProfile(active:ApiProfile):Promise<{attempted:boolean;configured:boolean}>{
  const explicitQwenSetup=visionSetupIntentProfileId===active.id;
  if(!explicitQwenSetup&&(visionProfileId||visionSelectionTouched))return {attempted:false,configured:Boolean(visionProfileId)};
  const model=active.model.trim();
  if(!model)return {attempted:false,configured:false};
  setVisionTestStatus(t('正在自动检测当前模型的图片输入能力…'));
  const response=await requestVisionCapabilityTest(active,model,apiKeyInput.value);
  if(!response.ok){
    setVisionTestStatus(msg`未自动启用：${translationErrorMessage(response.error.code,response.error.message)}`);
    return {attempted:true,configured:false};
  }
  visionProfileId=active.id;
  visionSetupIntentProfileId='';
  visionModel.value=model;
  renderVisionProfileSelect();
  setVisionTestStatus(msg`已自动启用图像区域翻译 · ${response.data.latencyMs} ms`,'success');
  return {attempted:true,configured:true};
}

async function removeUnusedApiAccess(previous:ApiProfile[],next:ApiProfile[],activeProfileId:string,visionProfileId:string,mode:GeneralPageMode,allowlist:string[]):Promise<void>{
  const retained=new Set([...enabledApiProfiles(next,activeProfileId,visionProfileId).map(profile=>apiOriginPattern(profile.apiBaseUrl)),...getAutoInjectionPatterns(mode,allowlist)]);
  await Promise.allSettled(previous.map(profile=>apiOriginPattern(profile.apiBaseUrl)).filter(origin=>!retained.has(origin)).map(origin=>browser.permissions.remove({origins:[origin]})));
}

async function load():Promise<void>{
  if(!formDirty&&!apiKeyInput.value.trim()&&!hasOtherConnectionKeyDrafts()){connectionDrafts.clear();protectedConnectionDrafts.clear();connectionProvider=''}
  modelPrices=normalizeModelPrices((await getSettings()).modelPrices);renderModelPrices();
  const [settings]=await Promise.all([getSettings(),refreshTranslationShortcut()]);loadedSettingsBaseline=settings;profiles=settings.apiProfiles.map(profile=>({...profile}));activeTextProfileId=settings.activeApiProfileId;currentProfileId=activeTextProfileId;visionProfileId=settings.visionApiProfileId;visionSelectionTouched=false;visionSetupIntentProfileId='';visionModel.value=settings.visionModel;originalMode=settings.apiKeyStorage;persistKey.checked=settings.apiKeyStorage==='local';sourceLanguage.value=settings.sourceLanguage;targetLanguage.value=settings.targetLanguage;styleSelect.value=settings.style;contentMode.value=settings.contentMode;glossaryProfiles.load(settings);purposePreferences.load(settings);rememberHistory.checked=settings.rememberRecentTranslations;historyLimit.value=String(settings.historyLimit);sessionCache.checked=settings.enableSessionCache;alignmentDefault.checked=settings.sentenceAlignmentDefault;autoRenderLatex.checked=settings.autoRenderLatex;sidebarMode.value=settings.sidebarMode;sidebarSide.value=settings.sidebarSide;refreshSidebarSide();contextMode.value=settings.contextMode;element<HTMLSelectElement>('paragraph-shortcut').value=settings.paragraphShortcut??'off';enableStreaming.checked=settings.enableStreaming;protectSensitiveFields.checked=settings.protectSensitiveFields;pdfKeyboardShortcuts.checked=settings.pdfKeyboardShortcutsEnabled;pdfRegionShortcutKey.value=settings.pdfRegionShortcutKey.toUpperCase();refreshPdfShortcutField();generalPageMode.value=settings.generalPageMode;siteAllowlist.value=settings.siteAllowlist.join('\n');floatingButton.checked=settings.showFloatingButtonOnOverleaf;hideTargetLanguageTrigger.checked=settings.hideFloatingButtonForTargetLanguage;contextMenu.checked=settings.enableContextMenu;refreshPageModeFields();await loadProfile(currentProfileId);setSaved();if(!settings.onboardingCompleted&&!onboardingDialog.open){onboardingPreset.value=API_PRESETS[0]?.id??'';beginWizardProvider();initOnboardingPurpose();showOnboardingStep(1);onboardingDialog.showModal()}
}

for(const [index,button] of settingsNavButtons.entries()){
  const option=document.createElement('option');option.value=button.dataset.settingsTarget??'connection';option.textContent=[...button.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim();settingsSectionSelect.append(option);
  const target=button.dataset.settingsTarget??'connection';button.setAttribute('aria-controls',`settings-${target}`);
  button.addEventListener('click',()=>showSettingsSection(target));
  button.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key))return;event.preventDefault();const delta=event.key==='ArrowDown'||event.key==='ArrowRight'?1:-1;const next=settingsNavButtons[(index+delta+settingsNavButtons.length)%settingsNavButtons.length];if(!next)return;showSettingsSection(next.dataset.settingsTarget??'connection');next.focus()});
}
settingsSectionSelect.addEventListener('change',()=>showSettingsSection(settingsSectionSelect.value));
const narrowSettings=matchMedia('(max-width:860px)');
let focusedNavigationControl:HTMLElement|undefined;
document.addEventListener('focusin',event=>{
  const target=event.target;
  focusedNavigationControl=target===settingsSectionSelect?settingsSectionSelect:settingsNavButtons.find(button=>button===target);
});
document.addEventListener('focusout',event=>{
  if(event.target===focusedNavigationControl&&focusedNavigationControl?.checkVisibility())focusedNavigationControl=undefined;
});
narrowSettings.addEventListener('change',()=>{
  const focused=document.activeElement;
  const hidden=focusedNavigationControl&&!focusedNavigationControl.checkVisibility()?focusedNavigationControl:undefined;
  if(narrowSettings.matches&&settingsNavButtons.some(button=>button===focused||button===hidden))settingsSectionSelect.focus();
  else if(!narrowSettings.matches&&(focused===settingsSectionSelect||hidden===settingsSectionSelect))settingsNavButtons.find(button=>button.classList.contains('active'))?.focus();
});
function refreshSidebarSide():void{element<HTMLElement>('sidebar-side-field').hidden=sidebarMode.value!=='floating'}
sidebarMode.addEventListener('change',refreshSidebarSide);
const uiLanguageSelect=element<HTMLSelectElement>('ui-language');
uiLanguageSelect.value=currentUiLanguagePreference();
uiLanguageSelect.addEventListener('change',()=>{
  if(purposePreferences.hasUnconfirmed()){uiLanguageSelect.value=currentUiLanguagePreference();showSettingsSection('translation');purposePreferences.open();setStatus(t('请先确认或还原用途选择，再切换界面语言。'),true);return}
  if(formDirty){uiLanguageSelect.value=currentUiLanguagePreference();setStatus(t('请先保存或撤销当前更改，再切换界面语言。'),true);return}
  const value=uiLanguageSelect.value;
  if(value!=='auto'&&value!=='zh-CN'&&value!=='en')return;
  uiLanguageSelect.disabled=true;
  void saveUiLanguagePreference(value).then(()=>location.reload()).catch(()=>{
    uiLanguageSelect.disabled=false;uiLanguageSelect.value=currentUiLanguagePreference();setStatus(t('无法保存界面语言，请重试。'),true);
  });
});
const requestedSection=location.hash.slice(1);
function applySettingsHash():void{const section=location.hash.slice(1);showSettingsSection(section==='cost'||settingsSections.some(item=>item.dataset.settingsSection===section)?section:'connection')}
applySettingsHash();
window.addEventListener('hashchange',applySettingsHash);
refreshRetainedStorageButton.addEventListener('click',()=>{
  const menu=element<HTMLDetailsElement>('library-storage-tools');menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});
  setRetainedStorageActionStatus('');
  void refreshRetainedStorageSummary();
});
clearRetainedWebButton.addEventListener('click',()=>{
  resetRetainedStorageConfirmation();
  void clearRetainedStorage('web');
});
clearRetainedPdfButton.addEventListener('click',()=>{
  resetRetainedStorageConfirmation();
  void clearRetainedStorage('pdf');
});
clearAllRetainedStorageButton.addEventListener('click',()=>{
  if(clearAllRetainedStorageButton.classList.contains('confirming')){
    void clearRetainedStorage('all');
    return;
  }
  resetRetainedStorageConfirmation();
  clearAllRetainedStorageButton.classList.add('confirming');
  clearAllRetainedStorageButton.textContent=t('再次点击，确认清除全部');
  setRetainedStorageActionStatus(t('此操作只清除主动保留的全文译文，不会删除设置、API Key 或术语表。'));
  retainedStorageConfirmationTimer=setTimeout(()=>{
    resetRetainedStorageConfirmation();
    setRetainedStorageActionStatus(t('未执行清除。'));
  },6000);
});
browser.storage.onChanged.addListener((changes,areaName)=>{
  if(areaName!=='local'||!(
    BILINGUAL_PAGE_RETAINED_STORAGE_KEY in changes||
    PDF_DOCUMENT_TRANSLATION_RETAINED_STORAGE_KEY in changes||RETAINED_DOCUMENT_NAMES_KEY in changes||WEB_EXCERPTS_KEY in changes||PDF_TRANSLATION_MARKERS_KEY in changes||PDF_READING_ANNOTATIONS_KEY in changes||PDF_AREA_NOTES_KEY in changes||RECENT_PDF_DOCUMENTS_KEY in changes||RECENT_PDF_OVERRIDES_KEY in changes||PDF_READING_STATES_KEY in changes||DOCUMENT_MEMORY_STORAGE_KEY in changes||Object.keys(changes).some(key=>key.startsWith('fixedDocumentTranslationV1:'))
  ))return;
  void refreshRetainedStorageSummary();
});
function markFormDirty(event:Event):void{
  const target=event.target;
  if(target===academicGlossary||target===element<HTMLSelectElement>('glossary-profile'))purposePreferences.refreshSchemes();
  if(target instanceof Element){for(const [key,control] of Object.entries(purposeControls))if(target===control)purposePreferences.manual(key as PurposeSettingKey);if(target.id==='glossary-profile')purposePreferences.manual('activeGlossaryProfileId')}
  if(target instanceof Element&&target.closest('.model-family-select, #ui-language, #import-settings-file'))return;
  if(target instanceof Element&&target.closest('#settings-storage'))return;
  if(target instanceof Element&&!target.closest('#settings-connection'))nonConnectionDirty=true;
  setDirty();
}
form.addEventListener('input',markFormDirty);
form.addEventListener('change',markFormDirty);
window.addEventListener('beforeunload',event=>{if(!formDirty&&!purposePreferences.hasUnconfirmed()&&!hasOtherConnectionKeyDrafts()&&!(onboardingDialog.open&&(wizardHasInput()||onboardingPurposeDirty)))return;event.preventDefault();event.returnValue=''});

onboardingPreset.addEventListener('change',changeWizardProvider);
onboardingApiKey.addEventListener('input',()=>{wizardKeyOrigin=onboardingApiKey.value.trim()?apiInputOrigin(onboardingBaseUrl.value):undefined;refreshKeyOriginNotice(true)});
onboardingBaseUrl.addEventListener('input',()=>refreshKeyOriginNotice(true));
element<HTMLButtonElement>('onboarding-confirm-key-origin').addEventListener('click',()=>{const origin=apiInputOrigin(onboardingBaseUrl.value);if(!origin)return;wizardKeyOrigin=origin;wizardRevision++;refreshKeyOriginNotice(true);setOnboardingStatus(t('已确认用于当前地址；尚未保存。'))});
apiKeyInput.addEventListener('input',()=>{connectionKeyOrigin=apiKeyInput.value.trim()?apiInputOrigin(apiBaseUrl.value):undefined;refreshKeyOriginNotice(false)});
element<HTMLButtonElement>('confirm-key-origin').addEventListener('click',()=>{const origin=apiInputOrigin(apiBaseUrl.value);if(!origin)return;connectionKeyOrigin=origin;refreshKeyOriginNotice(false);setStatus(t('已确认用于当前地址；尚未保存。'))});
for(const input of [onboardingApiKey,onboardingBaseUrl,onboardingModel,onboardingPersistKey])input.addEventListener('input',()=>{wizardInputDirty=true;if(input!==onboardingPersistKey)wizardTouchedProviders.add(wizardProvider);wizardRevision++;resetWizardSkipConfirmation()});
onboardingEnableWeb.addEventListener('click',()=>{
  const baseline=loadedSettingsBaseline;
  if(!baseline||baseline.onboardingCompleted||baseline.generalPageMode!=='on-demand')return;
  onboardingEnableWeb.disabled=true;
  // Keep the request directly in the click handler so the browser sees a user gesture.
  void browser.permissions.request({origins:getAutoInjectionPatterns('all-sites',[])}).then(async granted=>{
    if(!granted){onboardingWebStatus.textContent=t('未授权；仍可通过右键菜单或侧栏翻译。');return}
    const result=await mutateSettings(latest=>{
      if(latest.onboardingCompleted||latest.generalPageMode!==baseline.generalPageMode||JSON.stringify(latest.siteAllowlist)!==JSON.stringify(baseline.siteAllowlist))return {nextSettings:null,value:false};
      return {nextSettings:{...latest,generalPageMode:'all-sites'},value:true};
    });
    if(!result.value){onboardingWebStatus.textContent=t('网页设置已变化，请在页面范围中核对。');return}
    loadedSettingsBaseline={...baseline,generalPageMode:'all-sites'};
    generalPageMode.value='all-sites';refreshPageModeFields();
    onboardingEnableWeb.textContent=t('网页划词按钮已启用');
    onboardingWebStatus.textContent=t('刷新已打开的网页后生效；选中文字不会自动翻译。');
  }).catch(()=>{onboardingWebStatus.textContent=t('暂时无法启用，可稍后在页面范围中设置。')}).finally(()=>{
    onboardingEnableWeb.disabled=loadedSettingsBaseline?.generalPageMode==='all-sites';
  });
});
onboardingBack.addEventListener('click',()=>{wizardRevision++;resetWizardSkipConfirmation();showOnboardingStep(onboardingStep-1,true)});
onboardingOpenKeyPageButton.addEventListener('click',()=>openProviderKeyPage(onboardingOpenKeyPageButton));
openProviderKeyPageButton.addEventListener('click',()=>openProviderKeyPage(openProviderKeyPageButton));
onboardingSkip.addEventListener('click',()=>{if(wizardHasInput()&&onboardingSkip.dataset.confirm!=='true'){wizardRevision++;onboardingSkip.dataset.confirm='true';onboardingSkip.textContent=t('放弃接口输入并稍后设置');setOnboardingStatus(t('接口输入尚未保存；可返回继续，或再次点击放弃。'),true);return}void(async()=>{const purposeSubmission=onboardingPurposeToken(),revision=wizardRevision;await mutateSettings((settings)=>{if(wizardRevision!==revision)throw new Error('输入或步骤已变化，请核对后继续。');return {nextSettings:{...settings,...onboardingPurposePatch(settings,purposeSubmission),onboardingCompleted:true},value:undefined}});if(wizardRevision!==revision||onboardingPurposeToken()!==purposeSubmission){setOnboardingStatus(t('已保存提交时的设置，后续输入仍保留。'));return}wizardRevision++;wizardInputDirty=false;wizardDrafts.clear();wizardTouchedProviders.clear();onboardingApiKey.value='';wizardKeyOrigin=undefined;onboardingDialog.close();await load();if(requestedFocusDeferred)await applyRequestedSettingsFocus();setStatus(t('已进入完整设置，保存后即可开始翻译。'))})().catch((error:unknown)=>setOnboardingStatus(error instanceof Error?error.message:t('无法关闭首次设置，请重新加载页面。'),true))});
onboardingDialog.addEventListener('cancel',event=>{if(!onboardingComplete&&(onboardingPurposeDirty||wizardHasInput())){event.preventDefault();setOnboardingStatus(t('输入尚未保存，可继续设置或选择稍后手动设置。'),true);return}setTimeout(()=>{if(requestedFocusDeferred)void applyRequestedSettingsFocus()},0)});
onboardingNext.addEventListener('click',()=>{void(async()=>{onboardingNext.disabled=true;if(onboardingComplete){onboardingDialog.close();if(requestedFocusDeferred)await applyRequestedSettingsFocus();return}if(onboardingStep===1){showOnboardingStep(2,true);return}const base=normalizeApiBaseUrl(onboardingBaseUrl.value);const apiKey=onboardingApiKey.value.trim();if(!apiKey)throw new Error('请填写 API Key。');assertKeyOrigin(apiKey,wizardKeyOrigin,base);if(onboardingStep===2){const revision=wizardRevision;assertWizardCurrent(revision,2);const granted=await browser.permissions.request({origins:[apiOriginPattern(base)]});assertWizardCurrent(revision,2);if(!granted)throw new Error('需要 API 域名访问权限才能继续。');setOnboardingStatus(t('正在验证 Key 并读取可用模型…'));const response=await browser.runtime.sendMessage({type:'LIST_API_MODELS',payload:{apiKey,apiBaseUrl:base}} satisfies RuntimeMessage) as ModelListResponse;assertWizardCurrent(revision,2);let message:string;let error=false;if(response.ok){setModelCatalog(response.data.models,true);const suggested=recommendedTextModel(response.data.models,onboardingModel.value);if(suggested)onboardingModel.value=suggested;message=response.data.models.length?msg`连接成功，已自动推荐文字模型 ${onboardingModel.value}；下一步只完成一次文字示例翻译。`:t('Key 验证成功，但接口未返回模型列表，请手动填写模型 ID。')}else{setModelCatalog([],true);const detail=apiSetupError(response.error.code,response.error.message,base);if(!['API_ENDPOINT_INVALID','INVALID_RESPONSE'].includes(response.error.code))throw new Error(detail);message=msg`未能读取模型列表。请核对接口地址；若服务商不提供模型列表，可手动填写模型 ID 并完成示例翻译。${detail}`;error=true}showOnboardingStep(3,true);setOnboardingStatus(message,error);return}await finishOnboarding()})().catch((error:unknown)=>{if(error instanceof StaleWizardInputError){if(onboardingDialog.open)setOnboardingStatus(t('输入或步骤已变化，请核对后继续。'),true);return}setOnboardingStatus(error instanceof Error?error.message:t('首次设置失败。'),true)}).finally(()=>{onboardingNext.disabled=false})});

apiBaseUrl.addEventListener('beforeinput',()=>{if(connectionProvider!=='custom')rememberConnectionDraft()});
apiBaseUrl.addEventListener('input',()=>{setModelCatalog([]);apiPreset.value='custom';connectionProvider='custom';refreshKeyOriginNotice(false);connectionAdvanced.open=true;connectionSummary.hidden=true;refreshProviderHint();void refreshKeyState();void refreshApiPermissionState()});generalPageMode.addEventListener('change',refreshPageModeFields);
pdfKeyboardShortcuts.addEventListener('change',refreshPdfShortcutField);
pdfRegionShortcutKey.addEventListener('input',()=>{
  const letter=pdfRegionShortcutKey.value.match(/[a-z]/i)?.[0]??'';
  pdfRegionShortcutKey.value=letter.toUpperCase();
});
apiPreset.addEventListener('change',()=>{rememberConnectionDraft();connectionProvider=apiPreset.value;const id=draftId(currentProfileId,connectionProvider),remembered=connectionDrafts.get(id),draftIsRestored=Boolean(remembered&&connectionDraftChanged(id,remembered));setModelCatalog([]);apiKeyInput.value=remembered?.key??'';connectionKeyOrigin=remembered?.keyOrigin;void refreshKeyState();connectionSummary.hidden=true;const preset=API_PRESETS.find(item=>item.id===apiPreset.value);if(!preset){apiBaseUrl.value=remembered?.base??'';modelInput.value=remembered?.model??'';refreshKeyOriginNotice(false);connectionAdvanced.open=true;refreshProviderHint();updateCurrentProfile();void refreshApiPermissionState();setStatus(t(draftIsRestored?'已恢复此服务商在本页的输入草稿。':'请填写自定义 API Base URL，然后连接并保存。'));queueMicrotask(()=>apiBaseUrl.focus());return}apiBaseUrl.value=remembered?.base??preset.apiBaseUrl;modelInput.value=remembered?.model??preset.model;refreshKeyOriginNotice(false);if(/^(?:默认接口|未命名配置)$/u.test(profileName.value.trim()))profileName.value=preset.name;connectionAdvanced.open=false;refreshProviderHint();updateCurrentProfile();void refreshApiPermissionState();setStatus(draftIsRestored?t('已恢复此服务商在本页的输入草稿。'):msg`已配置 ${preset.name} 接口；填写 Key 后点击“连接并保存”。`)});
apiPreset.addEventListener('change',renderProfileRole);
profileSelect.addEventListener('change',()=>{if(apiKeyInput.value.trim()||hasOtherConnectionKeyDrafts()){profileSelect.value=currentProfileId;setStatus(t('请先处理当前配置中未保存的接口输入，再切换配置。'),true);return}updateCurrentProfile();void loadProfile(profileSelect.value)});
profileName.addEventListener('input',()=>{const profile=currentProfile();if(profile){profile.name=profileName.value.trim()||t('未命名配置');renderProfileSelect()}});
visionApiProfile.addEventListener('change',()=>{visionProfileId=visionApiProfile.value;visionSetupIntentProfileId='';visionSelectionTouched=true;const profile=profiles.find(item=>item.id===visionProfileId);if(profile)visionModel.value=profile.model;renderProfileSelect();setDirty()});
function setVisionTestStatus(message:string,state:'idle'|'success'|'error'='idle'):void{visionTestStatus.textContent=message;visionTestStatus.classList.toggle('success',state==='success');visionTestStatus.classList.toggle('error',state==='error')}
visionApiProfile.addEventListener('change',()=>setVisionTestStatus(t('发送一张内置的 130×58 高对比字符测试图，不含文档内容。')));
visionModel.addEventListener('input',()=>{renderProfileRole();setVisionTestStatus(t('模型已更改，请重新测试视觉能力。'))});
modelInput.addEventListener('input',renderProfileRole);

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
  const nextAction=keyConfigured?t('Qwen Key 已保存，请点击“连接并保存”重新读取模型。'):t('请填写 Qwen Key，然后点击“连接并保存”。');
  setStatus(textProfile?.id===profile.id
    ? msg`Qwen 也将继续用于文字翻译。${nextAction}`
    : msg`${nextAction} 文字翻译仍使用“${textProfile?.name??t('现有配置')}”，不会被替换。`);
  queueMicrotask(()=>apiKeyInput.focus());
})().catch((error:unknown)=>setStatus(error instanceof Error?error.message:t('无法开始配置 Qwen。'),true))});

addProfileButton.addEventListener('click',()=>{if(profiles.length>=6){setStatus(t('最多保存 6 个 API 配置。'),true);return}updateCurrentProfile();const id=crypto.randomUUID();profiles.push({id,name:msg`翻译接口 ${profiles.length+1}`,apiBaseUrl:apiBaseUrl.value.trim(),model:modelInput.value.trim()});void loadProfile(id);setDirty();setStatus(t('已创建新配置，填写后请保存设置。'))});
backToTextProfileButton.addEventListener('click',()=>{
  if(apiKeyInput.value.trim()){setStatus(t('当前输入的 Key 尚未连接保存；请先点击“连接并保存”，再返回文字 API。'),true);apiKeyInput.focus();return}
  const textProfile=activeTextProfile();
  if(!textProfile){setStatus(t('当前没有可返回的文字翻译 API。'),true);return}
  updateCurrentProfile();
  void loadProfile(textProfile.id).then(()=>setStatus(visionProfileId?msg`已返回文字 API“${textProfile.name}”；图像翻译配置仍保留。`:msg`已返回文字 API“${textProfile.name}”。`));
});
useTextProfileButton.addEventListener('click',()=>{updateCurrentProfile();activeTextProfileId=currentProfileId;renderProfileSelect();setDirty();setStatus(msg`保存后将使用“${currentProfile()?.name??t('当前配置')}”进行文字翻译。`)});
deleteProfileButton.addEventListener('click',()=>{if(profiles.length<=1)return;const deletedId=currentProfileId;profiles=profiles.filter(profile=>profile.id!==currentProfileId);if(visionProfileId===deletedId)visionProfileId='';if(visionSetupIntentProfileId===deletedId)visionSetupIntentProfileId='';if(activeTextProfileId===deletedId)activeTextProfileId=profiles[0]!.id;void loadProfile(profiles[0]!.id);setDirty();setStatus(t('配置已从草稿中删除，点击“保存设置”后生效。'))});

form.addEventListener('submit',event=>{event.preventDefault();const mode=generalPageMode.value as GeneralPageMode;const allowlist=normalizeSiteAllowlist(siteAllowlist.value.split(/\r?\n|,/));let purposeDraft:ReturnType<typeof purposePreferences.read>;try{purposeDraft=purposePreferences.read()}catch(error){showSettingsSection('translation');purposePreferences.open();setStatus(error instanceof Error?error.message:t('用途偏好格式无效，原设置未改变。'),true);return}const purposeSubmission=purposePreferences.pending()?purposePreferences.token():undefined;let glossary:ReturnType<typeof glossaryProfiles.read>&ReturnType<typeof purposePreferences.read>;try{glossary={...glossaryProfiles.read(),...purposeDraft}}catch(error){showSettingsSection('translation');const details=academicGlossary.closest('details');if(details)details.open=true;academicGlossary.focus();setStatus(error instanceof Error?error.message:t('术语表格式不正确。'),true);return}try{profiles=validatedProfiles();renderProfileSelect()}catch(error){showSettingsSection('connection');setStatus(error instanceof Error?error.message:t('API 配置不正确。'),true);return}if(mode==='allowlist'&&!allowlist.length){showSettingsSection('pages');siteAllowlist.focus();setStatus(t('请至少填写一个有效的网站域名。'),true);return}
  if(pdfKeyboardShortcuts.checked&&!/^[a-z]$/i.test(pdfRegionShortcutKey.value.trim())){showSettingsSection('results');const details=pdfRegionShortcutKey.closest('details');if(details)details.open=true;pdfRegionShortcutKey.focus();setStatus(t('Pi PDF 框选键需要是一个英文字母。'),true);return}
  saveButton.disabled=true;
  saveButton.textContent=t('正在保存…');
  void(async()=>{
    const editing=currentProfile()!;
    const active=activeTextProfile()??editing;
    const pendingKey=apiKeyInput.value.trim();
    const pendingKeyId=draftId(currentProfileId,connectionProvider);
    const connectionSubmission=connectionSnapshot();
    const previousDraft=loadedSettingsBaseline;
    const purposeOnlyConnection=purposePreferences.pending()&&previousDraft&&!pendingKey&&JSON.stringify(profiles.map(({id,apiBaseUrl,model})=>({id,apiBaseUrl:normalizeApiBaseUrl(apiBaseUrl),model:model.trim()})))===JSON.stringify(previousDraft.apiProfiles.map(({id,apiBaseUrl,model})=>({id,apiBaseUrl:normalizeApiBaseUrl(apiBaseUrl),model:model.trim()})))&&active.id===previousDraft.activeApiProfileId&&visionProfileId===previousDraft.visionApiProfileId&&visionModel.value===previousDraft.visionModel&&persistKey.checked===(previousDraft.apiKeyStorage==='local')&&mode===previousDraft.generalPageMode&&JSON.stringify(allowlist)===JSON.stringify(previousDraft.siteAllowlist);
    assertConnectionCurrent(connectionSubmission);
    if(!purposeOnlyConnection)await requestSaveAccess(profiles,active.id,visionProfileId,mode,allowlist,pendingKey?[editing.id]:[]);
    assertConnectionCurrent(connectionSubmission);
    const autoVision=purposeOnlyConnection?{attempted:false,configured:Boolean(visionProfileId)}:await autoConfigureVisionProfile(editing);
    assertConnectionCurrent(connectionSubmission);
    const keyMode:ApiKeyStorageMode=persistKey.checked?'local':'session';
    const baseline=loadedSettingsBaseline??await getSettings();
    const visionProfile=profiles.find(profile=>profile.id===visionProfileId);
    const draft:ExtensionSettings={
      ...baseline,
      schemaVersion:8,
      apiProfiles:profiles.map(profile=>({...profile})),
      modelPrices:normalizeModelPrices(modelPrices),
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
      ...glossary,
      rememberRecentTranslations:rememberHistory.checked,
      historyLimit:Number(historyLimit.value) as HistoryLimit,
      enableSessionCache:sessionCache.checked,
      sentenceAlignmentDefault:alignmentDefault.checked,
      autoRenderLatex:autoRenderLatex.checked,
      sidebarMode:sidebarMode.value==='browser'?'browser':'floating',
      sidebarSide:sidebarSide.value as SidebarSide,
      contextMode:contextMode.value as ContextMode,
      ...(element<HTMLSelectElement>('paragraph-shortcut').value!=='off'||baseline.paragraphShortcut?{paragraphShortcut:element<HTMLSelectElement>('paragraph-shortcut').value as 'off'|'alt'|'shift'}:{}),
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
      assertConnectionCurrent(connectionSubmission);
      purposePreferences.assertCurrent(latest,purposeSubmission);
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
    let connectionChangedAfterCommit=!connectionMatches(connectionSubmission);
    if(pendingKey)clearSavedConnectionKey(pendingKeyId,pendingKey);
    if(currentProfileId===connectionSubmission.profile&&connectionProvider===connectionSubmission.provider&&apiBaseUrl.value===connectionSubmission.base&&modelInput.value===connectionSubmission.model&&(!apiKeyInput.value||apiKeyInput.value===connectionSubmission.key))protectedConnectionDrafts.delete(pendingKeyId);
    const postCommitSnapshot=connectionSnapshot();
    if(!purposeOnlyConnection)await removeUnusedApiAccess(current.apiProfiles,next.apiProfiles,next.activeApiProfileId,next.visionApiProfileId,next.generalPageMode,next.siteAllowlist);
    connectionChangedAfterCommit ||= !connectionMatches(postCommitSnapshot);
    if(!connectionChangedAfterCommit)activeTextProfileId=active.id;
    originalMode=keyMode;
    // Keep the baseline aligned with what the form still shows. Unseen
    // concurrent changes remain outside it and will be preserved next time.
    loadedSettingsBaseline=draft;
    purposePreferences.rebase(draft);
    if(!connectionChangedAfterCommit)visionSelectionTouched=false;
    renderProfileSelect();
    await refreshKeyState();
    connectionChangedAfterCommit ||= !connectionMatches(postCommitSnapshot);
    if(connectionChangedAfterCommit){if(purposeSubmission===undefined||purposePreferences.token()===purposeSubmission)purposePreferences.saved();nonConnectionDirty=true;setDirty();setStatus(t('已保存提交时的设置，后续接口输入仍在草稿中。'));return}
    if(hasOtherConnectionKeyDrafts()||apiKeyInput.value.trim()){if(purposeSubmission===undefined||purposePreferences.token()===purposeSubmission)purposePreferences.saved();nonConnectionDirty=purposePreferences.pending();setDirty();setStatus(t('已保存当前设置，其他接口输入仍在本页草稿中。'));return}
    if(purposeSubmission!==undefined&&purposePreferences.token()!==purposeSubmission){nonConnectionDirty=true;setDirty();setStatus(t('已保存确认时的用途偏好，后续更改仍在草稿中。'));return}
    setSaved();
    const roleMessage=active.id!==editing.id&&visionProfileId===editing.id
      ?msg`设置已保存：文字继续使用“${active.name}”，图像翻译使用“${editing.name}”。`
      :autoVision.configured&&autoVision.attempted
        ?t('设置已保存，并已自动启用图像区域翻译。')
        :autoVision.attempted
          ?t('设置已保存；当前模型未通过图片输入检测，文字翻译不受影响。')
          :t('设置已保存，并已同步到打开的页面。');
    setStatus(roleMessage);
  })().catch((error:unknown)=>{if(error instanceof PurposeRecommendationStaleError){showSettingsSection('translation');purposePreferences.showRecommendationConflict()}setStatus(error instanceof PurposeRecommendationStaleError?t(error.message):error instanceof Error?error.message:t('保存设置失败。'),true)}).finally(()=>{
    if(!formDirty)return;
    saveButton.disabled=false;
    saveButton.textContent=t('保存更改');
  });
});

async function persistConnectedApiConfiguration(message:string,submission=connectionSnapshot()):Promise<{revision:string;current:boolean}>{
  assertConnectionCurrent(submission);
  profiles=validatedProfiles();
  const editing=currentProfile();
  const active=activeTextProfile()??editing;
  if(!editing||!active)throw new Error('当前 API 配置不存在，请重新加载设置页。');
  const keyMode:ApiKeyStorageMode=persistKey.checked?'local':'session';
  const pendingKey=apiKeyInput.value.trim();
  const pendingKeyId=draftId(currentProfileId,connectionProvider);
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
    assertConnectionCurrent(submission);
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
  let connectionChangedAfterCommit=!connectionMatches(submission);
  if(pendingKey)clearSavedConnectionKey(pendingKeyId,pendingKey);
  if(currentProfileId===submission.profile&&connectionProvider===submission.provider&&apiBaseUrl.value===submission.base&&modelInput.value===submission.model&&(!apiKeyInput.value||apiKeyInput.value===submission.key))protectedConnectionDrafts.delete(pendingKeyId);
  const postCommitSnapshot=connectionSnapshot();
  if(!transaction.revisionId)throw new Error('API 配置未能提交。');
  const configurationRevision=transaction.revisionId;
  await removeUnusedApiAccess(current.apiProfiles,next.apiProfiles,next.activeApiProfileId,next.visionApiProfileId,next.generalPageMode,next.siteAllowlist);
  connectionChangedAfterCommit ||= !connectionMatches(postCommitSnapshot);
  if(!connectionChangedAfterCommit)activeTextProfileId=active.id;
  originalMode=keyMode;
  loadedSettingsBaseline=draft;
  purposePreferences.rebase(draft);
  if(!connectionChangedAfterCommit)visionSelectionTouched=false;
  renderProfileSelect();
  await refreshKeyState();
  connectionChangedAfterCommit ||= !connectionMatches(postCommitSnapshot);
  if(connectionChangedAfterCommit){nonConnectionDirty=true;setDirty();setStatus(t('已保存提交时的设置，后续接口输入仍在草稿中。'));return {revision:configurationRevision,current:false}}
  setApiConnectionSaved();
  setStatus(hasOtherConnectionKeyDrafts()?t('已保存当前设置，其他接口输入仍在本页草稿中。'):message);
  return {revision:configurationRevision,current:true};
}

async function callModels():Promise<void>{
  let submission=connectionSnapshot();
  const apiKey=apiKeyInput.value.trim();
  if(!apiKey&&!await hasApiKey(currentProfileId))throw new Error('请先填写 API Key，再连接并保存。');
  assertConnectionCurrent(submission);
  const base=currentApiBaseUrl();
  await requestApiAccess(base);
  assertConnectionCurrent(submission);
  refreshModelsButton.disabled=true;
  connectionSummary.hidden=true;
  setModelCatalog([]);
  setStatus(t('正在读取可用模型…'));
  const response=await browser.runtime.sendMessage({type:'LIST_API_MODELS',payload:{apiBaseUrl:base,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ModelListResponse;
  assertConnectionCurrent(submission);
  if(!response.ok){
    const manual=['API_ENDPOINT_INVALID','INVALID_RESPONSE'].includes(response.error.code);
    if(manual){connectionAdvanced.open=true;modelInput.focus()}
    setStatus(apiSetupError(response.error.code,response.error.message,base)+(manual?t(' 若服务商不提供模型列表，请手动填写模型 ID，再点击“验证并保存当前模型”。'):''),true);return;
  }
  setModelCatalog(response.data.models);
  const suggested=recommendedTextModel(response.data.models,modelInput.value.trim())??modelInput.value.trim();
  if(!suggested){setStatus(t('接口没有返回模型列表，请手动填写模型 ID 后使用“验证并保存当前模型”。'),true);return}
  if(suggested!==modelInput.value.trim()){modelInput.value=suggested;updateCurrentProfile();setDirty();submission=connectionSnapshot()}
  const active={...(currentProfile()??{id:currentProfileId,name:t('当前接口'),apiBaseUrl:base,model:suggested}),apiBaseUrl:base,model:suggested};
  setStatus(msg`已读取 ${response.data.models.length} 个模型，正在验证文字模型 ${suggested}…`);
  const diagnostic=await browser.runtime.sendMessage({type:'DIAGNOSE_API',payload:{apiBaseUrl:base,model:suggested,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ApiDiagnosticResponse;
  assertConnectionCurrent(submission);
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
    setStatus(msg`文字模型 ${suggested} 可用，正在检测 PDF 图片输入能力…`);
    vision=await detectVisionModel(active,response.data.models,suggested,apiKey,visionModel.value);
    assertConnectionCurrent(submission);
    if(vision.model){visionProfileId=active.id;visionSetupIntentProfileId='';visionModel.value=vision.model;renderVisionProfileSelect();setVisionTestStatus(msg`已自动启用图像区域翻译 · ${vision.model}${vision.latencyMs?` · ${vision.latencyMs} ms`:''}`,'success')}
    else setVisionTestStatus(t('当前接口未检测到可用的图片模型；文字翻译不受影响。'));
  }
  renderConnectionSummary(diagnostic.data,suggested,vision);
  void refreshVisionSetupStatus();
  setDirty();
  const separateText=vision.model&&activeTextProfileId!==active.id?activeTextProfile():undefined;
  const configuredVision=profiles.find(profile=>profile.id===visionProfileId);
  const savedMessage=vision.preserved
    ? configuredVision
      ? msg`自动配置完成并已保存：保留现有图像翻译配置“${configuredVision.name}”。`
      : msg`文字模型 ${suggested} 已连接并保存；本次只修复文字翻译，图像翻译能力可稍后按需配置。`
    : separateText
      ? msg`自动配置完成并已保存：图像翻译使用“${active.name}”，文字继续使用“${separateText.name}”。`
      : vision.model
        ? msg`自动配置完成并已保存：文字使用 ${suggested}，图像翻译使用 ${vision.model}。`
        : msg`文字模型 ${suggested} 已连接并保存；普通文字翻译可用。需要扫描件功能时再配置 Qwen。`;
  const configuration=await persistConnectedApiConfiguration(savedMessage,submission);
  if(configuration.current)await completeSettingsRecovery({text:true,vision:Boolean(vision.model)&&!vision.preserved},configuration.revision);
}
refreshModelsButton.addEventListener('click',()=>void callModels().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{refreshModelsButton.disabled=false}));

testButton.addEventListener('click',()=>{
  const model=modelInput.value.trim();
  if(!model){setStatus(t('请先填写模型名称。'),true);return}
  void(async()=>{
    const submission=connectionSnapshot();
    assertConnectionCurrent(submission);
    const base=currentApiBaseUrl();
    await requestApiAccess(base);
    assertConnectionCurrent(submission);
    testButton.disabled=true;
    setStatus(t('正在测试 API、Key 与模型…'));
    const apiKey=apiKeyInput.value.trim();
    const response=await browser.runtime.sendMessage({type:'TEST_API_CONNECTION',payload:{apiBaseUrl:base,model,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ConnectionTestResponse;
    assertConnectionCurrent(submission);
    if(!response.ok){setStatus(apiSetupError(response.error.code,response.error.message,base),true);return}
    const configuration=await persistConnectedApiConfiguration(msg`连接成功并已保存；示例翻译：${response.data.sampleTranslation}`,submission);
    if(configuration.current)await completeSettingsRecovery({text:true,vision:false},configuration.revision);
  })().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{testButton.disabled=false});
});

testVisionCapabilityButton.addEventListener('click',()=>{void(async()=>{
  updateCurrentProfile();
  const profile=profiles.find(item=>item.id===visionProfileId);
  const model=visionModel.value.trim();
  if(!profile){setVisionTestStatus(t('请先选择视觉 API 配置。'),'error');return}
  if(!model){setVisionTestStatus(t('请先填写支持图片输入的视觉模型。'),'error');return}
  const submission=connectionSnapshot();
  if(profile.id===currentProfileId)assertConnectionCurrent(submission);
  await requestApiAccess(profile.apiBaseUrl);
  if(profile.id===currentProfileId)assertConnectionCurrent(submission);
  testVisionCapabilityButton.disabled=true;
  setVisionTestStatus(t('正在验证图片输入、API Key 与模型…'));
  const pendingKey=profile.id===currentProfileId?apiKeyInput.value.trim():'';
  const response=await requestVisionCapabilityTest(profile,model,pendingKey);
  if(profile.id===currentProfileId)assertConnectionCurrent(submission);
  if(!response.ok){setVisionTestStatus(translationErrorMessage(response.error.code,response.error.message),'error');return}
  setVisionTestStatus(msg`视觉能力可用 · ${response.data.latencyMs} ms`,'success');
  if(activeSettingsRecovery?.role==='vision'){
    visionProfileId=profile.id;
    visionModel.value=model;
    visionSelectionTouched=true;
    renderVisionProfileSelect();
    const configuration=await persistConnectedApiConfiguration(t('视觉能力验证成功，当前图像翻译配置已保存。'));
    if(configuration.current)await completeSettingsRecovery({text:false,vision:true},configuration.revision);
  }
})().catch((error:unknown)=>setVisionTestStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),'error')).finally(()=>{testVisionCapabilityButton.disabled=false})});

function diagnosticItem(label:string,value:string):HTMLElement{const item=document.createElement('div');item.className='diagnostic-item';item.textContent=label;const strong=document.createElement('strong');strong.textContent=value;item.append(strong);return item}
function renderDiagnostic(report:ApiDiagnosticReport):void{diagnosticReport.replaceChildren();const heading=document.createElement('h3');heading.textContent=msg`兼容性诊断 · ${report.origin}`;const grid=document.createElement('div');grid.className='diagnostic-grid';grid.append(diagnosticItem(t('域名权限'),report.permissionGranted?t('通过'):t('未授权')),diagnosticItem(t('鉴权与模型'),report.authenticated&&report.configuredModelAvailable?t('通过'):t('需检查')),diagnosticItem(t('模型数量'),String(report.modelCount)),diagnosticItem(t('对话接口'),report.chatCompletion?t('通过'):t('失败')),diagnosticItem(t('结构化输出'),report.structuredOutput?t('支持'):t('自动降级')),diagnosticItem(t('逐句对照'),report.sentenceAlignment?t('支持'):t('自动降级')),diagnosticItem(t('诊断耗时'),report.latencyMs?`${report.latencyMs} ms`:'—'));diagnosticReport.append(heading,grid);if(report.notes.length){const notes=document.createElement('ul');notes.className='diagnostic-notes';for(const message of report.notes){const item=document.createElement('li');item.textContent=message;notes.append(item)}diagnosticReport.append(notes)}diagnosticReport.hidden=false}
diagnoseButton.addEventListener('click',()=>{const model=modelInput.value.trim();if(!model){setStatus(t('请先填写模型名称。'),true);return}void(async()=>{const submission=connectionSnapshot();assertConnectionCurrent(submission);const base=currentApiBaseUrl();await requestApiAccess(base);assertConnectionCurrent(submission);diagnoseButton.disabled=true;diagnosticReport.hidden=true;setStatus(t('正在执行一次低消耗兼容性诊断…'));const apiKey=apiKeyInput.value.trim();const response=await browser.runtime.sendMessage({type:'DIAGNOSE_API',payload:{apiBaseUrl:base,model,profileId:currentProfileId,...(apiKey?{apiKey}:{})}} satisfies RuntimeMessage) as ApiDiagnosticResponse;assertConnectionCurrent(submission);if(!response.ok){setStatus(translationErrorMessage(response.error.code,response.error.message),true);return}renderDiagnostic(response.data);setStatus(t('诊断完成。逐句或结构化输出不支持时，扩展会自动降级为完整译文。'))})().catch((error:unknown)=>setStatus(error instanceof Error?error.message:runtimeConnectionErrorMessage(error),true)).finally(()=>{diagnoseButton.disabled=false})});

clearButton.addEventListener('click',()=>void clearApiKey(currentProfileId).then(async()=>{apiKeyInput.value='';await refreshKeyState();setStatus(t('当前 API 配置的 Key 已清除。'))}).catch(()=>setStatus(t('清除 API Key 失败。'),true)));
shortcutsButton.addEventListener('click',()=>void browser.tabs.create({url:'edge://extensions/shortcuts'}));
window.addEventListener('focus',()=>void refreshTranslationShortcut());
restartOnboardingButton.addEventListener('click',()=>{if(purposePreferences.hasUnconfirmed()){showSettingsSection('translation');purposePreferences.open();setStatus(t('请先确认或还原用途选择，再重新开始设置。'),true);return}if(formDirty){setStatus(t('请先保存或撤销当前更改，再重新开始设置。'),true);return}const current=currentProfile();const matching=API_PRESETS.find(preset=>preset.apiBaseUrl===current?.apiBaseUrl);onboardingPreset.value=matching?.id??'custom';beginWizardProvider();if(current){onboardingBaseUrl.value=current.apiBaseUrl;onboardingModel.value=current.model}onboardingApiKey.value='';initOnboardingPurpose();showOnboardingStep(1);onboardingDialog.showModal()});
exportSettingsButton.addEventListener('click',()=>{void(async()=>{const settings=await getSettings();const sites=await getSiteReadingPreferences();const storedLanguage=(await browser.storage.local.get('uiLanguagePreference')).uiLanguagePreference;const uiLanguage=storedLanguage==='en'||storedLanguage==='zh-CN'?storedLanguage:'auto';const content=exportSettingsConfiguration(settings,{sites,uiLanguage});const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`pi-translator-settings-${new Date().toISOString().slice(0,10)}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setSupportStatus(t('配置已导出，含已记住的网站偏好和界面语言，不含 API Key。'))})().catch(()=>setSupportStatus(t('导出配置失败。'),true))});
function canImportSettings():boolean{
  if(purposePreferences.hasUnconfirmed()){setSupportStatus(t('请先确认或还原用途选择，再导入配置。'),true);return false}
  if(formDirty){setSupportStatus(t('请先保存或撤销当前设置草稿，再导入配置。'),true);return false}
  return true;
}
importSettingsButton.addEventListener('click',()=>{if(canImportSettings())importSettingsFile.click()});
importSettingsFile.addEventListener('change',()=>{const file=importSettingsFile.files?.[0];if(!file)return;if(!canImportSettings()){importSettingsFile.value='';return}importSettingsButton.disabled=true;const wasInert=form.inert;form.inert=true;form.setAttribute('aria-busy','true');setSupportStatus(t('正在导入配置…'));void(async()=>{
  if(file.size>1_000_000)throw new Error('配置文件超过 1 MB。');
  const serialized=await file.text();
  // Validate the whole envelope before the existing API/key mutation runs.
  importSettingsConfiguration(serialized,await getSettings());
  const preferences=importConfigurationReadingPreferences(serialized);
  await mutateApiConfiguration((latest)=>({nextSettings:importSettingsConfiguration(serialized,latest),credentials:{clearAllApiKeys:true},value:undefined}));
  if(preferences){
    try{await mergeSiteReadingPreferences(preferences.sites);await saveUiLanguagePreference(preferences.uiLanguage);uiLanguageSelect.value=preferences.uiLanguage}
    catch{await load();setSupportStatus(t('API 配置已导入且 Key 已清除，但阅读偏好未全部保存；请重新导入配置。'),true);return}
  }
  await load();setSupportStatus(t('配置已导入。出于安全考虑，所有 API Key 已清除；请重新填写 Key 并保存以授权接口域名。')+(preferences?t(' 网站偏好已合并，同一网站保留本机选择；界面语言重新打开页面后生效。'):''));
})().catch((error:unknown)=>setSupportStatus(error instanceof Error?localizeErrorMessage(error.message):t('导入配置失败。'),true)).finally(()=>{form.inert=wasInert;form.removeAttribute('aria-busy');importSettingsFile.value='';importSettingsButton.disabled=false})});
copyDiagnosticReportButton.addEventListener('click',()=>{void(async()=>{const response=await browser.runtime.sendMessage({type:'GET_LOCAL_DIAGNOSTIC_REPORT'} satisfies RuntimeMessage) as LocalDiagnosticReportResponse;if(!response.ok)throw new Error(response.error.message);await navigator.clipboard.writeText(response.data.report);setSupportStatus(t('诊断报告已复制；仅含错误类型与分阶段耗时，不包含 Key、API 地址、模型或用户内容。'))})().catch(()=>setSupportStatus(t('复制诊断报告失败，请检查剪贴板权限。'),true))});
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
  if(focus==='glossary'){
    showSettingsSection('translation');const disclosure=academicGlossary.closest<HTMLDetailsElement>('details');if(disclosure)disclosure.open=true;academicGlossary.scrollIntoView({block:'center'});queueMicrotask(()=>academicGlossary.focus());return;
  }
  if(focus==='storage'){
    showSettingsSection('storage');
    await refreshRetainedStorageSummary();
    retainedStorageTitle.scrollIntoView({block:'start'});
    queueMicrotask(()=>retainedLibrarySearch.focus());
    return;
  }
  if(focus==='pages'){
    showSettingsSection('pages');queueMicrotask(()=>{generalPageMode.scrollIntoView({block:'center'});generalPageMode.focus()});return;
  }
  if(focus==='api'||focus==='api-model'||focus==='api-permission'){
    const target=focus==='api-model'
      ? modelInput
      : focus==='api-permission'
        ? testButton
        : apiKeyInput;
    showSettingsSection('connection');
    if(focus==='api-permission')connectionAdvanced.open=true;
    queueMicrotask(()=>{target.scrollIntoView({block:'center'});target.focus()});
  }
}
void load()
  .then(async()=>{
    if(requestedSection==='cost'&&!onboardingDialog.open){const cost=element<HTMLDetailsElement>('settings-cost');cost.scrollIntoView({block:'start'});cost.querySelector<HTMLElement>('summary')?.focus({preventScroll:true})}
    await claimRequestedSettingsRecovery();
    await applyRequestedSettingsFocus();
  })
  .catch(()=>setStatus(t('读取设置失败，请重新加载页面。'),true));

}

void startUi();
