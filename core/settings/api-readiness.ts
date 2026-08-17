import type { SettingsFocus, TranslationProviderRole } from '../messaging/user-facing-error';
import type { ApiModelCapabilities } from '../translation/api-capability-repository';

export type ApiReadinessTone = 'ready' | 'quiet' | 'issue';

export interface ProviderReadinessSnapshot {
  hasProfile: boolean;
  hasValidBaseUrl: boolean;
  hasModel: boolean;
  hasApiKey: boolean;
  hasPermission: boolean;
  capabilities: ApiModelCapabilities;
}

export interface ApiReadinessStatus {
  role: TranslationProviderRole;
  label: string;
  value: string;
  detail: string;
  tone: ApiReadinessTone;
  settingsFocus: SettingsFocus;
}

function hasObservedTextCapability(capabilities: ApiModelCapabilities): boolean {
  // `false` compatibility hints can be recorded before a fallback request
  // finishes, so they are useful for request shaping but are not proof that a
  // text translation completed. Only positive observations earn “verified”.
  return capabilities.textStreaming === true || capabilities.thinkingControl === true;
}

function blockingStatus(
  role: TranslationProviderRole,
  label: string,
  value: string,
  detail: string,
  settingsFocus: SettingsFocus,
): ApiReadinessStatus {
  return { role, label, value, detail, tone: 'issue', settingsFocus };
}

export function textApiReadiness(snapshot: ProviderReadinessSnapshot): ApiReadinessStatus {
  if (!snapshot.hasProfile || !snapshot.hasValidBaseUrl) {
    return blockingStatus(
      'text',
      '文字翻译',
      '需配置',
      '文字翻译接口尚未完整配置。',
      'api',
    );
  }
  if (!snapshot.hasModel) {
    return blockingStatus(
      'text',
      '文字翻译',
      '缺少模型',
      '请为当前文字 API 选择或填写模型。',
      'api-model',
    );
  }
  if (!snapshot.hasApiKey) {
    return blockingStatus(
      'text',
      '文字翻译',
      '缺少 Key',
      '当前文字 API 没有可用的 API Key。',
      'api',
    );
  }
  if (!snapshot.hasPermission) {
    return blockingStatus(
      'text',
      '文字翻译',
      '待授权',
      '还需允许 Pi Translator 访问当前 API 域名。',
      'api-permission',
    );
  }
  const observed = hasObservedTextCapability(snapshot.capabilities);
  return {
    role: 'text',
    label: '文字翻译',
    value: observed ? '已验证' : '已配置',
    detail: observed
      ? '当前模型已在本浏览器会话中成功使用。'
      : '文字 API、模型、Key 和域名权限均已配置。',
    tone: 'ready',
    settingsFocus: 'api',
  };
}

export function visionApiReadiness(
  snapshot: ProviderReadinessSnapshot | undefined,
): ApiReadinessStatus {
  if (!snapshot?.hasProfile) {
    return {
      role: 'vision',
      label: '图像翻译',
      value: '按需配置',
      detail: '普通文字翻译可继续使用；网页区域、扫描 PDF 或公式图像需要视觉 API。',
      tone: 'quiet',
      settingsFocus: 'vision',
    };
  }
  if (!snapshot.hasValidBaseUrl) {
    return blockingStatus(
      'vision',
      '图像翻译',
      '检查配置',
      '视觉 API 的接口地址无效。文字翻译不受影响。',
      'vision',
    );
  }
  if (!snapshot.hasModel) {
    return blockingStatus(
      'vision',
      '图像翻译',
      '缺少模型',
      '请为网页区域与 PDF 图像识别选择支持图片输入的模型。',
      'vision-model',
    );
  }
  if (!snapshot.hasApiKey) {
    return blockingStatus(
      'vision',
      '图像翻译',
      '缺少 Key',
      '视觉 API 没有可用的 API Key。普通文字翻译不受影响。',
      'vision',
    );
  }
  if (!snapshot.hasPermission) {
    return blockingStatus(
      'vision',
      '图像翻译',
      '待授权',
      '还需允许 Pi Translator 访问视觉 API 域名。',
      'vision-permission',
    );
  }
  if (snapshot.capabilities.vision === false) {
    return blockingStatus(
      'vision',
      '图像翻译',
      '不支持图片',
      '当前模型已被确认不支持图片输入。文字翻译不受影响。',
      'vision-model',
    );
  }
  if (snapshot.capabilities.vision === true) {
    return {
      role: 'vision',
      label: '图像翻译',
      value: '已验证',
      detail: '当前模型已在本浏览器会话中通过图片输入测试。',
      tone: 'ready',
      settingsFocus: 'vision',
    };
  }
  return {
    role: 'vision',
    label: '图像翻译',
    value: '待验证',
    detail: '视觉 API 已配置，但尚未在本会话中确认图片输入能力。',
    tone: 'quiet',
    settingsFocus: 'vision-permission',
  };
}
