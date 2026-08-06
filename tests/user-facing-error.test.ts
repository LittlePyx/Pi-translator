import { describe, expect, it } from 'vitest';
import {
  runtimeConnectionErrorMessage,
  translationErrorRecovery,
  translationErrorMessage,
} from '../core/messaging/user-facing-error';

describe('user-facing errors', () => {
  it('provides actionable provider errors', () => {
    expect(translationErrorMessage('PROVIDER_ERROR')).toContain('模型');
    expect(translationErrorMessage('PROVIDER_ERROR')).toContain('请求参数兼容性');
    expect(translationErrorMessage('PROVIDER_ERROR')).not.toContain('接口地址和模型名称');
    expect(translationErrorMessage('NETWORK_ERROR')).toContain('网络');
  });

  it('explains how to fix image-region translation errors', () => {
    expect(translationErrorMessage('VISION_NOT_CONFIGURED')).toContain('普通文字翻译仍可使用');
    expect(translationErrorMessage('VISION_NOT_CONFIGURED')).toContain('官方 Qwen');
    expect(translationErrorMessage('VISION_MODEL_UNSUPPORTED')).toContain('图片输入');
    expect(translationErrorMessage('IMAGE_REGION_INVALID')).toContain('重新框选');
  });

  it('keeps vision-test failure categories actionable and distinct', () => {
    expect(translationErrorMessage('API_PERMISSION_REQUIRED')).toContain('授权');
    expect(translationErrorMessage('AUTH_FAILED')).toContain('API Key');
    expect(translationErrorMessage('PAYMENT_REQUIRED')).toContain('余额');
    expect(translationErrorMessage('NETWORK_ERROR')).toContain('网络');
  });

  it('distinguishes an invalidated extension context', () => {
    expect(
      runtimeConnectionErrorMessage(new Error('Extension context invalidated.')),
    ).toContain('刷新当前网页');
  });

  it('distinguishes a missing page receiver', () => {
    expect(
      runtimeConnectionErrorMessage(
        new Error('Could not establish connection. Receiving end does not exist.'),
      ),
    ).toContain('翻译组件');
  });

  it('routes configuration errors to the exact recovery surface', () => {
    expect(translationErrorRecovery('NO_API_KEY', false)).toEqual({
      showRetry: true,
      settingsFocus: 'api',
      settingsLabel: '配置 API',
    });
    expect(translationErrorRecovery('VISION_NOT_CONFIGURED', false)).toEqual({
      showRetry: true,
      settingsFocus: 'vision',
      settingsLabel: '配置 PDF 图像',
    });
    expect(translationErrorRecovery('NETWORK_ERROR', false)).toEqual({
      showRetry: true,
      settingsFocus: 'api',
      settingsLabel: '检查 API 配置',
    });
    expect(translationErrorRecovery('AUTH_FAILED', false, 'vision')).toEqual({
      showRetry: true,
      settingsFocus: 'vision',
      settingsLabel: '检查图像 API',
    });
    expect(translationErrorRecovery('REQUEST_TIMEOUT', false, 'vision')).toEqual({
      showRetry: true,
      settingsFocus: 'vision',
      settingsLabel: '检查图像 API',
    });
    expect(translationErrorRecovery('INVALID_RESPONSE', false)).toMatchObject({
      showRetry: true,
      settingsFocus: 'api',
    });
    expect(translationErrorRecovery('MODEL_NOT_FOUND', false)).toMatchObject({
      showRetry: true,
      settingsFocus: 'api-model',
    });
    expect(translationErrorRecovery('MODEL_NOT_FOUND', false, 'vision')).toMatchObject({
      settingsFocus: 'vision-model',
    });
    expect(translationErrorRecovery('API_PERMISSION_REQUIRED', false, 'vision')).toMatchObject({
      showRetry: true,
      settingsFocus: 'vision-permission',
    });
    expect(translationErrorRecovery('OCR_NOT_SUPPORTED', false, 'vision')).toEqual({
      showRetry: true,
      settingsFocus: 'vision-ocr',
      settingsLabel: '配置 Qwen OCR',
    });
    expect(translationErrorRecovery('IMAGE_REGION_INVALID', true)).toEqual({ showRetry: false });
    expect(translationErrorRecovery('UNSUPPORTED_PAGE', true)).toEqual({ showRetry: false });
  });
});
