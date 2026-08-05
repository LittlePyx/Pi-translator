import type { TranslationErrorCode } from './errors';

const ERROR_MESSAGES: Record<TranslationErrorCode, string> = {
  EMPTY_SELECTION: '请先选中需要翻译的文本。',
  SELECTION_TOO_LONG: '选中的文本过长，请缩小选择范围。',
  NO_API_KEY: '请先在扩展设置页填写 API Key。',
  API_PERMISSION_REQUIRED: '尚未授权访问当前 API 域名，请打开扩展设置并重新保存或测试连接。',
  AUTH_FAILED: 'API Key 无效，或当前账号没有访问权限。',
  PAYMENT_REQUIRED: 'API 账户余额或额度不足，请在服务商后台检查用量。',
  MODEL_NOT_FOUND: '当前模型不存在，或 API Key 没有使用该模型的权限。',
  RATE_LIMITED: 'API 请求过于频繁，请稍后再试。',
  REQUEST_TIMEOUT: 'API 响应超时，请检查接口地址和网络后重试。',
  NETWORK_ERROR: '无法连接所配置的 API，请检查接口地址、网络、代理或权限。',
  PROVIDER_ERROR: 'API 拒绝了本次请求，请确认接口地址和模型名称可用。',
  EMPTY_RESPONSE: 'API 返回了空结果，请重试。',
  INVALID_RESPONSE: 'API 返回格式异常，请重试或切换模型。',
  LATEX_VALIDATION_FAILED: '模型没有完整保留 LaTeX 结构，结果已被拦截。',
  VISION_NOT_CONFIGURED: '请先在扩展设置中选择视觉翻译 API，并填写视觉模型。',
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
