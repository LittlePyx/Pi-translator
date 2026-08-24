import { TranslationError } from '../messaging/errors';

export function visibleTabCaptureFailure(
  error: unknown,
  hasPersistentWebCaptureAccess: boolean,
): TranslationError {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  const permissionFailure =
    !hasPersistentWebCaptureAccess ||
    /activeTab|permission|not been invoked|cannot access/i.test(detail);
  return new TranslationError(
    permissionFailure ? 'WEB_CAPTURE_PERMISSION_REQUIRED' : 'UNKNOWN_ERROR',
    detail || 'Visible tab capture failed.',
    true,
    { cause: error },
  );
}
