import type { ViewportRect } from '../core/selection/types';
import type {
  TranslateResult,
  TranslationCorrectionReceipt,
  TranslationCorrectionTermInput,
  TranslationHistoryEntry,
  TranslationMemoryScope,
  TranslationSegment,
  TranslationStyle,
  TranslationRevisionKind,
  TranslationRevisionScope,
  ScopedGlossaryTerm,
  PdfSourceLocation,
} from '../core/translation/types';
import {
  applyManualCorrection,
  createManualCorrectionDraft,
  createManualCorrectionSession,
  ManualCorrectionError,
  type ManualCorrectionEdit,
} from '../core/translation/manual-correction';
import type { SidebarMode, SidebarSide } from '../core/settings/schema';
import {
  documentMemoryTranslationResult,
  type DocumentMemorySnapshot,
  type DocumentMemoryTranslation,
} from '../core/document/document-memory-repository';
import { detectPageTheme } from '../core/theme/page-theme';
import { containsRenderableLatex } from '../core/translation/latex-display';
import { validateImageFormulaResult } from '../core/translation/formula-output-validation';
import type { SettingsFocus } from '../core/messaging/user-facing-error';
import type {
  RuntimeMessage,
  SettingsRecoveryRequest,
  TranslationProgressStage as RemoteTranslationProgressStage,
} from '../core/messaging/messages';
import {
  renderTranslationContent,
  renderTranslationContents,
  type TranslationContentTarget,
  type TranslationRenderPerformance,
} from './translation-content';
import type {
  TranslationMarkerLocationState,
  TranslationMarkerSummary,
} from '../core/content/session-translation-markers';
import {
  normalizeFormulaLatexForClipboard,
  normalizeLatexForClipboard,
} from './latex-copy';
import {
  shouldFollowStreamPreview,
  TRANSLATION_PROGRESS_MESSAGES,
  TranslationProgressFeedbackController,
  type TranslationProgressFeedback,
  type TranslationProgressIdentity,
} from './translation-progress-feedback';
import { formatTranslationClockTime, formatTranslationDuration } from './translation-timing';
import { searchTranslationHistory } from './translation-history-search';
import {
  summarizeTranslationVersionChange,
  translationVersionLabel,
  translationVersionScopeLabel,
  type TranslationVersionChangeSummary,
} from './translation-version-summary';
import {
  documentReviewButtonLabel,
  documentReviewDescription,
  summarizeDocumentReviews,
} from './document-review-summary';
import { normalizedSpeechLanguage, selectLocalSpeechVoice } from './local-speech';

function normalizeResultForPresentation(
  result: TranslateResult,
  normalizeFormulaPresentation: boolean,
): TranslateResult {
  if (result.sourceKind !== 'image-region' && !normalizeFormulaPresentation) return result;
  const normalized: TranslateResult = {
    ...result,
    originalText: normalizeLatexForClipboard(result.originalText),
    translatedText: normalizeLatexForClipboard(result.translatedText),
    ...(result.formulaLatex
      ? { formulaLatex: result.formulaLatex.map(normalizeFormulaLatexForClipboard) }
      : {}),
    ...(result.alignedSegments
      ? {
          alignedSegments: result.alignedSegments.map((segment) => ({
            ...segment,
            originalText: normalizeLatexForClipboard(segment.originalText),
            translatedText: normalizeLatexForClipboard(segment.translatedText),
          })),
        }
      : {}),
  };
  if (result.sourceKind !== 'image-region' || !normalized.formulaNeedsReview) return normalized;
  const validation = validateImageFormulaResult({
    recognizedText: normalized.originalText,
    translatedText: normalized.translatedText,
    formulaLatex: normalized.formulaLatex ?? [],
    uncertainSpans: normalized.uncertainSpans ?? [],
  });
  if (!validation.valid) return normalized;
  return {
    ...normalized,
    formulaNeedsReview: false,
    uncertainSpans: normalized.uncertainSpans?.filter(
      (span) => !span.startsWith('公式 LaTeX 未通过自动校验'),
    ) ?? [],
  };
}

const STYLES = `
  :host {
    all: initial; position:fixed;z-index:2147483647;inset:0;pointer-events:none;
    color-scheme: light; font-family: Inter,"Segoe UI",system-ui,sans-serif;
    --accent:#5959df; --accent2:#06a6c7; --text:#192238; --muted:#65738a;
    --line:#dfe5ef; --soft:#f4f7fb; --surface:rgba(255,255,255,.985); --compact-hit:32px;
    --pi-viewport-top:0px; --pi-viewport-right:0px; --pi-viewport-bottom:0px; --pi-viewport-left:0px;
  }
  :host([data-pi-theme="dark"]) { color-scheme:dark; --text:#edf2f8; --muted:#a9b5c7; --line:#3a465a; --soft:#202938; --surface:rgba(17,24,39,.985); }
  * { box-sizing:border-box; } button,select { font:inherit; } button { cursor:pointer; }
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .trigger-placement{position:fixed;z-index:2147483647;display:flex;align-items:stretch;gap:6px;max-width:min(380px,calc(100vw - var(--pi-viewport-left) - var(--pi-viewport-right) - 24px));pointer-events:none}.trigger-placement .trigger-shell{position:relative;flex:0 0 38px}.selection-preview{display:grid;align-content:center;min-width:0;width:min(308px,calc(100vw - var(--pi-viewport-left) - var(--pi-viewport-right) - 68px));padding:6px 9px;border:1px solid rgba(99,102,241,.16);border-radius:8px;color:var(--muted);background:var(--surface);box-shadow:0 9px 28px rgba(30,41,59,.17);font-size:9.5px;line-height:1.42}.selection-preview-text{overflow:hidden;color:var(--text);text-overflow:ellipsis;white-space:nowrap}.selection-preview-detail{display:flex;align-items:center;gap:7px;min-width:0;margin-top:2px}.selection-preview-warning{flex:1;min-width:0;overflow:hidden;color:#936315;text-overflow:ellipsis;white-space:nowrap}.selection-preview-action{flex:0 0 auto;min-height:22px;padding:0 4px;border:0;border-bottom:1px solid currentColor;border-radius:0;color:var(--accent);background:transparent;font-size:9.5px;font-weight:700;pointer-events:auto}.selection-preview-action:hover{color:#3730a3;background:transparent}:host([data-pi-theme="dark"]) .selection-preview-warning{color:#efd68f}:host([data-pi-theme="dark"]) .selection-preview-action{color:#c4c8ff}
  .trigger-shell { position:fixed;z-index:2147483647;width:38px;height:38px;pointer-events:auto; }
  .trigger { position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid rgba(91,92,226,.23);border-radius:13px;background:var(--surface);box-shadow:0 9px 28px rgba(30,41,59,.21);pointer-events:auto;transition:.16s transform,.16s box-shadow; }
  .trigger:hover { transform:translateY(-2px) scale(1.04);box-shadow:0 13px 33px rgba(30,41,59,.25); }
  .trigger-logo { width:24px;height:21px;object-fit:contain; }.sparkle { position:absolute;right:-4px;top:-5px;color:#f3b526;font-size:11px;transition:.12s opacity; }
  .trigger-dismiss{position:absolute;z-index:2;right:-7px;top:-8px;display:grid;place-items:center;width:19px;height:19px;padding:0;border:1px solid rgba(91,92,226,.2);border-radius:50%;color:var(--muted);background:var(--surface);box-shadow:0 4px 12px rgba(30,41,59,.18);font-size:13px;line-height:1;opacity:0;pointer-events:none;transform:scale(.82);transition:.12s opacity,.12s transform,.12s color}.trigger-shell:hover .trigger-dismiss,.trigger-shell:focus-within .trigger-dismiss{opacity:1;pointer-events:auto;transform:scale(1)}.trigger-shell:hover .sparkle,.trigger-shell:focus-within .sparkle{opacity:0}.trigger-dismiss:hover,.trigger-dismiss:focus-visible{color:var(--accent);outline:2px solid rgba(89,89,223,.24);outline-offset:1px}
  .selection-dismiss-notice{position:fixed;z-index:2147483647;left:50%;bottom:calc(var(--pi-viewport-bottom) + 20px);display:flex;align-items:center;gap:8px;max-width:calc(100vw - var(--pi-viewport-left) - var(--pi-viewport-right) - 24px);min-height:34px;padding:6px 8px 6px 11px;border:1px solid rgba(99,102,241,.18);border-radius:9px;color:var(--muted);background:var(--surface);box-shadow:0 10px 28px rgba(30,41,59,.16);font-size:10.5px;line-height:1.4;pointer-events:auto;transform:translateX(-50%)}.selection-dismiss-notice span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.selection-dismiss-action{flex:0 0 auto;min-height:24px;padding:2px 5px;border:0;border-left:1px solid var(--line);border-radius:0;color:var(--accent);background:transparent;font-size:10px;font-weight:700}.selection-dismiss-action:hover{color:#3730a3;text-decoration:underline}.selection-dismiss-action:disabled{color:var(--muted);cursor:default;text-decoration:none}:host([data-pi-theme="dark"]) .selection-dismiss-action{color:#c4c8ff}
  .surface { position:fixed;z-index:2147483647;container-type:inline-size;color:var(--text);background:var(--surface);border:1px solid rgba(99,102,241,.18);box-shadow:0 25px 70px rgba(15,23,42,.25);backdrop-filter:blur(20px);overflow:auto;scrollbar-width:thin;pointer-events:auto; }
  .surface::before { content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,#4f46e5,#8b5cf6,#06b6d4); }
  .card { width:min(500px,calc(100vw - var(--pi-viewport-left) - var(--pi-viewport-right) - 24px));max-height:min(540px,calc(100vh - var(--pi-viewport-top) - var(--pi-viewport-bottom) - 24px));padding:16px;border-radius:20px; }
  .sidebar { top:calc(var(--pi-viewport-top) + 10px);bottom:calc(var(--pi-viewport-bottom) + 10px);width:min(var(--sidebar-width,390px),calc(100vw - var(--pi-viewport-left) - var(--pi-viewport-right) - 20px));padding:15px;border-radius:18px;max-height:none; }
  .result-surface{display:flex;flex-direction:column;overflow:hidden}.result-surface>.header{flex:0 0 auto}.result-scroll{flex:1 1 auto;min-height:0;padding:0 1px 10px;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain}.result-footer{flex:0 0 auto;column-gap:4px;margin-top:0;background:var(--surface)}.result-footer .copy-action{min-width:72px}
  .sidebar.right { right:calc(var(--pi-viewport-right) + 10px); }.sidebar.left { left:calc(var(--pi-viewport-left) + 10px); }
  .sidebar-resizer { position:absolute;z-index:3;top:0;bottom:0;width:8px;cursor:ew-resize; }.sidebar.right .sidebar-resizer{left:-4px}.sidebar.left .sidebar-resizer{right:-4px}
  .collapsed-tab { position:fixed;z-index:2147483647;top:max(calc(var(--pi-viewport-top) + 8px),38%);display:grid;gap:6px;place-items:center;width:42px;padding:13px 7px;border:1px solid rgba(99,102,241,.24);color:#fff;background:linear-gradient(160deg,#4f46e5,#6f55df);box-shadow:0 14px 34px rgba(31,38,100,.3);pointer-events:auto; }
  .collapsed-tab.right { right:var(--pi-viewport-right);border-radius:13px 0 0 13px; }.collapsed-tab.left { left:var(--pi-viewport-left);border-radius:0 13px 13px 0; }
  .collapsed-tab img { width:22px;height:19px;filter:brightness(0) invert(1); }.collapsed-tab span { writing-mode:vertical-rl;font-size:11px;font-weight:750;letter-spacing:.08em; }
  .header { display:flex;align-items:center;gap:8px;min-height:30px;user-select:none; }.card .header{cursor:grab;touch-action:none}.card.dragging .header{cursor:grabbing}
  .title-wrap { display:flex;align-items:center;gap:8px;min-width:0;margin-right:auto; }.logo{flex:0 0 auto;width:21px;height:18px;object-fit:contain}.title{min-width:0;color:#40506e;font-size:13px;font-weight:780;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.header-tools,.navigation-group{display:flex;align-items:center;gap:2px}.header-tools{flex:0 0 auto}.navigation-group{flex:0 0 auto}
  .live-badge{display:inline-flex;flex:0 0 auto;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;color:#08718b;background:#e7f9fd;font-size:10px;font-weight:750}.live-badge::before{content:"";width:5px;height:5px;border-radius:50%;background:#0ba7c5;box-shadow:0 0 0 3px rgba(11,167,197,.13)}
  .icon { display:grid;place-items:center;width:var(--compact-hit);height:var(--compact-hit);padding:0;border:0;border-radius:8px;color:#5e6a7f;background:transparent;font-size:17px; }.icon:hover{background:var(--soft)}.icon:disabled{opacity:.28;cursor:default}.counter{min-width:35px;color:var(--muted);font-size:10.5px;text-align:center;font-variant-numeric:tabular-nums}
  .pin-action{height:var(--compact-hit);padding:0 8px;border:1px solid var(--line);border-radius:5px;color:#4b5870;background:transparent;font-size:11px;font-weight:680;white-space:nowrap}.pin-action:hover{color:var(--accent);border-color:#b8c0ea;background:var(--soft)}
  .sidebar-region-action{display:inline-flex;align-self:flex-start;align-items:center;gap:7px;max-width:100%;min-height:34px;margin:3px 0 1px;padding:4px 6px;border:0;border-radius:5px;color:var(--muted);background:transparent;text-align:left}.sidebar-region-action:hover{color:var(--accent);background:var(--soft)}.sidebar-region-icon{flex:0 0 auto;width:12px;height:12px;border:1.5px dashed var(--accent);border-radius:2px}.sidebar-region-label{flex:0 0 auto;color:var(--text);font-size:11px;font-weight:680}.sidebar-region-hint{min-width:0;overflow:hidden;color:var(--muted);font-size:10px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
  .result-topline{display:flex;align-items:center;gap:6px;min-height:var(--compact-hit);margin-top:5px}.meta{display:flex;flex:1;flex-wrap:wrap;align-items:center;gap:5px;min-width:0;color:var(--muted);font-size:10.5px}.source-host{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta-dot::before{content:"·";margin-right:5px}.cache-badge{padding:0;color:#16839a;background:transparent;font-weight:650}.source-location{min-height:var(--compact-hit);padding:0 2px;border:0;border-bottom:1px solid transparent;color:var(--muted);background:transparent;font-size:10.5px}.source-location:hover{color:var(--accent);border-bottom-color:currentColor}
  .applied-terms{margin:2px 0;border-block:1px solid var(--line)}.applied-terms>summary{display:flex;align-items:center;gap:6px;min-height:29px;padding:2px 1px;color:var(--muted);cursor:pointer;list-style:none;font-size:9.5px}.applied-terms>summary::-webkit-details-marker{display:none}.applied-terms>summary::before{content:"✓";color:#17816d;font-weight:800}.applied-terms>summary::after{content:"＋";margin-left:auto;color:var(--muted)}.applied-terms[open]>summary::after{content:"−"}.applied-terms>summary:hover{color:var(--accent)}.applied-term-count{color:var(--text);font-weight:700}.applied-term-scope-summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.applied-term-list{display:grid;padding-bottom:5px}.applied-term-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;min-height:31px;padding:4px 1px;border-top:1px solid var(--line)}.applied-term-pair{display:flex;align-items:baseline;gap:5px;min-width:0;font-size:10px}.applied-term-source,.applied-term-target{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.applied-term-source{color:var(--text)}.applied-term-arrow{color:var(--muted)}.applied-term-target{color:var(--accent)}.applied-term-actions{display:flex;align-items:center;gap:4px}.applied-term-scope{color:var(--muted);font-size:8.5px}.applied-term-edit{min-height:var(--compact-hit);padding:0 4px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:9px}.applied-term-edit:hover{color:var(--accent);background:var(--soft)}
  .glossary-review{margin:2px 0;border-block:1px solid var(--line)}.glossary-review>summary{display:flex;align-items:center;gap:6px;min-height:29px;padding:2px 1px;color:var(--muted);cursor:pointer;list-style:none;font-size:9.5px}.glossary-review>summary::-webkit-details-marker{display:none}.glossary-review>summary::before{content:"!";display:grid;place-items:center;width:13px;height:13px;border-radius:50%;color:#8a6516;background:#fff4cf;font-size:8px;font-weight:850}.glossary-review>summary::after{content:"＋";margin-left:auto;color:var(--muted)}.glossary-review[open]>summary::after{content:"−"}.glossary-review>summary:hover{color:var(--accent)}.glossary-review-count{color:#806019;font-weight:700}.glossary-review-intro{padding:5px 1px 7px;color:var(--muted);font-size:9px;line-height:1.5}.glossary-review .applied-term-target{color:#806019}.glossary-review .applied-term-actions{gap:1px}
  .source-badge{color:#4f46e5;font-weight:700}.recognized-source{margin-top:7px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.recognized-source summary{padding:6px 1px;color:var(--muted);cursor:pointer;font-size:10px;list-style:none}.recognized-source summary::-webkit-details-marker{display:none}.recognized-source summary::after{content:"＋";float:right}.recognized-source[open] summary::after{content:"－"}.recognized-content{padding:0 1px 8px}.recognized-text{max-height:150px;color:var(--muted);font-size:11px;line-height:1.65;white-space:pre-wrap;overflow:auto}.formula-latex{max-height:120px;margin:7px 0 0;padding:7px 8px;border-left:2px solid rgba(79,70,229,.42);color:var(--text);background:var(--soft);font:10px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow:auto}.recognized-editor{display:block;width:100%;min-height:92px;max-height:190px;padding:7px;border:1px solid var(--line);border-radius:4px;color:var(--text);background:var(--soft);font-family:inherit;font-size:11px;line-height:1.65;resize:vertical}.recognized-actions{display:flex;align-items:center;gap:4px;margin-top:6px}.recognized-actions button{min-height:var(--compact-hit);padding:3px 7px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:10px}.recognized-actions button:hover{color:var(--accent);background:var(--soft)}.recognized-actions .commit{color:var(--accent);font-weight:680}.uncertain-note{margin-top:7px;color:#85651d;font-size:10px}
  .revision-panel{display:grid;gap:9px;margin-top:8px}.revision-label{display:grid;gap:5px;color:var(--text);font-size:11px;font-weight:680}.revision-editor,.revision-custom textarea{width:100%;padding:8px;border:1px solid var(--line);border-radius:4px;color:var(--text);background:var(--soft);font:11px/1.65 inherit;resize:vertical}.revision-editor{min-height:120px;max-height:300px}.revision-note{margin:0;color:var(--muted);font-size:9.5px;line-height:1.55}.revision-scope{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.revision-scope select{height:25px;padding:0 22px 0 6px;border:1px solid var(--line);border-radius:3px;color:var(--text);background:var(--surface);font-size:10px}.revision-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px}.revision-actions button{flex:none}.revision-status{flex:1;min-width:0;margin-right:auto;color:var(--muted);font-size:9.5px;line-height:1.4;overflow-wrap:anywhere}.revision-status.is-error{color:#a52b36;font-weight:650}.revision-divider{padding-top:9px;border-top:1px solid var(--line);color:var(--muted);font-size:10px;font-weight:650}.revision-choices{display:grid}.revision-choice{padding:7px 2px;border:0;border-bottom:1px solid var(--line);color:var(--text);background:transparent;text-align:left;font-size:11px}.revision-choice::after{content:"›";float:right;color:var(--muted)}.revision-choice:hover{color:var(--accent);background:var(--soft)}.revision-custom{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:end}.revision-custom[hidden]{display:none}.revision-custom textarea{grid-column:1/-1;min-height:68px;max-height:140px}.revision-custom textarea::-webkit-scrollbar{width:5px}.revision-custom textarea::-webkit-scrollbar-track{background:transparent}.revision-custom textarea::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(101,115,138,.48)}.revision-custom textarea::-webkit-scrollbar-button{width:0;height:0}.revision-custom span{color:var(--muted);font-size:9px}.version-counter{min-width:31px;font-size:9px}
  .correction-editor{display:grid;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.correction-text-part{display:block;width:100%;min-height:44px;padding:7px 1px;border:0;border-radius:0;color:var(--text);background:transparent;font:12px/1.65 Inter,"Segoe UI",system-ui,sans-serif;resize:vertical}.correction-text-part:focus{background:var(--soft)}.correction-text-part:only-child{min-height:clamp(96px,22vh,180px)}.correction-latex{padding:7px 1px;border-block:1px solid var(--line);color:var(--text);background:transparent;font:11px/1.55 "Cambria Math","STIX Two Math",ui-monospace,monospace;overflow-x:auto;white-space:pre-wrap}.correction-term-disclosure{border-bottom:1px solid var(--line)}.correction-term-disclosure>summary{padding:7px 1px;color:var(--muted);cursor:pointer;font-size:10px;list-style:none}.correction-term-disclosure>summary::-webkit-details-marker{display:none}.correction-term-disclosure>summary:hover{color:var(--accent)}.correction-term-fields{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 0 8px;border:0;margin:0}.correction-term-fields label{display:grid;gap:3px;color:var(--muted);font-size:9px}.correction-term-fields .correction-term-scope{grid-column:1/-1;grid-template-columns:auto minmax(100px,140px);align-items:center;justify-content:space-between}.correction-term-fields input,.correction-term-fields select{min-width:0;padding:6px 1px;border:0;border-bottom:1px solid var(--line);border-radius:0;color:var(--text);background:transparent;font:11px/1.4 Inter,"Segoe UI",system-ui,sans-serif}.correction-action{min-height:var(--compact-hit);color:var(--muted);border-color:transparent;background:transparent}.correction-action:hover{color:var(--accent);border-color:var(--line);background:var(--soft)}.correction-undo{display:inline-flex;align-items:center;gap:3px;min-width:0;max-width:100%;color:var(--muted);font-size:9.5px}.correction-undo-message{min-width:0;overflow-wrap:anywhere}.correction-undo button{flex:0 0 auto;min-height:var(--compact-hit);padding:0 4px;border:0;color:var(--accent);background:transparent;font-size:9.5px}.correction-undo button:hover{background:var(--soft)}.correction-undo.is-error{color:#a33b30}
  .correction-term-fields input[aria-invalid="true"]{border-bottom-color:#dc2626;box-shadow:0 1px 0 rgba(220,38,38,.18)}
  .correction-term-disclosure.has-value>summary{color:var(--accent);font-weight:650}.correction-term-disclosure.has-error>summary{color:#a52b36;font-weight:650}
  .result-view-controls,.view-switch{display:inline-flex;flex:0 0 auto;align-items:center;gap:2px}.result-view-controls{margin-left:auto}.view-button{min-width:36px;height:var(--compact-hit);padding:0 6px;border:0;border-radius:5px;color:var(--muted);background:transparent;font-size:10.5px;font-weight:680;line-height:1}.view-button:hover{color:var(--text);background:var(--soft)}.view-button.active{color:#4338ca;background:var(--soft);box-shadow:inset 0 -2px 0 rgba(79,70,229,.45)}
  .body { margin-top:8px;font-size:14px;line-height:1.78;white-space:pre-wrap;overflow-wrap:anywhere; }.pi-rich-strong{font-weight:700}.pi-math-inline{display:inline-flex;max-width:100%;vertical-align:-.14em;white-space:normal}.pi-math-display{display:block;width:100%;margin:.72em 0;padding:.08em 0 .12em;overflow-x:auto;overflow-y:hidden;text-align:center;line-height:1.28;white-space:normal}.pi-math-display.pi-math-numbered{display:grid;grid-template-columns:minmax(0,1fr) max-content;grid-template-rows:auto;align-items:center;column-gap:6px;overflow:visible}.pi-math-numbered .pi-math-scroll{grid-row:1;grid-column:1;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;text-align:center;overscroll-behavior-inline:contain}.pi-math-display::-webkit-scrollbar,.pi-math-scroll::-webkit-scrollbar{height:5px}.pi-math-display::-webkit-scrollbar-track,.pi-math-scroll::-webkit-scrollbar-track{background:transparent}.pi-math-display::-webkit-scrollbar-thumb,.pi-math-scroll::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(101,115,138,.48)}.pi-math-display::-webkit-scrollbar-button,.pi-math-scroll::-webkit-scrollbar-button{width:0;height:0}.pi-equation-tag{grid-row:1;grid-column:2;align-self:center;white-space:nowrap;font-family:"Cambria Math","STIX Two Math","Latin Modern Math",serif;font-size:.9em;font-variant-numeric:tabular-nums;line-height:1}.pi-math .katex{color:inherit;font-size:1.02em}.pi-math math{color:inherit;font-family:"Cambria Math","STIX Two Math","Latin Modern Math",serif;font-synthesis:none}.pi-math-display math{font-size:1.06em}.progress{display:grid;align-content:center;min-height:72px;margin-top:8px}.loading{display:flex;align-items:center;gap:10px;padding:10px 0;color:var(--muted);font-size:12px}.spinner{flex:0 0 auto;width:17px;height:17px;border:2px solid #cdd5e5;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}.stream-preview{max-height:300px;margin-top:5px;padding:11px;border-radius:12px;background:var(--soft);font-size:13px;line-height:1.72;white-space:pre-wrap;overflow:auto}.stream-preview[hidden]{display:none}@keyframes spin{to{transform:rotate(360deg)}}
  .lexical-lookup{display:grid;gap:12px;margin-top:8px}.lexical-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--line)}.lexical-source{min-width:0;font-size:20px;font-weight:780;line-height:1.25;overflow-wrap:anywhere}.lexical-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;color:var(--muted);font-size:10px}.lexical-meta span+span::before{content:"·";margin-right:6px}.lexical-speak{display:flex;align-items:center;gap:4px;min-height:var(--compact-hit);padding:0 5px;border:0;border-radius:4px;color:var(--muted);background:transparent;font-size:9.5px}.lexical-speak svg{width:14px;height:14px}.lexical-speak:hover{color:var(--accent);background:var(--soft)}.lexical-speak.active{color:var(--accent)}.lexical-primary{display:grid;gap:4px}.lexical-label{color:var(--muted);font-size:9px;font-weight:700;letter-spacing:.08em}.lexical-meaning{font-size:16px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.lexical-senses{display:grid;border-top:1px solid var(--line)}.lexical-sense{display:grid;grid-template-columns:minmax(48px,auto) minmax(0,1fr);gap:10px;padding:8px 1px;border-bottom:1px solid var(--line);font-size:11px;line-height:1.55}.lexical-sense-pos{color:var(--muted)}.lexical-sense-meaning{color:var(--text);overflow-wrap:anywhere}
  .loading-status{min-width:0;line-height:1.45}.stop-translation{flex:0 0 auto;min-height:var(--compact-hit);margin-left:auto;padding:0 6px;border:0;border-radius:4px;color:var(--muted);background:transparent;font-size:10px;font-weight:650}.stop-translation:hover{color:#b4233b;background:var(--soft)}.stop-translation:disabled{cursor:default;opacity:.58}.stopped-status{margin-top:10px;padding:6px 1px;color:var(--muted);font-size:11px}
  .idle { display:grid;place-items:center;min-height:240px;padding:30px;text-align:center;color:var(--muted); }.idle img{width:42px;height:37px;opacity:.3}.idle strong{margin-top:16px;color:var(--text);font-size:15px}.idle p{max-width:260px;margin:7px 0 0;font-size:12px;line-height:1.65}
  .marker-notes-toolbar{display:flex;align-items:center;gap:8px;margin-top:8px;padding:7px 0;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.marker-notes-toolbar span{margin-right:auto}.marker-notes-toolbar button{min-height:var(--compact-hit);padding:0 6px;border:0;border-radius:3px;color:var(--accent);background:transparent;font-size:10px}.marker-notes-toolbar button:hover{background:var(--soft)}
  .marker-notes-list{display:grid;margin-top:4px}.marker-note{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:9px 1px;border-bottom:1px solid var(--line)}.marker-note-main{display:grid;gap:3px;min-width:0;padding:0;border:0;color:var(--text);background:transparent;text-align:left}.marker-note-main:hover .marker-note-source{color:var(--accent)}.marker-note-meta{display:flex;align-items:center;gap:6px;color:var(--accent);font-size:9px;font-weight:700}.marker-note-status{color:#9a6b17;font-weight:550}.marker-note-source,.marker-note-target{display:-webkit-box;min-width:0;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow-wrap:anywhere}.marker-note-source{font-size:11px;line-height:1.5}.marker-note-target{color:var(--muted);font-size:10px;line-height:1.45}.marker-note.missing .marker-note-main{cursor:default}.marker-note.missing .marker-note-source,.marker-note.missing .marker-note-target{opacity:.62}.marker-note-actions{display:flex;align-items:flex-start;gap:1px}.marker-note-actions button{width:var(--compact-hit);height:var(--compact-hit);padding:0;border:0;border-radius:4px;color:var(--muted);background:transparent;font-size:10px}.marker-note-actions button:hover{color:var(--accent);background:var(--soft)}
  .document-action{height:var(--compact-hit);padding:0 6px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:10px;font-weight:680}.document-action:hover{color:var(--accent);background:var(--soft)}
  .document-meta{margin-top:8px;padding-bottom:8px;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.document-section{margin-top:14px}.document-section-head{display:flex;align-items:center;gap:8px;padding-bottom:5px;border-bottom:1px solid var(--line)}.document-section-head strong{margin-right:auto;color:var(--text);font-size:11px}.document-section-head span{color:var(--muted);font-size:9px}.document-list{display:grid}.document-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;padding:9px 1px;border-bottom:1px solid var(--line)}.document-pair{display:grid;gap:3px;min-width:0}.document-source{color:var(--text);font-size:11px;line-height:1.45;overflow-wrap:anywhere}.document-target{color:var(--muted);font-size:10px;line-height:1.45;overflow-wrap:anywhere}.document-row-actions{display:flex;align-items:start;gap:2px}.document-row-actions button,.document-clear{min-height:var(--compact-hit);padding:0 6px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:9px}.document-row-actions button:hover,.document-clear:hover{color:var(--accent);background:var(--soft)}.document-translation{width:100%;padding:9px 1px;border:0;border-bottom:1px solid var(--line);color:var(--text);background:transparent;text-align:left}.document-translation:hover .document-source{color:var(--accent)}.document-translation .document-source,.document-translation .document-target{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.document-edit{display:grid;grid-template-columns:1fr 1fr auto;gap:5px;align-items:center}.document-edit input{min-width:0;min-height:var(--compact-hit);padding:5px 6px;border:1px solid var(--line);border-radius:3px;color:var(--text);background:var(--soft);font:10px/1.4 inherit}.document-candidate-edit{grid-template-columns:minmax(0,1fr) auto}.document-candidate-edit .document-source{grid-column:1/-1}.document-edit-actions{display:flex;gap:2px}.document-edit-actions button{min-height:var(--compact-hit);padding:0 6px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:9px}.document-edit-actions button:first-child{color:var(--accent);font-weight:680}.document-edit-actions button:hover{background:var(--soft)}.document-empty{padding:12px 1px;color:var(--muted);font-size:10px}.document-footer{display:flex;justify-content:flex-end;margin-top:14px;padding-top:7px;border-top:1px solid var(--line)}
  .document-memory-action.has-review{color:#9a6b17}.document-review-list{display:grid}.document-review-row{display:grid;gap:5px;padding:9px 1px;border-bottom:1px solid var(--line)}.document-review-meta{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:9px}.document-review-meta strong{color:#9a6b17;font-size:9px}.document-review-source{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--text);font-size:11px;line-height:1.48;overflow-wrap:anywhere}.document-review-actions{display:flex;align-items:center;gap:2px}.document-review-actions button{min-height:var(--compact-hit);padding:0 6px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:9px}.document-review-actions button:hover{color:var(--accent);background:var(--soft)}.document-review-actions .review-resolve{margin-left:auto;color:#6e7b91}.document-term-review-intro{padding:6px 1px 2px;color:var(--muted);font-size:9px;line-height:1.5}.document-term-review-pairs{display:grid;gap:3px;min-width:0}.document-term-review-pair{display:flex;align-items:baseline;gap:5px;min-width:0;font-size:9.5px;line-height:1.45}.document-term-review-source,.document-term-review-target{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.document-term-review-source{color:var(--text)}.document-term-review-arrow{flex:0 0 auto;color:var(--muted)}.document-term-review-target{color:#806019}.document-term-review-scope{flex:0 0 auto;color:var(--muted);font-size:8.5px}
  .history-surface{display:flex;flex-direction:column;overflow:hidden}.history-surface>.header{flex:0 0 auto}.history-searchbar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:5px;margin-top:8px;padding-bottom:8px;border-bottom:1px solid var(--line)}.history-search-field{width:100%;min-width:0;height:var(--compact-hit);padding:0 9px;border:1px solid var(--line);border-radius:6px;color:var(--text);background:var(--soft);font:10.5px/1.4 inherit;outline:none}.history-search-field:focus{border-color:rgba(89,89,223,.58);box-shadow:0 0 0 2px rgba(89,89,223,.1)}.history-filter,.history-clear{height:var(--compact-hit);padding:0 7px;border:0;border-radius:5px;color:var(--muted);background:transparent;font-size:9.5px;white-space:nowrap}.history-filter:hover,.history-clear:hover{color:var(--accent);background:var(--soft)}.history-filter.active{color:var(--accent);background:rgba(99,102,241,.09);box-shadow:inset 0 -2px rgba(89,89,223,.68)}.history-summary{padding:7px 1px 4px;color:var(--muted);font-size:9.5px}.history-list{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain}.history-item{display:grid;width:100%;gap:3px;padding:9px 7px;border:0;border-bottom:1px solid var(--line);border-radius:0;color:var(--text);background:transparent;text-align:left}.history-item:hover,.history-item:focus-visible{background:var(--soft)}.history-item.current{box-shadow:inset 2px 0 var(--accent)}.history-item-meta{display:flex;align-items:center;gap:6px;min-width:0;color:var(--muted);font-size:8.5px}.history-item-meta .history-current,.history-item-meta .history-marked{color:var(--accent);font-weight:700}.history-item-source,.history-item-target{display:-webkit-box;min-width:0;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow-wrap:anywhere}.history-item-source{font-size:11px;line-height:1.5}.history-item-target{color:var(--muted);font-size:10px;line-height:1.45}.history-empty{display:grid;place-items:center;gap:7px;min-height:180px;padding:24px;color:var(--muted);text-align:center;font-size:10.5px;line-height:1.6}.history-empty button{min-height:var(--compact-hit);padding:0 8px;border:0;border-radius:5px;color:var(--accent);background:var(--soft);font-size:10px}.history-open{height:var(--compact-hit);padding:0 3px;border:0;border-radius:4px;background:transparent}.history-open:hover{color:var(--accent);background:var(--soft)}
  .version-context{display:flex;flex:0 0 auto;align-items:center;gap:6px;min-height:27px;margin-top:6px;padding:4px 6px;border-left:2px solid rgba(89,89,223,.48);border-radius:0 6px 6px 0;color:var(--muted);background:var(--soft);font-size:9px;line-height:1.4}.version-context-copy{display:flex;flex:1;flex-wrap:wrap;align-items:center;gap:3px 6px;min-width:0}.version-context strong{color:var(--accent);font-size:9.5px}.version-context-detail::before{content:"·";margin-right:6px;color:var(--muted)}.version-locate{flex:0 0 auto;min-height:var(--compact-hit);padding:0 5px;border:0;border-radius:4px;color:var(--accent);background:transparent;font-size:9px;font-weight:650}.version-locate:hover{background:rgba(99,102,241,.09)}
  .aligned-list{display:grid;gap:9px;margin-top:10px}.segment{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;padding:10px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(145deg,rgba(248,250,252,.9),rgba(244,247,252,.64));transition:.15s border-color,.15s box-shadow}.segment:hover,.segment:focus-within{border-color:#aeb9f3;box-shadow:0 5px 18px rgba(73,78,160,.1)}.segment.version-changed{border-color:rgba(89,89,223,.35);box-shadow:inset 2px 0 rgba(89,89,223,.66)}.segment.version-changed .segment-number{box-shadow:0 0 0 2px rgba(89,89,223,.12)}
  .segment-number{display:grid;place-items:center;align-self:start;width:23px;height:23px;border-radius:8px;color:#fff;background:linear-gradient(135deg,var(--accent),#7c5ce5);font-size:10px;font-weight:800}.segment-pair{display:grid;gap:6px;min-width:0}.segment-source-column{display:grid;align-content:start;min-width:0}.segment-source{color:var(--muted);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.segment-source.collapsible:not(.expanded){display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:4}.segment-source.collapsible.expanded{max-height:240px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.segment-source-toggle{justify-self:start;min-height:var(--compact-hit);margin-top:2px;padding:0 3px;border:0;border-radius:3px;color:var(--accent);background:transparent;font-size:9px;font-weight:650}.segment-source-toggle:hover{background:var(--soft)}.segment-target{padding-top:6px;border-top:1px dashed var(--line);font-size:14px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
  .segment-actions{display:flex;gap:5px;margin-top:7px;opacity:.62;transition:.15s opacity}.segment:hover .segment-actions,.segment:focus-within .segment-actions{opacity:1}.mini{min-height:var(--compact-hit);padding:0 8px;border:0;border-radius:6px;color:var(--muted);background:var(--soft);font-size:11px}.mini:hover{color:var(--accent)}
  .segment-correction{display:grid;gap:5px;padding-top:6px;border-top:1px dashed var(--line)}.segment-correction .correction-text-part{min-height:56px;padding:5px 1px}.segment-correction-actions{display:flex;align-items:center;justify-content:flex-end;gap:4px}.segment-correction-actions button{flex:none}.segment-correction-status{flex:1;min-width:0;margin-right:auto;color:var(--muted);font-size:9px;line-height:1.4;overflow-wrap:anywhere}.segment-correction-status.is-error{color:#a52b36;font-weight:650}
  .segment-mark{display:grid;place-items:center;width:var(--compact-hit);height:var(--compact-hit);padding:0;border-radius:4px;background:transparent}.segment-mark svg{width:14px;height:14px}.segment-mark.active{color:var(--accent);background:rgba(99,102,241,.09);box-shadow:inset 0 -2px rgba(89,89,223,.62)}
  @container (min-width:520px){.segment-pair{grid-template-columns:1fr 1fr;gap:12px}.segment-target{padding:0 0 0 12px;border-top:0;border-left:1px dashed var(--line)}}
  @container (max-width:380px){.result-topline:has(.meta):has(.result-view-controls){display:grid;grid-template-columns:minmax(0,1fr);align-items:start;gap:2px}.result-view-controls{justify-self:end;margin-left:0}.segment-source.collapsible.expanded{max-height:180px}}
  .warning,.error{margin-top:10px;padding:9px 11px;border-radius:9px;font-size:12px;white-space:pre-wrap}.warning{color:#725417;background:#fff6dd}.error{color:#a52b36;background:#fff1f2}.partial-result{display:grid;gap:5px;margin-top:10px}.partial-result-label{color:var(--muted);font-size:10px;font-weight:680}.partial-result .stream-preview{margin-top:0}
  .notice{display:grid;gap:7px;margin-top:14px;padding:12px;border:1px solid #f0d898;border-radius:12px;color:#725417;background:#fffaf0;font-size:12px;line-height:1.6}.notice strong{color:var(--text);font-size:13px}
  .footer{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}.action{min-height:var(--compact-hit);padding:4px 9px;border:1px solid #d6dceb;border-radius:5px;color:#26334a;background:#f8f9fc;font-size:11px;font-weight:630}.action:hover{background:#eef2fa}.primary{color:#fff;border-color:var(--accent);background:linear-gradient(135deg,#4f46e5,#6d5ce8)}.copy-action{min-width:80px;color:#fff;border-color:#5145cd;background:#5b4be0;box-shadow:none}.copy-action:hover:not(:disabled){color:#fff;border-color:#4338ca;background:#5145cd}.copy-action[data-state="success"]{border-color:#198267;background:#1d8f71}.copy-action[data-state="error"]{border-color:#b4233b;background:#b4233b}.copy-action:disabled{color:#8a93a4;border-color:#d7dbe4;background:#eef0f5;opacity:1;cursor:wait}.result-reading-nav{display:flex;align-items:center;gap:0;margin-left:auto}.result-reading-nav[hidden]{display:none}.reading-progress{min-width:27px;color:var(--muted);font-size:10px;text-align:center;font-variant-numeric:tabular-nums}.reading-jump{display:grid;place-items:center;width:var(--compact-hit);height:var(--compact-hit);padding:0;border:0;border-radius:4px;color:var(--muted);background:transparent;font-size:14px}.reading-jump:hover:not(:disabled){color:var(--accent);background:var(--soft)}.reading-jump:disabled{opacity:.3;cursor:default}.result-reading-nav:not([hidden])+details.more{margin-left:0}
  .mark-action{display:grid;place-items:center;width:var(--compact-hit);height:var(--compact-hit);padding:0;border:0;border-radius:4px;color:var(--muted);background:transparent;font-size:0}.mark-action svg{width:15px;height:15px}.mark-filter svg{width:16px;height:16px}.mark-action:hover:not(:disabled),.mark-filter:hover{color:var(--accent);background:var(--soft)}.mark-action.active,.mark-filter.active{color:var(--accent);background:rgba(99,102,241,.09);box-shadow:inset 0 -2px rgba(89,89,223,.72)}.mark-action:disabled{opacity:.46;cursor:not-allowed}
  details.more{position:relative;margin-left:auto}details.more>summary{display:grid;place-items:center;width:var(--compact-hit);height:var(--compact-hit);border-radius:4px;color:var(--muted);cursor:pointer;list-style:none;font-size:12px;font-weight:800}details.more>summary:hover{background:var(--soft)}details.more>summary::-webkit-details-marker{display:none}.menu{position:absolute;z-index:5;right:0;bottom:34px;width:220px;max-height:calc(100vh - 32px);padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 16px 40px rgba(15,23,42,.2);overflow-y:auto;overscroll-behavior:contain}.menu::-webkit-scrollbar{width:5px}.menu::-webkit-scrollbar-track{background:transparent}.menu::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(101,115,138,.48)}.menu::-webkit-scrollbar-button{width:0;height:0}.menu.opens-down{top:34px;bottom:auto}.sidebar.left .menu{left:0;right:auto}.menu button{width:100%;min-height:var(--compact-hit);padding:6px 9px;border:0;border-radius:4px;color:var(--text);background:transparent;text-align:left;font-size:11px}.menu button:hover{background:var(--soft)}.menu hr{border:0;border-top:1px solid var(--line);margin:6px 0}.menu label{display:grid;gap:4px;margin:6px;color:var(--muted);font-size:10px}.menu select{width:100%;min-height:var(--compact-hit);padding:5px 6px;border:1px solid var(--line);border-radius:4px;color:var(--text);background:var(--soft);font-size:11px}
  :host([data-pi-theme="dark"]) .logo,:host([data-pi-theme="dark"]) .trigger-logo{filter:brightness(0) invert(1)}:host([data-pi-theme="dark"]) .title{color:#d6deea}:host([data-pi-theme="dark"]) .view-button.active{color:#e4e5ff;background:#273246}:host([data-pi-theme="dark"]) .segment{background:linear-gradient(145deg,rgba(31,41,55,.9),rgba(24,33,47,.72))}:host([data-pi-theme="dark"]) .action{color:#e8edf6;background:#202938;border-color:#465269}:host([data-pi-theme="dark"]) .primary{background:#5b6ee1}:host([data-pi-theme="dark"]) .copy-action{color:#fff;background:#6558dc;border-color:#7367ed}:host([data-pi-theme="dark"]) .copy-action:hover:not(:disabled){color:#fff;background:#7468e4;border-color:#8d83f2}:host([data-pi-theme="dark"]) .copy-action[data-state="success"]{border-color:#2a9b7f;background:#237e68}:host([data-pi-theme="dark"]) .copy-action[data-state="error"]{border-color:#d95664;background:#a83242}:host([data-pi-theme="dark"]) .copy-action:disabled{color:#777f8e;border-color:#333b4a;background:#202734}:host([data-pi-theme="dark"]) .warning{color:#f1d68e;background:#463b20}:host([data-pi-theme="dark"]) .error{color:#ff9aa4;background:#32171d}:host([data-pi-theme="dark"]) .cache-badge{color:#8de7f7;background:transparent}:host([data-pi-theme="dark"]) .correction-action{color:var(--muted);background:transparent;border-color:transparent}:host([data-pi-theme="dark"]) .correction-action:hover,:host([data-pi-theme="dark"]) .correction-undo button:hover{color:#c4c8ff;background:var(--soft)}
  :host([data-pi-theme="dark"]) .stop-translation:hover{color:#ff9aa4;background:var(--soft)}:host([data-pi-theme="dark"]) .pi-math-display::-webkit-scrollbar-thumb,:host([data-pi-theme="dark"]) .pi-math-scroll::-webkit-scrollbar-thumb,:host([data-pi-theme="dark"]) .revision-custom textarea::-webkit-scrollbar-thumb,:host([data-pi-theme="dark"]) .menu::-webkit-scrollbar-thumb{background:rgba(169,181,199,.48)}
  :host([data-pi-theme="dark"]) .applied-terms>summary::before{color:#71d6bd}:host([data-pi-theme="dark"]) .applied-term-target{color:#c4c8ff}
  :host([data-pi-theme="dark"]) .glossary-review>summary::before{color:#f1d68e;background:#493d20}:host([data-pi-theme="dark"]) .glossary-review-count,:host([data-pi-theme="dark"]) .glossary-review .applied-term-target{color:#f1d68e}
  @media(max-width:340px){.result-footer:has(.result-reading-nav:not([hidden])) .result-reading-nav{order:20;flex:1 0 100%;justify-content:flex-end;margin-left:0}.result-footer:has(.result-reading-nav:not([hidden])) details.more{margin-left:auto}}
  @media(max-width:420px){.card.menu-open{min-height:min(360px,calc(100vh - var(--pi-viewport-top) - var(--pi-viewport-bottom) - 24px))}.correction-term-fields,.document-edit{grid-template-columns:minmax(0,1fr)}.document-edit-actions{justify-content:flex-end}.revision-scope select,.revision-choice{min-height:var(--compact-hit)}.revision-custom textarea{min-height:96px}.revision-actions{position:sticky;bottom:0;padding:6px 0;background:var(--surface)}.footer .correction-undo.is-error{flex:1 0 100%;order:10;align-items:flex-start;padding-top:4px;border-top:1px solid var(--line);line-height:1.45}.sidebar .header:has(.header-tools.dense-navigation){flex-wrap:wrap;gap:4px}.sidebar .header:has(.header-tools.dense-navigation) .title-wrap{display:none}.sidebar .header-tools.dense-navigation{flex:1 0 100%;width:100%;flex-wrap:wrap;justify-content:flex-end;row-gap:2px}.sidebar .header-tools.dense-navigation .version-navigation{order:10}}
  :host([data-pi-theme="dark"]) .live-badge{color:#8de7f7;background:#173b44}:host([data-pi-theme="dark"]) .notice{color:#f1d68e;background:#3c321c;border-color:#655326}
  :host([data-pi-theme="dark"]) .sidebar-region-action:hover{color:#c4c8ff;background:var(--soft)}
  :host([data-pi-theme="dark"]) .document-memory-action.has-review,:host([data-pi-theme="dark"]) .document-review-meta strong,:host([data-pi-theme="dark"]) .document-term-review-target{color:#f1d68e}:host([data-pi-theme="dark"]) .document-review-actions .review-resolve{color:var(--muted)}:host([data-pi-theme="dark"]) .correction-undo.is-error,:host([data-pi-theme="dark"]) .segment-correction-status.is-error,:host([data-pi-theme="dark"]) .revision-status.is-error,:host([data-pi-theme="dark"]) .correction-term-disclosure.has-error>summary{color:#ff9aa4}:host([data-pi-theme="dark"]) .correction-term-fields input[aria-invalid="true"]{border-bottom-color:#ff9aa4;box-shadow:0 1px 0 rgba(255,154,164,.22)}
  .marker-note.missing .marker-note-main{cursor:pointer}.marker-note-actions button[data-confirm-delete="true"],.menu button[data-confirm-clear="true"],.document-clear[data-confirm-clear="true"]{color:#a33b30;background:#fff4f2}:host([data-pi-theme="dark"]) .marker-note-actions button[data-confirm-delete="true"],:host([data-pi-theme="dark"]) .menu button[data-confirm-clear="true"],:host([data-pi-theme="dark"]) .document-clear[data-confirm-clear="true"]{color:#ff9aa4;background:rgba(127,29,29,.22)}
  button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,.segment:focus-visible{outline:2px solid #6366f1;outline-offset:2px}.result-scroll:focus-visible{outline:2px solid rgba(99,102,241,.56);outline-offset:-2px;border-radius:10px}
  .recognized-text{overflow-wrap:anywhere}.recognized-text::-webkit-scrollbar,.formula-latex::-webkit-scrollbar,.recognized-editor::-webkit-scrollbar,.segment-source::-webkit-scrollbar{width:5px;height:5px}.recognized-text::-webkit-scrollbar-track,.formula-latex::-webkit-scrollbar-track,.recognized-editor::-webkit-scrollbar-track,.segment-source::-webkit-scrollbar-track{background:transparent}.recognized-text::-webkit-scrollbar-thumb,.formula-latex::-webkit-scrollbar-thumb,.recognized-editor::-webkit-scrollbar-thumb,.segment-source::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(101,115,138,.48)}.recognized-text::-webkit-scrollbar-button,.formula-latex::-webkit-scrollbar-button,.recognized-editor::-webkit-scrollbar-button,.segment-source::-webkit-scrollbar-button{width:0;height:0}:host([data-pi-theme="dark"]) .recognized-text::-webkit-scrollbar-thumb,:host([data-pi-theme="dark"]) .formula-latex::-webkit-scrollbar-thumb,:host([data-pi-theme="dark"]) .recognized-editor::-webkit-scrollbar-thumb,:host([data-pi-theme="dark"]) .segment-source::-webkit-scrollbar-thumb{background:rgba(169,181,199,.48)}
  .applied-terms>summary,.glossary-review>summary,.recognized-source summary,.revision-note,.revision-status,.correction-undo,.correction-undo button,.lexical-meta,.lexical-speak,.marker-notes-toolbar,.document-meta,.history-filter,.history-clear,.history-summary,.history-item-meta,.version-context,.version-context strong,.version-locate,.partial-result-label{font-size:10.5px}.applied-term-scope,.document-term-review-scope{font-size:10px}.menu label{font-size:11px}.menu button,.menu select{font-size:11.5px}
  @media(hover:none),(pointer:coarse){.segment-actions{opacity:1}}
  @media(prefers-contrast:more){:host{--line:#8d99aa;--muted:#455166;--compact-hit:36px}.surface{border-color:#6e78b7}.meta,.sidebar-region-hint,.sidebar-region-label{color:var(--text)}button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,.segment:focus-visible{outline-width:3px}:host([data-pi-theme="dark"]){--line:#8390a3;--muted:#d2d9e5}}
  @media(max-width:620px){.sidebar{top:calc(var(--pi-viewport-top) + 8px)!important;right:calc(var(--pi-viewport-right) + 8px)!important;bottom:calc(var(--pi-viewport-bottom) + 8px)!important;left:calc(var(--pi-viewport-left) + 8px)!important;width:auto!important}.sidebar-resizer{display:none}.icon{width:var(--compact-hit);height:var(--compact-hit)}.view-button{height:var(--compact-hit)}.source-location{min-height:var(--compact-hit)}.stop-translation{padding:0 8px;border:1px solid var(--line);border-radius:6px;font-size:11px}.recognized-source summary{display:flex;align-items:center;min-height:var(--compact-hit)}.recognized-source summary::after{float:none;margin-left:auto}.segment-actions{opacity:1}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

export interface OverlayPreferences {
  targetLanguage: string;
  style: TranslationStyle;
  sidebarMode: SidebarMode;
  sidebarSide: SidebarSide;
  sidebarWidth: number;
  autoRenderLatex: boolean;
}

export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ViewportInsetsProvider = () => Partial<ViewportInsets>;

export interface TranslationOverlayOptions {
  viewportInsets?: ViewportInsetsProvider;
  normalizeFormulaPresentation?: boolean;
}

export interface SelectionTriggerPreview {
  text: string;
  warning?: string;
  actionLabel?: string;
  onAction?: () => void;
  suppressAutoTranslate?: boolean;
}

interface ErrorDisplay {
  message: string;
  showSettings: boolean;
  retryable?: boolean;
  webRegionRecovery?: boolean;
  partialText?: string | undefined;
  settingsFocus?: SettingsFocus;
  settingsLabel?: string;
  settingsRecovery?: SettingsRecoveryRequest;
}
interface OverlayProgressState {
  requestId: string;
  revisionKey: number;
  partialText?: string;
  completedChunks: number;
  totalChunks: number;
  progressStage: RemoteTranslationProgressStage;
}
export interface TranslationAdjustmentRequest {
  kind: Exclude<TranslationRevisionKind, 'manual'>;
  label: string;
  instruction: string;
  scope: TranslationRevisionScope;
}
export type OverlayRetryTarget =
  | { kind: 'failed' }
  | {
      kind: 'result';
      result: TranslateResult;
      intent: 'repeat' | 'language-change';
    };
interface OverlayActions {
  onTranslate: () => void;
  onRetry: (target: OverlayRetryTarget) => void;
  onTranslateText: (text: string) => void;
  onStartWebRegion?: () => void;
  canAdjustWebRegion?: (result: TranslateResult) => boolean;
  onAdjustWebRegion?: (result?: TranslateResult) => void;
  onReselectWebRegion?: (result?: TranslateResult) => void;
  onAdjustTranslation?: (
    result: TranslateResult,
    adjustment: TranslationAdjustmentRequest,
  ) => void;
  onSaveTranslationEdit?: (
    result: TranslateResult,
    translatedText: string,
    scope: TranslationMemoryScope,
    term?: TranslationCorrectionTermInput,
  ) => Promise<{
    result: TranslateResult;
    history: TranslationHistoryEntry[];
    correctionReceipt?: TranslationCorrectionReceipt;
  }>;
  onSaveSegmentTranslationEdit?: (
    result: TranslateResult,
    segmentId: string,
    expectedTranslatedText: string,
    correctedTranslatedText: string,
  ) => Promise<{
    result: TranslateResult;
    history: TranslationHistoryEntry[];
    correctionReceipt?: TranslationCorrectionReceipt;
  }>;
  onUndoTranslationEdit?: (
    result: TranslateResult,
    receipt: TranslationCorrectionReceipt,
  ) => Promise<{
    result: TranslateResult;
    history: TranslationHistoryEntry[];
    termRollbackSkipped?: boolean;
  }>;
  onAdjustPdfRegion?: () => void;
  onNavigateToPdfRegion?: (sourceLocation: PdfSourceLocation) => void;
  canMarkSource?: (result: TranslateResult, segment?: TranslationSegment) => boolean;
  isSourceMarked?: (result: TranslateResult, segment?: TranslationSegment) => boolean;
  hasSourceMarksForResult?: (result: TranslateResult) => boolean;
  hasAnySourceMarks?: () => boolean;
  onToggleSourceMark?: (result: TranslateResult, segment?: TranslationSegment) => boolean;
  onCopyMarkedNotes?: () => Promise<number>;
  canPersistSourceMarks?: () => boolean;
  isSourceMarkPersistenceEnabled?: () => boolean;
  hasStoredSourceMarks?: () => boolean;
  onSetSourceMarkPersistence?: (enabled: boolean) => Promise<void>;
  onClearSourceMarks?: () => Promise<void>;
  getSourceMarkSummaries?: () => TranslationMarkerSummary[];
  onNavigateSourceMark?: (markerId: string) => Promise<TranslationMarkerLocationState>;
  onRemoveSourceMark?: (markerId: string) => Promise<void>;
  onGetDocumentMemory?: () => Promise<DocumentMemorySnapshot>;
  onConfirmDocumentTerm?: (candidateId: string) => Promise<DocumentMemorySnapshot>;
  onUpsertDocumentTerm?: (term: { id?: string; source: string; target: string }) => Promise<DocumentMemorySnapshot>;
  onRemoveDocumentTerm?: (termId: string) => Promise<DocumentMemorySnapshot>;
  onDismissDocumentTermCandidate?: (candidateId: string) => Promise<DocumentMemorySnapshot>;
  onResolveDocumentReview?: (reviewId: string) => Promise<DocumentMemorySnapshot>;
  canRetryDocumentReview?: (entry: DocumentMemoryTranslation) => boolean;
  onRetryDocumentReview?: (entry: DocumentMemoryTranslation) => void;
  onClearDocumentMemory?: () => Promise<DocumentMemorySnapshot>;
  onOpenSettings: (
    focus?: SettingsFocus,
    recovery?: SettingsRecoveryRequest,
  ) => Promise<boolean>;
  onPauseSite?: () => Promise<void>;
  onOpenBrowserSidebar?: (
    result: TranslateResult,
    options?: { persistPreference?: boolean },
  ) => Promise<void>;
  onSidebarChange: (active: boolean) => void;
  onSidebarWidthChange: (width: number) => void;
  onSidebarLayoutChange: (expanded: boolean, side: SidebarSide, width: number) => void;
  onPreferencesChange: (preferences: Pick<OverlayPreferences, 'targetLanguage' | 'style'>) => void;
  onStop: () => void;
  onDismiss: () => void;
  onDismissTrigger?: () => void;
}

type OverlayView = 'hidden' | 'trigger' | 'notice' | 'card' | 'sidebar' | 'sidebar-collapsed';
interface Position { left:number;top:number; }
interface ResultReadingPosition { scrollTop:number;progress:number;segmentId?:string;segmentOffset?:number; }

const LANGUAGES = [
  ['zh-CN','简体中文'],['en','English'],['ja','日本語'],['de','Deutsch'],['fr','Français'],
] as const;

export class TranslationOverlay {
  private readonly host = document.createElement('div');
  private readonly root: ShadowRoot;
  private readonly resultFeedback: HTMLSpanElement;
  private readonly logoUrl = browser.runtime.getURL('/brand/pi_logo.png');
  private view: OverlayView = 'hidden';
  private sidebarActive = false;
  private sidebarCollapsed = false;
  private markerNavigatorActive = false;
  private historyNavigatorActive = false;
  private documentMemoryActive = false;
  private documentMemory?: DocumentMemorySnapshot;
  private documentMemoryError: string | undefined = undefined;
  private documentMemoryRequestRevision = 0;
  private editingDocumentTermId: string | 'new' | undefined = undefined;
  private documentTermFocusSource: string | undefined = undefined;
  private editingDocumentCandidateId: string | undefined = undefined;
  private sidebarWidth = 390;
  private preferences: OverlayPreferences = { targetLanguage:'zh-CN', style:'academic', sidebarMode:'floating', sidebarSide:'right', sidebarWidth:390, autoRenderLatex:true };
  private lastRect?: ViewportRect;
  private cardPosition: Position | undefined;
  private currentResult?: TranslateResult;
  private latestRequestId?: string;
  private history: TranslationHistoryEntry[] = [];
  private historyIndex = -1;
  private alignedView = false;
  private readonly resultVersions = new Map<string, TranslateResult[]>();
  private readonly latexViewOverrides = new Map<string, boolean>();
  private readonly resultViewModes = new Map<string, boolean>();
  private readonly lexicalViewModes = new Map<string, boolean>();
  private readonly resultReadingPositions = new Map<string, ResultReadingPosition>();
  private readingRestoreRevision = 0;
  private readonly expandedAlignedSources = new Set<string>();
  private markedOnly = false;
  private historySearchQuery = '';
  private themeObserver?: MutationObserver;
  private colorSchemeQuery?: MediaQueryList;
  private themeTimer?: ReturnType<typeof setTimeout>;
  private readonly viewportInsetsProvider: ViewportInsetsProvider | undefined;
  private readonly normalizeFormulaPresentation: boolean;
  private viewportInsets: ViewportInsets = {top:0,right:0,bottom:0,left:0};
  private surfaceResizeObserver: ResizeObserver | undefined;
  private reflowFrame: number | undefined;
  private progressState: OverlayProgressState | undefined;
  private correctionUndo: TranslationCorrectionReceipt | undefined;
  private translationEpoch = 0;
  private resultRenderRevision = 0;
  private activeFeedbackIdentity: TranslationProgressIdentity | undefined;
  private progressFeedback: TranslationProgressFeedback | undefined;
  private readonly progressFeedbackController = new TranslationProgressFeedbackController(
    (feedback) => this.applyProgressFeedback(feedback),
  );
  private readonly buttonFeedbackTimers = new WeakMap<HTMLButtonElement, number>();
  private readonly recordedRenderPerformance = new Set<string>();
  private activeSpeechRequestId: string | undefined;
  private cardReturnFocus: HTMLElement | undefined;
  private focusNextSurface = false;
  private triggerNoticeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly actions: OverlayActions,
    options: TranslationOverlayOptions = {},
  ) {
    this.viewportInsetsProvider=options.viewportInsets;
    this.normalizeFormulaPresentation=options.normalizeFormulaPresentation === true;
    this.host.id = 'tex-selection-translator-root';
    this.root = this.host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=STYLES;this.resultFeedback=document.createElement('span');this.resultFeedback.className='sr-only result-feedback';this.resultFeedback.setAttribute('role','status');this.resultFeedback.setAttribute('aria-live','polite');this.resultFeedback.setAttribute('aria-atomic','true');this.root.append(style,this.resultFeedback);
    document.documentElement.append(this.host);this.refreshViewportInsets();this.setView('hidden');this.trackTheme();
    window.addEventListener('keydown',this.onKeyDown,true);
    document.addEventListener('pointerdown',this.onDocumentPointerDown,true);
    window.addEventListener('resize',this.onViewportChange,{passive:true});
    window.addEventListener('scroll',this.onViewportChange,true);
    window.visualViewport?.addEventListener('resize',this.onViewportChange);
    window.visualViewport?.addEventListener('scroll',this.onViewportChange);
  }

  setPreferences(preferences: OverlayPreferences): void { const sidebarModeChanged=this.preferences.sidebarMode!==preferences.sidebarMode;this.preferences={...preferences};this.sidebarWidth=preferences.sidebarWidth;this.publishSidebarLayout();if(sidebarModeChanged&&this.view==='card'&&this.currentResult&&!this.progressState)this.renderResult(this.currentResult);else this.scheduleReflow(); }
  isSidebarActive(): boolean { return this.sidebarActive; }
  isShowingCard(): boolean { return this.view==='card'||this.view==='sidebar'; }
  ownsCurrentSelection(): boolean {
    const anchor = document.getSelection()?.anchorNode;
    return Boolean(anchor && anchor.getRootNode() === this.root);
  }

  openSidebar(): void {
    this.markerNavigatorActive=false;this.historyNavigatorActive=false;this.documentMemoryActive=false;this.sidebarActive=true;this.sidebarCollapsed=false;this.actions.onSidebarChange(true);
    if(this.progressState)this.renderProgress();else if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle();
    this.refreshDocumentMemory(true);
  }

  restoreSidebar(): void {
    if(!this.sidebarActive)return;
    this.sidebarCollapsed=false;
    if(this.progressState)this.renderProgress();else if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle();
  }

  showTrigger(rect:ViewportRect,preview?:SelectionTriggerPreview):void {
    if(this.sidebarActive)return;if(!this.progressState)this.finishActiveProgressFeedback();this.resultFeedback.textContent='';this.lastRect=rect;this.cardPosition=undefined;const active=document.activeElement;this.cardReturnFocus=active instanceof HTMLElement&&active!==this.host&&active!==document.body&&active!==document.documentElement?active:undefined;this.clear();
    const button=this.button('', 'trigger','翻译选中的文本');const sparkle=document.createElement('span');sparkle.className='sparkle';sparkle.textContent='✦';
    button.append(this.logo('trigger-logo'),sparkle);button.addEventListener('pointerdown',e=>e.preventDefault());button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')this.focusNextSurface=true});button.addEventListener('click',this.actions.onTranslate);
    const shell=document.createElement('div');shell.className='trigger-shell';shell.append(button);if(this.actions.onPauseSite){const dismiss=this.button('×','trigger-dismiss','隐藏本次划词提示');dismiss.addEventListener('pointerdown',event=>event.preventDefault());dismiss.addEventListener('click',event=>{event.stopPropagation();this.dismissTrigger()});shell.append(dismiss)}
    this.refreshViewportInsets();if(preview?.text){const placement=document.createElement('div');placement.className='trigger-placement';const summary=document.createElement('div');summary.className='selection-preview';summary.setAttribute('aria-label','发送前选区预览');const text=document.createElement('div');text.className='selection-preview-text';text.textContent=preview.text;text.title=preview.text;summary.append(text);if(preview.warning||(preview.actionLabel&&preview.onAction)){const detail=document.createElement('div');detail.className='selection-preview-detail';if(preview.warning){const warning=document.createElement('div');warning.className='selection-preview-warning';warning.textContent=preview.warning;warning.title=preview.warning;detail.append(warning)}if(preview.actionLabel&&preview.onAction){const action=this.button(preview.actionLabel,'selection-preview-action',preview.actionLabel);action.addEventListener('pointerdown',event=>event.preventDefault());action.addEventListener('click',()=>{this.hide();preview.onAction?.()});detail.append(action)}summary.append(detail)}placement.append(summary,shell);this.root.append(placement);this.place(placement,rect);this.observeSize(placement)}else{this.root.append(shell);this.place(shell,rect);this.observeSize(shell)}this.setView('trigger');
  }

  showLoading(requestId:string,rect?:ViewportRect):void {
    this.translationEpoch+=1;this.correctionUndo=undefined;this.markerNavigatorActive=false;this.historyNavigatorActive=false;this.documentMemoryActive=false;this.resultFeedback.textContent='';if(rect)this.lastRect=rect;if(this.sidebarActive)this.sidebarCollapsed=false;
    const identity={requestId,revisionKey:this.translationEpoch};
    this.progressState={requestId,revisionKey:identity.revisionKey,completedChunks:0,totalChunks:1,progressStage:'provider'};
    this.beginProgressFeedback(identity,'provider');this.renderProgress();
  }

  showProgress(requestId:string,partialText:string|undefined,completedChunks:number,totalChunks:number,progressStage?:RemoteTranslationProgressStage):void {
    const previous=this.progressState;
    const isCurrent=previous?.requestId===requestId;
    const revisionKey=isCurrent?previous.revisionKey:++this.translationEpoch;
    const nextStage=progressStage??(isCurrent?previous.progressStage:'provider');
    const retainedPartial=partialText||(isCurrent?previous.partialText:undefined);
    const identity={requestId,revisionKey};
    const stageChanged=isCurrent&&previous.progressStage!==nextStage;
    this.progressState={requestId,revisionKey,...(retainedPartial?{partialText:retainedPartial}:{}),completedChunks,totalChunks,progressStage:nextStage};
    if(!isCurrent){this.beginProgressFeedback(identity,nextStage,Boolean(retainedPartial))}
    else if(stageChanged){this.progressFeedback=undefined;this.progressFeedbackController.enterStage(identity,nextStage,{hasPartial:Boolean(retainedPartial)&&nextStage==='provider'})}
    else if(nextStage==='provider'&&retainedPartial){this.progressFeedbackController.providerPartial(identity)}
    const status=this.root.querySelector<HTMLElement>('.loading-status');if(status)status.textContent=this.progressStatus(this.progressState);const preview=this.root.querySelector<HTMLElement>('.stream-preview');if(preview&&this.progressState.partialText){const followOutput=preview.hidden||shouldFollowStreamPreview(preview);preview.hidden=false;preview.textContent=this.progressState.partialText;if(followOutput)preview.scrollTop=preview.scrollHeight}else if(!this.sidebarCollapsed&&!this.root.querySelector('.progress'))this.renderProgress()
  }

  showSensitiveNotice(rect?:ViewportRect):void { this.finishActiveProgressFeedback();this.markerNavigatorActive=false;this.historyNavigatorActive=false;this.documentMemoryActive=false;this.progressState=undefined;this.resultFeedback.textContent='';if(rect)this.lastRect=rect;const surface=this.surface('连续翻译');const notice=document.createElement('div');notice.className='notice';const title=document.createElement('strong');title.textContent='已跳过敏感输入区域';const text=document.createElement('span');text.textContent='检测到密码、验证码或支付字段，内容没有发送到翻译 API。手动右键翻译仍由你决定。';notice.append(title,text);surface.append(notice);this.showSurface(surface); }

  showResult(result:TranslateResult,rect?:ViewportRect,history:TranslationHistoryEntry[]=[],alignedByDefault=false):void {
    this.finishActiveProgressFeedback();this.markerNavigatorActive=false;this.historyNavigatorActive=false;this.documentMemoryActive=false;this.progressState=undefined;if(rect)this.lastRect=rect;this.currentResult=result;this.latestRequestId=result.requestId;this.history=history;
    if(result.documentId&&this.documentMemory?.documentId!==result.documentId)delete this.documentMemory;
    this.rememberResultVersion(result);
    this.historyIndex=history.findIndex(entry=>entry.requestId===result.requestId);this.alignedView=this.rememberedAlignedView(result,alignedByDefault);this.rememberResultViewMode(result,this.alignedView);
    if(this.sidebarActive)this.sidebarCollapsed=false;this.renderResult(result,true);
  }

  refreshDocumentMemory(force=false):void {
    if(!this.actions.onGetDocumentMemory)return;
    if(!force&&!this.sidebarActive&&!this.documentMemoryActive)return;
    const requestRevision=++this.documentMemoryRequestRevision;
    void this.actions.onGetDocumentMemory().then((memory)=>{
      if(requestRevision!==this.documentMemoryRequestRevision)return;
      const currentDocumentId=this.currentResult?.documentId;
      if(currentDocumentId&&memory.documentId!==currentDocumentId){this.documentTermFocusSource=undefined;return}
      this.documentMemory=memory;this.documentMemoryError=undefined;
      if(this.documentMemoryActive){this.renderDocumentMemory();this.documentTermFocusSource=undefined}else this.updateDocumentMemoryButton();
    }).catch((error:unknown)=>{
      if(requestRevision!==this.documentMemoryRequestRevision||!this.documentMemoryActive)return;
      this.documentMemoryError=error instanceof Error?error.message:'无法读取本文记忆';this.renderDocumentMemory();this.documentTermFocusSource=undefined;
    });
  }

  updateHistory(history:TranslationHistoryEntry[]):void {
    this.history=history;
    this.historyIndex=this.currentResult
      ? history.findIndex(entry=>entry.requestId===this.currentResult?.requestId)
      : -1;
    if(this.historyNavigatorActive){
      this.renderHistoryNavigator();
    }else if(this.currentResult&&!this.progressState&&this.isShowingCard()){
      this.renderResult(this.currentResult);
    }
  }

  private resultRootRequestId(result:TranslateResult):string {
    return result.revision?.rootRequestId??result.requestId;
  }

  private rememberedAlignedView(result:TranslateResult,fallback=false):boolean {
    return Boolean(result.alignedSegments?.length)&&(this.resultViewModes.get(result.requestId)??fallback);
  }

  private rememberResultViewMode(result:TranslateResult,alignedView:boolean):void {
    this.resultViewModes.delete(result.requestId);
    this.resultViewModes.set(result.requestId,Boolean(result.alignedSegments?.length)&&alignedView);
    while(this.resultViewModes.size>48){const oldest=this.resultViewModes.keys().next().value as string|undefined;if(!oldest)break;this.resultViewModes.delete(oldest)}
  }

  private resultReadingPositionKey(result:TranslateResult,alignedView=this.alignedView):string {
    return `${result.requestId}:${alignedView?'aligned':'full'}`;
  }

  private rememberResultReadingPosition(key:string,scroll:HTMLElement):void {
    const maximum=Math.max(0,scroll.scrollHeight-scroll.clientHeight);const position:ResultReadingPosition={scrollTop:scroll.scrollTop,progress:maximum?scroll.scrollTop/maximum:0};
    const scrollBounds=scroll.getBoundingClientRect();const segment=[...scroll.querySelectorAll<HTMLElement>('.segment')].find(candidate=>candidate.getBoundingClientRect().bottom>scrollBounds.top+1);const segmentId=segment?.dataset.segmentId;if(segment&&segmentId){position.segmentId=segmentId;position.segmentOffset=segment.getBoundingClientRect().top-scrollBounds.top}
    this.resultReadingPositions.delete(key);
    this.resultReadingPositions.set(key,position);
    while(this.resultReadingPositions.size>96){const oldest=this.resultReadingPositions.keys().next().value as string|undefined;if(!oldest)break;this.resultReadingPositions.delete(oldest)}
  }

  private rememberVisibleResultReadingPosition():void {
    const scroll=this.root.querySelector<HTMLElement>('.result-scroll');
    const key=scroll?.dataset.readingKey;
    if(scroll&&key)this.rememberResultReadingPosition(key,scroll);
  }

  private restoreResultReadingPosition(result:TranslateResult,alignedView=this.alignedView):void {
    const key=this.resultReadingPositionKey(result,alignedView);const position=this.resultReadingPositions.get(key);if(!position)return;const revision=++this.readingRestoreRevision;
    const restore=():boolean=>{if(revision!==this.readingRestoreRevision||this.currentResult?.requestId!==result.requestId||this.alignedView!==alignedView)return true;const scroll=this.root.querySelector<HTMLElement>('.result-scroll');if(scroll?.dataset.readingKey!==key)return true;const row=position.segmentId?[...scroll.querySelectorAll<HTMLElement>('.segment')].find(candidate=>candidate.dataset.segmentId===position.segmentId):undefined;if(row&&position.segmentOffset!==undefined){const scrollBounds=scroll.getBoundingClientRect();scroll.scrollTop+=row.getBoundingClientRect().top-scrollBounds.top-position.segmentOffset;const remaining=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop;return Math.abs(row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-position.segmentOffset)<.5||remaining<.5}const maximum=Math.max(0,scroll.scrollHeight-scroll.clientHeight);const target=maximum?position.progress*maximum:position.scrollTop;scroll.scrollTop=target;return Math.abs(scroll.scrollTop-target)<.5};
    restore();queueMicrotask(restore);let attempts=0;const settle=()=>{if(restore()||attempts>=12)return;attempts+=1;requestAnimationFrame(settle)};requestAnimationFrame(settle);
  }

  private restoreVisibleResultReadingPosition():void { if(this.currentResult&&this.root.querySelector('.result-scroll'))this.restoreResultReadingPosition(this.currentResult) }

  private updateResultReadingControls(scroll=this.root.querySelector<HTMLElement>('.result-scroll')):void {
    if(!scroll)return;const navigation=this.root.querySelector<HTMLElement>('.result-reading-nav');const progress=this.root.querySelector<HTMLElement>('.reading-progress');const top=this.root.querySelector<HTMLButtonElement>('.reading-top');const bottom=this.root.querySelector<HTMLButtonElement>('.reading-bottom');if(!navigation||!progress||!top||!bottom)return;const maximum=Math.max(0,scroll.scrollHeight-scroll.clientHeight);const overflowed=maximum>4;navigation.hidden=!overflowed;if(!overflowed)return;const ratio=Math.min(1,Math.max(0,scroll.scrollTop/maximum));const percentage=Math.round(ratio*100);const atTop=scroll.scrollTop<=1;const atBottom=maximum-scroll.scrollTop<=1;progress.textContent=atTop?'顶部':atBottom?'底部':`${percentage}%`;progress.ariaLabel=`译文阅读进度 ${percentage}%`;top.disabled=atTop;bottom.disabled=atBottom;
  }

  private scrollResultToEdge(edge:'top'|'bottom'):void { const scroll=this.root.querySelector<HTMLElement>('.result-scroll');if(!scroll)return;const moveReadingFocus=this.root.activeElement?.classList.contains('reading-jump')??false;scroll.scrollTop=edge==='top'?0:scroll.scrollHeight;this.rememberVisibleResultReadingPosition();this.updateResultReadingControls(scroll);if(moveReadingFocus)queueMicrotask(()=>(this.root.querySelector<HTMLButtonElement>(edge==='top'?'.reading-bottom':'.reading-top'))?.focus({preventScroll:true})) }

  private rememberResultVersion(result:TranslateResult):void {
    const rootRequestId=this.resultRootRequestId(result);
    const versions=this.resultVersions.get(rootRequestId)??[];
    this.resultVersions.delete(rootRequestId);
    this.resultVersions.set(rootRequestId,[
      result,
      ...versions.filter(version=>version.requestId!==result.requestId),
    ].slice(0,3));
    while(this.resultVersions.size>12){const oldest=this.resultVersions.keys().next().value as string|undefined;if(!oldest)break;this.resultVersions.delete(oldest)}
  }

  private versionsFor(result:TranslateResult):TranslateResult[] {
    return this.resultVersions.get(this.resultRootRequestId(result))??[result];
  }

  private versionContext(
    result:TranslateResult,
    summary:TranslationVersionChangeSummary,
    comparisonDirection:'older'|'newer',
  ):HTMLElement {
    const context=document.createElement('div');context.className='version-context';context.setAttribute('role','note');
    const copy=document.createElement('div');copy.className='version-context-copy';const label=document.createElement('strong');label.textContent=translationVersionLabel(result);copy.append(label);
    const scopeLabel=translationVersionScopeLabel(result.revision?.scope);if(scopeLabel){const scope=document.createElement('span');scope.className='version-context-detail version-scope';scope.textContent=scopeLabel;copy.append(scope)}
    const change=document.createElement('span');change.className='version-context-detail version-change';const relation=comparisonDirection==='older'?'较上一版':'后续版本';change.textContent=summary.kind==='segments'?`${relation}调整 ${summary.changedCount} 句`:summary.kind==='full'?`${relation}调整全文`:comparisonDirection==='older'?'与上一版内容相同':'与后续版本内容相同';copy.append(change);context.append(copy);
    const visibleChangedId=summary.changedSegmentIds.find(id=>result.alignedSegments?.some(segment=>segment.id===id));if(visibleChangedId){const locate=this.button(this.alignedView?'定位':'逐句查看','version-locate',this.alignedView?'定位第一处版本改动':'切换逐句对照并定位第一处版本改动');locate.addEventListener('click',()=>{if(!this.alignedView){this.alignedView=true;this.rememberResultViewMode(result,true);this.renderResult(result);requestAnimationFrame(()=>requestAnimationFrame(()=>this.focusVersionChange(visibleChangedId)));return}this.focusVersionChange(visibleChangedId)});context.append(locate)}
    context.ariaLabel=[translationVersionLabel(result),scopeLabel,change.textContent].filter(Boolean).join('，');return context;
  }

  private focusVersionChange(segmentId:string):void {
    const scroll=this.root.querySelector<HTMLElement>('.result-scroll');const segment=this.segmentRow(segmentId);if(!scroll||!segment)return;this.readingRestoreRevision+=1;scroll.scrollTop+=segment.getBoundingClientRect().top-scroll.getBoundingClientRect().top-8;segment.focus({preventScroll:true});this.rememberVisibleResultReadingPosition();this.updateResultReadingControls(scroll);
  }

  private navigateVersion(result:TranslateResult,delta:number):void {
    const versions=this.versionsFor(result);
    const current=Math.max(0,versions.findIndex(version=>version.requestId===result.requestId));
    const next=current+delta;
    if(next<0||next>=versions.length)return;
    const focusKey=this.root.activeElement instanceof HTMLElement?this.root.activeElement.dataset.piFocusKey:undefined;
    this.alignedView=this.rememberedAlignedView(versions[next]!);
    this.renderResult(versions[next]!);
    if(focusKey==='older-version'||focusKey==='newer-version')queueMicrotask(()=>this.focusPairedNavigationControl(focusKey,focusKey==='older-version'?'newer-version':'older-version'));
  }

  showError(error:ErrorDisplay,rect?:ViewportRect):void {
    this.finishActiveProgressFeedback();this.progressState=undefined;this.resultFeedback.textContent='';if(rect)this.lastRect=rect;if(this.sidebarActive)this.sidebarCollapsed=false;const partialText=error.partialText?.trim();const surface=this.surface(partialText?'翻译中断':'翻译失败');
    const body=document.createElement('div');body.className='error';body.setAttribute('role','alert');body.setAttribute('aria-live','assertive');body.textContent=error.message;surface.append(body);
    if(partialText){const partial=document.createElement('section');partial.className='partial-result';const label=document.createElement('div');label.className='partial-result-label';label.textContent='已保留收到的部分译文';const preview=document.createElement('div');preview.className='stream-preview';preview.textContent=partialText;partial.append(label,preview);surface.append(partial)}
    const footer=document.createElement('div');footer.className='footer';const showRetry=error.retryable??true;const showWebRegionRecovery=Boolean(error.webRegionRecovery&&this.actions.onAdjustWebRegion&&this.actions.onReselectWebRegion);
    if(showWebRegionRecovery){const adjust=this.button('调整区域','action primary');adjust.dataset.piFocusTarget='true';adjust.addEventListener('click',()=>this.actions.onAdjustWebRegion?.());const reselect=this.button('重新框选','action');reselect.addEventListener('click',()=>this.actions.onReselectWebRegion?.());footer.append(adjust,reselect)}
    if(showRetry){const retry=this.button(showWebRegionRecovery?'重试原区域':'重试',`action${showWebRegionRecovery?'':' primary'}`);if(!showWebRegionRecovery)retry.dataset.piFocusTarget='true';retry.addEventListener('click',()=>{retry.disabled=true;retry.textContent='正在重试…';this.actions.onRetry({kind:'failed'})});footer.append(retry)}
    if(error.showSettings){const settings=this.button(error.settingsLabel??'打开设置',`action${showRetry||showWebRegionRecovery?'':' primary'}`);if(!showRetry&&!showWebRegionRecovery)settings.dataset.piFocusTarget='true';this.bindSettingsButton(settings,error.settingsFocus,error.settingsRecovery);footer.append(settings)}
    if(partialText){const copy=this.button('复制部分译文','action copy-action');if(!showRetry&&!showWebRegionRecovery&&!error.showSettings)copy.dataset.piFocusTarget='true';copy.addEventListener('click',()=>this.copyWithFeedback(copy,normalizeLatexForClipboard(partialText),'已复制','部分译文已复制到剪贴板'));footer.append(copy)}
    if(footer.childElementCount)surface.append(footer);this.showSurface(surface);
  }

  showStopped(partialText?:string,rect?:ViewportRect):void {
    this.finishActiveProgressFeedback();
    this.progressState=undefined;
    this.resultFeedback.textContent='';
    if(rect)this.lastRect=rect;
    if(this.sidebarActive)this.sidebarCollapsed=false;
    const preserved=partialText?.trim();
    const surface=this.surface('已停止');
    const status=document.createElement('div');
    status.className='stopped-status';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    status.textContent=preserved?'已停止 · 已保留部分译文':'翻译已停止';
    surface.append(status);
    if(preserved){
      const partial=document.createElement('section');
      partial.className='partial-result';
      const preview=document.createElement('div');
      preview.className='stream-preview';
      preview.textContent=preserved;
      partial.append(preview);
      surface.append(partial);
      const footer=document.createElement('div');
      footer.className='footer';
      const copy=this.button('复制部分译文','action copy-action');
      copy.dataset.piFocusTarget='true';
      copy.addEventListener('click',()=>this.copyWithFeedback(copy,normalizeLatexForClipboard(preserved),'已复制','部分译文已复制到剪贴板'));
      footer.append(copy);
      surface.append(footer);
    }
    this.showSurface(surface);
    queueMicrotask(()=>{
      const target=preserved
        ? this.root.querySelector<HTMLButtonElement>('.copy-action')
        : this.root.querySelector<HTMLButtonElement>('.surface-close');
      target?.focus({preventScroll:true});
    });
  }

  showSettingsRecoveryConfirmation(partialText?:string,rect?:ViewportRect):void {
    this.finishActiveProgressFeedback();
    this.progressState=undefined;
    this.resultFeedback.textContent='';
    if(rect)this.lastRect=rect;
    if(this.sidebarActive)this.sidebarCollapsed=false;
    const surface=this.surface('配置已完成');
    const notice=document.createElement('div');
    notice.className='notice';
    notice.setAttribute('role','status');
    notice.setAttribute('aria-live','polite');
    const title=document.createElement('strong');
    title.textContent=partialText?'已保留收到的部分译文':'请确认是否重新翻译';
    const text=document.createElement('span');
    text.textContent=partialText
      ?'为避免重复计费，扩展没有自动再次请求 API。你可以保留下面的内容，或明确选择重新翻译。'
      :'配置已经通过验证。此次错误不适合静默重试，请确认后再重新发送。';
    notice.append(title,text);
    surface.append(notice);
    if(partialText){
      const preview=document.createElement('div');
      preview.className='stream-preview';
      preview.textContent=partialText;
      surface.append(preview);
    }
    const footer=document.createElement('div');
    footer.className='footer';
    const retry=this.button('重新翻译（会再次请求 API）','action primary');
    retry.dataset.piFocusTarget='true';
    const keep=this.button(partialText?'保留部分结果':'暂不重试','action');
    retry.addEventListener('click',()=>{
      retry.disabled=true;
      keep.disabled=true;
      this.actions.onRetry({kind:'failed'});
    });
    keep.addEventListener('click',()=>{
      retry.remove();
      keep.remove();
      text.textContent=partialText
        ?'已保留当前部分译文，没有再次调用 API。'
        :'当前任务已保留，不会自动调用 API。';
      footer.remove();
    });
    footer.append(retry,keep);
    surface.append(footer);
    this.showSurface(surface);
  }

  private bindSettingsButton(button:HTMLButtonElement,focus?:SettingsFocus,recovery?:SettingsRecoveryRequest):void {
    button.addEventListener('click',()=>{
      button.disabled=true;
      void this.actions.onOpenSettings(focus,recovery).then((opened)=>{
        button.disabled=false;
        if(opened){
          button.textContent='设置已打开，完成后将返回';
          return;
        }
        button.textContent='无法打开，请从扩展菜单进入';
        button.title='请从 Edge 扩展菜单打开 Pi Translator 设置';
      }).catch(()=>{
        button.disabled=false;
        button.textContent='无法打开，请从扩展菜单进入';
        button.title='请从 Edge 扩展菜单打开 Pi Translator 设置';
      });
    });
  }

  hide():void { this.rememberVisibleResultReadingPosition();this.finishActiveProgressFeedback();this.markerNavigatorActive=false;this.historyNavigatorActive=false;this.documentMemoryActive=false;this.progressState=undefined;this.resultFeedback.textContent='';this.clear();this.setView('hidden'); }
  resetSession():void {
    this.finishActiveProgressFeedback();this.documentMemoryRequestRevision+=1;this.translationEpoch+=1;this.correctionUndo=undefined;this.markerNavigatorActive=false;this.historyNavigatorActive=false;this.historySearchQuery='';this.documentMemoryActive=false;this.documentTermFocusSource=undefined;this.progressState=undefined;this.resultFeedback.textContent='';const sidebarWasActive=this.sidebarActive;this.sidebarActive=false;this.sidebarCollapsed=false;if(sidebarWasActive)this.actions.onSidebarChange(false);this.history=[];this.historyIndex=-1;this.resultVersions.clear();this.latexViewOverrides.clear();this.resultViewModes.clear();this.resultReadingPositions.clear();this.expandedAlignedSources.clear();this.cardReturnFocus=undefined;delete this.currentResult;delete this.latestRequestId;delete this.documentMemory;this.documentMemoryError=undefined;this.clear();this.setView('hidden');
  }
  hideTrigger():void { if(this.view==='trigger')this.hide(); }
  resetCardPosition():void { this.cardPosition=undefined; }
  keepCardInViewport():void { this.reflowVisibleSurface(); }
  updateViewportInsets():void { this.refreshViewportInsets();this.scheduleReflow(); }
  refreshSourceMarkState():void {
    if(!this.currentResult||this.progressState||!this.isShowingCard())return;
    if(this.historyNavigatorActive){this.renderHistoryNavigator();return}
    this.renderAfterMarkToggle(this.currentResult,true);
  }

  destroy():void { this.progressFeedbackController.dispose();this.activeFeedbackIdentity=undefined;this.progressFeedback=undefined;if(this.sidebarActive){this.sidebarActive=false;this.sidebarCollapsed=false;this.actions.onSidebarChange(false)}if(this.themeTimer)clearTimeout(this.themeTimer);this.clear();this.themeObserver?.disconnect();this.colorSchemeQuery?.removeEventListener('change',this.onColorSchemeChange);window.removeEventListener('keydown',this.onKeyDown,true);document.removeEventListener('pointerdown',this.onDocumentPointerDown,true);window.removeEventListener('resize',this.onViewportChange);window.removeEventListener('scroll',this.onViewportChange,true);window.visualViewport?.removeEventListener('resize',this.onViewportChange);window.visualViewport?.removeEventListener('scroll',this.onViewportChange);this.host.remove(); }

  private renderSidebarIdle():void {
    const surface=this.surface('连续翻译');const idle=document.createElement('div');idle.className='idle';const logo=this.logo('logo');
    const title=document.createElement('strong');title.textContent='侧栏已固定';const text=document.createElement('p');text.textContent='现在直接选中网页或 Overleaf 中的句子，译文会自动出现在这里。';idle.append(logo,title,text);surface.append(idle);this.showSurface(surface);
  }

  private historySearchResults():TranslationHistoryEntry[] {
    const entries=this.markedOnly
      ? this.history.filter(entry=>this.actions.hasSourceMarksForResult?.(entry))
      : this.history;
    return searchTranslationHistory(entries,this.historySearchQuery);
  }

  private openHistoryNavigator():void {
    if(!this.sidebarActive||this.history.length<2)return;
    this.rememberVisibleResultReadingPosition();this.markerNavigatorActive=false;this.documentMemoryActive=false;this.historyNavigatorActive=true;this.sidebarCollapsed=false;this.focusNextSurface=true;this.renderHistoryNavigator();
  }

  private returnFromHistoryNavigator():void {
    this.historyNavigatorActive=false;
    let target=this.currentResult;
    if(this.markedOnly&&target&&!this.actions.hasSourceMarksForResult?.(target))target=this.navigationHistory()[0];
    if(!target&&this.markedOnly){this.markedOnly=false;target=this.currentResult}
    if(target){this.alignedView=this.rememberedAlignedView(target);this.renderResult(target);queueMicrotask(()=>this.root.querySelector<HTMLButtonElement>('.history-open')?.focus({preventScroll:true}))}
    else this.renderSidebarIdle();
  }

  private openHistoryResult(entry:TranslationHistoryEntry):void {
    this.historyNavigatorActive=false;this.alignedView=this.rememberedAlignedView(entry);this.renderResult(entry);queueMicrotask(()=>this.root.querySelector<HTMLButtonElement>('.history-open')?.focus({preventScroll:true}));
  }

  private renderHistoryNavigator():void {
    const surface=this.surface('翻译历史');surface.classList.add('history-surface');
    const searchbar=document.createElement('div');searchbar.className='history-searchbar';
    const input=document.createElement('input');input.type='search';input.className='history-search-field';input.value=this.historySearchQuery;input.placeholder='搜索原文、译文或来源';input.ariaLabel='搜索翻译历史';input.autocomplete='off';input.spellcheck=false;input.dataset.piFocusKey='history-search';input.dataset.piFocusTarget='true';input.setAttribute('aria-keyshortcuts','Alt+/');
    const hasMarked=this.history.some(entry=>this.actions.hasSourceMarksForResult?.(entry));
    const filter=this.button('仅标记','history-filter','仅显示已标记翻译');filter.hidden=!hasMarked;filter.classList.toggle('active',this.markedOnly);filter.setAttribute('aria-pressed',String(this.markedOnly));
    const clear=this.button('清空','history-clear','清空历史搜索');clear.hidden=!this.historySearchQuery;
    searchbar.append(input,filter,clear);
    const summary=document.createElement('div');summary.className='history-summary';summary.id='pi-history-search-summary';summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');input.setAttribute('aria-describedby',summary.id);
    const list=document.createElement('div');list.className='history-list';list.id='pi-history-search-results';input.setAttribute('aria-controls',list.id);
    const renderEntries=()=>{
      const entries=this.historySearchResults();list.replaceChildren();const filtered=Boolean(this.historySearchQuery.trim())||this.markedOnly;summary.textContent=filtered?`${entries.length} 条匹配`:`${entries.length} 条历史翻译`;clear.hidden=!this.historySearchQuery;
      for(const entry of entries){
        const item=this.button('','history-item');item.title='查看这条历史翻译';item.ariaLabel=`查看历史翻译：${entry.originalText.slice(0,80)}`;item.dataset.piFocusKey=`history-entry:${entry.requestId}`;item.classList.toggle('current',entry.requestId===this.currentResult?.requestId);if(entry.requestId===this.currentResult?.requestId)item.setAttribute('aria-current','true');
        const meta=document.createElement('div');meta.className='history-item-meta';const time=document.createElement('span');time.textContent=formatTranslationClockTime(entry.createdAt);meta.append(time);if(entry.sourceHost){const host=document.createElement('span');host.textContent=entry.sourceHost;host.title=entry.sourceHost;meta.append(host)}if(this.actions.hasSourceMarksForResult?.(entry)){const marked=document.createElement('span');marked.className='history-marked';marked.textContent='已标记';meta.append(marked)}if(entry.requestId===this.currentResult?.requestId){const current=document.createElement('span');current.className='history-current';current.textContent='当前';meta.append(current)}
        const source=document.createElement('div');source.className='history-item-source';source.textContent=entry.originalText;const target=document.createElement('div');target.className='history-item-target';target.textContent=entry.translatedText;item.append(meta,source,target);item.addEventListener('click',()=>this.openHistoryResult(entry));item.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const items=[...list.querySelectorAll<HTMLButtonElement>('.history-item')];const index=items.indexOf(item);const targetIndex=event.key==='Home'?0:event.key==='End'?items.length-1:Math.min(items.length-1,Math.max(0,index+(event.key==='ArrowDown'?1:-1)));items[targetIndex]?.focus({preventScroll:true})});list.append(item);
      }
      if(!entries.length){const empty=document.createElement('div');empty.className='history-empty';const message=document.createElement('span');message.textContent='没有匹配的历史翻译';const reset=this.button('显示全部历史','','清除搜索和标记筛选');reset.addEventListener('click',()=>{this.historySearchQuery='';this.markedOnly=false;input.value='';filter.classList.remove('active');filter.setAttribute('aria-pressed','false');renderEntries();input.focus({preventScroll:true})});empty.append(message,reset);list.append(empty)}
    };
    input.addEventListener('input',()=>{this.historySearchQuery=input.value;renderEntries()});input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){const first=list.querySelector<HTMLButtonElement>('.history-item');if(first){event.preventDefault();first.focus({preventScroll:true})}}else if(event.key==='Enter'){const first=list.querySelector<HTMLButtonElement>('.history-item');if(first){event.preventDefault();first.click()}}});
    filter.addEventListener('click',()=>{this.markedOnly=!this.markedOnly;filter.classList.toggle('active',this.markedOnly);filter.setAttribute('aria-pressed',String(this.markedOnly));renderEntries();input.focus({preventScroll:true})});clear.addEventListener('click',()=>{this.historySearchQuery='';input.value='';renderEntries();input.focus({preventScroll:true})});
    surface.append(searchbar,summary,list);renderEntries();this.showSurface(surface);
  }

  private openMarkerNavigator():void {
    if(!this.actions.getSourceMarkSummaries?.().length)return;
    this.rememberVisibleResultReadingPosition();
    this.historyNavigatorActive=false;
    this.markerNavigatorActive=true;
    this.sidebarCollapsed=false;
    this.renderMarkerNavigator();
  }

  private renderMarkerNavigator():void {
    const summaries=this.actions.getSourceMarkSummaries?.()??[];
    const surface=this.surface('本文标记');
    const toolbar=document.createElement('div');toolbar.className='marker-notes-toolbar';const count=document.createElement('span');count.textContent=`${summaries.length} 条 · 按页码排列`;toolbar.append(count);
    if(summaries.length&&this.actions.onCopyMarkedNotes){const copyAll=this.button('复制全部','','复制本文标记为 Markdown');copyAll.addEventListener('click',()=>{void this.actions.onCopyMarkedNotes?.().then((copied)=>{copyAll.textContent=`已复制 ${copied} 条`})});toolbar.append(copyAll)}
    surface.append(toolbar);
    if(!summaries.length){const empty=document.createElement('div');empty.className='idle';const title=document.createElement('strong');title.textContent='本文暂无标记';const text=document.createElement('p');text.textContent='轻标记重要译句后，会按页码显示在这里。';empty.append(title,text);surface.append(empty);this.showSurface(surface);return}
    const list=document.createElement('div');list.className='marker-notes-list';
    for(const [index,summary] of summaries.entries()){
      const item=document.createElement('article');item.className=`marker-note${summary.locationState==='missing'?' missing':''}`;
      const main=this.button('','marker-note-main',summary.locationState==='missing'?'原文位置已变化，仍可跳转到原页':'跳转到原文');
      const meta=document.createElement('div');meta.className='marker-note-meta';
      const page=document.createElement('span');page.textContent=summary.pageNumber?`第 ${summary.pageNumber} 页`:'当前页面';meta.append(page);
      if(summary.locationState==='missing'){
        const status=document.createElement('span');status.className='marker-note-status';status.textContent='原文位置已变化';meta.append(status);
      }else if(summary.locationState==='pending'){
        const status=document.createElement('span');status.className='marker-note-status';status.textContent='点击定位';meta.append(status);
      }
      const source=document.createElement('div');source.className='marker-note-source';source.textContent=summary.originalText;
      const target=document.createElement('div');target.className='marker-note-target';renderTranslationContent(target,summary.translatedText,false);
      main.append(meta,source,target);
      main.addEventListener('click',()=>{
        const task=this.actions.onNavigateSourceMark?.(summary.markerId);if(!task)return;
        void task.then(()=>{
          const narrow=globalThis.matchMedia?.('(max-width:620px)')?.matches??innerWidth<=620;
          if(narrow){this.collapseSidebar();return}
          this.renderMarkerNavigator();queueMicrotask(()=>this.focusMarkerNavigatorFallback(index));
        });
      });
      const actions=document.createElement('div');actions.className='marker-note-actions';
      const copy=this.button('复制','', '复制这条标记');
      copy.addEventListener('click',()=>{const sourceText=normalizeLatexForClipboard(summary.originalText).replace(/\r?\n/gu,'\n> ');const targetText=normalizeLatexForClipboard(summary.translatedText);this.copyWithFeedback(copy,`> ${sourceText}\n\n${targetText}`,'已复制','标记笔记已复制到剪贴板')});
      const remove=this.button('删除','', '删除这条标记');
      const resetRemove=()=>{delete remove.dataset.confirmDelete;remove.textContent='删除';remove.ariaLabel='删除这条标记'};
      remove.addEventListener('click',()=>{
        if(remove.dataset.confirmDelete!=='true'){
          remove.dataset.confirmDelete='true';remove.textContent='确认';remove.ariaLabel='再次点击删除这条标记';return;
        }
        const task=this.actions.onRemoveSourceMark?.(summary.markerId);if(!task)return;
        void task.then(()=>{this.renderMarkerNavigator();queueMicrotask(()=>this.focusMarkerNavigatorFallback(index))}).catch(()=>{resetRemove();this.flashButtonFeedback(remove,'删除失败',3200)});
      });
      remove.addEventListener('blur',()=>{if(remove.dataset.confirmDelete==='true')resetRemove()});
      actions.append(copy,remove);item.append(main,actions);list.append(item);
    }
    surface.append(list);this.showSurface(surface);
  }

  private focusMarkerNavigatorFallback(preferredIndex=0):void {
    const markers=[...this.root.querySelectorAll<HTMLButtonElement>('.marker-note-main')];
    const marker=markers[Math.min(preferredIndex,Math.max(0,markers.length-1))];
    (marker??this.root.querySelector<HTMLButtonElement>('[aria-label="返回翻译结果"]'))
      ?.focus({preventScroll:true});
  }

  private openDocumentMemory(termSource?:string):void {
    if(!this.actions.onGetDocumentMemory)return;
    this.rememberVisibleResultReadingPosition();
    this.documentTermFocusSource=termSource;
    this.markerNavigatorActive=false;this.historyNavigatorActive=false;this.documentMemoryActive=true;this.sidebarCollapsed=false;this.documentMemoryError=undefined;
    this.renderDocumentMemory();
    this.refreshDocumentMemory(true);
  }

  private updateDocumentMemory(task:Promise<DocumentMemorySnapshot>,focusAfterRender?:()=>void):void {
    this.documentMemoryError=undefined;const requestRevision=++this.documentMemoryRequestRevision;
    void task.then((memory)=>{
      if(requestRevision!==this.documentMemoryRequestRevision)return;
      this.documentMemory=memory;
      if(this.documentMemoryActive){
        this.renderDocumentMemory();
        if(focusAfterRender)queueMicrotask(focusAfterRender);
      }else this.updateDocumentMemoryButton();
    }).catch((error:unknown)=>{
      if(requestRevision!==this.documentMemoryRequestRevision)return;
      this.documentMemoryError=error instanceof Error?error.message:'操作失败';
      if(this.documentMemoryActive){
        this.renderDocumentMemory();
        if(focusAfterRender)queueMicrotask(focusAfterRender);
      }
    });
  }

  private focusDocumentReviewFallback():void {
    (this.root.querySelector<HTMLButtonElement>('.document-review-actions .review-resolve')
      ??this.root.querySelector<HTMLButtonElement>('[aria-label="返回翻译结果"]'))
      ?.focus({preventScroll:true});
  }

  private focusDocumentClearFallback():void {
    (this.root.querySelector<HTMLButtonElement>('.document-clear')
      ??this.root.querySelector<HTMLButtonElement>('[aria-label="返回翻译结果"]'))
      ?.focus({preventScroll:true});
  }

  private documentMemoryButtonLabel():string {
    return documentReviewButtonLabel(summarizeDocumentReviews(this.documentMemory));
  }

  private updateDocumentMemoryButton():void {
    const button=this.root.querySelector<HTMLButtonElement>('.document-memory-action');
    if(!button)return;
    const summary=summarizeDocumentReviews(this.documentMemory);
    button.textContent=this.documentMemoryButtonLabel();
    button.ariaLabel=this.documentMemoryButtonLabel();
    button.classList.toggle('has-review',summary.totalCount>0);
    button.title=documentReviewDescription(summary);
  }

  private documentTermEditor(
    sourceValue:string,
    targetValue:string,
    id?:string,
  ):HTMLElement {
    const editor=document.createElement('div');editor.className='document-edit';const source=document.createElement('input');source.value=sourceValue;source.placeholder='原文术语';source.ariaLabel='原文术语';const target=document.createElement('input');target.value=targetValue;target.placeholder='固定译法';target.ariaLabel='固定译法';const actions=document.createElement('div');actions.className='document-edit-actions';const restore=()=>{this.editingDocumentTermId=undefined;this.renderDocumentMemory();queueMicrotask(()=>{const fallback=this.root.querySelector<HTMLButtonElement>('[title="添加本文术语"]');const matching=id?[...this.root.querySelectorAll<HTMLButtonElement>('[data-document-term-id]')].find(button=>button.dataset.documentTermId===id):undefined;(matching??fallback)?.focus()})};const commit=()=>{const cleanSource=source.value.trim(),cleanTarget=target.value.trim();if(!cleanSource||!cleanTarget){(!cleanSource?source:target).focus();return}this.editingDocumentTermId=undefined;this.updateDocumentMemory(this.actions.onUpsertDocumentTerm!({...(id?{id}:{}),source:cleanSource,target:cleanTarget}))};const save=this.button('保存','','保存本文术语');save.addEventListener('click',commit);const cancel=this.button('取消','correction-cancel','取消编辑本文术语');cancel.addEventListener('click',restore);const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Enter'){event.preventDefault();commit()}};source.addEventListener('keydown',onKeyDown);target.addEventListener('keydown',onKeyDown);actions.append(cancel,save);editor.append(source,target,actions);return editor;
  }

  private documentCandidateEditor(sourceValue:string,targetValue:string,id:string):HTMLElement {
    const editor=document.createElement('div');editor.className='document-edit document-candidate-edit';
    const source=document.createElement('div');source.className='document-source';source.textContent=sourceValue;
    const target=document.createElement('input');target.value=targetValue;target.placeholder='修改候选译法';target.ariaLabel=`修改 ${sourceValue} 的候选译法`;
    const actions=document.createElement('div');actions.className='document-edit-actions';
    const cancel=()=>{this.editingDocumentCandidateId=undefined;this.renderDocumentMemory();queueMicrotask(()=>{[...this.root.querySelectorAll<HTMLButtonElement>('[data-document-candidate-id]')].find(button=>button.dataset.documentCandidateId===id)?.focus()})};
    const commit=()=>{const cleanTarget=target.value.trim();if(!cleanTarget){target.focus();return}this.editingDocumentCandidateId=undefined;this.updateDocumentMemory(this.actions.onUpsertDocumentTerm!({source:sourceValue,target:cleanTarget}))};
    const save=this.button('保存','','保存修改并采用');save.addEventListener('click',commit);
    const dismiss=this.button('取消','correction-cancel','取消修改');dismiss.addEventListener('click',cancel);
    target.addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();commit()}else if(event.key==='Escape'){event.preventDefault();cancel()}});
    actions.append(save,dismiss);editor.append(source,target,actions);return editor;
  }

  private openDocumentTranslation(entry:DocumentMemoryTranslation):void {
    this.documentMemoryActive=false;
    const result=[this.currentResult,...this.history].find((candidate)=>candidate?.requestId===entry.requestId)??documentMemoryTranslationResult(entry,this.documentMemory?.label);
    this.alignedView=this.rememberedAlignedView(result);this.currentResult=result;this.renderResult(result);
  }

  private renderDocumentMemory():void {
    const surface=this.surface('本文');
    const meta=document.createElement('div');meta.className='document-meta';meta.textContent=this.documentMemory?`${this.documentMemory.label} · 仅保存在本机`:'正在读取本文记忆…';surface.append(meta);
    if(this.documentMemoryError){const error=document.createElement('div');error.className='error';error.textContent=this.documentMemoryError;surface.append(error)}
    const memory=this.documentMemory;if(!memory){this.showSurface(surface);return}
    const requestedTermSource=this.documentTermFocusSource;
    if(requestedTermSource){const sourceKey=requestedTermSource.trim().toLocaleLowerCase();const matching=memory.confirmedTerms.find(term=>term.source.trim().toLocaleLowerCase()===sourceKey);if(matching){this.editingDocumentCandidateId=undefined;this.editingDocumentTermId=matching.id}}

    const reviewSummary=summarizeDocumentReviews(memory);
    const pendingReviews=reviewSummary.imageTranslations;
    if(pendingReviews.length){
      const reviews=document.createElement('section');reviews.className='document-section document-review-section';
      const head=document.createElement('div');head.className='document-section-head';
      const title=document.createElement('strong');title.textContent='图像识别待核对';
      const count=document.createElement('span');count.textContent=String(pendingReviews.length);
      head.append(title,count);reviews.append(head);
      const list=document.createElement('div');list.className='document-review-list';
      for(const entry of pendingReviews){
        const review=entry.review!;
        const row=document.createElement('article');row.className='document-review-row';
        const meta=document.createElement('div');meta.className='document-review-meta';
        const page=document.createElement('span');page.textContent=entry.sourceLocation?`第 ${entry.sourceLocation.pageNumber} 页`:'PDF 选区';
        const reason=document.createElement('strong');
        const reasons=[review.formulaNeedsReview?'公式结构待核对':'',review.uncertainSpans.length?`${review.uncertainSpans.length} 处内容待核对`:''].filter(Boolean);
        reason.textContent=reasons.join(' · ');
        const time=document.createElement('span');time.textContent=formatTranslationClockTime(review.updatedAt);
        meta.append(page,reason,time);
        const source=document.createElement('div');source.className='document-review-source';source.textContent=entry.originalText;
        const actions=document.createElement('div');actions.className='document-review-actions';
        if(entry.sourceLocation&&this.actions.onNavigateToPdfRegion){
          const locate=this.button('返回区域','','返回 PDF 原选区');locate.ariaLabel='返回区域';
          locate.addEventListener('click',()=>{
            this.actions.onNavigateToPdfRegion?.(entry.sourceLocation!);
            const narrow=globalThis.matchMedia?.('(max-width:620px)')?.matches??innerWidth<=620;
            if(this.sidebarActive&&narrow)this.collapseSidebar();
          });
          actions.append(locate);
        }
        const open=this.button('打开结果','','查看待核对译文');open.ariaLabel='打开结果';
        open.addEventListener('click',()=>this.openDocumentTranslation(entry));actions.append(open);
        if(this.actions.canRetryDocumentReview?.(entry)&&this.actions.onRetryDocumentReview){
          const retry=this.button('重新识别','','重新截图识别这个区域');retry.ariaLabel='重新识别';
          retry.addEventListener('click',()=>this.actions.onRetryDocumentReview?.(entry));actions.append(retry);
        }
        if(this.actions.onResolveDocumentReview){
          const resolve=this.button('已核对','review-resolve','标记为已人工核对');resolve.ariaLabel='已核对';
          resolve.addEventListener('click',()=>this.updateDocumentMemory(this.actions.onResolveDocumentReview!(review.id),()=>this.focusDocumentReviewFallback()));actions.append(resolve);
        }
        row.append(meta,source,actions);list.append(row);
      }
      reviews.append(list);surface.append(reviews);
    }

    if(reviewSummary.terminologyTranslations.length){
      const reviews=document.createElement('section');reviews.className='document-section document-term-review-section';
      const head=document.createElement('div');head.className='document-section-head';
      const title=document.createElement('strong');title.textContent='术语待核对';
      const count=document.createElement('span');count.textContent=String(reviewSummary.terminologyCount);
      head.append(title,count);reviews.append(head);
      const intro=document.createElement('div');intro.className='document-term-review-intro';intro.textContent='配置译法未直接出现在译文中；同义表达也可能触发，请结合上下文核对。';reviews.append(intro);
      const list=document.createElement('div');list.className='document-review-list';
      for(const {translation:entry,terms} of reviewSummary.terminologyTranslations){
        const row=document.createElement('article');row.className='document-review-row document-term-review-row';
        const meta=document.createElement('div');meta.className='document-review-meta';
        const location=document.createElement('span');location.textContent=entry.sourceLocation?`第 ${entry.sourceLocation.pageNumber} 页`:'译文';
        const reason=document.createElement('strong');reason.textContent=`${terms.length} 个术语`;
        const time=document.createElement('span');time.textContent=formatTranslationClockTime(entry.completedAt);
        meta.append(location,reason,time);
        const source=document.createElement('div');source.className='document-review-source';source.textContent=entry.originalText;
        const pairs=document.createElement('div');pairs.className='document-term-review-pairs';
        for(const term of terms){
          const pair=document.createElement('div');pair.className='document-term-review-pair';
          const termSource=document.createElement('span');termSource.className='document-term-review-source';termSource.textContent=term.source;
          const arrow=document.createElement('span');arrow.className='document-term-review-arrow';arrow.textContent='→';
          const target=document.createElement('span');target.className='document-term-review-target';target.textContent=term.target;
          const scope=document.createElement('span');scope.className='document-term-review-scope';scope.textContent=term.scope==='document'?'本文':'全局';
          pair.append(termSource,arrow,target,scope);pairs.append(pair);
        }
        const actions=document.createElement('div');actions.className='document-review-actions';
        if(entry.sourceLocation&&this.actions.onNavigateToPdfRegion){
          const locate=this.button('返回区域','','返回 PDF 原选区');locate.ariaLabel='返回区域';
          locate.addEventListener('click',()=>{
            this.actions.onNavigateToPdfRegion?.(entry.sourceLocation!);
            const narrow=globalThis.matchMedia?.('(max-width:620px)')?.matches??innerWidth<=620;
            if(this.sidebarActive&&narrow)this.collapseSidebar();
          });
          actions.append(locate);
        }
        const open=this.button('打开译文','','打开含待核对术语的译文');open.ariaLabel=`打开含 ${terms.length} 个待核对术语的译文`;
        open.addEventListener('click',()=>this.openDocumentTranslation(entry));actions.append(open);
        row.append(meta,source,pairs,actions);list.append(row);
      }
      reviews.append(list);surface.append(reviews);
    }

    const confirmed=document.createElement('section');confirmed.className='document-section';const confirmedHead=document.createElement('div');confirmedHead.className='document-section-head';const confirmedTitle=document.createElement('strong');confirmedTitle.textContent='固定译法';const confirmedCount=document.createElement('span');confirmedCount.textContent=String(memory.confirmedTerms.length);const add=this.button('＋添加','document-action','添加本文术语');add.addEventListener('click',()=>{this.editingDocumentCandidateId=undefined;this.editingDocumentTermId='new';this.renderDocumentMemory()});confirmedHead.append(confirmedTitle,confirmedCount,add);confirmed.append(confirmedHead);const confirmedList=document.createElement('div');
    if(this.editingDocumentTermId==='new')confirmedList.append(this.documentTermEditor('',''));
    for(const term of memory.confirmedTerms){const row=document.createElement('div');row.className='document-row';if(this.editingDocumentTermId===term.id){row.style.display='block';row.append(this.documentTermEditor(term.source,term.target,term.id));confirmedList.append(row);continue}const pair=document.createElement('div');pair.className='document-pair';const source=document.createElement('div');source.className='document-source';source.textContent=term.source;const target=document.createElement('div');target.className='document-target';target.textContent=term.target;pair.append(source,target);const actions=document.createElement('div');actions.className='document-row-actions';const edit=this.button('编辑','','编辑本文术语');edit.dataset.documentTermId=term.id;edit.addEventListener('click',()=>{this.editingDocumentCandidateId=undefined;this.editingDocumentTermId=term.id;this.renderDocumentMemory()});const remove=this.button('删除','','删除本文术语');remove.addEventListener('click',()=>this.updateDocumentMemory(this.actions.onRemoveDocumentTerm!(term.id)));actions.append(edit,remove);row.append(pair,actions);confirmedList.append(row)}
    if(!memory.confirmedTerms.length&&this.editingDocumentTermId!=='new'){const empty=document.createElement('div');empty.className='document-empty';empty.textContent='确认术语后，后续译句会优先沿用这里的译法。';confirmedList.append(empty)}confirmed.append(confirmedList);surface.append(confirmed);

    if(memory.candidateTerms.length){const candidates=document.createElement('section');candidates.className='document-section';const head=document.createElement('div');head.className='document-section-head';const title=document.createElement('strong');title.textContent='待确认术语';const count=document.createElement('span');count.textContent=String(memory.candidateTerms.length);head.append(title,count);candidates.append(head);const list=document.createElement('div');list.className='document-list';for(const term of memory.candidateTerms){const row=document.createElement('div');row.className='document-row';if(this.editingDocumentCandidateId===term.id){row.style.display='block';row.append(this.documentCandidateEditor(term.source,term.target,term.id));list.append(row);continue}const pair=document.createElement('div');pair.className='document-pair';const source=document.createElement('div');source.className='document-source';source.textContent=term.source;const target=document.createElement('div');target.className='document-target';target.textContent=term.target;pair.append(source,target);const actions=document.createElement('div');actions.className='document-row-actions';const confirm=this.button('采用','','采用为本文固定译法');confirm.addEventListener('click',()=>this.updateDocumentMemory(this.actions.onConfirmDocumentTerm!(term.id)));const edit=this.button('修改','','修改候选译法后采用');edit.dataset.documentCandidateId=term.id;edit.addEventListener('click',()=>{this.editingDocumentTermId=undefined;this.editingDocumentCandidateId=term.id;this.renderDocumentMemory()});const dismiss=this.button('忽略','','不再推荐此映射');dismiss.addEventListener('click',()=>this.updateDocumentMemory(this.actions.onDismissDocumentTermCandidate!(term.id)));actions.append(confirm,edit,dismiss);row.append(pair,actions);list.append(row)}candidates.append(list);surface.append(candidates)}

    const recent=document.createElement('section');recent.className='document-section';const recentHead=document.createElement('div');recentHead.className='document-section-head';const recentTitle=document.createElement('strong');recentTitle.textContent='最近翻译';const recentCount=document.createElement('span');recentCount.textContent=String(memory.recentTranslations.length);recentHead.append(recentTitle,recentCount);recent.append(recentHead);const recentList=document.createElement('div');recentList.className='document-list';for(const entry of memory.recentTranslations){const button=this.button('','document-translation','查看这条翻译');const source=document.createElement('div');source.className='document-source';source.textContent=entry.originalText;const target=document.createElement('div');target.className='document-target';renderTranslationContent(target,entry.translatedText,false);button.append(source,target);button.addEventListener('click',()=>this.openDocumentTranslation(entry));recentList.append(button)}if(!memory.recentTranslations.length){const empty=document.createElement('div');empty.className='document-empty';empty.textContent='本文完成的翻译会出现在这里。';recentList.append(empty)}recent.append(recentList);surface.append(recent);

    const hasMemoryContent=Boolean(memory.confirmedTerms.length||memory.candidateTerms.length||memory.recentTranslations.length);
    if(this.actions.onClearDocumentMemory&&hasMemoryContent){const footer=document.createElement('div');footer.className='document-footer';const clear=this.button('清空本文记忆','document-clear');clear.dataset.piFocusKey='document-clear';const resetClear=()=>{clear.textContent='清空本文记忆';delete clear.dataset.confirmClear};clear.addEventListener('click',()=>{if(clear.dataset.confirmClear!=='true'){clear.textContent='再次点击清空';clear.dataset.confirmClear='true';return}clear.disabled=true;clear.textContent='正在清空…';this.updateDocumentMemory(this.actions.onClearDocumentMemory!(),()=>this.focusDocumentClearFallback())});clear.addEventListener('blur',()=>{if(clear.dataset.confirmClear==='true')resetClear()});footer.append(clear);surface.append(footer)}
    this.showSurface(surface);const activeEditor=requestedTermSource?surface.querySelector<HTMLInputElement>('.document-edit input[aria-label="固定译法"]'):surface.querySelector<HTMLInputElement>('.document-edit input');if(activeEditor)queueMicrotask(()=>{activeEditor.focus();if(this.editingDocumentCandidateId||requestedTermSource)activeEditor.select()});
  }

  private sameFeedbackIdentity(
    left:TranslationProgressIdentity|undefined,
    right:TranslationProgressIdentity|undefined,
  ):boolean {
    return Boolean(left&&right&&left.requestId===right.requestId&&left.revisionKey===right.revisionKey);
  }

  private clearRenderStageStatus():void {
    const status=this.root.querySelector<HTMLElement>('.render-stage-status');
    const meta=status?.parentElement;
    status?.remove();
    if(meta?.classList.contains('meta')&&meta.childElementCount===0&&!meta.textContent?.trim())meta.remove();
  }

  private applyProgressFeedback(feedback:TranslationProgressFeedback):void {
    if(!this.sameFeedbackIdentity(this.activeFeedbackIdentity,feedback))return;
    this.progressFeedback=feedback;
    if(feedback.stage!=='rendering'){
      const progress=this.progressState;
      if(!progress||progress.requestId!==feedback.requestId||progress.revisionKey!==feedback.revisionKey)return;
      const status=this.root.querySelector<HTMLElement>('.loading-status');
      if(status)status.textContent=this.progressStatus(progress);
      return;
    }
    const topLine=this.root.querySelector<HTMLElement>('.result-topline');
    if(!topLine)return;
    let meta=topLine.querySelector<HTMLElement>('.meta');
    if(!meta){meta=document.createElement('div');meta.className='meta';topLine.prepend(meta)}
    let status=meta.querySelector<HTMLElement>('.render-stage-status');
    if(!status){status=document.createElement('span');status.className='render-stage-status cache-badge';meta.append(status)}
    status.textContent=feedback.message;
  }

  private beginProgressFeedback(
    identity:TranslationProgressIdentity,
    stage:RemoteTranslationProgressStage|'rendering',
    hasPartial=false,
  ):void {
    this.clearRenderStageStatus();
    this.activeFeedbackIdentity={...identity};
    this.progressFeedback=undefined;
    this.progressFeedbackController.begin(identity,stage,{hasPartial});
  }

  private finishProgressFeedback(identity:TranslationProgressIdentity):void {
    this.progressFeedbackController.finish(identity);
    if(!this.sameFeedbackIdentity(this.activeFeedbackIdentity,identity))return;
    this.activeFeedbackIdentity=undefined;
    this.progressFeedback=undefined;
    this.clearRenderStageStatus();
  }

  private finishActiveProgressFeedback():void {
    const identity=this.activeFeedbackIdentity;
    if(identity)this.finishProgressFeedback(identity);
  }

  private progressStatus(progress:OverlayProgressState):string {
    const feedback=this.progressFeedback;
    if(feedback&&feedback.stage===progress.progressStage&&feedback.requestId===progress.requestId&&feedback.revisionKey===progress.revisionKey)return feedback.message;
    if(progress.progressStage==='provider'&&progress.partialText)return TRANSLATION_PROGRESS_MESSAGES.provider.receiving;
    if(progress.totalChunks>1)return `正在翻译长文本 ${Math.min(progress.completedChunks+1,progress.totalChunks)}/${progress.totalChunks}…`;
    return '正在翻译…';
  }

  private renderProgress():void { const progressState=this.progressState;if(!progressState)return;const surface=this.surface('正在翻译');surface.setAttribute('aria-busy','true');const progress=document.createElement('div');progress.className='progress';const body=document.createElement('div');body.className='loading';body.setAttribute('role','status');body.setAttribute('aria-live','polite');body.setAttribute('aria-atomic','true');const spinner=document.createElement('span');spinner.className='spinner';spinner.ariaHidden='true';const text=document.createElement('span');text.className='loading-status';text.textContent=this.progressStatus(progressState);const stop=this.button('停止','stop-translation','停止翻译并保留已收到的译文');stop.dataset.piFocusKey='stop-translation';stop.dataset.piFocusTarget='true';stop.addEventListener('pointerdown',event=>event.preventDefault());stop.addEventListener('click',()=>{if(stop.disabled)return;stop.disabled=true;stop.textContent='停止中…';this.actions.onStop()});const preview=document.createElement('div');preview.className='stream-preview';preview.hidden=!progressState.partialText;if(progressState.partialText)preview.textContent=progressState.partialText;body.append(spinner,text,stop);progress.append(body,preview);surface.append(progress);this.showSurface(surface);if(progressState.partialText)preview.scrollTop=preview.scrollHeight }

  private resultContainsLatex(result:TranslateResult):boolean {
    return containsRenderableLatex(result.translatedText)||Boolean(
      result.alignedSegments?.some(segment=>containsRenderableLatex(segment.translatedText)),
    );
  }

  private shouldRenderLatex(result:TranslateResult):boolean {
    return this.latexViewOverrides.get(result.requestId)??this.preferences.autoRenderLatex;
  }
  deactivateSidebar(): void {
    const wasActive=this.sidebarActive;
    this.sidebarActive=false;this.sidebarCollapsed=false;this.markedOnly=false;
    if(wasActive)this.actions.onSidebarChange(false);
    this.hide();
  }

  private shouldRenderLexicalLookup(result:TranslateResult):boolean {
    return Boolean(result.lexicalLookup)&&(this.lexicalViewModes.get(result.requestId)??true);
  }

  private setLexicalView(result:TranslateResult,enabled:boolean):void {
    this.lexicalViewModes.delete(result.requestId);
    this.lexicalViewModes.set(result.requestId,enabled);
    while(this.lexicalViewModes.size>48){const oldest=this.lexicalViewModes.keys().next().value as string|undefined;if(!oldest)break;this.lexicalViewModes.delete(oldest)}
  }

  private speakLookupSource(result:TranslateResult,button:HTMLButtonElement):void {
    if(typeof window.speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined')return;
    if(this.activeSpeechRequestId===result.requestId){window.speechSynthesis.cancel();this.activeSpeechRequestId=undefined;button.classList.remove('active');button.setAttribute('aria-pressed','false');return}
    const language=normalizedSpeechLanguage(result.detectedLanguage);const voice=selectLocalSpeechVoice(window.speechSynthesis.getVoices(),language);if(!voice){this.resultFeedback.textContent='当前没有可用的本地语音，原文没有发送到语音服务';return}
    window.speechSynthesis.cancel();this.activeSpeechRequestId=result.requestId;button.classList.add('active');button.setAttribute('aria-pressed','true');
    const utterance=new SpeechSynthesisUtterance(result.originalText);utterance.voice=voice;utterance.lang=voice.lang;
    const finish=()=>{if(this.activeSpeechRequestId!==result.requestId)return;this.activeSpeechRequestId=undefined;if(button.isConnected){button.classList.remove('active');button.setAttribute('aria-pressed','false')}};utterance.onend=finish;utterance.onerror=finish;window.speechSynthesis.speak(utterance);
  }

  private lexicalLookupElement(
    result:TranslateResult,
    renderLatex:boolean,
    onPerformance:(metrics:TranslationRenderPerformance)=>void,
  ):HTMLElement {
    const lookup=result.lexicalLookup!;const section=document.createElement('section');section.className='lexical-lookup';section.setAttribute('aria-label','短词和短语释义');
    const head=document.createElement('div');head.className='lexical-head';const sourceWrap=document.createElement('div');const source=document.createElement('div');source.className='lexical-source';source.textContent=result.originalText;sourceWrap.append(source);
    const meta=document.createElement('div');meta.className='lexical-meta';if(lookup.pronunciation){const pronunciation=document.createElement('span');pronunciation.textContent=lookup.pronunciation;meta.append(pronunciation)}if(lookup.partOfSpeech){const part=document.createElement('span');part.textContent=lookup.partOfSpeech;meta.append(part)}if(meta.childElementCount)sourceWrap.append(meta);head.append(sourceWrap);
    if(typeof window.speechSynthesis!=='undefined'&&typeof SpeechSynthesisUtterance!=='undefined'){const speak=this.button('朗读','lexical-speak','朗读原文');speak.prepend(this.speakerIcon());speak.setAttribute('aria-pressed','false');speak.addEventListener('click',()=>this.speakLookupSource(result,speak));head.append(speak)}section.append(head);
    const primary=document.createElement('div');primary.className='lexical-primary';const label=document.createElement('span');label.className='lexical-label';label.textContent='当前语境';const meaning=this.translatedTextElement(result.translatedText,'lexical-meaning',renderLatex,onPerformance);primary.append(label,meaning);section.append(primary);
    const normalizedPrimary=result.translatedText.trim().replace(/\s+/gu,' ').toLocaleLowerCase();const senses=lookup.senses.filter(sense=>sense.meaning.trim().replace(/\s+/gu,' ').toLocaleLowerCase()!==normalizedPrimary);if(senses.length){const list=document.createElement('div');list.className='lexical-senses';for(const sense of senses){const row=document.createElement('div');row.className='lexical-sense';const part=document.createElement('span');part.className='lexical-sense-pos';part.textContent=sense.partOfSpeech??lookup.partOfSpeech??'释义';const senseMeaning=document.createElement('span');senseMeaning.className='lexical-sense-meaning';senseMeaning.textContent=sense.meaning;row.append(part,senseMeaning);list.append(row)}section.append(list)}return section;
  }

  private recordResultRenderPerformance(
    result: TranslateResult,
    metrics: TranslationRenderPerformance,
  ): void {
    if (this.recordedRenderPerformance.has(result.requestId)) return;
    this.recordedRenderPerformance.add(result.requestId);
    if (this.recordedRenderPerformance.size > 100) {
      const oldest = this.recordedRenderPerformance.values().next().value as string | undefined;
      if (oldest) this.recordedRenderPerformance.delete(oldest);
    }
    void browser.runtime.sendMessage({
      type: 'RECORD_LOCAL_PERFORMANCE',
      payload: {
        operation: 'render-result',
        timings: {
          totalMs: metrics.textRenderMs + metrics.mathRenderMs,
          textRenderMs: metrics.textRenderMs,
          mathRenderMs: metrics.mathRenderMs,
        },
        ...(metrics.mathRenderFailed ? { errorCode: 'INVALID_RESPONSE' as const } : {}),
      },
    } satisfies RuntimeMessage).catch(() => undefined);
  }

  private translatedTextElement(
    text:string,
    className:string,
    renderLatex:boolean,
    onPerformance?: (metrics: TranslationRenderPerformance) => void,
  ):HTMLDivElement {
    const element=document.createElement('div');element.className=className;
    void renderTranslationContent(element,text,renderLatex,onPerformance);
    return element;
  }

  private appliedGlossaryTerms(result:TranslateResult):HTMLDetailsElement|undefined {
    const terms=result.appliedGlossaryTerms;if(!terms?.length)return undefined;
    const details=document.createElement('details');details.className='applied-terms';
    const summary=document.createElement('summary');summary.ariaLabel=`查看本次采用的 ${terms.length} 个术语`;
    const count=document.createElement('span');count.className='applied-term-count';count.textContent=`已采用术语 ${terms.length}`;
    const documentCount=terms.filter(term=>term.scope==='document').length;const globalCount=terms.length-documentCount;
    const scopes=document.createElement('span');scopes.className='applied-term-scope-summary';scopes.textContent=[documentCount?`本文 ${documentCount}`:'',globalCount?`全局 ${globalCount}`:''].filter(Boolean).join(' · ');
    summary.append(count,scopes);details.append(summary);
    const list=document.createElement('div');list.className='applied-term-list';
    for(const term of terms){const row=document.createElement('div');row.className='applied-term-row';const pair=document.createElement('div');pair.className='applied-term-pair';pair.title=`${term.source} → ${term.target}`;const source=document.createElement('span');source.className='applied-term-source';source.textContent=term.source;const arrow=document.createElement('span');arrow.className='applied-term-arrow';arrow.textContent='→';const target=document.createElement('span');target.className='applied-term-target';target.textContent=term.target;pair.append(source,arrow,target);const actions=document.createElement('div');actions.className='applied-term-actions';const scope=document.createElement('span');scope.className='applied-term-scope';scope.textContent=term.scope==='document'?'本文':'全局';const edit=this.button('调整','applied-term-edit',term.scope==='document'?`调整本文术语 ${term.source}`:`在设置中调整全局术语 ${term.source}`);if(term.scope==='document'){edit.addEventListener('click',()=>this.openDocumentMemory(term.source))}else this.bindSettingsButton(edit,'glossary');actions.append(scope,edit);row.append(pair,actions);list.append(row)}
    details.append(list);return details;
  }

  private glossaryTermsNeedingReview(result:TranslateResult):HTMLDetailsElement|undefined {
    const terms=result.glossaryTermsNeedingReview;if(!terms?.length)return undefined;
    const details=document.createElement('details');details.className='glossary-review';
    const summary=document.createElement('summary');summary.ariaLabel=`查看 ${terms.length} 个待核对术语`;
    const count=document.createElement('span');count.className='glossary-review-count';count.textContent=`术语待核对 ${terms.length}`;
    const documentCount=terms.filter(term=>term.scope==='document').length;const globalCount=terms.length-documentCount;
    const scopes=document.createElement('span');scopes.className='applied-term-scope-summary';scopes.textContent=[documentCount?`本文 ${documentCount}`:'',globalCount?`全局 ${globalCount}`:''].filter(Boolean).join(' · ');
    summary.append(count,scopes);details.append(summary);
    const intro=document.createElement('div');intro.className='glossary-review-intro';intro.textContent='原文出现了固定术语，但当前译文中未找到对应目标译法；同义表达也可能触发，请按需核对。';details.append(intro);
    const list=document.createElement('div');list.className='applied-term-list';
    for(const term of terms){const row=document.createElement('div');row.className='applied-term-row glossary-review-row';const pair=document.createElement('div');pair.className='applied-term-pair';pair.title=`${term.source} → ${term.target}`;const source=document.createElement('span');source.className='applied-term-source';source.textContent=term.source;const arrow=document.createElement('span');arrow.className='applied-term-arrow';arrow.textContent='→';const target=document.createElement('span');target.className='applied-term-target';target.textContent=term.target;pair.append(source,arrow,target);const actions=document.createElement('div');actions.className='applied-term-actions';const scope=document.createElement('span');scope.className='applied-term-scope';scope.textContent=term.scope==='document'?'本文':'全局';actions.append(scope);if(this.actions.onSaveTranslationEdit&&result.requestId===this.latestRequestId){const correct=this.button('修正','applied-term-edit',`本地修正术语 ${term.source}`);correct.addEventListener('click',()=>this.openTranslationCorrection(result,correct,term));actions.append(correct)}const manage=this.button('管理','applied-term-edit',term.scope==='document'?`管理本文术语 ${term.source}`:`在设置中管理全局术语 ${term.source}`);if(term.scope==='document')manage.addEventListener('click',()=>this.openDocumentMemory(term.source));else this.bindSettingsButton(manage,'glossary');actions.append(manage);row.append(pair,actions);list.append(row)}
    details.append(list);return details;
  }

  private renderResult(result:TranslateResult,announceCompletion=false):void {
    this.rememberVisibleResultReadingPosition();this.finishActiveProgressFeedback();const renderRevision=++this.resultRenderRevision;result=normalizeResultForPresentation(result,this.normalizeFormulaPresentation);this.currentResult=result;this.rememberResultViewMode(result,this.alignedView);const lexicalView=this.shouldRenderLexicalLookup(result);if(announceCompletion){this.resultFeedback.textContent='';window.requestAnimationFrame(()=>{if(this.isShowingCard()&&this.currentResult?.requestId===result.requestId)this.resultFeedback.textContent=lexicalView?'查词完成，语境释义已显示':'翻译完成，译文已显示'})}const surface=this.surface(lexicalView?'简明释义':'翻译结果');surface.dataset.state='complete';surface.classList.add('result-surface');const scroll=document.createElement('div');scroll.className='result-scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.ariaLabel=lexicalView?'短词和短语释义':'译文内容';scroll.setAttribute('aria-keyshortcuts','Home End PageUp PageDown');scroll.dataset.readingKey=this.resultReadingPositionKey(result);scroll.addEventListener('scroll',()=>{if(!scroll.isConnected||this.root.querySelector('.result-scroll')!==scroll)return;this.rememberResultReadingPosition(scroll.dataset.readingKey!,scroll);this.updateResultReadingControls(scroll)},{passive:true});scroll.addEventListener('keydown',event=>{if(event.target!==scroll||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!['Home','End'].includes(event.key))return;event.preventDefault();this.scrollResultToEdge(event.key==='Home'?'top':'bottom')});const tools=surface.querySelector<HTMLElement>('.header-tools');
    const navigationHistory=this.navigationHistory();this.historyIndex=navigationHistory.findIndex(entry=>entry.requestId===result.requestId);
    if(tools&&this.sidebarActive&&this.history.some(entry=>this.actions.hasSourceMarksForResult?.(entry))){const filter=this.button('','icon mark-filter','仅查看已标记翻译');filter.dataset.piFocusKey='marked-filter';filter.append(this.markerIcon());filter.classList.toggle('active',this.markedOnly);filter.setAttribute('aria-pressed',String(this.markedOnly));filter.addEventListener('click',()=>this.toggleMarkedFilter());tools.prepend(filter)}
    const versions=this.versionsFor(result);const versionIndex=versions.findIndex(version=>version.requestId===result.requestId);const comparisonDirection: 'older'|'newer'=versionIndex<versions.length-1?'older':'newer';const comparisonVersion=versions.length>1&&versionIndex>=0?versions[comparisonDirection==='older'?versionIndex+1:versionIndex-1]:undefined;const versionChange=comparisonVersion?summarizeTranslationVersionChange(result,comparisonVersion):undefined;const changedVersionSegments=new Set(versionChange?.changedSegmentIds??[]);const versionContextElement=versionChange?this.versionContext(result,versionChange,comparisonDirection):undefined;if(tools&&versions.length>1&&versionIndex>=0){const navigation=document.createElement('div');navigation.className='navigation-group version-navigation';navigation.setAttribute('role','group');navigation.ariaLabel='译文版本导航';const older=this.button('‹','icon','查看上一版译文');older.dataset.piFocusKey='older-version';older.disabled=versionIndex>=versions.length-1;older.addEventListener('click',()=>this.navigateVersion(result,1));const counter=document.createElement('span');counter.className='counter version-counter';counter.textContent=`v${versionIndex+1}/${versions.length}`;counter.setAttribute('role','status');counter.ariaLabel=`第 ${versionIndex+1} 版，共 ${versions.length} 版`;const newer=this.button('›','icon','查看下一版译文');newer.dataset.piFocusKey='newer-version';newer.disabled=versionIndex<=0;newer.addEventListener('click',()=>this.navigateVersion(result,-1));navigation.append(older,counter,newer);tools.prepend(navigation);tools.classList.add('has-version-navigation')}
    if(tools&&navigationHistory.length>1&&this.historyIndex>=0){const navigation=document.createElement('div');navigation.className='navigation-group history-navigation';navigation.setAttribute('role','group');navigation.ariaLabel='翻译历史导航';const older=this.button('‹','icon','上一条翻译（Alt+↑）');older.dataset.piFocusKey='older-translation';older.disabled=this.historyIndex>=navigationHistory.length-1;older.addEventListener('click',()=>this.navigate(1));const counter=this.button(`${this.historyIndex+1}/${navigationHistory.length}`,'counter history-counter history-open','查看和搜索翻译历史（Alt+/）');counter.dataset.piFocusKey='history-open';counter.setAttribute('aria-keyshortcuts','Alt+/');counter.ariaLabel=`第 ${this.historyIndex+1} 条，共 ${navigationHistory.length} 条`;counter.addEventListener('click',()=>this.openHistoryNavigator());const newer=this.button('›','icon','下一条翻译（Alt+↓）');newer.dataset.piFocusKey='newer-translation';newer.disabled=this.historyIndex<=0;newer.addEventListener('click',()=>this.navigate(-1));navigation.append(older,counter,newer);tools.prepend(navigation);tools.classList.add('has-history-navigation')}
    if(tools?.classList.contains('has-version-navigation')&&tools.classList.contains('has-history-navigation'))tools.classList.add('dense-navigation');
    const topLine=document.createElement('div');topLine.className='result-topline';const meta=document.createElement('div');meta.className='meta';if(result.sourceKind==='image-region'||result.sourceKind==='pdf-region-text'){const sourceKind=document.createElement('span');sourceKind.className='source-badge';sourceKind.textContent=result.sourceKind==='image-region'?'图像识别':'文字提取';meta.append(sourceKind)}if(result.sourceHost){const host=document.createElement('span');host.className='source-host';host.textContent=result.sourceHost;host.title=result.sourceHost;meta.append(host)}if(result.sourceLocation&&this.actions.onNavigateToPdfRegion){const location=this.button(`第 ${result.sourceLocation.pageNumber} 页`,'source-location','返回 PDF 原选区');location.addEventListener('click',()=>this.actions.onNavigateToPdfRegion?.(result.sourceLocation!));meta.append(location)}if(result.completedAt){const time=document.createElement('span');time.className='meta-dot';time.textContent=formatTranslationClockTime(result.completedAt);meta.append(time)}const duration=result.cached?undefined:formatTranslationDuration(result.latencyMs);if(duration){const latency=document.createElement('span');latency.className='meta-dot';latency.textContent=duration;meta.append(latency)}if(result.cached){const cache=document.createElement('span');cache.className='cache-badge';cache.textContent='会话缓存';meta.append(cache)}if(result.contextUsed){const context=document.createElement('span');context.className='cache-badge';context.textContent='含上下文';meta.append(context)}if((result.chunkCount??1)>1){const chunks=document.createElement('span');chunks.className='meta-dot';chunks.textContent=`${result.chunkCount} 段`;meta.append(chunks)}if(meta.childElementCount)topLine.append(meta);
    const viewControls=document.createElement('div');viewControls.className='result-view-controls';if(result.lexicalLookup){const lookupToggle=this.button(lexicalView?'译文':'释义',`view-button lexical-view${lexicalView?' active':''}`,lexicalView?'按普通译文方式查看':'返回短词和短语释义');lookupToggle.dataset.piFocusKey='lexical-view';lookupToggle.setAttribute('aria-pressed',String(lexicalView));lookupToggle.addEventListener('click',()=>{this.setLexicalView(result,!lexicalView);this.renderResult(result)});viewControls.append(lookupToggle)}if(!lexicalView&&result.alignedSegments?.length){const switcher=document.createElement('div');switcher.className='view-switch';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','译文显示方式');const full=this.button('全文',`view-button${this.alignedView?'':' active'}`,'显示完整译文');full.dataset.piFocusKey='full-view';const aligned=this.button('逐句',`view-button${this.alignedView?' active':''}`,'显示逐句对照');aligned.dataset.piFocusKey='aligned-view';full.setAttribute('aria-pressed',String(!this.alignedView));aligned.setAttribute('aria-pressed',String(this.alignedView));full.addEventListener('click',()=>{this.alignedView=false;this.rememberResultViewMode(result,false);this.renderResult(result)});aligned.addEventListener('click',()=>{this.alignedView=true;this.rememberResultViewMode(result,true);this.renderResult(result)});switcher.append(full,aligned);viewControls.append(switcher)}if(this.resultContainsLatex(result)){const rendered=this.shouldRenderLatex(result);const formulaView=this.button(rendered?'源码':'公式',`view-button formula-view${rendered?' active':''}`,rendered?'显示可编辑的 LaTeX 源码':'渲染译文中的 LaTeX 公式');formulaView.dataset.piFocusKey='formula-view';formulaView.setAttribute('aria-pressed',String(rendered));formulaView.addEventListener('click',()=>{this.latexViewOverrides.set(result.requestId,!rendered);this.renderResultPreservingScroll(result)});viewControls.append(formulaView)}if(viewControls.childElementCount)topLine.append(viewControls);if(topLine.childElementCount)scroll.append(topLine);
    const appliedTerms=this.appliedGlossaryTerms(result);if(appliedTerms)scroll.append(appliedTerms);
    const glossaryReview=this.glossaryTermsNeedingReview(result);if(glossaryReview)scroll.append(glossaryReview);
    if(result.sourceKind==='image-region'||result.sourceKind==='pdf-region-text')scroll.append(this.recognizedSource(result,result.sourceKind==='image-region'?'查看识别原文':'查看提取原文'));
    const renderLatex=this.shouldRenderLatex(result);
    const renderIdentity=renderLatex&&this.resultContainsLatex(result)?{requestId:result.requestId,revisionKey:renderRevision}:undefined;
    if(renderIdentity)this.beginProgressFeedback(renderIdentity,'rendering');
    const onRenderPerformance=(metrics:TranslationRenderPerformance)=>{this.recordResultRenderPerformance(result,metrics);if(renderIdentity)this.finishProgressFeedback(renderIdentity)};
    if(lexicalView){scroll.append(this.lexicalLookupElement(result,renderLatex,onRenderPerformance))
    }else if(this.alignedView&&result.alignedSegments?.length){
      const list=document.createElement('div');list.className='aligned-list';
      const renderTargets:TranslationContentTarget[]=[];
      for(const [segmentIndex,segment] of result.alignedSegments.entries()){
        const row=document.createElement('section');row.className='segment';row.tabIndex=0;row.dataset.segmentId=segment.id;if(changedVersionSegments.has(segment.id)){row.classList.add('version-changed');row.dataset.versionChanged='true';const changedNotice=document.createElement('span');changedNotice.className='sr-only';changedNotice.textContent='此句在相邻版本中有改动';row.append(changedNotice)}
        const num=document.createElement('span');num.className='segment-number';num.textContent=String(segmentIndex+1);
        const content=document.createElement('div');
        const pair=document.createElement('div');pair.className='segment-pair';
        const sourceColumn=document.createElement('div');sourceColumn.className='segment-source-column';const source=document.createElement('div');source.className='segment-source';source.textContent=segment.originalText;const sourceKey=`${result.requestId}:${segment.id}`;if(segment.originalText.length>420){const sourceId=`pi-segment-source-${renderRevision}-${segmentIndex}`;source.id=sourceId;source.classList.add('collapsible');const expanded=this.expandedAlignedSources.has(sourceKey);source.classList.toggle('expanded',expanded);const toggle=this.button(expanded?'收起原文':'展开原文','segment-source-toggle',expanded?'收起完整原文':'展开完整原文');toggle.setAttribute('aria-controls',sourceId);toggle.setAttribute('aria-expanded',String(expanded));toggle.addEventListener('click',()=>{const next=!source.classList.contains('expanded');source.classList.toggle('expanded',next);toggle.textContent=next?'收起原文':'展开原文';toggle.title=next?'收起完整原文':'展开完整原文';toggle.ariaLabel=toggle.title;toggle.setAttribute('aria-expanded',String(next));if(next)this.expandedAlignedSources.add(sourceKey);else this.expandedAlignedSources.delete(sourceKey)});sourceColumn.append(source,toggle)}else sourceColumn.append(source);
        const target=document.createElement('div');target.className='segment-target';
        renderTargets.push({container:target,text:segment.translatedText,renderLatex});
        pair.append(sourceColumn,target);
        const actions=document.createElement('div');actions.className='segment-actions';
        const copy=this.button('复制','mini','复制本句译文');copy.addEventListener('click',()=>this.copyWithFeedback(copy,normalizeLatexForClipboard(segment.translatedText),'已复制','本句译文已复制到剪贴板'));
        actions.append(copy);
        if(this.actions.onSaveSegmentTranslationEdit&&result.requestId===this.latestRequestId){const correct=this.button('修正','mini segment-correct','只修正本句，不调用 API');correct.addEventListener('click',()=>this.openSegmentCorrection(result,segment,segmentIndex+1,content,pair,actions,correct));actions.append(correct)}
        if(this.actions.canMarkSource?.(result,segment)){
          const mark=this.button('','mini segment-mark',this.actions.isSourceMarked?.(result,segment)?'取消本句标记':'轻标记本句');
          mark.dataset.piFocusKey=`segment-mark:${segment.id}`;
          mark.append(this.markerIcon());
          mark.classList.toggle('active',Boolean(this.actions.isSourceMarked?.(result,segment)));
          mark.setAttribute('aria-pressed',String(Boolean(this.actions.isSourceMarked?.(result,segment))));
          mark.addEventListener('click',()=>this.toggleSegmentSourceMark(result,segment));
          actions.append(mark);
        }
        content.append(pair,actions);row.append(num,content);list.append(row);
      }
      void renderTranslationContents(
        renderTargets,
        onRenderPerformance,
      );
      scroll.append(list);
    }else{scroll.append(this.translatedTextElement(
      result.translatedText,
      'body',
      renderLatex,
      onRenderPerformance,
    ))}
    if(result.uncertainSpans?.length){const uncertain=document.createElement('div');uncertain.className='uncertain-note';uncertain.textContent=result.formulaNeedsReview?'公式未能自动通过结构校验，已保留可用译文，请核对 LaTeX。':`有 ${result.uncertainSpans.length} 处内容无法完全确认，已在原文中标记。`;scroll.append(uncertain)}
    if(result.warnings.length){const warning=document.createElement('div');warning.className='warning';warning.textContent='部分 LaTeX 使用了保守保护策略，请复制后检查。';scroll.append(warning)}
    const footer=document.createElement('div');footer.className='footer result-footer';const copy=this.button('复制译文','action copy-action','复制译文（保留标准 LaTeX）');copy.dataset.piFocusTarget='true';copy.addEventListener('click',()=>this.copyWithFeedback(copy,normalizeLatexForClipboard(result.translatedText),'已复制','译文已复制到剪贴板'));footer.append(copy);if(this.actions.onSaveTranslationEdit&&result.requestId===this.latestRequestId){const correction=this.button('修正','action correction-action','修正译文');correction.addEventListener('click',()=>this.openTranslationCorrection(result,correction));footer.append(correction)}if(this.correctionUndo?.correctedRequestId===result.requestId&&this.actions.onUndoTranslationEdit){const notice=document.createElement('span');notice.className='correction-undo';notice.setAttribute('role','status');const message=document.createElement('span');message.className='correction-undo-message';message.textContent='已修正 ·';const undo=this.button('撤销','','撤销上次译文修正');undo.addEventListener('click',()=>this.undoTranslationCorrection(result,notice));notice.append(message,undo);footer.append(notice)}if(this.actions.onToggleSourceMark){const markable=Boolean(this.actions.canMarkSource?.(result));const marked=Boolean(this.actions.isSourceMarked?.(result));const mark=this.button(marked?'已标记':'标记','mark-action');mark.dataset.piFocusKey='source-mark';mark.prepend(this.markerIcon());mark.classList.toggle('active',marked);mark.classList.toggle('needs-anchor',!markable&&!marked);mark.setAttribute('aria-pressed',String(marked));mark.title=marked?'取消原文标记':markable?'标记原文，悬停查看译文':'保持或重新选中对应原文，然后点击标记';mark.ariaLabel=mark.title;mark.addEventListener('pointerdown',event=>event.preventDefault());mark.addEventListener('click',()=>this.toggleSourceMark(result));footer.append(mark)}const readingNavigation=document.createElement('div');readingNavigation.className='result-reading-nav';readingNavigation.hidden=true;readingNavigation.setAttribute('role','group');readingNavigation.ariaLabel='长译文阅读导航';const readingProgress=document.createElement('span');readingProgress.className='reading-progress';readingProgress.textContent='顶部';const readingTop=this.button('↑','reading-jump reading-top','回到译文顶部（Home）');readingTop.setAttribute('aria-keyshortcuts','Home');readingTop.addEventListener('click',()=>this.scrollResultToEdge('top'));const readingBottom=this.button('↓','reading-jump reading-bottom','前往译文底部（End）');readingBottom.setAttribute('aria-keyshortcuts','End');readingBottom.addEventListener('click',()=>this.scrollResultToEdge('bottom'));readingNavigation.append(readingProgress,readingTop,readingBottom);footer.append(readingNavigation,this.moreMenu(result));if(versionContextElement)surface.append(versionContextElement);surface.append(scroll,footer);this.showSurface(surface);this.restoreResultReadingPosition(result);this.updateResultReadingControls(scroll);requestAnimationFrame(()=>this.updateResultReadingControls(scroll));
  }

  private moreMenu(result:TranslateResult):HTMLElement {
    const details=document.createElement('details');details.className='more';const summary=document.createElement('summary');summary.textContent='•••';summary.title='更多操作';summary.ariaLabel='更多翻译操作';const menu=document.createElement('div');menu.className='menu';
    const versions=this.versionsFor(result);const versionIndex=versions.findIndex(version=>version.requestId===result.requestId);
    if(result.requestId===this.latestRequestId){if(this.actions.onAdjustTranslation)menu.append(this.menuButton('让模型调整…',()=>this.openModelAdjustment(result)));if(this.actions.canAdjustWebRegion?.(result)&&this.actions.onAdjustWebRegion&&this.actions.onReselectWebRegion){menu.append(this.menuButton('调整区域',()=>this.actions.onAdjustWebRegion?.(result)),this.menuButton('重新框选',()=>this.actions.onReselectWebRegion?.(result)))}const repeatLabel=result.sourceKind==='image-region'?'重新识别此区域':'重新翻译';menu.append(this.menuButton(repeatLabel,()=>this.actions.onRetry({kind:'result',result,intent:'repeat'})));if(result.sourceLocation&&this.actions.onAdjustPdfRegion)menu.append(this.menuButton('调整原选区',()=>this.beginPdfRegionAdjustment()))}else if(versionIndex>0&&this.actions.onSaveTranslationEdit){menu.append(this.menuButton('采用当前版本',()=>this.adoptTranslationVersion(result)))}
    const markerCount=this.actions.getSourceMarkSummaries?.().length??0;if(markerCount&&this.actions.canPersistSourceMarks?.())menu.append(this.menuButton(`查看本文标记（${markerCount}）`,()=>this.openMarkerNavigator()));
    if(this.actions.hasAnySourceMarks?.()&&this.actions.onCopyMarkedNotes){menu.append(this.menuButton('复制标记笔记',()=>{void this.actions.onCopyMarkedNotes?.().then((count)=>{const button=menu.querySelector<HTMLButtonElement>('[data-mark-export]');if(button)this.flashButtonFeedback(button,`已复制 ${count} 条标记`)}).catch(()=>{const button=menu.querySelector<HTMLButtonElement>('[data-mark-export]');if(button)this.flashButtonFeedback(button,'复制失败',3200)})}));const exportButton=menu.lastElementChild;if(exportButton instanceof HTMLElement)exportButton.dataset.markExport='true'}
    if(this.actions.canPersistSourceMarks?.()&&this.actions.onSetSourceMarkPersistence){
      const enabled=Boolean(this.actions.isSourceMarkPersistenceEnabled?.());
      const markCurrent=!enabled&&Boolean(this.actions.canMarkSource?.(result))&&!Boolean(this.actions.isSourceMarked?.(result));
      menu.append(this.menuButton(enabled?'停止保存本文标记':markCurrent?'标记当前译句并保存':'保存本文标记',()=>{if(markCurrent)this.actions.onToggleSourceMark?.(result);void this.actions.onSetSourceMarkPersistence?.(!enabled).then(()=>this.renderResult(result))}));
      if((this.actions.hasAnySourceMarks?.()||this.actions.hasStoredSourceMarks?.())&&this.actions.onClearSourceMarks){
        const clearMarks=this.menuButton('清除本文标记',()=>{
          if(clearMarks.dataset.confirmClear!=='true'){
            clearMarks.dataset.confirmClear='true';clearMarks.textContent='再次点击清除全部';clearMarks.ariaLabel='再次点击清除全部本文标记';return;
          }
          clearMarks.disabled=true;
          void this.actions.onClearSourceMarks!().then(()=>{
            this.renderResult(result);
            queueMicrotask(()=>this.root.querySelector<HTMLElement>('details.more > summary')?.focus({preventScroll:true}));
          }).catch(()=>{
            clearMarks.disabled=false;delete clearMarks.dataset.confirmClear;clearMarks.textContent='清除本文标记';clearMarks.ariaLabel='清除本文标记';
            this.flashButtonFeedback(clearMarks,'清除失败',3200);
          });
        });
        clearMarks.addEventListener('blur',()=>{if(clearMarks.dataset.confirmClear==='true'&&!clearMarks.disabled){delete clearMarks.dataset.confirmClear;clearMarks.textContent='清除本文标记';clearMarks.ariaLabel='清除本文标记'}});
        menu.append(clearMarks);
      }
    }
    const languageLabel=document.createElement('label');languageLabel.textContent='目标语言';const language=document.createElement('select');for(const [value,label] of LANGUAGES){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===this.preferences.targetLanguage;language.append(option)}languageLabel.append(language);menu.append(languageLabel);
    language.addEventListener('change',()=>{this.preferences={...this.preferences,targetLanguage:language.value};this.actions.onPreferencesChange({targetLanguage:language.value,style:this.preferences.style});details.open=false;this.actions.onRetry({kind:'result',result,intent:'language-change'})});
    if(this.actions.onOpenBrowserSidebar){if(this.sidebarActive||this.preferences.sidebarMode==='floating'){const browserSidebar=this.menuButton('在浏览器侧栏中显示',()=>this.openBrowserSidebarFromControl(result,browserSidebar));menu.append(browserSidebar)}else{menu.append(this.menuButton('在页面侧栏中显示',()=>this.openSidebar()))}}
    if(this.sidebarActive&&this.actions.onPauseSite)menu.append(this.menuButton('暂停本网站连续翻译',()=>void this.actions.onPauseSite?.().then(()=>this.closeSurface()).catch(()=>{this.resultFeedback.textContent='暂停失败，请在扩展面板重试'})));const settings=this.menuButton('完整设置',()=>{details.open=false});this.bindSettingsButton(settings);menu.append(settings);details.append(summary,menu);details.addEventListener('toggle',()=>{const surface=details.closest<HTMLElement>('.surface');surface?.classList.toggle('menu-open',details.open);if(details.open){this.placeMoreMenu(details,menu);requestAnimationFrame(()=>this.placeMoreMenu(details,menu))}});return details;
  }

  private openSegmentCorrection(
    result:TranslateResult,
    segment:TranslationSegment,
    segmentNumber:number,
    content:HTMLElement,
    pair:HTMLElement,
    segmentActions:HTMLElement,
    trigger:HTMLButtonElement,
  ):void {
    if(!this.actions.onSaveSegmentTranslationEdit)return;
    const session=createManualCorrectionSession({translatedText:segment.translatedText,sourceText:segment.originalText});
    const draft=createManualCorrectionDraft(session);
    const editEpoch=this.translationEpoch;const editRequestId=this.latestRequestId;
    const editor=document.createElement('div');editor.className='segment-correction';editor.setAttribute('role','group');editor.setAttribute('aria-label',`修正第 ${segmentNumber} 句，公式已锁定`);
    const inputs=new Map<string,HTMLTextAreaElement>();let textPartNumber=0,formulaNumber=0;
    for(const part of draft.parts){if(part.kind==='text'){if(!part.text.length)continue;textPartNumber+=1;const input=document.createElement('textarea');input.className='correction-text-part';input.value=part.text;input.maxLength=24000;input.setAttribute('aria-label',`可编辑本句译文第 ${textPartNumber} 段`);inputs.set(part.id,input);editor.append(input)}else{formulaNumber+=1;const locked=document.createElement('div');locked.className='correction-latex';locked.textContent=part.text;locked.setAttribute('role','textbox');locked.setAttribute('aria-readonly','true');locked.setAttribute('aria-label',`受保护公式 ${formulaNumber}，不可编辑`);locked.tabIndex=0;editor.append(locked)}}
    const controls=document.createElement('div');controls.className='segment-correction-actions';const status=document.createElement('span');status.className='segment-correction-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');const cancel=this.button('取消','mini correction-cancel');const save=this.button('保存','mini segment-correction-save');controls.append(status,cancel,save);editor.append(controls);pair.hidden=true;segmentActions.hidden=true;content.append(editor);
    const setStatus=(message:string,isError=false)=>{status.textContent=message;status.classList.toggle('is-error',isError);status.setAttribute('role',isError?'alert':'status')};
    const showSaveFailure=(message:string)=>{setStatus(message,true);save.textContent='重试';queueMicrotask(()=>{status.scrollIntoView({block:'nearest'});save.focus({preventScroll:true})})};
    const resetSaveError=()=>{if(!status.classList.contains('is-error'))return;setStatus('');save.textContent='保存'};for(const input of inputs.values())input.addEventListener('input',resetSaveError);
    const restoreFocus=()=>{this.renderResultPreservingScroll(result);queueMicrotask(()=>{const row=[...this.root.querySelectorAll<HTMLElement>('.segment')].find(candidate=>candidate.dataset.segmentId===segment.id);(row?.querySelector<HTMLButtonElement>('.segment-correct')??row??trigger).focus({preventScroll:true})})};
    cancel.addEventListener('click',restoreFocus);
    editor.addEventListener('keydown',(event)=>{if(event.key!=='Escape')return;event.preventDefault();restoreFocus()});
    save.addEventListener('click',()=>{const edits:ManualCorrectionEdit[]=[...inputs].map(([partId,input])=>({partId,text:input.value}));let corrected:string;try{corrected=applyManualCorrection(session,{revision:draft.revision,edits}).correction.correctedTranslation}catch(error){setStatus(error instanceof ManualCorrectionError?(error.code==='NO_CHANGES'?'本句译文没有变化':error.code==='LATEX_CHANGED'?'公式已锁定，请只修改文字':'修正内容不完整，请检查'):error instanceof Error?error.message:'无法保存本句修正',true);return}const viewportOffset=this.segmentViewportOffset(segment.id);save.textContent='保存';save.disabled=true;cancel.disabled=true;for(const input of inputs.values())input.disabled=true;editor.setAttribute('aria-busy','true');setStatus('正在保存…');void this.actions.onSaveSegmentTranslationEdit!(result,segment.id,segment.translatedText,corrected).then((response)=>{if(this.translationEpoch!==editEpoch||this.latestRequestId!==editRequestId)return;this.correctionUndo=response.correctionReceipt;this.showResult(response.result,undefined,response.history,true);this.restoreSegmentReadingPosition(response.result,segment.id,viewportOffset)}).catch((error:unknown)=>{save.disabled=false;cancel.disabled=false;for(const input of inputs.values())input.disabled=false;editor.removeAttribute('aria-busy');showSaveFailure(error instanceof Error?error.message:'保存失败，请重试')})});
    queueMicrotask(()=>{(inputs.values().next().value??cancel).focus()});
  }

  private openTranslationCorrection(
    result:TranslateResult,
    trigger:HTMLButtonElement,
    guidanceTerm?:ScopedGlossaryTerm,
  ):void {
    if(!this.actions.onSaveTranslationEdit)return;
    const session=createManualCorrectionSession({translatedText:result.translatedText,sourceText:result.originalText});
    const draft=createManualCorrectionDraft(session);
    const editEpoch=this.translationEpoch;const editRequestId=this.latestRequestId;
    const surface=this.surface('修正译文');surface.querySelector('.pin-action')?.remove();const panel=document.createElement('div');panel.className='revision-panel';
    const editor=document.createElement('div');editor.className='correction-editor';editor.setAttribute('role','group');editor.setAttribute('aria-label','修正译文，公式已锁定');
    const inputs=new Map<string,HTMLTextAreaElement>();let textPartNumber=0,formulaNumber=0;
    for(const part of draft.parts){if(part.kind==='text'){if(!part.text.length)continue;textPartNumber+=1;const input=document.createElement('textarea');input.className='correction-text-part';input.value=part.text;input.maxLength=24000;input.dataset.partId=part.id;input.setAttribute('aria-label',`可编辑译文第 ${textPartNumber} 段`);inputs.set(part.id,input);editor.append(input)}else{formulaNumber+=1;const locked=document.createElement('div');locked.className='correction-latex';locked.dataset.partId=part.id;locked.setAttribute('aria-label',`受保护公式 ${formulaNumber}，不可编辑`);locked.setAttribute('role','textbox');locked.setAttribute('aria-readonly','true');locked.tabIndex=0;locked.textContent=part.text;editor.append(locked)}}panel.append(editor);
    const note=document.createElement('p');note.className='revision-note';note.id='pi-translation-correction-note';note.textContent=guidanceTerm?`请核对“${guidanceTerm.source}”的译法，并在需要时调整为“${guidanceTerm.target}”。保存修改不会调用 API。`:formulaNumber?'公式片段已锁定；保存只更新自然语言，不调用 API。':'保存修改不会调用 API。';if(guidanceTerm&&formulaNumber)note.textContent+=' 公式片段仍保持锁定。';if(result.alignedSegments?.length)note.textContent+=' 保存整段修正后将退出逐句对照。';panel.append(note);
    const scopeLabel=document.createElement('label');scopeLabel.className='revision-scope';const scopeText=document.createElement('span');scopeText.textContent='译文保存';const scope=document.createElement('select');scope.ariaLabel='修正译文的保存范围';for(const [value,label] of [['current','仅本次'],['document','记住本文']] as const){const option=document.createElement('option');option.value=value;option.textContent=label;scope.append(option)}scopeLabel.append(scopeText,scope);panel.append(scopeLabel);
    const termDisclosure=document.createElement('details');termDisclosure.className='correction-term-disclosure';const termSummary=document.createElement('summary');termSummary.textContent='＋ 固定术语（可选）';const termFields=document.createElement('fieldset');termFields.className='correction-term-fields';const sourceLabel=document.createElement('label');sourceLabel.textContent='原文术语';const source=document.createElement('input');source.maxLength=120;source.placeholder='例如 adaptive sensing';source.ariaLabel='原文术语';sourceLabel.append(source);const targetLabel=document.createElement('label');targetLabel.textContent='固定译法';const target=document.createElement('input');target.maxLength=120;target.placeholder='例如 自适应感知';target.ariaLabel='固定译法';targetLabel.append(target);const termScopeLabel=document.createElement('label');termScopeLabel.className='correction-term-scope';termScopeLabel.append('保存到');const termScope=document.createElement('select');termScope.ariaLabel='术语保存范围';for(const [value,label] of [['document','本文'],['global','全局']] as const){const option=document.createElement('option');option.value=value;option.textContent=label;termScope.append(option)}termScopeLabel.append(termScope);termFields.append(sourceLabel,targetLabel,termScopeLabel);termDisclosure.append(termSummary,termFields);panel.append(termDisclosure);
    const actions=document.createElement('div');actions.className='revision-actions';const status=document.createElement('span');status.className='revision-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');const cancel=this.button('取消','action correction-cancel');const save=this.button('保存','action primary correction-save');actions.append(status,cancel,save);panel.append(actions);
    status.id='pi-translation-correction-status';for(const input of inputs.values())input.setAttribute('aria-describedby',`${note.id} ${status.id}`);source.setAttribute('aria-describedby',status.id);target.setAttribute('aria-describedby',status.id);
    const setStatus=(message:string,isError=false)=>{status.textContent=message;status.classList.toggle('is-error',isError);status.setAttribute('role',isError?'alert':'status')};
    const showSaveFailure=(message:string)=>{setStatus(message,true);save.textContent='重试';queueMicrotask(()=>{status.scrollIntoView({block:'nearest'});save.focus({preventScroll:true})})};
    const resetSaveError=()=>{if(!status.classList.contains('is-error'))return;setStatus('');save.textContent='保存'};for(const input of inputs.values())input.addEventListener('input',resetSaveError);
    const clearTermErrors=()=>{source.removeAttribute('aria-invalid');target.removeAttribute('aria-invalid')};
    const updateTermSummary=()=>{const hasSource=Boolean(source.value.trim());const hasTarget=Boolean(target.value.trim());termDisclosure.classList.toggle('has-value',hasSource&&hasTarget);termDisclosure.classList.toggle('has-error',hasSource!==hasTarget);termSummary.textContent=hasSource&&hasTarget?'✓ 已填写固定术语':hasSource!==hasTarget?'！固定术语待补充':'＋ 固定术语（可选）'};
    const showTermValidationFailure=()=>{const sourceMissing=!source.value.trim();const targetMissing=!target.value.trim();const pairInvalid=!sourceMissing&&!targetMissing;source.setAttribute('aria-invalid',String(sourceMissing||pairInvalid));target.setAttribute('aria-invalid',String(targetMissing||pairInvalid));termDisclosure.classList.remove('has-value');termDisclosure.classList.add('has-error');termSummary.textContent='！固定术语需检查';termDisclosure.open=true;queueMicrotask(()=>(sourceMissing?source:targetMissing?target:source).focus({preventScroll:true}))};
    const focusFirstTextPart=()=>queueMicrotask(()=>(inputs.values().next().value??scope).focus());
    const onTermInput=()=>{clearTermErrors();updateTermSummary();resetSaveError()};source.addEventListener('input',onTermInput);target.addEventListener('input',onTermInput);
    cancel.addEventListener('click',()=>{this.renderResult(result);queueMicrotask(()=>{(this.root.querySelector<HTMLButtonElement>('.correction-action')??trigger).focus()})});
    save.addEventListener('click',()=>{const selectedScope=scope.value as TranslationMemoryScope;const edits:ManualCorrectionEdit[]=[...inputs].map(([partId,input])=>({partId,text:input.value}));const hasTermInput=Boolean(source.value.trim()||target.value.trim());const explicitTermCandidate=hasTermInput?{source:source.value,target:target.value}:undefined;let corrected:string;let term:TranslationCorrectionTermInput|undefined;clearTermErrors();try{const applied=applyManualCorrection(session,{revision:draft.revision,edits,...(explicitTermCandidate?{explicitTermCandidate}:{})});corrected=applied.correction.correctedTranslation;term=applied.correction.termCandidateDraft?{source:applied.correction.termCandidateDraft.source,target:applied.correction.termCandidateDraft.target,scope:termScope.value as TranslationCorrectionTermInput['scope']}:undefined}catch(error){setStatus(error instanceof ManualCorrectionError?(error.code==='NO_CHANGES'?'译文没有变化':error.code==='LATEX_CHANGED'?'公式已锁定，请只修改文字':error.code==='INVALID_TERM_CANDIDATE'?'请完整填写不含公式的简短术语和固定译法':'修正内容不完整，请检查'):error instanceof Error?error.message:'无法保存修正',true);if(error instanceof ManualCorrectionError&&error.code==='INVALID_TERM_CANDIDATE')showTermValidationFailure();else focusFirstTextPart();return}save.textContent='保存';save.disabled=true;cancel.disabled=true;scope.disabled=true;termScope.disabled=true;for(const input of inputs.values())input.disabled=true;source.disabled=true;target.disabled=true;panel.setAttribute('aria-busy','true');setStatus('正在保存…');void this.actions.onSaveTranslationEdit!(result,corrected,selectedScope,term).then((response)=>{if(this.translationEpoch!==editEpoch||this.latestRequestId!==editRequestId)return;this.correctionUndo=response.correctionReceipt;this.showResult(response.result,undefined,response.history,false);queueMicrotask(()=>this.root.querySelector<HTMLButtonElement>('.correction-undo button')?.focus())}).catch((error:unknown)=>{save.disabled=false;cancel.disabled=false;scope.disabled=false;termScope.disabled=false;for(const input of inputs.values())input.disabled=false;source.disabled=false;target.disabled=false;panel.removeAttribute('aria-busy');showSaveFailure(error instanceof Error?error.message:'保存失败，请重试')})});
    surface.append(panel);this.showSurface(surface);queueMicrotask(()=>{(inputs.values().next().value??scope).focus()});
  }

  private undoTranslationCorrection(result:TranslateResult,notice:HTMLElement):void {
    const receipt=this.correctionUndo;if(!receipt||!this.actions.onUndoTranslationEdit)return;const epoch=this.translationEpoch;const message=notice.querySelector<HTMLElement>('.correction-undo-message');notice.classList.remove('is-error');notice.setAttribute('role','status');notice.setAttribute('aria-busy','true');if(message)message.textContent='正在撤销…';const button=notice.querySelector<HTMLButtonElement>('button');if(button){button.textContent='撤销';button.disabled=true}void this.actions.onUndoTranslationEdit(result,receipt).then((response)=>{if(epoch!==this.translationEpoch||this.currentResult?.requestId!==result.requestId)return;this.correctionUndo=undefined;this.showResult(response.result,undefined,response.history,Boolean(receipt.segmentChange));if(response.termRollbackSkipped){const status=document.createElement('span');status.className='correction-undo';status.setAttribute('role','status');const statusMessage=document.createElement('span');statusMessage.className='correction-undo-message';statusMessage.textContent='译文已撤销；术语后来被修改，未自动覆盖';status.append(statusMessage);this.root.querySelector('.footer')?.prepend(status)}const segmentId=receipt.segmentChange?.segmentId;if(segmentId)this.restoreSegmentReadingPosition(response.result,segmentId);else queueMicrotask(()=>this.root.querySelector<HTMLButtonElement>('.correction-action')?.focus())}).catch((error:unknown)=>{notice.removeAttribute('aria-busy');notice.classList.add('is-error');notice.setAttribute('role','alert');if(message)message.textContent=error instanceof Error?`${error.message} ·`:'撤销失败 ·';if(button){button.textContent='重试';button.disabled=false;queueMicrotask(()=>{notice.scrollIntoView({block:'nearest'});button.focus({preventScroll:true})})}})
  }

  private openModelAdjustment(result:TranslateResult):void {
    if(!this.actions.onAdjustTranslation)return;
    const surface=this.surface('模型调整');surface.querySelector('.pin-action')?.remove();const panel=document.createElement('div');panel.className='revision-panel';
    const note=document.createElement('p');note.className='revision-note';note.textContent='模型调整会发送原文和当前译稿，并产生一次新的 API 请求。';panel.append(note);
    const scopeLabel=document.createElement('label');scopeLabel.className='revision-scope';const scopeText=document.createElement('span');scopeText.textContent='作用范围';const scope=document.createElement('select');scope.ariaLabel='译文调整作用范围';for(const [value,label] of [['current','仅本次'],['document','用于本文']] as const){const option=document.createElement('option');option.value=value;option.textContent=label;scope.append(option)}scopeLabel.append(scopeText,scope);panel.append(scopeLabel);const selectedScope=()=>scope.value as TranslationRevisionScope;
    const divider=document.createElement('div');divider.className='revision-divider';divider.textContent='选择调整方式';panel.append(divider);
    const choices=document.createElement('div');choices.className='revision-choices';const run=(adjustment:Omit<TranslationAdjustmentRequest,'scope'>)=>{this.actions.onAdjustTranslation?.(result,{...adjustment,scope:selectedScope()})};
    const faithful=this.button('更忠实原文','revision-choice');faithful.addEventListener('click',()=>run({kind:'faithful',label:'更忠实',instruction:'Keep the translation especially faithful to the source meaning, logical relations, qualifiers, and technical detail. Avoid paraphrasing or adding information.'}));
    const natural=this.button('更自然简洁','revision-choice');natural.addEventListener('click',()=>run({kind:'natural',label:'更自然',instruction:'Use natural, concise target-language phrasing while preserving every technical claim and qualification in the source.'}));
    const terminology=this.button('修正术语与公式','revision-choice');terminology.addEventListener('click',()=>run({kind:'terminology-formula',label:'术语与公式',instruction:'Prioritize consistent academic terminology and exact preservation of every protected formula, symbol, variable, equation number, and LaTeX structure.'}));
    const customToggle=this.button('自定义调整要求…','revision-choice');choices.append(faithful,natural,terminology,customToggle);panel.append(choices);
    const custom=document.createElement('div');custom.className='revision-custom';custom.hidden=true;const customInput=document.createElement('textarea');customInput.maxLength=500;customInput.placeholder='例如：将 sensing 统一译为“感知”，语气更正式';customInput.setAttribute('aria-label','自定义调整要求');const customCount=document.createElement('span');customCount.textContent='0/500';const customApply=this.button('按要求重译','action primary');custom.append(customInput,customCount,customApply);panel.append(custom);
    customToggle.addEventListener('click',()=>{custom.hidden=!custom.hidden;if(!custom.hidden)queueMicrotask(()=>customInput.focus())});customInput.addEventListener('input',()=>{customCount.textContent=`${customInput.value.length}/500`});customApply.addEventListener('click',()=>{const instruction=customInput.value.trim();if(!instruction){customInput.focus();return}run({kind:'custom',label:'自定义调整',instruction})});
    const actions=document.createElement('div');actions.className='revision-actions';const restore=()=>{this.renderResult(result);queueMicrotask(()=>this.root.querySelector<HTMLElement>('details.more > summary')?.focus())};const cancel=this.button('返回','action correction-cancel');cancel.addEventListener('click',restore);actions.append(cancel);panel.append(actions);
    surface.append(panel);this.showSurface(surface);
  }

  private adoptTranslationVersion(result:TranslateResult):void {
    if(!this.actions.onSaveTranslationEdit)return;
    const latest=this.versionsFor(result).find(version=>version.requestId===this.latestRequestId);if(!latest){this.showError({message:'当前最新版已经变化，请重新打开翻译结果。',showSettings:false,retryable:false});return}
    void this.actions.onSaveTranslationEdit(latest,result.translatedText,'current').then((response)=>{this.correctionUndo=response.correctionReceipt;this.showResult(response.result,undefined,response.history,false)}).catch((error:unknown)=>{this.showError({message:error instanceof Error?error.message:'无法采用此版本',showSettings:false,retryable:false})});
  }

  private recognizedSource(result:TranslateResult,label:string):HTMLElement {
    const recognizedText=normalizeLatexForClipboard(result.originalText);const recognized=document.createElement('details');recognized.className='recognized-source';const summary=document.createElement('summary');summary.textContent=label;const content=document.createElement('div');content.className='recognized-content';const source=document.createElement('div');source.className='recognized-text';source.textContent=recognizedText;const actions=document.createElement('div');actions.className='recognized-actions';const copy=this.button('复制原文','');const edit=this.button('编辑后重译','');actions.append(copy,edit);content.append(source,actions);recognized.append(summary,content);
    if(result.formulaLatex?.length){const formulaSource=result.formulaLatex.map(normalizeFormulaLatexForClipboard).join('\n\n');const formulas=document.createElement('pre');formulas.className='formula-latex';formulas.textContent=formulaSource;content.insertBefore(formulas,actions);const copyFormula=this.button('复制公式 LaTeX','');copyFormula.title='复制标准单反斜杠 LaTeX';copyFormula.addEventListener('click',()=>this.copyWithFeedback(copyFormula,formulaSource,'已复制 LaTeX','公式 LaTeX 已复制到剪贴板'));actions.prepend(copyFormula)}
    copy.addEventListener('click',()=>this.copyWithFeedback(copy,recognizedText,'已复制','识别原文已复制到剪贴板'));
    edit.addEventListener('click',()=>{const editor=document.createElement('textarea');editor.className='recognized-editor';editor.value=recognizedText;editor.setAttribute('aria-label','编辑识别原文');source.replaceWith(editor);actions.replaceChildren();this.root.querySelector('.pin-action')?.remove();const commit=this.button('用修正文本重译','commit');const cancel=this.button('取消编辑','correction-cancel');actions.append(commit,cancel);commit.addEventListener('click',()=>{const text=editor.value.trim();if(!text){editor.focus();return}this.actions.onTranslateText(text)});cancel.addEventListener('click',()=>{this.renderResult(result);queueMicrotask(()=>this.root.querySelector<HTMLButtonElement>('.recognized-source summary')?.focus())});queueMicrotask(()=>{editor.focus();editor.setSelectionRange(editor.value.length,editor.value.length)})});
    return recognized;
  }

  private beginPdfRegionAdjustment():void { if(this.sidebarActive)this.collapseSidebar();else{this.clear();this.setView('hidden')}this.actions.onAdjustPdfRegion?.() }

  private openBrowserSidebarFromControl(result:TranslateResult,button:HTMLButtonElement):void {
    if(!this.actions.onOpenBrowserSidebar)return;
    const originalLabel=button.textContent??'打开浏览器侧栏';
    button.disabled=true;button.textContent='正在打开…';
    void this.actions.onOpenBrowserSidebar(result,{persistPreference:false}).catch((error:unknown)=>{
      if(!button.isConnected)return;
      button.disabled=false;button.textContent=originalLabel;
      this.flashButtonFeedback(button,'无法打开，请重试',3200,'error');
      const message=error instanceof Error&&error.message.trim()?error.message:'当前页面无法打开浏览器侧栏。';
      this.resultFeedback.textContent='';requestAnimationFrame(()=>{this.resultFeedback.textContent=message});
    });
  }

  private placeMoreMenu(details:HTMLElement,menu:HTMLElement):void { const surface=details.closest<HTMLElement>('.surface');if(!surface)return;menu.classList.remove('opens-down');menu.style.removeProperty('max-height');const anchorRect=details.getBoundingClientRect();const surfaceRect=surface.getBoundingClientRect();const headerBottom=surface.querySelector<HTMLElement>(':scope > .header')?.getBoundingClientRect().bottom??surfaceRect.top;const gap=2,margin=8;const visibleTop=Math.max(surfaceRect.top,headerBottom,margin);const visibleBottom=Math.min(surfaceRect.bottom,innerHeight-margin);const above=Math.max(0,anchorRect.top-gap-visibleTop);const below=Math.max(0,visibleBottom-anchorRect.bottom-gap);const desired=Math.min(menu.scrollHeight,280);const opensDown=below>=desired||below>=above;const available=opensDown?below:above;menu.classList.toggle('opens-down',opensDown);menu.style.maxHeight=`${Math.max(1,Math.min(desired,available))}px`; }

  private surface(titleText:string):HTMLDivElement {
    const docked=this.sidebarActive||this.markerNavigatorActive||this.historyNavigatorActive||this.documentMemoryActive;const surface=document.createElement('div');surface.className=`surface ${docked?'sidebar '+this.preferences.sidebarSide:'card'}`;surface.setAttribute('role',docked?'complementary':'dialog');surface.setAttribute('aria-label',`Pi Translator ${titleText}`);if(docked)surface.style.setProperty('--sidebar-width',`${this.sidebarWidth}px`);
    const header=document.createElement('div');header.className='header';const titleWrap=document.createElement('div');titleWrap.className='title-wrap';const title=document.createElement('div');title.className='title';title.textContent=titleText;titleWrap.append(this.logo('logo'),title);if(this.sidebarActive&&!this.markerNavigatorActive&&!this.documentMemoryActive){const live=document.createElement('span');live.className='live-badge';live.textContent='自动翻译中';titleWrap.append(live)}const tools=document.createElement('div');tools.className='header-tools';
    if(this.historyNavigatorActive){const back=this.button('←','icon','返回翻译结果');back.addEventListener('click',()=>this.returnFromHistoryNavigator());tools.append(back)}else if(this.documentMemoryActive){const back=this.button('←','icon','返回翻译结果');back.addEventListener('click',()=>{this.documentMemoryActive=false;if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle()});tools.append(back)}else if(this.markerNavigatorActive){if(this.currentResult){const back=this.button('←','icon','返回翻译结果');back.addEventListener('click',()=>{this.markerNavigatorActive=false;this.renderResult(this.currentResult!)});tools.append(back)}}else if(this.sidebarActive){if(this.actions.onGetDocumentMemory){const reviewSummary=summarizeDocumentReviews(this.documentMemory);const documentButton=this.button(this.documentMemoryButtonLabel(),`document-action document-memory-action${reviewSummary.totalCount?' has-review':''}`,documentReviewDescription(reviewSummary));documentButton.ariaLabel=this.documentMemoryButtonLabel();documentButton.addEventListener('click',()=>this.openDocumentMemory());tools.append(documentButton)}const collapse=this.button('›','icon','收起侧栏');collapse.style.transform=this.preferences.sidebarSide==='left'?'rotate(180deg)':'';collapse.addEventListener('click',()=>this.collapseSidebar());tools.append(collapse)}else{const browserResult=this.preferences.sidebarMode==='browser'&&!this.progressState&&this.currentResult&&this.actions.onOpenBrowserSidebar?this.currentResult:undefined;if(browserResult){const pin=this.button('浏览器侧栏','pin-action','在浏览器侧栏中显示');pin.addEventListener('click',()=>this.openBrowserSidebarFromControl(browserResult,pin));tools.append(pin)}else{const pin=this.button('页面侧栏','pin-action','在页面侧栏中显示');pin.addEventListener('click',()=>this.openSidebar());tools.append(pin)}}
    const closeLabel=this.progressState?'停止并关闭':'关闭';const close=this.button('×','icon surface-close',closeLabel);close.addEventListener('click',()=>this.closeSurface());tools.append(close);header.append(titleWrap,tools);surface.append(header);
    if(this.sidebarActive&&!this.historyNavigatorActive&&!this.markerNavigatorActive&&!this.documentMemoryActive&&this.actions.onStartWebRegion){const regionAction=this.button('','sidebar-region-action','框选当前网页中的文字、公式、图表或图像');regionAction.dataset.piFocusKey='web-region';const icon=document.createElement('span');icon.className='sidebar-region-icon';icon.ariaHidden='true';const label=document.createElement('span');label.className='sidebar-region-label';label.textContent='框选网页';const hint=document.createElement('span');hint.className='sidebar-region-hint';hint.textContent='文字 · 公式 · 图表';regionAction.append(icon,label,hint);regionAction.addEventListener('click',()=>this.actions.onStartWebRegion?.());surface.append(regionAction)}
    if(docked)this.makeResizable(surface);else this.makeDraggable(surface,header);return surface;
  }

  private showSurface(surface:HTMLDivElement):void {
    const previousFocus=this.root.activeElement instanceof HTMLElement?this.root.activeElement:undefined;
    const previousFocusKey=previousFocus?.dataset.piFocusKey;
    const hadOverlayFocus=Boolean(previousFocus)||document.activeElement===this.host;
    const shouldMoveFocus=hadOverlayFocus||this.focusNextSurface;
    this.focusNextSurface=false;
    const restoreOverlayFocus=()=>{
      const matchingTarget=previousFocusKey?[...surface.querySelectorAll<HTMLElement>('[data-pi-focus-key]')].find(candidate=>candidate.dataset.piFocusKey===previousFocusKey):undefined;
      const enabledMatchingTarget=matchingTarget instanceof HTMLButtonElement&&matchingTarget.disabled?undefined:matchingTarget;
      const target=enabledMatchingTarget??surface.querySelector<HTMLElement>('[data-pi-focus-target="true"]')??surface.querySelector<HTMLElement>('.surface-close');
      target?.focus({preventScroll:true});
    };
    this.clear();
    this.refreshViewportInsets();
    this.root.append(surface);
    this.observeSize(surface);
    if(this.sidebarActive||this.markerNavigatorActive||this.documentMemoryActive){this.setView('sidebar');this.scheduleReflow();if(shouldMoveFocus)queueMicrotask(restoreOverlayFocus);return}
    const rect=this.lastRect??{top:innerHeight/2,bottom:innerHeight/2,left:innerWidth/2,right:innerWidth/2};
    if(this.cardPosition){
      this.cardPosition=this.applyPosition(surface,this.constrain(this.cardPosition.left,this.cardPosition.top,surface.offsetWidth,surface.offsetHeight));
    }else{
      this.cardPosition=this.place(surface,rect);
    }
    this.setView('card');
    this.scheduleReflow();
    if(shouldMoveFocus)queueMicrotask(restoreOverlayFocus);
  }

  private collapseSidebar():void { this.rememberVisibleResultReadingPosition();const restoreFocus=this.root.activeElement instanceof HTMLElement;this.sidebarCollapsed=true;this.clear();this.refreshViewportInsets();const collapsedLabel=this.markerNavigatorActive?'本文标记':'连续翻译';const tab=this.button('','collapsed-tab '+this.preferences.sidebarSide,`展开 Pi Translator ${collapsedLabel}侧栏`);const label=document.createElement('span');label.textContent=collapsedLabel;tab.append(this.logo(''),label);tab.addEventListener('click',()=>{this.sidebarCollapsed=false;if(this.documentMemoryActive)this.renderDocumentMemory();else if(this.markerNavigatorActive)this.renderMarkerNavigator();else if(this.progressState)this.renderProgress();else if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle();queueMicrotask(()=>(this.root.querySelector<HTMLButtonElement>('[aria-label="收起侧栏"]')??this.root.querySelector<HTMLButtonElement>('[aria-label="返回翻译结果"]'))?.focus({preventScroll:true}))});this.root.append(tab);this.observeSize(tab);this.setView('sidebar-collapsed');this.scheduleReflow();if(restoreFocus)queueMicrotask(()=>tab.focus({preventScroll:true})); }
  private closeSurface():void { const restoreFocus=this.cardReturnFocus;this.cardReturnFocus=undefined;this.markerNavigatorActive=false;this.historyNavigatorActive=false;this.documentMemoryActive=false;this.progressState=undefined;if(this.sidebarActive){this.sidebarActive=false;this.sidebarCollapsed=false;this.markedOnly=false;this.actions.onSidebarChange(false)}this.hide();this.actions.onDismiss();if(restoreFocus?.isConnected)queueMicrotask(()=>restoreFocus.focus({preventScroll:true})); }
  private dismissTrigger():void {
    if(this.view!=='trigger')return;
    const restoreFocus=this.root.activeElement instanceof HTMLElement?this.cardReturnFocus:undefined;
    this.actions.onDismissTrigger?.();
    this.clear();
    const notice=document.createElement('div');notice.className='selection-dismiss-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.setAttribute('aria-atomic','true');
    const message=document.createElement('span');message.textContent='本次已隐藏';
    const pause=this.button('暂停此网站','selection-dismiss-action','暂停本网站自动划词');
    pause.addEventListener('click',()=>{pause.disabled=true;pause.textContent='正在暂停…';void this.actions.onPauseSite?.().then(()=>{if(!notice.isConnected)return;message.textContent='已暂停本网站自动划词';pause.remove();this.armTriggerNoticeTimer(1800)}).catch(()=>{if(!notice.isConnected)return;message.textContent='暂停失败，请在扩展面板重试';pause.remove();this.armTriggerNoticeTimer(3200)})});
    notice.append(message,pause);this.root.append(notice);this.setView('notice');this.armTriggerNoticeTimer(4800);
    if(restoreFocus?.isConnected)queueMicrotask(()=>restoreFocus.focus({preventScroll:true}));
  }
  private armTriggerNoticeTimer(delay:number):void { if(this.triggerNoticeTimer)clearTimeout(this.triggerNoticeTimer);this.triggerNoticeTimer=setTimeout(()=>{this.triggerNoticeTimer=undefined;if(this.view==='notice')this.hide()},delay) }
  private navigationHistory():TranslationHistoryEntry[]{return this.markedOnly?this.history.filter(entry=>this.actions.hasSourceMarksForResult?.(entry)):this.history}
  private focusPairedNavigationControl(primaryKey:string,fallbackKey:string):void { const primary=[...this.root.querySelectorAll<HTMLButtonElement>('[data-pi-focus-key]')].find(button=>button.dataset.piFocusKey===primaryKey);const fallback=[...this.root.querySelectorAll<HTMLButtonElement>('[data-pi-focus-key]')].find(button=>button.dataset.piFocusKey===fallbackKey);const target=primary&&!primary.disabled?primary:fallback&&!fallback.disabled?fallback:undefined;target?.focus({preventScroll:true}) }
  private navigate(delta:number):void { const history=this.navigationHistory();const current=history.findIndex(entry=>entry.requestId===this.currentResult?.requestId);const next=current+delta;if(next<0||next>=history.length)return;const focusKey=this.root.activeElement instanceof HTMLElement?this.root.activeElement.dataset.piFocusKey:undefined;const target=history[next] as TranslationHistoryEntry;this.historyIndex=next;this.alignedView=this.rememberedAlignedView(target);this.renderResult(target);if(focusKey==='older-translation'||focusKey==='newer-translation')queueMicrotask(()=>this.focusPairedNavigationControl(focusKey,focusKey==='older-translation'?'newer-translation':'older-translation')); }
  private toggleMarkedFilter():void { const marked=this.history.filter(entry=>this.actions.hasSourceMarksForResult?.(entry));if(!marked.length){this.markedOnly=false;return}this.markedOnly=!this.markedOnly;if(this.markedOnly&&(!this.currentResult||!this.actions.hasSourceMarksForResult?.(this.currentResult))){const target=marked[0] as TranslationHistoryEntry;this.alignedView=this.rememberedAlignedView(target);this.renderResult(target);return}if(this.currentResult)this.renderResult(this.currentResult) }
  private resultScrollContainer():HTMLElement|undefined { return this.root.querySelector<HTMLElement>('.result-scroll')??this.root.querySelector<HTMLElement>('.surface')??undefined }
  private segmentRow(segmentId:string):HTMLElement|undefined { return [...this.root.querySelectorAll<HTMLElement>('.segment')].find(candidate=>candidate.dataset.segmentId===segmentId) }
  private segmentViewportOffset(segmentId:string):number|undefined { const scroll=this.resultScrollContainer();const row=this.segmentRow(segmentId);if(!scroll||!row)return undefined;return row.getBoundingClientRect().top-scroll.getBoundingClientRect().top }
  private restoreSegmentReadingPosition(result:TranslateResult,segmentId:string,viewportOffset?:number):void {
    const requestId=result.requestId;
    const restore=()=>{
      if(this.currentResult?.requestId!==requestId)return;
      const scroll=this.resultScrollContainer();const row=this.segmentRow(segmentId);if(!scroll||!row)return;
      if(viewportOffset!==undefined)scroll.scrollTop+=row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-viewportOffset;
      const target=row.querySelector<HTMLElement>('.segment-target')??row;const scrollBounds=scroll.getBoundingClientRect();const visibleTop=scrollBounds.top+8;const visibleBottom=scrollBounds.bottom-8;const targetBounds=target.getBoundingClientRect();
      if(targetBounds.height>visibleBottom-visibleTop||targetBounds.top<visibleTop)scroll.scrollTop+=targetBounds.top-visibleTop;
      else if(targetBounds.bottom>visibleBottom)scroll.scrollTop+=targetBounds.bottom-visibleBottom;
    };
    restore();queueMicrotask(restore);requestAnimationFrame(restore);queueMicrotask(()=>{if(this.currentResult?.requestId!==requestId)return;const row=this.segmentRow(segmentId);(row?.querySelector<HTMLButtonElement>('.segment-correct')??row)?.focus({preventScroll:true})})
  }
  private renderResultPreservingScroll(result:TranslateResult,scrollTop=this.resultScrollContainer()?.scrollTop??0):void { const requestId=result.requestId;this.renderResult(result);const restore=()=>{if(this.currentResult?.requestId!==requestId)return;const scroll=this.resultScrollContainer();if(scroll)scroll.scrollTop=scrollTop};restore();queueMicrotask(restore);requestAnimationFrame(restore) }
  private renderAfterMarkToggle(result:TranslateResult,preserveScroll=false):void { const scrollTop=preserveScroll?this.resultScrollContainer()?.scrollTop??0:0;if(this.markedOnly&&!this.actions.hasSourceMarksForResult?.(result)){const next=this.history.find(entry=>this.actions.hasSourceMarksForResult?.(entry));if(next){this.alignedView=this.rememberedAlignedView(next);this.renderResult(next);return}this.markedOnly=false}if(preserveScroll)this.renderResultPreservingScroll(result,scrollTop);else this.renderResult(result) }
  private toggleSourceMark(result:TranslateResult):void { this.actions.onToggleSourceMark?.(result);this.renderAfterMarkToggle(result,true) }
  private toggleSegmentSourceMark(result:TranslateResult,segment:TranslationSegment):void { this.actions.onToggleSourceMark?.(result,segment);this.renderAfterMarkToggle(result,true) }
  private menuButton(text:string,action:()=>void):HTMLButtonElement{const button=this.button(text,'');button.addEventListener('click',action);return button}

  private copyWithFeedback(button:HTMLButtonElement,text:string,success='已复制',announcement='内容已复制到剪贴板'):void {
    if(button.disabled)return;
    const restoreFocus=this.root.activeElement===button;
    const surface=button.closest<HTMLElement>('.surface');
    let feedback=surface?.querySelector<HTMLElement>('.copy-feedback');
    if(surface&&!feedback){feedback=document.createElement('span');feedback.className='sr-only copy-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.setAttribute('aria-atomic','true');surface.append(feedback)}
    if(feedback)feedback.textContent='';
    button.disabled=true;button.dataset.state='pending';
    void navigator.clipboard.writeText(text)
      .then(()=>{button.disabled=false;if(restoreFocus)queueMicrotask(()=>button.focus({preventScroll:true}));this.flashButtonFeedback(button,success,1800,'success',()=>{if(feedback)feedback.textContent=''});window.requestAnimationFrame(()=>{if(feedback)feedback.textContent=announcement})})
      .catch(()=>{button.disabled=false;if(restoreFocus)queueMicrotask(()=>button.focus({preventScroll:true}));this.flashButtonFeedback(button,'复制失败',3200,'error',()=>{if(feedback)feedback.textContent=''});window.requestAnimationFrame(()=>{if(feedback)feedback.textContent='复制失败，请检查剪贴板权限'})});
  }

  private flashButtonFeedback(button:HTMLButtonElement,message:string,duration=1600,state?:'success'|'error',onReset?:()=>void):void {
    const existing=this.buttonFeedbackTimers.get(button);if(existing!==undefined)window.clearTimeout(existing);
    if(!button.dataset.piFeedbackLabel)button.dataset.piFeedbackLabel=button.textContent??'';
    button.textContent=message;button.setAttribute('aria-live','polite');if(state)button.dataset.state=state;
    const timer=window.setTimeout(()=>{if(button.isConnected)button.textContent=button.dataset.piFeedbackLabel??'';delete button.dataset.piFeedbackLabel;button.removeAttribute('aria-live');if(state&&button.dataset.state===state)delete button.dataset.state;onReset?.();this.buttonFeedbackTimers.delete(button)},duration);
    this.buttonFeedbackTimers.set(button,timer);
  }

  private markerIcon():SVGSVGElement { const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M6.1 13.2 12.9 6.4l2.7 2.7-6.8 6.8H6.1v-2.7Zm5.8-7.8 1.3-1.3a1.2 1.2 0 0 1 1.7 0L17.9 7a1.2 1.2 0 0 1 0 1.7L16.6 10l-4.7-4.6ZM3 17h14');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.6');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg }
  private speakerIcon():SVGSVGElement { const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M4 8h3l4-3v10l-4-3H4V8Zm10-1.5c1.1.9 1.7 2 1.7 3.5s-.6 2.6-1.7 3.5M12.8 8c.6.5.9 1.2.9 2s-.3 1.5-.9 2');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.5');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg }

  private makeDraggable(surface:HTMLDivElement,handle:HTMLDivElement):void {
    let id:number|undefined,dx=0,dy=0;
    const move=(event:PointerEvent)=>{
      if(id!==event.pointerId)return;
      const next=this.constrain(event.clientX-dx,event.clientY-dy,surface.offsetWidth,surface.offsetHeight);
      surface.style.left=`${next.left}px`;surface.style.top=`${next.top}px`;this.cardPosition=next;
    };
    const removeWindowListeners=()=>{
      window.removeEventListener('pointermove',move,true);
      window.removeEventListener('pointerup',end,true);
      window.removeEventListener('pointercancel',end,true);
      window.removeEventListener('blur',stop);
    };
    const stop=()=>{
      if(id===undefined)return;
      const finishedId=id;id=undefined;removeWindowListeners();surface.classList.remove('dragging');
      if(handle.hasPointerCapture(finishedId))handle.releasePointerCapture(finishedId);
      if(surface.isConnected){const rect=surface.getBoundingClientRect();this.cardPosition={left:rect.left,top:rect.top}}
    };
    const end=(event:PointerEvent)=>{if(id===event.pointerId)stop()};
    handle.addEventListener('pointerdown',event=>{
      const target=event.target;if(id!==undefined||event.button!==0||!(target instanceof Element)||target.closest('button,details'))return;
      const rect=surface.getBoundingClientRect();id=event.pointerId;dx=event.clientX-rect.left;dy=event.clientY-rect.top;surface.classList.add('dragging');handle.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);window.addEventListener('blur',stop);event.preventDefault();
    });
    handle.addEventListener('lostpointercapture',event=>{if(id===event.pointerId&&event.buttons===0)stop()});
  }
  private makeResizable(surface:HTMLDivElement):void {
    const handle=document.createElement('div');handle.className='sidebar-resizer';surface.append(handle);let id:number|undefined;
    handle.addEventListener('pointerdown',event=>{this.rememberVisibleResultReadingPosition();id=event.pointerId;handle.setPointerCapture(id);event.preventDefault()});
    handle.addEventListener('pointermove',event=>{
      if(id!==event.pointerId)return;
      const available=Math.max(0,innerWidth-this.viewportInsets.left-this.viewportInsets.right-20);
      const maximum=Math.min(640,available);
      const minimum=Math.min(320,maximum);
      const raw=this.preferences.sidebarSide==='right'
        ? innerWidth-this.viewportInsets.right-event.clientX
        : event.clientX-this.viewportInsets.left;
      this.sidebarWidth=Math.min(maximum,Math.max(minimum,raw));
      surface.style.setProperty('--sidebar-width',`${this.sidebarWidth}px`);
      this.publishSidebarLayout();
    });
    const stop=()=>{if(id!==undefined)this.actions.onSidebarWidthChange(this.sidebarWidth);id=undefined};handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);
  }

  private constrain(left:number,top:number,width:number,height:number):Position {
    const bounds=this.viewportBounds(12);
    return {
      left:Math.min(Math.max(bounds.left,left),Math.max(bounds.left,bounds.right-width)),
      top:Math.min(Math.max(bounds.top,top),Math.max(bounds.top,bounds.bottom-height)),
    };
  }

  private place(element:HTMLElement,rect:ViewportRect):Position {
    const gap=8;
    const width=element.offsetWidth;
    const height=element.offsetHeight;
    const bounds=this.viewportBounds(12);
    const above=Math.max(0,rect.top-gap-bounds.top);
    const below=Math.max(0,bounds.bottom-rect.bottom-gap);
    const top=below>=height||below>=above?rect.bottom+gap:rect.top-height-gap;
    const next=this.constrain(rect.right-width,top,width,height);
    return this.applyPosition(element,next);
  }

  private applyPosition(element:HTMLElement,position:Position):Position {
    element.style.left=`${position.left}px`;
    element.style.top=`${position.top}px`;
    return position;
  }

  private viewportBounds(margin=0):{left:number;top:number;right:number;bottom:number} {
    return {
      left:this.viewportInsets.left+margin,
      top:this.viewportInsets.top+margin,
      right:Math.max(this.viewportInsets.left+margin,innerWidth-this.viewportInsets.right-margin),
      bottom:Math.max(this.viewportInsets.top+margin,innerHeight-this.viewportInsets.bottom-margin),
    };
  }

  private refreshViewportInsets():void {
    let raw:Partial<ViewportInsets>;
    if(this.viewportInsetsProvider){
      try{raw=this.viewportInsetsProvider()??{}}
      catch{raw={}}
    }else{
      const style=getComputedStyle(this.host);
      raw={
        top:Number.parseFloat(style.getPropertyValue('--pi-viewport-top')),
        right:Number.parseFloat(style.getPropertyValue('--pi-viewport-right')),
        bottom:Number.parseFloat(style.getPropertyValue('--pi-viewport-bottom')),
        left:Number.parseFloat(style.getPropertyValue('--pi-viewport-left')),
      };
    }
    const value=(candidate:number|undefined):number=>(
      typeof candidate==='number'&&Number.isFinite(candidate)&&candidate>0?candidate:0
    );
    let top=value(raw.top),right=value(raw.right),bottom=value(raw.bottom),left=value(raw.left);
    const horizontalLimit=Math.max(0,innerWidth-24);
    const horizontalTotal=left+right;
    if(horizontalTotal>horizontalLimit&&horizontalTotal>0){const scale=horizontalLimit/horizontalTotal;left*=scale;right*=scale}
    const verticalLimit=Math.max(0,innerHeight-24);
    const verticalTotal=top+bottom;
    if(verticalTotal>verticalLimit&&verticalTotal>0){const scale=verticalLimit/verticalTotal;top*=scale;bottom*=scale}
    this.viewportInsets={top,right,bottom,left};
    if(this.viewportInsetsProvider){
      this.host.style.setProperty('--pi-viewport-top',`${top}px`);
      this.host.style.setProperty('--pi-viewport-right',`${right}px`);
      this.host.style.setProperty('--pi-viewport-bottom',`${bottom}px`);
      this.host.style.setProperty('--pi-viewport-left',`${left}px`);
    }
  }

  private observeSize(element:HTMLElement):void {
    this.surfaceResizeObserver?.disconnect();
    if(typeof ResizeObserver==='undefined')return;
    this.surfaceResizeObserver=new ResizeObserver(()=>{this.restoreVisibleResultReadingPosition();this.updateResultReadingControls();this.scheduleReflow()});
    this.surfaceResizeObserver.observe(element);
  }

  private scheduleReflow():void {
    if(this.view==='hidden'||this.reflowFrame!==undefined)return;
    this.reflowFrame=requestAnimationFrame(()=>{
      this.reflowFrame=undefined;
      this.reflowVisibleSurface();
    });
  }

  private reflowVisibleSurface():void {
    if(this.view==='hidden')return;
    this.refreshViewportInsets();
    if(this.view==='trigger'){
      const trigger=this.root.querySelector<HTMLElement>('.trigger-placement,.trigger-shell');
      if(trigger&&this.lastRect)this.place(trigger,this.lastRect);
      return;
    }
    if(this.view==='card'){
      const card=this.root.querySelector<HTMLElement>('.card');
      if(!card)return;
      if(this.cardPosition){
        this.cardPosition=this.applyPosition(card,this.constrain(this.cardPosition.left,this.cardPosition.top,card.offsetWidth,card.offsetHeight));
      }else{
        const rect=this.lastRect??{top:innerHeight/2,bottom:innerHeight/2,left:innerWidth/2,right:innerWidth/2};
        this.cardPosition=this.place(card,rect);
      }
    }
  }
  private button(text:string,className:string,title?:string):HTMLButtonElement{const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;if(title){button.title=title;button.ariaLabel=title}return button}
  private logo(className:string):HTMLImageElement{const image=document.createElement('img');image.className=className;image.src=this.logoUrl;image.alt='';return image}
  private clear():void{this.surfaceResizeObserver?.disconnect();this.surfaceResizeObserver=undefined;if(this.reflowFrame!==undefined)cancelAnimationFrame(this.reflowFrame);this.reflowFrame=undefined;if(this.triggerNoticeTimer)clearTimeout(this.triggerNoticeTimer);this.triggerNoticeTimer=undefined;for(const child of [...this.root.children])if(!(child instanceof HTMLStyleElement)&&child!==this.resultFeedback)child.remove()}
  private publishSidebarLayout():void{this.actions.onSidebarLayoutChange(this.view==='sidebar',this.preferences.sidebarSide,this.sidebarWidth)}
  private setView(view:OverlayView):void{this.view=view;this.host.dataset.piView=view;this.publishSidebarLayout()}
  private readonly onKeyDown=(event:KeyboardEvent):void=>{if(this.view==='hidden')return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(this.historyNavigatorActive){this.returnFromHistoryNavigator();return}const correctionCancel=this.root.querySelector<HTMLButtonElement>('.correction-cancel');if(correctionCancel){correctionCancel.click();return}const openMenu=this.root.querySelector<HTMLDetailsElement>('details.more[open]');if(openMenu){openMenu.open=false;openMenu.querySelector<HTMLElement>('summary')?.focus();return}if(this.sidebarActive)this.collapseSidebar();else this.closeSurface();return}if(event.altKey&&(event.key==='/'||event.code==='Slash')&&this.sidebarActive&&!this.sidebarCollapsed&&this.history.length>1&&!this.documentMemoryActive&&!this.markerNavigatorActive&&!this.progressState){event.preventDefault();event.stopPropagation();if(this.historyNavigatorActive)this.root.querySelector<HTMLInputElement>('.history-search-field')?.focus({preventScroll:true});else this.openHistoryNavigator();return}const origin=event.composedPath()[0];const editable=origin instanceof HTMLInputElement||origin instanceof HTMLTextAreaElement||origin instanceof HTMLSelectElement||(origin instanceof HTMLElement&&origin.isContentEditable);const canNavigate=!editable&&!this.sidebarCollapsed&&!this.historyNavigatorActive&&!this.documentMemoryActive&&!this.markerNavigatorActive&&!this.progressState&&!this.root.querySelector('details.more[open],.recognized-editor,.segment-correction')&&Boolean(this.root.querySelector('.body,.aligned-list'));if(canNavigate&&event.altKey&&event.key==='ArrowUp'){event.preventDefault();this.navigate(1)}if(canNavigate&&event.altKey&&event.key==='ArrowDown'){event.preventDefault();this.navigate(-1)}};
  private readonly onDocumentPointerDown=(event:PointerEvent):void=>{const openMenu=this.root.querySelector<HTMLDetailsElement>('details.more[open]');if(!openMenu||event.composedPath().includes(openMenu))return;openMenu.open=false};
  private readonly onViewportChange=():void=>this.scheduleReflow();
  private readonly onColorSchemeChange=():void=>this.scheduleTheme();
  private trackTheme():void{this.refreshTheme();this.themeObserver=new MutationObserver(()=>this.scheduleTheme());const options:MutationObserverInit={attributes:true,attributeFilter:['class','style','data-theme','data-color-mode','data-bs-theme']};this.themeObserver.observe(document.documentElement,options);if(document.body)this.themeObserver.observe(document.body,options);this.colorSchemeQuery=globalThis.matchMedia?.('(prefers-color-scheme:dark)');this.colorSchemeQuery?.addEventListener('change',this.onColorSchemeChange)}
  private scheduleTheme():void{if(this.themeTimer)clearTimeout(this.themeTimer);this.themeTimer=setTimeout(()=>this.refreshTheme(),40)}private refreshTheme():void{this.host.dataset.piTheme=detectPageTheme()}
}
