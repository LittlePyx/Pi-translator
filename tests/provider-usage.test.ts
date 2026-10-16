import {describe,it,expect} from 'vitest';
import {parseProviderUsage,recordProviderUsage,reportedProviderUsage} from '../core/translation/provider-usage';
describe('provider-reported token usage',()=>{
  it('leaves missing or malformed usage unknown',()=>{
    for(const value of [{},{usage:{prompt_tokens:-1,completion_tokens:2}}, {usage:{prompt_tokens:'10',completion_tokens:2}}])expect(parseProviderUsage(value)).toBeUndefined();
  });
  it('accumulates numeric reports for one operation without storing response text',()=>{
    const signal=new AbortController().signal;
    recordProviderUsage(signal,{usage:{prompt_tokens:10,completion_tokens:5},text:'private'});
    recordProviderUsage(signal,{usage:{input_tokens:4,output_tokens:3}});
    expect(reportedProviderUsage(signal)).toEqual({inputTokens:14,outputTokens:8,totalTokens:22});
    expect(reportedProviderUsage(new AbortController().signal)).toBeUndefined();
  });
});
