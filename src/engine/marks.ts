/**
 * Marks: the things you put on a paper form by hand.
 *
 * A cross in a box, a tick, a ring round an option, a dot, a line through
 * something. They are wanted for the case the form itself does not cover —
 * a checkbox that is a printed square rather than an interactive widget, which
 * is most of them once a form has been printed, filled and scanned, or built
 * by a layout tool that never made it a field.
 *
 * They are drawn as **vector paths**, not as text and not as pictures.
 *
 * Not text, because there is no glyph to rely on: the bundled fallback faces
 * do not carry U+2713, so a tick typed as text would either come out as a
 * missing-glyph box or drag a symbol font into the file for one character.
 *
 * Not a picture, because a rasterised tick is soft on paper and grows the file
 * for something that is four coordinates. A path prints at the printer's own
 * resolution and adds a few dozen bytes.
 *
 * ## Why the geometry lives here
 *
 * This module holds no PDFium import, deliberately, so the interface can draw
 * the on-screen preview from the same definition the engine draws the real
 * mark from. Two definitions — one in SVG for the overlay, one in PDF
 * operators for the page — is how a preview ends up not matching what is
 * saved, and a tick that moves when you commit it is worse than no tick.
 * `markPathData` and the engine's `insertPath` are both readers of `MARKS`.
 *
 * Geometry is in a unit box: x and y from 0 to 1, **y-up**, as PDF space is.
 * The SVG side flips it; the PDF side does not have to.
 */

export type MarkShape = 'cross' | 'tick' | 'circle' | 'dot' | 'line';

/** How heavy the stroke is, as a fraction of the box's shorter side. */
export type MarkWeight = 'thin' | 'medium' | 'bold';

export const MARK_WEIGHTS: Record<MarkWeight, number> = {
  thin: 0.06,
  medium: 0.1,
  bold: 0.16,
};

type Point = readonly [number, number];

/**
 * One step along a subpath: a straight line, or a cubic with two controls.
 *
 * This is the intersection of what SVG's `d` and PDFium's `FPDFPath_*` can
 * both express directly, which is what lets one definition serve both.
 */
export type MarkSegment = { to: Point } | { c1: Point; c2: Point; to: Point };

export interface MarkSubpath {
  from: Point;
  segments: MarkSegment[];
  close?: boolean;
}

export interface MarkDef {
  label: string;
  /** One line of explanation, used as the tooltip. */
  hint: string;
  subpaths: MarkSubpath[];
  /** Filled rather than stroked. Only the dot is. */
  filled?: boolean;
  /** Width over height when first placed. */
  aspect: number;
  /** Its natural size in points, for a click that places one without dragging. */
  size: number;
}

/** Cubic control offset for a circular arc quadrant. */
const KAPPA = 0.5523;

/** A circle inscribed in the unit box, as four cubics. */
function circle(radius: number): MarkSubpath {
  const c = 0.5;
  const k = radius * KAPPA;
  return {
    from: [c + radius, c],
    segments: [
      { c1: [c + radius, c + k], c2: [c + k, c + radius], to: [c, c + radius] },
      { c1: [c - k, c + radius], c2: [c - radius, c + k], to: [c - radius, c] },
      { c1: [c - radius, c - k], c2: [c - k, c - radius], to: [c, c - radius] },
      { c1: [c + k, c - radius], c2: [c + radius, c - k], to: [c + radius, c] },
    ],
    close: true,
  };
}

/** A polyline through the given points. */
function poly(...points: Point[]): MarkSubpath {
  return { from: points[0], segments: points.slice(1).map((to) => ({ to })) };
}

export const MARKS: Record<MarkShape, MarkDef> = {
  cross: {
    label: 'Cross',
    hint: 'An ✗, for a box that is printed on the page rather than a real field',
    // Inset from the edges, so a bold stroke stays inside the box the user
    // sized rather than spilling over the printed square it sits in.
    subpaths: [poly([0.14, 0.14], [0.86, 0.86]), poly([0.14, 0.86], [0.86, 0.14])],
    aspect: 1,
    size: 11,
  },
  tick: {
    label: 'Tick',
    hint: 'A ✓, in the proportions a hand draws it',
    subpaths: [poly([0.1, 0.52], [0.38, 0.16], [0.92, 0.86])],
    aspect: 1,
    size: 12,
  },
  circle: {
    label: 'Ring',
    hint: 'A ring round the option you are choosing',
    subpaths: [circle(0.42)],
    aspect: 1,
    size: 16,
  },
  dot: {
    label: 'Dot',
    hint: 'A filled dot, for a printed radio button',
    subpaths: [circle(0.3)],
    filled: true,
    aspect: 1,
    size: 10,
  },
  line: {
    label: 'Line',
    hint: 'A rule, for striking through or signing on',
    subpaths: [poly([0.02, 0.5], [0.98, 0.5])],
    aspect: 6,
    size: 60,
  },
};

export const MARK_ORDER: MarkShape[] = ['cross', 'tick', 'circle', 'dot', 'line'];

/** Stroke width in the same units as the box, for a weight. */
export function markStrokeWidth(width: number, height: number, weight: MarkWeight): number {
  // Keyed to the shorter side so a mark stretched wide — the line, mostly —
  // does not also get a heavier stroke.
  return Math.max(0.4, Math.min(width, height) * MARK_WEIGHTS[weight]);
}

/**
 * The mark as an SVG `d`, in a box of the given pixel size.
 *
 * SVG's y runs down the screen and the definitions are y-up, so every
 * coordinate is flipped here. Sizes are absolute rather than a 0..1 viewBox
 * because the stroke has to be in the same space as the geometry for a
 * non-square box — otherwise the line's stroke would be stretched with it.
 */
export function markPathData(shape: MarkShape, width: number, height: number): string {
  const px = (p: Point) => `${(p[0] * width).toFixed(2)} ${((1 - p[1]) * height).toFixed(2)}`;

  return MARKS[shape].subpaths
    .map((subpath) => {
      const parts = [`M ${px(subpath.from)}`];
      for (const segment of subpath.segments) {
        parts.push(
          'c1' in segment
            ? `C ${px(segment.c1)} ${px(segment.c2)} ${px(segment.to)}`
            : `L ${px(segment.to)}`,
        );
      }
      if (subpath.close) parts.push('Z');
      return parts.join(' ');
    })
    .join(' ');
}
