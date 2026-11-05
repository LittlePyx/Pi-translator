import {describe,it,expect} from 'vitest';
import {rotatePdfViewRect} from '../core/pdf/reader-view';
import {normalizePdfReadingState} from '../core/pdf/reading-state';

describe('PDF visual rotation keeps canonical source geometry',() => {
  const original={leftRatio:.1,topRatio:.2,widthRatio:.3,heightRatio:.4};
  it('maps quarter turns and recovers stored old rectangles',() => {
    expect(rotatePdfViewRect(original,90)).toEqual({leftRatio:.4,topRatio:.1,widthRatio:.4,heightRatio:.3});
    for(const angle of [0,90,180,270]) {
      const result=rotatePdfViewRect(rotatePdfViewRect(original,angle),-angle);
      for(const key of Object.keys(original) as (keyof typeof original)[]) expect(result[key]).toBeCloseTo(original[key],12);
    }
  });
  it('preserves old states exactly and safely restores the new optional view settings',() => {
    const old={pageNumber:2,pageRatio:.3,zoomLevel:.75,fitWidth:false,sidebarExpanded:false,updatedAt:20};
    expect(normalizePdfReadingState(old)).toEqual(old);
    expect(normalizePdfReadingState({...old,zoomLevel:.25,fitPage:true,rotation:270})).toEqual({...old,zoomLevel:.25,fitPage:true,rotation:270});
    expect(normalizePdfReadingState({...old,rotation:45,fitPage:'yes'})).toEqual(old);
    expect(normalizePdfReadingState({...old,fitWidth:true,fitPage:true})).not.toHaveProperty('fitPage');
  });
});
