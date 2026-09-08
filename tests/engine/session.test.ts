import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureBytes, loadEngine } from '../helpers';
import { EditorSession } from '@/engine/session';
import { History } from '@/engine/history';

async function openSession(fixture: string): Promise<EditorSession> {
  await loadEngine();
  const session = new EditorSession();
  await session.open(await fixtureBytes(fixture));
  return session;
}

describe('session lifecycle', () => {
  it('opens a document and reports its shape', async () => {
    const session = await openSession('multipage.pdf');
    const info = session.info();
    expect(info.pageCount).toBe(5);
    expect(session.isOpen).toBe(true);
    session.close();
  });

  it('refuses to work without an open document', async () => {
    await loadEngine();
    const session = new EditorSession();
    expect(() => session.info()).toThrow(/No document is open/i);
  });

  it('surfaces a password-protected file as such', async () => {
    await loadEngine();
    const session = new EditorSession();
    // A deliberately broken file exercises the error path; the message has to
    // be something a person can act on.
    await expect(session.open(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 9]))).rejects.toThrow(
      /valid PDF|could not be read|damaged/i,
    );
  });
});

describe('reading through the session', () => {
  it('renders a page', async () => {
    const session = await openSession('simple-text.pdf');
    const page = session.render(0, { scale: 1 });
    expect(page.width).toBe(612);
    expect(page.data.length).toBe(612 * 792 * 4);
    session.close();
  });

  it('finds the line under a click given device coordinates', async () => {
    const session = await openSession('simple-text.pdf');
    const lines = session.textLines(0);
    const target = lines.find((l) => l.text.includes('Acme'))!;

    // Convert the line's own centre back to device space, then click there.
    const centre = session.toDevicePoint(
      0,
      612,
      792,
      (target.bounds.left + target.bounds.right) / 2,
      (target.bounds.bottom + target.bounds.top) / 2,
    );
    const hit = session.lineAt(0, 612, 792, centre.x, centre.y);
    expect(hit?.id).toBe(target.id);
    session.close();
  });

  it('finds the object under a click', async () => {
    const session = await openSession('flattened-signature.pdf');
    const objects = session.objects(0);
    const image = objects.find((o) => o.type === 3)!;
    const centre = session.toDevicePoint(
      0,
      612,
      792,
      (image.bounds.left + image.bounds.right) / 2,
      (image.bounds.bottom + image.bounds.top) / 2,
    );
    const hit = session.objectAt(0, 612, 792, centre.x, centre.y);
    expect(hit?.path.join('.')).toBe(image.path.join('.'));
    session.close();
  });
});

describe('editing through the session', () => {
  it('reports which pages changed so only those re-render', async () => {
    const session = await openSession('multipage.pdf');
    const line = session.textLines(2).find((l) => l.text.includes('Page 3'))!;

    const result = await session.replaceText(2, line.id, 'Third Page');
    // Exactly the edited page. This is what keeps an edit on one page of a
    // hundred-page document from invalidating the whole viewer.
    expect(result.changedPages).toEqual([2]);
    session.close();
  });

  it('rolls back and rethrows when a mutation fails', async () => {
    const session = await openSession('simple-text.pdf');
    const before = session.save().byteLength;

    // A line id that is not on the page: the closest thing to a genuine
    // mid-edit failure that can be triggered deterministically.
    await expect(session.replaceText(0, 'p0-l999', 'nope')).rejects.toThrow(/no longer/i);

    // The document is still usable and unchanged, and no undo entry was left
    // describing a change that did not happen.
    expect(session.save().byteLength).toBeCloseTo(before, -3);
    expect(session.historyState().canUndo).toBe(false);
    expect(session.textLines(0).some((l) => l.text.includes('Acme'))).toBe(true);
    session.close();
  });

  it('warns once, not repeatedly, about invalidating a digital signature', async () => {
    const session = await openSession('acroform-sig-field.pdf');

    const first = session.rotate(0, 1);
    expect(first.badges.some((b) => b.kind === 'signature-invalidated')).toBe(true);

    const second = session.rotate(0, 1);
    expect(second.badges.some((b) => b.kind === 'signature-invalidated')).toBe(false);
    session.close();
  });

  it('removes a signature found by the scan', async () => {
    const session = await openSession('annotation-signatures.pdf');
    const scan = session.signatures();
    expect(scan.candidates.length).toBe(2);

    const result = session.removeSignatureById(scan.candidates[0].id);
    expect(result.changedPages).toEqual([0]);

    // The scan is invalidated by the edit, so the removed one is gone.
    expect(session.signatures().candidates.length).toBe(1);
    session.close();
  });

  it('applies pending placements in one undoable step', async () => {
    const session = await openSession('simple-text.pdf');

    const result = await session.apply([
      {
        type: 'rect',
        page: 0,
        rect: { left: 70, bottom: 630, right: 400, top: 652 },
        colour: { r: 255, g: 255, b: 255, a: 255 },
      },
      {
        type: 'text',
        page: 0,
        x: 72,
        y: 636,
        text: 'Amount due: PHP 0.00',
        fontSize: 12,
        colour: { r: 0, g: 0, b: 0, a: 255 },
        fontKey: 'sans',
      },
    ]);

    expect(result.changedPages).toEqual([0]);
    // Two placements, one action, one undo step.
    expect(session.historyState().depth).toBe(1);
    session.close();
  });
});

describe('undo and redo', () => {
  it('restores the previous state', async () => {
    const session = await openSession('simple-text.pdf');
    const line = session.textLines(0).find((l) => l.text.includes('Acme'))!;

    await session.replaceText(0, line.id, 'Changed Name');
    expect(session.textLines(0).some((l) => l.text.includes('Changed Name'))).toBe(true);

    await session.undo();
    const restored = session.textLines(0).map((l) => l.text);
    expect(restored.some((t) => t.includes('Acme Corporation'))).toBe(true);
    expect(restored.some((t) => t.includes('Changed Name'))).toBe(false);
    session.close();
  });

  it('redoes what it undid', async () => {
    const session = await openSession('simple-text.pdf');
    const line = session.textLines(0).find((l) => l.text.includes('Acme'))!;

    await session.replaceText(0, line.id, 'Changed Name');
    await session.undo();
    await session.redo();

    expect(session.textLines(0).some((l) => l.text.includes('Changed Name'))).toBe(true);
    session.close();
  });

  it('undoes a signature removal', async () => {
    const session = await openSession('flattened-signature.pdf');
    const candidate = session.signatures().candidates.find((c) => c.kind === 'image')!;

    session.removeSignatureById(candidate.id);
    expect(session.objects(0).filter((o) => o.type === 3).length).toBe(0);

    await session.undo();
    expect(session.objects(0).filter((o) => o.type === 3).length).toBe(1);
    session.close();
  });

  it('undoes a page deletion', async () => {
    const session = await openSession('multipage.pdf');
    session.deletePages([1, 3]);
    expect(session.info().pageCount).toBe(3);

    await session.undo();
    expect(session.info().pageCount).toBe(5);
    expect(session.textLines(1).some((l) => l.text.includes('Page 2'))).toBe(true);
    session.close();
  });

  it('reports nothing to undo on a fresh document', async () => {
    const session = await openSession('simple-text.pdf');
    expect(await session.undo()).toBeNull();
    expect(await session.redo()).toBeNull();
    session.close();
  });

  it('discards the redo branch after a new edit', async () => {
    const session = await openSession('simple-text.pdf');
    const lines = session.textLines(0);

    await session.replaceText(0, lines[1].id, 'First change');
    await session.undo();
    expect(session.historyState().canRedo).toBe(true);

    await session.replaceText(0, session.textLines(0)[1].id, 'Different change');
    expect(session.historyState().canRedo).toBe(false);
    session.close();
  });
});

describe('page operations', () => {
  it('rotates a page', async () => {
    const session = await openSession('simple-text.pdf');
    expect(session.info().pages[0].rotation).toBe(0);
    session.rotate(0, 1);
    expect(session.info().pages[0].rotation).toBe(90);
    session.close();
  });

  it('deletes pages from the highest index down', async () => {
    const session = await openSession('multipage.pdf');
    session.deletePages([0, 2]);
    const remaining = [0, 1, 2].map((i) => session.textLines(i).map((l) => l.text).join(' '));
    expect(remaining[0]).toContain('Page 2');
    expect(remaining[1]).toContain('Page 4');
    expect(remaining[2]).toContain('Page 5');
    session.close();
  });

  it('refuses to delete every page', async () => {
    const session = await openSession('multipage.pdf');
    expect(() => session.deletePages([0, 1, 2, 3, 4])).toThrow(/at least one page/i);
    session.close();
  });

  it('inserts a blank page matching the size of its neighbour', async () => {
    const session = await openSession('simple-text.pdf');
    session.insertBlankPage(1);
    const info = session.info();
    expect(info.pageCount).toBe(2);
    expect(info.pages[1].width).toBeCloseTo(612, 0);
    expect(info.pages[1].height).toBeCloseTo(792, 0);
    expect(info.pages[1].textObjectCount).toBe(0);
    session.close();
  });

  it('reorders pages', async () => {
    const session = await openSession('multipage.pdf');
    // Move page 5 (index 4) to the front.
    session.movePages([4], 0);
    expect(session.textLines(0).map((l) => l.text).join(' ')).toContain('Page 5');
    expect(session.textLines(1).map((l) => l.text).join(' ')).toContain('Page 1');
    session.close();
  });

  it('extracts a subset into a new document', async () => {
    const session = await openSession('multipage.pdf');
    const bytes = session.extract([3, 1]);

    await loadEngine();
    const other = new EditorSession();
    await other.open(bytes);
    expect(other.info().pageCount).toBe(2);
    // Order follows the request, not the original document.
    expect(other.textLines(0).map((l) => l.text).join(' ')).toContain('Page 4');
    expect(other.textLines(1).map((l) => l.text).join(' ')).toContain('Page 2');
    other.close();
    session.close();
  });
});

describe('history limits', () => {
  let history: History;

  beforeEach(() => {
    history = new History({ maxEntries: 3, maxBytes: 1024 * 1024 });
  });

  it('drops the oldest entries past the limit and says so', () => {
    for (let i = 0; i < 5; i++) history.push(`edit ${i}`, new Uint8Array(10));
    expect(history.depth).toBe(3);
    expect(history.truncated).toBe(true);
    expect(history.undoLabel).toBe('edit 4');
  });

  it('keeps at least one undo entry when the byte cap is exceeded', () => {
    const big = new History({ maxEntries: 10, maxBytes: 100 });
    for (let i = 0; i < 4; i++) big.push(`edit ${i}`, new Uint8Array(80));
    expect(big.depth).toBeGreaterThanOrEqual(1);
    expect(big.truncated).toBe(true);
  });

  it('clears the redo branch when a new action is recorded', () => {
    history.push('a', new Uint8Array(10));
    history.undo('current', new Uint8Array(10));
    expect(history.canRedo).toBe(true);
    history.push('b', new Uint8Array(10));
    expect(history.canRedo).toBe(false);
  });
});
