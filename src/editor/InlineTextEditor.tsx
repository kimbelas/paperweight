'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { Rect, Rgba } from '@/engine/types';
import { useMediaQuery } from './media';
import { pdfRectToCss, type PageTransform } from './transform';

/**
 * The inline text editor.
 *
 * It sits directly on top of the line being edited, at the same size and in
 * the closest available typeface, over an opaque patch that hides the
 * original. The effect is that the document itself becomes editable, which is
 * the interaction every established PDF editor uses and the one users expect.
 *
 * The patch is necessary rather than decorative: the page underneath is a
 * bitmap, so without it the old and new text would be visible at once.
 *
 * It takes plain values rather than a line object because it serves two
 * sources — real text objects and lines recovered from a scan by OCR — which
 * share no type. Everything it needs is geometry, size and colour.
 */

/**
 * Smallest the editor's type is drawn at on a touch screen, in CSS pixels.
 *
 * Sitting at the document's own size is right on a desktop and unusable on a
 * phone: a 9pt field at the 56% zoom that fits a page to a 390px screen is
 * six pixels of type in a six-pixel box. Tapping a field looked like nothing
 * had happened at all — the editor was open, focused and selected, and simply
 * too small to see.
 *
 * 16px rather than merely bigger, because that is also the size below which
 * mobile Safari zooms the whole viewport in when an input takes focus. Under
 * the floor the page lurched; over it, it does not.
 *
 * The box grows in *height* to hold the larger type and keeps the document's
 * width. Scaling the width too was the obvious thing and it is wrong: a 210pt
 * field magnified three times is wider than a phone, so focusing it dragged
 * the whole document sideways and left the form's own labels off the screen.
 * The width is the one dimension that has to stay honest anyway — it is what
 * the resize handle sets and what a value is clipped by.
 *
 * The value is therefore no longer as wide, relative to its box, as the page
 * will draw it, so the overflow question cannot be asked of the input any
 * more. `probeRef` answers it instead: the same string, laid out in the same
 * face at the *document's* size, off to one side and hidden.
 */
const MIN_TOUCH_TYPE_PX = 16;

/** A finger rather than a mouse, so there is a soft keyboard in play. */
const COARSE_POINTER = '(pointer: coarse)';

interface InlineTextEditorProps {
  text: string;
  /** The line's box in PDF points. */
  bounds: Rect;
  /** Size as rendered on the page, in points. */
  fontSize: number;
  serif?: boolean;
  mono?: boolean;
  bold?: boolean;
  italic?: boolean;
  colour: Rgba;
  /** What pressing Enter will do, which differs for a scan. */
  hint: string;
  transform: PageTransform;
  zoom: number;
  /**
   * Let the box be widened by dragging its right edge.
   *
   * Only a form field can do this. A field clips its own appearance to its
   * rectangle, so a value wider than the box is cut off in the file itself,
   * and the width is a property of the document rather than of the view. A
   * line of page text has no such box: it simply runs on.
   */
  resizable?: boolean;
  /** Widest the box may become, in points. Stops it running off the page. */
  maxWidth?: number;
  /** Narrowest useful box, in points. */
  minWidth?: number;
  /** The committed width, in points, when it was changed. */
  onCommit: (text: string, width?: number) => void | Promise<void>;
  onCancel: () => void;
}

export function InlineTextEditor({
  text,
  bounds,
  fontSize,
  serif,
  mono,
  bold,
  italic,
  colour,
  hint,
  transform,
  zoom,
  resizable,
  maxWidth,
  minWidth = 24,
  onCommit,
  onCancel,
}: InlineTextEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(text);
  const [busy, setBusy] = useState(false);
  const coarse = useMediaQuery(COARSE_POINTER);

  const originalWidth = bounds.right - bounds.left;
  /** Width in points. Undefined until the user actually changes it. */
  const [width, setWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const shownWidth = width ?? originalWidth;
  // The editor is drawn at the width being edited, so dragging the handle
  // shows the box the value will actually get.
  const box = pdfRectToCss(transform, { ...bounds, right: bounds.left + shownWidth });

  /** The size the page draws this line at, in CSS pixels. */
  const pageType = fontSize * zoom;
  /** The size the editor draws it at: the same, unless it is too small to use. */
  const typeSize = coarse ? Math.max(pageType, MIN_TOUCH_TYPE_PX) : pageType;
  /** Extra height the larger type needs. The width is left alone; see above. */
  const grow = Math.max(0, typeSize - pageType);

  /** CSS pixels per PDF point, taken from the box itself. */
  const scale = box.width / Math.max(shownWidth, 0.001);

  /**
   * Does the value overrun the box?
   *
   * Measured from a hidden copy laid out at the size the *page* draws, which
   * is the width the question is about — the visible input may be showing
   * larger type on a touch screen. The face is metric compatible with the
   * base-14 font a form's `/DA` almost always names, so it answers what the
   * user is asking — will this be cut off — without a round trip to the
   * engine on every keystroke. The engine still has the last word when the
   * value is committed.
   */
  useLayoutEffect(() => {
    if (!resizable) return;
    const probe = probeRef.current;
    if (!probe) return;
    setClipped(probe.getBoundingClientRect().width > box.width + 1);
  }, [value, resizable, box.width]);

  const clampWidth = (points: number): number => {
    const ceiling = maxWidth ?? Number.POSITIVE_INFINITY;
    return Math.min(Math.max(points, minWidth), ceiling);
  };

  /** Widen just enough for the text as it is currently laid out. */
  const fitToText = () => {
    const probe = probeRef.current;
    if (!probe) return;
    const needed = (probe.getBoundingClientRect().width + 4) / scale;
    setWidth(clampWidth(Math.ceil(needed)));
    inputRef.current?.focus();
  };

  // A little breathing room so ascenders and descenders of the replacement
  // are not clipped by the patch, and so the patch fully covers the original.
  const pad = Math.max(2, typeSize * 0.18);

  const widthChanged = width !== null && Math.round(width) !== Math.round(originalWidth);

  const submit = async () => {
    if (busy) return;
    if (value === text && !widthChanged) {
      onCancel();
      return;
    }
    setBusy(true);
    try {
      await onCommit(value, widthChanged ? width! : undefined);
    } finally {
      setBusy(false);
    }
  };

  /** The editor's own height: the line's, plus whatever larger type needs. */
  const height = box.height + grow + pad * 2;

  return (
    <div
      className="absolute"
      style={{
        left: box.left - pad,
        // Grown about its own middle, so the line stays where it was pointed at.
        top: box.top - pad - grow / 2,
        width: Math.max(box.width + pad * 2, 32),
        height,
      }}
    >
      {/* The patch hiding the original line. */}
      <div
        className="absolute inset-0"
        style={{ background: '#ffffff', outline: '1.5px solid var(--app-accent)' }}
      />

      {/*
        The value at the size the page draws it, for measuring only. Kept out
        of the accessibility tree and out of the way: what it is for is the
        width the document would give this string, which the visible input
        stops reporting the moment its type is floored for touch.
      */}
      <span
        ref={probeRef}
        aria-hidden
        className="pointer-events-none absolute whitespace-pre"
        style={{
          visibility: 'hidden',
          left: 0,
          top: 0,
          fontSize: pageType,
          fontFamily: cssFontFamily({ serif, mono }),
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? 'italic' : 'normal',
        }}
      >
        {value}
      </span>

      <input
        ref={inputRef}
        className="text-edit-input absolute inset-0"
        style={{
          paddingLeft: pad,
          paddingRight: pad,
          fontSize: typeSize,
          fontFamily: cssFontFamily({ serif, mono }),
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? 'italic' : 'normal',
          color: `rgba(${colour.r}, ${colour.g}, ${colour.b}, ${colour.a / 255})`,
          // The box is the ink height plus padding; matching line-height to it
          // keeps the caret and text vertically where the original sat.
          lineHeight: `${height}px`,
          opacity: busy ? 0.5 : 1,
        }}
        value={value}
        disabled={busy}
        spellCheck={false}
        aria-label="Edit this line of text"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          // Arrow keys and Home/End must reach the input rather than reaching
          // the shell's shortcuts or scrolling the page behind it.
          event.stopPropagation();
        }}
        onBlur={() => void submit()}
      />

      {resizable && (
        <>
          {/*
            The right edge, draggable. `preventDefault` on pointer down is
            load-bearing: without it the press moves focus out of the input,
            the blur handler commits, and the editor closes the instant a
            resize begins.
          */}
          <div
            role="separator"
            aria-label="Drag to change the field width"
            aria-orientation="vertical"
            title="Drag to widen the field so long values are not cut off"
            className="absolute"
            style={{
              top: 0,
              bottom: 0,
              right: -4,
              width: 10,
              cursor: 'ew-resize',
              background: resizing ? 'var(--app-accent)' : 'transparent',
              borderRight: `3px solid var(--app-accent)`,
              opacity: resizing ? 1 : 0.8,
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();

              const startX = event.clientX;
              const startWidth = shownWidth;
              const handle = event.currentTarget;
              handle.setPointerCapture(event.pointerId);
              setResizing(true);

              const move = (moveEvent: PointerEvent) => {
                setWidth(clampWidth(startWidth + (moveEvent.clientX - startX) / scale));
              };
              const done = () => {
                setResizing(false);
                handle.releasePointerCapture(event.pointerId);
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', done);
                handle.removeEventListener('pointercancel', done);
                inputRef.current?.focus();
              };

              handle.addEventListener('pointermove', move);
              handle.addEventListener('pointerup', done);
              handle.addEventListener('pointercancel', done);
            }}
          />
        </>
      )}

      {/*
        Anchored above the box rather than at a fixed offset, and allowed to
        wrap: on a phone the hint is wider than the screen, and held on one
        line it ran off the right-hand edge with the half that says what Enter
        does out of sight.
      */}
      <div
        className="absolute flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px]"
        style={{
          bottom: '100%',
          left: 0,
          marginBottom: 4,
          maxWidth: 'min(80vw, 460px)',
          background: 'var(--app-accent)',
          color: '#fff',
        }}
      >
        <span className="pointer-events-none">
          {busy
            ? 'Applying…'
            : resizing || widthChanged
              ? `${Math.round(shownWidth)} pt wide · ${hint}`
              : hint}
        </span>

        {resizable && clipped && !busy && (
          <button
            type="button"
            // Same reason as the drag handle: keep focus in the input so the
            // blur handler does not commit before the width is applied.
            onPointerDown={(event) => event.preventDefault()}
            onClick={fitToText}
            className="rounded px-1 font-semibold underline"
            style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', cursor: 'pointer' }}
            title="Widen the field so the whole value is drawn"
          >
            Widen to fit
          </button>
        )}
      </div>

      {resizable && clipped && !busy && (
        <div
          className="pointer-events-none absolute rounded px-1.5 py-0.5 text-[11px]"
          style={{
            top: '100%',
            left: 0,
            marginTop: 4,
            maxWidth: 'min(80vw, 460px)',
            background: '#9a3412',
            color: '#fff',
          }}
        >
          Wider than the field — this will be cut off when printed
        </div>
      )}
    </div>
  );
}

/**
 * A CSS stack approximating the document's font.
 *
 * Only the category is reproduced — serif, sans or mono — because the actual
 * embedded font is not installed on the viewer's system and cannot be relied
 * on. This is a preview while typing; the committed result uses the real
 * embedded font or a metric-compatible substitute.
 */
function cssFontFamily({ serif, mono }: { serif?: boolean; mono?: boolean }): string {
  if (mono) return '"Liberation Mono", "Courier New", monospace';
  if (serif) return '"Liberation Serif", "Times New Roman", serif';
  return '"Liberation Sans", Arial, Helvetica, sans-serif';
}
