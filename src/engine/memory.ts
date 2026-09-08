import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { StructSize } from './constants';

/**
 * Scoped allocation for the WASM heap.
 *
 * Every PDFium call that returns a struct or an array wants a pointer we own,
 * and each one has to be freed. Doing that by hand around calls that can throw
 * leaks on the error path, so all allocation goes through `withScope`, which
 * frees in reverse order in a `finally`.
 */
export class Scope {
  private readonly ptrs: number[] = [];

  constructor(private readonly mod: WrappedPdfiumModule) {}

  /** Allocate `size` zeroed bytes. */
  alloc(size: number): number {
    const ptr = this.mod.pdfium.wasmExports.malloc(size);
    if (!ptr) throw new Error(`Out of WASM memory allocating ${size} bytes.`);
    this.ptrs.push(ptr);
    new Uint8Array(this.mod.pdfium.HEAPU8.buffer, ptr, size).fill(0);
    return ptr;
  }

  /** Copy `bytes` onto the heap and return the pointer. */
  allocBytes(bytes: Uint8Array): number {
    const ptr = this.alloc(bytes.byteLength || 1);
    this.mod.pdfium.HEAPU8.set(bytes, ptr);
    return ptr;
  }

  /**
   * Encode a string as NUL-terminated UTF-16LE, which is what PDFium's
   * `FPDF_WIDESTRING` parameters expect (`FPDFText_SetText`, and the
   * `*_SetStringValue` family).
   */
  allocUtf16(text: string): number {
    const size = (text.length + 1) * 2;
    const ptr = this.alloc(size);
    this.mod.pdfium.stringToUTF16(text, ptr, size);
    return ptr;
  }

  /** Allocate one `float`. */
  allocFloat(): number {
    return this.alloc(4);
  }

  /** Allocate `count` contiguous `float`s. */
  allocFloats(count: number): number {
    return this.alloc(count * 4);
  }

  /** Allocate one `int`. */
  allocInt(): number {
    return this.alloc(4);
  }

  /** Allocate an `FS_MATRIX`. */
  allocMatrix(m?: Matrix): number {
    const ptr = this.alloc(StructSize.Matrix);
    if (m) writeMatrix(this.mod, ptr, m);
    return ptr;
  }

  /** Allocate an `FS_RECTF`. */
  allocRectF(): number {
    return this.alloc(StructSize.RectF);
  }

  /** Allocate an `FS_QUADPOINTSF`. */
  allocQuad(): number {
    return this.alloc(StructSize.QuadPointsF);
  }

  free(): void {
    for (let i = this.ptrs.length - 1; i >= 0; i--) {
      this.mod.pdfium.wasmExports.free(this.ptrs[i]);
    }
    this.ptrs.length = 0;
  }
}

/**
 * Run `fn` with a scope whose allocations are always freed.
 *
 * Never return a pointer out of `fn`. Every allocation is freed the moment
 * this returns, and the allocator writes its own free-list bookkeeping into
 * the first bytes of a released block, so a leaked pointer does not merely
 * risk corruption, it reads corrupted data reliably. Use the pointer inside
 * the callback, and return the decoded result instead.
 */
export function withScope<T>(mod: WrappedPdfiumModule, fn: (s: Scope) => T): T {
  const scope = new Scope(mod);
  try {
    return fn(scope);
  } finally {
    scope.free();
  }
}

/**
 * Set an object's transform.
 *
 * The allocation and the call that consumes it live in the same scope, which
 * is the only safe shape: an earlier version of this built the struct in one
 * scope and passed the pointer to the setter afterwards, so PDFium read a
 * freed block. The `a` and `b` components came back as denormalised noise, the
 * glyphs collapsed onto a single point, and text extraction then deduplicated
 * them, which surfaced as replacement text mysteriously losing its repeated
 * letters.
 */
export function setObjectMatrix(
  mod: WrappedPdfiumModule,
  obj: number,
  m: Matrix,
): boolean {
  return withScope(mod, (scope) => mod.FPDFPageObj_SetMatrix(obj, scope.allocMatrix(m)));
}

export function readFloat(mod: WrappedPdfiumModule, ptr: number): number {
  return mod.pdfium.getValue(ptr, 'float');
}

export function readInt(mod: WrappedPdfiumModule, ptr: number): number {
  return mod.pdfium.getValue(ptr, 'i32');
}

export function readFloats(mod: WrappedPdfiumModule, ptr: number, count: number): number[] {
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = mod.pdfium.getValue(ptr + i * 4, 'float');
  return out;
}

/** A PDF transformation matrix: `[a b c d e f]`. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Compose two PDF matrices: `first`, then `second`.
 *
 * PDF uses row vectors, so a point maps as
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f`, and composing means
 * `first x second`. Getting the order backwards is invisible whenever one of
 * them is a pure translation, which is exactly the case that will be tested
 * first and exactly why it is worth stating.
 */
export function multiplyMatrix(first: Matrix, second: Matrix): Matrix {
  return {
    a: first.a * second.a + first.b * second.c,
    b: first.a * second.b + first.b * second.d,
    c: first.c * second.a + first.d * second.c,
    d: first.c * second.b + first.d * second.d,
    e: first.e * second.a + first.f * second.c + second.e,
    f: first.e * second.b + first.f * second.d + second.f,
  };
}

export function isIdentity(m: Matrix): boolean {
  return (
    Math.abs(m.a - 1) < 1e-9 &&
    Math.abs(m.b) < 1e-9 &&
    Math.abs(m.c) < 1e-9 &&
    Math.abs(m.d - 1) < 1e-9 &&
    Math.abs(m.e) < 1e-9 &&
    Math.abs(m.f) < 1e-9
  );
}

export function transformPoint(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * Transform a rectangle and re-bound it.
 *
 * All four corners are mapped, because a rotating or flipping matrix moves
 * which corner is which, and mapping only two silently yields a negative
 * width.
 */
export function transformRect(m: Matrix, r: Rect): Rect {
  const corners = [
    transformPoint(m, r.left, r.bottom),
    transformPoint(m, r.right, r.bottom),
    transformPoint(m, r.right, r.top),
    transformPoint(m, r.left, r.top),
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

export function readMatrix(mod: WrappedPdfiumModule, ptr: number): Matrix {
  const [a, b, c, d, e, f] = readFloats(mod, ptr, 6);
  return { a, b, c, d, e, f };
}

export function writeMatrix(mod: WrappedPdfiumModule, ptr: number, m: Matrix): void {
  const vals = [m.a, m.b, m.c, m.d, m.e, m.f];
  for (let i = 0; i < 6; i++) mod.pdfium.setValue(ptr + i * 4, vals[i], 'float');
}

/**
 * `FS_RECTF` is stored as left, top, right, bottom. In PDF user space y grows
 * upward, so `top` is the larger value; callers get a normalised rect instead.
 */
export function readRectF(mod: WrappedPdfiumModule, ptr: number): Rect {
  const [left, top, right, bottom] = readFloats(mod, ptr, 4);
  return normaliseRect({ left, top, right, bottom });
}

/**
 * An axis-aligned rectangle in PDF user space: points, y-up, origin at the
 * bottom-left of the page box. Always normalised so `right >= left` and
 * `top >= bottom`.
 */
export interface Rect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/**
 * Order the corners. PDFium hands back unnormalised rects for rotated pages
 * and for some malformed files, and every consumer downstream assumes
 * `right >= left`, so this is applied at every boundary.
 */
export function normaliseRect(r: Rect): Rect {
  return {
    left: Math.min(r.left, r.right),
    right: Math.max(r.left, r.right),
    bottom: Math.min(r.bottom, r.top),
    top: Math.max(r.bottom, r.top),
  };
}

export function rectWidth(r: Rect): number {
  return r.right - r.left;
}

export function rectHeight(r: Rect): number {
  return r.top - r.bottom;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    outer.left <= inner.left &&
    outer.right >= inner.right &&
    outer.bottom <= inner.bottom &&
    outer.top >= inner.top
  );
}

export function rectArea(r: Rect): number {
  return Math.max(0, rectWidth(r)) * Math.max(0, rectHeight(r));
}

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.max(a.right, b.right),
    top: Math.max(a.top, b.top),
  };
}

/** Pack an RGBA colour into the 0-255 components PDFium's setters take. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
