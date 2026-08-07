import type { ViewportRect } from '../core/selection/types';
import type {
  TranslateResult,
  TranslationHistoryEntry,
  TranslationSegment,
  TranslationStyle,
  TranslationRevisionKind,
  TranslationRevisionScope,
  PdfSourceLocation,
} from '../core/translation/types';
import type { SidebarSide } from '../core/settings/schema';
import {
  documentMemoryTranslationResult,
  type DocumentMemorySnapshot,
  type DocumentMemoryTranslation,
} from '../core/document/document-memory-repository';
import { detectPageTheme } from '../core/theme/page-theme';
import { containsRenderableLatex } from '../core/translation/latex-display';
import { validateImageFormulaResult } from '../core/translation/formula-output-validation';
import type { SettingsFocus } from '../core/messaging/user-facing-error';
import type { SettingsRecoveryRequest } from '../core/messaging/messages';
import {
  renderTranslationContent,
  renderTranslationContents,
  type TranslationContentTarget,
} from './translation-content';
import type {
  TranslationMarkerLocationState,
  TranslationMarkerSummary,
} from '../core/content/session-translation-markers';
import {
  normalizeFormulaLatexForClipboard,
  normalizeLatexForClipboard,
} from './latex-copy';

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
    --accent:#5959df; --accent2:#06a6c7; --text:#192238; --muted:#6e7b91;
    --line:#dfe5ef; --soft:#f4f7fb; --surface:rgba(255,255,255,.985);
    --pi-viewport-top:0px; --pi-viewport-right:0px; --pi-viewport-bottom:0px; --pi-viewport-left:0px;
  }
  :host([data-pi-theme="dark"]) { color-scheme:dark; --text:#edf2f8; --muted:#a9b5c7; --line:#3a465a; --soft:#202938; --surface:rgba(17,24,39,.985); }
  * { box-sizing:border-box; } button,select { font:inherit; } button { cursor:pointer; }
  .trigger { position:fixed;z-index:2147483647;display:grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid rgba(91,92,226,.23);border-radius:13px;background:var(--surface);box-shadow:0 9px 28px rgba(30,41,59,.21);pointer-events:auto;transition:.16s transform,.16s box-shadow; }
  .trigger:hover { transform:translateY(-2px) scale(1.04);box-shadow:0 13px 33px rgba(30,41,59,.25); }
  .trigger-logo { width:24px;height:21px;object-fit:contain; }.sparkle { position:absolute;right:-4px;top:-5px;color:#f3b526;font-size:11px; }
  .surface { position:fixed;z-index:2147483647;container-type:inline-size;color:var(--text);background:var(--surface);border:1px solid rgba(99,102,241,.18);box-shadow:0 25px 70px rgba(15,23,42,.25);backdrop-filter:blur(20px);overflow:auto;scrollbar-width:thin;pointer-events:auto; }
  .surface::before { content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,#4f46e5,#8b5cf6,#06b6d4); }
  .card { width:min(500px,calc(100vw - var(--pi-viewport-left) - var(--pi-viewport-right) - 24px));max-height:min(540px,calc(100vh - var(--pi-viewport-top) - var(--pi-viewport-bottom) - 24px));padding:16px;border-radius:20px; }
  .sidebar { top:calc(var(--pi-viewport-top) + 10px);bottom:calc(var(--pi-viewport-bottom) + 10px);width:min(var(--sidebar-width,390px),calc(100vw - var(--pi-viewport-left) - var(--pi-viewport-right) - 20px));padding:15px;border-radius:18px;max-height:none; }
  .sidebar.right { right:calc(var(--pi-viewport-right) + 10px); }.sidebar.left { left:calc(var(--pi-viewport-left) + 10px); }
  .sidebar-resizer { position:absolute;z-index:3;top:0;bottom:0;width:8px;cursor:ew-resize; }.sidebar.right .sidebar-resizer{left:-4px}.sidebar.left .sidebar-resizer{right:-4px}
  .collapsed-tab { position:fixed;z-index:2147483647;top:max(calc(var(--pi-viewport-top) + 8px),38%);display:grid;gap:6px;place-items:center;width:42px;padding:13px 7px;border:1px solid rgba(99,102,241,.24);color:#fff;background:linear-gradient(160deg,#4f46e5,#6f55df);box-shadow:0 14px 34px rgba(31,38,100,.3);pointer-events:auto; }
  .collapsed-tab.right { right:var(--pi-viewport-right);border-radius:13px 0 0 13px; }.collapsed-tab.left { left:var(--pi-viewport-left);border-radius:0 13px 13px 0; }
  .collapsed-tab img { width:22px;height:19px;filter:brightness(0) invert(1); }.collapsed-tab span { writing-mode:vertical-rl;font-size:11px;font-weight:750;letter-spacing:.08em; }
  .header { display:flex;align-items:center;gap:8px;min-height:30px;user-select:none; }.card .header{cursor:grab;touch-action:none}.card.dragging .header{cursor:grabbing}
  .title-wrap { display:flex;align-items:center;gap:8px;min-width:0;margin-right:auto; }.logo{width:21px;height:18px;object-fit:contain}.title{color:#40506e;font-size:13px;font-weight:780}.header-tools{display:flex;align-items:center;gap:2px}
  .live-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;color:#08718b;background:#e7f9fd;font-size:9px;font-weight:750}.live-badge::before{content:"";width:5px;height:5px;border-radius:50%;background:#0ba7c5;box-shadow:0 0 0 3px rgba(11,167,197,.13)}
  .icon { display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;color:#5e6a7f;background:transparent;font-size:17px; }.icon:hover{background:var(--soft)}.icon:disabled{opacity:.28;cursor:default}.counter{min-width:35px;color:var(--muted);font-size:10px;text-align:center;font-variant-numeric:tabular-nums}
  .pin-action{height:26px;padding:0 7px;border:1px solid var(--line);border-radius:5px;color:#4b5870;background:transparent;font-size:10px;font-weight:680;white-space:nowrap}.pin-action:hover{color:var(--accent);border-color:#b8c0ea;background:var(--soft)}
  .result-topline{display:flex;align-items:center;gap:6px;min-height:20px;margin-top:5px}.meta{display:flex;flex:1;flex-wrap:wrap;align-items:center;gap:5px;min-width:0;color:var(--muted);font-size:9px}.meta-dot::before{content:"·";margin-right:5px}.cache-badge{padding:0;color:#16839a;background:transparent;font-weight:650}.source-location{padding:0;border:0;border-bottom:1px solid transparent;color:var(--muted);background:transparent;font-size:9px}.source-location:hover{color:var(--accent);border-bottom-color:currentColor}
  .source-badge{color:#4f46e5;font-weight:700}.recognized-source{margin-top:7px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.recognized-source summary{padding:6px 1px;color:var(--muted);cursor:pointer;font-size:10px;list-style:none}.recognized-source summary::-webkit-details-marker{display:none}.recognized-source summary::after{content:"＋";float:right}.recognized-source[open] summary::after{content:"－"}.recognized-content{padding:0 1px 8px}.recognized-text{max-height:150px;color:var(--muted);font-size:11px;line-height:1.65;white-space:pre-wrap;overflow:auto}.formula-latex{max-height:120px;margin:7px 0 0;padding:7px 8px;border-left:2px solid rgba(79,70,229,.42);color:var(--text);background:var(--soft);font:10px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow:auto}.recognized-editor{display:block;width:100%;min-height:92px;max-height:190px;padding:7px;border:1px solid var(--line);border-radius:4px;color:var(--text);background:var(--soft);font-family:inherit;font-size:11px;line-height:1.65;resize:vertical}.recognized-actions{display:flex;align-items:center;gap:4px;margin-top:6px}.recognized-actions button{padding:3px 6px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:10px}.recognized-actions button:hover{color:var(--accent);background:var(--soft)}.recognized-actions .commit{color:var(--accent);font-weight:680}.uncertain-note{margin-top:7px;color:#85651d;font-size:10px}
  .revision-panel{display:grid;gap:9px;margin-top:8px}.revision-label{display:grid;gap:5px;color:var(--text);font-size:11px;font-weight:680}.revision-editor,.revision-custom textarea{width:100%;padding:8px;border:1px solid var(--line);border-radius:4px;color:var(--text);background:var(--soft);font:11px/1.65 inherit;resize:vertical}.revision-editor{min-height:120px;max-height:300px}.revision-note{margin:0;color:var(--muted);font-size:9.5px;line-height:1.55}.revision-scope{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.revision-scope select{height:25px;padding:0 22px 0 6px;border:1px solid var(--line);border-radius:3px;color:var(--text);background:var(--surface);font-size:10px}.revision-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px}.revision-status{margin-right:auto;color:var(--muted);font-size:9.5px}.revision-divider{padding-top:9px;border-top:1px solid var(--line);color:var(--muted);font-size:10px;font-weight:650}.revision-choices{display:grid}.revision-choice{padding:7px 2px;border:0;border-bottom:1px solid var(--line);color:var(--text);background:transparent;text-align:left;font-size:11px}.revision-choice::after{content:"›";float:right;color:var(--muted)}.revision-choice:hover{color:var(--accent);background:var(--soft)}.revision-custom{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:end}.revision-custom[hidden]{display:none}.revision-custom textarea{grid-column:1/-1;min-height:68px;max-height:140px}.revision-custom span{color:var(--muted);font-size:9px}.version-counter{min-width:31px;font-size:9px}
  .view-switch{display:inline-flex;flex:0 0 auto;align-items:center;gap:2px;margin-left:auto}.view-button{min-width:30px;height:19px;padding:0 4px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:9px;font-weight:680;line-height:1}.view-button:hover{color:var(--text);background:var(--soft)}.view-button.active{color:#4338ca;background:var(--soft);box-shadow:inset 0 -1px 0 rgba(79,70,229,.45)}
  .body { margin-top:8px;font-size:14px;line-height:1.78;white-space:pre-wrap;overflow-wrap:anywhere; }.pi-rich-strong{font-weight:700}.pi-math-inline{display:inline-flex;max-width:100%;vertical-align:-.14em;white-space:normal}.pi-math-display{display:block;width:100%;margin:.72em 0;padding:.08em 0 .12em;overflow-x:auto;overflow-y:hidden;text-align:center;line-height:1.28;white-space:normal}.pi-math-display.pi-math-numbered{display:grid;grid-template-columns:minmax(0,1fr) max-content;grid-template-rows:auto;align-items:center;column-gap:6px;overflow:visible}.pi-math-numbered .pi-math-scroll{grid-row:1;grid-column:1;min-width:0;max-width:100%;overflow-x:auto;overflow-y:hidden;text-align:center;overscroll-behavior-inline:contain;scrollbar-width:thin}.pi-equation-tag{grid-row:1;grid-column:2;align-self:center;white-space:nowrap;font-family:"Cambria Math","STIX Two Math","Latin Modern Math",serif;font-size:.9em;font-variant-numeric:tabular-nums;line-height:1}.pi-math .katex{color:inherit;font-size:1.02em}.pi-math math{color:inherit;font-family:"Cambria Math","STIX Two Math","Latin Modern Math",serif;font-synthesis:none}.pi-math-display math{font-size:1.06em}.progress{margin-top:10px}.loading{display:flex;align-items:center;gap:10px;padding:10px 0;color:var(--muted);font-size:12px}.spinner{flex:0 0 auto;width:17px;height:17px;border:2px solid #cdd5e5;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}.stream-preview{max-height:300px;margin-top:5px;padding:11px;border-radius:12px;background:var(--soft);font-size:13px;line-height:1.72;white-space:pre-wrap;overflow:auto}.stream-preview[hidden]{display:none}@keyframes spin{to{transform:rotate(360deg)}}
  .idle { display:grid;place-items:center;min-height:240px;padding:30px;text-align:center;color:var(--muted); }.idle img{width:42px;height:37px;opacity:.3}.idle strong{margin-top:16px;color:var(--text);font-size:15px}.idle p{max-width:260px;margin:7px 0 0;font-size:12px;line-height:1.65}
  .marker-notes-toolbar{display:flex;align-items:center;gap:8px;margin-top:8px;padding:7px 0;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.marker-notes-toolbar span{margin-right:auto}.marker-notes-toolbar button{padding:3px 5px;border:0;border-radius:3px;color:var(--accent);background:transparent;font-size:10px}.marker-notes-toolbar button:hover{background:var(--soft)}
  .marker-notes-list{display:grid;margin-top:4px}.marker-note{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:9px 1px;border-bottom:1px solid var(--line)}.marker-note-main{display:grid;gap:3px;min-width:0;padding:0;border:0;color:var(--text);background:transparent;text-align:left}.marker-note-main:hover .marker-note-source{color:var(--accent)}.marker-note-meta{display:flex;align-items:center;gap:6px;color:var(--accent);font-size:9px;font-weight:700}.marker-note-status{color:#9a6b17;font-weight:550}.marker-note-source,.marker-note-target{display:-webkit-box;min-width:0;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow-wrap:anywhere}.marker-note-source{font-size:11px;line-height:1.5}.marker-note-target{color:var(--muted);font-size:10px;line-height:1.45}.marker-note.missing .marker-note-main{cursor:default}.marker-note.missing .marker-note-source,.marker-note.missing .marker-note-target{opacity:.62}.marker-note-actions{display:flex;align-items:flex-start;gap:1px}.marker-note-actions button{width:24px;height:24px;padding:0;border:0;border-radius:4px;color:var(--muted);background:transparent;font-size:10px}.marker-note-actions button:hover{color:var(--accent);background:var(--soft)}
  .document-action{height:24px;padding:0 5px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:10px;font-weight:680}.document-action:hover{color:var(--accent);background:var(--soft)}
  .document-meta{margin-top:8px;padding-bottom:8px;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.document-section{margin-top:14px}.document-section-head{display:flex;align-items:center;gap:8px;padding-bottom:5px;border-bottom:1px solid var(--line)}.document-section-head strong{margin-right:auto;color:var(--text);font-size:11px}.document-section-head span{color:var(--muted);font-size:9px}.document-list{display:grid}.document-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;padding:9px 1px;border-bottom:1px solid var(--line)}.document-pair{display:grid;gap:3px;min-width:0}.document-source{color:var(--text);font-size:11px;line-height:1.45;overflow-wrap:anywhere}.document-target{color:var(--muted);font-size:10px;line-height:1.45;overflow-wrap:anywhere}.document-row-actions{display:flex;align-items:start;gap:2px}.document-row-actions button,.document-clear{padding:3px 5px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:9px}.document-row-actions button:hover,.document-clear:hover{color:var(--accent);background:var(--soft)}.document-translation{width:100%;padding:9px 1px;border:0;border-bottom:1px solid var(--line);color:var(--text);background:transparent;text-align:left}.document-translation:hover .document-source{color:var(--accent)}.document-translation .document-source,.document-translation .document-target{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.document-edit{display:grid;grid-template-columns:1fr 1fr auto;gap:5px;align-items:center}.document-edit input{min-width:0;padding:5px 6px;border:1px solid var(--line);border-radius:3px;color:var(--text);background:var(--soft);font:10px/1.4 inherit}.document-candidate-edit{grid-template-columns:minmax(0,1fr) auto}.document-candidate-edit .document-source{grid-column:1/-1}.document-edit-actions{display:flex;gap:2px}.document-edit-actions button{padding:3px 5px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:9px}.document-edit-actions button:first-child{color:var(--accent);font-weight:680}.document-edit-actions button:hover{background:var(--soft)}.document-empty{padding:12px 1px;color:var(--muted);font-size:10px}.document-footer{display:flex;justify-content:flex-end;margin-top:14px;padding-top:7px;border-top:1px solid var(--line)}
  .document-memory-action.has-review{color:#9a6b17}.document-review-list{display:grid}.document-review-row{display:grid;gap:5px;padding:9px 1px;border-bottom:1px solid var(--line)}.document-review-meta{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:9px}.document-review-meta strong{color:#9a6b17;font-size:9px}.document-review-source{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--text);font-size:11px;line-height:1.48;overflow-wrap:anywhere}.document-review-actions{display:flex;align-items:center;gap:2px}.document-review-actions button{padding:3px 5px;border:0;border-radius:3px;color:var(--muted);background:transparent;font-size:9px}.document-review-actions button:hover{color:var(--accent);background:var(--soft)}.document-review-actions .review-resolve{margin-left:auto;color:#6e7b91}
  .aligned-list{display:grid;gap:9px;margin-top:10px}.segment{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;padding:10px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(145deg,rgba(248,250,252,.9),rgba(244,247,252,.64));transition:.15s border-color,.15s box-shadow}.segment:hover,.segment:focus-within{border-color:#aeb9f3;box-shadow:0 5px 18px rgba(73,78,160,.1)}
  .segment-number{display:grid;place-items:center;align-self:start;width:23px;height:23px;border-radius:8px;color:#fff;background:linear-gradient(135deg,var(--accent),#7c5ce5);font-size:10px;font-weight:800}.segment-pair{display:grid;gap:6px;min-width:0}.segment-source{color:var(--muted);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.segment-target{padding-top:6px;border-top:1px dashed var(--line);font-size:14px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
  .segment-actions{display:flex;gap:5px;margin-top:7px;opacity:0;transition:.15s opacity}.segment:hover .segment-actions,.segment:focus-within .segment-actions{opacity:1}.mini{padding:3px 7px;border:0;border-radius:6px;color:var(--muted);background:var(--soft);font-size:10px}.mini:hover{color:var(--accent)}
  .segment-mark{display:grid;place-items:center;width:23px;height:22px;padding:0;border-radius:4px;background:transparent}.segment-mark svg{width:14px;height:14px}.segment-mark.active{color:var(--accent);background:rgba(99,102,241,.09);box-shadow:inset 0 -2px rgba(89,89,223,.62)}
  @container (min-width:520px){.segment-pair{grid-template-columns:1fr 1fr;gap:12px}.segment-target{padding:0 0 0 12px;border-top:0;border-left:1px dashed var(--line)}}
  .warning,.error{margin-top:10px;padding:9px 11px;border-radius:9px;font-size:12px;white-space:pre-wrap}.warning{color:#725417;background:#fff6dd}.error{color:#a52b36;background:#fff1f2}
  .notice{display:grid;gap:7px;margin-top:14px;padding:12px;border:1px solid #f0d898;border-radius:12px;color:#725417;background:#fffaf0;font-size:12px;line-height:1.6}.notice strong{color:var(--text);font-size:13px}
  .footer{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}.action{padding:5px 8px;border:1px solid #d6dceb;border-radius:5px;color:#26334a;background:#f8f9fc;font-size:10.5px;font-weight:630}.action:hover{background:#eef2fa}.primary{color:#fff;border-color:var(--accent);background:linear-gradient(135deg,#4f46e5,#6d5ce8)}.copy-action{color:var(--accent);border-color:#c7d2fe;background:transparent;box-shadow:none}.copy-action:hover{color:#3730a3;border-color:#a5b4fc;background:#f5f6ff}
  .mark-action{display:flex;align-items:center;gap:3px;height:27px;padding:0 6px;border:0;border-radius:4px;color:var(--muted);background:transparent;font-size:10px;font-weight:650}.mark-action svg{width:14px;height:14px}.mark-filter svg{width:16px;height:16px}.mark-action:hover:not(:disabled),.mark-filter:hover{color:var(--accent);background:var(--soft)}.mark-action.active,.mark-filter.active{color:var(--accent);background:rgba(99,102,241,.09);box-shadow:inset 0 -2px rgba(89,89,223,.72)}.mark-action:disabled{opacity:.46;cursor:not-allowed}
  details.more{position:relative;margin-left:auto}details.more>summary{display:grid;place-items:center;width:24px;height:24px;border-radius:4px;color:var(--muted);cursor:pointer;list-style:none;font-size:12px;font-weight:800}details.more>summary:hover{background:var(--soft)}details.more>summary::-webkit-details-marker{display:none}.menu{position:absolute;z-index:5;right:0;bottom:30px;width:220px;max-height:calc(100vh - 32px);padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 16px 40px rgba(15,23,42,.2);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}.menu.opens-down{top:30px;bottom:auto}.sidebar.left .menu{left:0;right:auto}.menu button{width:100%;padding:7px 9px;border:0;border-radius:4px;color:var(--text);background:transparent;text-align:left;font-size:11px}.menu button:hover{background:var(--soft)}.menu hr{border:0;border-top:1px solid var(--line);margin:6px 0}.menu label{display:grid;gap:4px;margin:6px;color:var(--muted);font-size:10px}.menu select{width:100%;padding:6px;border:1px solid var(--line);border-radius:4px;color:var(--text);background:var(--soft);font-size:11px}
  :host([data-pi-theme="dark"]) .logo,:host([data-pi-theme="dark"]) .trigger-logo{filter:brightness(0) invert(1)}:host([data-pi-theme="dark"]) .title{color:#d6deea}:host([data-pi-theme="dark"]) .view-button.active{color:#e4e5ff;background:#273246}:host([data-pi-theme="dark"]) .segment{background:linear-gradient(145deg,rgba(31,41,55,.9),rgba(24,33,47,.72))}:host([data-pi-theme="dark"]) .action{color:#e8edf6;background:#202938;border-color:#465269}:host([data-pi-theme="dark"]) .primary{background:#5b6ee1}:host([data-pi-theme="dark"]) .copy-action{color:#a5b4fc;background:transparent;border-color:#465269}:host([data-pi-theme="dark"]) .warning{color:#f1d68e;background:#463b20}:host([data-pi-theme="dark"]) .error{color:#ff9aa4;background:#32171d}:host([data-pi-theme="dark"]) .cache-badge{color:#8de7f7;background:transparent}
  :host([data-pi-theme="dark"]) .live-badge{color:#8de7f7;background:#173b44}:host([data-pi-theme="dark"]) .notice{color:#f1d68e;background:#3c321c;border-color:#655326}
  :host([data-pi-theme="dark"]) .document-memory-action.has-review,:host([data-pi-theme="dark"]) .document-review-meta strong{color:#f1d68e}:host([data-pi-theme="dark"]) .document-review-actions .review-resolve{color:var(--muted)}
  button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,.segment:focus-visible{outline:2px solid #6366f1;outline-offset:2px}
  @media(max-width:620px){.sidebar{top:calc(var(--pi-viewport-top) + 8px)!important;right:calc(var(--pi-viewport-right) + 8px)!important;bottom:calc(var(--pi-viewport-bottom) + 8px)!important;left:calc(var(--pi-viewport-left) + 8px)!important;width:auto!important}.sidebar-resizer{display:none}.segment-actions{opacity:1}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

export interface OverlayPreferences {
  targetLanguage: string;
  style: TranslationStyle;
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

interface ErrorDisplay {
  message: string;
  showSettings: boolean;
  retryable?: boolean;
  settingsFocus?: SettingsFocus;
  settingsLabel?: string;
  settingsRecovery?: SettingsRecoveryRequest;
}
interface OverlayProgressState {
  partialText?: string;
  completedChunks: number;
  totalChunks: number;
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
  onAdjustTranslation?: (
    result: TranslateResult,
    adjustment: TranslationAdjustmentRequest,
  ) => void;
  onSaveTranslationEdit?: (
    result: TranslateResult,
    translatedText: string,
    scope: TranslationRevisionScope,
  ) => Promise<{ result: TranslateResult; history: TranslationHistoryEntry[] }>;
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
  onSidebarChange: (active: boolean) => void;
  onSidebarWidthChange: (width: number) => void;
  onSidebarLayoutChange: (expanded: boolean, side: SidebarSide, width: number) => void;
  onPreferencesChange: (preferences: Pick<OverlayPreferences, 'targetLanguage' | 'style'>) => void;
  onDismiss: () => void;
}

type OverlayView = 'hidden' | 'trigger' | 'card' | 'sidebar' | 'sidebar-collapsed';
interface Position { left:number;top:number; }

const LANGUAGES = [
  ['zh-CN','简体中文'],['en','English'],['ja','日本語'],['de','Deutsch'],['fr','Français'],
] as const;

export class TranslationOverlay {
  private readonly host = document.createElement('div');
  private readonly root: ShadowRoot;
  private readonly logoUrl = browser.runtime.getURL('/brand/pi_logo.png');
  private view: OverlayView = 'hidden';
  private sidebarActive = false;
  private sidebarCollapsed = false;
  private markerNavigatorActive = false;
  private documentMemoryActive = false;
  private documentMemory?: DocumentMemorySnapshot;
  private documentMemoryError: string | undefined = undefined;
  private documentMemoryRequestRevision = 0;
  private clearDocumentMemoryArmed = false;
  private editingDocumentTermId: string | 'new' | undefined = undefined;
  private editingDocumentCandidateId: string | undefined = undefined;
  private sidebarWidth = 390;
  private preferences: OverlayPreferences = { targetLanguage:'zh-CN', style:'academic', sidebarSide:'right', sidebarWidth:390, autoRenderLatex:true };
  private lastRect?: ViewportRect;
  private cardPosition: Position | undefined;
  private currentResult?: TranslateResult;
  private latestRequestId?: string;
  private history: TranslationHistoryEntry[] = [];
  private historyIndex = -1;
  private alignedView = false;
  private readonly resultVersions = new Map<string, TranslateResult[]>();
  private readonly latexViewOverrides = new Map<string, boolean>();
  private markedOnly = false;
  private themeObserver?: MutationObserver;
  private colorSchemeQuery?: MediaQueryList;
  private themeTimer?: ReturnType<typeof setTimeout>;
  private readonly viewportInsetsProvider: ViewportInsetsProvider | undefined;
  private readonly normalizeFormulaPresentation: boolean;
  private viewportInsets: ViewportInsets = {top:0,right:0,bottom:0,left:0};
  private surfaceResizeObserver: ResizeObserver | undefined;
  private reflowFrame: number | undefined;
  private progressState: OverlayProgressState | undefined;

  constructor(
    private readonly actions: OverlayActions,
    options: TranslationOverlayOptions = {},
  ) {
    this.viewportInsetsProvider=options.viewportInsets;
    this.normalizeFormulaPresentation=options.normalizeFormulaPresentation === true;
    this.host.id = 'tex-selection-translator-root';
    this.root = this.host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=STYLES;this.root.append(style);
    document.documentElement.append(this.host);this.refreshViewportInsets();this.setView('hidden');this.trackTheme();
    document.addEventListener('keydown',this.onKeyDown,true);
    document.addEventListener('pointerdown',this.onDocumentPointerDown,true);
    window.addEventListener('resize',this.onViewportChange,{passive:true});
    window.addEventListener('scroll',this.onViewportChange,true);
    window.visualViewport?.addEventListener('resize',this.onViewportChange);
    window.visualViewport?.addEventListener('scroll',this.onViewportChange);
  }

  setPreferences(preferences: OverlayPreferences): void { this.preferences={...preferences};this.sidebarWidth=preferences.sidebarWidth;this.publishSidebarLayout();this.scheduleReflow(); }
  isSidebarActive(): boolean { return this.sidebarActive; }
  isShowingCard(): boolean { return this.view==='card'||this.view==='sidebar'; }
  ownsCurrentSelection(): boolean {
    const anchor = document.getSelection()?.anchorNode;
    return Boolean(anchor && anchor.getRootNode() === this.root);
  }

  openSidebar(): void {
    this.markerNavigatorActive=false;this.documentMemoryActive=false;this.sidebarActive=true;this.sidebarCollapsed=false;this.actions.onSidebarChange(true);
    if(this.progressState)this.renderProgress();else if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle();
    this.refreshDocumentMemory(true);
  }

  showTrigger(rect:ViewportRect):void {
    if(this.sidebarActive)return;this.lastRect=rect;this.cardPosition=undefined;this.clear();
    const button=this.button('', 'trigger','翻译选中的文本');const sparkle=document.createElement('span');sparkle.className='sparkle';sparkle.textContent='✦';
    button.append(this.logo('trigger-logo'),sparkle);button.addEventListener('pointerdown',e=>e.preventDefault());button.addEventListener('click',this.actions.onTranslate);
    this.refreshViewportInsets();this.root.append(button);this.place(button,rect);this.observeSize(button);this.setView('trigger');
  }

  showLoading(rect?:ViewportRect):void {
    this.documentMemoryActive=false;if(rect)this.lastRect=rect;if(this.sidebarActive)this.sidebarCollapsed=false;this.progressState={completedChunks:0,totalChunks:1};this.renderProgress();
  }

  showProgress(partialText:string|undefined,completedChunks:number,totalChunks:number):void { this.progressState={...(partialText?{partialText}:this.progressState?.partialText?{partialText:this.progressState.partialText}:{}),completedChunks,totalChunks};const status=this.root.querySelector<HTMLElement>('.loading-status');if(status)status.textContent=this.progressStatus(this.progressState);const preview=this.root.querySelector<HTMLElement>('.stream-preview');if(preview&&this.progressState.partialText){preview.hidden=false;preview.textContent=this.progressState.partialText;preview.scrollTop=preview.scrollHeight}else if(!this.sidebarCollapsed&&!this.root.querySelector('.progress'))this.renderProgress() }

  showSensitiveNotice(rect?:ViewportRect):void { this.progressState=undefined;if(rect)this.lastRect=rect;const surface=this.surface('连续翻译');const notice=document.createElement('div');notice.className='notice';const title=document.createElement('strong');title.textContent='已跳过敏感输入区域';const text=document.createElement('span');text.textContent='检测到密码、验证码或支付字段，内容没有发送到翻译 API。手动右键翻译仍由你决定。';notice.append(title,text);surface.append(notice);this.showSurface(surface); }

  showResult(result:TranslateResult,rect?:ViewportRect,history:TranslationHistoryEntry[]=[],alignedByDefault=false):void {
    this.markerNavigatorActive=false;this.documentMemoryActive=false;this.progressState=undefined;if(rect)this.lastRect=rect;this.currentResult=result;this.latestRequestId=result.requestId;this.history=history;
    if(result.documentId&&this.documentMemory?.documentId!==result.documentId)delete this.documentMemory;
    this.rememberResultVersion(result);
    this.historyIndex=history.findIndex(entry=>entry.requestId===result.requestId);this.alignedView=alignedByDefault&&Boolean(result.alignedSegments?.length);
    if(this.sidebarActive)this.sidebarCollapsed=false;this.renderResult(result);
  }

  refreshDocumentMemory(force=false):void {
    if(!this.actions.onGetDocumentMemory)return;
    if(!force&&!this.sidebarActive&&!this.documentMemoryActive)return;
    const requestRevision=++this.documentMemoryRequestRevision;
    void this.actions.onGetDocumentMemory().then((memory)=>{
      if(requestRevision!==this.documentMemoryRequestRevision)return;
      const currentDocumentId=this.currentResult?.documentId;
      if(currentDocumentId&&memory.documentId!==currentDocumentId)return;
      this.documentMemory=memory;this.documentMemoryError=undefined;
      if(this.documentMemoryActive)this.renderDocumentMemory();else this.updateDocumentMemoryButton();
    }).catch((error:unknown)=>{
      if(requestRevision!==this.documentMemoryRequestRevision||!this.documentMemoryActive)return;
      this.documentMemoryError=error instanceof Error?error.message:'无法读取本文记忆';this.renderDocumentMemory();
    });
  }

  updateHistory(history:TranslationHistoryEntry[]):void {
    this.history=history;
    this.historyIndex=this.currentResult
      ? history.findIndex(entry=>entry.requestId===this.currentResult?.requestId)
      : -1;
    if(this.currentResult&&!this.progressState&&this.isShowingCard()){
      const scrollTop=this.root.querySelector<HTMLElement>('.surface')?.scrollTop??0;
      this.renderResult(this.currentResult);
      const surface=this.root.querySelector<HTMLElement>('.surface');if(surface)surface.scrollTop=scrollTop;
    }
  }

  private resultRootRequestId(result:TranslateResult):string {
    return result.revision?.rootRequestId??result.requestId;
  }

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

  private navigateVersion(result:TranslateResult,delta:number):void {
    const versions=this.versionsFor(result);
    const current=Math.max(0,versions.findIndex(version=>version.requestId===result.requestId));
    const next=current+delta;
    if(next<0||next>=versions.length)return;
    this.alignedView=false;
    this.renderResult(versions[next]!);
  }

  showError(error:ErrorDisplay,rect?:ViewportRect):void {
    this.progressState=undefined;if(rect)this.lastRect=rect;if(this.sidebarActive)this.sidebarCollapsed=false;const surface=this.surface('翻译失败');
    const body=document.createElement('div');body.className='error';body.textContent=error.message;surface.append(body);const footer=document.createElement('div');footer.className='footer';
    const showRetry=error.retryable??true;if(showRetry){const retry=this.button('重试','action primary');retry.addEventListener('click',()=>this.actions.onRetry({kind:'failed'}));footer.append(retry)}
    if(error.showSettings){const settings=this.button(error.settingsLabel??'打开设置',`action${showRetry?'':' primary'}`);this.bindSettingsButton(settings,error.settingsFocus,error.settingsRecovery);footer.append(settings)}if(footer.childElementCount)surface.append(footer);this.showSurface(surface);
  }

  showSettingsRecoveryConfirmation(partialText?:string,rect?:ViewportRect):void {
    this.progressState=undefined;
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

  hide():void { this.markerNavigatorActive=false;this.documentMemoryActive=false;this.progressState=undefined;this.clear();this.setView('hidden'); }
  resetSession():void {
    this.documentMemoryRequestRevision+=1;this.markerNavigatorActive=false;this.documentMemoryActive=false;this.progressState=undefined;this.sidebarActive=false;this.sidebarCollapsed=false;this.history=[];this.historyIndex=-1;this.resultVersions.clear();this.latexViewOverrides.clear();delete this.currentResult;delete this.latestRequestId;delete this.documentMemory;this.documentMemoryError=undefined;this.clear();this.setView('hidden');
  }
  hideTrigger():void { if(this.view==='trigger')this.hide(); }
  resetCardPosition():void { this.cardPosition=undefined; }
  keepCardInViewport():void { this.reflowVisibleSurface(); }
  updateViewportInsets():void { this.refreshViewportInsets();this.scheduleReflow(); }
  refreshSourceMarkState():void {
    if(!this.currentResult||this.progressState||!this.isShowingCard())return;
    const scrollTop=this.root.querySelector<HTMLElement>('.surface')?.scrollTop??0;
    this.renderAfterMarkToggle(this.currentResult);
    const surface=this.root.querySelector<HTMLElement>('.surface');
    if(surface)surface.scrollTop=scrollTop;
  }

  destroy():void { if(this.themeTimer)clearTimeout(this.themeTimer);this.clear();this.themeObserver?.disconnect();this.colorSchemeQuery?.removeEventListener('change',this.onColorSchemeChange);document.removeEventListener('keydown',this.onKeyDown,true);document.removeEventListener('pointerdown',this.onDocumentPointerDown,true);window.removeEventListener('resize',this.onViewportChange);window.removeEventListener('scroll',this.onViewportChange,true);window.visualViewport?.removeEventListener('resize',this.onViewportChange);window.visualViewport?.removeEventListener('scroll',this.onViewportChange);this.host.remove(); }

  private renderSidebarIdle():void {
    const surface=this.surface('连续翻译');const idle=document.createElement('div');idle.className='idle';const logo=this.logo('logo');
    const title=document.createElement('strong');title.textContent='侧栏已固定';const text=document.createElement('p');text.textContent='现在直接选中网页或 Overleaf 中的句子，译文会自动出现在这里。';idle.append(logo,title,text);surface.append(idle);this.showSurface(surface);
  }

  private openMarkerNavigator():void {
    if(!this.actions.getSourceMarkSummaries?.().length)return;
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
    for(const summary of summaries){const item=document.createElement('article');item.className=`marker-note${summary.locationState==='missing'?' missing':''}`;const main=this.button('','marker-note-main',summary.locationState==='missing'?'原文位置已变化，仍可跳转到原页':'跳转到原文');const meta=document.createElement('div');meta.className='marker-note-meta';const page=document.createElement('span');page.textContent=summary.pageNumber?`第 ${summary.pageNumber} 页`:'当前页面';meta.append(page);if(summary.locationState==='missing'){const status=document.createElement('span');status.className='marker-note-status';status.textContent='原文位置已变化';meta.append(status)}else if(summary.locationState==='pending'){const status=document.createElement('span');status.className='marker-note-status';status.textContent='点击定位';meta.append(status)}const source=document.createElement('div');source.className='marker-note-source';source.textContent=summary.originalText;const target=document.createElement('div');target.className='marker-note-target';renderTranslationContent(target,summary.translatedText,false);main.append(meta,source,target);main.addEventListener('click',()=>{void this.actions.onNavigateSourceMark?.(summary.markerId).then(()=>this.renderMarkerNavigator())});const actions=document.createElement('div');actions.className='marker-note-actions';const copy=this.button('复制','', '复制这条标记');copy.addEventListener('click',()=>{const sourceText=normalizeLatexForClipboard(summary.originalText).replace(/\r?\n/gu,'\n> ');const targetText=normalizeLatexForClipboard(summary.translatedText);void navigator.clipboard.writeText(`> ${sourceText}\n\n${targetText}`).then(()=>{copy.textContent='已复制';copy.title='已复制'})});const remove=this.button('删除','', '删除这条标记');remove.addEventListener('click',()=>{void this.actions.onRemoveSourceMark?.(summary.markerId).then(()=>this.renderMarkerNavigator())});actions.append(copy,remove);item.append(main,actions);list.append(item)}
    surface.append(list);this.showSurface(surface);
  }

  private openDocumentMemory():void {
    if(!this.actions.onGetDocumentMemory)return;
    this.markerNavigatorActive=false;this.documentMemoryActive=true;this.sidebarCollapsed=false;this.documentMemoryError=undefined;this.clearDocumentMemoryArmed=false;
    this.renderDocumentMemory();
    this.refreshDocumentMemory(true);
  }

  private updateDocumentMemory(task:Promise<DocumentMemorySnapshot>):void {
    this.documentMemoryError=undefined;const requestRevision=++this.documentMemoryRequestRevision;
    void task.then((memory)=>{if(requestRevision!==this.documentMemoryRequestRevision)return;this.documentMemory=memory;if(this.documentMemoryActive)this.renderDocumentMemory();else this.updateDocumentMemoryButton()}).catch((error:unknown)=>{if(requestRevision!==this.documentMemoryRequestRevision)return;this.documentMemoryError=error instanceof Error?error.message:'操作失败';if(this.documentMemoryActive)this.renderDocumentMemory()});
  }

  private pendingDocumentReviews(memory=this.documentMemory):DocumentMemoryTranslation[] {
    return memory?.recentTranslations.filter((entry)=>entry.review&&!entry.review.reviewedAt)??[];
  }

  private documentMemoryButtonLabel():string {
    const count=this.pendingDocumentReviews().length;
    return count?`本文 · 待核对 ${count}`:'本文';
  }

  private updateDocumentMemoryButton():void {
    const button=this.root.querySelector<HTMLButtonElement>('.document-memory-action');
    if(!button)return;
    const count=this.pendingDocumentReviews().length;
    button.textContent=this.documentMemoryButtonLabel();
    button.ariaLabel=this.documentMemoryButtonLabel();
    button.classList.toggle('has-review',count>0);
    button.title=count?`有 ${count} 条图像识别结果待核对`:'查看本文术语和最近翻译';
  }

  private documentTermEditor(
    sourceValue:string,
    targetValue:string,
    id?:string,
  ):HTMLElement {
    const editor=document.createElement('div');editor.className='document-edit';const source=document.createElement('input');source.value=sourceValue;source.placeholder='原文术语';source.ariaLabel='原文术语';const target=document.createElement('input');target.value=targetValue;target.placeholder='固定译法';target.ariaLabel='固定译法';const save=this.button('保存','','保存本文术语');save.addEventListener('click',()=>{const cleanSource=source.value.trim(),cleanTarget=target.value.trim();if(!cleanSource||!cleanTarget){(!cleanSource?source:target).focus();return}this.editingDocumentTermId=undefined;this.updateDocumentMemory(this.actions.onUpsertDocumentTerm!({...(id?{id}:{}),source:cleanSource,target:cleanTarget}))});editor.append(source,target,save);queueMicrotask(()=>source.focus());return editor;
  }

  private documentCandidateEditor(sourceValue:string,targetValue:string):HTMLElement {
    const editor=document.createElement('div');editor.className='document-edit document-candidate-edit';
    const source=document.createElement('div');source.className='document-source';source.textContent=sourceValue;
    const target=document.createElement('input');target.value=targetValue;target.placeholder='修改候选译法';target.ariaLabel=`修改 ${sourceValue} 的候选译法`;
    const actions=document.createElement('div');actions.className='document-edit-actions';
    const cancel=()=>{this.editingDocumentCandidateId=undefined;this.renderDocumentMemory()};
    const commit=()=>{const cleanTarget=target.value.trim();if(!cleanTarget){target.focus();return}this.editingDocumentCandidateId=undefined;this.updateDocumentMemory(this.actions.onUpsertDocumentTerm!({source:sourceValue,target:cleanTarget}))};
    const save=this.button('保存','','保存修改并采用');save.addEventListener('click',commit);
    const dismiss=this.button('取消','','取消修改');dismiss.addEventListener('click',cancel);
    target.addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();commit()}else if(event.key==='Escape'){event.preventDefault();cancel()}});
    actions.append(save,dismiss);editor.append(source,target,actions);queueMicrotask(()=>{target.focus();target.select()});return editor;
  }

  private openDocumentTranslation(entry:DocumentMemoryTranslation):void {
    this.documentMemoryActive=false;this.alignedView=false;
    const result=[this.currentResult,...this.history].find((candidate)=>candidate?.requestId===entry.requestId)??documentMemoryTranslationResult(entry,this.documentMemory?.label);
    this.currentResult=result;this.renderResult(result);
  }

  private renderDocumentMemory():void {
    const surface=this.surface('本文');
    const meta=document.createElement('div');meta.className='document-meta';meta.textContent=this.documentMemory?`${this.documentMemory.label} · 仅保存在本机`:'正在读取本文记忆…';surface.append(meta);
    if(this.documentMemoryError){const error=document.createElement('div');error.className='error';error.textContent=this.documentMemoryError;surface.append(error)}
    const memory=this.documentMemory;if(!memory){this.showSurface(surface);return}

    const pendingReviews=this.pendingDocumentReviews(memory);
    if(pendingReviews.length){const reviews=document.createElement('section');reviews.className='document-section document-review-section';const head=document.createElement('div');head.className='document-section-head';const title=document.createElement('strong');title.textContent='待核对';const count=document.createElement('span');count.textContent=String(pendingReviews.length);head.append(title,count);reviews.append(head);const list=document.createElement('div');list.className='document-review-list';for(const entry of pendingReviews){const review=entry.review!;const row=document.createElement('article');row.className='document-review-row';const meta=document.createElement('div');meta.className='document-review-meta';const page=document.createElement('span');page.textContent=entry.sourceLocation?`第 ${entry.sourceLocation.pageNumber} 页`:'PDF 选区';const reason=document.createElement('strong');const reasons=[review.formulaNeedsReview?'公式结构待核对':'',review.uncertainSpans.length?`${review.uncertainSpans.length} 处内容待核对`:''].filter(Boolean);reason.textContent=reasons.join(' · ');const time=document.createElement('span');time.textContent=new Date(review.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});meta.append(page,reason,time);const source=document.createElement('div');source.className='document-review-source';source.textContent=entry.originalText;const actions=document.createElement('div');actions.className='document-review-actions';if(entry.sourceLocation&&this.actions.onNavigateToPdfRegion){const locate=this.button('返回区域','','返回 PDF 原选区');locate.ariaLabel='返回区域';locate.addEventListener('click',()=>this.actions.onNavigateToPdfRegion?.(entry.sourceLocation!));actions.append(locate)}const open=this.button('打开结果','','查看待核对译文');open.ariaLabel='打开结果';open.addEventListener('click',()=>this.openDocumentTranslation(entry));actions.append(open);if(this.actions.canRetryDocumentReview?.(entry)&&this.actions.onRetryDocumentReview){const retry=this.button('重新识别','','重新截图识别这个区域');retry.ariaLabel='重新识别';retry.addEventListener('click',()=>this.actions.onRetryDocumentReview?.(entry));actions.append(retry)}if(this.actions.onResolveDocumentReview){const resolve=this.button('已核对','review-resolve','标记为已人工核对');resolve.ariaLabel='已核对';resolve.addEventListener('click',()=>this.updateDocumentMemory(this.actions.onResolveDocumentReview!(review.id)));actions.append(resolve)}row.append(meta,source,actions);list.append(row)}reviews.append(list);surface.append(reviews)}

    const confirmed=document.createElement('section');confirmed.className='document-section';const confirmedHead=document.createElement('div');confirmedHead.className='document-section-head';const confirmedTitle=document.createElement('strong');confirmedTitle.textContent='固定译法';const confirmedCount=document.createElement('span');confirmedCount.textContent=String(memory.confirmedTerms.length);const add=this.button('＋添加','document-action','添加本文术语');add.addEventListener('click',()=>{this.editingDocumentCandidateId=undefined;this.editingDocumentTermId='new';this.renderDocumentMemory()});confirmedHead.append(confirmedTitle,confirmedCount,add);confirmed.append(confirmedHead);const confirmedList=document.createElement('div');
    if(this.editingDocumentTermId==='new')confirmedList.append(this.documentTermEditor('',''));
    for(const term of memory.confirmedTerms){const row=document.createElement('div');row.className='document-row';if(this.editingDocumentTermId===term.id){row.style.display='block';row.append(this.documentTermEditor(term.source,term.target,term.id));confirmedList.append(row);continue}const pair=document.createElement('div');pair.className='document-pair';const source=document.createElement('div');source.className='document-source';source.textContent=term.source;const target=document.createElement('div');target.className='document-target';target.textContent=term.target;pair.append(source,target);const actions=document.createElement('div');actions.className='document-row-actions';const edit=this.button('编辑','','编辑本文术语');edit.addEventListener('click',()=>{this.editingDocumentCandidateId=undefined;this.editingDocumentTermId=term.id;this.renderDocumentMemory()});const remove=this.button('删除','','删除本文术语');remove.addEventListener('click',()=>this.updateDocumentMemory(this.actions.onRemoveDocumentTerm!(term.id)));actions.append(edit,remove);row.append(pair,actions);confirmedList.append(row)}
    if(!memory.confirmedTerms.length&&this.editingDocumentTermId!=='new'){const empty=document.createElement('div');empty.className='document-empty';empty.textContent='确认术语后，后续译句会优先沿用这里的译法。';confirmedList.append(empty)}confirmed.append(confirmedList);surface.append(confirmed);

    if(memory.candidateTerms.length){const candidates=document.createElement('section');candidates.className='document-section';const head=document.createElement('div');head.className='document-section-head';const title=document.createElement('strong');title.textContent='待确认术语';const count=document.createElement('span');count.textContent=String(memory.candidateTerms.length);head.append(title,count);candidates.append(head);const list=document.createElement('div');list.className='document-list';for(const term of memory.candidateTerms){const row=document.createElement('div');row.className='document-row';if(this.editingDocumentCandidateId===term.id){row.style.display='block';row.append(this.documentCandidateEditor(term.source,term.target));list.append(row);continue}const pair=document.createElement('div');pair.className='document-pair';const source=document.createElement('div');source.className='document-source';source.textContent=term.source;const target=document.createElement('div');target.className='document-target';target.textContent=term.target;pair.append(source,target);const actions=document.createElement('div');actions.className='document-row-actions';const confirm=this.button('采用','','采用为本文固定译法');confirm.addEventListener('click',()=>this.updateDocumentMemory(this.actions.onConfirmDocumentTerm!(term.id)));const edit=this.button('修改','','修改候选译法后采用');edit.addEventListener('click',()=>{this.editingDocumentTermId=undefined;this.editingDocumentCandidateId=term.id;this.renderDocumentMemory()});const dismiss=this.button('忽略','','不再推荐此映射');dismiss.addEventListener('click',()=>this.updateDocumentMemory(this.actions.onDismissDocumentTermCandidate!(term.id)));actions.append(confirm,edit,dismiss);row.append(pair,actions);list.append(row)}candidates.append(list);surface.append(candidates)}

    const recent=document.createElement('section');recent.className='document-section';const recentHead=document.createElement('div');recentHead.className='document-section-head';const recentTitle=document.createElement('strong');recentTitle.textContent='最近翻译';const recentCount=document.createElement('span');recentCount.textContent=String(memory.recentTranslations.length);recentHead.append(recentTitle,recentCount);recent.append(recentHead);const recentList=document.createElement('div');recentList.className='document-list';for(const entry of memory.recentTranslations){const button=this.button('','document-translation','查看这条翻译');const source=document.createElement('div');source.className='document-source';source.textContent=entry.originalText;const target=document.createElement('div');target.className='document-target';renderTranslationContent(target,entry.translatedText,false);button.append(source,target);button.addEventListener('click',()=>this.openDocumentTranslation(entry));recentList.append(button)}if(!memory.recentTranslations.length){const empty=document.createElement('div');empty.className='document-empty';empty.textContent='本文完成的翻译会出现在这里。';recentList.append(empty)}recent.append(recentList);surface.append(recent);

    if(this.actions.onClearDocumentMemory){const footer=document.createElement('div');footer.className='document-footer';const clear=this.button(this.clearDocumentMemoryArmed?'再次点击清空':'清空本文记忆','document-clear');clear.addEventListener('click',()=>{if(!this.clearDocumentMemoryArmed){this.clearDocumentMemoryArmed=true;this.renderDocumentMemory();return}this.clearDocumentMemoryArmed=false;this.updateDocumentMemory(this.actions.onClearDocumentMemory!())});footer.append(clear);surface.append(footer)}
    this.showSurface(surface);
  }

  private progressStatus(progress:OverlayProgressState):string { return progress.totalChunks>1?`正在翻译长文本 ${Math.min(progress.completedChunks+1,progress.totalChunks)}/${progress.totalChunks}…`:progress.partialText?'正在接收译文…':'正在连接翻译 API…' }

  private renderProgress():void { const progressState=this.progressState??{completedChunks:0,totalChunks:1};const surface=this.surface('正在翻译');const progress=document.createElement('div');progress.className='progress';const body=document.createElement('div');body.className='loading';body.setAttribute('role','status');body.setAttribute('aria-live','polite');const spinner=document.createElement('span');spinner.className='spinner';spinner.ariaHidden='true';const text=document.createElement('span');text.className='loading-status';text.textContent=this.progressStatus(progressState);const preview=document.createElement('div');preview.className='stream-preview';preview.hidden=!progressState.partialText;if(progressState.partialText)preview.textContent=progressState.partialText;body.append(spinner,text);progress.append(body,preview);surface.append(progress);this.showSurface(surface);if(progressState.partialText)preview.scrollTop=preview.scrollHeight }

  private resultContainsLatex(result:TranslateResult):boolean {
    return containsRenderableLatex(result.translatedText)||Boolean(
      result.alignedSegments?.some(segment=>containsRenderableLatex(segment.translatedText)),
    );
  }

  private shouldRenderLatex(result:TranslateResult):boolean {
    return this.latexViewOverrides.get(result.requestId)??this.preferences.autoRenderLatex;
  }

  private translatedTextElement(text:string,className:string,renderLatex:boolean):HTMLDivElement {
    const element=document.createElement('div');element.className=className;
    renderTranslationContent(element,text,renderLatex);
    return element;
  }

  private renderResult(result:TranslateResult):void {
    result=normalizeResultForPresentation(result,this.normalizeFormulaPresentation);this.currentResult=result;const surface=this.surface('翻译结果');const tools=surface.querySelector<HTMLElement>('.header-tools');
    const navigationHistory=this.navigationHistory();this.historyIndex=navigationHistory.findIndex(entry=>entry.requestId===result.requestId);
    if(tools&&this.sidebarActive&&this.history.some(entry=>this.actions.hasSourceMarksForResult?.(entry))){const filter=this.button('','icon mark-filter','仅查看已标记翻译');filter.append(this.markerIcon());filter.classList.toggle('active',this.markedOnly);filter.setAttribute('aria-pressed',String(this.markedOnly));filter.addEventListener('click',()=>this.toggleMarkedFilter());tools.prepend(filter)}
    const versions=this.versionsFor(result);const versionIndex=versions.findIndex(version=>version.requestId===result.requestId);if(tools&&versions.length>1&&versionIndex>=0){const older=this.button('‹','icon','查看上一版译文');older.disabled=versionIndex>=versions.length-1;older.addEventListener('click',()=>this.navigateVersion(result,1));const counter=document.createElement('span');counter.className='counter version-counter';counter.textContent=`v${versionIndex+1}/${versions.length}`;const newer=this.button('›','icon','查看下一版译文');newer.disabled=versionIndex<=0;newer.addEventListener('click',()=>this.navigateVersion(result,-1));tools.prepend(older,counter,newer)}
    if(tools&&navigationHistory.length>1&&this.historyIndex>=0){const older=this.button('‹','icon','上一条翻译（Alt+↑）');older.disabled=this.historyIndex>=navigationHistory.length-1;older.addEventListener('click',()=>this.navigate(1));const counter=document.createElement('span');counter.className='counter';counter.textContent=`${this.historyIndex+1}/${navigationHistory.length}`;const newer=this.button('›','icon','下一条翻译（Alt+↓）');newer.disabled=this.historyIndex<=0;newer.addEventListener('click',()=>this.navigate(-1));tools.prepend(older,counter,newer)}
    const topLine=document.createElement('div');topLine.className='result-topline';const meta=document.createElement('div');meta.className='meta';if(result.sourceKind==='image-region'||result.sourceKind==='pdf-region-text'){const sourceKind=document.createElement('span');sourceKind.className='source-badge';sourceKind.textContent=result.sourceKind==='image-region'?'图像识别':'文字提取';meta.append(sourceKind)}if(result.sourceHost){const host=document.createElement('span');host.textContent=result.sourceHost;meta.append(host)}if(result.sourceLocation&&this.actions.onNavigateToPdfRegion){const location=this.button(`第 ${result.sourceLocation.pageNumber} 页`,'source-location','返回 PDF 原选区');location.addEventListener('click',()=>this.actions.onNavigateToPdfRegion?.(result.sourceLocation!));meta.append(location)}if(result.completedAt){const time=document.createElement('span');time.className='meta-dot';time.textContent=new Date(result.completedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});meta.append(time)}if(result.latencyMs){const latency=document.createElement('span');latency.className='meta-dot';latency.textContent=`${result.latencyMs} ms`;meta.append(latency)}if(result.cached){const cache=document.createElement('span');cache.className='cache-badge';cache.textContent='会话缓存';meta.append(cache)}if(result.contextUsed){const context=document.createElement('span');context.className='cache-badge';context.textContent='含上下文';meta.append(context)}if((result.chunkCount??1)>1){const chunks=document.createElement('span');chunks.className='meta-dot';chunks.textContent=`${result.chunkCount} 段`;meta.append(chunks)}if(meta.childElementCount)topLine.append(meta);
    if(result.alignedSegments?.length){const switcher=document.createElement('div');switcher.className='view-switch';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','译文显示方式');const full=this.button('全文',`view-button${this.alignedView?'':' active'}`,'显示完整译文');const aligned=this.button('逐句',`view-button${this.alignedView?' active':''}`,'显示逐句对照');full.setAttribute('aria-pressed',String(!this.alignedView));aligned.setAttribute('aria-pressed',String(this.alignedView));full.addEventListener('click',()=>{this.alignedView=false;this.renderResult(result)});aligned.addEventListener('click',()=>{this.alignedView=true;this.renderResult(result)});switcher.append(full,aligned);topLine.append(switcher)}if(this.resultContainsLatex(result)){const rendered=this.shouldRenderLatex(result);const formulaView=this.button(rendered?'源码':'公式',`view-button formula-view${rendered?' active':''}`,rendered?'显示可编辑的 LaTeX 源码':'渲染译文中的 LaTeX 公式');formulaView.setAttribute('aria-pressed',String(rendered));formulaView.addEventListener('click',()=>{this.latexViewOverrides.set(result.requestId,!rendered);this.renderResult(result)});topLine.append(formulaView)}if(topLine.childElementCount)surface.append(topLine);
    if(result.sourceKind==='image-region'||result.sourceKind==='pdf-region-text')surface.append(this.recognizedSource(result,result.sourceKind==='image-region'?'查看识别原文':'查看提取原文'));
    const renderLatex=this.shouldRenderLatex(result);
    if(this.alignedView&&result.alignedSegments?.length){
      const list=document.createElement('div');list.className='aligned-list';
      const renderTargets:TranslationContentTarget[]=[];
      for(const segment of result.alignedSegments){
        const row=document.createElement('section');row.className='segment';row.tabIndex=0;
        const num=document.createElement('span');num.className='segment-number';num.textContent=segment.id.replace(/^S/,'');
        const content=document.createElement('div');
        const pair=document.createElement('div');pair.className='segment-pair';
        const source=document.createElement('div');source.className='segment-source';source.textContent=segment.originalText;
        const target=document.createElement('div');target.className='segment-target';
        renderTargets.push({container:target,text:segment.translatedText,renderLatex});
        pair.append(source,target);
        const actions=document.createElement('div');actions.className='segment-actions';
        const copy=this.button('复制本句','mini');copy.addEventListener('click',()=>void navigator.clipboard.writeText(normalizeLatexForClipboard(segment.translatedText)));
        const retry=this.button('仅翻译此句','mini');retry.addEventListener('click',()=>this.actions.onTranslateText(segment.originalText));
        actions.append(copy,retry);
        if(this.actions.canMarkSource?.(result,segment)){
          const mark=this.button('','mini segment-mark',this.actions.isSourceMarked?.(result,segment)?'取消本句标记':'轻标记本句');
          mark.append(this.markerIcon());
          mark.classList.toggle('active',Boolean(this.actions.isSourceMarked?.(result,segment)));
          mark.setAttribute('aria-pressed',String(Boolean(this.actions.isSourceMarked?.(result,segment))));
          mark.addEventListener('click',()=>this.toggleSegmentSourceMark(result,segment));
          actions.append(mark);
        }
        content.append(pair,actions);row.append(num,content);list.append(row);
      }
      renderTranslationContents(renderTargets);
      surface.append(list);
    }else{surface.append(this.translatedTextElement(result.translatedText,'body',renderLatex))}
    if(result.uncertainSpans?.length){const uncertain=document.createElement('div');uncertain.className='uncertain-note';uncertain.textContent=result.formulaNeedsReview?'公式未能自动通过结构校验，已保留可用译文，请核对 LaTeX。':`有 ${result.uncertainSpans.length} 处内容无法完全确认，已在原文中标记。`;surface.append(uncertain)}
    if(result.warnings.length){const warning=document.createElement('div');warning.className='warning';warning.textContent='部分 LaTeX 使用了保守保护策略，请复制后检查。';surface.append(warning)}
    const footer=document.createElement('div');footer.className='footer';const copy=this.button('复制','action copy-action','复制译文（保留标准 LaTeX）');copy.addEventListener('click',async()=>{await navigator.clipboard.writeText(normalizeLatexForClipboard(result.translatedText));copy.textContent='已复制'});footer.append(copy);if(this.actions.onToggleSourceMark){const markable=Boolean(this.actions.canMarkSource?.(result));const marked=Boolean(this.actions.isSourceMarked?.(result));const mark=this.button(marked?'已标记':'标记','mark-action');mark.prepend(this.markerIcon());mark.classList.toggle('active',marked);mark.classList.toggle('needs-anchor',!markable&&!marked);mark.setAttribute('aria-pressed',String(marked));mark.title=marked?'取消原文标记':markable?'标记原文，悬停查看译文':'保持或重新选中对应原文，然后点击标记';mark.ariaLabel=mark.title;mark.addEventListener('pointerdown',event=>event.preventDefault());mark.addEventListener('click',()=>this.toggleSourceMark(result));footer.append(mark)}footer.append(this.moreMenu(result));surface.append(footer);this.showSurface(surface);
  }

  private moreMenu(result:TranslateResult):HTMLElement {
    const details=document.createElement('details');details.className='more';const summary=document.createElement('summary');summary.textContent='•••';summary.title='更多操作';summary.ariaLabel='更多翻译操作';const menu=document.createElement('div');menu.className='menu';
    const versions=this.versionsFor(result);const versionIndex=versions.findIndex(version=>version.requestId===result.requestId);
    if(result.requestId===this.latestRequestId){if(this.actions.onAdjustTranslation&&this.actions.onSaveTranslationEdit)menu.append(this.menuButton('调整译文…',()=>this.openTranslationAdjustment(result)));const repeatLabel=result.sourceKind==='image-region'?'重新识别此区域':'重新翻译';menu.append(this.menuButton(repeatLabel,()=>this.actions.onRetry({kind:'result',result,intent:'repeat'})));if(result.sourceLocation&&this.actions.onAdjustPdfRegion)menu.append(this.menuButton('调整原选区',()=>this.beginPdfRegionAdjustment()))}else if(versionIndex>0&&this.actions.onSaveTranslationEdit){menu.append(this.menuButton('采用当前版本',()=>this.adoptTranslationVersion(result)))}
    const markerCount=this.actions.getSourceMarkSummaries?.().length??0;if(markerCount&&this.actions.canPersistSourceMarks?.())menu.append(this.menuButton(`查看本文标记（${markerCount}）`,()=>this.openMarkerNavigator()));
    if(this.actions.hasAnySourceMarks?.()&&this.actions.onCopyMarkedNotes){menu.append(this.menuButton('复制标记笔记',()=>{void this.actions.onCopyMarkedNotes?.().then((count)=>{const button=menu.querySelector<HTMLButtonElement>('[data-mark-export]');if(button)button.textContent=`已复制 ${count} 条标记`})}));const exportButton=menu.lastElementChild;if(exportButton instanceof HTMLElement)exportButton.dataset.markExport='true'}
    if(this.actions.canPersistSourceMarks?.()&&this.actions.onSetSourceMarkPersistence){const enabled=Boolean(this.actions.isSourceMarkPersistenceEnabled?.());const markCurrent=!enabled&&Boolean(this.actions.canMarkSource?.(result))&&!Boolean(this.actions.isSourceMarked?.(result));menu.append(this.menuButton(enabled?'停止保存本文标记':markCurrent?'标记当前译句并保存':'保存本文标记',()=>{if(markCurrent)this.actions.onToggleSourceMark?.(result);void this.actions.onSetSourceMarkPersistence?.(!enabled).then(()=>this.renderResult(result))}));if((this.actions.hasAnySourceMarks?.()||this.actions.hasStoredSourceMarks?.())&&this.actions.onClearSourceMarks)menu.append(this.menuButton('清除本文标记',()=>{void this.actions.onClearSourceMarks?.().then(()=>this.renderResult(result))}))}
    const languageLabel=document.createElement('label');languageLabel.textContent='目标语言';const language=document.createElement('select');for(const [value,label] of LANGUAGES){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===this.preferences.targetLanguage;language.append(option)}languageLabel.append(language);menu.append(languageLabel);
    language.addEventListener('change',()=>{this.preferences={...this.preferences,targetLanguage:language.value};this.actions.onPreferencesChange({targetLanguage:language.value,style:this.preferences.style});details.open=false;this.actions.onRetry({kind:'result',result,intent:'language-change'})});
    if(this.sidebarActive&&this.actions.onPauseSite)menu.append(this.menuButton('暂停本网站连续翻译',()=>void this.actions.onPauseSite?.().then(()=>this.closeSurface())));const settings=this.menuButton('完整设置',()=>undefined);this.bindSettingsButton(settings);menu.append(settings);details.append(summary,menu);details.addEventListener('toggle',()=>{if(details.open){this.placeMoreMenu(details,menu);requestAnimationFrame(()=>this.placeMoreMenu(details,menu))}});return details;
  }

  private openTranslationAdjustment(result:TranslateResult):void {
    if(!this.actions.onAdjustTranslation||!this.actions.onSaveTranslationEdit)return;
    const surface=this.surface('调整译文');const panel=document.createElement('div');panel.className='revision-panel';
    const editLabel=document.createElement('label');editLabel.className='revision-label';editLabel.textContent='直接修改译文';const editor=document.createElement('textarea');editor.className='revision-editor';editor.value=normalizeLatexForClipboard(result.translatedText);editor.maxLength=24000;editor.setAttribute('aria-label','直接修改译文');editLabel.append(editor);panel.append(editLabel);
    const note=document.createElement('p');note.className='revision-note';note.textContent='直接保存不会调用 API；模型调整会发送原文和当前译稿。已有标记会同步更新。';panel.append(note);
    const scopeLabel=document.createElement('label');scopeLabel.className='revision-scope';const scopeText=document.createElement('span');scopeText.textContent='作用范围';const scope=document.createElement('select');scope.ariaLabel='译文调整作用范围';for(const [value,label] of [['current','仅本次'],['document','用于本文']] as const){const option=document.createElement('option');option.value=value;option.textContent=label;scope.append(option)}scopeLabel.append(scopeText,scope);panel.append(scopeLabel);const selectedScope=()=>scope.value as TranslationRevisionScope;
    const editActions=document.createElement('div');editActions.className='revision-actions';const cancel=this.button('取消','action');cancel.addEventListener('click',()=>this.renderResult(result));const save=this.button('保存修改','action primary');const saveStatus=document.createElement('span');saveStatus.className='revision-status';editActions.append(saveStatus,cancel,save);panel.append(editActions);
    const divider=document.createElement('div');divider.className='revision-divider';divider.textContent='或让模型重新调整';panel.append(divider);
    const choices=document.createElement('div');choices.className='revision-choices';const run=(adjustment:Omit<TranslationAdjustmentRequest,'scope'>)=>{this.actions.onAdjustTranslation?.(result,{...adjustment,scope:selectedScope()})};
    const faithful=this.button('更忠实原文','revision-choice');faithful.addEventListener('click',()=>run({kind:'faithful',label:'更忠实',instruction:'Keep the translation especially faithful to the source meaning, logical relations, qualifiers, and technical detail. Avoid paraphrasing or adding information.'}));
    const natural=this.button('更自然简洁','revision-choice');natural.addEventListener('click',()=>run({kind:'natural',label:'更自然',instruction:'Use natural, concise target-language phrasing while preserving every technical claim and qualification in the source.'}));
    const terminology=this.button('修正术语与公式','revision-choice');terminology.addEventListener('click',()=>run({kind:'terminology-formula',label:'术语与公式',instruction:'Prioritize consistent academic terminology and exact preservation of every protected formula, symbol, variable, equation number, and LaTeX structure.'}));
    const customToggle=this.button('自定义调整要求…','revision-choice');choices.append(faithful,natural,terminology,customToggle);panel.append(choices);
    const custom=document.createElement('div');custom.className='revision-custom';custom.hidden=true;const customInput=document.createElement('textarea');customInput.maxLength=500;customInput.placeholder='例如：将 sensing 统一译为“感知”，语气更正式';customInput.setAttribute('aria-label','自定义调整要求');const customCount=document.createElement('span');customCount.textContent='0/500';const customApply=this.button('按要求重译','action primary');custom.append(customInput,customCount,customApply);panel.append(custom);
    customToggle.addEventListener('click',()=>{custom.hidden=!custom.hidden;if(!custom.hidden)queueMicrotask(()=>customInput.focus())});customInput.addEventListener('input',()=>{customCount.textContent=`${customInput.value.length}/500`});customApply.addEventListener('click',()=>{const instruction=customInput.value.trim();if(!instruction){customInput.focus();return}run({kind:'custom',label:'自定义调整',instruction})});
    save.addEventListener('click',()=>{const translatedText=editor.value.trim();if(!translatedText){editor.focus();return}if(normalizeLatexForClipboard(result.translatedText).trim()===translatedText){saveStatus.textContent='译文没有变化';return}save.disabled=true;cancel.disabled=true;scope.disabled=true;saveStatus.textContent='正在保存…';void this.actions.onSaveTranslationEdit!(result,translatedText,selectedScope()).then(({result:updated,history})=>{this.showResult(updated,undefined,history,false)}).catch((error:unknown)=>{save.disabled=false;cancel.disabled=false;scope.disabled=false;saveStatus.textContent=error instanceof Error?error.message:'保存失败，请重试'})});
    surface.append(panel);this.showSurface(surface);queueMicrotask(()=>{editor.focus();editor.setSelectionRange(editor.value.length,editor.value.length)});
  }

  private adoptTranslationVersion(result:TranslateResult):void {
    if(!this.actions.onSaveTranslationEdit)return;
    void this.actions.onSaveTranslationEdit(result,result.translatedText,'current').then(({result:updated,history})=>{this.showResult(updated,undefined,history,false)}).catch((error:unknown)=>{this.showError({message:error instanceof Error?error.message:'无法采用此版本',showSettings:false,retryable:false})});
  }

  private recognizedSource(result:TranslateResult,label:string):HTMLElement {
    const recognizedText=normalizeLatexForClipboard(result.originalText);const recognized=document.createElement('details');recognized.className='recognized-source';const summary=document.createElement('summary');summary.textContent=label;const content=document.createElement('div');content.className='recognized-content';const source=document.createElement('div');source.className='recognized-text';source.textContent=recognizedText;const actions=document.createElement('div');actions.className='recognized-actions';const copy=this.button('复制原文','');const edit=this.button('编辑后重译','');actions.append(copy,edit);content.append(source,actions);recognized.append(summary,content);
    if(result.formulaLatex?.length){const formulaSource=result.formulaLatex.map(normalizeFormulaLatexForClipboard).join('\n\n');const formulas=document.createElement('pre');formulas.className='formula-latex';formulas.textContent=formulaSource;content.insertBefore(formulas,actions);const copyFormula=this.button('复制公式 LaTeX','');copyFormula.title='复制标准单反斜杠 LaTeX';copyFormula.addEventListener('click',async()=>{await navigator.clipboard.writeText(formulaSource);copyFormula.textContent='已复制 LaTeX'});actions.prepend(copyFormula)}
    copy.addEventListener('click',async()=>{await navigator.clipboard.writeText(recognizedText);copy.textContent='已复制'});
    edit.addEventListener('click',()=>{const editor=document.createElement('textarea');editor.className='recognized-editor';editor.value=recognizedText;editor.setAttribute('aria-label','编辑识别原文');source.replaceWith(editor);actions.replaceChildren();const commit=this.button('用修正文本重译','commit');const cancel=this.button('取消编辑','');actions.append(commit,cancel);commit.addEventListener('click',()=>{const text=editor.value.trim();if(!text){editor.focus();return}this.actions.onTranslateText(text)});cancel.addEventListener('click',()=>this.renderResult(result));queueMicrotask(()=>{editor.focus();editor.setSelectionRange(editor.value.length,editor.value.length)})});
    return recognized;
  }

  private beginPdfRegionAdjustment():void { if(this.sidebarActive)this.collapseSidebar();else{this.clear();this.setView('hidden')}this.actions.onAdjustPdfRegion?.() }

  private placeMoreMenu(details:HTMLElement,menu:HTMLElement):void { const surface=details.closest<HTMLElement>('.surface');if(!surface)return;menu.classList.remove('opens-down');menu.style.removeProperty('max-height');const anchorRect=details.getBoundingClientRect();const surfaceRect=surface.getBoundingClientRect();const headerBottom=surface.querySelector<HTMLElement>(':scope > .header')?.getBoundingClientRect().bottom??surfaceRect.top;const gap=6,margin=8;const visibleTop=Math.max(surfaceRect.top,headerBottom,margin);const visibleBottom=Math.min(surfaceRect.bottom,innerHeight-margin);const above=Math.max(0,anchorRect.top-gap-visibleTop);const below=Math.max(0,visibleBottom-anchorRect.bottom-gap);const desired=Math.min(menu.scrollHeight,280);const opensDown=below>=desired||below>=above;const available=opensDown?below:above;menu.classList.toggle('opens-down',opensDown);menu.style.maxHeight=`${Math.max(1,Math.min(desired,available))}px`; }

  private surface(titleText:string):HTMLDivElement {
    const docked=this.sidebarActive||this.markerNavigatorActive||this.documentMemoryActive;const surface=document.createElement('div');surface.className=`surface ${docked?'sidebar '+this.preferences.sidebarSide:'card'}`;surface.setAttribute('role',docked?'complementary':'dialog');surface.setAttribute('aria-label',`Pi Translator ${titleText}`);if(docked)surface.style.setProperty('--sidebar-width',`${this.sidebarWidth}px`);
    const header=document.createElement('div');header.className='header';const titleWrap=document.createElement('div');titleWrap.className='title-wrap';const title=document.createElement('div');title.className='title';title.textContent=titleText;titleWrap.append(this.logo('logo'),title);if(this.sidebarActive&&!this.markerNavigatorActive&&!this.documentMemoryActive){const live=document.createElement('span');live.className='live-badge';live.textContent='自动翻译中';titleWrap.append(live)}const tools=document.createElement('div');tools.className='header-tools';
    if(this.documentMemoryActive){const back=this.button('←','icon','返回翻译结果');back.addEventListener('click',()=>{this.documentMemoryActive=false;if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle()});tools.append(back)}else if(this.markerNavigatorActive){if(this.currentResult){const back=this.button('←','icon','返回翻译结果');back.addEventListener('click',()=>{this.markerNavigatorActive=false;this.renderResult(this.currentResult!)});tools.append(back)}}else if(this.sidebarActive){if(this.actions.onGetDocumentMemory){const reviewCount=this.pendingDocumentReviews().length;const documentButton=this.button(this.documentMemoryButtonLabel(),`document-action document-memory-action${reviewCount?' has-review':''}`,reviewCount?`有 ${reviewCount} 条图像识别结果待核对`:'查看本文术语和最近翻译');documentButton.ariaLabel=this.documentMemoryButtonLabel();documentButton.addEventListener('click',()=>this.openDocumentMemory());tools.append(documentButton)}const collapse=this.button('›','icon','收起侧栏');collapse.style.transform=this.preferences.sidebarSide==='left'?'rotate(180deg)':'';collapse.addEventListener('click',()=>this.collapseSidebar());tools.append(collapse)}else{const pin=this.button('固定侧栏','pin-action','固定到连续翻译侧栏');pin.addEventListener('click',()=>this.openSidebar());tools.append(pin)}
    const close=this.button('×','icon','关闭');close.addEventListener('click',()=>this.closeSurface());tools.append(close);header.append(titleWrap,tools);surface.append(header);
    if(docked)this.makeResizable(surface);else this.makeDraggable(surface,header);return surface;
  }

  private showSurface(surface:HTMLDivElement):void {
    this.clear();
    this.refreshViewportInsets();
    this.root.append(surface);
    this.observeSize(surface);
    if(this.sidebarActive||this.markerNavigatorActive||this.documentMemoryActive){this.setView('sidebar');this.scheduleReflow();return}
    const rect=this.lastRect??{top:innerHeight/2,bottom:innerHeight/2,left:innerWidth/2,right:innerWidth/2};
    if(this.cardPosition){
      this.cardPosition=this.applyPosition(surface,this.constrain(this.cardPosition.left,this.cardPosition.top,surface.offsetWidth,surface.offsetHeight));
    }else{
      this.cardPosition=this.place(surface,rect);
    }
    this.setView('card');
    this.scheduleReflow();
  }

  private collapseSidebar():void { this.sidebarCollapsed=true;this.clear();this.refreshViewportInsets();const tab=this.button('','collapsed-tab '+this.preferences.sidebarSide,'展开 Pi Translator 连续翻译侧栏');const label=document.createElement('span');label.textContent='连续翻译';tab.append(this.logo(''),label);tab.addEventListener('click',()=>{this.sidebarCollapsed=false;if(this.documentMemoryActive)this.renderDocumentMemory();else if(this.progressState)this.renderProgress();else if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle()});this.root.append(tab);this.observeSize(tab);this.setView('sidebar-collapsed');this.scheduleReflow(); }
  private closeSurface():void { this.markerNavigatorActive=false;this.documentMemoryActive=false;this.progressState=undefined;if(this.sidebarActive){this.sidebarActive=false;this.sidebarCollapsed=false;this.markedOnly=false;this.actions.onSidebarChange(false)}this.hide();this.actions.onDismiss(); }
  private navigationHistory():TranslationHistoryEntry[]{return this.markedOnly?this.history.filter(entry=>this.actions.hasSourceMarksForResult?.(entry)):this.history}
  private navigate(delta:number):void { const history=this.navigationHistory();const current=history.findIndex(entry=>entry.requestId===this.currentResult?.requestId);const next=current+delta;if(next<0||next>=history.length)return;this.historyIndex=next;this.alignedView=false;this.renderResult(history[next] as TranslationHistoryEntry); }
  private toggleMarkedFilter():void { const marked=this.history.filter(entry=>this.actions.hasSourceMarksForResult?.(entry));if(!marked.length){this.markedOnly=false;return}this.markedOnly=!this.markedOnly;if(this.markedOnly&&(!this.currentResult||!this.actions.hasSourceMarksForResult?.(this.currentResult))){this.alignedView=false;this.renderResult(marked[0] as TranslationHistoryEntry);return}if(this.currentResult)this.renderResult(this.currentResult) }
  private renderAfterMarkToggle(result:TranslateResult):void { if(this.markedOnly&&!this.actions.hasSourceMarksForResult?.(result)){const next=this.history.find(entry=>this.actions.hasSourceMarksForResult?.(entry));if(next){this.alignedView=false;this.renderResult(next);return}this.markedOnly=false}this.renderResult(result) }
  private toggleSourceMark(result:TranslateResult):void { this.actions.onToggleSourceMark?.(result);this.renderAfterMarkToggle(result) }
  private toggleSegmentSourceMark(result:TranslateResult,segment:TranslationSegment):void { this.actions.onToggleSourceMark?.(result,segment);this.renderAfterMarkToggle(result) }
  private menuButton(text:string,action:()=>void):HTMLButtonElement{const button=this.button(text,'');button.addEventListener('click',action);return button}

  private markerIcon():SVGSVGElement { const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M6.1 13.2 12.9 6.4l2.7 2.7-6.8 6.8H6.1v-2.7Zm5.8-7.8 1.3-1.3a1.2 1.2 0 0 1 1.7 0L17.9 7a1.2 1.2 0 0 1 0 1.7L16.6 10l-4.7-4.6ZM3 17h14');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.6');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg }

  private makeDraggable(surface:HTMLDivElement,handle:HTMLDivElement):void { let id:number|undefined,dx=0,dy=0;const stop=()=>{if(id===undefined)return;id=undefined;surface.classList.remove('dragging');const rect=surface.getBoundingClientRect();this.cardPosition={left:rect.left,top:rect.top}};handle.addEventListener('pointerdown',event=>{const target=event.target;if(event.button!==0||!(target instanceof Element)||target.closest('button,details'))return;const rect=surface.getBoundingClientRect();id=event.pointerId;dx=event.clientX-rect.left;dy=event.clientY-rect.top;surface.classList.add('dragging');handle.setPointerCapture(event.pointerId);event.preventDefault()});handle.addEventListener('pointermove',event=>{if(id!==event.pointerId)return;const next=this.constrain(event.clientX-dx,event.clientY-dy,surface.offsetWidth,surface.offsetHeight);surface.style.left=`${next.left}px`;surface.style.top=`${next.top}px`;this.cardPosition=next});handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop); }
  private makeResizable(surface:HTMLDivElement):void {
    const handle=document.createElement('div');handle.className='sidebar-resizer';surface.append(handle);let id:number|undefined;
    handle.addEventListener('pointerdown',event=>{id=event.pointerId;handle.setPointerCapture(id);event.preventDefault()});
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
    this.surfaceResizeObserver=new ResizeObserver(()=>this.scheduleReflow());
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
      const trigger=this.root.querySelector<HTMLElement>('.trigger');
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
  private clear():void{this.surfaceResizeObserver?.disconnect();this.surfaceResizeObserver=undefined;if(this.reflowFrame!==undefined)cancelAnimationFrame(this.reflowFrame);this.reflowFrame=undefined;for(const child of [...this.root.children])if(!(child instanceof HTMLStyleElement))child.remove()}
  private publishSidebarLayout():void{this.actions.onSidebarLayoutChange(this.view==='sidebar',this.preferences.sidebarSide,this.sidebarWidth)}
  private setView(view:OverlayView):void{this.view=view;this.host.dataset.piView=view;this.publishSidebarLayout()}
  private readonly onKeyDown=(event:KeyboardEvent):void=>{if(this.view==='hidden')return;if(event.key==='Escape'){if(this.sidebarActive)this.collapseSidebar();else this.closeSurface();return}if(event.altKey&&event.key==='ArrowUp'){event.preventDefault();this.navigate(1)}if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();this.navigate(-1)}};
  private readonly onDocumentPointerDown=(event:PointerEvent):void=>{const openMenu=this.root.querySelector<HTMLDetailsElement>('details.more[open]');if(!openMenu||event.composedPath().includes(openMenu))return;openMenu.open=false};
  private readonly onViewportChange=():void=>this.scheduleReflow();
  private readonly onColorSchemeChange=():void=>this.scheduleTheme();
  private trackTheme():void{this.refreshTheme();this.themeObserver=new MutationObserver(()=>this.scheduleTheme());const options:MutationObserverInit={attributes:true,attributeFilter:['class','style','data-theme','data-color-mode','data-bs-theme']};this.themeObserver.observe(document.documentElement,options);if(document.body)this.themeObserver.observe(document.body,options);this.colorSchemeQuery=globalThis.matchMedia?.('(prefers-color-scheme:dark)');this.colorSchemeQuery?.addEventListener('change',this.onColorSchemeChange)}
  private scheduleTheme():void{if(this.themeTimer)clearTimeout(this.themeTimer);this.themeTimer=setTimeout(()=>this.refreshTheme(),40)}private refreshTheme():void{this.host.dataset.piTheme=detectPageTheme()}
}
