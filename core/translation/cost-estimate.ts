import { normalizeApiBaseUrl } from '../settings/api-access';
import type { ProviderTokenUsage } from './provider-usage';

export interface UsageSource { apiBaseUrl: string; model: string }
export interface ModelTokenPrice extends UsageSource {
  currency: 'CNY' | 'USD';
  inputPerMillion: number;
  outputPerMillion: number;
}
export interface ModelReportedUsage extends UsageSource, ProviderTokenUsage {}

export function normalizeModelPrices(value: unknown): ModelTokenPrice[] {
  if (!Array.isArray(value)) return [];
  const prices = new Map<string, ModelTokenPrice>();
  for (const candidate of value.slice(0, 30)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as ModelTokenPrice;
    if (typeof item.model !== 'string' || !item.model.trim() || item.model.length > 200 ||
      !['CNY', 'USD'].includes(item.currency) ||
      ![item.inputPerMillion, item.outputPerMillion].every((number) =>
        typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1_000_000)) continue;
    try {
      const price = { apiBaseUrl: normalizeApiBaseUrl(item.apiBaseUrl), model: item.model.trim(),
        currency: item.currency, inputPerMillion: item.inputPerMillion, outputPerMillion: item.outputPerMillion };
      prices.set(usageSourceKey(price), price);
    } catch { /* Ignore malformed imported prices without affecting API settings. */ }
  }
  return [...prices.values()];
}

export function usageSourceKey(source: UsageSource): string {
  return JSON.stringify([normalizeApiBaseUrl(source.apiBaseUrl), source.model.trim()]);
}
export function findModelPrice(prices: readonly ModelTokenPrice[], source: UsageSource): ModelTokenPrice | undefined {
  return prices.find((price) => usageSourceKey(price) === usageSourceKey(source));
}
export function tokenCost(usage: Pick<ProviderTokenUsage, 'inputTokens' | 'outputTokens'>, price: ModelTokenPrice): number {
  return (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) / 1_000_000;
}
export function reportedCost(usages: readonly ModelReportedUsage[], prices: readonly ModelTokenPrice[]): {
  amounts: Partial<Record<ModelTokenPrice['currency'], number>>; unpricedModels: string[];
} {
  const amounts: Partial<Record<ModelTokenPrice['currency'], number>> = {};
  const unpriced = new Set<string>();
  for (const usage of usages) {
    const price = findModelPrice(prices, usage);
    if (!price) { unpriced.add(usage.model); continue; }
    amounts[price.currency] = (amounts[price.currency] ?? 0) + tokenCost(usage, price);
  }
  return { amounts, unpricedModels: [...unpriced] };
}

/** A deliberately broad character-based range, excluding prompts, images and retries. */
export function roughTextCost(characters: number, price: ModelTokenPrice): [number, number] {
  const low = Math.ceil(Math.max(0, characters) / 4);
  const high = Math.ceil(Math.max(0, characters));
  return [tokenCost({inputTokens: low, outputTokens: low}, price),
    tokenCost({inputTokens: high, outputTokens: high * 2}, price)];
}
export function formatCost(amount: number, currency: ModelTokenPrice['currency']): string {
  return `${currency === 'CNY' ? '¥' : '$'}${amount.toFixed(6)}`;
}
