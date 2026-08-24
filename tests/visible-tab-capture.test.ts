import { describe, expect, it } from 'vitest';
import { visibleTabCaptureFailure } from '../core/selection/visible-tab-capture';

describe('visible tab capture failures', () => {
  it('reports a missing optional grant as an actionable permission error', () => {
    const failure = visibleTabCaptureFailure(
      new Error('Either the <all_urls> or activeTab permission is required.'),
      false,
    );

    expect(failure.code).toBe('WEB_CAPTURE_PERMISSION_REQUIRED');
    expect(failure.retryable).toBe(true);
    expect(failure.message).toContain('activeTab');
  });

  it('still recognizes a permission failure when a stale grant was reported', () => {
    const failure = visibleTabCaptureFailure(
      new Error(
        "The 'activeTab' permission is not in effect because this extension has not been invoked.",
      ),
      true,
    );

    expect(failure.code).toBe('WEB_CAPTURE_PERMISSION_REQUIRED');
  });

  it('preserves a non-permission capture failure without mislabeling it', () => {
    const failure = visibleTabCaptureFailure(new Error('The tab was discarded.'), true);

    expect(failure.code).toBe('UNKNOWN_ERROR');
    expect(failure.message).toBe('The tab was discarded.');
  });
});
