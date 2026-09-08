import type { Engine } from './useEngine';
import type { Rect } from '@/engine/types';

/**
 * Mapping between PDF space and screen space.
 *
 * Dragging a signature has to feel immediate, so the conversion must be
 * synchronous. But re-deriving the mapping by hand means reimplementing
 * `/Rotate` and crop-box handling in the UI, which is exactly the arithmetic
 * that puts a drawn rectangle 36 points from where it was drawn on the
 * documents nobody tests against.
 *
 * So PDFium's own mapping is measured instead: three probe points give the
 * page-from-device transform exactly, including rotation and crop offset, and
 * inverting it gives device-from-page. Three worker calls per page, cached
 * until the page size or rotation changes, and then all the maths is local.
 */

export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface PageTransform {
  /** Device pixels per PDF point, ignoring rotation. */
  scale: number;
  /** Screen from PDF. */
  toDevice: Affine;
  /** PDF from screen. */
  toPage: Affine;
  deviceWidth: number;
  deviceHeight: number;
}

/** Distance between probe points; far apart keeps rounding error small. */
const PROBE = 1000;

/**
 * Measure the transform for a page at a given rendered size.
 *
 * `deviceWidth` and `deviceHeight` are the CSS size of the page as displayed.
 */
export async function measureTransform(
  engine: Engine,
  pageIndex: number,
  deviceWidth: number,
  deviceHeight: number,
): Promise<PageTransform> {
  // Device to page, sampled. These come back as doubles, so the derived
  // transform is precise.
  const [origin, alongX, alongY] = await Promise.all([
    engine.toPagePoint(pageIndex, deviceWidth, deviceHeight, 0, 0),
    engine.toPagePoint(pageIndex, deviceWidth, deviceHeight, PROBE, 0),
    engine.toPagePoint(pageIndex, deviceWidth, deviceHeight, 0, PROBE),
  ]);

  const toPage: Affine = {
    a: (alongX.x - origin.x) / PROBE,
    b: (alongX.y - origin.y) / PROBE,
    c: (alongY.x - origin.x) / PROBE,
    d: (alongY.y - origin.y) / PROBE,
    e: origin.x,
    f: origin.y,
  };

  return {
    scale: Math.hypot(toPage.a, toPage.b) === 0 ? 1 : 1 / Math.hypot(toPage.a, toPage.b),
    toPage,
    toDevice: invert(toPage),
    deviceWidth,
    deviceHeight,
  };
}

/** Invert a 2×3 affine transform. */
export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) {
    // A degenerate transform would silently place everything at the origin.
    // Identity at least keeps the page usable and the failure visible.
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function apply(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * A PDF rectangle as a CSS box.
 *
 * All four corners are mapped and then re-bounded, rather than mapping two:
 * on a rotated page the corner that was top-left is not top-left any more,
 * and mapping only two corners silently produces a negative width.
 */
export function pdfRectToCss(
  t: PageTransform,
  rect: Rect,
): { left: number; top: number; width: number; height: number } {
  const corners = [
    apply(t.toDevice, rect.left, rect.bottom),
    apply(t.toDevice, rect.right, rect.bottom),
    apply(t.toDevice, rect.right, rect.top),
    apply(t.toDevice, rect.left, rect.top),
  ];

  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    left,
    top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

/** A CSS box back to a PDF rectangle, normalised. */
export function cssRectToPdf(
  t: PageTransform,
  box: { left: number; top: number; width: number; height: number },
): Rect {
  const corners = [
    apply(t.toPage, box.left, box.top),
    apply(t.toPage, box.left + box.width, box.top),
    apply(t.toPage, box.left + box.width, box.top + box.height),
    apply(t.toPage, box.left, box.top + box.height),
  ];

  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}

/** Move a PDF rect by a screen-space delta. */
export function translatePdfRect(
  t: PageTransform,
  rect: Rect,
  deltaCssX: number,
  deltaCssY: number,
): Rect {
  // The delta is converted as a vector, so the transform's translation is
  // excluded and only its rotation and scale apply.
  const origin = apply(t.toPage, 0, 0);
  const moved = apply(t.toPage, deltaCssX, deltaCssY);
  const dx = moved.x - origin.x;
  const dy = moved.y - origin.y;

  return {
    left: rect.left + dx,
    right: rect.right + dx,
    bottom: rect.bottom + dy,
    top: rect.top + dy,
  };
}

/**
 * Convert a screen-space drag delta into PDF points.
 *
 * Applied as a vector, so the transform's translation drops out and only its
 * rotation and scale matter. Doing this by dividing by a zoom factor would be
 * wrong on any rotated page.
 */
export function cssDeltaToPdf(
  t: PageTransform,
  deltaCssX: number,
  deltaCssY: number,
): { dx: number; dy: number } {
  const origin = apply(t.toPage, 0, 0);
  const moved = apply(t.toPage, deltaCssX, deltaCssY);
  return { dx: moved.x - origin.x, dy: moved.y - origin.y };
}

/** How many PDF points one CSS pixel spans, for sizing type on screen. */
export function pointsPerPixel(t: PageTransform): number {
  return Math.hypot(t.toPage.a, t.toPage.b) || 1;
}
