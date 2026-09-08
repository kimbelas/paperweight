'use client';

import { useEffect, useState } from 'react';
import {
  IconDownload,
  IconKeyboard,
  IconMoon,
  IconOpen,
  IconPages,
  IconPrint,
  IconRedo,
  IconSave,
  IconSun,
  IconTools,
  IconUndo,
} from './Icons';
import { useEditor } from './store';
import { applyTheme, readTheme, writeTheme, type Theme } from './theme';

/**
 * The top bar: what happens to the document as a whole.
 *
 * The editing tools used to live here too, crammed in beside Open and Save as
 * a row of small buttons that grew a second line whenever the window narrowed.
 * They are now in the actions rail on the left, which leaves this bar with one
 * job — get a file in, get a file out — and lets every control in it be a
 * comfortable size rather than the smallest that would fit.
 *
 * Undo and redo stay here rather than moving to the rail. They apply to the
 * document rather than to a tool, they are wanted at every moment regardless
 * of which tool is armed, and the rail can be collapsed.
 */

interface ToolbarProps {
  hasDocument: boolean;
  fileName: string | null;
  dirty: boolean;
  busy: string | null;
  canSaveInPlace: boolean;
  pendingCount: number;
  showTools: boolean;
  showThumbs: boolean;
  onToggleTools: () => void;
  onToggleThumbs: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onDownload: () => void;
  onPrint: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onShowShortcuts: () => void;
}

export function Toolbar({
  hasDocument,
  fileName,
  dirty,
  busy,
  canSaveInPlace,
  pendingCount,
  showTools,
  showThumbs,
  onToggleTools,
  onToggleThumbs,
  onOpen,
  onSave,
  onSaveAs,
  onDownload,
  onPrint,
  onUndo,
  onRedo,
  onShowShortcuts,
}: ToolbarProps) {
  const history = useEditor((s) => s.history);
  const [theme, setTheme] = useState<Theme>('light');

  // Read after mount, not during render: the boot script has already put the
  // right theme on the document, and reading `localStorage` while rendering
  // would make the server's markup and the client's first pass disagree.
  useEffect(() => setTheme(readTheme()), []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    writeTheme(next);
  };

  return (
    <header
      className="flex shrink-0 items-center gap-2 px-3"
      style={{
        height: 52,
        background: 'var(--app-panel)',
        borderBottom: '1px solid var(--app-border)',
      }}
    >
      <IconButton
        label={showTools ? 'Hide the actions rail' : 'Show the actions rail'}
        name="Actions rail"
        pressed={showTools}
        onClick={onToggleTools}
        disabled={!hasDocument}
      >
        <IconTools size={18} />
      </IconButton>

      <span className="mr-1 hidden text-sm font-semibold tracking-tight sm:inline">
        Paperweight
      </span>

      <Divider />

      <button
        type="button"
        onClick={onOpen}
        className="focus-ring btn-quiet flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium"
        style={outlined()}
        title="Open a PDF from this device (Ctrl+O)"
      >
        <IconOpen size={17} />
        Open
      </button>

      {hasDocument && (
        <>
          <Divider />

          <IconButton
            label={
              history.undoLabel
                ? `Undo ${history.undoLabel.toLowerCase()} (Ctrl+Z)`
                : 'Nothing to undo'
            }
            name="Undo"
            onClick={onUndo}
            disabled={!history.canUndo}
          >
            <IconUndo size={18} />
          </IconButton>
          <IconButton
            label={
              history.redoLabel
                ? `Redo ${history.redoLabel.toLowerCase()} (Ctrl+Shift+Z)`
                : 'Nothing to redo'
            }
            name="Redo"
            onClick={onRedo}
            disabled={!history.canRedo}
          >
            <IconRedo size={18} />
          </IconButton>
        </>
      )}

      <div className="mx-2 flex min-w-0 flex-1 flex-col items-center">
        {fileName && (
          <span
            className="max-w-full truncate text-[13px]"
            style={{ color: 'var(--app-text-dim)' }}
            title={dirty ? `${fileName} — unsaved changes` : fileName}
          >
            {fileName}
            {dirty && <span style={{ color: 'var(--app-warn)' }}> •</span>}
          </span>
        )}
        {pendingCount > 0 && (
          <span className="text-[11px] leading-tight" style={{ color: 'var(--app-warn)' }}>
            {pendingCount} placed item{pendingCount === 1 ? '' : 's'} not yet written to the file
          </span>
        )}
      </div>

      <IconButton
        label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        name={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        onClick={toggleTheme}
      >
        {/* The icon is what you will get, not what you have: a moon offers the
            dark theme rather than reporting that you are in the light one. */}
        {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </IconButton>

      <IconButton label="Keyboard shortcuts and what to know (?)" name="Help" onClick={onShowShortcuts}>
        <IconKeyboard size={18} />
      </IconButton>

      {hasDocument && (
        <>
          <button
            type="button"
            onClick={onPrint}
            disabled={Boolean(busy)}
            className="focus-ring btn-quiet flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium"
            style={outlined(!busy)}
            title="Print the document, including your changes (Ctrl+P)"
          >
            <IconPrint size={17} />
            Print
          </button>

          {canSaveInPlace ? (
            <div className="flex items-center">
              <button
                type="button"
                onClick={onSave}
                disabled={Boolean(busy)}
                className="focus-ring btn-solid flex h-9 items-center gap-2 rounded-l-lg px-3.5 text-[13px] font-medium"
                style={{ ...solid(!busy), borderRight: '1px solid rgb(255 255 255 / 0.25)' }}
                title="Save over the file you opened (Ctrl+S)"
              >
                <IconSave size={17} />
                Save
              </button>
              <button
                type="button"
                onClick={onSaveAs}
                disabled={Boolean(busy)}
                className="focus-ring btn-solid h-9 rounded-r-lg px-2.5 text-[13px] font-medium"
                style={solid(!busy)}
                title="Save as a new file (Ctrl+Shift+S)"
              >
                Save as…
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onDownload}
              disabled={Boolean(busy)}
              className="focus-ring btn-solid flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium"
              style={solid(!busy)}
              // This browser cannot write back to the opened file, so the
              // label says what will actually happen.
              title="Download a copy with your changes (Ctrl+S)"
            >
              <IconDownload size={17} />
              Download
            </button>
          )}

          <Divider />

          <IconButton
            label={showThumbs ? 'Hide the pages rail' : 'Show the pages rail'}
            name="Pages rail"
            pressed={showThumbs}
            onClick={onToggleThumbs}
          >
            <IconPages size={18} />
          </IconButton>
        </>
      )}
    </header>
  );
}

function IconButton({
  label,
  name,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  /** Accessible name, when the tooltip is too wordy to serve as one. */
  name?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={name ?? label}
      aria-pressed={pressed}
      className="focus-ring btn-quiet grid h-9 w-9 shrink-0 place-items-center rounded-lg"
      style={{
        color: pressed ? 'var(--app-accent)' : 'var(--app-text-dim)',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      className="mx-0.5 h-6 w-px shrink-0"
      style={{ background: 'var(--app-border)' }}
      aria-hidden="true"
    />
  );
}

function solid(enabled = true): React.CSSProperties {
  return {
    color: '#fff',
    border: 'none',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.5,
  };
}

function outlined(enabled = true): React.CSSProperties {
  return {
    color: 'var(--app-text-dim)',
    border: '1px solid var(--app-border-strong)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.5,
  };
}
