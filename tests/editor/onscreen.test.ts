import { describe, expect, it } from 'vitest';
import { placeOnScreen } from '@/editor/onscreen';

const vp = { left: 0, top: 0, width: 390, height: 844 };

describe('placeOnScreen', () => {
  it('leaves a chip that fits alone', () => {
    expect(placeOnScreen({ left: 20, top: 100, right: 220, bottom: 130 }, vp)).toEqual({
      dx: 0,
      below: false,
    });
  });

  it('shifts a chip that runs off the right edge', () => {
    expect(placeOnScreen({ left: 300, top: 100, right: 500, bottom: 130 }, vp, 8).dx).toBe(-118);
  });

  it('shifts a chip that starts off the left edge', () => {
    expect(placeOnScreen({ left: -30, top: 100, right: 100, bottom: 130 }, vp, 8).dx).toBe(38);
  });

  it('flips below when there is no room above', () => {
    expect(placeOnScreen({ left: 20, top: -10, right: 220, bottom: 20 }, vp).below).toBe(true);
  });
});
