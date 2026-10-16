import {describe, expect, it} from 'vitest';
import {formatCost, normalizeModelPrices, reportedCost, roughTextCost} from '../core/translation/cost-estimate';
import {addPdfReportedTokens, emptyPdfRequestUsage, validPdfRequestUsage} from '../core/pdf/request-budget';
import {DEFAULT_SETTINGS} from '../core/settings/schema';
import {exportSettingsConfiguration, importSettingsConfiguration} from '../core/settings/config-transfer';
const text = {apiBaseUrl:'https://example.com/v1',model:'text'};
const vision = {apiBaseUrl:'https://example.com/v1',model:'vision'};
const prices = normalizeModelPrices([{...text,currency:'CNY',inputPerMillion:2,outputPerMillion:8},
  {...vision,currency:'USD',inputPerMillion:1,outputPerMillion:3}]);
describe('user-priced estimates',()=>{
  it('keeps providers, models and currencies separate, including genuinely free models',()=>{
    const usage=emptyPdfRequestUsage();
    addPdfReportedTokens(usage,{inputTokens:1000,outputTokens:500,totalTokens:1500},text);
    addPdfReportedTokens(usage,{inputTokens:2000,outputTokens:1000,totalTokens:3000},vision);
    addPdfReportedTokens(usage,{inputTokens:1000,outputTokens:500,totalTokens:1500},text);
    addPdfReportedTokens(usage,{inputTokens:1,outputTokens:2,totalTokens:3},{...text,apiBaseUrl:'https://other.example/v1'});
    expect(reportedCost(usage.byModel!,prices)).toEqual({amounts:{CNY:.012,USD:.005},unpricedModels:['text']});
    expect(usage.reportedTokens?.totalTokens).toBe(6003);
    expect(validPdfRequestUsage(usage)).toBe(true);
    const free=normalizeModelPrices([{...text,currency:'CNY',inputPerMillion:0,outputPerMillion:0}]);
    expect(reportedCost(usage.byModel!.slice(0,1),free).amounts).toEqual({CNY:0});
    expect(formatCost(0,'CNY')).toBe('¥0.000000');
  });
  it('does not turn missing usage or a different model into zero cost',()=>{
    const usage=emptyPdfRequestUsage();addPdfReportedTokens(usage,undefined,text);
    expect(usage.reportedTokens).toBeUndefined();
    expect(reportedCost([],prices).amounts).toEqual({});
    expect(reportedCost([{...text,model:'changed',inputTokens:1,outputTokens:2,totalTokens:3}],prices).unpricedModels).toEqual(['changed']);
    expect(validPdfRequestUsage({...usage,byModel:[{...text,apiBaseUrl:'javascript:alert(1)',inputTokens:1,outputTokens:2,totalTokens:3}]})).toBe(false);
  });
  it('validates editable rates and preserves them in credential-free config transfer',()=>{
    const invalid=normalizeModelPrices([{...text,currency:'CNY',inputPerMillion:-1,outputPerMillion:1},
      {...text,currency:'EUR',inputPerMillion:1,outputPerMillion:1},
      {...text,currency:'CNY',inputPerMillion:NaN,outputPerMillion:1},
      {...text,apiBaseUrl:'https://user:secret@example.com',currency:'CNY',inputPerMillion:1,outputPerMillion:1}]);
    expect(invalid).toEqual([]);
    const exported=exportSettingsConfiguration({...DEFAULT_SETTINGS,modelPrices:prices});
    expect(importSettingsConfiguration(exported,DEFAULT_SETTINGS).modelPrices).toEqual(prices);
    expect(exported).not.toContain('apiKey"');
    expect(roughTextCost(4000,prices[0]!)).toEqual([.01,.072]);
  });
});
