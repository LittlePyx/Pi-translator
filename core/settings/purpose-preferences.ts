import type {ExtensionSettings} from './schema';

export const PURPOSE_IDS=['daily','research','learning'] as const;
export type PurposeId=typeof PURPOSE_IDS[number];
export interface PurposePreferences {purposes:PurposeId[];researchField:string;useFieldInTranslation?:boolean}
export const PURPOSE_SETTING_KEYS=['style','contentMode','contextMode','sentenceAlignmentDefault','autoRenderLatex','activeGlossaryProfileId'] as const;
export type PurposeSettingKey=typeof PURPOSE_SETTING_KEYS[number];
export type PurposeSettings=Pick<ExtensionSettings,PurposeSettingKey>;
export interface PurposeProposal {key:PurposeSettingKey;value:string|boolean}

/** Match only a unique existing name; never infer a field or change settings. */
export function recommendPurposeGlossary(field:string,profiles:readonly {id:string;name:string}[]):{id:string;name:string}|undefined{
  const key=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
  const wanted=key(field);if(!wanted)return;
  const matches=profiles.filter(profile=>key(profile.name)===wanted);
  return matches.length===1?{id:matches[0]!.id,name:matches[0]!.name}:undefined;
}

export function normalizePurposePreferences(value:unknown):PurposePreferences|undefined{
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('用途偏好格式无效，原设置未改变。');
  const data=value as Partial<PurposePreferences>;
  if(!Array.isArray(data.purposes)||data.purposes.length>3||data.purposes.some(id=>!PURPOSE_IDS.includes(id))||new Set(data.purposes).size!==data.purposes.length||typeof data.researchField!=='string'||data.researchField.trim().length>80||/[\u0000-\u001f]/u.test(data.researchField)||(data.useFieldInTranslation!==undefined&&typeof data.useFieldInTranslation!=='boolean'))throw new Error('用途或研究领域无效，请使用最多 80 字的领域名称。');
  return {purposes:PURPOSE_IDS.filter(id=>data.purposes!.includes(id)),researchField:data.researchField.trim(),...(data.useFieldInTranslation?{useFieldInTranslation:true}:{})};
}

/** Older preferences remain local until the user explicitly enables sharing. */
export function translationResearchField(preferences:PurposePreferences|undefined):string|undefined{
  return preferences?.useFieldInTranslation&&preferences.purposes.includes('research')?preferences.researchField.trim()||undefined:undefined;
}

/** Suggestions use existing controls only. No provider, permission, language or budget change. */
export function proposePurposeSettings(preferences:PurposePreferences,glossaryId=''):PurposeProposal[]{
  const {purposes}=normalizePurposePreferences(preferences)!;
  if(!purposes.length)return [];
  const research=purposes.includes('research'),learning=purposes.includes('learning');
  const result:PurposeProposal[]=[
    {key:'style',value:research?'academic':'general'},
    {key:'contextMode',value:research||learning?'sentence':'off'},
    {key:'sentenceAlignmentDefault',value:learning},
  ];
  if(research)result.push({key:'contentMode',value:'auto'},{key:'autoRenderLatex',value:true});
  if(research&&glossaryId)result.push({key:'activeGlossaryProfileId',value:glossaryId});
  return result;
}

/** A preset must not overwrite a newer choice made in another window. */
export function assertPurposeChangesCurrent(
  receipts:Partial<Record<PurposeSettingKey,{expected:unknown;applied:unknown}>>,
  latest:ExtensionSettings,
):void{
  for(const key of PURPOSE_SETTING_KEYS){const receipt=receipts[key];if(receipt&&latest[key]!==receipt.expected&&latest[key]!==receipt.applied)throw new Error('另一窗口已修改建议中的设置，请保留草稿并重新加载后整理。')}
}
