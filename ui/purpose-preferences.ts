import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import {layoutTaskDialog} from './task-dialog';
import {DEFAULT_SETTINGS,type ExtensionSettings} from '../core/settings/schema';
import {PURPOSE_IDS,PURPOSE_SETTING_KEYS,normalizePurposePreferences,proposePurposeSettings,recommendPurposeGlossary,assertPurposeChangesCurrent,type PurposeId,type PurposePreferences,type PurposeSettings,type PurposeSettingKey} from '../core/settings/purpose-preferences';

const purposeLabels={daily:'日常页面翻译',research:'科研阅读',learning:'外语学习'};
const settingLabels:Record<PurposeSettingKey,string>={style:'翻译风格',contentMode:'内容模式',contextMode:'上下文',sentenceAlignmentDefault:'默认逐句对照',autoRenderLatex:'自动渲染 LaTeX',activeGlossaryProfileId:'默认术语方案'};
const labels:Record<string,string>={academic:'学术',general:'通用',literal:'直译',auto:'自动判断',plain:'纯文本',latex:'LaTeX',off:'不使用上下文',sentence:'句子',paragraph:'段落',true:'已启用',false:'未启用'};
export class PurposeRecommendationStaleError extends Error { constructor(){super('推荐的术语方案已变化，请在本页核对。');this.name='PurposeRecommendationStaleError'} }

export function bindPurposePreferences(options:{
  host:HTMLElement;
  values:()=>PurposeSettings;
  schemes:()=>Array<{id:string;name:string}>;
  latest:()=>Promise<ExtensionSettings>;
  syncScheme:(latest:ExtensionSettings,ids:string[])=>void;
  manage:()=>void;
  apply:(patch:Partial<PurposeSettings>)=>void;
  dirty:()=>void;
}){
  const details=document.createElement('details');details.id='purpose-preferences';details.className='disclosure-panel';
  const summary=document.createElement('summary'),summaryText=document.createElement('span'),heading=document.createElement('strong'),summaryState=document.createElement('small');heading.textContent=t('用途与研究领域（可选）');summaryState.id='purpose-summary';summaryText.append(heading,summaryState);summary.append(summaryText);
  const body=document.createElement('div');body.className='disclosure-content';
  const hint=document.createElement('p');hint.className='field-help';hint.textContent=t('用途可多选；选择会加入设置草稿。其他设置建议需预览后确认。');
  const purposes=document.createElement('div');purposes.className='purpose-choices';const checks=new Map<PurposeId,HTMLInputElement>();
  for(const id of PURPOSE_IDS){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=id;check.name='purpose';label.append(check,t(purposeLabels[id]));purposes.append(label);checks.set(id,check)}
  const summaryPurposeHint=document.createElement('p');summaryPurposeHint.id='purpose-summary-hint';summaryPurposeHint.className='field-help';summaryPurposeHint.textContent=t('同时选择科研和外语学习时，笔记小结默认按科研整理，可在小结中修改。');summaryPurposeHint.hidden=true;
  const research=document.createElement('div');research.className='purpose-research';research.hidden=true;
  const fieldLabel=document.createElement('label'),fieldCaption=document.createElement('span'),field=document.createElement('input');fieldCaption.textContent=t('研究领域（可选）');field.id='purpose-research-field';field.type='text';field.maxLength=80;field.autocomplete='off';fieldLabel.append(fieldCaption,field);
  const useFieldLabel=document.createElement('label'),useField=document.createElement('input'),useFieldText=document.createElement('span');useFieldLabel.className='check-row compact-check';useField.type='checkbox';useField.id='purpose-field-translation';useFieldText.textContent=t('后续翻译参考此领域');useFieldLabel.append(useField,useFieldText);
  const schemeLabel=document.createElement('label'),schemeCaption=document.createElement('span'),scheme=document.createElement('select');schemeCaption.textContent=t('建议使用的术语方案（可选）');scheme.id='purpose-glossary';schemeLabel.append(schemeCaption,scheme);
  const suggestion=document.createElement('div');suggestion.id='purpose-glossary-suggestion';suggestion.className='purpose-glossary-suggestion';suggestion.hidden=true;
  const noMatch=document.createElement('div');noMatch.id='purpose-glossary-no-match';noMatch.className='purpose-glossary-suggestion';noMatch.hidden=true;const noMatchText=document.createElement('p');noMatchText.textContent=t('暂无唯一名称匹配的方案，可手动选择或管理术语方案。');const manage=document.createElement('button');manage.type='button';manage.textContent=t('管理术语方案');manage.addEventListener('click',options.manage);noMatch.append(noMatchText,manage);
  const recovery=document.createElement('div');recovery.id='purpose-glossary-recovery';recovery.className='purpose-glossary-suggestion';recovery.hidden=true;
  const privacy=document.createElement('p');privacy.className='field-help';privacy.textContent=t('启用后，领域名称会随翻译请求发送给所配置的 API，辅助理解和选择术语；本文确认术语优先，旧译文不变。');research.append(fieldLabel,useFieldLabel,privacy,suggestion,noMatch,schemeLabel);
  const actions=document.createElement('div');actions.className='support-task-actions';const preview=document.createElement('button'),reset=document.createElement('button');preview.type=reset.type='button';preview.id='purpose-preview';reset.id='purpose-reset';reset.className='text-button';preview.textContent=t('预览建议…');reset.textContent=t('取消术语方案选择');actions.append(preview,reset);
  const status=document.createElement('p');status.id='purpose-status';status.role='status';status.hidden=true;
  body.append(hint,purposes,summaryPurposeHint,research,recovery,actions,status);details.append(summary,body);options.host.append(details);
  let baseline:ExtensionSettings,confirmed:PurposePreferences|undefined,pending=false,fresh=false,generation=0,applying=false;
  const touched=new Set<PurposeSettingKey>();let receipts:Partial<Record<PurposeSettingKey,{expected:unknown;applied:unknown}>>={};
  let recommendationReceipt:({id:string;name:string;field:string;previousId:string})|undefined;
  const ignoredSuggestions=new Set<string>();
  let renderedSuggestionKey='';
  let blurredField='';
  let pointerDown=false,pendingFieldBlur=false;
  document.addEventListener('pointerdown',()=>{pointerDown=true},true);
  const finishPointer=()=>{pointerDown=false;if(pendingFieldBlur){pendingFieldBlur=false;setTimeout(()=>{blurredField=field.value;updateSuggestion()},0)}};
  document.addEventListener('pointerup',finishPointer,true);document.addEventListener('pointercancel',finishPointer,true);
  const notice=(value:string)=>{status.textContent=value;status.hidden=!value};
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const input=():PurposePreferences=>normalizePurposePreferences({purposes:PURPOSE_IDS.filter(id=>checks.get(id)!.checked),researchField:field.value,...(useField.checked?{useFieldInTranslation:true}:{})})!;
  const hasUnconfirmed=()=>{try{input();return Boolean(scheme.value)}catch{return true}};
  function updateSchemes(){
    const old=scheme.value;scheme.replaceChildren();const keep=document.createElement('option');keep.value='';keep.textContent=t('保持当前方案');scheme.append(keep);
    const schemes=options.schemes();for(const item of schemes){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;option.title=item.name;scheme.append(option)}
    if(old&&!schemes.some(p=>p.id===old)){const missing=document.createElement('option');missing.value=old;missing.textContent=t('已删除的方案');scheme.append(missing)}scheme.value=old;schemeLabel.hidden=!schemes.length&&!old;
  }
  function updateSuggestion(){
    const match=checks.get('research')!.checked&&!scheme.value?recommendPurposeGlossary(field.value,options.schemes()):undefined;
    noMatch.hidden=!checks.get('research')!.checked||Boolean(scheme.value)||!field.value.trim()||blurredField!==field.value||Boolean(match);
    const key=match?JSON.stringify([field.value.trim(),match.id,match.name]):'';
    suggestion.hidden=!match||match.id===options.values().activeGlossaryProfileId||ignoredSuggestions.has(key);
    if(!match||suggestion.hidden){renderedSuggestionKey='';suggestion.replaceChildren();return}
    if(key===renderedSuggestionKey)return;
    renderedSuggestionKey=key;suggestion.replaceChildren();
    const explanation=document.createElement('p');explanation.textContent=msg`方案“${match.name}”与研究领域名称一致。`;
    const choose=document.createElement('button'),dismiss=document.createElement('button');choose.type=dismiss.type='button';choose.textContent=t('选择此方案');dismiss.textContent=t('本次忽略');
    choose.addEventListener('click',()=>{
      const current=recommendPurposeGlossary(field.value,options.schemes());
      if(!checks.get('research')!.checked||scheme.value||!current||current.id!==match.id||current.name!==match.name||current.id===options.values().activeGlossaryProfileId){updateSchemes();updateSuggestion();return}
      openRecommendedPreview(current,field.value.trim());
    });
    dismiss.addEventListener('click',()=>{ignoredSuggestions.add(key);if(ignoredSuggestions.size>24)ignoredSuggestions.delete(ignoredSuggestions.values().next().value!);updateSuggestion();field.focus({preventScroll:true})});
    suggestion.append(explanation,choose,dismiss);
  }
  function updateSummary(){
    const preference=input(),unconfirmed=hasUnconfirmed();
    const names=preference.purposes.map(id=>t(purposeLabels[id])).join(' · ');
    const fieldState=preference.purposes.includes('research')&&preference.researchField?(preference.useFieldInTranslation?msg`领域：${preference.researchField} · 用于后续翻译`:msg`领域：${preference.researchField} · 仅在本机使用`):'';
    summaryState.textContent=unconfirmed?t('选择尚未确认'):pending?t('草稿待保存'):[names,fieldState].filter(Boolean).join(' · ')||t('可设置用途，并让翻译参考研究领域');
    reset.hidden=!scheme.value;
  }
  function update(){research.hidden=!checks.get('research')!.checked;summaryPurposeHint.hidden=!checks.get('research')!.checked||!checks.get('learning')!.checked;updateSchemes();updateSuggestion();updateSummary()}
  function openRecommendedPreview(match:{id:string;name:string},researchField:string,previousId?:string){
    try{
      const preference=input(),current=options.values(),revision=generation,snapshot=JSON.stringify(current),schemeSnapshot=JSON.stringify(options.schemes());
      const local=options.schemes().find(item=>item.id===match.id&&item.name===match.name);
      if(!preference.purposes.includes('research')||!local||researchField!==preference.researchField)return;
      const dialog=document.createElement('dialog');dialog.className='citation-export-dialog purpose-preview-dialog';dialog.ariaLabel=t('术语方案建议');
      const title=document.createElement('h2');title.textContent=t('术语方案建议');
      const explanation=document.createElement('p');explanation.textContent=msg`研究领域与方案“${match.name}”名称一致。`;
      const scope=document.createElement('p');scope.className='field-help';scope.textContent=t('保存后，跟随默认的文档在后续翻译中使用此方案；本文固定方案、已确认术语和旧译文不变。');
      const feedback=document.createElement('p');feedback.role='status';const buttons=document.createElement('div');buttons.className='support-task-actions';
      const cancel=document.createElement('button'),confirm=document.createElement('button');cancel.type=confirm.type='button';cancel.textContent=t('取消');confirm.textContent=t('加入设置草稿');confirm.className='primary';buttons.append(cancel,confirm);layoutTaskDialog(dialog,title,[explanation,scope],buttons,feedback);document.body.append(dialog);
      cancel.addEventListener('click',()=>dialog.close());confirm.addEventListener('click',()=>{
        const live=options.schemes().find(item=>item.id===match.id&&item.name===match.name);
        if(revision!==generation||snapshot!==JSON.stringify(options.values())||schemeSnapshot!==JSON.stringify(options.schemes())||!live){feedback.textContent=t('设置草稿已变化，请重新预览。');confirm.disabled=true;return}
        const prior=previousId??recommendationReceipt?.previousId??String(current.activeGlossaryProfileId??'general');
        applying=true;try{options.apply({activeGlossaryProfileId:match.id})}finally{applying=false}
        receipts.activeGlossaryProfileId={expected:baseline.activeGlossaryProfileId,applied:match.id};recommendationReceipt={...match,field:researchField,previousId:prior};confirmed=preference;pending=true;generation++;options.dirty();recovery.hidden=true;recovery.replaceChildren();updateSummary();updateSuggestion();notice(t('用途和方案已加入草稿，点击“保存更改”后生效。'));dialog.close();
      });
      dialog.addEventListener('close',()=>{dialog.remove();field.focus({preventScroll:true})},{once:true});dialog.showModal();cancel.focus();
    }catch(error){notice(localizeErrorMessage(error instanceof Error?error.message:String(error)))}
  }
  function showRecommendationConflict(){
    const receipt=recommendationReceipt;if(!receipt)return;details.open=true;recovery.hidden=false;recovery.replaceChildren();
    const explanation=document.createElement('p');explanation.textContent=t('推荐方案已变化；本页草稿仍保留。');
    const feedback=document.createElement('p');feedback.role='status';const inspect=document.createElement('button'),discard=document.createElement('button');inspect.type=discard.type='button';inspect.textContent=t('核对最新方案');discard.textContent=t('放弃本次推荐');
    discard.addEventListener('click',()=>{
      if(recommendationReceipt!==receipt||options.values().activeGlossaryProfileId!==receipt.id){feedback.textContent=t('设置草稿已变化，请重新核对。');return}
      try{applying=true;options.apply({activeGlossaryProfileId:receipt.previousId});delete receipts.activeGlossaryProfileId;recommendationReceipt=undefined;generation++;options.dirty();recovery.hidden=true;recovery.replaceChildren();updateSummary();updateSuggestion();notice(t('已放弃本次推荐，其他草稿仍保留。'));field.focus({preventScroll:true})}catch(error){feedback.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error))}finally{applying=false}
    });
    inspect.addEventListener('click',()=>{
      inspect.disabled=true;const revision=generation;
      void options.latest().then(latest=>{
        if(recommendationReceipt!==receipt||generation!==revision){feedback.textContent=t('设置草稿已变化，请重新核对。');return}
        if(latest.activeGlossaryProfileId!==baseline.activeGlossaryProfileId){feedback.textContent=t('默认方案也已在另一窗口变化；可先放弃本次推荐，保留最新默认和其他草稿。');return}
        const candidate=recommendPurposeGlossary(receipt.field,latest.glossaryProfiles??[]);
        if(!candidate){feedback.textContent=t('最新方案中暂无唯一名称匹配；可放弃本次推荐，草稿仍保留。');return}
        feedback.replaceChildren();const text=document.createElement('span');text.textContent=msg`最新匹配：${candidate.name}。`;const review=document.createElement('button');review.type='button';review.textContent=t('重新预览');feedback.append(text,review);
        review.addEventListener('click',()=>{review.disabled=true;void options.latest().then(freshLatest=>{
          const freshMatch=recommendPurposeGlossary(receipt.field,freshLatest.glossaryProfiles??[]);
          if(recommendationReceipt!==receipt||generation!==revision||!freshMatch||freshMatch.id!==candidate.id||freshMatch.name!==candidate.name){feedback.textContent=t('方案或草稿再次变化，请重新核对。');return}
          const ids=[candidate.id];if(candidate.id!==receipt.id&&freshLatest.glossaryProfiles?.some(p=>p.id===receipt.id))ids.push(receipt.id);options.syncScheme(freshLatest,ids);generation++;updateSchemes();openRecommendedPreview(candidate,receipt.field,receipt.previousId);
        }).catch(error=>{feedback.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error))}).finally(()=>{if(review.isConnected)review.disabled=false})});
      }).catch(()=>{feedback.textContent=t('暂时无法读取最新方案，请稍后重试；草稿仍保留。')}).finally(()=>{inspect.disabled=false});
    });
    recovery.append(explanation,inspect,discard,feedback);inspect.focus({preventScroll:true});
  }
  function resetInputs(){for(const id of PURPOSE_IDS)checks.get(id)!.checked=Boolean(confirmed?.purposes.includes(id));field.value=confirmed?.researchField??'';useField.checked=Boolean(confirmed?.useFieldInTranslation);scheme.value='';blurredField='';update();notice('');generation++}
  const stage=(event:Event)=>{event.stopPropagation();generation++;try{
    if(event.target!==scheme){confirmed=input();pending=true;options.dirty()}
    update();notice(t(scheme.value?'已选择术语方案，请先预览建议或取消选择。':'用途与领域已加入草稿，保存更改后生效。'));
  }catch(error){pending=true;options.dirty();notice(localizeErrorMessage(error instanceof Error?error.message:String(error)))}};
  body.addEventListener('input',stage);
  body.addEventListener('change',stage);
  field.addEventListener('blur',()=>{if(pointerDown){pendingFieldBlur=true;return}blurredField=field.value;updateSuggestion()});
  details.addEventListener('toggle',()=>{if(details.open){updateSchemes();updateSuggestion()}});reset.addEventListener('click',()=>{scheme.value='';generation++;update();notice(t('已取消术语方案选择，其他草稿仍保留。'))});
  preview.addEventListener('click',()=>{try{
    updateSchemes();const preference=input(),selectedScheme=preference.purposes.includes('research')?scheme.value:'',schemes=options.schemes();
    if(selectedScheme&&!schemes.some(p=>p.id===selectedScheme))throw new Error('该术语方案已不存在，请重新打开后选择。');
    const current=options.values(),revision=generation,snapshot=JSON.stringify(current),schemeSnapshot=JSON.stringify(schemes);
    const proposals=proposePurposeSettings(preference,selectedScheme).filter(item=>(current[item.key]??'general')!==item.value);
    const dialog=document.createElement('dialog');dialog.className='citation-export-dialog purpose-preview-dialog';dialog.ariaLabel=t('用途偏好预览');
    const title=document.createElement('h2');title.textContent=t('用途偏好预览');const note=document.createElement('p');note.textContent=t('只把勾选项加入草稿，保存更改后生效。多选含科研时优先建议学术风格，含外语学习时建议逐句对照。');
    const list=document.createElement('div');list.className='purpose-preview-list';const selections=new Map<PurposeSettingKey,HTMLInputElement>();
    const display=(key:PurposeSettingKey,value:unknown)=>key==='activeGlossaryProfileId'?(schemes.find(p=>p.id===value)?.name??t('通用（原词表）')):t(labels[String(value)]??String(value));
    for(const proposal of proposals){const label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');check.type='checkbox';check.dataset.setting=proposal.key;check.checked=fresh&&!touched.has(proposal.key)&&current[proposal.key]===DEFAULT_SETTINGS[proposal.key];text.textContent=msg`${t(settingLabels[proposal.key])}：${display(proposal.key,current[proposal.key])} → ${display(proposal.key,proposal.value)}`;label.append(check,text);list.append(label);selections.set(proposal.key,check)}
    if(!proposals.length){const empty=document.createElement('p');empty.textContent=t('当前设置已符合建议；确认只记录用途与研究领域。');list.append(empty)}
    const context=document.createElement('p');context.className='field-help';context.textContent=t('启用句子上下文后，附近句子会随主动翻译的选中文字发送到你配置的 API。若启用领域辅助，领域名称会随翻译发送给所配置的 API；应用本身不调用模型。');
    const feedback=document.createElement('p');feedback.role='status';const buttons=document.createElement('div');buttons.className='support-task-actions';const cancel=document.createElement('button'),confirm=document.createElement('button');cancel.type=confirm.type='button';cancel.textContent=t('取消');confirm.textContent=t('加入设置草稿');confirm.className='primary';buttons.append(cancel,confirm);layoutTaskDialog(dialog,title,[note,list,context],buttons,feedback);document.body.append(dialog);
    cancel.addEventListener('click',()=>dialog.close());confirm.addEventListener('click',()=>{
      if(revision!==generation||snapshot!==JSON.stringify(options.values())||schemeSnapshot!==JSON.stringify(options.schemes())){feedback.textContent=t('设置草稿已变化，请重新预览。');confirm.disabled=true;return}
      const patch:Record<string,unknown>={};for(const proposal of proposals)if(selections.get(proposal.key)!.checked){patch[proposal.key]=proposal.value;receipts[proposal.key]={expected:baseline[proposal.key],applied:proposal.value};if(proposal.key==='activeGlossaryProfileId')recommendationReceipt=undefined}
      applying=true;try{options.apply(patch as Partial<PurposeSettings>)}finally{applying=false}
      const changed=!same(confirmed,preference)||Object.keys(patch).length>0;confirmed=preference;pending=pending||changed;scheme.value='';if(changed)options.dirty();updateSummary();notice(t(pending?'用途偏好已加入草稿，点击“保存更改”后生效。':'没有新增更改。'));dialog.close();
    });
    dialog.addEventListener('close',()=>{dialog.remove();preview.focus({preventScroll:true})},{once:true});dialog.showModal();cancel.focus();
  }catch(error){notice(localizeErrorMessage(error instanceof Error?error.message:String(error)))}});
  return {
    load(settings:ExtensionSettings){baseline=settings;confirmed=normalizePurposePreferences(settings.purposePreferences);pending=false;receipts={};recommendationReceipt=undefined;recovery.hidden=true;recovery.replaceChildren();touched.clear();fresh=!settings.onboardingCompleted;resetInputs()},
    manual(key:PurposeSettingKey){if(applying)return;touched.add(key);delete receipts[key];if(key==='activeGlossaryProfileId'){recommendationReceipt=undefined;recovery.hidden=true;recovery.replaceChildren()}generation++},
    read(){const preference=input();if(scheme.value)throw new Error('已选择术语方案，请先预览建议或取消选择。');return pending?{purposePreferences:preference}:confirmed?{purposePreferences:confirmed}:{}},
    token:()=>JSON.stringify([generation,options.values(),input(),scheme.value,options.schemes()]),
    assertCurrent(latest:ExtensionSettings,submission?:string){
      if(submission!==undefined&&submission!==JSON.stringify([generation,options.values(),input(),scheme.value,options.schemes()]))throw new Error('用途或建议设置已变化，请检查草稿后重新保存。');
      const activeReceipt=receipts.activeGlossaryProfileId;if(recommendationReceipt&&activeReceipt&&latest.activeGlossaryProfileId!==activeReceipt.expected&&latest.activeGlossaryProfileId!==activeReceipt.applied)throw new PurposeRecommendationStaleError();
      assertPurposeChangesCurrent(receipts,latest);
      if(recommendationReceipt){const receipt=recommendationReceipt,latestProfiles=latest.glossaryProfiles??[],wasExisting=baseline.glossaryProfiles?.some(p=>p.id===receipt.id),local=options.schemes().find(p=>p.id===receipt.id);if(!local||local.name!==receipt.name||wasExisting&&!latestProfiles.some(p=>p.id===receipt.id))throw new PurposeRecommendationStaleError();const candidates=wasExisting?latestProfiles:[...latestProfiles,...(latestProfiles.some(p=>p.id===receipt.id)?[]:[local])];const match=recommendPurposeGlossary(receipt.field,candidates);if(!match||match.id!==receipt.id||match.name!==receipt.name)throw new PurposeRecommendationStaleError()}
    },
    pending:()=>pending,
    hasUnconfirmed,
    refreshSchemes(){updateSchemes();updateSuggestion()},
    showRecommendationConflict(){showRecommendationConflict()},
    // Advance only the committed baseline; keep any later inputs and receipts.
    rebase(settings:ExtensionSettings){baseline=settings;fresh=!settings.onboardingCompleted;for(const key of PURPOSE_SETTING_KEYS){const receipt=receipts[key];if(receipt)receipt.expected=settings[key]}},
    saved(){pending=false;receipts={};recommendationReceipt=undefined;recovery.hidden=true;recovery.replaceChildren();updateSummary();notice('')},
    open(){details.open=true;checks.get('daily')!.focus({preventScroll:true});details.scrollIntoView({block:'nearest'})},
  };
}
