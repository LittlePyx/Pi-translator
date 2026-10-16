export interface ProviderTokenUsage { inputTokens: number; outputTokens: number; totalTokens: number }
const reported = new WeakMap<AbortSignal, ProviderTokenUsage>();

export function parseProviderUsage(envelope: unknown): ProviderTokenUsage | undefined {
  if (!envelope || typeof envelope !== 'object') return undefined;
  const usage = (envelope as {usage?: unknown}).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const fields = usage as Record<string, unknown>;
  const input = fields.prompt_tokens ?? fields.input_tokens;
  const output = fields.completion_tokens ?? fields.output_tokens;
  if (![input,output].every((value) => Number.isSafeInteger(value) && Number(value) >= 0)) return undefined;
  return { inputTokens: Number(input), outputTokens: Number(output), totalTokens: Number(input) + Number(output) };
}

export function recordProviderUsage(signal: AbortSignal, envelope: unknown): void {
  const usage = parseProviderUsage(envelope);
  if (!usage) return;
  const previous = reported.get(signal);
  reported.set(signal, previous ? { inputTokens: previous.inputTokens + usage.inputTokens,
    outputTokens: previous.outputTokens + usage.outputTokens, totalTokens: previous.totalTokens + usage.totalTokens } : usage);
}

export function reportedProviderUsage(signal: AbortSignal): ProviderTokenUsage | undefined {
  const value = reported.get(signal);
  return value ? {...value} : undefined;
}
