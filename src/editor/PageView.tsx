'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ObjType } from '@/engine/constants';
import { unionRect } from '@/engine/memory';
import { formFieldPhrase } from '@/engine/form-label';
import { MARKS, type MarkShape } from '@/engine/marks';
import { objectTypeName } from '@/engine/objects';
import type { FormFieldInfo, PageInfo, PageObject, Rect, TextLine } from '@/engine/types';
import type { OcrLine } from '@/ocr/recognise';
import { ocrLineAt } from '@/ocr/useOcr';
import { ContextMenu, type MenuEntry, type MenuRequest } from './ContextMenu';
import {
  IconAddText,
  IconCopy,
  IconCover,
  IconEditText,
  IconEraser,
  IconField,
  IconMark,
  IconRotate,
  IconSelect,
  IconTick,
  IconTrash,
  IconUntick,
  IconWiden,
} from './Icons';
import { toImageData } from './imageData';
import { InlineTextEditor } from './InlineTextEditor';
import { OverlayLayer } from './OverlayLayer';
import { nextOverlayId, useEditor } from './store';
import {
  cssDeltaToPdf,
  cssRectToPdf,
  measureTransform,
  pdfRectToCss,
  type PageTransform,
} from './transform';
import type { Engine } from './useEngine';

/**
 * One page: the rendered bitmap plus every interaction layer over it.
 *
 * The canvas is a picture, so everything interactive is a DOM element
 * positioned on top of it from PDF-space geometry. Nothing here stores screen
 * coordinates — they are derived at render time — which is what keeps zooming
 * and page rotation from needing any special handling.
 */

interface PageViewProps {
  engine: Engine;
  page: PageInfo;
  /** CSS pixels per PDF point. */
  zoom: number;
  /** Bumped by the shell whenever this page's content changed. */
  renderToken: number;
  /** Recognised lines, for a page that has no text of its own. */
  ocrLines: OcrLine[];
  onCommitText: (page: number, lineId: string, text: string) => Promise<void>;
  onCommitOcr: (line: OcrLine, text: string) => Promise<void>;
  onCommitField: (field: FormFieldInfo, text: string, width?: number) => Promise<void>;
  onToggleField: (field: FormFieldInfo) => Promise<void>;
  onMoveSelection: (page: number, paths: number[][], dx: number, dy: number) => Promise<void>;
  /** Delete named objects outright, without selecting them first. */
  onDeleteObjects: (page: number, paths: number[][]) => Promise<void>;
  /** Widen a field to hold its current value. */
  onWidenField: (field: FormFieldInfo) => Promise<void>;
  /** Remove a field's widget from the page entirely. */
  onDeleteField: (field: FormFieldInfo) => Promise<void>;
  onRotatePage: (page: number) => void;
}

/**
 * What the Edit text tool is working on.
 *
 * Three sources, because a PDF can hold text in three unrelated ways: as an
 * object in the page's content stream, as the value of a form field, and as
 * pixels a recogniser has read. They are edited by different engine calls and
 * the interface has to say which one is in play, so they stay distinct rather
 * than being flattened into one shape.
 */
type EditTarget =
  | { kind: 'text'; line: TextLine }
  | { kind: 'ocr'; line: OcrLine }
  | { kind: 'field'; field: FormFieldInfo };

/**
 * Anything the right-click menu can be opened on.
 *
 * A superset of `EditTarget`: a path or an image is not editable by any tool
 * here, but it is very much something a user points at and expects an answer
 * about — the tick drawn into a checkbox, a rule, a logo, a stray mark.
 */
type PageHit = EditTarget | { kind: 'object'; object: PageObject };

/** The box to outline for a target, wherever its geometry lives. */
function targetBounds(target: EditTarget): Rect {
  return target.kind === 'field' ? target.field.rect : target.line.bounds;
}

export function PageView({
  engine,
  page,
  zoom,
  renderToken,
  ocrLines,
  onCommitText,
  onCommitOcr,
  onCommitField,
  onToggleField,
  onMoveSelection,
  onDeleteObjects,
  onWidenField,
  onDeleteField,
  onRotatePage,
}: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<PageTransform | null>(null);
  const [rendering, setRendering] = useState(true);
  const [hover, setHover] = useState<Rect | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [ocrTarget, setOcrTarget] = useState<OcrLine | null>(null);
  const [fieldTarget, setFieldTarget] = useState<FormFieldInfo | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);

  const tool = useEditor((s) => s.tool);
  const editingLine = useEditor((s) => s.editingLine);
  const setEditingLine = useEditor((s) => s.setEditingLine);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const overlay = useEditor((s) => s.overlay);
  const addOverlay = useEditor((s) => s.addOverlay);
  const removeOverlay = useEditor((s) => s.removeOverlay);
  const notify = useEditor((s) => s.notify);
  const selectOverlay = useEditor((s) => s.selectOverlay);
  const setTool = useEditor((s) => s.setTool);
  const markShape = useEditor((s) => s.markShape);
  const markWeight = useEditor((s) => s.markWeight);
  const markColour = useEditor((s) => s.markColour);

  const cssWidth = Math.round(page.width * zoom);
  const cssHeight = Math.round(page.height * zoom);

  const pageOverlay = useMemo(
    () => overlay.filter((o) => o.page === page.index),
    [overlay, page.index],
  );

  const editTarget: EditTarget | null = fieldTarget
    ? { kind: 'field', field: fieldTarget }
    : ocrTarget
      ? { kind: 'ocr', line: ocrTarget }
      : editingLine && editingLine.page === page.index
        ? { kind: 'text', line: editingLine }
        : null;

  // --- Rendering ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const dpr = window.devicePixelRatio || 1;
    setRendering(true);

    (async () => {
      try {
        const rendered = await engine.renderPage(page.index, {
          scale: zoom * dpr,
          annotations: true,
        });
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = rendered.width;
        canvas.height = rendered.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.putImageData(toImageData(rendered.data, rendered.width, rendered.height), 0, 0);
        setRendering(false);
      } catch (error) {
        if (cancelled) return;
        setRendering(false);
        notify('error', describe(error, `Page ${page.index + 1} could not be displayed.`));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [engine, page.index, zoom, renderToken, notify]);

  useEffect(() => {
    let cancelled = false;
    measureTransform(engine, page.index, cssWidth, cssHeight)
      .then((t) => {
        if (!cancelled) setTransform(t);
      })
      .catch(() => {
        /* A failed measure leaves overlays unplaced; the render error already
           told the user something is wrong with this page. */
      });
    return () => {
      cancelled = true;
    };
  }, [engine, page.index, cssWidth, cssHeight, page.rotation, renderToken]);

  // --- Interaction -------------------------------------------------------

  const localPoint = useCallback((event: React.PointerEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }, []);

  /**
   * Find whatever the Edit text tool would act on at this point.
   *
   * Form fields are asked first, because that hit test is exact -- a point is
   * either inside a widget's rectangle or it is not -- while the text hit
   * test falls back to the nearest line in the same horizontal band when
   * nothing sits directly under the cursor. On a form those two disagree in a
   * way that matters: the label "Surname (as shown in passport)" shares a
   * baseline with the box holding the answer, so a click on the value would
   * otherwise be resolved to the label and offer to edit the caption instead
   * of the field.
   *
   * Then real text objects, and recognised lines as the fallback. That order
   * matters on a scan that has already been edited once: patching a line adds
   * a genuine text object, and that object should then be edited properly
   * rather than painted over a second time. Gating on `isScanned` instead
   * meant one edit flipped the page to "has text" and left every remaining
   * recognised line unreachable.
   */
  const findEditable = useCallback(
    async (x: number, y: number): Promise<EditTarget | null> => {
      const field = await engine.formFieldAt(page.index, cssWidth, cssHeight, x, y);
      if (field) return { kind: 'field', field };

      const line = await engine.lineAt(page.index, cssWidth, cssHeight, x, y);
      if (line) return { kind: 'text', line };

      if (ocrLines.length === 0) return null;
      const point = await engine.toPagePoint(page.index, cssWidth, cssHeight, x, y);
      const recognised = ocrLineAt(ocrLines, point.x, point.y);
      return recognised ? { kind: 'ocr', line: recognised } : null;
    },
    [page.index, ocrLines, engine, cssWidth, cssHeight],
  );

  /**
   * Whatever is under a point, including things no tool edits.
   *
   * `findEditable` answers "what would the Edit text tool act on", which is
   * deliberately narrow. The right-click menu has to answer a wider question:
   * the tick drawn into a checkbox, a rule, a logo, a stray mark left by
   * whoever filled the form in are all things a user points at and expects an
   * offer for, and every one of them is a path or an image rather than text.
   *
   * The order is not the same as the text tool's, and the difference is the
   * whole reason those things are reachable at all. `hitTestLine` falls back
   * to the nearest line sharing the point's horizontal band, with no limit on
   * how far away in x that line may be — right for editing, because a click
   * in the gap between two words should still open the line. Here it is
   * wrong: a tick beside a "Yes" label sits squarely in that label's band, so
   * a menu built on the text hit first could never reach the tick, and the
   * only thing on offer would be to edit the caption.
   *
   * So an exact object hit wins, unless the point is genuinely inside the
   * line's own box — which is the gap-between-words case, and there the line
   * is what was meant.
   */
  const findAnything = useCallback(
    async (x: number, y: number): Promise<PageHit | null> => {
      const field = await engine.formFieldAt(page.index, cssWidth, cssHeight, x, y);
      if (field) return { kind: 'field', field };

      const [object, line, point] = await Promise.all([
        engine.objectAt(page.index, cssWidth, cssHeight, x, y),
        engine.lineAt(page.index, cssWidth, cssHeight, x, y),
        engine.toPagePoint(page.index, cssWidth, cssHeight, x, y),
      ]);

      const insideLine =
        line !== null &&
        point.x >= line.bounds.left &&
        point.x <= line.bounds.right &&
        point.y >= line.bounds.bottom &&
        point.y <= line.bounds.top;

      if (object && object.type !== ObjType.Text && !insideLine) {
        return { kind: 'object', object };
      }
      if (line) return { kind: 'text', line };
      if (object) return { kind: 'object', object };

      if (ocrLines.length === 0) return null;
      const recognised = ocrLineAt(ocrLines, point.x, point.y);
      return recognised ? { kind: 'ocr', line: recognised } : null;
    },
    [engine, page.index, cssWidth, cssHeight, ocrLines],
  );

  /**
   * Put a form field into the state a click on it should produce.
   *
   * A field is offered for editing whatever tool is armed. Clicking a box and
   * having it come alive is what every PDF viewer does, and demanding that the
   * right tool be picked first was the difference between "this app fills in
   * forms" and "this app does nothing when I click the form".
   */
  const activateField = useCallback(
    async (field: FormFieldInfo) => {
      setEditingLine(null);
      setOcrTarget(null);
      setSelection(null);
      selectOverlay(null);

      if (field.editable) {
        setFieldTarget(field);
      } else if (field.toggleable) {
        // A tick box has no text to type, so a click does what a click does in
        // any other viewer: it ticks it.
        await onToggleField(field);
      } else {
        notify('info', field.notEditableReason ?? 'This form field cannot be changed.');
      }
    },
    [setEditingLine, setSelection, selectOverlay, onToggleField, notify],
  );

  /** Select an object so it can be dragged or deleted. */
  const selectObject = useCallback(
    async (hit: PageObject, x: number, y: number) => {
      selectOverlay(null);

      // Text is selected a line at a time. A visual line is frequently several
      // text objects, and selecting only the one under the cursor would let a
      // drag pull a couple of words out of a sentence.
      if (hit.type === ObjType.Text) {
        const line = await engine.lineAt(page.index, cssWidth, cssHeight, x, y);
        if (line) {
          setSelection({
            page: page.index,
            paths: line.runs.map((r) => [...r.path]),
            label: line.text.trim().slice(0, 40) || 'Text',
            type: ObjType.Text,
            bounds: line.bounds,
          });
          return;
        }
      }

      setSelection({
        page: page.index,
        paths: [[...hit.path]],
        label: objectTypeName(hit.type),
        type: hit.type,
        bounds: hit.bounds,
      });
    },
    [engine, page.index, cssWidth, cssHeight, selectOverlay, setSelection],
  );

  /** Place an empty text box at a point on the page. */
  const addTextAt = useCallback(
    (x: number, y: number) => {
      if (!transform) return;
      const fontSize = 12;
      const boxHeight = fontSize * 1.6;
      addOverlay({
        id: nextOverlayId(),
        page: page.index,
        rect: cssRectToPdf(transform, {
          left: x,
          top: y - (boxHeight * zoom) / 2,
          width: 220 * zoom,
          height: boxHeight * zoom,
        }),
        kind: 'text',
        text: '',
        fontSize,
        fontKey: 'sans',
        colour: { r: 0, g: 0, b: 0, a: 255 },
      });
    },
    [transform, page.index, addOverlay, zoom],
  );

  /**
   * Put a mark at a point, at the size it is normally drawn.
   *
   * Centred on the click rather than starting from it: a mark goes *into*
   * something — a printed box, a blank on a line — and aiming at the middle of
   * that thing is what a hand does with a pen.
   */
  const placeMark = useCallback(
    (x: number, y: number, shape: MarkShape) => {
      if (!transform) return;
      const def = MARKS[shape];
      const height = def.size;
      const width = def.size * def.aspect;

      addOverlay(
        {
          id: nextOverlayId(),
          page: page.index,
          rect: cssRectToPdf(transform, {
            left: x - (width * zoom) / 2,
            top: y - (height * zoom) / 2,
            width: width * zoom,
            height: height * zoom,
          }),
          kind: 'mark',
          shape,
          weight: markWeight,
          colour: markColour,
          // A stretched tick reads as a mistake; a rule is meant to be
          // stretched.
          lockAspect: shape !== 'line',
        },
        false,
      );
    },
    [transform, page.index, addOverlay, zoom, markWeight, markColour],
  );

  /**
   * Put a mark inside something already on the page.
   *
   * What the right-click offer on a printed checkbox uses. Working from the
   * object's own rectangle rather than from the click means the cross lands
   * centred and already the right size, which is the difference between one
   * gesture and a click followed by a drag and two resizes.
   */
  const placeMarkIn = useCallback(
    (rect: Rect, shape: MarkShape) => {
      const boxWidth = rect.right - rect.left;
      const boxHeight = rect.top - rect.bottom;
      const cx = (rect.left + rect.right) / 2;
      const cy = (rect.bottom + rect.top) / 2;

      // Inset a little, so a bold stroke stays inside the printed square
      // instead of sitting on top of its edges.
      const side = Math.max(4, Math.min(boxWidth, boxHeight) * 0.82);
      const width = shape === 'line' ? boxWidth : side;
      const height = shape === 'line' ? Math.max(2, boxWidth / MARKS.line.aspect) : side;

      addOverlay(
        {
          id: nextOverlayId(),
          page: page.index,
          rect: {
            left: cx - width / 2,
            right: cx + width / 2,
            bottom: cy - height / 2,
            top: cy + height / 2,
          },
          kind: 'mark',
          shape,
          weight: markWeight,
          colour: markColour,
          lockAspect: shape !== 'line',
        },
        false,
      );
    },
    [page.index, addOverlay, markWeight, markColour],
  );

  /**
   * Cover a rectangle of the page, sampling the ground behind it.
   *
   * Offered on anything the menu can identify, because "hide this" is the only
   * answer available for content that cannot be removed cleanly — a mark
   * inside a template, or pixels in a scan. It is not redaction and is never
   * described as such: the content underneath stays in the file.
   */
  const coverRect = useCallback(
    async (rect: Rect) => {
      let colour = { r: 255, g: 255, b: 255, a: 255 };
      try {
        colour = await engine.sampleBackground(page.index, rect);
      } catch {
        /* White is a reasonable default if sampling fails. */
      }
      addOverlay({ id: nextOverlayId(), page: page.index, rect, kind: 'cover', colour });
    },
    [engine, page.index, addOverlay],
  );

  const handleMove = useCallback(
    async (event: React.PointerEvent) => {
      if (editTarget || (tool !== 'edit-text' && tool !== 'select')) {
        if (hover) setHover(null);
        return;
      }
      const { x, y } = localPoint(event);
      try {
        if (tool === 'select') {
          // Only fields, not every object: this runs on each pointer move, and
          // asking the worker for the whole object list that often is a cost
          // the outline is not worth. A field is the one thing whose click
          // behaviour differs from the tool's, so it is the one worth marking.
          const field = await engine.formFieldAt(page.index, cssWidth, cssHeight, x, y);
          setHover(field ? field.rect : null);
          return;
        }
        const found = await findEditable(x, y);
        setHover(found ? targetBounds(found) : null);
      } catch {
        setHover(null);
      }
    },
    [tool, editTarget, hover, localPoint, findEditable, engine, page.index, cssWidth, cssHeight],
  );

  const handleClick = useCallback(
    async (event: React.MouseEvent) => {
      const { x, y } = localPoint(event);

      // Asked first, and for every tool. See `activateField`.
      if (tool === 'edit-text' || tool === 'select') {
        const field = await engine.formFieldAt(page.index, cssWidth, cssHeight, x, y);
        if (field) {
          await activateField(field);
          return;
        }
      }

      if (tool === 'edit-text') {
        const found = await findEditable(x, y);
        if (!found) {
          if (page.isScanned && ocrLines.length === 0) {
            // Only worth saying on a page that genuinely has no text at all.
            notify(
              'info',
              'This page is a picture, so there is no text to click. Read it first, using the panel on the left.',
            );
          }
          return;
        }

        if (found.kind === 'ocr') {
          setEditingLine(null);
          setFieldTarget(null);
          setOcrTarget(found.line);
        } else if (found.kind === 'field') {
          await activateField(found.field);
        } else if (!found.line.editable) {
          notify('info', found.line.notEditableReason ?? 'This text cannot be edited.');
        } else {
          setOcrTarget(null);
          setFieldTarget(null);
          setEditingLine(found.line);
        }
        return;
      }

      if (tool === 'select') {
        const hit = await engine.objectAt(page.index, cssWidth, cssHeight, x, y);
        if (!hit) {
          selectOverlay(null);
          setSelection(null);
          return;
        }
        await selectObject(hit, x, y);
        return;
      }

      if (tool === 'add-text') addTextAt(x, y);
      if (tool === 'mark') placeMark(x, y, markShape);
    },
    [
      tool,
      localPoint,
      findEditable,
      activateField,
      selectObject,
      addTextAt,
      placeMark,
      markShape,
      page.isScanned,
      page.index,
      ocrLines.length,
      notify,
      setEditingLine,
      engine,
      cssWidth,
      cssHeight,
      selectOverlay,
      setSelection,
    ],
  );

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notify('info', 'Copied to the clipboard.');
      } catch {
        // Denied permission, or an insecure context. Saying so is better than
        // a menu item that silently does nothing.
        notify('error', 'This browser would not let the page write to the clipboard.');
      }
    },
    [notify],
  );

  /**
   * What can be done to the thing under the cursor.
   *
   * Built from what was actually hit rather than from the armed tool, which is
   * the whole point of the menu: it is the one place the interface can say
   * "this is a tick box, and here is what a tick box can do" without the user
   * having to work out which tool to reach for first.
   *
   * Every destructive item says what it will leave behind, because in a PDF
   * that is not obvious and the difference matters. Covering something hides
   * it and keeps it in the file; deleting a text line removes the objects that
   * draw it; deleting a field takes away the box as well as the value.
   */
  const entriesFor = useCallback(
    (hit: PageHit | null, x: number, y: number): MenuEntry[] => {
      if (!hit) {
        return [
          { id: 'h', heading: `Page ${page.index + 1}` },
          {
            id: 'add-text',
            label: 'Add text here',
            icon: <IconAddText size={15} />,
            onSelect: () => {
              setTool('add-text');
              addTextAt(x, y);
            },
          },
          {
            id: 'cross-here',
            label: 'Put a cross here',
            icon: <IconMark size={15} />,
            onSelect: () => placeMark(x, y, 'cross'),
          },
          {
            id: 'tick-here',
            label: 'Put a tick here',
            icon: <IconTick size={15} />,
            onSelect: () => placeMark(x, y, 'tick'),
          },
          {
            id: 'cover',
            label: 'Cover an area',
            hint: 'Then drag out the patch',
            icon: <IconCover size={15} />,
            onSelect: () => setTool('cover'),
          },
          { id: 's1', separator: true },
          {
            id: 'rotate',
            label: 'Rotate this page 90°',
            icon: <IconRotate size={15} />,
            onSelect: () => onRotatePage(page.index),
          },
        ];
      }

      if (hit.kind === 'field') {
        const field = hit.field;
        const ticked = field.value !== '' && field.value !== 'Off';
        const entries: MenuEntry[] = [{ id: 'h', heading: formFieldPhrase(field) }];

        if (field.editable) {
          entries.push({
            id: 'edit',
            label: 'Edit this value',
            icon: <IconEditText size={15} />,
            onSelect: () => void activateField(field),
          });
          entries.push({
            id: 'widen',
            label: 'Widen to fit the value',
            hint: 'A field clips to its own box, so a longer value is cut off in the file',
            icon: <IconWiden size={15} />,
            onSelect: () => void onWidenField(field),
          });
          if (field.value !== '') {
            entries.push({
              id: 'clear',
              label: 'Clear this value',
              icon: <IconEraser size={15} />,
              onSelect: () => void onCommitField(field, ''),
            });
          }
        } else if (field.toggleable) {
          entries.push({
            id: 'toggle',
            label:
              field.kind === 'radio'
                ? 'Choose this option'
                : ticked
                  ? 'Untick this box'
                  : 'Tick this box',
            icon: ticked ? <IconUntick size={15} /> : <IconTick size={15} />,
            onSelect: () => void onToggleField(field),
          });
        } else {
          entries.push({
            id: 'locked',
            label: 'This field cannot be changed',
            hint: field.notEditableReason,
            icon: <IconField size={15} />,
            disabled: true,
            onSelect: () => {},
          });
        }

        entries.push({ id: 's1', separator: true });
        entries.push({
          id: 'cover',
          label: 'Cover this',
          hint: 'Hides it. The value stays in the file',
          icon: <IconCover size={15} />,
          onSelect: () => void coverRect(field.rect),
        });
        entries.push({
          id: 'delete',
          label: 'Delete this field',
          hint: 'Takes the box away as well as the value',
          icon: <IconTrash size={15} />,
          danger: true,
          onSelect: () => void onDeleteField(field),
        });
        return entries;
      }

      if (hit.kind === 'text') {
        const line = hit.line;
        const label = line.text.trim().slice(0, 40) || 'Text';
        return [
          { id: 'h', heading: label },
          {
            id: 'edit',
            label: 'Edit this text',
            disabled: !line.editable,
            hint: line.editable ? undefined : line.notEditableReason,
            icon: <IconEditText size={15} />,
            onSelect: () => {
              setOcrTarget(null);
              setFieldTarget(null);
              setEditingLine(line);
            },
          },
          {
            id: 'copy',
            label: 'Copy this text',
            icon: <IconCopy size={15} />,
            onSelect: () => void copyText(line.text),
          },
          {
            id: 'select',
            label: 'Select it',
            hint: 'Then drag it to move it',
            icon: <IconSelect size={15} />,
            onSelect: () =>
              setSelection({
                page: page.index,
                paths: line.runs.map((r) => [...r.path]),
                label,
                type: ObjType.Text,
                bounds: line.bounds,
              }),
          },
          { id: 's1', separator: true },
          {
            id: 'cover',
            label: 'Cover this',
            hint: 'Hides it. The text stays in the file',
            icon: <IconCover size={15} />,
            onSelect: () => void coverRect(line.bounds),
          },
          {
            id: 'delete',
            label: 'Delete this line',
            icon: <IconTrash size={15} />,
            danger: true,
            onSelect: () =>
              void onDeleteObjects(
                page.index,
                line.runs.map((r) => [...r.path]),
              ),
          },
        ];
      }

      if (hit.kind === 'ocr') {
        const line = hit.line;
        return [
          { id: 'h', heading: 'Read from the scan' },
          {
            id: 'edit',
            label: 'Replace these words',
            hint: 'Paints over the original and draws new text on top',
            icon: <IconEditText size={15} />,
            onSelect: () => {
              setEditingLine(null);
              setFieldTarget(null);
              setOcrTarget(line);
            },
          },
          {
            id: 'copy',
            label: 'Copy this text',
            icon: <IconCopy size={15} />,
            onSelect: () => void copyText(line.text),
          },
          { id: 's1', separator: true },
          {
            id: 'cover',
            label: 'Cover this',
            hint: 'The pixels stay in the file',
            icon: <IconCover size={15} />,
            onSelect: () => void coverRect(line.bounds),
          },
        ];
      }

      const object = hit.object;
      const name = objectTypeName(object.type);
      const lower = name.toLowerCase();
      return [
        { id: 'h', heading: name },
        // First, because a small empty shape on a form is overwhelmingly a
        // printed checkbox, and putting a mark in it is what the user came to
        // do. Sized and centred from the shape's own box, so it takes one
        // gesture rather than a click and three drags.
        {
          id: 'cross-in',
          label: 'Put a cross in this',
          icon: <IconMark size={15} />,
          onSelect: () => placeMarkIn(object.bounds, 'cross'),
        },
        {
          id: 'tick-in',
          label: 'Put a tick in this',
          icon: <IconTick size={15} />,
          onSelect: () => placeMarkIn(object.bounds, 'tick'),
        },
        { id: 's0', separator: true },
        {
          id: 'select',
          label: 'Select it',
          hint: 'Then drag it to move it',
          icon: <IconSelect size={15} />,
          onSelect: () => void selectObject(object, x, y),
        },
        {
          id: 'cover',
          label: 'Cover this',
          hint: `Hides it. The ${lower} stays in the file`,
          icon: <IconCover size={15} />,
          onSelect: () => void coverRect(object.bounds),
        },
        { id: 's1', separator: true },
        {
          id: 'delete',
          label: `Delete this ${lower}`,
          icon: <IconTrash size={15} />,
          danger: true,
          onSelect: () => void onDeleteObjects(page.index, [[...object.path]]),
        },
      ];
    },
    [
      page.index,
      setTool,
      addTextAt,
      onRotatePage,
      activateField,
      onWidenField,
      onCommitField,
      onToggleField,
      onDeleteField,
      onDeleteObjects,
      coverRect,
      copyText,
      selectObject,
      setSelection,
      setEditingLine,
      placeMark,
      placeMarkIn,
    ],
  );

  /**
   * Open the menu on whatever was right-clicked.
   */
  const handleContextMenu = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      const at = { x: event.clientX, y: event.clientY };

      // A pending addition is a different kind of thing from page content: it
      // is not in the file yet, so the offer is about the placement rather
      // than about the document.
      const placed = (event.target as HTMLElement | null)?.closest?.('[data-overlay-id]');
      const overlayId = placed?.getAttribute('data-overlay-id');
      if (overlayId) {
        const item = overlay.find((o) => o.id === overlayId);
        if (item) {
          setMenu({
            ...at,
            entries: [
              { id: 'h', heading: `Placed ${item.kind}` },
              {
                id: 'remove',
                label: `Remove this ${item.kind}`,
                hint: 'It has not been written into the file yet',
                icon: <IconTrash size={15} />,
                danger: true,
                onSelect: () => removeOverlay(item.id),
              },
            ],
          });
        }
        return;
      }

      const { x, y } = localPoint(event);
      let hit: PageHit | null = null;
      try {
        hit = await findAnything(x, y);
      } catch {
        /* Fall through to the page-level menu. */
      }

      setMenu({ ...at, entries: entriesFor(hit, x, y) });
    },
    [overlay, localPoint, findAnything, removeOverlay, entriesFor],
  );

  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;

  /** Drag out a cover rectangle. */
  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (tool !== 'cover' || !transform) return;
      event.preventDefault();
      const start = localPoint(event);
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        const box = canvasRef.current?.getBoundingClientRect();
        if (!box) return;
        const cx = moveEvent.clientX - box.left;
        const cy = moveEvent.clientY - box.top;
        setMarquee({
          x: Math.min(start.x, cx),
          y: Math.min(start.y, cy),
          w: Math.abs(cx - start.x),
          h: Math.abs(cy - start.y),
        });
      };

      const up = async () => {
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);

        const box = marqueeRef.current;
        setMarquee(null);
        if (!box || box.w < 4 || box.h < 4) return;

        const rect = cssRectToPdf(transform, {
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
        });

        // Sample the page behind the rectangle so a cover over a shaded cell
        // or a coloured band matches it, instead of leaving a white patch.
        let colour = { r: 255, g: 255, b: 255, a: 255 };
        try {
          colour = await engine.sampleBackground(page.index, rect);
        } catch {
          /* White is a reasonable default if sampling fails. */
        }

        addOverlay({ id: nextOverlayId(), page: page.index, rect, kind: 'cover', colour });
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [tool, transform, localPoint, engine, page.index, addOverlay],
  );

  const cursor =
    tool === 'edit-text'
      ? hover
        ? 'text'
        : 'default'
      : tool === 'select'
        ? hover
          ? 'text'
          : 'default'
        : tool === 'cover' || tool === 'add-text' || tool === 'mark'
          ? 'crosshair'
          : 'default';

  return (
    <div
      ref={wrapperRef}
      className="relative mx-auto"
      style={{ width: cssWidth, height: cssHeight }}
      data-page={page.index}
      onContextMenu={(event) => void handleContextMenu(event)}
    >
      <canvas
        ref={canvasRef}
        className="page-sheet block h-full w-full"
        style={{ cursor }}
        onClick={handleClick}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
        onPointerDown={handlePointerDown}
        aria-label={`Page ${page.index + 1}`}
      />

      {rendering && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span
            className="rounded px-2 py-1 text-xs"
            style={{ background: 'var(--app-panel)', color: 'var(--app-text-faint)' }}
          >
            Rendering…
          </span>
        </div>
      )}

      {/* Recognised lines, shown while the text tool is armed so it is obvious
          what can be clicked. Amber marks a line the recogniser was unsure
          about, which is the one worth checking before trusting it. */}
      {tool === 'edit-text' &&
        !editTarget &&
        transform &&
        ocrLines.map((line) => {
          const poor = line.confidence < 60;
          const accent = poor ? 'var(--app-warn)' : 'var(--app-accent)';
          return (
            <div
              key={line.id}
              className="pointer-events-none absolute rounded-sm"
              style={{
                ...boxStyle(transform, line.bounds, 1),
                outline: `1px dashed ${accent}`,
                background: `color-mix(in srgb, ${accent} 7%, transparent)`,
              }}
              title={
                poor ? `Read as "${line.text}" — low confidence` : `Read as "${line.text}"`
              }
            />
          );
        })}

      {/* Hover outline, so a click's target is visible before committing.
          Shown for Select too, where it marks the form fields — the one thing
          that tool treats differently from everything else on the page. */}
      {(tool === 'edit-text' || tool === 'select') && hover && !editTarget && transform && (
        <div
          className="pointer-events-none absolute rounded-sm"
          style={{
            ...boxStyle(transform, hover, 2),
            outline: '1.5px solid var(--app-accent)',
            background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
          }}
        />
      )}

      {selection && selection.page === page.index && transform && (
        <SelectionOutline
          engine={engine}
          transform={transform}
          page={page.index}
          paths={selection.paths}
          label={selection.label}
          renderToken={renderToken}
          onMove={(dx, dy) => onMoveSelection(page.index, selection.paths, dx, dy)}
        />
      )}

      {marquee && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
            border: '1px dashed var(--app-accent)',
            background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
          }}
        />
      )}

      {transform && <OverlayLayer items={pageOverlay} transform={transform} zoom={zoom} />}

      {editTarget?.kind === 'field' && transform && (
        <InlineTextEditor
          key={`field:${editTarget.field.name}`}
          text={editTarget.field.value}
          bounds={editTarget.field.rect}
          // A field declares no type size of its own, and its /DA may say 0,
          // meaning "auto". The widget's height is the honest guide to how
          // big the value will actually be drawn.
          fontSize={Math.min(
            14,
            Math.max(7, (editTarget.field.rect.top - editTarget.field.rect.bottom) * 0.6),
          )}
          colour={{ r: 0, g: 0, b: 0, a: 255 }}
          hint={`Enter to update ${formFieldPhrase(editTarget.field)} · Esc to cancel`}
          // A field's width is part of the document: it clips its own
          // appearance, so a value wider than the box is cut off in the file.
          resizable={editTarget.field.editable}
          maxWidth={page.width - 6 - editTarget.field.rect.left}
          transform={transform}
          zoom={zoom}
          onCancel={() => setFieldTarget(null)}
          onCommit={async (value, width) => {
            const field = editTarget.field;
            setFieldTarget(null);
            await onCommitField(field, value, width);
          }}
        />
      )}

      {editTarget && editTarget.kind !== 'field' && transform && (
        <InlineTextEditor
          key={editTarget.line.id}
          text={editTarget.line.text}
          bounds={editTarget.line.bounds}
          fontSize={
            editTarget.kind === 'ocr'
              ? editTarget.line.estimatedFontSize
              : editTarget.line.effectiveFontSize || editTarget.line.fontSize
          }
          serif={editTarget.kind === 'text' && editTarget.line.font.isSerif}
          mono={editTarget.kind === 'text' && editTarget.line.font.isFixedPitch}
          bold={editTarget.kind === 'text' && editTarget.line.font.isBold}
          italic={editTarget.kind === 'text' && editTarget.line.font.isItalic}
          colour={
            editTarget.kind === 'text' ? editTarget.line.colour : { r: 0, g: 0, b: 0, a: 255 }
          }
          hint={
            editTarget.kind === 'ocr'
              ? 'Enter to paint over and replace · Esc to cancel'
              : 'Enter to apply · Esc to cancel'
          }
          transform={transform}
          zoom={zoom}
          onCancel={() => {
            setEditingLine(null);
            setOcrTarget(null);
          }}
          onCommit={async (value) => {
            if (editTarget.kind === 'ocr') {
              const line = editTarget.line;
              setOcrTarget(null);
              await onCommitOcr(line, value);
            } else {
              const line = editTarget.line;
              setEditingLine(null);
              await onCommitText(page.index, line.id, value);
            }
          }}
        />
      )}

      {menu && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Absolute-position style for a PDF rect, optionally inflated. */
function boxStyle(t: PageTransform, rect: Rect, padCss = 0): React.CSSProperties {
  const box = pdfRectToCss(t, rect);
  return {
    left: box.left - padCss,
    top: box.top - padCss,
    width: box.width + padCss * 2,
    height: box.height + padCss * 2,
  };
}

/**
 * The selection outline, which doubles as the drag handle.
 *
 * Dragging the thing you just selected is the interaction people already know
 * from every other editor, so there is no separate move tool. The preview is a
 * CSS translate during the gesture and the document is only touched on
 * release: committing per mouse move would mean a content-stream regeneration
 * and a page re-render for every pixel of travel.
 */
function SelectionOutline({
  engine,
  transform,
  page,
  paths,
  label,
  renderToken,
  onMove,
}: {
  engine: Engine;
  transform: PageTransform;
  page: number;
  paths: number[][];
  label: string;
  renderToken: number;
  onMove: (dx: number, dy: number) => void | Promise<void>;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const key = paths.map((p) => p.join('.')).join('|');

  useEffect(() => {
    let cancelled = false;
    engine
      .objects(page)
      .then((objects) => {
        if (cancelled) return;
        const wanted = new Set(paths.map((p) => p.join('.')));
        const hit = objects.filter((o) => wanted.has(o.path.join('.')));
        // The union, so a line made of many objects gets one outline rather
        // than a box around each word.
        setRect(hit.length === 0 ? null : hit.map((o) => o.bounds).reduce(unionRect));
      })
      .catch(() => setRect(null));
    return () => {
      cancelled = true;
    };
  }, [engine, page, key, renderToken]);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startY = event.clientY;
      let last = { x: 0, y: 0 };

      const move = (moveEvent: PointerEvent) => {
        last = { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY };
        setDrag(last);
      };

      const up = () => {
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDrag(null);

        // Ignore a click that merely wobbled, so selecting something does not
        // nudge it a pixel and leave an undo entry behind.
        if (Math.hypot(last.x, last.y) < 3) return;
        const { dx, dy } = cssDeltaToPdf(transform, last.x, last.y);
        void onMove(dx, dy);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [transform, onMove],
  );

  if (!rect) return null;

  return (
    <div
      className="absolute"
      style={{
        ...boxStyle(transform, rect, 1),
        outline: '2px solid var(--app-selection)',
        outlineOffset: 1,
        cursor: 'move',
        background: drag ? 'color-mix(in srgb, var(--app-accent) 10%, transparent)' : 'transparent',
        transform: drag ? `translate(${drag.x}px, ${drag.y}px)` : undefined,
      }}
      onPointerDown={startDrag}
      role="group"
      aria-label={`Selected: ${label}. Drag to move.`}
    >
      <span
        className="pointer-events-none absolute whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]"
        style={{ top: -21, left: 0, background: 'var(--app-selection)', color: '#fff' }}
      >
        {drag ? 'Release to place' : 'Drag to move · Delete to remove'}
      </span>
    </div>
  );
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export { boxStyle };
