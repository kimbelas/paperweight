# Form fields that work on a phone: correctness and touch

Date: 2026-10-06. Branch: `fix/form-fields-on-phones`.

## Why

Reported: on a phone, editing fields, resizing them "and whatnot" is hard,
and with images on the page some fields do not respond. A local pass on
iPhone 13 (WebKit), Pixel 7 (Chromium, touch) and desktop Chromium, over every
field kind, plus two read-only engine audits, found 21 defects. This spec
covers parts A (crashes and wrong results) and B (touch interaction). Parts C
(images and notices) and D (further field kinds) follow in their own specs.

Success: every defect below is fixed, each is pinned by a test that saves and
reopens where the file is involved, and the screenshot pass shows the fixed
behaviour on all three devices.

## Evidence

The harness, the scratch edge-case form and the screenshots live in the
session scratchpad (`qa/`), not in the repo. Each finding names how it was
established: reproduced (run against the built app or the real engine) or
traced (read in code).

## Part A: crashes and wrong results

### A1. Mixed page orientation crashes the editor (reproduced)

Any document with both portrait and landscape pages throws React error #185
(maximum update depth) on scroll, blank pages included. `Editor.tsx:717-738`
fits the zoom to `info.pages[currentPage]`; `Editor.tsx:765-822` derives
`currentPage` from offsets computed with that zoom. Scrolling onto a
landscape page lowers the zoom, which makes a different page current, which
raises it again.

Fix: the fit effect no longer depends on `currentPage`. Fit width uses the
widest page; Fit page uses the largest width and height ratio across pages.
Fixture `mixed-orientation.pdf` (portrait, `/Rotate 90`, landscape media box,
portrait). Test: scroll through it in the browser with no page error.

### A2. Widgets are identified by object number, not name (reproduced)

`withFieldAnnot` and `formFieldByName` return the first widget on the page
with a given name. Every option of a radio group shares a name, as does every
widget of a field shown twice. Tapping the second radio option sets the
first; moving the second widget moves the first; widen, convert and size
pinning have the same flaw. `Editor.tsx` re-reads selections by name and has
the same problem after a move.

Fix: `FormFieldInfo` gains `ref: number`, the widget's object number from
`EPDFAnnot_GetObjectNumber`. Every worker method that takes `(page, name)`
for a field takes `(page, ref)` instead. `withFieldAnnot` matches by `ref`
and throws the existing "no longer on this page" error when absent. A
widget with no object number (a direct object, not seen in practice) is
reported as not editable rather than guessed at. `deleteField` moves from
matching by rectangle to matching by `ref`, which also fixes the stale
rectangle after an undo of a move.

Object numbers survive the save and reload the engine already does, since
PDFium's non-incremental writer keeps them; `field-tree.ts` relies on the
same property. A test asserts it across `reload` and undo.

`formFieldLabel` and `formFieldPhrase` keep reading `name`: names stay the
caption source, they stop being the key.

### A3. Combo boxes ignore edits (reproduced)

A choice field reports editable, and `setFormFieldText` then has no effect.

Fix: `FormFieldInfo` gains `options?: string[]` (from
`FPDFAnnot_GetOptionCount` and `FPDFAnnot_GetOptionLabel`) for choice
fields. A combo box offers its options; choosing one calls
`FORM_SetIndexSelected` inside the same focus, commit sequence used for text
(`FORM_OnLButtonDown`, change, `FORM_ForceToKillFocus`). An editable combo
(`/Ff` bit 19) also accepts typed text through the existing replace path,
which must be shown to persist by a save and reopen test. In the UI a combo
opens as a native `<select>` (the platform picker on a phone), with a "type
a value" route only for an editable combo. List boxes stay unsupported (part
D) with their current message.

### A4. Password values are drawn as page text (traced)

`appearanceIsTrustworthy` does not check the password flag (`/Ff` bit 14),
so an auto-sized password field is converted and its value drawn readably
into the content stream.

Fix: a password field is never converted. It is edited through `FORM_*`
whatever `appearanceIsTrustworthy` says, and the editor input is
`type="password"`. `FormFieldInfo` gains `password: boolean`.

### A5. Undo and reload resize auto-sized fields (reproduced)

`snapshotAppearanceSizes` runs on every `PdfDocument.open`. Undo and
`reload` open bytes from `doc.save()`, which already contain the appearances
PDFium generated at the auto size, so the snapshot records 18pt as the
file's own. `autosize-no-appearance.pdf`: Surname `textSize` 9 at open, 18
after `reload(save())`.

Fix: the snapshot is taken once, at the first open of a file, keyed by
`ref`, and passed into every later open of the same session (`reload`,
`reopen` for undo and redo, and failure rollback). `PdfDocument.open` takes
an optional prior snapshot; when given, it does not re-snapshot. Widgets
absent from the snapshot (none in practice, since the app does not create
widgets) fall through to the existing later steps of `drawnSize`. The hard
rule in `CLAUDE.md` that says the snapshot "cannot go stale" is corrected.
Test: edit, undo, edit again on `autosize-no-appearance.pdf`, size stays 9.

### A6. Inherited /DA is treated as auto (reproduced)

`readAnnotString(annot, 'DA')` reads the widget's own dictionary only. A
size on the parent field or on `/AcroForm /DA` reads as absent, the field is
judged untrustworthy, and editing converts it to page text.

Fix: read the declared size with `FPDFAnnot_GetFontSize`, which resolves
inheritance. The `/DA` string is still read for the font, colour and
pinning, walking `/Parent` and then `/AcroForm` when the widget has none.

### A7. Hidden widgets catch taps (reproduced)

A widget flagged Hidden (`/F` bit 2) or NoView (bit 6) is listed and hit
tested, and since fields are hit-tested before text, it blocks the text
under it.

Fix: `formFieldAt` and `listFormFields` skip both flags (`FPDFAnnot_GetFlags`).

### A8. /MaxLen truncates silently (reproduced)

Fix: `FormFieldInfo` gains `maxLen?: number`. The editor sets `maxLength`
and shows a count when within five characters of the limit.

## Part B: touch interaction

### B1. Touch drag of a selected field (reproduced on Pixel)

The outline has no `touch-action`, so the browser pans, sends
`pointercancel`, and the drag never completes. There is no `pointercancel`
handler, the window listeners do not filter by `pointerId`, and
`releasePointerCapture` can throw before listeners are removed.

Fix, in `PageView.tsx` `startDrag` and the cover marquee drag alike:
`touch-action: none` on the outline only (never on the canvas, which must
keep pinch-zoom, as `responsive.spec.ts` asserts); handle `pointercancel` as
an abandoned drag with no move and no activate; ignore events from other
pointers; release capture in a `try`; ignore any button but the primary.

### B2. Tap versus drag threshold (traced)

A 3px threshold turns a normal finger tap into a nudge with an undo entry.

Fix: 3px for a mouse, 10px for touch and pen, chosen from the starting
event's `pointerType`.

### B3. Near-miss taps edit the label (traced)

At fit-width on a 390px screen a 14pt field is about 8px tall. The field hit
test is exact; the text hit test falls back to the nearest line in the band.

Fix: on a coarse pointer, a tap within 8 CSS px of a field's rectangle hits
the field, nearest rectangle first. Applies in the Select and Edit text
tools. Desktop stays exact.

### B4. The field editor opens inside the tap (traced)

`focus()` runs after an `await engine.formFieldAt`, outside the user gesture,
so iOS may not raise the keyboard; `select()` is unreliable there.

Fix: `PageView` holds the page's field list (`listFormFields`), refetched
whenever the page's render token changes. Tap hit-testing for fields runs on
that list synchronously, and the editor mounts and focuses in the same
handler. Selection uses `setSelectionRange(0, length)`. The engine is still
asked to confirm before any commit; a mismatch closes the editor with the
existing "could not be found" notice.

### B5. Edits survive the editor being replaced (traced)

iOS does not blur an input when the next tap lands on something that cannot
take focus, so tapping another field replaced the editor without its blur
commit, losing the typed value.

Fix: the editor commits any changed value before it unmounts or is replaced,
independent of blur, and commits exactly once.

### B6. Widen to fit on iPhone (reproduced: width unchanged)

Root cause to be established first (systematic debugging), not assumed. The
leading suspect is that `preventDefault` on `pointerdown` does not stop
WebKit moving focus on touch, so the blur commit races the click. The fix
follows the cause; the test taps the button under WebKit and asserts the
width changed and the editor stayed open.

### B7. The drawer stays open after choosing a tool (reproduced on iPhone)

On a narrow screen, picking a tool or an Add action leaves the drawer over
60% of the page, and the next tap on the page lands on drawer controls (in
the run, arming Add text by accident).

Fix: on narrow screens, choosing a tool, Signature, Image or Rotate closes
the drawer, as choosing a page in the pages drawer already does.

### B8. Chips, controls and keyboard on touch (reproduced in screenshots)

- On a coarse pointer the field editor chip shows **Done** and **Cancel**
  buttons, and the selection chip shows **Edit** and **Delete**. Each is at
  least 44px tall. They use `preventDefault` on `pointerdown` and
  `mousedown` so they do not blur the input first.
- Wording follows the input: "Tap again to edit" on touch, "Click again to
  edit" and key names only with a fine pointer.
- Both chips are positioned within the visual viewport: flipped below the
  box when there is no room above, shifted left when they would overflow the
  right edge, and allowed to wrap.
- The input gets `autoCorrect="off"`, `autoCapitalize="off"`,
  `enterKeyHint="done"`, and Enter during IME composition is ignored.

### B9. Add text editor and notices on a phone (reproduced)

- The Add text editor takes the same 16px minimum type on a coarse pointer
  as the field editor (it showed 6.7px).
- On narrow screens only the newest notice is shown, with a "+N" control to
  expand the rest, so notices do not cover the lower third of the page. The
  timing rules in `CLAUDE.md` are unchanged.

## Tests

Fixtures, added to `scripts/make-fixtures.mjs`:

- `form-kinds.pdf`: a radio group of two; an editable and a fixed combo; a
  password field with auto size; a Hidden and a NoView widget over page text;
  a text field with `/MaxLen 5`; a field whose `/DA` is on its parent; a
  field relying on `/AcroForm /DA`; one field with two widgets on the page.
- `mixed-orientation.pdf` as in A1.

Engine tests (vitest, real WASM): one per A item; every test that changes the
file saves and reopens it, because this class of bug hides in the object
model.

Browser tests (Playwright): a phone `describe` running on Chromium and WebKit
with `isMobile` and `hasTouch` (Firefox gets `hasTouch` without `isMobile`,
which Playwright does not support there). Covers a touch drag via CDP touch
events on Chromium, a drifting tap, a near-miss tap, the drawer closing,
Done and Cancel, Widen to fit, the chips staying inside a 390px viewport for
a field on the right edge, a radio choice and a combo choice. A1 runs on all
three engines on desktop.

Finally the scratchpad screenshot pass runs again on all three devices and
the before and after are shown to the owner.

## Out of scope

Part C: added images blocking fields until saved, the scan notice on fillable
scanned forms, and the false "digitally signed" notice for an empty
signature field. Part D: rotated-page editor geometry and widen clamping,
multiline editing, list boxes, `/Q` and colour preservation on conversion,
multi-page widgets repaint, XFA detection, JavaScript formatting, and the
stale "drag the field's right edge" wording.

## Documentation

`CLAUDE.md` changes with the code: widget identity by `ref`; the snapshot
lifetime (A5) corrected; the touch rules (B1, B2, B3, B4) added to the form
field section.
