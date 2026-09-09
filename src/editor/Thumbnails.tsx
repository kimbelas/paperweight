'use client';

import { useEffect, useRef, useState } from 'react';
import type { DocumentInfo, PageInfo } from '@/engine/types';
import { ContextMenu, type MenuEntry, type MenuRequest } from './ContextMenu';
import { IconArrowDown, IconArrowUp, IconDownload, IconPlus, IconRotate, IconTrash } from './Icons';
import { toImageData } from './imageData';
import type { Engine } from './useEngine';

/**
 * The pages rail.
 *
 * On the right, opposite the actions rail: the left side is what you do to the
 * page, this side is which page you are on. Each thumbnail is a real render,
 * so it reflects edits as they are made.
 *
 * **Every thumbnail is drawn into an identical frame, and the page is fitted
 * inside it.** Sizing each one to a fixed *width* instead is the obvious
 * approach and it does not survive contact with real documents: a landscape
 * page, a page with a different crop box, or a single scan at a different size
 * then has a different footprint from its neighbours, and the rail reads as
 * broken rather than as an accurate picture of the file. Fitting into a shared
 * frame keeps every page on one centre line whatever its shape.
 *
 * The frame is also why `scrollbar-gutter` is reserved. Without it the rail is
 * ten pixels wider until it overflows and then ten narrower once a scrollbar
 * appears, so every thumbnail shifts sideways the moment a document is long
 * enough to scroll — which looks exactly like a misalignment bug and is one.
 */

const RAIL_WIDTH = 178;
const LIST_PAD = 10;
const CARD_PAD = 5;
const SCROLLBAR = 10;

/** The shared frame every page is fitted into. */
const FRAME_W = RAIL_WIDTH - SCROLLBAR - LIST_PAD * 2 - (CARD_PAD + 1) * 2;
const FRAME_H = Math.round(FRAME_W * 1.294);

/** The page's size on screen, fitted into the frame and never cropped. */
function fitted(page: PageInfo): { width: number; height: number } {
  const scale = Math.min(FRAME_W / page.width, FRAME_H / page.height);
  return {
    width: Math.max(1, Math.round(page.width * scale)),
    height: Math.max(1, Math.round(page.height * scale)),
  };
}

export interface PageActions {
  rotate: (page: number) => void;
  move: (page: number, to: number) => void;
  insertAfter: (page: number) => void;
  extract: (page: number) => void;
  remove: (page: number) => void;
}

interface ThumbnailsProps {
  engine: Engine;
  info: DocumentInfo;
  currentPage: number;
  renderTokens: Record<number, number>;
  onSelect: (page: number) => void;
  actions: PageActions;
}

export function Thumbnails({
  engine,
  info,
  currentPage,
  renderTokens,
  onSelect,
  actions,
}: ThumbnailsProps) {
  const [menu, setMenu] = useState<MenuRequest | null>(null);

  const openMenu = (event: React.MouseEvent, index: number) => {
    event.preventDefault();
    const last = info.pageCount - 1;

    const entries: MenuEntry[] = [
      { id: 'heading', heading: `Page ${index + 1} of ${info.pageCount}` },
      {
        id: 'rotate',
        label: 'Rotate 90°',
        icon: <IconRotate size={15} />,
        onSelect: () => actions.rotate(index),
      },
      {
        id: 'up',
        label: 'Move up',
        icon: <IconArrowUp size={15} />,
        disabled: index === 0,
        onSelect: () => actions.move(index, index - 1),
      },
      {
        id: 'down',
        label: 'Move down',
        icon: <IconArrowDown size={15} />,
        disabled: index === last,
        onSelect: () => actions.move(index, index + 1),
      },
      { id: 's1', separator: true },
      {
        id: 'insert',
        label: 'Insert a blank page after',
        icon: <IconPlus size={15} />,
        onSelect: () => actions.insertAfter(index),
      },
      {
        id: 'extract',
        label: 'Save this page as a PDF',
        icon: <IconDownload size={15} />,
        onSelect: () => actions.extract(index),
      },
      { id: 's2', separator: true },
      {
        id: 'delete',
        label: 'Delete this page',
        hint: info.pageCount === 1 ? 'A document must keep one page' : undefined,
        icon: <IconTrash size={15} />,
        danger: true,
        disabled: info.pageCount === 1,
        onSelect: () => actions.remove(index),
      },
    ];

    setMenu({ x: event.clientX, y: event.clientY, entries });
  };

  return (
    <>
      <aside
        className="shrink-0 overflow-y-auto"
        style={{
          width: RAIL_WIDTH,
          scrollbarGutter: 'stable',
          background: 'var(--app-panel)',
          borderLeft: '1px solid var(--app-border)',
        }}
        aria-label="Pages"
      >
        <h2
          className="sticky top-0 z-10 m-0 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide"
          style={{
            background: 'var(--app-panel)',
            borderBottom: '1px solid var(--app-border)',
            color: 'var(--app-text-faint)',
          }}
        >
          Pages · {info.pageCount}
        </h2>

        <ul
          className="m-0 flex list-none flex-col items-center gap-2 p-0"
          style={{ padding: LIST_PAD }}
        >
          {info.pages.map((page) => (
            <li key={page.index} className="w-full">
              <Thumb
                engine={engine}
                page={page}
                active={page.index === currentPage}
                token={renderTokens[page.index] ?? 0}
                onSelect={() => onSelect(page.index)}
                onContextMenu={(event) => openMenu(event, page.index)}
              />
            </li>
          ))}
        </ul>
      </aside>

      {menu && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

function Thumb({
  engine,
  page,
  active,
  token,
  onSelect,
  onContextMenu,
}: {
  engine: Engine;
  page: PageInfo;
  active: boolean;
  token: number;
  onSelect: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { width, height } = fitted(page);

  useEffect(() => {
    let cancelled = false;

    // Thumbnails render at device resolution so they are not blurry on a
    // high-DPI screen, but at a small scale so the cost stays low.
    const dpr = window.devicePixelRatio || 1;
    const scale = (width / page.width) * dpr;

    engine
      .renderPage(page.index, { scale, annotations: true })
      .then((rendered) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        const ctx = canvas.getContext('2d');
        ctx?.putImageData(toImageData(rendered.data, rendered.width, rendered.height), 0, 0);
      })
      .catch(() => {
        /* A thumbnail that fails to render is not worth an error message; the
           page itself will report the problem. */
      });

    return () => {
      cancelled = true;
    };
  }, [engine, page.index, page.width, width, token]);

  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`focus-ring block w-full rounded-lg text-left${active ? '' : ' btn-quiet'}`}
      style={{
        padding: CARD_PAD,
        background: active ? 'var(--app-accent-soft)' : undefined,
        border: `1px solid ${active ? 'var(--app-accent)' : 'transparent'}`,
        cursor: 'pointer',
      }}
      aria-current={active ? 'page' : undefined}
      // Kept to exactly "Page N" for an ordinary page: it is the name the page
      // is referred to everywhere else, and anything appended would make it
      // something else.
      aria-label={`Page ${page.index + 1}${page.isScanned ? ', a scanned image' : ''}`}
      title="Click to go to this page · right-click for page actions"
    >
      <span className="grid place-items-center" style={{ height: FRAME_H }}>
        <canvas ref={canvasRef} className="page-sheet block" style={{ width, height }} />
      </span>

      <span
        className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] tabular-nums"
        style={{ color: active ? 'var(--app-accent)' : 'var(--app-text-faint)' }}
      >
        <span>{page.index + 1}</span>
        {page.isScanned && (
          <span
            className="rounded px-1 text-[10px]"
            style={{ background: 'var(--app-warn-soft)', color: 'var(--app-warn)' }}
            title="This page is a scanned image, so its text cannot be edited"
          >
            scan
          </span>
        )}
      </span>
    </button>
  );
}
