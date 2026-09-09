import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { ObjType } from './constants';
import type { PdfDocument } from './document';
import { isIdentity, normaliseRect, transformRect, withScope, type Rect } from './memory';
import { walkObjects } from './object-path';
import type { PageObject } from './types';

/** `FPDF_IMAGEOBJ_METADATA`: two uints, two floats, a uint and two ints. */
const IMAGE_METADATA_SIZE = 28;

export interface ImageMetadata {
  width: number;
  height: number;
  horizontalDpi: number;
  verticalDpi: number;
  bitsPerPixel: number;
  colorspace: number;
}

export function getImageMetadata(
  mod: WrappedPdfiumModule,
  page: number,
  obj: number,
): ImageMetadata | null {
  return withScope(mod, (scope) => {
    const ptr = scope.alloc(IMAGE_METADATA_SIZE);
    if (!mod.FPDFImageObj_GetImageMetadata(obj, page, ptr)) return null;
    const u = (off: number) => mod.pdfium.getValue(ptr + off, 'i32');
    const f = (off: number) => mod.pdfium.getValue(ptr + off, 'float');
    return {
      width: u(0),
      height: u(4),
      horizontalDpi: f(8),
      verticalDpi: f(12),
      bitsPerPixel: u(16),
      colorspace: u(20),
    };
  });
}

function objectBounds(mod: WrappedPdfiumModule, obj: number): Rect {
  return withScope(mod, (scope) => {
    const l = scope.allocFloat();
    const b = scope.allocFloat();
    const r = scope.allocFloat();
    const t = scope.allocFloat();
    if (!mod.FPDFPageObj_GetBounds(obj, l, b, r, t)) {
      return { left: 0, bottom: 0, right: 0, top: 0 };
    }
    const get = (p: number) => mod.pdfium.getValue(p, 'float');
    return normaliseRect({ left: get(l), bottom: get(b), right: get(r), top: get(t) });
  });
}

/**
 * Every object on a page, flattened but path-addressed.
 *
 * Used by the selection tool: the user can click anything visible and delete
 * it, whether it is a stray image, a stamp, or a line of text.
 */
export function listPageObjects(doc: PdfDocument, pageIndex: number): PageObject[] {
  const { mod } = doc;
  const page = doc.page(pageIndex);
  const out: PageObject[] = [];

  walkObjects(mod, page, ({ handle, path, type, nested, ancestorMatrix }) => {
    // A form is a container. Listing it as selectable would let the user
    // delete a whole group by clicking one item inside it, so only leaves are
    // offered.
    if (type === ObjType.Form) return;

    // Nested bounds arrive in the parent form's space; see `VisitedObject`.
    const raw = objectBounds(mod, handle);
    const bounds = isIdentity(ancestorMatrix) ? raw : transformRect(ancestorMatrix, raw);
    if (bounds.right <= bounds.left || bounds.top <= bounds.bottom) return;

    const entry: PageObject = { page: pageIndex, path, nested, type, bounds };

    if (type === ObjType.Image) {
      const meta = getImageMetadata(mod, page, handle);
      // 32 bits per pixel means an alpha channel is present. Soft-masked
      // signature scans are usually reported this way, and it is one of the
      // signals the signature heuristics weigh.
      entry.hasAlpha = meta ? meta.bitsPerPixel === 32 : false;
    }

    out.push(entry);
  });

  return out;
}

/**
 * The topmost object at a point, for click selection.
 *
 * Later objects paint over earlier ones, so the list is searched backwards.
 * Between overlapping candidates the smallest wins, which makes a small item
 * on top of a large background selectable at all.
 */
export function hitTestObject(objects: PageObject[], x: number, y: number): PageObject | null {
  let best: PageObject | null = null;
  let bestArea = Infinity;

  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (x < o.bounds.left || x > o.bounds.right || y < o.bounds.bottom || y > o.bounds.top) {
      continue;
    }
    const area = (o.bounds.right - o.bounds.left) * (o.bounds.top - o.bounds.bottom);
    if (area < bestArea) {
      best = o;
      bestArea = area;
    }
  }

  return best;
}

export function objectTypeName(type: number): string {
  switch (type) {
    case ObjType.Text:
      return 'Text';
    case ObjType.Path:
      return 'Shape';
    case ObjType.Image:
      return 'Image';
    case ObjType.Shading:
      return 'Gradient';
    case ObjType.Form:
      return 'Group';
    default:
      return 'Object';
  }
}
