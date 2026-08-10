import type { TranslationProgressStage as RemoteTranslationProgressStage } from '../core/messaging/messages';

export type TranslationProgressStage = RemoteTranslationProgressStage | 'rendering';

export type TranslationProgressFeedbackKind = 'waiting' | 'receiving' | 'slow';

export interface TranslationProgressIdentity {
  requestId: string;
  revisionKey: string | number;
}

export interface TranslationProgressFeedback {
  requestId: string;
  revisionKey: string | number;
  stage: TranslationProgressStage;
  kind: TranslationProgressFeedbackKind;
  message: string;
}

export interface TranslationProgressStageOptions {
  /** The provider has already yielded user-visible translated content. */
  hasPartial?: boolean;
}

export const TRANSLATION_PROGRESS_MESSAGES = {
  provider: {
    waiting: '正在请求模型…',
    receiving: '正在接收译文…',
    slow: '模型响应较慢，仍在等待…',
  },
  'validating-latex': {
    waiting: '正在校验公式…',
    slow: '公式校验较慢，仍在处理…',
  },
  committing: {
    waiting: '正在整理结果…',
    slow: '结果整理较慢，仍在处理…',
  },
  rendering: {
    waiting: '正在渲染公式…',
    slow: '公式渲染较慢，仍在处理…',
  },
} as const;

export const TRANSLATION_PROGRESS_STAGE_DELAY_MS = 600;
export const TRANSLATION_PROGRESS_SLOW_DELAY_MS = 8_000;

type ProgressTimer = ReturnType<typeof setTimeout>;
type FeedbackCallback = (feedback: TranslationProgressFeedback) => void;

interface ActiveProgress {
  identity: TranslationProgressIdentity;
  identityKey: string;
  startedAt: number;
  stage: TranslationProgressStage;
  stageRevision: number;
  providerReceiving: boolean;
}

function identityKey(identity: TranslationProgressIdentity): string {
  return `${identity.requestId}\u0000${typeof identity.revisionKey}:${String(identity.revisionKey)}`;
}

function sameIdentity(active: ActiveProgress | undefined, identity: TranslationProgressIdentity): boolean {
  return active?.identityKey === identityKey(identity);
}

/**
 * Pure timing controller shared by the in-page overlay and Edge PDF side panel.
 * It owns no DOM and deliberately keeps translation content out of its state.
 */
export class TranslationProgressFeedbackController {
  private active: ActiveProgress | undefined;
  private stageTimer: ProgressTimer | undefined;
  private slowTimer: ProgressTimer | undefined;
  private disposed = false;

  constructor(private readonly onFeedback: FeedbackCallback) {}

  begin(
    identity: TranslationProgressIdentity,
    initialStage: TranslationProgressStage = 'provider',
    options: TranslationProgressStageOptions = {},
  ): void {
    if (this.disposed) {
      return;
    }
    this.cancelTimers();
    this.active = {
      identity: { ...identity },
      identityKey: identityKey(identity),
      startedAt: Date.now(),
      stage: initialStage,
      stageRevision: 0,
      providerReceiving: false,
    };
    this.scheduleCurrentStage(options);
  }

  enterStage(
    identity: TranslationProgressIdentity,
    stage: TranslationProgressStage,
    options: TranslationProgressStageOptions = {},
  ): void {
    if (this.disposed || !sameIdentity(this.active, identity)) {
      return;
    }
    const active = this.active;
    if (!active) {
      return;
    }

    if (active.stage === stage) {
      if (stage === 'provider' && options.hasPartial) {
        this.providerPartial(identity);
      }
      return;
    }

    this.cancelTimers();
    active.stage = stage;
    active.stageRevision += 1;
    active.providerReceiving = false;
    this.scheduleCurrentStage(options);
  }

  providerPartial(identity: TranslationProgressIdentity): void {
    if (this.disposed || !sameIdentity(this.active, identity)) {
      return;
    }
    const active = this.active;
    if (!active || active.stage !== 'provider' || active.providerReceiving) {
      return;
    }

    active.providerReceiving = true;
    this.clearStageTimer();
    this.emit(active, 'receiving');
  }

  finish(identity: TranslationProgressIdentity): void {
    if (!sameIdentity(this.active, identity)) {
      return;
    }
    this.cancelTimers();
    this.active = undefined;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelTimers();
    this.active = undefined;
  }

  private scheduleCurrentStage(options: TranslationProgressStageOptions): void {
    const active = this.active;
    if (!active) {
      return;
    }
    const expectedIdentity = active.identityKey;
    const expectedStageRevision = active.stageRevision;

    if (active.stage === 'provider' && options.hasPartial) {
      active.providerReceiving = true;
      this.emit(active, 'receiving');
    } else {
      this.stageTimer = setTimeout(() => {
        const current = this.active;
        if (
          !current
          || current.identityKey !== expectedIdentity
          || current.stageRevision !== expectedStageRevision
          || (current.stage === 'provider' && current.providerReceiving)
        ) {
          return;
        }
        this.stageTimer = undefined;
        this.emit(current, 'waiting');
      }, TRANSLATION_PROGRESS_STAGE_DELAY_MS);
    }

    const elapsed = Math.max(0, Date.now() - active.startedAt);
    const remaining = Math.max(0, TRANSLATION_PROGRESS_SLOW_DELAY_MS - elapsed);
    this.slowTimer = setTimeout(() => {
      const current = this.active;
      if (
        !current
        || current.identityKey !== expectedIdentity
        || current.stageRevision !== expectedStageRevision
      ) {
        return;
      }
      this.slowTimer = undefined;
      this.emit(current, 'slow');
    }, remaining);
  }

  private emit(active: ActiveProgress, kind: TranslationProgressFeedbackKind): void {
    const messages = TRANSLATION_PROGRESS_MESSAGES[active.stage];
    const message = kind === 'receiving'
      ? TRANSLATION_PROGRESS_MESSAGES.provider.receiving
      : messages[kind];
    try {
      this.onFeedback({
        requestId: active.identity.requestId,
        revisionKey: active.identity.revisionKey,
        stage: active.stage,
        kind,
        message,
      });
    } catch {
      // Presentation callbacks must never interrupt translation or later timers.
    }
  }

  private clearStageTimer(): void {
    if (this.stageTimer !== undefined) {
      clearTimeout(this.stageTimer);
      this.stageTimer = undefined;
    }
  }

  private cancelTimers(): void {
    this.clearStageTimer();
    if (this.slowTimer !== undefined) {
      clearTimeout(this.slowTimer);
      this.slowTimer = undefined;
    }
  }
}
