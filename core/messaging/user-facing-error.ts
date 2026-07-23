import type { TranslationErrorCode } from './errors';

const ERROR_MESSAGES: Record<TranslationErrorCode, string> = {
  EMPTY_SELECTION: '请先选中需要翻译的文本。',
  SELECTION_TOO_LONG: '选中的文本过长，请缩小选择范围。',
  NO_API_KEY: '请先在扩展设置页填写 DeepSeek API Key。',
  AUTH_FAILED: 'DeepSeek API Key 无效或没有访问权限。',
  RATE_LIMITED: 'DeepSeek 请求过于频繁，请稍后再试。',
  REQUEST_TIMEOUT: 'DeepSeek 响应超时，请检查网络后重试。',
  NETWORK_ERROR: '无法连接 DeepSeek，请检查网络、代理或防火墙设置。',
  PROVIDER_ERROR: 'DeepSeek 拒绝了本次请求，请确认所选模型仍可用。',
  EMPTY_RESPONSE: 'DeepSeek 返回了空结果，请重试。',
  INVALID_RESPONSE: 'DeepSeek 返回格式异常，请重试或切换模型。',
  LATEX_VALIDATION_FAILED: '模型没有完整保留 LaTeX 结构，结果已被拦截。',
  UNSUPPORTED_PAGE: '当前页面禁止扩展注入，请在普通网页或 Overleaf 项目页使用。',
  REQUEST_ABORTED: '翻译请求已取消。',
  UNKNOWN_ERROR: '翻译发生未知错误，请重试；若仍失败，请打开设置测试连接。',
};

export function translationErrorMessage(
  code: TranslationErrorCode,
  fallback?: string,
): string {
  return ERROR_MESSAGES[code] ?? fallback ?? ERROR_MESSAGES.UNKNOWN_ERROR;
}

export function runtimeConnectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/extension context invalidated/i.test(message)) {
    return '扩展刚刚更新或重新加载，请刷新当前网页后重试。';
  }
  if (/receiving end does not exist|could not establish connection/i.test(message)) {
    return '当前页面的翻译组件尚未就绪，请刷新网页后重试。';
  }
  if (/message port closed|back\/forward cache/i.test(message)) {
    return '扩展后台已重启，请重新触发翻译。';
  }
  return '无法连接扩展后台，请刷新网页；若仍失败，请在扩展管理页重新加载 Pi Translator。';
}
