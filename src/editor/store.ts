import { create } from 'zustand';
import type { MarkShape, MarkWeight } from '@/engine/marks';
import type {
  Badge,
  DocumentInfo,
  Placement,
  Rect,
  Rgba,
  SignatureCandidate,
  TextLine,
} from '@/engine/types';

/**
 * Editor state.
 *
 * The document itself lives in the worker; this holds only what the UI needs
 * to decide what to draw. The one substantial piece of state here is the
 * overlay: additions the user has placed but not yet committed to the file.
 *
 * Keeping additions out of the document until "apply" is what makes them
 * freely draggable. Round-tripping every nudge of a signature through PDFium
 * would mean a content-stream regeneration and a re-render per mouse move.
 */

export type Tool = 'select' | 'edit-text' | 'add-text' | 'mark' | 'signature' | 'image' | 'cover';

/** An addition the user has placed but not yet written into the document. */
export interface OverlayItem {
  id: string;
  page: number;
  /** Position in PDF points, y-up. Stored in PDF space so zoom is free. */
  rect: Rect;
  kind: 'signature' | 'image' | 'text' | 'cover' | 'mark';
  /** For signature and image: RGBA pixels plus their dimensions. */
  bitmap?: { data: Uint8ClampedArray; width: number; height: number };
  /** For text. */
  text?: string;
  fontSize?: number;
  fontKey?: string;
  colour?: Rgba;
  /** For a mark: which one, and how heavy its stroke. */
  shape?: MarkShape;
  weight?: MarkWeight;
  /** Preserve aspect ratio while resizing. True for signatures and images. */
  lockAspect?: boolean;
}

/** What the Select tool is holding. */
export interface Selection {
  page: number;
  paths: number[][];
  label: string;
  /** `ObjType` of the object hit, when a single one was clicked. */
  type?: number;
  /** Its bounds in PDF points, for the properties panel. */
  bounds?: Rect;
}

export interface SavedSignature {
  id: string;
  label: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface Notice {
  id: string;
  kind: Badge['kind'] | 'error' | 'info';
  message: string;
}

interface EditorState {
  // Document
  fileName: string | null;
  info: DocumentInfo | null;
  dirty: boolean;
  loading: boolean;

  // View
  zoom: number;
  fitMode: 'width' | 'page' | 'custom';
  currentPage: number;

  // Tools
  tool: Tool;
  /**
   * The mark the Mark tool will place.
   *
   * Kept on the store rather than in the rail, because a form is filled in by
   * putting the same mark in twenty boxes and re-picking it each time would be
   * the whole cost of the feature.
   */
  markShape: MarkShape;
  markWeight: MarkWeight;
  markColour: Rgba;
  /**
   * The current selection.
   *
   * Several paths, not one: clicking a line of text selects every object that
   * draws it, because a visual line is often many text objects and dragging
   * one of them would tear the line apart.
   *
   * `type` and `bounds` are carried so the properties panel can say what was
   * picked — a shape, an image, a line of text — without a second round trip
   * to the worker for something the hit test already knew.
   */
  selection: Selection | null;
  editingLine: TextLine | null;
  overlay: OverlayItem[];
  selectedOverlayId: string | null;

  // Signatures
  signatures: SignatureCandidate[];
  savedSignatures: SavedSignature[];

  // Feedback
  notices: Notice[];
  history: {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
  };

  // Actions
  setDocument(fileName: string, info: DocumentInfo): void;
  clearDocument(): void;
  setLoading(loading: boolean): void;
  setInfo(info: DocumentInfo): void;
  markDirty(): void;
  markClean(): void;

  setZoom(zoom: number, fitMode?: EditorState['fitMode']): void;
  setFitMode(mode: EditorState['fitMode']): void;
  setCurrentPage(page: number): void;

  setTool(tool: Tool): void;
  /**
   * Change the mark style.
   *
   * One action for both jobs it has to do: set what the next mark will be, and
   * restyle the mark already selected. Splitting them would mean two identical
   * pickers on screen — one governing the next mark and one the current — with
   * nothing to tell them apart.
   */
  setMarkStyle(patch: { shape?: MarkShape; weight?: MarkWeight; colour?: Rgba }): void;
  setSelection(selection: EditorState['selection']): void;
  setEditingLine(line: TextLine | null): void;

  /**
   * Place a pending addition.
   *
   * `select` is false for a mark. Everything else placed here wants selecting
   * — a text box has to take the caret, a signature is placed roughly and then
   * dragged — but a mark is a stamp: you drop it and drop the next one. Left
   * selected, it also made the mark palette ambiguous, because picking the
   * next shape would restyle the one just placed instead of arming the tool,
   * so a cross followed by a tick produced two ticks.
   */
  addOverlay(item: OverlayItem, select?: boolean): void;
  updateOverlay(id: string, patch: Partial<OverlayItem>): void;
  removeOverlay(id: string): void;
  clearOverlay(): void;
  selectOverlay(id: string | null): void;

  setSignatures(candidates: SignatureCandidate[]): void;
  saveSignature(signature: SavedSignature): void;
  /** Load a stored set, replacing whatever is held. */
  replaceSignatures(signatures: SavedSignature[]): void;
  deleteSavedSignature(id: string): void;

  notify(kind: Notice['kind'], message: string): void;
  notifyBadges(badges: Badge[]): void;
  dismissNotice(id: string): void;
  setHistory(state: EditorState['history']): void;
}

let noticeSeq = 0;
let overlaySeq = 0;

export const nextOverlayId = () => `ov${++overlaySeq}`;

export const useEditor = create<EditorState>((set) => ({
  fileName: null,
  info: null,
  dirty: false,
  loading: false,

  zoom: 1,
  fitMode: 'width',
  currentPage: 0,

  tool: 'select',
  markShape: 'cross',
  markWeight: 'medium',
  markColour: { r: 0, g: 0, b: 0, a: 255 },
  selection: null,
  editingLine: null,
  overlay: [],
  selectedOverlayId: null,

  signatures: [],
  savedSignatures: [],

  notices: [],
  history: { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null },

  setDocument: (fileName, info) =>
    set({
      fileName,
      info,
      dirty: false,
      currentPage: 0,
      overlay: [],
      selectedOverlayId: null,
      selection: null,
      editingLine: null,
      signatures: [],
      notices: [],
    }),

  clearDocument: () =>
    set({
      fileName: null,
      info: null,
      dirty: false,
      overlay: [],
      selection: null,
      editingLine: null,
      signatures: [],
      notices: [],
    }),

  setLoading: (loading) => set({ loading }),
  setInfo: (info) => set({ info }),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),

  setZoom: (zoom, fitMode = 'custom') => set({ zoom: Math.min(8, Math.max(0.1, zoom)), fitMode }),
  setFitMode: (fitMode) => set({ fitMode }),
  setCurrentPage: (currentPage) => set({ currentPage }),

  setTool: (tool) =>
    // Switching tools abandons an in-progress text edit rather than leaving an
    // invisible editor capturing keystrokes.
    set({ tool, editingLine: null, selection: null, selectedOverlayId: null }),

  setMarkStyle: (patch) =>
    set((s) => {
      const markShape = patch.shape ?? s.markShape;
      const markWeight = patch.weight ?? s.markWeight;
      const markColour = patch.colour ?? s.markColour;

      const selected = s.overlay.find((o) => o.id === s.selectedOverlayId);
      if (!selected || selected.kind !== 'mark') {
        return { markShape, markWeight, markColour };
      }

      return {
        markShape,
        markWeight,
        markColour,
        overlay: s.overlay.map((o) =>
          o.id === selected.id
            ? {
                ...o,
                shape: markShape,
                weight: markWeight,
                colour: markColour,
                // A rule is meant to be stretched; the rest are not.
                lockAspect: markShape !== 'line',
              }
            : o,
        ),
        dirty: true,
      };
    }),

  setSelection: (selection) => set({ selection }),
  setEditingLine: (editingLine) => set({ editingLine }),

  addOverlay: (item, select = true) =>
    set((s) => ({
      overlay: [...s.overlay, item],
      selectedOverlayId: select ? item.id : null,
      dirty: true,
    })),

  updateOverlay: (id, patch) =>
    set((s) => ({
      overlay: s.overlay.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      dirty: true,
    })),

  removeOverlay: (id) =>
    set((s) => ({
      overlay: s.overlay.filter((o) => o.id !== id),
      selectedOverlayId: s.selectedOverlayId === id ? null : s.selectedOverlayId,
      dirty: true,
    })),

  clearOverlay: () => set({ overlay: [], selectedOverlayId: null }),
  selectOverlay: (selectedOverlayId) => set({ selectedOverlayId }),

  setSignatures: (signatures) => set({ signatures }),

  saveSignature: (signature) =>
    set((s) => ({ savedSignatures: [...s.savedSignatures, signature] })),

  replaceSignatures: (savedSignatures) => set({ savedSignatures }),

  deleteSavedSignature: (id) =>
    set((s) => ({ savedSignatures: s.savedSignatures.filter((x) => x.id !== id) })),

  notify: (kind, message) =>
    set((s) => {
      // Repeating an identical notice adds nothing and pushes the rest out of
      // view, so an existing one is kept instead.
      if (s.notices.some((n) => n.message === message)) return s;
      return { notices: [...s.notices, { id: `n${++noticeSeq}`, kind, message }] };
    }),

  notifyBadges: (badges) =>
    set((s) => {
      const fresh = badges
        .filter((b) => !s.notices.some((n) => n.message === b.message))
        .map((b) => ({ id: `n${++noticeSeq}`, kind: b.kind, message: b.message }));
      return fresh.length > 0 ? { notices: [...s.notices, ...fresh] } : s;
    }),

  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  setHistory: (history) => set({ history }),
}));

/** Overlay items belonging to one page. */
export function overlayForPage(overlay: OverlayItem[], page: number): OverlayItem[] {
  return overlay.filter((o) => o.page === page);
}

/** Convert overlay items into engine placements for a commit. */
export function toPlacements(overlay: OverlayItem[]): Placement[] {
  const out: Placement[] = [];

  for (const item of overlay) {
    if ((item.kind === 'signature' || item.kind === 'image') && item.bitmap) {
      out.push({
        type: 'image',
        page: item.page,
        rect: item.rect,
        data: item.bitmap.data,
        pixelWidth: item.bitmap.width,
        pixelHeight: item.bitmap.height,
      });
    } else if (item.kind === 'mark' && item.shape) {
      out.push({
        type: 'path',
        page: item.page,
        rect: item.rect,
        shape: item.shape,
        weight: item.weight ?? 'medium',
        colour: item.colour ?? { r: 0, g: 0, b: 0, a: 255 },
      });
    } else if (item.kind === 'cover') {
      out.push({
        type: 'rect',
        page: item.page,
        rect: item.rect,
        colour: item.colour ?? { r: 255, g: 255, b: 255, a: 255 },
      });
    } else if (item.kind === 'text' && item.text) {
      out.push({
        type: 'text',
        page: item.page,
        // Text is drawn from its baseline, which sits above the box's bottom
        // edge by roughly the descender depth.
        x: item.rect.left,
        y: item.rect.bottom + (item.fontSize ?? 12) * 0.2,
        text: item.text,
        fontSize: item.fontSize ?? 12,
        colour: item.colour ?? { r: 0, g: 0, b: 0, a: 255 },
        fontKey: item.fontKey ?? 'sans',
      });
    }
  }

  return out;
}
