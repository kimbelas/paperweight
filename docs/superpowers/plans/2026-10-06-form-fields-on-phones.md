# Form fields on phones: correctness and touch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the mixed-orientation crash and the form field defects in the engine (part A), and make selecting, moving, opening, editing and widening fields work by touch (part B).

**Architecture:** A widget is identified by its PDF object number (`ref`) everywhere a field crosses the worker boundary, and the appearance size snapshot is keyed by `ref` and carried across reload and undo. On the UI side each page keeps its own field list so a tap is hit-tested synchronously (with touch slop), small pure helpers own pointer tracking (`pointer.ts`), focus-safe presses (`press.ts`), on-screen placement (`onscreen.ts`) and zoom fitting (`fit.ts`), and the editors use them.

**Tech Stack:** TypeScript, React 19, Next.js 16 static export, PDFium WASM (`@embedpdf/pdfium`) in a worker via Comlink, vitest (engine and pure helpers under Node), Playwright (Chromium, Firefox, WebKit).

**Spec:** `docs/superpowers/specs/2026-10-06-form-fields-on-phones-design.md`

## Global Constraints

- Only `src/engine/` imports `@embedpdf/pdfium`; the UI talks to the engine only through `src/engine/worker.ts`.
- Never return a WASM pointer out of `withScope`; allocate and consume in the same scope.
- A form edit repaints its page (`repaint` list) and never marks it dirty; `GenerateContent` never runs on a page the user did not touch.
- Every engine test that changes the file saves and reopens it before asserting.
- Never set a field value by writing `/V`; drive `FORM_*` calls.
- `touch-action: none` only on the selection outline (and the canvas only while the Cover tool is armed); the canvas otherwise keeps pinch-zoom.
- No em dashes or en dashes in code comments, docs, commit messages or UI copy added by this plan. Use a hyphen, comma or colon.
- Commits: one line, imperative, at most 72 characters, no body, no trailers, no AI attribution.
- After any change in `src/engine/`, run `pnpm build:worker` before browser tests, or the browser runs the previous engine.
- Run `pnpm format` before the final commit; CI fails on `prettier --check .`.
- Browser tests run against the built export on 127.0.0.1:4173. Before trusting a run, check that port is serving the current build (`curl -s http://127.0.0.1:4173/sw.js | grep -o 'engine-[0-9a-f]*'` against `out/sw.js`); stop a stale `serve` if they differ.
- Leave the owner's uncommitted `src/offline/service-worker.ts` change and `fixtures/needapp-shared.pdf` out of every commit (`git add` named files only).

## Review Focus

1. Tapping a second field while the first is being edited on iOS: the first value must be committed, not lost. Pinned in Task 10 (`commits the first field when another is tapped`).
2. Undo after moving a selected field, then Delete: the selection must not point at a stale rectangle. Pinned in Task 4 (`undo clears a field selection`).
3. A pinch or second finger starting on a selected outline: the drag is abandoned with no move and no undo entry. Pinned in Task 8 (`abandons the drag on pointercancel`).
4. A non-editable combo given a value that is not one of its options: an error, and the value unchanged in the saved file. Pinned in Task 7 (`refuses a value a fixed combo does not offer`).
5. Field identity after a document reload caused by deleting another field: refs still address the right widget. Pinned in Task 3 (`a ref still addresses its widget after another field is deleted`).

---

### Task 1: Fit the zoom to the document, not the current page

Fixes the React error #185 crash on any document mixing portrait and landscape pages.

**Files:**
- Create: `src/editor/fit.ts`
- Create: `tests/editor/fit.test.ts`
- Modify: `src/editor/Editor.tsx:717-738` (the fit effect)
- Modify: `scripts/make-fixtures.mjs` (add `mixed-orientation.pdf`)
- Create: `fixtures/mixed-orientation.pdf` (generated)
- Create: `tests/e2e/mixed-orientation.spec.ts`

**Interfaces:**
- Produces: `fitZoom(pages: { width: number; height: number }[], mode: 'width' | 'page', availableWidth: number, availableHeight: number): number`

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/editor/fit.test.ts
import { describe, expect, it } from 'vitest';
import { fitZoom } from '@/editor/fit';

const portrait = { width: 612, height: 792 };
const landscape = { width: 792, height: 612 };

describe('fitZoom', () => {
  it('fits the widest page to the width', () => {
    expect(fitZoom([portrait, landscape, portrait], 'width', 792, 500)).toBeCloseTo(1, 5);
  });

  it('fits the largest page inside the box for Fit page', () => {
    // Portrait limits by height (500/792), landscape by width (700/792).
    expect(fitZoom([portrait, landscape], 'page', 700, 500)).toBeCloseTo(500 / 792, 5);
  });

  it('does not depend on which page is current', () => {
    const a = fitZoom([portrait, landscape], 'width', 400, 800);
    const b = fitZoom([landscape, portrait], 'width', 400, 800);
    expect(a).toBe(b);
  });

  it('clamps to the zoom range', () => {
    expect(fitZoom([portrait], 'width', 10, 10)).toBe(0.1);
    expect(fitZoom([portrait], 'width', 100000, 100000)).toBe(4);
  });

  it('returns 1 with no pages', () => {
    expect(fitZoom([], 'width', 800, 600)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/editor/fit.test.ts`
Expected: FAIL, cannot resolve `@/editor/fit`.

- [ ] **Step 3: Implement `fit.ts`**

```ts
// src/editor/fit.ts
/**
 * The zoom that fits a document into the viewport.
 *
 * Fitted to the whole document rather than to the page being looked at. The
 * current page is derived from scroll offsets that are themselves computed at
 * this zoom, so fitting to it closed a loop: scrolling onto a landscape page
 * lowered the zoom, which made a portrait page current, which raised it again,
 * until React gave up with "maximum update depth exceeded". Any document mixing
 * the two orientations crashed the editor on scroll.
 */
export function fitZoom(
  pages: { width: number; height: number }[],
  mode: 'width' | 'page',
  availableWidth: number,
  availableHeight: number,
): number {
  if (pages.length === 0) return 1;
  const widest = Math.max(...pages.map((p) => p.width));
  const byWidth = availableWidth / widest;
  const next =
    mode === 'width'
      ? byWidth
      : Math.min(byWidth, ...pages.map((p) => availableHeight / p.height));
  return Math.max(0.1, Math.min(4, next));
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm vitest run tests/editor/fit.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Use it in `Editor.tsx`**

Replace the body of the fit effect at `src/editor/Editor.tsx:717-738` with:

```tsx
  useEffect(() => {
    if (!info || fitMode === 'custom') return;
    const node = scrollRef.current;
    if (!node) return;

    // Fitted to the document, never to `currentPage`: see `fitZoom`.
    const fit = () =>
      setZoom(fitZoom(info.pages, fitMode, node.clientWidth - 48, node.clientHeight - 48), fitMode);

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [info, fitMode, setZoom]);
```

Add `import { fitZoom } from './fit';` with the other local imports.

- [ ] **Step 6: Add the fixture**

In `scripts/make-fixtures.mjs`, before the `await mkdir(OUT, ...)` line, add:

```js
// ---------------------------------------------------------------------------
// Mixed page orientation: portrait, portrait with /Rotate 90, a landscape
// media box, portrait. Fitting the zoom to the current page made scrolling
// through this crash the editor; the fit is now taken over every page.
// ---------------------------------------------------------------------------
fixtures['mixed-orientation.pdf'] = () => {
  const label = (text) => stream('', `BT /F1 18 Tf 72 500 Td (${text}) Tj ET`);
  return buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Count 4 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 11 0 R >> >> /Contents 7 0 R >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Resources << /Font << /F1 11 0 R >> >> /Contents 8 0 R >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 11 0 R >> >> /Contents 9 0 R >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 11 0 R >> >> /Contents 10 0 R >>',
      label('Portrait one'),
      label('Rotated'),
      label('Landscape'),
      label('Portrait two'),
      HELV,
    ],
    1,
  );
};
```

Run: `node scripts/make-fixtures.mjs`
Expected: the list includes `mixed-orientation.pdf`. Check `git status` shows only that new fixture plus any byte-identical rewrites (there should be no diff on existing fixtures; if there is, stop and report it).

- [ ] **Step 7: Write the browser test**

```ts
// tests/e2e/mixed-orientation.spec.ts
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * A document mixing portrait and landscape pages.
 *
 * Fitting the zoom to whichever page was current closed a loop with the
 * current-page calculation, and scrolling crashed the editor outright.
 */
test('scrolling through mixed page orientations does not crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto('/');
  await waitForLanding(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(process.cwd(), 'fixtures', 'mixed-orientation.pdf'));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });

  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => document.querySelector('main')?.scrollBy(0, 400));
    await page.waitForTimeout(150);
  }

  await expect(page.locator('canvas[aria-label="Page 4"]')).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 8: Build and run it**

Run: `pnpm build` then `pnpm test:e2e tests/e2e/mixed-orientation.spec.ts --project=chromium`
Expected: 1 passed. (Before the Step 5 change this failed with React error #185.)

- [ ] **Step 9: Commit**

```bash
git add src/editor/fit.ts tests/editor/fit.test.ts src/editor/Editor.tsx scripts/make-fixtures.mjs fixtures/mixed-orientation.pdf tests/e2e/mixed-orientation.spec.ts
git commit -m "Fit the zoom to the document so mixed orientations stop crashing"
```

---

### Task 2: The `form-kinds.pdf` fixture

**Files:**
- Modify: `scripts/make-fixtures.mjs`
- Create: `fixtures/form-kinds.pdf` (generated)

**Interfaces:**
- Produces: `fixtures/form-kinds.pdf`, page 1 of 612x792, holding these widgets in this `/Annots` order:
  | Field (name) | Kind | Rect | Notes |
  |---|---|---|---|
  | `Sex` kid 1 | radio | 200 700 214 714 | export `M`, selected |
  | `Sex` kid 2 | radio | 260 700 274 714 | export `F` |
  | `Country` | combo | 200 660 360 678 | options Philippines, Japan, Canada; value Japan; `/DA` 10pt |
  | `City` | editable combo | 200 630 360 648 | options Manila, Tokyo; value Tokyo |
  | `Pin` | password text | 200 600 300 616 | value `secret`; `/DA` `0 Tf` |
  | `HiddenBox` | text, `/F 2` | 195 558 360 576 | over page text `UNDER HIDDEN` at 200 564 |
  | `NoViewBox` | text, `/F 32` | 195 528 360 546 | over page text `UNDER NOVIEW` at 200 534 |
  | `Code` | text | 200 490 300 506 | `/MaxLen 5`, value `AB` |
  | `Inherited` | text | 200 460 400 476 | `/DA` 10pt on the parent only |
  | `FormDefault` | text | 200 430 400 446 | no `/DA`; `/AcroForm /DA` is 9pt |
  | `Shared` kid 1 | text | 200 400 300 416 | one field, value `SAME` |
  | `Shared` kid 2 | text | 320 400 420 416 | same field |

- [ ] **Step 1: Add the fixture builder**

In `scripts/make-fixtures.mjs`, before `await mkdir(OUT, ...)`:

```js
// ---------------------------------------------------------------------------
// Every field shape the form path has to handle and once did not: a radio
// group (its options share a name), fixed and editable combos, a password
// field with an auto size, Hidden and NoView widgets over page text, /MaxLen,
// a size inherited from the parent field and from /AcroForm /DA, and one
// field with two widgets. Fields were once looked up by name, which made
// every shared-name case act on the first widget.
// ---------------------------------------------------------------------------
fixtures['form-kinds.pdf'] = () => {
  const widget = (body) => `<< /Type /Annot /Subtype /Widget /P 3 0 R ${body} >>`;
  const DA10 = '/DA (/Helv 10 Tf 0 g)';
  return buildPdf(
    [
      // 1 catalog
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [7 0 R 12 0 R 13 0 R 14 0 R 15 0 R 16 0 R 17 0 R 18 0 R 20 0 R 21 0 R] ' +
        '/DA (/Helv 9 Tf 0 g) /DR << /Font << /Helv 5 0 R /ZaDb 6 0 R >> >> >> >>',
      // 2 pages
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      // 3 page
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R ' +
        '/Annots [8 0 R 9 0 R 12 0 R 13 0 R 14 0 R 15 0 R 16 0 R 17 0 R 19 0 R 20 0 R 22 0 R 23 0 R] >>',
      // 4 contents
      stream(
        '',
        [
          'BT /F1 16 Tf 72 750 Td (FORM KINDS) Tj ET',
          'BT /F1 10 Tf 72 704 Td (Sex: M F) Tj ET',
          'BT /F1 10 Tf 72 664 Td (Country) Tj ET',
          'BT /F1 10 Tf 72 634 Td (City) Tj ET',
          'BT /F1 10 Tf 72 604 Td (PIN) Tj ET',
          'BT /F1 10 Tf 200 564 Td (UNDER HIDDEN) Tj ET',
          'BT /F1 10 Tf 200 534 Td (UNDER NOVIEW) Tj ET',
          'BT /F1 10 Tf 72 494 Td (Code) Tj ET',
          'BT /F1 10 Tf 72 464 Td (Inherited) Tj ET',
          'BT /F1 10 Tf 72 434 Td (Form default) Tj ET',
          'BT /F1 10 Tf 72 404 Td (Shared) Tj ET',
        ].join('\n'),
      ),
      // 5, 6 fonts
      HELV,
      '<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>',
      // 7 radio parent, 8 and 9 its widgets, 10 and 11 their appearances
      '<< /FT /Btn /T (Sex) /Ff 49152 /V /M /Kids [8 0 R 9 0 R] >>',
      '<< /Type /Annot /Subtype /Widget /Parent 7 0 R /P 3 0 R /F 4 /AS /M /Rect [200 700 214 714] /AP << /N << /M 10 0 R /Off 11 0 R >> >> >>',
      '<< /Type /Annot /Subtype /Widget /Parent 7 0 R /P 3 0 R /F 4 /AS /Off /Rect [260 700 274 714] /AP << /N << /F 10 0 R /Off 11 0 R >> >> >>',
      stream(
        '/Type /XObject /Subtype /Form /BBox [0 0 14 14]',
        '0.6 w 0 G 1 1 12 12 re S 3 3 m 11 11 l S 11 3 m 3 11 l S',
      ),
      stream('/Type /XObject /Subtype /Form /BBox [0 0 14 14]', '0.6 w 0 G 1 1 12 12 re S'),
      // 12 fixed combo
      widget(
        `/F 4 /FT /Ch /Ff 131072 /T (Country) /Opt [(Philippines) (Japan) (Canada)] /V (Japan) /Rect [200 660 360 678] ${DA10}`,
      ),
      // 13 editable combo (Combo | Edit)
      widget(
        `/F 4 /FT /Ch /Ff 393216 /T (City) /Opt [(Manila) (Tokyo)] /V (Tokyo) /Rect [200 630 360 648] ${DA10}`,
      ),
      // 14 password, auto size
      widget('/F 4 /FT /Tx /Ff 8192 /T (Pin) /V (secret) /Rect [200 600 300 616] /DA (/Helv 0 Tf 0 g)'),
      // 15 hidden, 16 no-view
      widget(`/F 2 /FT /Tx /T (HiddenBox) /V (HIDDEN) /Rect [195 558 360 576] ${DA10}`),
      widget(`/F 32 /FT /Tx /T (NoViewBox) /V (NOVIEW) /Rect [195 528 360 546] ${DA10}`),
      // 17 max length
      widget(`/F 4 /FT /Tx /T (Code) /MaxLen 5 /V (AB) /Rect [200 490 300 506] ${DA10}`),
      // 18 parent carrying the size, 19 its widget with no /DA
      `<< /FT /Tx /T (Inherited) /V (FROM PARENT) ${DA10} /Kids [19 0 R] >>`,
      '<< /Type /Annot /Subtype /Widget /Parent 18 0 R /P 3 0 R /F 4 /Rect [200 460 400 476] >>',
      // 20 relies on /AcroForm /DA
      widget('/F 4 /FT /Tx /T (FormDefault) /V (FROM ACROFORM) /Rect [200 430 400 446]'),
      // 21 one field, 22 and 23 its two widgets
      `<< /FT /Tx /T (Shared) /V (SAME) ${DA10} /Kids [22 0 R 23 0 R] >>`,
      '<< /Type /Annot /Subtype /Widget /Parent 21 0 R /P 3 0 R /F 4 /Rect [200 400 300 416] >>',
      '<< /Type /Annot /Subtype /Widget /Parent 21 0 R /P 3 0 R /F 4 /Rect [320 400 420 416] >>',
    ],
    1,
  );
};
```

- [ ] **Step 2: Generate and inspect it**

Run: `node scripts/make-fixtures.mjs && node scripts/inspect-form.mjs fixtures/form-kinds.pdf`
Expected: 12 widgets on page 1: 2 radio, 2 combo box, 8 text (Pin shows `<-- AUTO`), and `git status` shows `fixtures/form-kinds.pdf` as the only new or changed fixture.

- [ ] **Step 3: Commit**

```bash
git add scripts/make-fixtures.mjs fixtures/form-kinds.pdf
git commit -m "Add a fixture holding every form field shape the editor must handle"
```

---

### Task 3: Identify widgets by object number in the engine

**Files:**
- Modify: `src/engine/types.ts:295-332` (`FormFieldInfo`)
- Modify: `src/engine/forms.ts` (lookup, `describeField`, every `withFieldAnnot` caller)
- Modify: `src/engine/session.ts:259-415, 600-611` (field methods take `ref`; new `removeFormField`)
- Modify: `src/engine/worker.ts:87-96` (surface)
- Create: `tests/engine/form-kinds.test.ts`
- Modify: `tests/engine/forms.test.ts` (only if a test constructs a `FormFieldInfo` literal; add `ref`)

**Interfaces:**
- Produces in `types.ts`: `FormFieldInfo.ref: number` (widget object number, `> 0`).
- Produces in `forms.ts`: `formFieldByRef(doc: PdfDocument, pageIndex: number, ref: number): FormFieldInfo | null`. `formFieldByName` stays (tests use it) but nothing in `src/` mutates through it.
- Produces in `session.ts` and `worker.ts`:
  - `setFormFieldValue(pageIndex: number, ref: number, value: string, width?: number): Promise<CommitResult>`
  - `toggleFormFieldValue(pageIndex: number, ref: number): CommitResult`
  - `fitFormFieldWidth(pageIndex: number, ref: number): Promise<CommitResult>`
  - `moveFormField(pageIndex: number, ref: number, dx: number, dy: number): CommitResult`
  - `measureFormField(pageIndex: number, ref: number, value: string): Promise<FormFieldFit>`
  - `removeFormField(pageIndex: number, ref: number): CommitResult`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/form-kinds.test.ts
import { describe, expect, it } from 'vitest';
import { fixtureBytes, loadEngine, withBytes, withFixture } from '../helpers';
import { formFieldByName, listFormFields } from '@/engine/forms';
import { EditorSession } from '@/engine/session';

/**
 * Field shapes that once broke because widgets were looked up by name.
 *
 * Every option of a radio group shares its name, as does every widget of a
 * field shown twice, so a lookup by name always found the first. Each test
 * here saves and reopens, because this class of bug hides in the object model.
 */

async function openSession(): Promise<EditorSession> {
  await loadEngine();
  const session = new EditorSession();
  await session.open(await fixtureBytes('form-kinds.pdf'));
  return session;
}

describe('widget identity', () => {
  it('gives every widget its own ref', async () => {
    const refs = await withFixture('form-kinds.pdf', (doc) => listFormFields(doc, 0).map((f) => f.ref));
    expect(refs.every((r) => r > 0)).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('keeps refs across a reload', async () => {
    await withFixture('form-kinds.pdf', (doc) => {
      const before = listFormFields(doc, 0).map((f) => [f.name, f.ref]);
      doc.reload(doc.save());
      expect(listFormFields(doc, 0).map((f) => [f.name, f.ref])).toEqual(before);
    });
  });

  it('ticks the radio option that was tapped, not the first in its group', async () => {
    const session = await openSession();
    const [, female] = session.formFields(0).filter((f) => f.name === 'Sex');
    session.toggleFormFieldValue(0, female.ref);
    const saved = session.save();
    session.close();

    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Sex')!.value)).toBe('F');
  });

  it('moves the widget that was dragged, not its twin', async () => {
    const session = await openSession();
    const [first, second] = session.formFields(0).filter((f) => f.name === 'Shared');
    session.moveFormField(0, second.ref, 0, -40);
    const saved = session.save();
    session.close();

    const shared = await withBytes(saved, (doc) =>
      listFormFields(doc, 0).filter((f) => f.name === 'Shared'),
    );
    expect(shared[0].rect.bottom).toBeCloseTo(first.rect.bottom, 1);
    expect(shared[1].rect.bottom).toBeCloseTo(second.rect.bottom - 40, 1);
  });

  it('removes a field by ref', async () => {
    const session = await openSession();
    const code = session.formFields(0).find((f) => f.name === 'Code')!;
    session.removeFormField(0, code.ref);
    const saved = session.save();
    session.close();

    const names = await withBytes(saved, (doc) => listFormFields(doc, 0).map((f) => f.name));
    expect(names).not.toContain('Code');
  });

  it('a ref still addresses its widget after another field is deleted', async () => {
    const session = await openSession();
    const fields = session.formFields(0);
    const code = fields.find((f) => f.name === 'Code')!;
    const [, female] = fields.filter((f) => f.name === 'Sex');

    // Deleting a widget reloads the whole document from bytes.
    session.removeFormField(0, code.ref);
    session.toggleFormFieldValue(0, female.ref);
    const saved = session.save();
    session.close();

    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Sex')!.value)).toBe('F');
  });

  it('says so when a ref is no longer on the page', async () => {
    const session = await openSession();
    expect(() => session.toggleFormFieldValue(0, 999999)).toThrow(/no longer on this page/i);
    session.close();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/engine/form-kinds.test.ts`
Expected: FAIL. `ref` is undefined, and the session methods take names.

- [ ] **Step 3: Add `ref` to `FormFieldInfo`**

In `src/engine/types.ts`, inside `FormFieldInfo` after `page: number;`:

```ts
  /**
   * The widget's PDF object number, which is how a field is addressed.
   *
   * Not the name: every option of a radio group shares one, as does every
   * widget of a field shown in two places, so a lookup by name always found
   * the first. Object numbers survive the engine's own save and reload.
   */
  ref: number;
```

- [ ] **Step 4: Resolve by ref in `forms.ts`**

1. Add after `readFormString`:

```ts
/** A widget's object number; 0 for a widget written as a direct object. */
function widgetRef(doc: PdfDocument, annot: number): number {
  return doc.mod.EPDFAnnot_GetObjectNumber(annot);
}
```

2. In `describeField`, add `ref: widgetRef(doc, annot),` to the returned object after `page: pageIndex,`. A widget with `ref` 0 cannot be addressed, so set `editable` and `toggleable` to false for it and `notEditableReason` to `'This field cannot be changed here: the file stores it in a form the editor cannot address.'` when `ref === 0` and the field would otherwise be editable or toggleable.

3. Add after `formFieldByName`:

```ts
/** Find a widget by its object number. */
export function formFieldByRef(
  doc: PdfDocument,
  pageIndex: number,
  ref: number,
): FormFieldInfo | null {
  return listFormFields(doc, pageIndex).find((f) => f.ref === ref) ?? null;
}
```

4. Replace `withFieldAnnot` so it matches by ref:

```ts
/**
 * Run `fn` with the widget annotation whose object number is `ref`, then
 * close it.
 *
 * Mutations need the handle, and the handle must not escape: reopening the
 * page, which undo does, invalidates it.
 */
function withFieldAnnot<T>(
  doc: PdfDocument,
  pageIndex: number,
  ref: number,
  fn: (annot: number, form: number, annotIndex: number) => T,
): T {
  const { mod } = doc;
  const form = doc.form;
  if (!form) throw new Error('This document has no interactive form.');

  const page = doc.page(pageIndex);
  const count = mod.FPDFPage_GetAnnotCount(page);

  for (let i = 0; i < count; i++) {
    const annot = mod.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    try {
      if (widgetRef(doc, annot) === ref) return fn(annot, form, i);
    } finally {
      mod.FPDFPage_CloseAnnot(annot);
    }
  }

  throw new Error('That field is no longer on this page.');
}
```

5. Change every `withFieldAnnot(doc, field.page, field.name, ...)` in `forms.ts` to `withFieldAnnot(doc, field.page, field.ref, ...)` (in `declaredFieldSize`, `setFormFieldWidth`, `moveFormField`, `drawnAppearanceStyle`, `pinTextSize`, `effectiveFieldSize`, `appearanceIsTrustworthy`, `convertFieldToText`).

6. In `setFormFieldWidth`, replace `formFieldByName(doc, field.page, field.name)` with `formFieldByRef(doc, field.page, field.ref)`.

- [ ] **Step 5: Move the session to refs**

In `src/engine/session.ts`:

1. Import `formFieldByRef` instead of `formFieldByName`, and import `removeAnnotations` if not already imported from `./annotations`.
2. Replace `findField`:

```ts
  /**
   * Resolve a field by widget object number, at the moment of the mutation.
   *
   * Looked up again rather than trusting the `FormFieldInfo` the UI holds:
   * undo reopens the document from bytes, so a handle or index captured when
   * the editor opened would be stale by now. The object number is not.
   */
  private findField(doc: PdfDocument, pageIndex: number, ref: number): FormFieldInfo {
    const field = formFieldByRef(doc, pageIndex, ref);
    if (!field) throw new Error('That field is no longer on this page.');
    return field;
  }
```

3. In `setFormFieldValue`, `fitFormFieldWidth`, `moveFormField`, `measureFormField`, `toggleFormFieldValue`: rename the `name: string` parameter to `ref: number` and pass `ref` to every `this.findField(doc, pageIndex, ...)` call.
4. Add after `toggleFormFieldValue`:

```ts
  /**
   * Remove a field's widget from the page and from the form's field tree.
   *
   * Resolved by object number at the moment of removal, so a stale rectangle
   * or a renumbered annotation list cannot remove the wrong widget.
   */
  removeFormField(pageIndex: number, ref: number): CommitResult {
    return this.commitSync(
      'Delete form field',
      (doc) => {
        const index = withAnnotIndexOf(doc, pageIndex, ref);
        if (removeAnnotations(doc, pageIndex, [index]) === 0) {
          throw new Error('Nothing was removed.');
        }
        return [];
      },
      false,
      [pageIndex],
    );
  }
```

and export a small helper from `forms.ts` that the session uses:

```ts
/** The annotation index of the widget whose object number is `ref`. */
export function withAnnotIndexOf(doc: PdfDocument, pageIndex: number, ref: number): number {
  return withFieldAnnot(doc, pageIndex, ref, (_annot, _form, index) => index);
}
```

(import `withAnnotIndexOf` in `session.ts`).

- [ ] **Step 6: Move the worker surface to refs**

In `src/engine/worker.ts`, replace the five field entries with:

```ts
  setFormFieldValue: (pageIndex: number, ref: number, value: string, width?: number) =>
    session.setFormFieldValue(pageIndex, ref, value, width),
  toggleFormFieldValue: (pageIndex: number, ref: number) =>
    session.toggleFormFieldValue(pageIndex, ref),
  fitFormFieldWidth: (pageIndex: number, ref: number) => session.fitFormFieldWidth(pageIndex, ref),
  measureFormField: (pageIndex: number, ref: number, value: string) =>
    session.measureFormField(pageIndex, ref, value),
  moveFormField: (pageIndex: number, ref: number, dx: number, dy: number) =>
    session.moveFormField(pageIndex, ref, dx, dy),
  removeFormField: (pageIndex: number, ref: number) => session.removeFormField(pageIndex, ref),
```

- [ ] **Step 7: Run the engine tests**

Run: `pnpm vitest run tests/engine`
Expected: all pass, including the 7 new ones. `pnpm typecheck` will still fail in `src/editor/Editor.tsx` (it passes names); Task 4 fixes that, so do not commit yet if typecheck is part of your gate. Commit the engine now only if `pnpm vitest run tests/engine` is green.

- [ ] **Step 8: Commit**

```bash
git add src/engine/types.ts src/engine/forms.ts src/engine/session.ts src/engine/worker.ts tests/engine/form-kinds.test.ts tests/engine/forms.test.ts
git commit -m "Address form widgets by object number instead of by name"
```

---

### Task 4: The UI addresses fields by ref

**Files:**
- Modify: `src/editor/Editor.tsx:252-279, 346-393, 500-514, 553-575`
- Modify: `src/editor/PageView.tsx:1183` (editor key)
- Create: `tests/e2e/phone-forms.spec.ts` (shared helpers plus the first two tests)

**Interfaces:**
- Consumes: the `ref`-based worker methods from Task 3.
- Produces: `tests/e2e/phone-forms.spec.ts` with exported-in-file helpers `openApp(page)`, `openFixture(page, name)`, `pdfPoint(page, x, y, pageNumber = 1)`, `tapPdf(page, x, y)`, used by later tasks.

- [ ] **Step 1: Write the failing browser tests**

```ts
// tests/e2e/phone-forms.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { waitForLanding } from './helpers';

/**
 * Form fields on a phone, and the field kinds that once acted on the wrong
 * widget. Runs in all three engines; Firefox gets touch without `isMobile`,
 * which Playwright does not support there.
 */

const FIXTURES = join(process.cwd(), 'fixtures');

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: async ({ browserName }, use) => use(browserName !== 'firefox'),
});

async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await waitForLanding(page);
}

async function openFixture(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /choose a pdf/i }).click();
  await (await chooser).setFiles(join(FIXTURES, name));
  await expect(page.locator('canvas[aria-label="Page 1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Rendering…')).toHaveCount(0, { timeout: 30_000 });
}

/** A point in PDF space on a 612x792 page, in viewport pixels, scrolled into view. */
async function pdfPoint(page: Page, x: number, y: number, pageNumber = 1) {
  const canvas = page.locator(`canvas[aria-label="Page ${pageNumber}"]`);
  let box = (await canvas.boundingBox())!;
  const vy = box.y + (792 - y) * (box.height / 792);
  const vh = page.viewportSize()!.height;
  if (vy < 120 || vy > vh - 160) {
    await page.evaluate((d) => document.querySelector('main')?.scrollBy(0, d), vy - vh / 2);
    await page.waitForTimeout(250);
    box = (await canvas.boundingBox())!;
  }
  return { x: box.x + x * (box.width / 612), y: box.y + (792 - y) * (box.height / 792) };
}

async function tapPdf(page: Page, x: number, y: number): Promise<void> {
  const p = await pdfPoint(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
}

const outline = (page: Page) => page.locator('[role="group"][aria-label^="Selected:"]');

test('tapping the second radio option selects it', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-kinds.pdf');

  // Select tool: first tap selects, second activates.
  await tapPdf(page, 267, 707);
  await expect(outline(page)).toBeVisible();
  await tapPdf(page, 267, 707);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });

  // The F box now carries the cross: more dark pixels than the M box.
  const ink = await page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Page 1"]') as HTMLCanvasElement;
    const sx = c.width / 612;
    const count = (left: number) => {
      const d = c.getContext('2d')!.getImageData(Math.floor(left * sx), Math.floor((792 - 714) * sx), Math.ceil(14 * sx), Math.ceil(14 * sx)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 140) n++;
      return n;
    };
    return { m: count(200), f: count(260) };
  });
  expect(ink.f).toBeGreaterThan(ink.m);
});

test('undo clears a field selection', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  // Make an undo entry by ticking the Female box (select, then tap again).
  await tapPdf(page, 248, 544);
  await tapPdf(page, 248, 544);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
  await tapPdf(page, 300, 665);
  await expect(outline(page)).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(outline(page)).toHaveCount(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts --project=chromium`
Expected: the build fails typecheck in `Editor.tsx` (names passed where refs are expected). That is the failure this task fixes.

- [ ] **Step 3: Pass refs from `Editor.tsx`**

1. `commitFormField`: `engine.setFormFieldValue(field.page, field.ref, value, width)`.
2. `toggleFormField`: `engine.toggleFormFieldValue(field.page, field.ref)`.
3. `widenField`: `engine.fitFormFieldWidth(field.page, field.ref)`.
4. Replace `deleteField` and its doc comment with:

```tsx
  /**
   * Remove a form field's widget from the page and from the form's field tree.
   *
   * Addressed by the widget's object number, which survives undo and reloads,
   * rather than by rectangle: a rectangle held in the selection goes stale the
   * moment the field is moved and the move undone.
   */
  const deleteField = useCallback(
    async (field: FormFieldInfo) => {
      setBusy('Removing the field…');
      try {
        await absorb(await engine.removeFormField(field.page, field.ref));
      } catch (error) {
        notify('error', describe(error, 'That field could not be removed.'));
      } finally {
        setBusy(null);
      }
    },
    [engine, absorb, notify],
  );
```

5. `moveField`: call `engine.moveFormField(field.page, field.ref, dx, dy)` and re-read with `.find((f) => f.ref === field.ref)`. Update its doc comment's last sentence to say `deleteField` finds the widget by its object number.
6. In `undo` and `redo`, after `if (result) await absorb(result);` add:

```tsx
      // A selected field's rectangle and value describe the state being left.
      if (store.getState().selection?.field) setSelection(null);
```

and add `store` and `setSelection` to both dependency arrays.

- [ ] **Step 4: Key the field editor by ref**

In `src/editor/PageView.tsx` change `key={`field:${editTarget.field.name}`}` to `key={`field:${editTarget.field.ref}`}`.

- [ ] **Step 5: Build, then run the tests**

Run: `pnpm typecheck && pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts tests/e2e/forms.spec.ts --project=chromium`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/editor/Editor.tsx src/editor/PageView.tsx tests/e2e/phone-forms.spec.ts
git commit -m "Address fields by object number from the editor"
```

---

### Task 5: Keep appearance sizes across reload and undo

**Files:**
- Modify: `src/engine/document.ts:36-48, 63-68, 112-121, 150-220, 222-233, 486`
- Modify: `src/engine/forms.ts:126-172, 508-536, 597-625, 634-659, 671, 696-701`
- Modify: `src/engine/session.ts:722-732` (`reopenSync`)
- Modify: `CLAUDE.md` (the "Record appearance sizes" rule)
- Test: `tests/engine/form-kinds.test.ts`

**Interfaces:**
- Produces in `PdfDocument`:
  - `static open(mod, bytes, password = '', appearanceSizes?: ReadonlyMap<number, number>): PdfDocument`
  - `get appearanceSizes(): ReadonlyMap<number, number>` (widget ref to size; only widgets whose own appearance drew a positive size)
  - `originalApSize(ref: number): number | null`
  - `originalApSizesOnPage` is removed.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/form-kinds.test.ts`:

```ts
// (formFieldByName and listFormFields are already imported at the top of the file.)

describe('appearance sizes', () => {
  it('survive a reload of the document', async () => {
    await withFixture('autosize-no-appearance.pdf', (doc) => {
      expect(formFieldByName(doc, 0, 'Surname')!.textSize).toBe(9);
      doc.reload(doc.save());
      expect(formFieldByName(doc, 0, 'Surname')!.textSize).toBe(9);
    });
  });

  it('survive undo', async () => {
    await loadEngine();
    const session = new EditorSession();
    await session.open(await fixtureBytes('autosize-no-appearance.pdf'));
    const given = session.formFields(0).find((f) => f.name === 'GivenNames')!;

    await session.setFormFieldValue(0, given.ref, 'JANE');
    await session.undo();

    expect(session.formFields(0).find((f) => f.name === 'Surname')!.textSize).toBe(9);
    session.close();
  });
});
```

No new imports are needed for these two tests.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/engine/form-kinds.test.ts -t "appearance sizes"`
Expected: FAIL, 18 received where 9 is expected.

- [ ] **Step 3: Re-key the snapshot in `document.ts`**

1. Replace the `originalApSizes` field and its comment with:

```ts
  /**
   * Type size each widget's own appearance stream draws at, by widget object
   * number. Taken once, at the first open of a file, and carried into every
   * later open of the same session: bytes saved after the form environment
   * existed hold appearances PDFium generated at the auto size, so a snapshot
   * re-taken from them records the bug as the file's own.
   */
  private originalApSizes = new Map<number, number>();
```

2. Change `open`:

```ts
  static open(
    mod: WrappedPdfiumModule,
    bytes: Uint8Array,
    password = '',
    appearanceSizes?: ReadonlyMap<number, number>,
  ): PdfDocument {
    const { handle, dataPtr } = PdfDocument.load(mod, bytes, password);
    const doc = new PdfDocument(mod, handle, dataPtr, bytes.byteLength);
    if (appearanceSizes) doc.originalApSizes = new Map(appearanceSizes);
    doc.initFormEnvironment(appearanceSizes === undefined);
    return doc;
  }
```

3. In `reload`, keep the snapshot: save `const sizes = this.originalApSizes;` before `this.release();`, restore `this.originalApSizes = sizes;` after it, and call `this.initFormEnvironment(false);`.
4. `initFormEnvironment(snapshot: boolean)`: run `this.snapshotAppearanceSizes()` only when `snapshot` is true.
5. Replace the accessors:

```ts
  /** The size the file's own appearance for a widget draws at, if it had one. */
  originalApSize(ref: number): number | null {
    return this.originalApSizes.get(ref) ?? null;
  }

  /** Every recorded size, for carrying into the next open of this session. */
  get appearanceSizes(): ReadonlyMap<number, number> {
    return this.originalApSizes;
  }
```

6. In `snapshotAppearanceSizes`, key by `mod.EPDFAnnot_GetObjectNumber(annot)` and store only positive sizes for refs `> 0`:

```ts
        if (annot) {
          const ref = mod.EPDFAnnot_GetObjectNumber(annot);
          const needed = mod.FPDFAnnot_GetAP(annot, AP_NORMAL, 0, 0);
          if (ref > 0 && needed > 2) {
            const text = withScope(mod, (scope) => {
              const buffer = scope.alloc(needed);
              mod.FPDFAnnot_GetAP(annot, AP_NORMAL, buffer, needed);
              return mod.pdfium.UTF16ToString(buffer);
            });
            const match = APPEARANCE_TF.exec(text);
            if (match && Number(match[1]) > 0) this.originalApSizes.set(ref, Number(match[1]));
          }
          mod.FPDFPage_CloseAnnot(annot);
        }
```

Drop the per-page `sizes` array and `this.originalApSizes.set(p, sizes)`. Rewrite the method's doc comment to match (keyed by object number, taken once per session).

7. In `release` (line ~486), delete `this.originalApSizes.clear();` (the map is replaced, not shared, so `reload` can carry it).

- [ ] **Step 4: Read sizes by ref in `forms.ts`**

1. `describeField`: replace the `annotIndex: number` parameter with nothing; compute `const ref = widgetRef(doc, annot);` and pass `ref` to `drawnSize`. Update both callers (`formFieldAt`, `listFormFields`) to stop passing the index. Update the doc comment that explains `annotIndex`.
2. `drawnSize(doc, annot, ref, rect, siblings)`: step 2 reads `doc.originalApSize(ref)`. Remove the `annotIndex` and `pageIndex` parameters.
3. `siblingFieldSizes`: replace `const sizes: number[] = [...doc.originalApSizesOnPage(pageIndex)];` with an empty array, and inside the loop, for each widget, push `doc.originalApSize(widgetRef(doc, annot))` when it is not null, in addition to the declared size.
4. `resolveTextSize(doc, field, annot)`: drop `annotIndex`, call `drawnSize(doc, annot, field.ref, field.rect, pageTypeSizes(doc, field.page))`.
5. `pinTextSize` and `effectiveFieldSize`: drop the `annotIndex` argument they pass on.

- [ ] **Step 5: Carry the snapshot through the session**

In `src/engine/session.ts` `reopenSync`:

```ts
  private reopenSync(bytes: Uint8Array): void {
    if (!this.mod) throw new Error('The PDF engine is not loaded.');
    // The sizes recorded at the first open of this file, not sizes read off
    // bytes PDFium has already regenerated: see `PdfDocument.appearanceSizes`.
    const sizes = this.doc?.appearanceSizes;
    this.closeDocument();
    this.doc = PdfDocument.open(this.mod, bytes, '', sizes);
    this.signatureScan = null;
  }
```

`closeDocument` closes the old document; take the map reference before it, which is safe because `release` no longer clears it.

- [ ] **Step 6: Run the engine tests**

Run: `pnpm vitest run tests/engine`
Expected: all pass, including the two new ones.

- [ ] **Step 7: Correct `CLAUDE.md`**

In the "Record appearance sizes before the form environment exists" rule, replace the last sentence ("The snapshot is keyed by annotation index ... so it cannot go stale.") with:

```markdown
The snapshot is keyed by widget object number and taken once, at the first
open of a file. `reload` and the session's reopen for undo, redo and rollback
carry it forward, because every later open reads bytes that `doc.save()` wrote
after the environment existed: re-snapshotting them recorded PDFium's 18pt
auto size as the file's own, and an undo brought every auto-sized field back
at 18pt.
```

- [ ] **Step 8: Commit**

```bash
git add src/engine/document.ts src/engine/forms.ts src/engine/session.ts tests/engine/form-kinds.test.ts CLAUDE.md
git commit -m "Keep recorded appearance sizes across reload and undo"
```

---

### Task 6: Inherited sizes, hidden widgets, password fields and MaxLen

**Files:**
- Modify: `src/engine/types.ts` (`FormFieldInfo`)
- Modify: `src/engine/forms.ts:42-57, 126-172, 181-246, 544-548, 634-659, 717-725`
- Modify: `src/engine/session.ts:259-300` (never convert a password field)
- Test: `tests/engine/form-kinds.test.ts`

**Interfaces:**
- Produces in `FormFieldInfo`: `password: boolean`, `maxLen?: number`.
- Produces: hidden and no-view widgets are absent from `listFormFields` and `formFieldAt`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/form-kinds.test.ts`:

```ts
// Add formFieldAt to the existing @/engine/forms import, and:
import { getTextLines } from '@/engine/text';

describe('field kinds', () => {
  it('reads a size declared on the parent field', async () => {
    const field = await withFixture('form-kinds.pdf', (doc) => formFieldByName(doc, 0, 'Inherited')!);
    expect(field.textSize).toBe(10);
    expect(field.clips).toBe(true);
  });

  it('reads a size declared on the form', async () => {
    const field = await withFixture('form-kinds.pdf', (doc) => formFieldByName(doc, 0, 'FormDefault')!);
    expect(field.textSize).toBe(9);
    expect(field.clips).toBe(true);
  });

  it('still treats an auto size as auto', async () => {
    const field = await withFixture('autosize-field.pdf', (doc) => formFieldByName(doc, 0, 'Surname')!);
    expect(field.clips).toBe(false);
  });

  it('keeps an edited inherited-size field a form field', async () => {
    const session = await openSession();
    const field = session.formFields(0).find((f) => f.name === 'Inherited')!;
    await session.setFormFieldValue(0, field.ref, 'EDITED');
    const saved = session.save();
    session.close();

    const after = await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Inherited'));
    expect(after?.value).toBe('EDITED');
  });

  it('does not list hidden or no-view widgets, or hit them', async () => {
    await withFixture('form-kinds.pdf', (doc) => {
      const names = listFormFields(doc, 0).map((f) => f.name);
      expect(names).not.toContain('HiddenBox');
      expect(names).not.toContain('NoViewBox');
      expect(formFieldAt(doc, 0, 250, 567)).toBeNull();
      expect(formFieldAt(doc, 0, 250, 537)).toBeNull();
      // And the text under them is still reachable.
      expect(getTextLines(doc, 0).some((l) => l.text.includes('UNDER HIDDEN'))).toBe(true);
    });
  });

  it('reports a password field, and never draws its value as page text', async () => {
    const session = await openSession();
    const pin = session.formFields(0).find((f) => f.name === 'Pin')!;
    expect(pin.password).toBe(true);

    await session.setFormFieldValue(0, pin.ref, 'hunter2');
    const saved = session.save();
    session.close();

    await withBytes(saved, (doc) => {
      expect(formFieldByName(doc, 0, 'Pin')?.value).toBe('hunter2');
      expect(getTextLines(doc, 0).some((l) => l.text.includes('hunter2'))).toBe(false);
    });
  });

  it('reports the length limit', async () => {
    const code = await withFixture('form-kinds.pdf', (doc) => formFieldByName(doc, 0, 'Code')!);
    expect(code.maxLen).toBe(5);
  });
});
```

(Keep one import line per module at the top of the file.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/engine/form-kinds.test.ts -t "field kinds"`
Expected: FAIL on textSize, hidden listing, `password` and `maxLen`.

- [ ] **Step 3: Implement in `forms.ts`**

1. Extend `FormFlag`:

```ts
  /** The value is masked as it is typed. */
  Password: 1 << 13,
  /** A combo box whose value can also be typed. */
  Edit: 1 << 18,
```

2. Add annotation flag constants and a visibility check after `FormFlag`:

```ts
/** `/F` annotation flags, PDF 32000 table 165. */
const AnnotFlag = {
  Hidden: 1 << 1,
  NoView: 1 << 5,
} as const;

/** A widget that is not drawn on screen is not something a user can tap. */
function isShown(doc: PdfDocument, annot: number): boolean {
  const flags = doc.mod.FPDFAnnot_GetFlags(annot);
  return (flags & (AnnotFlag.Hidden | AnnotFlag.NoView)) === 0;
}
```

3. In `formFieldAt`, after `if (!annot) return null;`, return null (closing the annotation) when `!isShown(doc, annot)`:

```ts
  if (!isShown(doc, annot)) {
    mod.FPDFPage_CloseAnnot(annot);
    return null;
  }
```

In `listFormFields`, skip `!isShown(doc, annot)` inside the `try` before describing.

4. Replace `declaredSize`:

```ts
/**
 * The type size a widget's `/DA` declares, or 0 when it says "auto".
 *
 * Read through `FPDFAnnot_GetFontSize`, which resolves `/DA` the way PDFium
 * will when it draws: the widget, then its parent fields, then `/AcroForm`.
 * Reading the widget's own dictionary found nothing for a size set on the
 * parent, called that "auto", and converted a perfectly well-specified field
 * into page text. An auto size still reads as 0 through this call.
 */
function declaredSize(doc: PdfDocument, annot: number): number {
  const { mod } = doc;
  const form = doc.form;
  if (form) {
    const size = withScope(mod, (scope) => {
      const ptr = scope.allocFloat();
      return mod.FPDFAnnot_GetFontSize(form, annot, ptr)
        ? (mod.pdfium.getValue(ptr, 'float') as number)
        : null;
    });
    if (size !== null) return size;
  }
  const match = TF.exec(readAnnotString(doc, annot, 'DA'));
  return match ? Number(match[2]) : 0;
}
```

5. In `resolveTextSize`, replace `if (daTf && Number(daTf[2]) > 0) return null;` with `if (declaredSize(doc, annot) > 0) return null;` (keep reading `da` and `daTf` for the font name).

6. In `siblingFieldSizes`, replace the inline `TF.exec(readAnnotString(doc, annot, 'DA'))` with `const size = declaredSize(doc, annot);`.

7. Add a MaxLen reader:

```ts
/** The widget's `/MaxLen`, when it has one. Not inherited from a parent. */
function readMaxLen(doc: PdfDocument, annot: number): number | undefined {
  const { mod } = doc;
  return withScope(mod, (scope) => {
    const ptr = scope.allocFloat();
    if (!mod.FPDFAnnot_GetNumberValue(annot, 'MaxLen', ptr)) return undefined;
    const value = mod.pdfium.getValue(ptr, 'float') as number;
    return value > 0 ? Math.round(value) : undefined;
  });
}
```

8. In `describeField` add to the returned object:

```ts
    password: kind === 'text' && (flags & FormFlag.Password) !== 0,
    maxLen: kind === 'text' ? readMaxLen(doc, annot) : undefined,
```

- [ ] **Step 4: Add the fields to `FormFieldInfo`**

In `src/engine/types.ts`:

```ts
  /** A password field: its value is masked and never drawn as page text. */
  password: boolean;
  /** The most characters the field accepts, when the form sets a limit. */
  maxLen?: number;
```

- [ ] **Step 5: Never convert a password field**

In `session.ts` `setFormFieldValue`, change the conversion condition to:

```ts
        // A password field stays a field whatever its size says: converting it
        // would draw the secret into the page as readable text.
        if (!field.password && !appearanceIsTrustworthy(doc, field)) {
```

and add a sentence to the existing comment above it saying so.

- [ ] **Step 6: Run the engine tests**

Run: `pnpm vitest run tests/engine`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/engine/types.ts src/engine/forms.ts src/engine/session.ts tests/engine/form-kinds.test.ts
git commit -m "Resolve inherited field sizes and skip hidden and password traps"
```

---

### Task 7: Combo box choices

**Files:**
- Modify: `src/engine/types.ts` (`FormFieldInfo`)
- Modify: `src/engine/forms.ts` (read options; `setFormFieldChoice`)
- Modify: `src/engine/session.ts:259-300` (route choice fields)
- Create: `src/editor/ChoiceEditor.tsx`
- Modify: `src/editor/PageView.tsx:1181-1210` (render it for a fixed combo; pass `password` and `maxLen` to the text editor)
- Modify: `src/editor/InlineTextEditor.tsx` (props `password`, `maxLength`)
- Test: `tests/engine/form-kinds.test.ts`, `tests/e2e/phone-forms.spec.ts`

**Interfaces:**
- Produces in `FormFieldInfo`: `options?: string[]`, `editableChoice: boolean`.
- Produces in `forms.ts`: `setFormFieldChoice(doc: PdfDocument, field: FormFieldInfo, value: string): void`.
- Produces: `ChoiceEditor` props `{ field: FormFieldInfo; transform: PageTransform; onCommit: (value: string) => void | Promise<void>; onCancel: () => void }`.
- Produces in `InlineTextEditor`: optional props `password?: boolean`, `maxLength?: number`.

- [ ] **Step 1: Write the failing engine tests**

Append to `tests/engine/form-kinds.test.ts`:

```ts
describe('combo boxes', () => {
  it('lists the options and says whether typing is allowed', async () => {
    await withFixture('form-kinds.pdf', (doc) => {
      const country = formFieldByName(doc, 0, 'Country')!;
      expect(country.options).toEqual(['Philippines', 'Japan', 'Canada']);
      expect(country.editableChoice).toBe(false);
      expect(formFieldByName(doc, 0, 'City')!.editableChoice).toBe(true);
    });
  });

  it('chooses an option, and the choice is in the saved file', async () => {
    const session = await openSession();
    const country = session.formFields(0).find((f) => f.name === 'Country')!;
    await session.setFormFieldValue(0, country.ref, 'Canada');
    const saved = session.save();
    session.close();
    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Country')?.value)).toBe('Canada');
  });

  it('accepts typed text in an editable combo', async () => {
    const session = await openSession();
    const city = session.formFields(0).find((f) => f.name === 'City')!;
    await session.setFormFieldValue(0, city.ref, 'Cebu');
    const saved = session.save();
    session.close();
    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'City')?.value)).toBe('Cebu');
  });

  it('refuses a value a fixed combo does not offer', async () => {
    const session = await openSession();
    const country = session.formFields(0).find((f) => f.name === 'Country')!;
    await expect(session.setFormFieldValue(0, country.ref, 'Narnia')).rejects.toThrow(
      /not one of the choices/i,
    );
    const saved = session.save();
    session.close();
    expect(await withBytes(saved, (doc) => formFieldByName(doc, 0, 'Country')?.value)).toBe('Japan');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/engine/form-kinds.test.ts -t "combo boxes"`
Expected: FAIL (`options` undefined, value unchanged).

- [ ] **Step 3: Implement in `forms.ts`**

1. Add:

```ts
/** A choice field's option labels, in order. */
function readOptions(doc: PdfDocument, form: number, annot: number): string[] {
  const { mod } = doc;
  const count = mod.FPDFAnnot_GetOptionCount(form, annot);
  const options: string[] = [];
  for (let i = 0; i < count; i++) {
    options.push(
      readFormString(doc, annot, (b, n) => mod.FPDFAnnot_GetOptionLabel(form, annot, i, b, n)),
    );
  }
  return options;
}
```

2. In `describeField` add:

```ts
    options: kind === 'choice' ? readOptions(doc, form, annot) : undefined,
    editableChoice: kind === 'choice' && (flags & FormFlag.Edit) !== 0,
```

3. Add after `setFormFieldText`:

```ts
/**
 * Choose one of a combo box's options.
 *
 * Through `FORM_SetIndexSelected` on the focused field, committed by killing
 * focus, so PDFium writes `/V` and rebuilds the appearance together. Typing
 * into a fixed combo did nothing at all: the replace call has no edit box to
 * act on, returned without error, and the value stayed as it was. An
 * editable combo also takes free text, through the ordinary text path.
 */
export function setFormFieldChoice(doc: PdfDocument, field: FormFieldInfo, value: string): void {
  const { mod } = doc;
  const form = doc.form;
  if (!form) throw new Error('This document has no interactive form.');
  if (field.readOnly) throw new Error(field.notEditableReason ?? 'This field is read-only.');

  const index = (field.options ?? []).indexOf(value);
  if (index < 0) {
    if (field.editableChoice) return setFormFieldText(doc, field, value);
    throw new Error(`"${value}" is not one of the choices this field offers.`);
  }

  const page = doc.page(field.page);
  const { x, y } = centreOf(field);
  mod.FORM_OnLButtonDown(form, page, 0, x, y);
  mod.FORM_OnLButtonUp(form, page, 0, x, y);
  const chosen = mod.FORM_SetIndexSelected(form, page, index, true);
  mod.FORM_ForceToKillFocus(form);
  if (!chosen) throw new Error('That choice could not be selected.');
}
```

If the "chooses an option" test still fails because the click opened PDFium's own list popup and `FORM_SetIndexSelected` returned false, drop the `FORM_OnLButtonUp` call (a press focuses the widget without toggling the popup) and re-run. Do not fall back to writing `/V`.

- [ ] **Step 4: Route choice fields in the session, and never convert them**

In `session.ts` `setFormFieldValue`, as the first statement inside the mutate callback after `findField`:

```ts
        // A combo box is chosen, not typed into, and never drawn as page text.
        if (field.kind === 'choice') {
          setFormFieldChoice(doc, field, value);
          return [];
        }
```

(import `setFormFieldChoice`).

- [ ] **Step 5: Add the fields to `FormFieldInfo`**

```ts
  /** A combo box's options, in order. */
  options?: string[];
  /** A combo box that also accepts a typed value. */
  editableChoice: boolean;
```

- [ ] **Step 6: Run the engine tests**

Run: `pnpm vitest run tests/engine`
Expected: all pass.

- [ ] **Step 7: Write the failing browser test**

Append to `tests/e2e/phone-forms.spec.ts`:

```ts
test('a fixed combo opens a list of its options and saves the choice', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-kinds.pdf');

  await tapPdf(page, 280, 669);
  await tapPdf(page, 280, 669);
  const select = page.getByRole('combobox', { name: /choose/i });
  await expect(select).toBeVisible({ timeout: 20_000 });
  await select.selectOption('Canada');

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
  await expect(select).toHaveCount(0);
});
```

- [ ] **Step 8: Create `ChoiceEditor.tsx`**

```tsx
// src/editor/ChoiceEditor.tsx
'use client';

import { useLayoutEffect, useRef } from 'react';
import { formFieldPhrase } from '@/engine/form-label';
import type { FormFieldInfo } from '@/engine/types';
import { pdfRectToCss, type PageTransform } from './transform';

/**
 * A combo box, edited as a list of its options.
 *
 * A native `<select>` over the field, because the platform picker is the
 * right control on a phone and typing into a fixed combo cannot work: the
 * value has to be one of the options. An editable combo goes to the text
 * editor instead, since it takes free text.
 */
export function ChoiceEditor({
  field,
  transform,
  onCommit,
  onCancel,
}: {
  field: FormFieldInfo;
  transform: PageTransform;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSelectElement | null>(null);

  useLayoutEffect(() => {
    const select = ref.current as (HTMLSelectElement & { showPicker?: () => void }) | null;
    if (!select) return;
    select.focus();
    try {
      // Opens the list at once where the browser allows it; elsewhere the
      // focused select opens on the next tap.
      select.showPicker?.();
    } catch {
      /* Not allowed outside a user gesture in some browsers. */
    }
  }, []);

  const box = pdfRectToCss(transform, field.rect);
  const options = field.options ?? [];

  return (
    <select
      ref={ref}
      className="absolute rounded"
      aria-label={`Choose ${formFieldPhrase(field)}`}
      style={{
        left: box.left,
        top: box.top,
        width: Math.max(box.width, 44),
        minHeight: Math.max(box.height, 32),
        fontSize: 16,
        background: '#ffffff',
        color: '#000000',
        outline: '1.5px solid var(--app-accent)',
      }}
      defaultValue={field.value}
      onChange={(event) => void onCommit(event.target.value)}
      onBlur={onCancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        event.stopPropagation();
      }}
    >
      {!options.includes(field.value) && <option value={field.value}>{field.value}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 9: Render it from `PageView.tsx`, and pass password and length to the text editor**

Replace the `{editTarget?.kind === 'field' && transform && (<InlineTextEditor ... />)}` block's opening with a branch:

```tsx
      {editTarget?.kind === 'field' &&
        transform &&
        editTarget.field.kind === 'choice' &&
        !editTarget.field.editableChoice && (
          <ChoiceEditor
            key={`choice:${editTarget.field.ref}`}
            field={editTarget.field}
            transform={transform}
            onCancel={() => setFieldTarget(null)}
            onCommit={async (value) => {
              const field = editTarget.field;
              setFieldTarget(null);
              if (value !== field.value) await onCommitField(field, value);
            }}
          />
        )}

      {editTarget?.kind === 'field' &&
        transform &&
        !(editTarget.field.kind === 'choice' && !editTarget.field.editableChoice) && (
          <InlineTextEditor
            key={`field:${editTarget.field.ref}`}
            ... existing props unchanged ...
            password={editTarget.field.password}
            maxLength={editTarget.field.maxLen}
          />
        )}
```

Import `ChoiceEditor` from `./ChoiceEditor`.

- [ ] **Step 10: Accept `password` and `maxLength` in `InlineTextEditor`**

Add to `InlineTextEditorProps`:

```ts
  /** Mask the value as it is typed. */
  password?: boolean;
  /** The most characters the field accepts. */
  maxLength?: number;
```

destructure them, and on the `<input>` add `type={password ? 'password' : 'text'}` and `maxLength={maxLength}`. Under the input, when `maxLength !== undefined && maxLength - value.length <= 5`, render a counter:

```tsx
      {maxLength !== undefined && maxLength - value.length <= 5 && (
        <div
          className="pointer-events-none absolute rounded px-1.5 py-0.5 text-[11px]"
          style={{ top: '100%', right: 0, marginTop: 4, background: 'var(--app-panel)', color: 'var(--app-text-dim)' }}
        >
          {value.length}/{maxLength}
        </div>
      )}
```

- [ ] **Step 11: Build the worker and the site, run the tests**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts --project=chromium && pnpm test:e2e tests/e2e/phone-forms.spec.ts --project=webkit`
Expected: all pass. On WebKit `selectOption` drives the native select without a picker; that is expected.

- [ ] **Step 12: Commit**

```bash
git add src/engine/types.ts src/engine/forms.ts src/engine/session.ts src/editor/ChoiceEditor.tsx src/editor/PageView.tsx src/editor/InlineTextEditor.tsx tests/engine/form-kinds.test.ts tests/e2e/phone-forms.spec.ts
git commit -m "Choose combo box options instead of silently ignoring edits"
```

---

### Task 8: Touch-safe drags

**Files:**
- Create: `src/editor/pointer.ts`
- Create: `tests/editor/pointer.test.ts`
- Modify: `src/editor/PageView.tsx:1009-1062` (cover marquee), `1333-1409` (`SelectionOutline`), canvas `style` at `1087-1096`
- Test: `tests/e2e/phone-forms.spec.ts`

**Interfaces:**
- Produces:
  - `dragThreshold(pointerType: string): number` (3 for `mouse`, 10 otherwise)
  - `trackPointer(start: { pointerId: number; pointerType: string; clientX: number; clientY: number; button: number }, handlers: { onMove?: (dx: number, dy: number) => void; onEnd: (dx: number, dy: number, moved: boolean) => void; onCancel?: () => void }, options?: { capture?: Element; win?: Pick<Window, 'addEventListener' | 'removeEventListener'> }): boolean` (returns false and does nothing for a non-primary button)

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/editor/pointer.test.ts
import { describe, expect, it, vi } from 'vitest';
import { dragThreshold, trackPointer } from '@/editor/pointer';

function pointerEvent(type: string, init: Record<string, number>): Event {
  return Object.assign(new Event(type), init);
}

const start = { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, button: 0 };

describe('trackPointer', () => {
  it('uses a larger threshold for a finger than for a mouse', () => {
    expect(dragThreshold('mouse')).toBe(3);
    expect(dragThreshold('touch')).toBe(10);
    expect(dragThreshold('pen')).toBe(10);
  });

  it('treats a shaky finger tap as a tap', () => {
    const win = new EventTarget() as unknown as Window;
    const onEnd = vi.fn();
    trackPointer(start, { onEnd }, { win });
    win.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 106, clientY: 104 }));
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 106, clientY: 104 }));
    expect(onEnd).toHaveBeenCalledWith(6, 4, false);
  });

  it('reports a drag once past the threshold', () => {
    const win = new EventTarget() as unknown as Window;
    const onMove = vi.fn();
    const onEnd = vi.fn();
    trackPointer(start, { onMove, onEnd }, { win });
    win.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 140 }));
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 140 }));
    expect(onMove).toHaveBeenCalledWith(0, 40);
    expect(onEnd).toHaveBeenCalledWith(0, 40, true);
  });

  it('ignores other pointers', () => {
    const win = new EventTarget() as unknown as Window;
    const onEnd = vi.fn();
    trackPointer(start, { onEnd }, { win });
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 0, clientY: 0 }));
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('abandons the drag on pointercancel', () => {
    const win = new EventTarget() as unknown as Window;
    const onEnd = vi.fn();
    const onCancel = vi.fn();
    trackPointer(start, { onEnd, onCancel }, { win });
    win.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 160 }));
    win.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1, clientX: 100, clientY: 160 }));
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 160 }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('ignores a non-primary button', () => {
    const win = new EventTarget() as unknown as Window;
    const onEnd = vi.fn();
    expect(trackPointer({ ...start, button: 2 }, { onEnd }, { win })).toBe(false);
    win.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 100 }));
    expect(onEnd).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/editor/pointer.test.ts`
Expected: FAIL, cannot resolve `@/editor/pointer`.

- [ ] **Step 3: Implement `pointer.ts`**

```ts
// src/editor/pointer.ts
/**
 * Following one pointer from press to release.
 *
 * Shared by every drag on the page, because each of them got the same things
 * wrong on a phone. A touch that the browser decides is a pan arrives as
 * `pointercancel`, never `pointerup`, and nothing listened for it, so the drag
 * stayed half-finished with its listeners attached. A second finger's events
 * were taken for the first's. And a three-pixel threshold turned an ordinary
 * finger tap, which drifts, into a nudge with an undo entry.
 */

/** How far a press must travel to be a drag rather than a tap, in CSS pixels. */
export function dragThreshold(pointerType: string): number {
  return pointerType === 'mouse' ? 3 : 10;
}

interface Start {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button: number;
}

interface Handlers {
  onMove?: (dx: number, dy: number) => void;
  onEnd: (dx: number, dy: number, moved: boolean) => void;
  onCancel?: () => void;
}

interface Options {
  /** Element to capture the pointer to, so it keeps receiving events off it. */
  capture?: Element;
  /** Where to listen. The window, except in tests. */
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** Returns false, and does nothing, for any button but the primary one. */
export function trackPointer(start: Start, handlers: Handlers, options: Options = {}): boolean {
  if (start.button !== 0) return false;

  const win = options.win ?? window;
  const capture = options.capture;
  const threshold = dragThreshold(start.pointerType);
  let moved = false;
  let last = { x: 0, y: 0 };

  try {
    capture?.setPointerCapture(start.pointerId);
  } catch {
    /* Capture is a convenience; the window listeners still work without it. */
  }

  const onMove = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerId !== start.pointerId) return;
    last = { x: e.clientX - start.clientX, y: e.clientY - start.clientY };
    if (!moved && Math.hypot(last.x, last.y) >= threshold) moved = true;
    if (moved) handlers.onMove?.(last.x, last.y);
  };

  const finish = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerId !== start.pointerId) return;
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', finish);
    win.removeEventListener('pointercancel', finish);
    try {
      if (capture?.hasPointerCapture(start.pointerId)) capture.releasePointerCapture(start.pointerId);
    } catch {
      /* The pointer may already be gone, which is fine. */
    }
    if (event.type === 'pointercancel') handlers.onCancel?.();
    else handlers.onEnd(last.x, last.y, moved);
  };

  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', finish);
  win.addEventListener('pointercancel', finish);
  return true;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm vitest run tests/editor/pointer.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Use it in `SelectionOutline`**

Replace `startDrag` in `src/editor/PageView.tsx`:

```tsx
  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      const started = trackPointer(
        event,
        {
          onMove: (x, y) => setDrag({ x, y }),
          onCancel: () => setDrag(null),
          onEnd: (x, y, moved) => {
            setDrag(null);
            // A press that did not travel is a tap: it must not nudge anything
            // or leave an undo entry, and on a form field it opens the value.
            // Decided here rather than in a click handler, because the
            // pointerdown below calls `preventDefault` and WebKit then never
            // synthesises the click that would follow.
            if (!moved) {
              onActivate?.();
              return;
            }
            const { dx, dy } = cssDeltaToPdf(transform, x, y);
            void onMove(dx, dy);
          },
        },
        { capture: event.currentTarget },
      );
      if (!started) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [transform, onMove, onActivate],
  );
```

On the outline `<div>`'s `style`, add `touchAction: 'none'` with a comment:

```tsx
        // Without this a finger drag is taken as a page pan: the browser
        // cancels the pointer and the field never moves. Only the outline, so
        // the page itself keeps pinch-zoom.
        touchAction: 'none',
```

Import `trackPointer` from `./pointer`.

- [ ] **Step 6: Use it in the cover marquee**

Replace the body of `handlePointerDown` after `if (tool !== 'cover' || !transform) return;`:

```tsx
      const start = localPoint(event);
      const started = trackPointer(
        event,
        {
          onMove: (dx, dy) => {
            const cx = start.x + dx;
            const cy = start.y + dy;
            setMarquee({
              x: Math.min(start.x, cx),
              y: Math.min(start.y, cy),
              w: Math.abs(cx - start.x),
              h: Math.abs(cy - start.y),
            });
          },
          onCancel: () => setMarquee(null),
          onEnd: () => {
            const box = marqueeRef.current;
            setMarquee(null);
            if (!box || box.w < 4 || box.h < 4) return;
            const rect = cssRectToPdf(transform, { left: box.x, top: box.y, width: box.w, height: box.h });
            void (async () => {
              // Sample the page behind the rectangle so a cover over a shaded
              // cell matches it instead of leaving a white patch.
              let colour = { r: 255, g: 255, b: 255, a: 255 };
              try {
                colour = await engine.sampleBackground(page.index, rect);
              } catch {
                /* White is a reasonable default if sampling fails. */
              }
              addOverlay({ id: nextOverlayId(), page: page.index, rect, kind: 'cover', colour });
            })();
          },
        },
        { capture: event.currentTarget },
      );
      if (started) event.preventDefault();
```

On the canvas `style`, set `touchAction: tool === 'cover' ? 'none' : undefined` so a finger can draw a cover; every other tool keeps pinch-zoom.

- [ ] **Step 7: Write the failing browser tests**

Append to `tests/e2e/phone-forms.spec.ts`:

```ts
/** A one-finger drag through CDP. Chromium only: WebKit has no touch input API. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
  for (let i = 1; i <= 12; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(p) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('a finger drags a selected field', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Touch drags are driven through CDP.');
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  await tapPdf(page, 300, 665);
  await expect(outline(page)).toBeVisible();
  const box = (await outline(page).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touchDrag(page, from, { x: from.x, y: from.y + 40 });

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
  const after = (await outline(page).boundingBox())!;
  expect(after.y).toBeGreaterThan(box.y + 20);
});

test('a drifting second tap opens the field instead of nudging it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Touch drags are driven through CDP.');
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  await tapPdf(page, 300, 665);
  const box = (await outline(page).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touchDrag(page, from, { x: from.x + 5, y: from.y + 4 });

  await expect(page.getByRole('textbox', { name: /edit this line of text/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});
```

- [ ] **Step 8: Build and run**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts tests/e2e/responsive.spec.ts tests/e2e/drag-and-nested.spec.ts --project=chromium`
Expected: all pass, including the pinch-zoom assertions in `responsive.spec.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/editor/pointer.ts tests/editor/pointer.test.ts src/editor/PageView.tsx tests/e2e/phone-forms.spec.ts
git commit -m "Make field and cover drags work with a finger"
```

---

### Task 9: Hit-test fields on the page, with room for a finger

**Files:**
- Create: `src/editor/field-hit.ts`
- Create: `tests/editor/field-hit.test.ts`
- Modify: `src/editor/PageView.tsx:242-256, 280-283, 540-580` (field list state; local hit test in `findEditable`, `findAnything`, `handleMove`, `handleClick`)
- Test: `tests/e2e/phone-forms.spec.ts`

**Interfaces:**
- Consumes: `PageTransform` and `pdfRectToCss` from `src/editor/transform.ts`.
- Produces: `hitField(fields: FormFieldInfo[], transform: PageTransform, x: number, y: number, slop: number): FormFieldInfo | null`, and the constant `TOUCH_SLOP_PX = 8`.

- [ ] **Step 1: Write the failing unit tests**

```ts
// tests/editor/field-hit.test.ts
import { describe, expect, it } from 'vitest';
import { hitField } from '@/editor/field-hit';
import type { PageTransform } from '@/editor/transform';
import type { FormFieldInfo } from '@/engine/types';

// One CSS pixel per point, y flipped on a 792pt page.
const t: PageTransform = {
  scale: 1,
  toDevice: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 792 },
  toPage: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 792 },
  deviceWidth: 612,
  deviceHeight: 792,
};

const field = (ref: number, left: number, bottom: number, right: number, top: number) =>
  ({ ref, rect: { left, bottom, right, top } }) as FormFieldInfo;

describe('hitField', () => {
  const a = field(1, 100, 700, 200, 710);
  const b = field(2, 100, 680, 200, 690);

  it('hits a point inside a field', () => {
    expect(hitField([a, b], t, 150, 792 - 705, 0)?.ref).toBe(1);
  });

  it('misses outside without slop', () => {
    expect(hitField([a, b], t, 150, 792 - 715, 0)).toBeNull();
  });

  it('reaches a near miss with slop', () => {
    expect(hitField([a, b], t, 150, 792 - 715, 8)?.ref).toBe(1);
  });

  it('prefers the nearer of two fields within slop', () => {
    // 4px below a, 6px above b.
    expect(hitField([a, b], t, 150, 792 - 694, 8)?.ref).toBe(2);
  });

  it('prefers the topmost exact hit when fields overlap', () => {
    const top = field(3, 150, 700, 250, 710);
    expect(hitField([a, top], t, 160, 792 - 705, 8)?.ref).toBe(3);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/editor/field-hit.test.ts`
Expected: FAIL, cannot resolve `@/editor/field-hit`.

- [ ] **Step 3: Implement `field-hit.ts`**

```ts
// src/editor/field-hit.ts
import type { FormFieldInfo } from '@/engine/types';
import { pdfRectToCss, type PageTransform } from './transform';

/**
 * How far outside a field a finger may land and still mean it, in CSS pixels.
 *
 * At the zoom that fits a page to a phone a 14pt field is about eight pixels
 * tall, smaller than any fingertip. Without slop a tap just below a field fell
 * through to the text hit test, which takes the nearest line in the band, and
 * offered to edit the field's caption instead.
 */
export const TOUCH_SLOP_PX = 8;

/**
 * The field under a point in CSS pixels, from the page's own field list.
 *
 * Answered here rather than by asking the worker, so a tap can open the
 * editor inside the gesture: iOS raises the keyboard only for a focus that
 * happens during the tap, and a round trip to the worker ends it. The engine
 * still resolves the field by object number when the edit is committed.
 *
 * An exact hit wins, and the last such field in annotation order is the one
 * drawn on top. Otherwise the nearest field within `slop`.
 */
export function hitField(
  fields: FormFieldInfo[],
  transform: PageTransform,
  x: number,
  y: number,
  slop: number,
): FormFieldInfo | null {
  let exact: FormFieldInfo | null = null;
  let near: FormFieldInfo | null = null;
  let nearDistance = Number.POSITIVE_INFINITY;

  for (const field of fields) {
    const box = pdfRectToCss(transform, field.rect);
    const dx = Math.max(box.left - x, 0, x - (box.left + box.width));
    const dy = Math.max(box.top - y, 0, y - (box.top + box.height));
    const distance = Math.hypot(dx, dy);
    if (distance === 0) exact = field;
    else if (distance <= slop && distance < nearDistance) {
      near = field;
      nearDistance = distance;
    }
  }

  return exact ?? near;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm vitest run tests/editor/field-hit.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Keep the page's fields and hit-test them locally in `PageView.tsx`**

1. Imports: `hitField, TOUCH_SLOP_PX` from `./field-hit`, `useMediaQuery` from `./media`.
2. State and refresh, near the other state:

```tsx
  const [fields, setFields] = useState<FormFieldInfo[]>([]);
  const coarse = useMediaQuery('(pointer: coarse)');

  // The page's fields, refetched whenever the page changed. Tap hit-testing
  // runs on this list; see `hitField` for why it does not ask the worker.
  useEffect(() => {
    let cancelled = false;
    engine
      .formFields(page.index)
      .then((list) => {
        if (!cancelled) setFields(list);
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, page.index, renderToken]);

  const fieldAt = useCallback(
    (x: number, y: number, slop = coarse ? TOUCH_SLOP_PX : 0) =>
      transform ? hitField(fields, transform, x, y, slop) : null,
    [fields, transform, coarse],
  );
```

3. `findEditable`: replace the first two lines with `const field = fieldAt(x, y); if (field) return { kind: 'field', field };` and add `fieldAt` to its dependencies.
4. `findAnything`: same, using `fieldAt(x, y, 0)` (the context menu stays exact).
5. `handleMove`, Select branch: `setHover(fieldAt(x, y, 0)?.rect ?? null);` with no `await`.
6. `handleClick`: replace the field block with

```tsx
      if (tool === 'edit-text' || tool === 'select') {
        // Synchronous, so an editor opened here is focused inside the tap.
        const field = fieldAt(x, y);
        if (field) {
          if (tool === 'select') selectField(field);
          else await activateField(field);
          return;
        }
      }
```

Add `fieldAt` to `handleClick`'s and `handleMove`'s dependency arrays and remove the now-unused engine and size dependencies only where nothing else in the callback uses them.

- [ ] **Step 6: Write the failing browser test**

Append to `tests/e2e/phone-forms.spec.ts`:

```ts
test('a tap just below a small field reaches the field, not its label', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  // Surname's box is 656..674; at this zoom 3pt below it is a few pixels away.
  await tapPdf(page, 300, 653);
  await expect(outline(page)).toHaveAttribute('aria-label', /Surname/);
});
```

- [ ] **Step 7: Build and run**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts tests/e2e/forms.spec.ts --project=chromium && pnpm test:e2e tests/e2e/phone-forms.spec.ts tests/e2e/forms.spec.ts --project=webkit`
Expected: all pass, including `forms.spec.ts`'s "clicking a label still edits the label" on desktop (no slop there).

- [ ] **Step 8: Commit**

```bash
git add src/editor/field-hit.ts tests/editor/field-hit.test.ts src/editor/PageView.tsx tests/e2e/phone-forms.spec.ts
git commit -m "Hit-test fields on the page so a tap opens them at once"
```

---

### Task 10: The field editor on touch

Fixes Widen to fit on iPhone, lost edits, and adds Done and Cancel.

**Files:**
- Create: `src/editor/press.ts`
- Create: `src/editor/onscreen.ts`
- Create: `tests/editor/onscreen.test.ts`
- Modify: `src/editor/InlineTextEditor.tsx`
- Test: `tests/e2e/phone-forms.spec.ts`

**Interfaces:**
- Produces:
  - `pressHandlers(action: () => void): { onPointerDown: React.PointerEventHandler; onPointerUp: React.PointerEventHandler; onMouseDown: React.MouseEventHandler; onClick: React.MouseEventHandler }`
  - `placeOnScreen(rect: { left: number; top: number; right: number; bottom: number }, viewport: { left: number; top: number; width: number; height: number }, margin?: number): { dx: number; below: boolean }`
  - `useOnScreen(ref: React.RefObject<HTMLElement | null>, deps: unknown[]): { dx: number; below: boolean }`

- [ ] **Step 1: Confirm the Widen to fit root cause before changing it**

Run (the server must serve the current build): open `filled-form.pdf` in the WebKit iPhone 13 emulation, tap Surname twice, type a long value, and in the page evaluate:

```js
const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Widen to fit'));
let clicks = 0; b.addEventListener('click', () => clicks++);
// then tap the button with page.touchscreen.tap at its centre and read `clicks`
```

Expected: `clicks` is 0 under WebKit and 1 under Chromium (Pixel 7), confirming that `preventDefault` on `pointerdown` suppresses the click in WebKit (the same behaviour commit `2a7e89f` worked around). If `clicks` is 1 under WebKit, stop and report: the cause is something else and Steps 4 to 6 must change.

- [ ] **Step 2: Write the failing unit tests for placement**

```ts
// tests/editor/onscreen.test.ts
import { describe, expect, it } from 'vitest';
import { placeOnScreen } from '@/editor/onscreen';

const vp = { left: 0, top: 0, width: 390, height: 844 };

describe('placeOnScreen', () => {
  it('leaves a chip that fits alone', () => {
    expect(placeOnScreen({ left: 20, top: 100, right: 220, bottom: 130 }, vp)).toEqual({ dx: 0, below: false });
  });

  it('shifts a chip that runs off the right edge', () => {
    expect(placeOnScreen({ left: 300, top: 100, right: 500, bottom: 130 }, vp, 8).dx).toBe(-118);
  });

  it('shifts a chip that starts off the left edge', () => {
    expect(placeOnScreen({ left: -30, top: 100, right: 100, bottom: 130 }, vp, 8).dx).toBe(38);
  });

  it('flips below when there is no room above', () => {
    expect(placeOnScreen({ left: 20, top: -10, right: 220, bottom: 20 }, vp).below).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run tests/editor/onscreen.test.ts`
Expected: FAIL, cannot resolve `@/editor/onscreen`.

- [ ] **Step 4: Implement `press.ts` and `onscreen.ts`**

```ts
// src/editor/press.ts
import type React from 'react';

/**
 * Handlers for a button that must not take focus from a text input.
 *
 * `preventDefault` on press keeps the input focused, so its blur does not
 * commit and close the editor before the button acts. WebKit then never
 * sends the click, which is how "Widen to fit" did nothing at all on an
 * iPhone, so the action runs on release. A keyboard activation has no
 * pointer events and arrives as a click with `detail` 0, which is the one
 * click acted on.
 */
export function pressHandlers(action: () => void) {
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onPointerUp: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      action();
    },
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onClick: (event: React.MouseEvent) => {
      if (event.detail === 0) action();
    },
  };
}
```

```ts
// src/editor/onscreen.ts
import { useLayoutEffect, useRef, useState } from 'react';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How to move a floating chip so it stays on screen.
 *
 * Chips are anchored to the field they describe, and a field on the right
 * half of a phone pushed its chip off the edge with half of what it said out
 * of sight. Shift it back in horizontally; flip it below its box when there
 * is no room above.
 */
export function placeOnScreen(
  rect: Box,
  viewport: { left: number; top: number; width: number; height: number },
  margin = 8,
): { dx: number; below: boolean } {
  const right = viewport.left + viewport.width - margin;
  const left = viewport.left + margin;
  let dx = 0;
  if (rect.right > right) dx = right - rect.right;
  if (rect.left + dx < left) dx = left - rect.left;
  return { dx, below: rect.top < viewport.top + margin };
}

/** `placeOnScreen` for an element, against the visual viewport. */
export function useOnScreen(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [place, setPlace] = useState({ dx: 0, below: false });
  const applied = useRef(place);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    // Measured where it would sit without the current shift.
    const natural = {
      left: r.left - applied.current.dx,
      right: r.right - applied.current.dx,
      top: r.top,
      bottom: r.bottom,
    };
    const vv = window.visualViewport;
    const next = placeOnScreen(natural, {
      left: vv?.offsetLeft ?? 0,
      top: vv?.offsetTop ?? 0,
      width: vv?.width ?? window.innerWidth,
      height: vv?.height ?? window.innerHeight,
    });
    if (next.dx !== applied.current.dx || next.below !== applied.current.below) {
      applied.current = next;
      setPlace(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return place;
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `pnpm vitest run tests/editor/onscreen.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Rework `InlineTextEditor.tsx`**

1. Imports: add `useEffect` from React, `pressHandlers` from `./press`, `useOnScreen` from `./onscreen`.
2. Commit exactly once, and before unmount. After the `submit` declaration, replace `submit` and add the unmount guard:

```tsx
  /** Set once the edit is committed or cancelled, so it is never done twice. */
  const settled = useRef(false);
  const latest = useRef({ value, width, widthChanged, onCommit, text });
  latest.current = { value, width, widthChanged, onCommit, text };

  const cancel = () => {
    settled.current = true;
    onCancel();
  };

  const submit = async () => {
    if (busy || settled.current) return;
    settled.current = true;
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

  // iOS does not blur an input when the next tap lands on something that
  // cannot take focus, so tapping another field replaced this editor without
  // its blur ever firing and the typed value was lost. Commit on the way out.
  useEffect(
    () => () => {
      const l = latest.current;
      if (settled.current) return;
      if (l.value === l.text && !l.widthChanged) return;
      settled.current = true;
      void l.onCommit(l.value, l.widthChanged ? l.width! : undefined);
    },
    [],
  );
```

3. In the input's `onKeyDown`, guard Enter during composition and use `cancel`:

```tsx
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
```

4. Input attributes: add `autoCorrect="off"`, `autoCapitalize="off"`, `enterKeyHint="done"`.
5. Select on focus: replace `input.select();` in the mount effect with `input.setSelectionRange(0, input.value.length);`.
6. The hint chip: give it a ref and keep it on screen.

```tsx
  const chipRef = useRef<HTMLDivElement | null>(null);
  const chip = useOnScreen(chipRef, [value, busy, clipped, coarse, box.left, box.width]);
```

and change the chip `<div>`'s positioning style to:

```tsx
          ...(chip.below ? { top: '100%', marginTop: 4 } : { bottom: '100%', marginBottom: 4 }),
          left: 0,
          transform: chip.dx ? `translateX(${chip.dx}px)` : undefined,
          maxWidth: 'min(calc(100vw - 16px), 460px)',
```

with `ref={chipRef}` on it. When the chip is below, move the cut-off warning above instead (swap `top: '100%'`/`bottom: '100%'` on the warning using the same `chip.below`).

7. The chip's contents. Replace the hint `<span>` and the Widen button with:

```tsx
        <span className="pointer-events-none">
          {busy
            ? 'Applying…'
            : coarse
              ? widthChanged
                ? `${Math.round(shownWidth)} pt wide`
                : ''
              : widthChanged
                ? `${Math.round(shownWidth)} pt wide · ${hint}`
                : hint}
        </span>

        {widenable && clipped && !busy && (
          <button
            type="button"
            {...pressHandlers(fitToText)}
            className="rounded px-2 font-semibold underline"
            style={{
              background: 'rgba(255,255,255,0.18)',
              color: '#fff',
              cursor: 'pointer',
              minHeight: coarse ? 44 : undefined,
            }}
            title="Widen the field so the whole value is drawn"
          >
            Widen to fit
          </button>
        )}

        {coarse && !busy && (
          <>
            <button
              type="button"
              {...pressHandlers(() => void submit())}
              className="rounded px-3 font-semibold"
              style={{ background: '#fff', color: 'var(--app-accent)', minHeight: 44 }}
            >
              Done
            </button>
            <button
              type="button"
              {...pressHandlers(cancel)}
              className="rounded px-3"
              style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', minHeight: 44 }}
            >
              Cancel
            </button>
          </>
        )}
```

Remove the old inline `onPointerDown`/`onClick` on the Widen button and its comment; the explanation now lives in `press.ts`. The input's `onBlur={() => void submit()}` stays.

- [ ] **Step 7: Write the failing browser tests**

Append to `tests/e2e/phone-forms.spec.ts`:

```ts
const editor = (page: Page) => page.getByRole('textbox', { name: /edit this line of text/i });

test('Widen to fit widens the field on a phone', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await tapPdf(page, 300, 665);
  await tapPdf(page, 300, 665);
  await expect(editor(page)).toBeVisible({ timeout: 20_000 });
  await editor(page).fill('DOE-WHITFIELD Y HARTLEY OF ASHFORD');

  const before = (await editor(page).boundingBox())!.width;
  await page.getByRole('button', { name: 'Widen to fit' }).tap();
  await expect.poll(async () => (await editor(page).boundingBox())!.width).toBeGreaterThan(before);
  await expect(editor(page)).toBeVisible();
});

test('Done commits and Cancel discards', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');

  await tapPdf(page, 300, 665);
  await tapPdf(page, 300, 665);
  await editor(page).fill('KEPT');
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });

  await tapPdf(page, 300, 625);
  await tapPdf(page, 300, 625);
  await editor(page).fill('DISCARDED');
  await page.getByRole('button', { name: 'Cancel' }).tap();
  await expect(editor(page)).toHaveCount(0);

  // Reopen GivenNames: still the original value.
  await tapPdf(page, 300, 625);
  await tapPdf(page, 300, 625);
  await expect(editor(page)).toHaveValue('JANE ANNE ELIZABETH DOE');
});

test('commits the first field when another is tapped', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  // Edit text tool, so one tap opens a field.
  await page.getByRole('button', { name: 'Actions rail' }).click();
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();

  await tapPdf(page, 300, 665);
  await editor(page).fill('FIRST');
  await tapPdf(page, 300, 625);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });

  await page.keyboard.press('Escape');
  await tapPdf(page, 300, 665);
  await expect(editor(page)).toHaveValue('FIRST');
});

test('the editor chip stays on screen for a field on the right', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-kinds.pdf');
  // Shared kid 2 sits at x 320..420 on a 612pt page: the right third.
  await tapPdf(page, 370, 408);
  await tapPdf(page, 370, 408);
  await expect(editor(page)).toBeVisible({ timeout: 20_000 });

  const overflow = await page.evaluate(() => {
    const done = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Done')!;
    return done.closest('div')!.getBoundingClientRect().right - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBe(0);
});
```

The "commits the first field" test needs the drawer to close after picking Edit text; until Task 12 lands, close it by tapping `Close this panel` after choosing the tool, and remove that line in Task 12.

- [ ] **Step 8: Build and run on all three engines**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts tests/e2e/forms.spec.ts`
Expected: all pass in Chromium, Firefox and WebKit (CDP-only tests skip outside Chromium).

- [ ] **Step 9: Commit**

```bash
git add src/editor/press.ts src/editor/onscreen.ts tests/editor/onscreen.test.ts src/editor/InlineTextEditor.tsx tests/e2e/phone-forms.spec.ts
git commit -m "Give the field editor Done, Cancel and a Widen button that works"
```

---

### Task 11: The selection chip on touch

**Files:**
- Modify: `src/editor/PageView.tsx:1146-1163` (pass touch props), `1279-1409` (`SelectionOutline` chip)
- Test: `tests/e2e/phone-forms.spec.ts`

**Interfaces:**
- Consumes: `pressHandlers` (Task 10), `useOnScreen` (Task 10), `useMediaQuery`.
- Produces: `SelectionOutline` gains optional props `onDelete?: () => void` and `touch?: boolean`.

- [ ] **Step 1: Write the failing browser test**

```ts
test('a selected field offers Edit and Delete on a phone, on screen', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form-kinds.pdf');
  await tapPdf(page, 370, 408);
  await expect(outline(page)).toBeVisible();

  await expect(page.getByText('Tap again to edit')).toBeVisible();
  await expect(page.getByText(/Click again|Delete to remove/)).toHaveCount(0);

  const overflow = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('span,div')].find((n) => n.textContent?.startsWith('Tap again to edit'))!;
    return chip.getBoundingClientRect().right - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Delete', exact: true }).tap();
  await expect(outline(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 20_000 });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts -g "Edit and Delete" --project=chromium`
Expected: FAIL, "Tap again to edit" not found.

- [ ] **Step 3: Implement the chip**

1. In `PageView`'s render, pass to `SelectionOutline`:

```tsx
          touch={coarse}
          hint={
            selectedField
              ? coarse
                ? 'Tap again to edit'
                : 'Drag to move · Click again to edit · Delete to remove'
              : coarse
                ? 'Drag to move'
                : undefined
          }
          onDelete={selectedField ? () => void onDeleteField(selectedField).then(() => setSelection(null)) : undefined}
```

2. In `SelectionOutline`, accept `touch` and `onDelete`. Replace the chip `<span>` with:

```tsx
      <div
        ref={chipRef}
        className="absolute flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px]"
        style={{
          ...(chip.below ? { top: '100%', marginTop: 4 } : { bottom: '100%', marginBottom: 4 }),
          left: 0,
          transform: chip.dx ? `translateX(${chip.dx}px)` : undefined,
          maxWidth: 'min(calc(100vw - 16px), 460px)',
          background: 'var(--app-selection)',
          color: '#fff',
        }}
      >
        <span className="pointer-events-none">
          {drag ? 'Release to place' : (hint ?? 'Drag to move · Delete to remove')}
        </span>
        {touch && !drag && onActivate && (
          <button type="button" {...pressHandlers(onActivate)} className="rounded px-3 font-semibold" style={{ background: '#fff', color: 'var(--app-selection)', minHeight: 44 }}>
            Edit
          </button>
        )}
        {touch && !drag && onDelete && (
          <button type="button" {...pressHandlers(onDelete)} className="rounded px-3" style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', minHeight: 44 }}>
            Delete
          </button>
        )}
      </div>
```

with `const chipRef = useRef<HTMLDivElement | null>(null);` and `const chip = useOnScreen(chipRef, [rect, drag === null, hint, touch]);` near the top of the component. The buttons' `onPointerDown` from `pressHandlers` calls `stopPropagation`, so pressing them never starts a drag on the outline.

- [ ] **Step 4: Build and run**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts tests/e2e/forms.spec.ts`
Expected: all pass on all three engines; `forms.spec.ts` desktop still finds "Click again to edit".

- [ ] **Step 5: Commit**

```bash
git add src/editor/PageView.tsx tests/e2e/phone-forms.spec.ts
git commit -m "Offer Edit and Delete on a selected field when using touch"
```

---

### Task 12: Close the tools drawer after a pick

**Files:**
- Modify: `src/editor/ToolRail.tsx:100-130, 150-180, 205-285` (an `onPicked` prop)
- Modify: `src/editor/Editor.tsx:1141-1160` (pass it in the drawer)
- Modify: `tests/e2e/phone-forms.spec.ts` (drop the temporary `Close this panel` tap from Task 10)

**Interfaces:**
- Produces: `ToolRail` optional prop `onPicked?: () => void`, called after a tool, Signature, Image or Rotate is chosen.

- [ ] **Step 1: Write the failing browser test**

```ts
test('choosing a tool closes the drawer', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await page.getByRole('button', { name: 'Actions rail' }).click();
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close this panel' })).toHaveCount(0);

  // And the next tap lands on the page, opening the field.
  await tapPdf(page, 300, 665);
  await expect(editor(page)).toBeVisible({ timeout: 20_000 });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts -g "closes the drawer" --project=chromium`
Expected: FAIL, the drawer's close button is still present.

- [ ] **Step 3: Implement**

1. `ToolRail`: add `onPicked?: () => void` to the props interface with the comment `/** Called after something is chosen, so a drawer can close itself. */`, destructure it, and change:
   - both `onClick={() => setTool(id)}` to `onClick={() => { setTool(id); onPicked?.(); }}`
   - the Signature cards' `onClick={onAddSignature}` to `onClick={() => { onAddSignature(); onPicked?.(); }}`
   - the Image cards' and icons' `onClick={onAddImage}` to `onClick={() => { onAddImage(); onPicked?.(); }}`
   - the Rotate buttons' `onClick={onRotate}` to `onClick={() => { onRotate(); onPicked?.(); }}`
2. `Editor.tsx`: on the drawer's `<ToolRail ...>` only (not the desktop one), add `onPicked={() => setDrawer(null)}`.
3. In `tests/e2e/phone-forms.spec.ts`, remove the temporary `Close this panel` tap added in Task 10.

- [ ] **Step 4: Build and run**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts tests/e2e/responsive.spec.ts`
Expected: all pass on all three engines.

- [ ] **Step 5: Commit**

```bash
git add src/editor/ToolRail.tsx src/editor/Editor.tsx tests/e2e/phone-forms.spec.ts
git commit -m "Close the tools drawer once a tool or action is picked"
```

---

### Task 13: Readable Add text on touch, and notices that leave the form visible

**Files:**
- Modify: `src/editor/OverlayLayer.tsx:295-328` (the text input)
- Modify: `src/editor/Notices.tsx:40-58`
- Test: `tests/e2e/phone-forms.spec.ts`, `tests/e2e/notices.spec.ts` (run only; must stay green)

**Interfaces:**
- Consumes: `useMediaQuery` from `./media`.

- [ ] **Step 1: Write the failing browser tests**

```ts
test('Add text is readable on a phone', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'filled-form.pdf');
  await page.getByRole('button', { name: 'Actions rail' }).click();
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await tapPdf(page, 100, 300);

  const size = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('input[aria-label="Text to add to the page"]')!).fontSize),
  );
  expect(size).toBeGreaterThanOrEqual(16);
});

test('only the newest notice shows on a phone', async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'acroform-sig-field.pdf');
  // Opening a file with a signature field raises the signature notice.
  // Selecting the signature field (rect 72 150 300 220) and tapping it again
  // raises a second: "This is a signature field...".
  await tapPdf(page, 186, 185);
  await tapPdf(page, 186, 185);

  const cards = page.locator('[role="status"] > div');
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole('button', { name: /\+\d+ more/ })).toBeVisible();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts -g "Add text is readable|newest notice" --project=chromium`
Expected: FAIL on both.

- [ ] **Step 3: Floor the Add text input on touch**

In `OverlayLayer.tsx`'s text input component, add `const coarse = useMediaQuery('(pointer: coarse)');` and set:

```tsx
        // Floored on a touch screen, as the field editor is: at a phone's zoom
        // 12pt type is seven pixels, and under 16px mobile Safari zooms the
        // page when the input takes focus.
        fontSize: coarse ? Math.max((item.fontSize ?? 12) * zoom, 16) : (item.fontSize ?? 12) * zoom,
        minHeight: coarse ? 24 : undefined,
```

and change its `className` from `absolute inset-0 w-full` to `absolute left-0 top-0 w-full` when `coarse`, so the taller input grows downward instead of being clipped by `inset-0`:

```tsx
      className={`text-edit-input absolute w-full ${coarse ? 'left-0 top-0' : 'inset-0'}`}
```

- [ ] **Step 4: Collapse notices on a narrow screen**

In `Notices.tsx`:

```tsx
export function Notices() {
  const notices = useEditor((s) => s.notices);
  const dismiss = useEditor((s) => s.dismissNotice);
  const narrow = useMediaQuery('(max-width: 899px)');
  const [expanded, setExpanded] = useState(false);

  if (notices.length === 0) return null;

  // On a phone four cards cover the lower third of the page, which is where
  // the rest of a form is. The newest shows; the others are one tap away.
  const shown = narrow && !expanded ? notices.slice(-1) : notices.slice(-4);
  const hidden = notices.length - shown.length;

  return (
    <div
      className={`pointer-events-none fixed bottom-12 z-40 flex flex-col gap-2 ${narrow ? 'left-4 right-4' : 'right-4 w-80'}`}
      role="status"
      aria-live="polite"
    >
      {narrow && hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="pointer-events-auto self-end rounded px-2 py-1 text-[11px]"
          style={{ background: 'var(--app-panel)', color: 'var(--app-text-dim)', border: '1px solid var(--app-border)' }}
        >
          +{hidden} more
        </button>
      )}
      {shown.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} onDismiss={dismiss} />
      ))}
    </div>
  );
}
```

Import `useMediaQuery` from `./media`. Reset `expanded` to false when `notices.length` drops to 0:

```tsx
  useEffect(() => {
    if (notices.length === 0) setExpanded(false);
  }, [notices.length]);
```

(place it before the early return).

- [ ] **Step 5: Build and run**

Run: `pnpm build && pnpm test:e2e tests/e2e/phone-forms.spec.ts tests/e2e/notices.spec.ts tests/e2e/print.spec.ts`
Expected: all pass on all three engines. `print.spec.ts` records notices with a `MutationObserver`, so a notice hidden behind "+N more" on a narrow viewport must still have been raised; if it asserts on visible text at a desktop size, it is unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/editor/OverlayLayer.tsx src/editor/Notices.tsx tests/e2e/phone-forms.spec.ts
git commit -m "Floor Add text type on touch and show one notice at a time on phones"
```

---

### Task 14: Document the rules, verify everything, re-run the screenshot pass

**Files:**
- Modify: `CLAUDE.md` (form field section)

- [ ] **Step 1: Update `CLAUDE.md`**

In the hard rules, after the "A form field is not a line of text" rule, add:

```markdown
- **A widget is addressed by its object number, never by its name.** Every
  option of a radio group shares one name, and so does every widget of a
  field shown twice; looking fields up by name made the second radio option
  tick the first, and moving one widget of a pair move the other.
  `FormFieldInfo.ref` is `EPDFAnnot_GetObjectNumber`, every worker method
  that touches a field takes it, and `withFieldAnnot` resolves it at the
  moment of the mutation. PDFium's non-incremental save keeps object
  numbers, which `form-kinds.test.ts` checks across `reload`. Names remain
  the caption source and nothing else.

- **On touch, a field is hit-tested on the page, with slop.** `PageView`
  keeps each page's field list and `hitField` answers a tap synchronously,
  because iOS raises the keyboard only for a focus inside the tap and a worker
  round trip ends it. A coarse pointer gets `TOUCH_SLOP_PX` around each field,
  since a fitted 14pt field is smaller than a fingertip and a near miss
  otherwise edits the caption beside it. Drags go through `trackPointer`,
  which handles `pointercancel` and a 10px finger threshold, and the outline
  is the only element with `touch-action: none`. A button inside an editor
  uses `pressHandlers`: it must not take focus from the input, and WebKit
  sends no click after a cancelled press, so it acts on release.
```

- [ ] **Step 2: Full verification**

Run each and record the output:

```bash
pnpm format
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Expected: typecheck clean; vitest all green; build succeeds; Playwright all green on Chromium, Firefox and WebKit (CDP-only tests skipped outside Chromium, offline tests skipped on WebKit as before). Check that 127.0.0.1:4173 served this build (Global Constraints) and say so in the summary. If anything fails, report it with its output; do not mark the task done.

- [ ] **Step 3: Re-run the screenshot pass**

From the session scratchpad `qa/` folder, start `npx serve out --listen 4180 --no-clipboard --single` from the project directory, then `node qa.mjs iphone`, `node qa.mjs pixel`, `node qa.mjs desktop`, and `node summ.js desktop pixel iphone`. Compare with the first pass: the iPhone `long:afterWiden` width must now grow, `drag` on Pixel must show Undo enabled, `edit:Combo` must show a select rather than a text editor, `edit:Password` must show a masked input, and no `PAGEERROR` may appear. Present the before and after to the owner with the relevant screenshots.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git add -u src tests scripts
git status --short   # confirm service-worker.ts and needapp-shared.pdf are NOT staged
git commit -m "Document widget refs and the touch rules for form fields"
```

If `git add -u` staged `src/offline/service-worker.ts`, unstage it with `git restore --staged src/offline/service-worker.ts` before committing.
