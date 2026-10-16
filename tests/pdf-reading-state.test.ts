import { describe, expect, it,vi } from 'vitest';
import {
  normalizePdfReadingState,
  pdfReadingStateId,
  getPdfReadingState,savePdfReadingState,normalizePdfTranslationReadingAnchor,
} from '../core/pdf/reading-state';

describe('Pi PDF reading state', () => {
  it('keeps translation anchors bounded and drops invalid metadata without discarding original-page state',()=>{
    expect(normalizePdfTranslationReadingAnchor({mode:'reading',signature:'block-abc123',pageNumber:9.5,offsetRatio:2})).toEqual({mode:'reading',signature:'block-abc123',pageNumber:10,offsetRatio:1});
    expect(normalizePdfTranslationReadingAnchor({mode:'reading',signature:'private-file.pdf',pageNumber:3,offsetRatio:-1})).toEqual({mode:'reading',pageNumber:3,offsetRatio:0});
    expect(normalizePdfReadingState({pageNumber:1,pageRatio:0,zoomLevel:1,translation:{mode:'unknown'}})?.translation).toBeUndefined();
  });
  it('serializes parallel reading writes so they do not discard each other’s anchors',async()=>{
    const local:Record<string,unknown>={};
    vi.stubGlobal('browser',{storage:{local:{get:async(key:string)=>({[key]:structuredClone(local[key])}),set:async(value:Record<string,unknown>)=>{Object.assign(local,structuredClone(value))}}}});
    try{
      const state={pageNumber:3,pageRatio:.4,zoomLevel:1,fitWidth:false,sidebarExpanded:false,updatedAt:10,translation:{mode:'reading' as const,signature:'block-a',pageNumber:7,offsetRatio:.25}};
      await Promise.all([savePdfReadingState('pdf-content:abc',state),savePdfReadingState('library:def',{...state,updatedAt:11})]);
      expect((await getPdfReadingState('pdf-content:abc'))?.translation).toEqual(state.translation);
      expect(await getPdfReadingState('library:def')).toBeDefined();
      expect(JSON.stringify(local)).not.toContain('pdf-content:abc');
    }finally{vi.unstubAllGlobals()}
  });
  it('normalizes page, zoom, and sidebar state into safe bounds', () => {
    expect(normalizePdfReadingState({
      pageNumber: 4.7,
      pageRatio: 1.4,
      zoomLevel: 9,
      fitWidth: true,
      sidebarExpanded: true,
      updatedAt: 123,
    })).toEqual({
      pageNumber: 5,
      pageRatio: 1,
      zoomLevel: 3,
      fitWidth: true,
      sidebarExpanded: true,
      updatedAt: 123,
    });
    expect(normalizePdfReadingState({ pageNumber: '4' })).toBeUndefined();
  });

  it('restores a fit-width zoom below 50% without changing manual zoom bounds', () => {
    const state = {pageNumber:1,pageRatio:0,zoomLevel:0.35,fitWidth:true};
    expect(normalizePdfReadingState(state)?.zoomLevel).toBe(0.35);
    expect(normalizePdfReadingState({...state,fitWidth:false})?.zoomLevel).toBe(0.5);
  });

  it('uses a stable hash instead of storing a PDF URL or filename as the key', async () => {
    const identity = 'https://example.com/private-paper.pdf';
    const first = await pdfReadingStateId(identity);
    expect(first).toBe(await pdfReadingStateId(identity));
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(first).not.toContain('private-paper');
  });
});
