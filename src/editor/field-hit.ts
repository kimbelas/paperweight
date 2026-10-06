import type { FormFieldInfo } from '@/engine/types';
import { pdfRectToCss, type PageTransform } from './transform';

/**
 * How far outside a field a finger may land and still mean it, in CSS pixels.
 *
 * At the zoom that fits a page to a phone a 14pt field is about eight pixels
 * tall, smaller than any fingertip. Without slop a tap just below a field fell
 * through to the text hit test, which takes the nearest line in the band, and
 * offered to edit the field's caption instead.
 */
export const TOUCH_SLOP_PX = 8;

/**
 * The field under a point in CSS pixels, from the page's own field list.
 *
 * Answered here rather than by asking the worker, so a tap can open the
 * editor inside the gesture: iOS raises the keyboard only for a focus that
 * happens during the tap, and a round trip to the worker ends it. The engine
 * still resolves the field by object number when the edit is committed.
 *
 * An exact hit wins, and the last such field in annotation order is the one
 * drawn on top. Otherwise the nearest field within `slop`.
 */
export function hitField(
  fields: FormFieldInfo[],
  transform: PageTransform,
  x: number,
  y: number,
  slop: number,
): FormFieldInfo | null {
  let exact: FormFieldInfo | null = null;
  let near: FormFieldInfo | null = null;
  let nearDistance = Number.POSITIVE_INFINITY;

  for (const field of fields) {
    const box = pdfRectToCss(transform, field.rect);
    const dx = Math.max(box.left - x, 0, x - (box.left + box.width));
    const dy = Math.max(box.top - y, 0, y - (box.top + box.height));
    const distance = Math.hypot(dx, dy);
    if (distance === 0) exact = field;
    else if (distance <= slop && distance < nearDistance) {
      near = field;
      nearDistance = distance;
    }
  }

  return exact ?? near;
}
