import type { ViewportRect } from '../core/selection/types';
import type {
  TranslateResult,
  TranslationFavorite,
  TranslationHistoryEntry,
  TranslationStyle,
} from '../core/translation/types';
import type { SidebarSide } from '../core/settings/schema';
import { detectPageTheme } from '../core/theme/page-theme';

const STYLES = `
  :host {
    all: initial; color-scheme: light; font-family: Inter,"Segoe UI",system-ui,sans-serif;
    --accent:#5959df; --accent2:#06a6c7; --text:#192238; --muted:#6e7b91;
    --line:#dfe5ef; --soft:#f4f7fb; --surface:rgba(255,255,255,.985);
  }
  :host([data-pi-theme="dark"]) { color-scheme:dark; --text:#edf2f8; --muted:#a9b5c7; --line:#3a465a; --soft:#202938; --surface:rgba(17,24,39,.985); }
  * { box-sizing:border-box; } button,select { font:inherit; } button { cursor:pointer; }
  .trigger { position:fixed;z-index:2147483647;display:grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid rgba(91,92,226,.23);border-radius:13px;background:var(--surface);box-shadow:0 9px 28px rgba(30,41,59,.21);transition:.16s transform,.16s box-shadow; }
  .trigger:hover { transform:translateY(-2px) scale(1.04);box-shadow:0 13px 33px rgba(30,41,59,.25); }
  .trigger-logo { width:24px;height:21px;object-fit:contain; }.sparkle { position:absolute;right:-4px;top:-5px;color:#f3b526;font-size:11px; }
  .surface { position:fixed;z-index:2147483647;container-type:inline-size;color:var(--text);background:var(--surface);border:1px solid rgba(99,102,241,.18);box-shadow:0 25px 70px rgba(15,23,42,.25);backdrop-filter:blur(20px);overflow:auto;scrollbar-width:thin; }
  .surface::before { content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,#4f46e5,#8b5cf6,#06b6d4); }
  .card { width:min(500px,calc(100vw - 24px));max-height:min(540px,calc(100vh - 24px));padding:16px;border-radius:20px; }
  .sidebar { top:10px;bottom:10px;width:min(var(--sidebar-width,390px),calc(100vw - 20px));padding:15px;border-radius:18px;max-height:none; }
  .sidebar.right { right:10px; }.sidebar.left { left:10px; }
  .sidebar-resizer { position:absolute;z-index:3;top:0;bottom:0;width:8px;cursor:ew-resize; }.sidebar.right .sidebar-resizer{left:-4px}.sidebar.left .sidebar-resizer{right:-4px}
  .collapsed-tab { position:fixed;z-index:2147483647;top:38%;display:grid;gap:6px;place-items:center;width:42px;padding:13px 7px;border:1px solid rgba(99,102,241,.24);color:#fff;background:linear-gradient(160deg,#4f46e5,#6f55df);box-shadow:0 14px 34px rgba(31,38,100,.3); }
  .collapsed-tab.right { right:0;border-radius:13px 0 0 13px; }.collapsed-tab.left { left:0;border-radius:0 13px 13px 0; }
  .collapsed-tab img { width:22px;height:19px;filter:brightness(0) invert(1); }.collapsed-tab span { writing-mode:vertical-rl;font-size:11px;font-weight:750;letter-spacing:.08em; }
  .header { display:flex;align-items:center;gap:8px;min-height:30px;user-select:none; }.card .header{cursor:grab;touch-action:none}.card.dragging .header{cursor:grabbing}
  .title-wrap { display:flex;align-items:center;gap:8px;min-width:0;margin-right:auto; }.logo{width:21px;height:18px;object-fit:contain}.title{color:#40506e;font-size:13px;font-weight:780}.header-tools{display:flex;align-items:center;gap:2px}
  .live-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;color:#08718b;background:#e7f9fd;font-size:9px;font-weight:750}.live-badge::before{content:"";width:5px;height:5px;border-radius:50%;background:#0ba7c5;box-shadow:0 0 0 3px rgba(11,167,197,.13)}
  .icon { display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;color:#5e6a7f;background:transparent;font-size:17px; }.icon:hover{background:var(--soft)}.icon:disabled{opacity:.28;cursor:default}.counter{min-width:35px;color:var(--muted);font-size:10px;text-align:center;font-variant-numeric:tabular-nums}
  .meta { display:flex;align-items:center;gap:7px;margin-top:9px;color:var(--muted);font-size:10px; }.meta-dot::before{content:"·";margin-right:7px}.cache-badge{padding:2px 6px;border-radius:999px;color:#08718b;background:#e7f9fd;font-weight:700}
  .view-switch { display:flex;gap:3px;margin-top:11px;padding:3px;border-radius:11px;background:var(--soft); }.view-button{flex:1;padding:7px 10px;border:0;border-radius:8px;color:var(--muted);background:transparent;font-size:12px;font-weight:680}.view-button.active{color:#4338ca;background:#fff;box-shadow:0 2px 8px rgba(30,41,59,.1)}.view-button:disabled{opacity:.42;cursor:not-allowed}
  .body { margin-top:13px;font-size:14px;line-height:1.78;white-space:pre-wrap;overflow-wrap:anywhere; }.progress{margin-top:10px}.loading{display:flex;align-items:center;gap:10px;padding:10px 0;color:var(--muted);font-size:12px}.spinner{flex:0 0 auto;width:17px;height:17px;border:2px solid #cdd5e5;border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}.stream-preview{max-height:300px;margin-top:5px;padding:11px;border-radius:12px;background:var(--soft);font-size:13px;line-height:1.72;white-space:pre-wrap;overflow:auto}.stream-preview[hidden]{display:none}@keyframes spin{to{transform:rotate(360deg)}}
  .idle { display:grid;place-items:center;min-height:240px;padding:30px;text-align:center;color:var(--muted); }.idle img{width:42px;height:37px;opacity:.3}.idle strong{margin-top:16px;color:var(--text);font-size:15px}.idle p{max-width:260px;margin:7px 0 0;font-size:12px;line-height:1.65}
  .aligned-list{display:grid;gap:9px;margin-top:12px}.segment{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;padding:10px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(145deg,rgba(248,250,252,.9),rgba(244,247,252,.64));transition:.15s border-color,.15s box-shadow}.segment:hover,.segment:focus-within{border-color:#aeb9f3;box-shadow:0 5px 18px rgba(73,78,160,.1)}
  .segment-number{display:grid;place-items:center;align-self:start;width:23px;height:23px;border-radius:8px;color:#fff;background:linear-gradient(135deg,var(--accent),#7c5ce5);font-size:10px;font-weight:800}.segment-pair{display:grid;gap:6px;min-width:0}.segment-source{color:var(--muted);font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.segment-target{padding-top:6px;border-top:1px dashed var(--line);font-size:14px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
  .segment-actions{display:flex;gap:5px;margin-top:7px;opacity:0;transition:.15s opacity}.segment:hover .segment-actions,.segment:focus-within .segment-actions{opacity:1}.mini{padding:3px 7px;border:0;border-radius:6px;color:var(--muted);background:var(--soft);font-size:10px}.mini:hover{color:var(--accent)}
  @container (min-width:520px){.segment-pair{grid-template-columns:1fr 1fr;gap:12px}.segment-target{padding:0 0 0 12px;border-top:0;border-left:1px dashed var(--line)}}
  .warning,.error{margin-top:10px;padding:9px 11px;border-radius:9px;font-size:12px;white-space:pre-wrap}.warning{color:#725417;background:#fff6dd}.error{color:#a52b36;background:#fff1f2}
  .notice{display:grid;gap:7px;margin-top:14px;padding:12px;border:1px solid #f0d898;border-radius:12px;color:#725417;background:#fffaf0;font-size:12px;line-height:1.6}.notice strong{color:var(--text);font-size:13px}
  .library{display:grid;gap:9px;margin-top:12px}.library-search{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:10px;color:var(--text);background:var(--soft);font:inherit}.favorite{display:grid;gap:5px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--soft)}.favorite button.open{padding:0;border:0;color:var(--text);background:transparent;text-align:left}.favorite-source,.favorite-target{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:11px;line-height:1.55}.favorite-source{color:var(--muted)}.favorite-actions{display:flex;justify-content:flex-end}.empty-library{padding:34px 10px;color:var(--muted);font-size:12px;text-align:center}
  .footer{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.action{padding:7px 11px;border:1px solid #d6dceb;border-radius:9px;color:#26334a;background:#f8f9fc;font-size:12px;font-weight:650}.action:hover{background:#eef2fa}.primary{color:#fff;border-color:var(--accent);background:linear-gradient(135deg,#4f46e5,#6d5ce8)}
  details.more{position:relative;margin-left:auto}details.more>summary{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:var(--muted);cursor:pointer;list-style:none;font-weight:800}details.more>summary:hover{background:var(--soft)}details.more>summary::-webkit-details-marker{display:none}.menu{position:absolute;z-index:5;right:0;bottom:36px;width:230px;padding:9px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:0 16px 40px rgba(15,23,42,.2)}.sidebar.left .menu{left:0;right:auto}.menu button{width:100%;padding:7px 9px;border:0;border-radius:7px;color:var(--text);background:transparent;text-align:left;font-size:11px}.menu button:hover{background:var(--soft)}.menu hr{border:0;border-top:1px solid var(--line);margin:6px 0}.menu label{display:grid;gap:4px;margin:6px;color:var(--muted);font-size:10px}.menu select{width:100%;padding:6px;border:1px solid var(--line);border-radius:7px;color:var(--text);background:var(--soft);font-size:11px}
  :host([data-pi-theme="dark"]) .logo,:host([data-pi-theme="dark"]) .trigger-logo{filter:brightness(0) invert(1)}:host([data-pi-theme="dark"]) .title{color:#d6deea}:host([data-pi-theme="dark"]) .view-button.active{color:#e4e5ff;background:#30394c}:host([data-pi-theme="dark"]) .segment{background:linear-gradient(145deg,rgba(31,41,55,.9),rgba(24,33,47,.72))}:host([data-pi-theme="dark"]) .action{color:#e8edf6;background:#202938;border-color:#465269}:host([data-pi-theme="dark"]) .primary{background:#5b6ee1}:host([data-pi-theme="dark"]) .warning{color:#f1d68e;background:#463b20}:host([data-pi-theme="dark"]) .error{color:#ff9aa4;background:#32171d}:host([data-pi-theme="dark"]) .cache-badge{color:#8de7f7;background:#173b44}
  :host([data-pi-theme="dark"]) .live-badge{color:#8de7f7;background:#173b44}:host([data-pi-theme="dark"]) .notice{color:#f1d68e;background:#3c321c;border-color:#655326}
  button:focus-visible,select:focus-visible,input:focus-visible,.segment:focus-visible{outline:2px solid #6366f1;outline-offset:2px}
  @media(max-width:620px){.sidebar{inset:8px!important;width:calc(100vw - 16px)!important}.sidebar-resizer{display:none}.segment-actions{opacity:1}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

export interface OverlayPreferences {
  targetLanguage: string;
  style: TranslationStyle;
  sidebarSide: SidebarSide;
  sidebarWidth: number;
}

interface ErrorDisplay { message: string; showSettings: boolean; }
interface OverlayActions {
  onTranslate: () => void;
  onRetry: () => void;
  onTranslateText: (text: string) => void;
  onOpenSettings: () => void;
  onClearHistory: () => Promise<void>;
  onDeleteHistory: (historyId: string) => Promise<TranslationHistoryEntry[]>;
  onPinHistory: (historyId: string, pinned: boolean) => Promise<TranslationHistoryEntry[]>;
  onSaveFavorite: (result: TranslateResult) => Promise<TranslationFavorite[]>;
  onGetFavorites: (query?: string) => Promise<TranslationFavorite[]>;
  onDeleteFavorite: (favoriteId: string) => Promise<TranslationFavorite[]>;
  onPauseSite: () => Promise<void>;
  onSidebarChange: (active: boolean) => void;
  onSidebarWidthChange: (width: number) => void;
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
  private sidebarWidth = 390;
  private preferences: OverlayPreferences = { targetLanguage:'zh-CN', style:'academic', sidebarSide:'right', sidebarWidth:390 };
  private lastRect?: ViewportRect;
  private cardPosition: Position | undefined;
  private currentResult?: TranslateResult;
  private latestRequestId?: string;
  private history: TranslationHistoryEntry[] = [];
  private historyIndex = -1;
  private alignedView = false;
  private themeObserver?: MutationObserver;
  private colorSchemeQuery?: MediaQueryList;
  private themeTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly actions: OverlayActions) {
    this.host.id = 'tex-selection-translator-root';
    this.root = this.host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=STYLES;this.root.append(style);
    document.documentElement.append(this.host);this.setView('hidden');this.trackTheme();
    document.addEventListener('keydown',this.onKeyDown,true);
  }

  setPreferences(preferences: OverlayPreferences): void { this.preferences={...preferences};this.sidebarWidth=preferences.sidebarWidth; }
  isSidebarActive(): boolean { return this.sidebarActive; }
  isShowingCard(): boolean { return this.view==='card'||this.view==='sidebar'; }
  ownsCurrentSelection(): boolean {
    const anchor = document.getSelection()?.anchorNode;
    return Boolean(anchor && anchor.getRootNode() === this.root);
  }

  openSidebar(): void {
    this.sidebarActive=true;this.sidebarCollapsed=false;this.actions.onSidebarChange(true);
    if (this.currentResult) this.renderResult(this.currentResult); else this.renderSidebarIdle();
  }

  showTrigger(rect:ViewportRect):void {
    if(this.sidebarActive)return;this.lastRect=rect;this.cardPosition=undefined;this.clear();
    const button=this.button('', 'trigger','翻译选中的文本');const sparkle=document.createElement('span');sparkle.className='sparkle';sparkle.textContent='✦';
    button.append(this.logo('trigger-logo'),sparkle);button.addEventListener('pointerdown',e=>e.preventDefault());button.addEventListener('click',this.actions.onTranslate);
    this.place(button,rect,38,38);this.root.append(button);this.setView('trigger');
  }

  showLoading(rect?:ViewportRect):void {
    if(rect)this.lastRect=rect;if(this.sidebarActive)this.sidebarCollapsed=false;
    const surface=this.surface('正在翻译');const progress=document.createElement('div');progress.className='progress';const body=document.createElement('div');body.className='loading';body.setAttribute('role','status');body.setAttribute('aria-live','polite');const spinner=document.createElement('span');spinner.className='spinner';spinner.ariaHidden='true';
    const text=document.createElement('span');text.className='loading-status';text.textContent='正在连接翻译 API…';const preview=document.createElement('div');preview.className='stream-preview';preview.hidden=true;body.append(spinner,text);progress.append(body,preview);surface.append(progress);this.showSurface(surface);
  }

  showProgress(partialText:string|undefined,completedChunks:number,totalChunks:number):void { const status=this.root.querySelector<HTMLElement>('.loading-status');if(status)status.textContent=totalChunks>1?`正在翻译长文本 ${Math.min(completedChunks+1,totalChunks)}/${totalChunks}…`:'正在接收译文…';const preview=this.root.querySelector<HTMLElement>('.stream-preview');if(preview&&partialText){preview.hidden=false;preview.textContent=partialText;preview.scrollTop=preview.scrollHeight} }

  showSensitiveNotice(rect?:ViewportRect):void { if(rect)this.lastRect=rect;const surface=this.surface('连续翻译');const notice=document.createElement('div');notice.className='notice';const title=document.createElement('strong');title.textContent='已跳过敏感输入区域';const text=document.createElement('span');text.textContent='检测到密码、验证码或支付字段，内容没有发送到翻译 API。手动右键翻译仍由你决定。';notice.append(title,text);surface.append(notice);this.showSurface(surface); }

  showResult(result:TranslateResult,rect?:ViewportRect,history:TranslationHistoryEntry[]=[],alignedByDefault=false):void {
    if(rect)this.lastRect=rect;this.currentResult=result;this.latestRequestId=result.requestId;this.history=history;
    this.historyIndex=history.findIndex(entry=>entry.requestId===result.requestId);this.alignedView=alignedByDefault&&Boolean(result.alignedSegments?.length);
    if(this.sidebarActive)this.sidebarCollapsed=false;this.renderResult(result);
  }

  showError(error:ErrorDisplay,rect?:ViewportRect):void {
    if(rect)this.lastRect=rect;if(this.sidebarActive)this.sidebarCollapsed=false;const surface=this.surface('翻译失败');
    const body=document.createElement('div');body.className='error';body.textContent=error.message;surface.append(body);const footer=document.createElement('div');footer.className='footer';
    const retry=this.button('重试','action primary');retry.addEventListener('click',this.actions.onRetry);footer.append(retry);
    if(error.showSettings){const settings=this.button('打开设置','action');settings.addEventListener('click',this.actions.onOpenSettings);footer.append(settings)}surface.append(footer);this.showSurface(surface);
  }

  hide():void { this.clear();this.setView('hidden'); }
  hideTrigger():void { if(this.view==='trigger')this.hide(); }
  resetCardPosition():void { this.cardPosition=undefined; }
  keepCardInViewport():void { const card=this.root.querySelector<HTMLElement>('.card');if(!card||!this.cardPosition)return;const next=this.constrain(this.cardPosition.left,this.cardPosition.top,card.offsetWidth,card.offsetHeight);this.cardPosition=next;card.style.left=`${next.left}px`;card.style.top=`${next.top}px`; }

  destroy():void { if(this.themeTimer)clearTimeout(this.themeTimer);this.themeObserver?.disconnect();this.colorSchemeQuery?.removeEventListener('change',this.onColorSchemeChange);document.removeEventListener('keydown',this.onKeyDown,true);this.host.remove(); }

  private renderSidebarIdle():void {
    const surface=this.surface('连续翻译');const idle=document.createElement('div');idle.className='idle';const logo=this.logo('logo');
    const title=document.createElement('strong');title.textContent='侧栏已固定';const text=document.createElement('p');text.textContent='现在直接选中网页或 Overleaf 中的句子，译文会自动出现在这里。';idle.append(logo,title,text);surface.append(idle);this.showSurface(surface);
  }

  private renderResult(result:TranslateResult):void {
    this.currentResult=result;const surface=this.surface('翻译结果');const tools=surface.querySelector<HTMLElement>('.header-tools');
    if(tools&&this.history.length>1&&this.historyIndex>=0){const older=this.button('‹','icon','上一条翻译（Alt+↑）');older.disabled=this.historyIndex>=this.history.length-1;older.addEventListener('click',()=>this.navigate(1));const counter=document.createElement('span');counter.className='counter';counter.textContent=`${this.historyIndex+1}/${this.history.length}`;const newer=this.button('›','icon','下一条翻译（Alt+↓）');newer.disabled=this.historyIndex<=0;newer.addEventListener('click',()=>this.navigate(-1));tools.prepend(older,counter,newer)}
    const meta=document.createElement('div');meta.className='meta';if(result.sourceHost){const host=document.createElement('span');host.textContent=result.sourceHost;meta.append(host)}if(result.completedAt){const time=document.createElement('span');time.className='meta-dot';time.textContent=new Date(result.completedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});meta.append(time)}if(result.latencyMs){const latency=document.createElement('span');latency.className='meta-dot';latency.textContent=`${result.latencyMs} ms`;meta.append(latency)}if(result.cached){const cache=document.createElement('span');cache.className='cache-badge';cache.textContent='会话缓存';meta.append(cache)}if(result.contextUsed){const context=document.createElement('span');context.className='cache-badge';context.textContent='含上下文';meta.append(context)}if((result.chunkCount??1)>1){const chunks=document.createElement('span');chunks.className='meta-dot';chunks.textContent=`${result.chunkCount} 段`;meta.append(chunks)}if(meta.childElementCount)surface.append(meta);
    const switcher=document.createElement('div');switcher.className='view-switch';const full=this.button('完整译文',`view-button${this.alignedView?'':' active'}`);const aligned=this.button('逐句对照',`view-button${this.alignedView?' active':''}`);aligned.disabled=!result.alignedSegments?.length;full.addEventListener('click',()=>{this.alignedView=false;this.renderResult(result)});aligned.addEventListener('click',()=>{this.alignedView=true;this.renderResult(result)});switcher.append(full,aligned);surface.append(switcher);
    if(this.alignedView&&result.alignedSegments?.length){const list=document.createElement('div');list.className='aligned-list';for(const segment of result.alignedSegments){const row=document.createElement('section');row.className='segment';row.tabIndex=0;const num=document.createElement('span');num.className='segment-number';num.textContent=segment.id.replace(/^S/,'');const content=document.createElement('div');const pair=document.createElement('div');pair.className='segment-pair';const source=document.createElement('div');source.className='segment-source';source.textContent=segment.originalText;const target=document.createElement('div');target.className='segment-target';target.textContent=segment.translatedText;pair.append(source,target);const actions=document.createElement('div');actions.className='segment-actions';const copy=this.button('复制本句','mini');copy.addEventListener('click',()=>void navigator.clipboard.writeText(segment.translatedText));const retry=this.button('仅翻译此句','mini');retry.addEventListener('click',()=>this.actions.onTranslateText(segment.originalText));actions.append(copy,retry);content.append(pair,actions);row.append(num,content);list.append(row)}surface.append(list)}else{const body=document.createElement('div');body.className='body';body.textContent=result.translatedText;surface.append(body)}
    if(result.warnings.length){const warning=document.createElement('div');warning.className='warning';warning.textContent='部分 LaTeX 使用了保守保护策略，请复制后检查。';surface.append(warning)}
    const footer=document.createElement('div');footer.className='footer';const copy=this.button('复制译文','action primary');copy.addEventListener('click',async()=>{await navigator.clipboard.writeText(result.translatedText);copy.textContent='已复制'});footer.append(copy);footer.append(this.moreMenu(result));surface.append(footer);this.showSurface(surface);
  }

  private moreMenu(result:TranslateResult):HTMLElement {
    const details=document.createElement('details');details.className='more';const summary=document.createElement('summary');summary.textContent='•••';summary.title='更多操作';summary.ariaLabel='更多翻译操作';const menu=document.createElement('div');menu.className='menu';
    const copyBoth=this.menuButton('复制原文与译文',()=>void navigator.clipboard.writeText(`原文：\n${result.originalText}\n\n译文：\n${result.translatedText}`));menu.append(copyBoth);
    menu.append(this.menuButton('收藏当前译文',()=>void this.actions.onSaveFavorite(result)));
    menu.append(this.menuButton('浏览收藏与搜索',()=>void this.openFavorites()));
    if(result.requestId===this.latestRequestId)menu.append(this.menuButton('重新翻译（忽略缓存）',this.actions.onRetry));
    const entry=this.historyIndex>=0?this.history[this.historyIndex]:undefined;
    if(entry){menu.append(this.menuButton(entry.pinned?'取消固定这条记录':'固定这条记录',()=>void this.pinEntry(entry)));menu.append(this.menuButton('删除这条记录',()=>void this.deleteEntry(entry.historyId)))}
    if(this.history.length){menu.append(this.menuButton('导出当前会话为 Markdown',()=>this.exportHistory()));menu.append(this.menuButton('清空当前标签页记录',()=>void this.clearHistory()))}
    const divider=document.createElement('hr');menu.append(divider);
    const languageLabel=document.createElement('label');languageLabel.textContent='临时目标语言';const language=document.createElement('select');for(const [value,label] of LANGUAGES){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===this.preferences.targetLanguage;language.append(option)}languageLabel.append(language);menu.append(languageLabel);
    const styleLabel=document.createElement('label');styleLabel.textContent='临时翻译风格';const style=document.createElement('select');for(const [value,label] of [['academic','学术'],['general','通用'],['literal','直译']] as const){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===this.preferences.style;style.append(option)}styleLabel.append(style);menu.append(styleLabel);
    menu.append(this.menuButton('应用到当前选区并重译',()=>{this.preferences={...this.preferences,targetLanguage:language.value,style:style.value as TranslationStyle};this.actions.onPreferencesChange({targetLanguage:language.value,style:style.value as TranslationStyle});this.actions.onRetry()}));if(this.sidebarActive)menu.append(this.menuButton('暂停当前网站',()=>void this.actions.onPauseSite().then(()=>this.closeSurface())));menu.append(this.menuButton('打开完整设置',this.actions.onOpenSettings));details.append(summary,menu);return details;
  }

  private async openFavorites(query=''):Promise<void>{const favorites=await this.actions.onGetFavorites(query);const surface=this.surface('收藏与搜索');const library=document.createElement('div');library.className='library';const search=document.createElement('input');search.className='library-search';search.type='search';search.placeholder='搜索原文、译文或网站';search.value=query;search.ariaLabel='搜索收藏的翻译';const list=document.createElement('div');let timer:ReturnType<typeof setTimeout>|undefined;search.addEventListener('input',()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void this.openFavorites(search.value),180)});library.append(search,list);this.renderFavorites(list,favorites);surface.append(library);const footer=document.createElement('div');footer.className='footer';const back=this.button('返回翻译','action');back.addEventListener('click',()=>{if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle()});footer.append(back);surface.append(footer);this.showSurface(surface);queueMicrotask(()=>search.focus())}

  private renderFavorites(container:HTMLElement,favorites:TranslationFavorite[]):void{container.replaceChildren();if(!favorites.length){const empty=document.createElement('div');empty.className='empty-library';empty.textContent='还没有匹配的收藏。翻译后可在“更多”菜单中收藏。';container.append(empty);return}for(const favorite of favorites){const item=document.createElement('article');item.className='favorite';const open=this.button('','open');const source=document.createElement('div');source.className='favorite-source';source.textContent=favorite.originalText;const target=document.createElement('div');target.className='favorite-target';target.textContent=favorite.translatedText;open.append(source,target);open.addEventListener('click',()=>{this.historyIndex=-1;this.alignedView=false;this.renderResult(favorite)});const actions=document.createElement('div');actions.className='favorite-actions';const remove=this.button('删除','mini');remove.addEventListener('click',()=>void this.actions.onDeleteFavorite(favorite.favoriteId).then((next)=>this.renderFavorites(container,next)));actions.append(remove);item.append(open,actions);container.append(item)}}

  private surface(titleText:string):HTMLDivElement {
    const surface=document.createElement('div');surface.className=`surface ${this.sidebarActive?'sidebar '+this.preferences.sidebarSide:'card'}`;surface.setAttribute('role',this.sidebarActive?'complementary':'dialog');surface.setAttribute('aria-label',`Pi Translator ${titleText}`);if(this.sidebarActive)surface.style.setProperty('--sidebar-width',`${this.sidebarWidth}px`);
    const header=document.createElement('div');header.className='header';const titleWrap=document.createElement('div');titleWrap.className='title-wrap';const title=document.createElement('div');title.className='title';title.textContent=titleText;titleWrap.append(this.logo('logo'),title);if(this.sidebarActive){const live=document.createElement('span');live.className='live-badge';live.textContent='自动翻译中';titleWrap.append(live)}const tools=document.createElement('div');tools.className='header-tools';
    if(this.sidebarActive){const collapse=this.button('›','icon','收起侧栏');collapse.style.transform=this.preferences.sidebarSide==='left'?'rotate(180deg)':'';collapse.addEventListener('click',()=>this.collapseSidebar());tools.append(collapse)}else{const pin=this.button('▣','icon','固定到连续翻译侧栏');pin.addEventListener('click',()=>this.openSidebar());tools.append(pin)}
    const close=this.button('×','icon','关闭');close.addEventListener('click',()=>this.closeSurface());tools.append(close);header.append(titleWrap,tools);surface.append(header);
    if(this.sidebarActive)this.makeResizable(surface);else this.makeDraggable(surface,header);return surface;
  }

  private showSurface(surface:HTMLDivElement):void {
    this.clear();this.root.append(surface);if(this.sidebarActive){this.setView('sidebar');return}const rect=this.lastRect??{top:innerHeight/2,bottom:innerHeight/2,left:innerWidth/2,right:innerWidth/2};if(this.cardPosition){const next=this.constrain(this.cardPosition.left,this.cardPosition.top,surface.offsetWidth,surface.offsetHeight);this.cardPosition=next;surface.style.left=`${next.left}px`;surface.style.top=`${next.top}px`}else this.place(surface,rect,Math.min(500,innerWidth-24),250);this.setView('card');
  }

  private collapseSidebar():void { this.sidebarCollapsed=true;this.clear();const tab=this.button('','collapsed-tab '+this.preferences.sidebarSide,'展开 Pi Translator 连续翻译侧栏');const label=document.createElement('span');label.textContent='连续翻译';tab.append(this.logo(''),label);tab.addEventListener('click',()=>{this.sidebarCollapsed=false;if(this.currentResult)this.renderResult(this.currentResult);else this.renderSidebarIdle()});this.root.append(tab);this.setView('sidebar-collapsed'); }
  private closeSurface():void { if(this.sidebarActive){this.sidebarActive=false;this.sidebarCollapsed=false;this.actions.onSidebarChange(false)}this.hide();this.actions.onDismiss(); }
  private navigate(delta:number):void { const next=this.historyIndex+delta;if(next<0||next>=this.history.length)return;this.historyIndex=next;this.alignedView=false;this.renderResult(this.history[next] as TranslationHistoryEntry); }
  private async clearHistory():Promise<void>{try{await this.actions.onClearHistory()}finally{this.history=[];this.historyIndex=-1;if(this.currentResult)this.renderResult(this.currentResult)}}
  private async deleteEntry(historyId:string):Promise<void>{this.history=await this.actions.onDeleteHistory(historyId);if(!this.history.length){this.historyIndex=-1;if(this.currentResult)this.renderResult(this.currentResult);return}this.historyIndex=Math.min(Math.max(this.historyIndex,0),this.history.length-1);this.renderResult(this.history[this.historyIndex] as TranslationHistoryEntry)}
  private async pinEntry(entry:TranslationHistoryEntry):Promise<void>{this.history=await this.actions.onPinHistory(entry.historyId,!entry.pinned);this.historyIndex=this.history.findIndex(item=>item.historyId===entry.historyId);this.renderResult((this.history[this.historyIndex]??entry) as TranslationHistoryEntry)}
  private exportHistory():void { const markdown=this.history.map((entry,index)=>`## ${index+1}. ${entry.sourceHost??'网页'} · ${new Date(entry.createdAt).toLocaleString()}\n\n**原文**\n\n${entry.originalText}\n\n**译文**\n\n${entry.translatedText}`).join('\n\n---\n\n');const url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`pi-translator-${new Date().toISOString().slice(0,10)}.md`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  private menuButton(text:string,action:()=>void):HTMLButtonElement{const button=this.button(text,'');button.addEventListener('click',action);return button}

  private makeDraggable(surface:HTMLDivElement,handle:HTMLDivElement):void { let id:number|undefined,dx=0,dy=0;const stop=()=>{if(id===undefined)return;id=undefined;surface.classList.remove('dragging');const rect=surface.getBoundingClientRect();this.cardPosition={left:rect.left,top:rect.top}};handle.addEventListener('pointerdown',event=>{const target=event.target;if(event.button!==0||!(target instanceof Element)||target.closest('button,details'))return;const rect=surface.getBoundingClientRect();id=event.pointerId;dx=event.clientX-rect.left;dy=event.clientY-rect.top;surface.classList.add('dragging');handle.setPointerCapture(event.pointerId);event.preventDefault()});handle.addEventListener('pointermove',event=>{if(id!==event.pointerId)return;const next=this.constrain(event.clientX-dx,event.clientY-dy,surface.offsetWidth,surface.offsetHeight);surface.style.left=`${next.left}px`;surface.style.top=`${next.top}px`;this.cardPosition=next});handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop); }
  private makeResizable(surface:HTMLDivElement):void { const handle=document.createElement('div');handle.className='sidebar-resizer';surface.append(handle);let id:number|undefined;handle.addEventListener('pointerdown',event=>{id=event.pointerId;handle.setPointerCapture(id);event.preventDefault()});handle.addEventListener('pointermove',event=>{if(id!==event.pointerId)return;const raw=this.preferences.sidebarSide==='right'?innerWidth-event.clientX:event.clientX;this.sidebarWidth=Math.min(640,Math.max(320,raw));surface.style.setProperty('--sidebar-width',`${this.sidebarWidth}px`)});const stop=()=>{if(id!==undefined)this.actions.onSidebarWidthChange(this.sidebarWidth);id=undefined};handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop); }
  private constrain(left:number,top:number,width:number,height:number):Position{const margin=12;return{left:Math.min(Math.max(margin,left),Math.max(margin,innerWidth-width-margin)),top:Math.min(Math.max(margin,top),Math.max(margin,innerHeight-height-margin))}}
  private place(element:HTMLElement,rect:ViewportRect,width:number,height:number):void{const margin=12,gap=8;const left=Math.min(Math.max(margin,rect.right-width),innerWidth-width-margin);const below=rect.bottom+gap;const top=below+height<=innerHeight-margin?below:Math.max(margin,rect.top-height-gap);element.style.left=`${left}px`;element.style.top=`${top}px`}
  private button(text:string,className:string,title?:string):HTMLButtonElement{const button=document.createElement('button');button.type='button';button.className=className;button.textContent=text;if(title){button.title=title;button.ariaLabel=title}return button}
  private logo(className:string):HTMLImageElement{const image=document.createElement('img');image.className=className;image.src=this.logoUrl;image.alt='';return image}
  private clear():void{for(const child of [...this.root.children])if(!(child instanceof HTMLStyleElement))child.remove()}
  private setView(view:OverlayView):void{this.view=view;this.host.dataset.piView=view}
  private readonly onKeyDown=(event:KeyboardEvent):void=>{if(this.view==='hidden')return;if(event.key==='Escape'){if(this.sidebarActive)this.collapseSidebar();else this.closeSurface();return}if(event.altKey&&event.key==='ArrowUp'){event.preventDefault();this.navigate(1)}if(event.altKey&&event.key==='ArrowDown'){event.preventDefault();this.navigate(-1)}};
  private readonly onColorSchemeChange=():void=>this.scheduleTheme();
  private trackTheme():void{this.refreshTheme();this.themeObserver=new MutationObserver(()=>this.scheduleTheme());const options:MutationObserverInit={attributes:true,attributeFilter:['class','style','data-theme','data-color-mode','data-bs-theme']};this.themeObserver.observe(document.documentElement,options);if(document.body)this.themeObserver.observe(document.body,options);this.colorSchemeQuery=globalThis.matchMedia?.('(prefers-color-scheme:dark)');this.colorSchemeQuery?.addEventListener('change',this.onColorSchemeChange)}
  private scheduleTheme():void{if(this.themeTimer)clearTimeout(this.themeTimer);this.themeTimer=setTimeout(()=>this.refreshTheme(),40)}private refreshTheme():void{this.host.dataset.piTheme=detectPageTheme()}
}
