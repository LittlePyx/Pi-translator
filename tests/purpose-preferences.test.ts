import {describe,it,expect} from 'vitest';
import {DEFAULT_SETTINGS,type ExtensionSettings} from '../core/settings/schema';
import {normalizePurposePreferences,translationResearchField,proposePurposeSettings,recommendPurposeGlossary,assertPurposeChangesCurrent} from '../core/settings/purpose-preferences';
import {mergeSettingsDraft} from '../core/settings/draft-merge';
import {translationBehaviorFingerprint} from '../core/settings/translation-configuration';
import {exportSettingsConfiguration,importSettingsConfiguration} from '../core/settings/config-transfer';

describe('optional purpose preferences',()=>{
  it('recommends only an unambiguous normalized exact scheme name',()=>{
    const schemes=[{id:'stats',name:'生物统计'},{id:'energy',name:'能源'},{id:'ai1',name:'AI'},{id:'ai2',name:'ＡＩ'}];
    expect(recommendPurposeGlossary('  生物统计  ',schemes)).toEqual({id:'stats',name:'生物统计'});
    expect(recommendPurposeGlossary('生物统计学',schemes)).toBeUndefined();
    expect(recommendPurposeGlossary('ai',schemes)).toBeUndefined();
    expect(recommendPurposeGlossary('',schemes)).toBeUndefined();
    expect(recommendPurposeGlossary(' energy ',[{id:'e',name:'ＥＮＥＲＧＹ'}])).toEqual({id:'e',name:'ＥＮＥＲＧＹ'});
  });
  it('leaves old settings without metadata and canonicalizes only explicit purpose input',()=>{
    expect(normalizePurposePreferences(undefined)).toBeUndefined();expect(normalizePurposePreferences({purposes:['learning','research'],researchField:' 统计学 '})).toEqual({purposes:['research','learning'],researchField:'统计学'});
  });
  it.each([{purposes:['research','research'],researchField:''},{purposes:['unknown'],researchField:''},{purposes:['research'],researchField:'a'.repeat(81)},{purposes:[],researchField:'line\nbreak'},{purposes:'daily',researchField:''}])('rejects malformed preferences without mutating input %j',value=>{const before=structuredClone(value);expect(()=>normalizePurposePreferences(value)).toThrow();expect(value).toEqual(before)});
  it('combines research and language learning without changing providers, permissions, budget or target language',()=>{
    const suggestions=proposePurposeSettings({purposes:['daily','research','learning'],researchField:'统计学'},'statistics');
    expect(Object.fromEntries(suggestions.map(p=>[p.key,p.value]))).toEqual({style:'academic',contextMode:'sentence',sentenceAlignmentDefault:true,contentMode:'auto',autoRenderLatex:true,activeGlossaryProfileId:'statistics'});
    expect(JSON.stringify(suggestions)).not.toContain('统计学');expect(proposePurposeSettings({purposes:[],researchField:'保留手填领域'})).toEqual([]);
  });
  it('suggests only the existing lightweight controls for daily reading',()=>{
    expect(proposePurposeSettings({purposes:['daily'],researchField:''})).toEqual([{key:'style',value:'general'},{key:'contextMode',value:'off'},{key:'sentenceAlignmentDefault',value:false}]);
  });
  it('round trips explicit preferences in key-free configuration and retains them with old files',()=>{
    const settings:ExtensionSettings={...DEFAULT_SETTINGS,purposePreferences:{purposes:['research'],researchField:'手写领域'}};
    const exported=exportSettingsConfiguration(settings);expect(importSettingsConfiguration(exported,DEFAULT_SETTINGS).purposePreferences).toEqual(settings.purposePreferences);
    expect(importSettingsConfiguration(exportSettingsConfiguration(DEFAULT_SETTINGS),settings).purposePreferences).toEqual(settings.purposePreferences);
    const corrupt=JSON.parse(exported);corrupt.settings.purposePreferences.purposes=['invalid'];expect(()=>importSettingsConfiguration(JSON.stringify(corrupt),settings)).toThrow();
    expect(normalizePurposePreferences({...settings.purposePreferences,apiKey:'should-not-export'})).toEqual(settings.purposePreferences);
  });
  it('preserves independent concurrent preferences and rejects two conflicting purpose edits',()=>{
    const baseline={...DEFAULT_SETTINGS},draft={...baseline,sidebarSide:'left' as const},latest:ExtensionSettings={...baseline,purposePreferences:{purposes:['research'],researchField:'统计学'}};
    expect(mergeSettingsDraft(baseline,draft,latest).settings.purposePreferences).toEqual(latest.purposePreferences);
    const changed={...baseline,purposePreferences:{purposes:['daily' as const],researchField:''}};expect(()=>mergeSettingsDraft(baseline,changed,latest)).toThrow('另一窗口');
  });
  it('protects a newer setting from a stale preset while accepting an already identical choice',()=>{
    const receipt={style:{expected:'academic',applied:'general'}};expect(()=>assertPurposeChangesCurrent(receipt,{...DEFAULT_SETTINGS,style:'literal'})).toThrow('另一窗口');
    expect(()=>assertPurposeChangesCurrent(receipt,{...DEFAULT_SETTINGS,style:'general'})).not.toThrow();expect(DEFAULT_SETTINGS.style).toBe('academic');
  });
  it('does not invalidate translation state for research field metadata alone',()=>{
    const settings={...DEFAULT_SETTINGS,purposePreferences:{purposes:['research' as const],researchField:'统计学'}};expect(translationBehaviorFingerprint(settings)).toBe(translationBehaviorFingerprint(DEFAULT_SETTINGS));expect(translationBehaviorFingerprint({...settings,style:'general'})).not.toBe(translationBehaviorFingerprint(DEFAULT_SETTINGS));
  });
  it('sends an existing research field only after explicit opt-in and changes translation identity',()=>{
    const old={purposes:['research' as const],researchField:'统计学'};
    expect(translationResearchField(old)).toBeUndefined();
    expect(translationResearchField({...old,useFieldInTranslation:true})).toBe('统计学');
    expect(translationResearchField({purposes:['daily'],researchField:'统计学',useFieldInTranslation:true})).toBeUndefined();
    const on={...DEFAULT_SETTINGS,purposePreferences:{...old,useFieldInTranslation:true}};
    expect(translationBehaviorFingerprint(on)).not.toBe(translationBehaviorFingerprint({...DEFAULT_SETTINGS,purposePreferences:old}));
    expect(importSettingsConfiguration(exportSettingsConfiguration(on),DEFAULT_SETTINGS).purposePreferences).toEqual(on.purposePreferences);
  });
});
