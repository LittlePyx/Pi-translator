import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {listLibrarySources,filterLibrarySources,textSourceUrl,excerptSourceHref} from '../core/translation/library-search';
const stored:Record<string,unknown>={};
beforeEach(()=>{
  for(const key of Object.keys(stored))delete stored[key];
  vi.stubGlobal('browser',{runtime:{getURL:(path:string)=>`chrome-extension://test${path}`},storage:{local:{get:vi.fn(async(key:string)=>({[key]:structuredClone(stored[key])})),set:vi.fn(),remove:vi.fn()}}});
});
afterEach(()=>vi.unstubAllGlobals());
describe('read-only unified library search',()=>{
  it('finds notes and confirmed wording while excluding candidates and preserving every stored byte',async()=>{
    const {saveWebExcerpt}=await import('../core/content/web-excerpt-repository');
    // Build a valid stored record through the existing writer in a separate temporary store.
    const local=browser.storage.local;
    vi.mocked(local.set).mockImplementation(async value=>{Object.assign(stored,structuredClone(value))});
    await saveWebExcerpt({markerId:'web1',pageUrl:'https://example.org/paper',anchor:{sourceText:'Original quantum result',prefix:'',suffix:''},content:{sourceTitle:'Web paper',originalText:'Original quantum result',translatedText:'量子译文 $x=y$',note:'人工笔记 quantum'},createdAt:1,updatedAt:2});
    stored.documentTranslationMemoryV1={'doc-old':{schemaVersion:1,documentId:'doc-old',label:'Historical paper',updatedAt:3,confirmedTerms:[{id:'term1',source:'quantum',target:'量子',createdAt:1,updatedAt:3}],candidateTerms:[{id:'candidate',source:'unconfirmed',target:'不能列出',createdAt:1}],recentTranslations:[],dismissedTermKeys:[]}};
    const before=structuredClone(stored);vi.mocked(local.set).mockClear();
    const all=await listLibrarySources();
    expect(all).toHaveLength(2);expect(filterLibrarySources(all,'人工笔记','all')).toHaveLength(1);
    expect(filterLibrarySources(all,'quantum','all')).toHaveLength(2);
    expect(filterLibrarySources(all,'unconfirmed','all')).toHaveLength(0);
    expect(filterLibrarySources(all,'quantum','web')).toHaveLength(1);
    expect(filterLibrarySources(all,'','all')).toHaveLength(1);
    expect(filterLibrarySources(all,'','web')).toHaveLength(1);
    expect(filterLibrarySources(all,'','pdf')).toHaveLength(0);
    expect(filterLibrarySources(all,'','term')).toHaveLength(1);
    expect(filterLibrarySources(all,'quantum','pinned')).toHaveLength(0);
    expect(stored).toEqual(before);expect(local.set).not.toHaveBeenCalled();expect(local.remove).not.toHaveBeenCalled();
  });
  it('keeps fragment syntax unambiguous and rejects executable, credentialed and local file URLs',()=>{
    const url=textSourceUrl('https://example.org/page#section:~:text=old','A-B, C & D','left-','right,')!;
    expect(url).toBe('https://example.org/page#section:~:text=left%2D-,A%2DB%2C%20C%20%26%20D,-right%2C');
    for(const input of ['javascript:alert(1)','file:///secret.pdf','https://user:password@example.org'])expect(textSourceUrl(input,'quote')).toBeUndefined();
  });
  it('puts only the saved record ID in a PDF link and uses the captured webpage rather than an edited citation',()=>{
    const pdf={kind:'pdf' as const,id:'["pdf-note","abc","note1"]'} as any;
    expect(excerptSourceHref(pdf)).toBe(`chrome-extension://test/pdf.html?excerpt=${encodeURIComponent(pdf.id)}`);
    const web={kind:'web',item:{markerId:'saved::full',pageUrl:'https://original.example/page',anchor:{sourceText:'exact quote',prefix:'',suffix:''}},content:{sourceUrl:'https://edited.example/unrelated'}} as any;
    expect(excerptSourceHref(web)).toBe('https://original.example/page#pi-excerpt=saved%3A%3Afull:~:text=exact%20quote');
    expect(web.item.anchor).toEqual({sourceText:'exact quote',prefix:'',suffix:''});
  });
});
