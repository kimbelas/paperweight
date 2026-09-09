'use client';

import type { PageInfo } from '@/engine/types';
import type { OcrLine, OcrProgress } from '@/ocr/recognise';
import {
  IconAddText,
  IconCover,
  IconEditText,
  IconImage,
  IconMark,
  IconRotate,
  IconSelect,
  IconSignature,
  IconTrash,
} from './Icons';
import { ColourRow } from './ColourRow';
import { MarkPicker, WeightPicker } from './MarkPicker';
import { OcrPanel } from './OcrPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { SignaturePanel } from './SignaturePanel';
import { useEditor, type Tool } from './store';

/**
 * The actions rail, on the left.
 *
 * Everything you do *to* the page lives here, and everything *about* the page
 * — which page you are on, what it looks like — lives in the rail on the
 * right. Splitting the two that way means neither side changes role as you
 * work: the left is where you reach for a tool, the right is where you
 * navigate, and the document keeps the whole middle.
 *
 * Tools are cards rather than a row of small buttons because they are the
 * controls used most and were previously the smallest things in the interface.
 * A card also has room for the label, and these tools are not self-evident:
 * clicking with Edit text changes text that is already there, while Add text
 * creates new — a distinction a bare icon cannot make.
 *
 * The panels below are sections rather than tabs, each appearing only when it
 * has something to say. Tabs would hide the signature list behind a click on a
 * document whose signatures are the reason the app was opened, and an
 * always-present properties pane would sit empty most of the time.
 */

interface ToolSpec {
  id: Tool;
  label: string;
  hint: string;
  Icon: (props: { size?: number }) => React.ReactElement;
  key: string;
}

/**
 * The tool order follows what every established PDF editor uses — select,
 * text, additions, then cover — because users arrive with that expectation
 * already formed and a novel arrangement only costs them time.
 */
const TOOLS: ToolSpec[] = [
  {
    id: 'select',
    label: 'Select',
    hint: 'Click anything on the page — text, a shape, an image — to select it, then drag to move it or press Delete to remove it. Clicking a form field edits it straight away.',
    Icon: IconSelect,
    key: 'V',
  },
  {
    id: 'edit-text',
    label: 'Edit text',
    hint: 'Click a line of existing text to change the words',
    Icon: IconEditText,
    key: 'T',
  },
  {
    id: 'add-text',
    label: 'Add text',
    hint: 'Click an empty spot to place a new line of text',
    Icon: IconAddText,
    key: 'A',
  },
  {
    id: 'mark',
    label: 'Mark',
    hint: 'Click to put a cross, tick, ring, dot or rule on the page — for a checkbox that is printed rather than a real field',
    Icon: IconMark,
    key: 'M',
  },
  {
    id: 'cover',
    label: 'Cover',
    hint: 'Drag a patch over content to hide it. The content stays in the file',
    Icon: IconCover,
    key: 'C',
  },
];

interface ToolRailProps {
  collapsed: boolean;
  page: PageInfo | null;
  ocrLines: OcrLine[];
  ocrBusy: boolean;
  ocrProgress: OcrProgress | null;
  ocrError: string | null;
  onRunOcr: () => void;
  onClearOcr: () => void;
  onRemoveSignature: (id: string) => void;
  onAddSignature: () => void;
  onAddImage: () => void;
  onRotate: () => void;
  onDeleteSelection?: () => void;
}

export function ToolRail({
  collapsed,
  page,
  ocrLines,
  ocrBusy,
  ocrProgress,
  ocrError,
  onRunOcr,
  onClearOcr,
  onRemoveSignature,
  onAddSignature,
  onAddImage,
  onRotate,
  onDeleteSelection,
}: ToolRailProps) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const markShape = useEditor((s) => s.markShape);
  const markWeight = useEditor((s) => s.markWeight);
  const markColour = useEditor((s) => s.markColour);
  const setMarkStyle = useEditor((s) => s.setMarkStyle);
  const overlay = useEditor((s) => s.overlay);
  const selectedOverlayId = useEditor((s) => s.selectedOverlayId);

  // Open while the tool is armed, and also whenever a placed mark is selected
  // — otherwise a mark dropped with the tool and then picked up again with
  // Select would have no controls anywhere.
  const markSelected = overlay.find((o) => o.id === selectedOverlayId)?.kind === 'mark';
  const showMarks = tool === 'mark' || markSelected;

  if (collapsed) {
    return (
      <aside
        className="flex shrink-0 flex-col items-center gap-1 overflow-y-auto py-2"
        style={{
          width: 56,
          background: 'var(--app-panel)',
          borderRight: '1px solid var(--app-border)',
        }}
        aria-label="Actions"
      >
        {TOOLS.map(({ id, label, hint, Icon, key }) => (
          <RailIcon
            key={id}
            label={label}
            title={`${label} (${key}) — ${hint}`}
            active={tool === id}
            onClick={() => setTool(id)}
          >
            <Icon size={19} />
          </RailIcon>
        ))}

        <span className="my-1 h-px w-7" style={{ background: 'var(--app-border)' }} />

        <RailIcon
          label="Signature"
          title="Draw, type or upload a signature and place it on the page (S)"
          onClick={onAddSignature}
        >
          <IconSignature size={19} />
        </RailIcon>
        <RailIcon label="Image" title="Place an image on the page (I)" onClick={onAddImage}>
          <IconImage size={19} />
        </RailIcon>
        <RailIcon label="Rotate page" title="Rotate this page 90° clockwise" onClick={onRotate}>
          <IconRotate size={19} />
        </RailIcon>

        {onDeleteSelection && (
          <RailIcon
            label="Delete selection"
            title="Delete the selected item (Delete)"
            danger
            onClick={onDeleteSelection}
          >
            <IconTrash size={19} />
          </RailIcon>
        )}
      </aside>
    );
  }

  return (
    <aside
      className="flex shrink-0 flex-col overflow-y-auto"
      style={{
        width: 248,
        background: 'var(--app-panel)',
        borderRight: '1px solid var(--app-border)',
      }}
      aria-label="Actions"
    >
      <section className="p-3" aria-label="Tools">
        <Heading>Tools</Heading>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Editing tools">
          {TOOLS.map(({ id, label, hint, Icon, key }) => (
            <ToolCard
              key={id}
              label={label}
              title={`${label} (${key}) — ${hint}`}
              active={tool === id}
              onClick={() => setTool(id)}
            >
              <Icon size={20} />
            </ToolCard>
          ))}
        </div>

        {showMarks && (
          // Only when a mark is in play. A picker that was always there would
          // be seven more controls to read past for everyone not filling in a
          // form, and the marks mean nothing out of that context.
          <div className="mt-2.5 grid gap-1.5" aria-label="Mark style">
            <MarkPicker
              value={markShape}
              weight={markWeight}
              onPick={(shape) => setMarkStyle({ shape })}
            />
            <WeightPicker value={markWeight} onPick={(weight) => setMarkStyle({ weight })} />
            <ColourRow value={markColour} onChange={(colour) => setMarkStyle({ colour })} />
            <p className="text-[11px] leading-snug" style={{ color: 'var(--app-text-faint)' }}>
              {markSelected
                ? 'Drag it to move, or a corner to resize. Changing the mark above changes this one.'
                : `Click a box on the page to drop ${MARK_ARTICLE[markShape]} into it. Click a mark you have placed to change or move it.`}
            </p>
          </div>
        )}

        <p className="mt-2.5 text-[11px] leading-snug" style={{ color: 'var(--app-text-faint)' }}>
          Right-click anything on the page for what can be done to it.
        </p>
      </section>

      {/*
        Kept apart from the tools above, because they are not modes: each one
        opens something and places a single item, rather than changing what a
        click on the page does until you change it back.
      */}
      <section className="px-3 pb-3" aria-label="Add to the page">
        <Heading>Add</Heading>
        <div className="grid grid-cols-2 gap-1.5">
          <ToolCard
            label="Signature"
            title="Draw, type or upload a signature and place it on the page (S)"
            onClick={onAddSignature}
          >
            <IconSignature size={20} />
          </ToolCard>

          <ToolCard label="Image" title="Place an image on the page (I)" onClick={onAddImage}>
            <IconImage size={20} />
          </ToolCard>
        </div>
      </section>

      <section className="px-3 pb-3" aria-label="This page">
        <Heading>This page</Heading>
        <button
          type="button"
          onClick={onRotate}
          className="focus-ring btn-quiet flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium"
          style={{
            border: '1px solid var(--app-border)',
            color: 'var(--app-text-dim)',
            cursor: 'pointer',
          }}
          title="Rotate this page 90° clockwise"
        >
          <IconRotate size={15} />
          Rotate 90°
        </button>
      </section>

      <PropertiesPanel onDeleteSelection={onDeleteSelection} />

      <SignaturePanel onRemove={onRemoveSignature} onAddSignature={onAddSignature} />

      {page && (
        <OcrPanel
          page={page.index}
          isScanned={page.isScanned}
          lines={ocrLines}
          busy={ocrBusy}
          progress={ocrProgress}
          error={ocrError}
          onRun={onRunOcr}
          onClear={onClearOcr}
        />
      )}
    </aside>
  );
}

/** How to name each mark in a sentence. */
const MARK_ARTICLE: Record<string, string> = {
  cross: 'a cross',
  tick: 'a tick',
  circle: 'a ring',
  dot: 'a dot',
  line: 'a rule',
};

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--app-text-faint)' }}
    >
      {children}
    </h2>
  );
}

/**
 * One tool.
 *
 * The label is real text rather than an `aria-label` on an icon, so it is
 * visible, searchable and readable by anything that reads the page.
 */
function ToolCard({
  label,
  title,
  active,
  onClick,
  children,
}: {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`focus-ring flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-2.5 text-[11px] font-medium leading-tight${active ? '' : ' btn-quiet'}`}
      style={{
        background: active ? 'var(--app-accent-soft)' : undefined,
        color: active ? 'var(--app-accent)' : 'var(--app-text-dim)',
        border: `1px solid ${active ? 'var(--app-accent)' : 'var(--app-border)'}`,
        cursor: 'pointer',
        minHeight: 60,
      }}
    >
      {children}
      <span className="w-full truncate text-center">{label}</span>
    </button>
  );
}

function RailIcon({
  label,
  title,
  active,
  danger,
  onClick,
  children,
}: {
  label: string;
  title: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={`focus-ring grid h-10 w-10 place-items-center rounded-lg${active ? '' : ' btn-quiet'}`}
      style={{
        background: active ? 'var(--app-accent-soft)' : undefined,
        color: danger ? 'var(--app-danger)' : active ? 'var(--app-accent)' : 'var(--app-text-dim)',
        border: `1px solid ${active ? 'var(--app-accent)' : 'transparent'}`,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
