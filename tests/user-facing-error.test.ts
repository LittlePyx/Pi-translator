import { describe, expect, it } from 'vitest';
import {
  runtimeConnectionErrorMessage,
  translationCorrectionErrorMessage,
  translationErrorRecovery,
  translationErrorMessage,
} from '../core/messaging/user-facing-error';

describe('user-facing errors', () => {
  it('keeps safe Chinese stale-correction details from the background', () => {
    const detail = '本句译文已变化，请重新打开修正。';

    expect(translationCorrectionErrorMessage('REQUEST_ABORTED', detail)).toBe(detail);
  });

  it.each([undefined, '', 'The request was replaced by a newer result.'])(
    'uses a safe correction-specific message for missing or English abort details',
    (detail) => {
      const message = translationCorrectionErrorMessage('REQUEST_ABORTED', detail);

      expect(message).toContain('译文已更新');
      expect(message).toContain('重新打开修正');
    },
  );

  it('delegates non-abort errors to the regular translation error mapper', () => {
    const detail = 'provider returned malformed output';

    expect(translationCorrectionErrorMessage('PROVIDER_ERROR', detail)).toBe(
      translationErrorMessage('PROVIDER_ERROR', detail),
    );
  });

  it('provides actionable provider errors', () => {
    expect(translationErrorMessage('PROVIDER_ERROR')).toContain('模型');
    expect(translationErrorMessage('PROVIDER_ERROR')).toContain('请求参数兼容性');
    expect(translationErrorMessage('PROVIDER_ERROR')).not.toContain('接口地址和模型名称');
    expect(translationErrorMessage('NETWORK_ERROR')).toContain('网络');
    expect(translationErrorMessage('API_ENDPOINT_INVALID')).toContain('Base URL');
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
      showRetry: false,
      settingsFocus: 'api',
      settingsLabel: '配置 API',
      autoResumeAfterSettings: true,
    });
    expect(translationErrorRecovery('VISION_NOT_CONFIGURED', false)).toEqual({
      showRetry: false,
      settingsFocus: 'vision',
      settingsLabel: '配置 PDF 图像',
      autoResumeAfterSettings: true,
    });
    expect(translationErrorRecovery('NETWORK_ERROR', false)).toEqual({
      showRetry: true,
      settingsFocus: 'api',
      settingsLabel: '检查 API 配置',
    });
    expect(translationErrorRecovery('AUTH_FAILED', false, 'vision')).toEqual({
      showRetry: false,
      settingsFocus: 'vision',
      settingsLabel: '检查图像 API',
      autoResumeAfterSettings: true,
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
      showRetry: false,
      settingsFocus: 'api-model',
      autoResumeAfterSettings: true,
    });
    expect(translationErrorRecovery('MODEL_NOT_FOUND', false, 'vision')).toMatchObject({
      showRetry: false,
      settingsFocus: 'vision-model',
      autoResumeAfterSettings: true,
    });
    expect(translationErrorRecovery('API_PERMISSION_REQUIRED', false, 'vision')).toMatchObject({
      showRetry: false,
      settingsFocus: 'vision-permission',
      autoResumeAfterSettings: true,
    });
    expect(translationErrorRecovery('OCR_NOT_SUPPORTED', false, 'vision')).toEqual({
      showRetry: false,
      settingsFocus: 'vision-ocr',
      settingsLabel: '配置 Qwen OCR',
      autoResumeAfterSettings: true,
    });
    expect(translationErrorRecovery('IMAGE_REGION_INVALID', true)).toEqual({ showRetry: false });
    expect(translationErrorRecovery('UNSUPPORTED_PAGE', true)).toEqual({ showRetry: false });
    expect(translationErrorRecovery('REQUEST_ABORTED', false)).toEqual({ showRetry: false });
    expect(translationErrorRecovery('REQUEST_ABORTED', true)).toEqual({ showRetry: true });
    expect(translationErrorRecovery('API_ENDPOINT_INVALID', false)).toEqual({
      showRetry: false,
      settingsFocus: 'api',
      settingsLabel: '检查接口地址',
      autoResumeAfterSettings: true,
    });
    expect(translationErrorRecovery('API_ENDPOINT_INVALID', false, 'vision')).toEqual({
      showRetry: false,
      settingsFocus: 'vision',
      settingsLabel: '检查图像接口',
      autoResumeAfterSettings: true,
    });
  });

  it.each([
    ['NO_API_KEY', 'text', 'api'],
    ['NO_API_KEY', 'vision', 'vision'],
    ['AUTH_FAILED', 'text', 'api'],
    ['AUTH_FAILED', 'vision', 'vision'],
    ['MODEL_NOT_FOUND', 'text', 'api-model'],
    ['MODEL_NOT_FOUND', 'vision', 'vision-model'],
    ['API_PERMISSION_REQUIRED', 'text', 'api-permission'],
    ['API_PERMISSION_REQUIRED', 'vision', 'vision-permission'],
    ['API_ENDPOINT_INVALID', 'text', 'api'],
    ['API_ENDPOINT_INVALID', 'vision', 'vision'],
    ['VISION_NOT_CONFIGURED', 'vision', 'vision'],
    ['VISION_MODEL_UNSUPPORTED', 'vision', 'vision-model'],
    ['OCR_NOT_SUPPORTED', 'vision', 'vision-ocr'],
  ] as const)(
    'makes blocking %s/%s recovery settings-only and resumable',
    (code, role, settingsFocus) => {
      expect(translationErrorRecovery(code, true, role)).toMatchObject({
        showRetry: false,
        settingsFocus,
        autoResumeAfterSettings: true,
      });
    },
  );
});
