/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { EditorSession } from './session';
import type { RenderOptions } from './render';
import type { PatchRegionRequest } from './insert';
import type { Placement, Rect } from './types';

/**
 * The worker entry point.
 *
 * PDFium runs here, off the main thread, for two reasons. Parsing and
 * rendering a large document would otherwise block scrolling and typing; and
 * keeping the engine behind a message boundary means the UI cannot hold a
 * PDFium handle, which is what stops handle-lifetime bugs from leaking into
 * React's render cycle.
 *
 * The surface is written out explicitly rather than reflected off the session,
 * so it is typed end to end and so the transfer decisions below are visible
 * rather than implicit.
 */

const session = new EditorSession();

const api = {
  // --- Lifecycle ---------------------------------------------------------

  open: (bytes: Uint8Array, password?: string) => session.open(bytes, password),
  info: () => session.info(),
  isOpen: () => session.isOpen,
  close: () => session.close(),

  // --- Reading -----------------------------------------------------------

  /**
   * Render a page, transferring the pixels rather than copying them.
   *
   * An A4 page at 2x is about 11 MB. Structured-cloning that on every scroll
   * tick is the difference between a smooth viewer and a stuttering one. The
   * engine has already copied the pixels out of the WASM heap, so handing over
   * ownership of this buffer is safe.
   */
  renderPage: (pageIndex: number, options: RenderOptions) => {
    const rendered = session.render(pageIndex, options);
    return Comlink.transfer(rendered, [rendered.data.buffer]);
  },

  textLines: (pageIndex: number) => session.textLines(pageIndex),
  glyphs: (pageIndex: number) => session.glyphs(pageIndex),
  objects: (pageIndex: number) => session.objects(pageIndex),
  annotations: (pageIndex: number) => session.annotations(pageIndex),
  signatures: () => session.signatures(),

  formFields: (pageIndex: number) => session.formFields(pageIndex),

  lineAt: (pageIndex: number, w: number, h: number, x: number, y: number) =>
    session.lineAt(pageIndex, w, h, x, y),
  formFieldAt: (pageIndex: number, w: number, h: number, x: number, y: number) =>
    session.formFieldAt(pageIndex, w, h, x, y),
  objectAt: (pageIndex: number, w: number, h: number, x: number, y: number) =>
    session.objectAt(pageIndex, w, h, x, y),
  toPagePoint: (pageIndex: number, w: number, h: number, x: number, y: number) =>
    session.toPagePoint(pageIndex, w, h, x, y),
  toDevicePoint: (pageIndex: number, w: number, h: number, x: number, y: number) =>
    session.toDevicePoint(pageIndex, w, h, x, y),
  toPageRect: (
    pageIndex: number,
    w: number,
    h: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => session.toPageRect(pageIndex, w, h, rect),
  sampleBackground: (pageIndex: number, rect: Rect) => session.sampleBackground(pageIndex, rect),

  // --- Mutating ----------------------------------------------------------

  replaceText: (pageIndex: number, lineId: string, text: string) =>
    session.replaceText(pageIndex, lineId, text),
  patchRegion: (request: PatchRegionRequest) => session.patchRegion(request),
  setFormFieldValue: (pageIndex: number, name: string, value: string, width?: number) =>
    session.setFormFieldValue(pageIndex, name, value, width),
  toggleFormFieldValue: (pageIndex: number, name: string) =>
    session.toggleFormFieldValue(pageIndex, name),
  fitFormFieldWidth: (pageIndex: number, name: string) =>
    session.fitFormFieldWidth(pageIndex, name),
  measureFormField: (pageIndex: number, name: string, value: string) =>
    session.measureFormField(pageIndex, name, value),
  removeSignatureById: (id: string) => session.removeSignatureById(id),
  removeObjects: (pageIndex: number, paths: number[][]) =>
    session.removeObjects(pageIndex, paths),
  removeAnnotationsAt: (pageIndex: number, indices: number[]) =>
    session.removeAnnotationsAt(pageIndex, indices),
  moveObjects: (pageIndex: number, paths: number[][], dx: number, dy: number) =>
    session.moveObjects(pageIndex, paths, dx, dy),
  apply: (placements: Placement[]) => session.apply(placements),

  rotate: (pageIndex: number, quarterTurns: number) => session.rotate(pageIndex, quarterTurns),
  deletePages: (indices: number[]) => session.deletePages(indices),
  movePages: (indices: number[], destination: number) => session.movePages(indices, destination),
  insertBlankPage: (atIndex: number) => session.insertBlankPage(atIndex),

  // --- History -----------------------------------------------------------

  undo: () => session.undo(),
  redo: () => session.redo(),
  historyState: () => session.historyState(),

  // --- Output ------------------------------------------------------------

  save: () => {
    const bytes = session.save();
    return Comlink.transfer(bytes, [bytes.buffer]);
  },

  extract: (indices: number[]) => {
    const bytes = session.extract(indices);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
};

export type EngineApi = typeof api;

Comlink.expose(api);
