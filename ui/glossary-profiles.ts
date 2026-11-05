import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import type {ExtensionSettings} from '../core/settings/schema';
import {GENERAL_GLOSSARY_ID,MAX_GLOSSARY_PROFILES,validateGlossaryProfileSettings,type GlossaryProfile} from '../core/settings/glossary-profiles';
import {formatGlossaryEntries,parseGlossaryText} from '../core/translation/glossary';

/** The existing textarea and file importer always edit the selected draft. */
export function bindGlossaryProfiles(textarea:HTMLTextAreaElement,onSwitch:()=>void){
  const row=document.createElement('div');row.className='glossary-profile-controls';
  const label=document.createElement('label'),caption=document.createElement('span'),select=document.createElement('select');
  caption.textContent=t('默认术语方案');select.id='glossary-profile';label.append(caption,select);
  const actions=document.createElement('div');actions.className='support-task-actions';
  const add=document.createElement('button'),rename=document.createElement('button'),remove=document.createElement('button');
  add.textContent=t('新建方案…');rename.textContent=t('重命名…');remove.textContent=t('删除方案');
  add.id='glossary-profile-add';rename.id='glossary-profile-rename';remove.id='glossary-profile-delete';
  for(const button of [add,rename,remove])button.type='button';actions.append(add,rename,remove);row.append(label,actions);
  const help=document.createElement('p');help.className='glossary-transfer-status';help.textContent=t('切换默认方案也会切换编辑词表；切换和导入先保留为草稿，保存后生效。本文已确认术语优先于领域方案，领域方案覆盖通用同名词；旧译文保留。');row.append(help);
  const status=document.createElement('p');status.id='glossary-profile-status';status.role='status';status.hidden=true;row.append(status);textarea.closest('label')!.before(row);
  let baseline:ExtensionSettings,profiles:GlossaryProfile[]=[],selected=GENERAL_GLOSSARY_ID,revision=0;
  const drafts=new Map<string,string>();
  const notice=(message:string)=>{status.textContent=message;status.hidden=!message};
  const fail=(error:unknown)=>notice(localizeErrorMessage(error instanceof Error?error.message:String(error)));
  function render(){
    select.replaceChildren();
    for(const item of [{id:GENERAL_GLOSSARY_ID,name:t('通用（原词表）')},...profiles]){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;option.title=item.name;select.append(option)}
    select.value=selected;rename.hidden=remove.hidden=selected===GENERAL_GLOSSARY_ID;add.disabled=profiles.length>=MAX_GLOSSARY_PROFILES;
  }
  function switchTo(id:string){drafts.set(selected,textarea.value);selected=id;revision++;textarea.value=drafts.get(id)??'';render();onSwitch();notice('')}
  function changed(){textarea.dispatchEvent(new Event('input',{bubbles:true}))}
  function nameInput(previous=''):string|undefined{
    const value=prompt(t('术语方案名称（最多 40 字，例如：统计学）'),previous);if(value===null)return;
    const name=value.trim();if(!name||name.length>40||/[\u0000-\u001f]/u.test(name))throw new Error('术语方案名称需为 1–40 字。');
    if(profiles.some(p=>p.id!==selected&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase())||name===t('通用（原词表）'))throw new Error('术语方案名称不能重复。');return name;
  }
  select.addEventListener('change',()=>switchTo(select.value));
  add.addEventListener('click',()=>{try{
    const previous=selected;selected='';let name:string|undefined;try{name=nameInput()}finally{selected=previous}if(!name)return;
    if(profiles.length>=MAX_GLOSSARY_PROFILES)throw new Error('最多保留 12 个领域术语方案。');
    const id=crypto.randomUUID();profiles.push({id,name,entries:[]});switchTo(id);changed();textarea.focus();
  }catch(error){fail(error)}});
  rename.addEventListener('click',()=>{try{const profile=profiles.find(p=>p.id===selected);if(!profile)return;const name=nameInput(profile.name);if(!name||name===profile.name)return;profile.name=name;render();changed()}catch(error){fail(error)}});
  remove.addEventListener('click',()=>{const profile=profiles.find(p=>p.id===selected);if(!profile||!confirm(msg`删除术语方案“${profile.name}”？保存后，固定使用此方案的文档将使用通用词表，并提示方案已删除；旧译文和本文术语保留。`))return;
    const id=selected;switchTo(GENERAL_GLOSSARY_ID);profiles=profiles.filter(p=>p.id!==id);drafts.delete(id);render();changed();
  });
  return {
    token:()=>revision,
    choices:()=>profiles.map(({id,name})=>({id,name})),
    syncSuggested(latest:ExtensionSettings,ids:string[]){
      const incoming=[...new Set(ids)].map(id=>{const item=latest.glossaryProfiles?.find(p=>p.id===id);if(!item)throw new Error('最新术语方案已不存在，请重新核对。');return item});
      for(const item of incoming){const local=profiles.find(p=>p.id===item.id),original=baseline.glossaryProfiles?.find(p=>p.id===item.id);if(local&&(!original||local.name!==original.name&&local.name!==item.name))throw new Error('本页已修改该方案名称，请先处理名称草稿。')}
      if(profiles.length+incoming.filter(item=>!profiles.some(p=>p.id===item.id)).length>MAX_GLOSSARY_PROFILES)throw new Error('术语方案已达上限，请先整理草稿。');
      const names=[...profiles.map(p=>incoming.find(item=>item.id===p.id)?.name??p.name),...incoming.filter(item=>!profiles.some(p=>p.id===item.id)).map(p=>p.name)].map(name=>name.toLocaleLowerCase());
      if(new Set(names).size!==names.length)throw new Error('最新方案与本页方案重名，请先处理名称草稿。');
      for(const item of incoming){const local=profiles.find(p=>p.id===item.id);if(local)local.name=item.name;else{profiles.push({...item,entries:[...item.entries]});drafts.set(item.id,formatGlossaryEntries(item.entries))}}
      revision++;render();
    },
    choose(id:string){if(!profiles.some(p=>p.id===id)&&id!==GENERAL_GLOSSARY_ID)throw new Error('该术语方案已不存在，请重新打开后选择。');select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}))},
    load(settings:ExtensionSettings){baseline=settings;profiles=(settings.glossaryProfiles??[]).map(p=>({...p,entries:[...p.entries]}));drafts.clear();drafts.set(GENERAL_GLOSSARY_ID,formatGlossaryEntries(settings.academicGlossary));for(const p of profiles)drafts.set(p.id,formatGlossaryEntries(p.entries));selected=settings.activeGlossaryProfileId??GENERAL_GLOSSARY_ID;revision++;textarea.value=drafts.get(selected)??'';render();onSwitch();notice('')},
    read(){
      drafts.set(selected,textarea.value);
      const parse=(id:string)=>{const result=parseGlossaryText(drafts.get(id)??'');if(result.errors.length){const name=id===GENERAL_GLOSSARY_ID?t('通用（原词表）'):profiles.find(p=>p.id===id)!.name,error=localizeErrorMessage(result.errors[0]!);throw new Error(id===selected?msg`术语方案“${name}”：${error}`:msg`术语方案“${name}”：${error} 请切换至该方案修正。`)}return result.entries};
      const academicGlossary=parse(GENERAL_GLOSSARY_ID),glossaryProfiles=profiles.map(p=>({...p,entries:parse(p.id)}));
      const result={academicGlossary,...(glossaryProfiles.length||baseline.glossaryProfiles!==undefined?{glossaryProfiles}:{}),...(selected!==GENERAL_GLOSSARY_ID||baseline.activeGlossaryProfileId!==undefined||glossaryProfiles.length?{activeGlossaryProfileId:selected}:{})};
      try{validateGlossaryProfileSettings({...baseline,...result});notice('');return result}catch(error){fail(error);throw error}
    },
  };
}
