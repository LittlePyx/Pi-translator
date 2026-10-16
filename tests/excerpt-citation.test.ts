import {describe,expect,it} from 'vitest';
import {normalizeExcerptCitation} from '../core/content/excerpt-citation';
import {buildTranslationMarkerMarkdown,restorePersistedPdfTranslationMarker} from '../core/content/session-translation-markers';
import {normalizePersistedPdfTranslationMarker} from '../core/pdf/translation-marker-repository';
describe('citable excerpt notes',()=>{
  it('round-trips user citation fields with page, text and editable LaTeX intact',()=>{
    const citation=normalizeExcerptCitation({sourceTitle:'Example [paper]',sourceUrl:'https://example.com/paper(a).pdf',doi:'https://doi.org/10.1000/example(1)',note:'核对第一个公式。'});
    const marker=normalizePersistedPdfTranslationMarker({markerId:'m::full',anchor:{kind:'text-quote',pageNumber:3,sourceText:'We use $x=y$.',prefix:'',suffix:''},createdAt:1,
      content:{...citation,originalText:'We use $x=y$.',translatedText:'我们使用 $x=y$。',pageNumber:3}})!;
    expect(restorePersistedPdfTranslationMarker(marker,'document').content).toEqual(marker.content);
    const markdown=buildTranslationMarkerMarkdown([marker.content]);
    expect(markdown).toContain('Example \\[paper\\] · 第 3 页');
    expect(markdown).toContain('> We use $x=y$.');
    expect(markdown).toContain('我们使用 $x=y$。');
    expect(markdown).toContain('https://example.com/paper%28a%29.pdf');
    expect(markdown).toContain('https://doi.org/10.1000/example%281%29');
    expect(markdown).toContain('> 核对第一个公式。');
  });
  it('rejects invalid links/DOIs without manufacturing bibliographic facts',()=>{
    expect(()=>normalizeExcerptCitation({sourceTitle:'Paper',sourceUrl:'javascript:alert(1)'})).toThrow('HTTP');
    expect(()=>normalizeExcerptCitation({sourceTitle:'Paper',doi:'invented-reference'})).toThrow('DOI');
    expect(normalizeExcerptCitation({sourceTitle:' Paper ',sourceUrl:'',doi:'',note:''})).toEqual({sourceTitle:'Paper'});
    expect(buildTranslationMarkerMarkdown([{sourceTitle:'Paper',originalText:'Source',translatedText:'译文'}])).not.toContain('DOI:');
  });
});
