import { describe, expect, it } from 'vitest';
import { hitField } from '@/editor/field-hit';
import type { PageTransform } from '@/editor/transform';
import type { FormFieldInfo } from '@/engine/types';

// One CSS pixel per point, y flipped on a 792pt page.
const t: PageTransform = {
  scale: 1,
  toDevice: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 792 },
  toPage: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 792 },
  deviceWidth: 612,
  deviceHeight: 792,
};

const field = (ref: number, left: number, bottom: number, right: number, top: number) =>
  ({ ref, rect: { left, bottom, right, top } }) as FormFieldInfo;

describe('hitField', () => {
  const a = field(1, 100, 700, 200, 710);
  const b = field(2, 100, 680, 200, 690);

  it('hits a point inside a field', () => {
    expect(hitField([a, b], t, 150, 792 - 705, 0)?.ref).toBe(1);
  });

  it('misses outside without slop', () => {
    expect(hitField([a, b], t, 150, 792 - 715, 0)).toBeNull();
  });

  it('reaches a near miss with slop', () => {
    expect(hitField([a, b], t, 150, 792 - 715, 8)?.ref).toBe(1);
  });

  it('prefers the nearer of two fields within slop', () => {
    // 4px below a, 6px above b.
    expect(hitField([a, b], t, 150, 792 - 694, 8)?.ref).toBe(2);
  });

  it('prefers the topmost exact hit when fields overlap', () => {
    const top = field(3, 150, 700, 250, 710);
    expect(hitField([a, top], t, 160, 792 - 705, 8)?.ref).toBe(3);
  });
});
