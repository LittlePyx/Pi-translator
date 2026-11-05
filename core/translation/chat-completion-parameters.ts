/** Map documented compatibility differences before sending; never retry to guess. */
export function chatCompletionParameters(
  apiBaseUrl: string,
  model: string,
  temperature: number,
  maximumTokens: number,
): Record<string, number> {
  const host = new URL(apiBaseUrl).hostname;
  const openAi = host === 'api.openai.com';
  const reasoningGpt = /(?:^|\/)(?:gpt-[5-9](?:[.-]|$)|o[1-9](?:[-.]|$))/iu.test(model);
  // Claude 4.7+ rejects low temperatures. Omitting sampling also works for older
  // Claude models and avoids guessing capabilities from changing version IDs.
  const omitSampling = /claude/iu.test(model) || host === 'api.anthropic.com' || reasoningGpt;
  const budget = reasoningGpt ? Math.max(maximumTokens, 2048) : maximumTokens;
  return {
    ...(omitSampling ? {} : { temperature }),
    ...(openAi ? { max_completion_tokens: budget } : { max_tokens: budget }),
  };
}
