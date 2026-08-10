import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRANSLATION_PROGRESS_MESSAGES,
  TranslationProgressFeedbackController,
  type TranslationProgressFeedback,
  type TranslationProgressIdentity,
} from '../ui/translation-progress-feedback';

const FIRST: TranslationProgressIdentity = { requestId: 'request-1', revisionKey: 0 };
const SECOND: TranslationProgressIdentity = { requestId: 'request-2', revisionKey: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-09T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('translation progress feedback controller', () => {
  it('waits through 599 ms and publishes the ordinary stage message at 600 ms', () => {
    const feedback: TranslationProgressFeedback[] = [];
    const controller = new TranslationProgressFeedbackController((event) => feedback.push(event));
    controller.begin(FIRST);

    vi.advanceTimersByTime(599);
    expect(feedback).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(feedback).toEqual([{
      ...FIRST,
      stage: 'provider',
      kind: 'waiting',
      message: TRANSLATION_PROGRESS_MESSAGES.provider.waiting,
    }]);
  });

  it('publishes the slow hint at 8,000 ms rather than 7,999 ms', () => {
    const callback = vi.fn();
    const controller = new TranslationProgressFeedbackController(callback);
    controller.begin(FIRST, 'validating-latex');

    vi.advanceTimersByTime(7_999);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'waiting' }));

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith({
      ...FIRST,
      stage: 'validating-latex',
      kind: 'slow',
      message: TRANSLATION_PROGRESS_MESSAGES['validating-latex'].slow,
    });
  });

  it('does not flash feedback when a request finishes quickly', () => {
    const callback = vi.fn();
    const controller = new TranslationProgressFeedbackController(callback);
    controller.begin(FIRST);
    vi.advanceTimersByTime(590);
    controller.finish(FIRST);
    vi.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels old stage timers and retains the total eight-second deadline', () => {
    const callback = vi.fn();
    const controller = new TranslationProgressFeedbackController(callback);
    controller.begin(FIRST);
    vi.advanceTimersByTime(500);
    controller.enterStage(FIRST, 'validating-latex');

    vi.advanceTimersByTime(100);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'validating-latex',
      kind: 'waiting',
    }));

    vi.advanceTimersByTime(6_899);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'validating-latex',
      kind: 'slow',
    }));
  });

  it('shows receiving immediately and repeated provider partials do not reset timing', () => {
    const callback = vi.fn();
    const controller = new TranslationProgressFeedbackController(callback);
    controller.begin(FIRST);
    vi.advanceTimersByTime(300);

    controller.providerPartial(FIRST);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenLastCalledWith({
      ...FIRST,
      stage: 'provider',
      kind: 'receiving',
      message: TRANSLATION_PROGRESS_MESSAGES.provider.receiving,
    });

    vi.advanceTimersByTime(2_000);
    controller.enterStage(FIRST, 'provider', { hasPartial: true });
    controller.providerPartial(FIRST);
    expect(callback).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5_699);
    expect(callback).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'slow' }));
  });

  it('can begin with an existing provider partial without waiting 600 ms', () => {
    const callback = vi.fn();
    const controller = new TranslationProgressFeedbackController(callback);
    controller.begin(FIRST, 'provider', { hasPartial: true });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ kind: 'receiving' }));
    vi.advanceTimersByTime(600);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('ignores callbacks and finish signals from an older request', () => {
    const callback = vi.fn();
    const controller = new TranslationProgressFeedbackController(callback);
    controller.begin(FIRST);
    vi.advanceTimersByTime(500);
    controller.begin(SECOND, 'committing');

    controller.providerPartial(FIRST);
    controller.finish(FIRST);
    vi.advanceTimersByTime(100);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({
      ...SECOND,
      stage: 'committing',
      kind: 'waiting',
      message: TRANSLATION_PROGRESS_MESSAGES.committing.waiting,
    });
  });

  it('treats a new revision of the same request as a different active identity', () => {
    const callback = vi.fn();
    const controller = new TranslationProgressFeedbackController(callback);
    const newer = { requestId: FIRST.requestId, revisionKey: 1 };
    controller.begin(FIRST);
    vi.advanceTimersByTime(300);
    controller.begin(newer, 'rendering');
    controller.enterStage(FIRST, 'committing');
    controller.finish(FIRST);
    vi.advanceTimersByTime(600);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({
      ...newer,
      stage: 'rendering',
      kind: 'waiting',
      message: TRANSLATION_PROGRESS_MESSAGES.rendering.waiting,
    });
  });

  it('dispose invalidates every pending timer and later operation', () => {
    const callback = vi.fn();
    const controller = new TranslationProgressFeedbackController(callback);
    controller.begin(FIRST);
    controller.dispose();
    controller.begin(SECOND);
    controller.enterStage(FIRST, 'rendering');
    vi.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains callback failures and continues with later feedback', () => {
    const callback = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('presentation failed');
      })
      .mockImplementation(() => undefined);
    const controller = new TranslationProgressFeedbackController(callback);
    controller.begin(FIRST);

    expect(() => vi.advanceTimersByTime(600)).not.toThrow();
    expect(() => vi.advanceTimersByTime(7_400)).not.toThrow();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'slow' }));
  });
});
