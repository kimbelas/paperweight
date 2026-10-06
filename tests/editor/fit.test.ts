import { describe, expect, it } from 'vitest';
import { fitZoom } from '@/editor/fit';

const portrait = { width: 612, height: 792 };
const landscape = { width: 792, height: 612 };

describe('fitZoom', () => {
  it('fits the widest page to the width', () => {
    expect(fitZoom([portrait, landscape, portrait], 'width', 792, 500)).toBeCloseTo(1, 5);
  });

  it('fits the largest page inside the box for Fit page', () => {
    // Portrait limits by height (500/792), landscape by width (700/792).
    expect(fitZoom([portrait, landscape], 'page', 700, 500)).toBeCloseTo(500 / 792, 5);
  });

  it('does not depend on which page is current', () => {
    const a = fitZoom([portrait, landscape], 'width', 400, 800);
    const b = fitZoom([landscape, portrait], 'width', 400, 800);
    expect(a).toBe(b);
  });

  it('clamps to the zoom range', () => {
    expect(fitZoom([portrait], 'width', 10, 10)).toBe(0.1);
    expect(fitZoom([portrait], 'width', 100000, 100000)).toBe(4);
  });

  it('returns 1 with no pages', () => {
    expect(fitZoom([], 'width', 800, 600)).toBe(1);
  });
});
