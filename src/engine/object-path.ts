import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { ObjType } from './constants';
import { IDENTITY, multiplyMatrix, readMatrix, withScope, type Matrix } from './memory';

/**
 * Addressing page objects, including nested ones.
 *
 * A page's object list is not flat. A form XObject is one object whose own
 * content stream holds more objects, nested arbitrarily deep, and annotation
 * appearance streams are form XObjects too. Real documents put text in there
 * routinely: stamps, headers built as reusable forms, the visible content of
 * filled form fields.
 *
 * So an object is addressed by the path of indices from the page down to it.
 * `[4]` is the fifth top-level object; `[4, 1]` is the second object inside
 * it. A flat index would be ambiguous and could not reach nested content at
 * all.
 */
export type ObjectPath = readonly number[];

export function pathKey(path: ObjectPath): string {
  return path.join('.');
}

export function parsePathKey(key: string): number[] {
  return key.split('.').map(Number);
}

/** Resolve a path to a live object handle, or 0 if it no longer exists. */
export function resolvePath(mod: WrappedPdfiumModule, page: number, path: ObjectPath): number {
  if (path.length === 0) return 0;

  let obj = mod.FPDFPage_GetObject(page, path[0]);
  if (!obj) return 0;

  for (let depth = 1; depth < path.length; depth++) {
    if (mod.FPDFPageObj_GetType(obj) !== ObjType.Form) return 0;
    const next = mod.FPDFFormObj_GetObject(obj, path[depth]);
    if (!next) return 0;
    obj = next;
  }
  return obj;
}

/**
 * The form objects between the page and a path's target, outermost first.
 *
 * Empty for a top-level object. Null when any link is missing, which means the
 * path is stale. Removal needs the whole chain rather than just the parent:
 * a form's content stream is only rewritten once that form sits directly on
 * the page, so every form above the target may have to be lifted — see
 * `hoist.ts`.
 */
export function resolveChain(
  mod: WrappedPdfiumModule,
  page: number,
  path: ObjectPath,
): number[] | null {
  if (path.length === 0) return null;

  const chain: number[] = [];
  let obj = mod.FPDFPage_GetObject(page, path[0]);
  if (!obj) return null;

  for (let depth = 1; depth < path.length; depth++) {
    if (mod.FPDFPageObj_GetType(obj) !== ObjType.Form) return null;
    chain.push(obj);
    const next = mod.FPDFFormObj_GetObject(obj, path[depth]);
    if (!next) return null;
    obj = next;
  }
  return chain;
}

export interface VisitedObject {
  handle: number;
  path: number[];
  type: number;
  /** True when this object sits inside one or more form XObjects. */
  nested: boolean;
  /**
   * The combined transform of every form XObject above this object, mapping
   * the object's own space to page space. Identity for a top-level object.
   *
   * This matters more than it looks. PDFium reports a nested object's matrix
   * and bounds in its *parent form's* space, not the page's. That is invisible
   * whenever the form is placed with an identity transform — which is common,
   * and which is why an early version appeared to work and then dropped edited
   * text at the bottom-left corner of any page whose form carried a real
   * translation.
   */
  ancestorMatrix: Matrix;
}

/** Depth limit for form nesting, as a guard against a pathological file. */
const MAX_DEPTH = 8;

/**
 * Walk every object on a page, descending into form XObjects.
 *
 * Callers get the handle and its path, so they can both read it now and
 * address it again later.
 */
export function walkObjects(
  mod: WrappedPdfiumModule,
  page: number,
  visit: (obj: VisitedObject) => void,
): void {
  const count = mod.FPDFPage_CountObjects(page);
  for (let i = 0; i < count; i++) {
    const obj = mod.FPDFPage_GetObject(page, i);
    if (!obj) continue;
    descend(mod, obj, [i], false, 0, IDENTITY, visit);
  }
}

/**
 * An object's own matrix. For a form object that is the matrix it was placed
 * with, which maps its contents into the space of whatever holds it.
 */
export function objectMatrix(mod: WrappedPdfiumModule, handle: number): Matrix {
  return withScope(mod, (scope) => {
    const ptr = scope.allocMatrix();
    if (!mod.FPDFPageObj_GetMatrix(handle, ptr)) return IDENTITY;
    return readMatrix(mod, ptr);
  });
}

function descend(
  mod: WrappedPdfiumModule,
  handle: number,
  path: number[],
  nested: boolean,
  depth: number,
  ancestorMatrix: Matrix,
  visit: (obj: VisitedObject) => void,
): void {
  const type = mod.FPDFPageObj_GetType(handle);
  visit({ handle, path, type, nested, ancestorMatrix });

  if (type !== ObjType.Form || depth >= MAX_DEPTH) return;

  // A form's own matrix applies to everything inside it, on top of whatever
  // its own ancestors contribute.
  const childAncestor = multiplyMatrix(objectMatrix(mod, handle), ancestorMatrix);

  const childCount = mod.FPDFFormObj_CountObjects(handle);
  for (let i = 0; i < childCount; i++) {
    const child = mod.FPDFFormObj_GetObject(handle, i);
    if (!child) continue;
    descend(mod, child, [...path, i], true, depth + 1, childAncestor, visit);
  }
}
