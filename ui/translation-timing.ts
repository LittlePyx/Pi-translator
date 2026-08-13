export interface TranslationCompletionTiming {
  cached?: boolean;
  latencyMs?: number;
}

export function formatTranslationDuration(latencyMs: number | undefined): string | undefined {
  if (latencyMs === undefined || !Number.isFinite(latencyMs) || latencyMs <= 0) return undefined;
  const roundedMs = Math.round(latencyMs);
  return roundedMs < 1_000
    ? `${roundedMs} 毫秒`
    : `${(roundedMs / 1_000).toFixed(1)} 秒`;
}

export function formatTranslationClockTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(timestamp);
}

export function translationCompletionStatus(timing: TranslationCompletionTiming): string {
  if (timing.cached) return '会话缓存';
  return formatTranslationDuration(timing.latencyMs) ?? '已完成';
}
