'use client';

import type { DocumentInfo } from '@/engine/types';
import { IconZoomIn, IconZoomOut } from './Icons';

/**
 * The status bar.
 *
 * Page position and zoom on the right, current state on the left. It also
 * carries the count of placed-but-not-yet-written items, which is the one
 * piece of state a user can otherwise lose track of and be surprised by when
 * they save.
 */

interface StatusBarProps {
  info: DocumentInfo | null;
  currentPage: number;
  zoom: number;
  tool: string;
  pending: number;
  busy: string | null;
  onZoom: (zoom: number) => void;
  onFit: (mode: 'width' | 'page') => void;
}

export function StatusBar({
  info,
  currentPage,
  zoom,
  tool,
  pending,
  busy,
  onZoom,
  onFit,
}: StatusBarProps) {
  return (
    <footer
      className="flex shrink-0 items-center gap-3 px-3 py-1.5 text-xs"
      style={{
        background: 'var(--app-panel)',
        borderTop: '1px solid var(--app-border)',
        color: 'var(--app-text-dim)',
      }}
    >
      {info ? (
        <>
          <span className="tabular-nums">
            Page {currentPage + 1} of {info.pageCount}
          </span>

          {info.pages[currentPage]?.isScanned && (
            <>
              <Dot />
              <span title="This page is an image, so it has no text of its own">scan</span>
            </>
          )}

          <Dot />
          <span className="capitalize">{tool.replace('-', ' ')}</span>

          {pending > 0 && (
            <>
              <Dot />
              <span style={{ color: 'var(--app-warn)' }}>
                {pending} item{pending === 1 ? '' : 's'} not yet written to the file
              </span>
            </>
          )}

          {busy && (
            <>
              <Dot />
              <span style={{ color: 'var(--app-accent)' }}>{busy}</span>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            <ZoomButton label="Zoom out" onClick={() => onZoom(zoom / 1.2)}>
              <IconZoomOut size={14} />
            </ZoomButton>
            <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <ZoomButton label="Zoom in" onClick={() => onZoom(zoom * 1.2)}>
              <IconZoomIn size={14} />
            </ZoomButton>
            <TextButton label="Fit the page width (Ctrl+0)" onClick={() => onFit('width')}>
              Fit width
            </TextButton>
            <TextButton label="Fit the whole page (Ctrl+9)" onClick={() => onFit('page')}>
              Fit page
            </TextButton>
          </div>
        </>
      ) : (
        <span style={{ color: 'var(--app-text-faint)' }}>
          Nothing open. Documents are processed on this device only.
        </span>
      )}
    </footer>
  );
}

function Dot() {
  return (
    <span style={{ color: 'var(--app-border-strong)' }} aria-hidden="true">
      ·
    </span>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="focus-ring grid h-6 w-6 place-items-center rounded"
      style={{
        background: 'transparent',
        border: '1px solid var(--app-border)',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function TextButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="focus-ring rounded px-2 py-0.5"
      style={{
        background: 'transparent',
        border: '1px solid var(--app-border)',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
