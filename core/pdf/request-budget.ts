import type { ProviderTokenUsage } from '../translation/provider-usage';
import { usageSourceKey, type ModelReportedUsage, type UsageSource } from '../translation/cost-estimate';
export interface PdfRequestUsage { text: number; vision: number; ocr: number; reportedTokens?: ProviderTokenUsage; byModel?: ModelReportedUsage[] }
export const emptyPdfRequestUsage = (): PdfRequestUsage => ({ text: 0, vision: 0, ocr: 0 });
export function validPdfRequestLimit(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000;
}
export function validPdfRequestUsage(value: unknown): value is PdfRequestUsage {
  if (!value || typeof value !== 'object') return false;
  const usage = value as Record<string, unknown>;
  const tokens = usage.reportedTokens as Record<string, unknown> | undefined;
  return ['text', 'vision', 'ocr'].every((key) => Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0) &&
    (tokens === undefined || (tokens !== null && typeof tokens === 'object' &&
      ['inputTokens','outputTokens','totalTokens'].every((key) => Number.isSafeInteger(tokens[key]) && Number(tokens[key]) >= 0))) &&
    (usage.byModel === undefined || (Array.isArray(usage.byModel) && usage.byModel.length <= 100 && usage.byModel.every((item) => {
      if (!item || typeof item !== 'object' || typeof item.apiBaseUrl !== 'string' || typeof item.model !== 'string' || item.model.length > 200) return false;
      try { usageSourceKey(item); } catch { return false; }
      return ['inputTokens','outputTokens','totalTokens'].every((key) => Number.isSafeInteger(item[key]) && item[key] >= 0);
    })));
}
export function addPdfReportedTokens(usage: PdfRequestUsage, value: ProviderTokenUsage | undefined, source?: UsageSource): void {
  if (!value) return;
  const previous = usage.reportedTokens;
  usage.reportedTokens = previous ? { inputTokens: previous.inputTokens + value.inputTokens,
    outputTokens: previous.outputTokens + value.outputTokens, totalTokens: previous.totalTokens + value.totalTokens } : {...value};
  if (!source) return;
  const byModel = usage.byModel ??= [];
  const model = byModel.find((candidate) => usageSourceKey(candidate) === usageSourceKey(source));
  if (model) {
    model.inputTokens += value.inputTokens; model.outputTokens += value.outputTokens; model.totalTokens += value.totalTokens;
  } else byModel.push({...source, ...value});
}
export function consumePdfRequest(usage: PdfRequestUsage, kind: 'text' | 'vision' | 'ocr', limit: number): void {
  if (limit > 0 && usage.text + usage.vision + usage.ocr >= limit) {
    throw Object.assign(new Error(`已达到 ${limit} 次任务请求上限；可提高上限后继续。`), { code: 'REQUEST_BUDGET_REACHED' });
  }
  usage[kind] += 1;
}
