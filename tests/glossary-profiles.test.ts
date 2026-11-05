import {describe,it,expect} from 'vitest';
import {DEFAULT_SETTINGS,type ExtensionSettings} from '../core/settings/schema';
import {glossaryDocumentId,effectiveSettingsGlossary,documentGlossarySelection,validateGlossaryProfileSettings,validateGlossaryProfiles} from '../core/settings/glossary-profiles';
import {mergeSettingsDraft} from '../core/settings/draft-merge';
import {exportSettingsConfiguration,importSettingsConfiguration} from '../core/settings/config-transfer';
import {mergeDocumentGlossaryWithScope} from '../core/document/document-memory-repository';
import {translationCacheKey} from '../core/translation/cache-repository';
import {isRuntimeMessage} from '../core/messaging/messages';
import {translationBehaviorFingerprint} from '../core/settings/translation-configuration';
const term=(source:string,target:string)=>({source,target});
function settings():ExtensionSettings{return {...DEFAULT_SETTINGS,academicGlossary:[term('power','功率'),term('evidence','证据')],glossaryProfiles:[{id:'statistics',name:'统计学',entries:[term('power','检验效能')]},{id:'energy',name:'能源',entries:[term('power','电功率')]}],activeGlossaryProfileId:'statistics',documentGlossaryProfiles:{'doc-a':'energy'}}}
describe('research glossary schemes',()=>{
  it('offers only a read-only document suggestion and preserves explicit choices',()=>{
    const s=settings();s.activeGlossaryProfileId='general';s.glossaryProfiles![0]!.entries=[term('sample size','样本量'),term('confidence interval','置信区间')];
    const before=structuredClone(s);expect(documentGlossarySelection(s,'doc-new','sample size and confidence interval')).toMatchObject({selectedId:'',defaultId:'general',suggestion:{profileId:'statistics'}});
    expect(documentGlossarySelection(s,'doc-a','sample size and confidence interval').suggestion).toBeUndefined();expect(s).toEqual(before);
  });
  it('bounds local recommendation evidence and validates recommendation write checks',()=>{
    expect(isRuntimeMessage({type:'GET_DOCUMENT_GLOSSARY',payload:{pageUrl:'https://example.org',evidenceText:'a'.repeat(6000)}})).toBe(true);
    expect(isRuntimeMessage({type:'GET_DOCUMENT_GLOSSARY',payload:{pageUrl:'https://example.org',evidenceText:'a'.repeat(6001)}})).toBe(false);
    expect(isRuntimeMessage({type:'SET_DOCUMENT_GLOSSARY',payload:{pageUrl:'https://example.org',profileId:'statistics',expectedId:'',evidenceText:'untrusted'}})).toBe(false);
    const payload={pageUrl:'https://example.org',profileId:'statistics',expectedId:'',expectedSuggestion:{defaultId:'general',evidenceText:'sample size',profileSnapshot:'{}'}};
    expect(isRuntimeMessage({type:'SET_DOCUMENT_GLOSSARY',payload})).toBe(true);
    expect(isRuntimeMessage({type:'SET_DOCUMENT_GLOSSARY',payload:{...payload,expectedSuggestion:{...payload.expectedSuggestion,evidenceText:'a'.repeat(6001)}}})).toBe(false);
    expect(isRuntimeMessage({type:'SET_DOCUMENT_GLOSSARY',payload:{...payload,expectedSuggestion:{...payload.expectedSuggestion,profileSnapshot:'a'.repeat(160001)}}})).toBe(false);
  });
  it('keeps old settings and the original glossary unchanged without migration',()=>{const old={...DEFAULT_SETTINGS,academicGlossary:[term('power','人工原译法')]};expect(validateGlossaryProfiles(old)).toEqual({});expect(effectiveSettingsGlossary(old)).toEqual(old.academicGlossary)});
  it('applies explicit document selection, then default, while retaining general terms',()=>{const s=settings();expect(effectiveSettingsGlossary(s,'doc-a')).toEqual([term('power','电功率'),term('evidence','证据')]);expect(effectiveSettingsGlossary(s,'doc-b')[0]).toEqual(term('power','检验效能'));s.documentGlossaryProfiles!['doc-a']='general';expect(effectiveSettingsGlossary(s,'doc-a')).toEqual(s.academicGlossary);expect(s.academicGlossary[0]!.target).toBe('功率')});
  it('keeps confirmed document terms above the chosen scheme',()=>{const s=settings(),confirmed={id:'manual',source:'power',target:'本文人工约定',createdAt:1,updatedAt:2};expect(mergeDocumentGlossaryWithScope(effectiveSettingsGlossary(s),{confirmedTerms:[confirmed]})).toEqual([{...term('power','本文人工约定'),scope:'document'},{...term('evidence','证据'),scope:'global'}]);expect(confirmed.target).toBe('本文人工约定')});
  it('falls back to general for a deleted explicit scheme, with a visible missing flag',()=>{const s=settings();s.documentGlossaryProfiles!['doc-a']='deleted';expect(documentGlossarySelection(s,'doc-a')).toMatchObject({selectedId:'deleted',missing:true});expect(effectiveSettingsGlossary(s,'doc-a')).toEqual(s.academicGlossary)});
  it('round trips schemes and document choices in key-free settings export',()=>{const s=settings();const json=exportSettingsConfiguration(s),restored=importSettingsConfiguration(json,DEFAULT_SETTINGS);expect(restored.glossaryProfiles).toEqual(s.glossaryProfiles);expect(restored.documentGlossaryProfiles).toEqual(s.documentGlossaryProfiles);expect(restored.activeGlossaryProfileId).toBe('statistics');expect(json).not.toContain('apiKeyStorage')});
  it('preserves local schemes when importing an older configuration',()=>{const s=settings(),restored=importSettingsConfiguration(exportSettingsConfiguration(DEFAULT_SETTINGS),s);expect(restored.glossaryProfiles).toEqual(s.glossaryProfiles);expect(restored.documentGlossaryProfiles).toEqual(s.documentGlossaryProfiles)});
  it('rejects malformed, duplicate, over-limit schemes and excessive combined term budgets',()=>{const s=settings();expect(()=>validateGlossaryProfiles({glossaryProfiles:[s.glossaryProfiles![0]!,{...s.glossaryProfiles![1]!,name:'统计学'}]})).toThrow('重复');expect(()=>validateGlossaryProfiles({documentGlossaryProfiles:JSON.parse('{"__proto__":"energy"}')})).toThrow();s.academicGlossary=Array.from({length:100},(_,i)=>term(`term ${i}`,'原约定'));expect(()=>validateGlossaryProfileSettings(s)).toThrow('100');expect(()=>validateGlossaryProfiles({glossaryProfiles:Array.from({length:13},(_,i)=>({id:`p-${i}`,name:`方案${i}`,entries:[]}))})).toThrow()});
  it('merges independent concurrent edits and keeps runtime document choices',()=>{const baseline=settings(),draft=structuredClone(baseline),latest=structuredClone(baseline);draft.glossaryProfiles![0]!.entries.push(term('sample','样本'));latest.glossaryProfiles![1]!.entries.push(term('heat','热量'));latest.documentGlossaryProfiles!['doc-b']='general';const next=mergeSettingsDraft(baseline,draft,latest).settings;expect(next.glossaryProfiles![0]!.entries).toContainEqual(term('sample','样本'));expect(next.glossaryProfiles![1]!.entries).toContainEqual(term('heat','热量'));expect(next.documentGlossaryProfiles).toEqual(latest.documentGlossaryProfiles)});
  it('rejects concurrent conflicting edits, deletion versus editing and merged capacity overflow',()=>{const baseline=settings(),draft=structuredClone(baseline),latest=structuredClone(baseline);draft.glossaryProfiles![0]!.entries=[term('power','草稿约定')];latest.glossaryProfiles![0]!.entries=[term('power','另一人工约定')];expect(()=>mergeSettingsDraft(baseline,draft,latest)).toThrow('另一窗口');draft.glossaryProfiles=draft.glossaryProfiles!.slice(1);draft.activeGlossaryProfileId='energy';expect(()=>mergeSettingsDraft(baseline,draft,latest)).toThrow('另一窗口');expect(baseline.glossaryProfiles![0]!.entries[0]!.target).toBe('检验效能')});
  it('invalidates translation state when scheme terms or document choices change',()=>{const a=settings(),b=structuredClone(a);b.documentGlossaryProfiles!['doc-a']='general';expect(translationBehaviorFingerprint(a)).not.toBe(translationBehaviorFingerprint(b));b.documentGlossaryProfiles=a.documentGlossaryProfiles!;b.glossaryProfiles![0]!.entries=[term('power','新约定')];expect(translationBehaviorFingerprint(a)).not.toBe(translationBehaviorFingerprint(b))});
  it('keys cached results by effective terms and validates the stable local PDF scheme identity',()=>{
    const s=settings(),request={requestId:'same',text:'The power is stable.',pageUrl:'https://example.org',sourceLanguage:'auto',targetLanguage:'zh-CN',style:'academic' as const,contentMode:'auto' as const},provider={apiBaseUrl:'https://api.example.org',model:'mock'};
    expect(translationCacheKey(request,{...provider,glossary:effectiveSettingsGlossary(s,'doc-a')})).not.toBe(translationCacheKey(request,{...provider,glossary:effectiveSettingsGlossary(s,'doc-b')}));
    expect(glossaryDocumentId({glossaryDocumentId:'doc-content'},'doc-old')).toBe('doc-content');expect(glossaryDocumentId({},'doc-old')).toBe('doc-old');expect(()=>glossaryDocumentId({glossaryDocumentId:'invalid'},'doc-old')).toThrow();
    expect(isRuntimeMessage({type:'SET_DOCUMENT_GLOSSARY',payload:{pageUrl:'https://example.org',profileId:'statistics',expectedId:'',glossaryDocumentId:'doc-content'}})).toBe(true);
    expect(isRuntimeMessage({type:'SET_DOCUMENT_GLOSSARY',payload:{pageUrl:'https://example.org',profileId:'statistics'}})).toBe(false);
  });
  it('rejects a merged scheme budget overflow without truncating independent window edits',()=>{
    const baseline=settings(),draft=structuredClone(baseline),latest=structuredClone(baseline);draft.glossaryProfiles![0]!.entries=Array.from({length:98},(_,i)=>term(`draft ${i}`,'人工约定'));latest.academicGlossary.push(term('added elsewhere','另一窗口人工约定'));
    expect(()=>mergeSettingsDraft(baseline,draft,latest)).toThrow('100');expect(latest.academicGlossary).toHaveLength(3);expect(draft.glossaryProfiles![0]!.entries).toHaveLength(98);
  });

});
