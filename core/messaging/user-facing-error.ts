import type { TranslationErrorCode } from './errors';

export type SettingsFocus =
  | 'api'
  | 'api-model'
  | 'api-permission'
  | 'vision'
  | 'vision-model'
  | 'vision-permission'
  | 'vision-ocr'
  | 'support';
export type TranslationProviderRole = 'text' | 'vision';

export interface TranslationErrorRecovery {
  showRetry: boolean;
  settingsFocus?: SettingsFocus;
  settingsLabel?: string;
  autoResumeAfterSettings?: boolean;
}

const ERROR_MESSAGES: Record<TranslationErrorCode, string> = {
  EMPTY_SELECTION: '请先选中需要翻译的文本。',
  SELECTION_TOO_LONG: '选中的文本过长，请缩小选择范围。',
  NO_API_KEY: '请先在扩展设置页填写 API Key。',
  API_PERMISSION_REQUIRED: '尚未授权访问当前 API 域名，请打开扩展设置并重新保存或测试连接。',
  API_ENDPOINT_INVALID: '接口地址或兼容路径不可用，请检查 API Base URL。',
  AUTH_FAILED: 'API Key 无效，或当前账号没有访问权限。',
  PAYMENT_REQUIRED: 'API 账户余额或额度不足，请在服务商后台检查用量。',
  MODEL_NOT_FOUND: '当前模型不存在，或 API Key 没有使用该模型的权限。',
  RATE_LIMITED: 'API 请求过于频繁，请稍后再试。',
  REQUEST_TIMEOUT: 'API 响应超时，请检查接口地址和网络后重试。',
  NETWORK_ERROR: '无法连接所配置的 API，请检查接口地址、网络、代理或权限。',
  PROVIDER_ERROR: 'API 拒绝了本次请求，请查看接口详情，并检查模型或请求参数兼容性。',
  EMPTY_RESPONSE: 'API 返回了空结果，请重试。',
  INVALID_RESPONSE: 'API 返回格式异常，请重试或切换模型。',
  LATEX_VALIDATION_FAILED: '模型没有完整保留 LaTeX 结构，结果已被拦截。',
  VISION_NOT_CONFIGURED: '尚未配置 PDF 图像能力。普通文字翻译仍可使用；框选扫描件需要支持图片的模型，“识别本页”需要在设置中配置官方 Qwen / 阿里云百炼。',
  VISION_MODEL_UNSUPPORTED: '当前视觉模型不支持图片输入，请在设置中选择支持图像理解的模型。',
  OCR_NOT_SUPPORTED: '当前接口不能生成可靠的扫描 PDF 文字层；仍可使用框选翻译。坐标 OCR 目前支持官方 Qwen / 阿里云百炼接口。',
  OCR_INVALID_RESPONSE: 'OCR 没有返回可靠的文字坐标，未生成文字层；请调整识别区域或继续使用框选翻译。',
  IMAGE_REGION_INVALID: '框选图片无法处理，请缩小框选范围或重新框选更清晰的区域。',
  UNSUPPORTED_PAGE: '当前页面禁止扩展注入，请在普通网页或 Overleaf 项目页使用。',
  REQUEST_ABORTED: '翻译请求已取消。',
  UNKNOWN_ERROR: '翻译发生未知错误，请重试；若仍失败，请打开设置测试连接。',
};

export function translationErrorMessage(
  code: TranslationErrorCode,
  fallback?: string,
): string {
  const base = ERROR_MESSAGES[code] ?? fallback ?? ERROR_MESSAGES.UNKNOWN_ERROR;
  if (
    fallback &&
    (code === 'PROVIDER_ERROR' ||
      code === 'INVALID_RESPONSE' ||
      code === 'AUTH_FAILED' ||
      code === 'PAYMENT_REQUIRED' ||
      code === 'MODEL_NOT_FOUND' ||
      code === 'RATE_LIMITED') &&
    fallback !== base
  ) {
    return `${base}\n接口详情：${fallback}`;
  }
  return base;
}

/**
 * Manual corrections use REQUEST_ABORTED for optimistic-concurrency failures as
 * well as ordinary cancellation. Preserve the background's actionable Chinese
 * explanation, but never surface an arbitrary/internal English abort message.
 */
export function translationCorrectionErrorMessage(
  code: TranslationErrorCode,
  fallback?: string,
): string {
  if (code !== 'REQUEST_ABORTED') return translationErrorMessage(code, fallback);
  const detail = fallback?.trim();
  return detail && /[\u3400-\u9fff]/u.test(detail)
    ? detail
    : '当前译文已更新，请重新打开修正。';
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

export function translationErrorRecovery(
  code: TranslationErrorCode,
  retryable: boolean,
  role: TranslationProviderRole = 'text',
): TranslationErrorRecovery {
  const providerSettings: { settingsFocus: SettingsFocus; settingsLabel: string } =
    role === 'vision'
      ? { settingsFocus: 'vision', settingsLabel: '检查图像 API' }
      : { settingsFocus: 'api', settingsLabel: '检查 API 配置' };
  if (code === 'NO_API_KEY') {
    return {
      showRetry: false,
      settingsFocus: providerSettings.settingsFocus,
      settingsLabel: role === 'vision' ? '配置图像 API' : '配置 API',
      autoResumeAfterSettings: true,
    };
  }
  if (code === 'API_PERMISSION_REQUIRED') {
    return {
      showRetry: false,
      settingsFocus: role === 'vision' ? 'vision-permission' : 'api-permission',
      settingsLabel: '重新授权 API',
      autoResumeAfterSettings: true,
    };
  }
  if (code === 'API_ENDPOINT_INVALID') {
    return {
      showRetry: false,
      settingsFocus: providerSettings.settingsFocus,
      settingsLabel: role === 'vision' ? '检查图像接口' : '检查接口地址',
      autoResumeAfterSettings: true,
    };
  }
  if (code === 'MODEL_NOT_FOUND') {
    return {
      showRetry: false,
      settingsFocus: role === 'vision' ? 'vision-model' : 'api-model',
      settingsLabel: '检查模型',
      autoResumeAfterSettings: true,
    };
  }
  if (code === 'AUTH_FAILED') {
    return { showRetry: false, ...providerSettings, autoResumeAfterSettings: true };
  }
  if (code === 'PAYMENT_REQUIRED') {
    return { showRetry: true, ...providerSettings };
  }
  if (code === 'VISION_NOT_CONFIGURED') {
    return {
      showRetry: false,
      settingsFocus: 'vision',
      settingsLabel: '配置 PDF 图像',
      autoResumeAfterSettings: true,
    };
  }
  if (code === 'OCR_NOT_SUPPORTED') {
    return {
      showRetry: false,
      settingsFocus: 'vision-ocr',
      settingsLabel: '配置 Qwen OCR',
      autoResumeAfterSettings: true,
    };
  }
  if (code === 'VISION_MODEL_UNSUPPORTED') {
    return {
      showRetry: false,
      settingsFocus: 'vision-model',
      settingsLabel: '检查视觉模型',
      autoResumeAfterSettings: true,
    };
  }
  if (['PROVIDER_ERROR', 'INVALID_RESPONSE', 'EMPTY_RESPONSE'].includes(code)) {
    return {
      // Provider-level automatic retryability and a user explicitly trying
      // again are different decisions. A fresh request can recover from a
      // malformed/empty generation even when the provider retry loop stopped.
      showRetry: true,
      ...providerSettings,
    };
  }
  if (['REQUEST_TIMEOUT', 'NETWORK_ERROR'].includes(code)) {
    return { showRetry: true, ...providerSettings };
  }
  if ([
    'RATE_LIMITED',
    'LATEX_VALIDATION_FAILED',
    'OCR_INVALID_RESPONSE',
  ].includes(code)) {
    return { showRetry: true };
  }
  if (code === 'IMAGE_REGION_INVALID') {
    return { showRetry: false };
  }
  if (code === 'REQUEST_ABORTED') {
    // An explicit cancellation is not retryable. A session restored after the
    // background was interrupted uses the same error code with retryable=true,
    // so keep the recovery action available in that distinct case.
    return { showRetry: retryable };
  }
  if (['EMPTY_SELECTION', 'UNSUPPORTED_PAGE'].includes(code)) {
    return { showRetry: false };
  }
  if (code === 'UNKNOWN_ERROR') {
    return { showRetry: true, settingsFocus: 'support', settingsLabel: '查看诊断' };
  }
  return { showRetry: retryable };
}
