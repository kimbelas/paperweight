/**
 * The AcroForm field tree, edited in the serialised file.
 *
 * `FPDFPage_RemoveAnnot` takes a widget out of the page's `/Annots` array,
 * and that is all it does. The field the widget belonged to is still in
 * `/AcroForm /Fields` — or in its parent's `/Kids` — and its dictionary still
 * carries the rectangle, the page and the value. PDFium draws widgets from
 * `/Annots`, so on screen the field is gone. Acrobat builds its form from the
 * field tree and puts the widget back, so the downloaded file shows the field
 * the user watched disappear, old value and all. pypdf, pdftk and every other
 * tool that reads form data by walking `/Fields` sees it too.
 *
 * PDFium's public API has no call that edits that array, and neither does the
 * embedpdf build this app uses (its redaction path detaches widgets, but
 * redaction also destroys the page content under them). So the tree is edited
 * here, in the bytes `FPDF_SaveAsCopy` produced, and the document is reloaded
 * from the result — which also means PDFium parses the edited file straight
 * away, rather than Acrobat being the first to try.
 *
 * A reference is removed by overwriting its `N 0 R` token with the same
 * number of spaces. Whitespace between array elements means nothing, and
 * because no byte moves, every offset in the cross-reference table stays
 * true. A field whose last kid was removed is removed from its own parent in
 * turn, so an emptied group does not linger, and every field removed also
 * leaves the calculation order in `/CO`. The dictionaries themselves are left
 * in these bytes, unreferenced; PDFium's writer emits only what the catalog
 * reaches, so the next save — the one behind the download — drops them.
 *
 * The parser is deliberately narrow. It reads the classic cross-reference
 * table PDFium writes for a non-incremental save (`cpdf_creator.cpp` writes a
 * cross-reference stream only for an incremental update to a file that had
 * one), and it parses only the dictionaries on the path from the trailer to
 * the arrays it changes. Streams, filters and object streams never come into
 * it, because the writer emits no object streams and a field dictionary is
 * not a stream. Holds no PDFium import: this is a function of bytes.
 */

type Node =
  | { kind: 'dict'; entries: Map<string, Node>; start: number; end: number }
  | { kind: 'array'; items: Node[]; start: number; end: number }
  | { kind: 'ref'; num: number; gen: number; start: number; end: number; blanked: boolean }
  | { kind: 'number'; value: number; start: number; end: number }
  | { kind: 'other'; start: number; end: number };

type DictNode = Extract<Node, { kind: 'dict' }>;
type ArrayNode = Extract<Node, { kind: 'array' }>;

const SPACE = 0x20;

function isWhitespace(b: number): boolean {
  return b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00;
}

function isDelimiter(b: number): boolean {
  // ( ) < > [ ] { } / %
  return (
    b === 0x28 ||
    b === 0x29 ||
    b === 0x3c ||
    b === 0x3e ||
    b === 0x5b ||
    b === 0x5d ||
    b === 0x7b ||
    b === 0x7d ||
    b === 0x2f ||
    b === 0x25
  );
}

function isRegular(b: number): boolean {
  return !isWhitespace(b) && !isDelimiter(b);
}

function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

/** A cursor over PDF syntax, parsing just enough to find array elements. */
class Lexer {
  pos = 0;

  constructor(readonly bytes: Uint8Array) {}

  private at(i: number): number {
    return i < this.bytes.length ? this.bytes[i] : -1;
  }

  peek(): number {
    return this.at(this.pos);
  }

  skipWhitespace(): void {
    for (;;) {
      const b = this.peek();
      if (b === -1) return;
      if (isWhitespace(b)) {
        this.pos++;
      } else if (b === 0x25) {
        // A comment runs to the end of the line.
        while (this.pos < this.bytes.length && this.peek() !== 0x0a && this.peek() !== 0x0d) {
          this.pos++;
        }
      } else {
        return;
      }
    }
  }

  /** The run of regular characters at the cursor, as Latin-1 text. */
  token(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length && isRegular(this.peek())) this.pos++;
    return latin1(this.bytes, start, this.pos);
  }

  /** A non-negative integer, or null if the cursor is not on one. */
  integer(): number | null {
    this.skipWhitespace();
    const start = this.pos;
    while (isDigit(this.peek())) this.pos++;
    if (this.pos === start) return null;
    return Number(latin1(this.bytes, start, this.pos));
  }

  expectKeyword(word: string, what: string): void {
    this.skipWhitespace();
    const got = this.token();
    if (got !== word) throw new Error(`Malformed PDF: expected "${word}" ${what}, found "${got}".`);
  }

  /** Parse one object at the cursor. */
  value(): Node {
    this.skipWhitespace();
    const start = this.pos;
    const b = this.peek();

    if (b === 0x3c) {
      if (this.at(this.pos + 1) === 0x3c) return this.dict();
      // A hex string.
      this.pos++;
      while (this.pos < this.bytes.length && this.peek() !== 0x3e) this.pos++;
      this.pos++;
      return { kind: 'other', start, end: this.pos };
    }

    if (b === 0x5b) return this.array();

    if (b === 0x28) {
      // A literal string: balanced parentheses, backslash escapes anything.
      this.pos++;
      let depth = 1;
      while (this.pos < this.bytes.length && depth > 0) {
        const c = this.peek();
        if (c === 0x5c) this.pos++;
        else if (c === 0x28) depth++;
        else if (c === 0x29) depth--;
        this.pos++;
      }
      return { kind: 'other', start, end: this.pos };
    }

    if (b === 0x2f) {
      this.pos++;
      this.token();
      return { kind: 'other', start, end: this.pos };
    }

    if (isDigit(b)) {
      // An integer may be the first half of an indirect reference.
      const first = this.integer()!;
      if (isRegular(this.peek())) {
        // Something like 12.5 or 3e: a plain number, not a reference.
        this.token();
        return { kind: 'other', start, end: this.pos };
      }
      const afterFirst = this.pos;
      const gen = this.integer();
      if (gen !== null) {
        this.skipWhitespace();
        if (this.peek() === 0x52 && !isRegular(this.at(this.pos + 1))) {
          this.pos++;
          return { kind: 'ref', num: first, gen, start, end: this.pos, blanked: false };
        }
      }
      this.pos = afterFirst;
      return { kind: 'number', value: first, start, end: this.pos };
    }

    if (isRegular(b)) {
      const text = this.token();
      const value = Number(text);
      if (text.length > 0 && Number.isFinite(value)) {
        return { kind: 'number', value, start, end: this.pos };
      }
      return { kind: 'other', start, end: this.pos };
    }

    // A stray delimiter. Step over it so a malformed input cannot loop.
    this.pos++;
    if (b === 0x3e && this.peek() === 0x3e) this.pos++;
    return { kind: 'other', start, end: this.pos };
  }

  private dict(): DictNode {
    const start = this.pos;
    this.pos += 2;
    const entries = new Map<string, Node>();
    for (;;) {
      this.skipWhitespace();
      if (this.peek() === -1) break;
      if (this.peek() === 0x3e && this.at(this.pos + 1) === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.peek() !== 0x2f) {
        // Not a key. Consume something so the loop moves on.
        this.value();
        continue;
      }
      this.pos++;
      const key = this.token();
      entries.set(key, this.value());
    }
    return { kind: 'dict', entries, start, end: this.pos };
  }

  private array(): ArrayNode {
    const start = this.pos;
    this.pos++;
    const items: Node[] = [];
    for (;;) {
      this.skipWhitespace();
      if (this.peek() === -1) break;
      if (this.peek() === 0x5d) {
        this.pos++;
        break;
      }
      items.push(this.value());
    }
    return { kind: 'array', items, start, end: this.pos };
  }
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Offset of the last occurrence of an ASCII needle within the tail of `bytes`. */
function lastIndexOf(bytes: Uint8Array, needle: string, from: number): number {
  outer: for (let i = bytes.length - needle.length; i >= from; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * A saved PDF, addressed through its cross-reference table.
 *
 * Objects are parsed on demand and cached, so an array reached twice is the
 * same node twice — which is what lets a second removal from the same `/Kids`
 * see the first and notice when the array has emptied.
 */
class SavedPdf {
  private readonly offsets = new Map<number, number>();
  private readonly objects = new Map<number, Node | null>();
  readonly trailer: DictNode;

  constructor(readonly bytes: Uint8Array) {
    this.trailer = this.readCrossReference();
  }

  private readCrossReference(): DictNode {
    const { bytes } = this;
    const marker = lastIndexOf(bytes, 'startxref', Math.max(0, bytes.length - 2048));
    if (marker < 0) throw new Error('Malformed PDF: no startxref.');

    const lexer = new Lexer(bytes);
    lexer.pos = marker + 'startxref'.length;
    let offset = lexer.integer();
    if (offset === null) throw new Error('Malformed PDF: startxref names no offset.');

    const trailer = new Map<string, Node>();
    const seen = new Set<number>();
    let span = { start: 0, end: 0 };

    while (offset !== null && !seen.has(offset)) {
      seen.add(offset);
      lexer.pos = offset;
      lexer.skipWhitespace();
      if (lexer.token() !== 'xref') {
        // A cross-reference stream. PDFium writes one only for an incremental
        // update to a file that already had one, which this app never asks
        // for; see the module comment.
        throw new Error('This file uses a cross-reference stream, which is not supported here.');
      }

      let dict: DictNode | null = null;
      for (;;) {
        lexer.skipWhitespace();
        const save = lexer.pos;
        if (lexer.token() === 'trailer') {
          const node = lexer.value();
          if (node.kind !== 'dict') throw new Error('Malformed PDF: trailer is not a dictionary.');
          dict = node;
          break;
        }
        lexer.pos = save;

        const first = lexer.integer();
        const count = lexer.integer();
        if (first === null || count === null) {
          throw new Error('Malformed PDF: cross-reference subsection header.');
        }
        for (let i = 0; i < count; i++) {
          const at = lexer.integer();
          const gen = lexer.integer();
          lexer.skipWhitespace();
          const type = lexer.token();
          if (at === null || gen === null || (type !== 'n' && type !== 'f')) {
            throw new Error('Malformed PDF: cross-reference entry.');
          }
          // The newest section is read first and wins.
          if (type === 'n' && !this.offsets.has(first + i)) this.offsets.set(first + i, at);
        }
      }

      if (span.end === 0) span = { start: dict.start, end: dict.end };
      for (const [key, value] of dict.entries) if (!trailer.has(key)) trailer.set(key, value);
      const prev = dict.entries.get('Prev');
      offset = prev?.kind === 'number' ? prev.value : null;
    }

    return { kind: 'dict', entries: trailer, start: span.start, end: span.end };
  }

  /** The object with this number, parsed, or null when the file has none. */
  object(num: number): Node | null {
    if (this.objects.has(num)) return this.objects.get(num)!;

    const offset = this.offsets.get(num);
    let node: Node | null = null;
    if (offset !== undefined) {
      const lexer = new Lexer(this.bytes);
      lexer.pos = offset;
      const found = lexer.integer();
      if (found !== num) {
        throw new Error(
          `Malformed PDF: object ${num} is not where the cross-reference table says.`,
        );
      }
      lexer.integer();
      lexer.expectKeyword('obj', `before object ${num}`);
      node = lexer.value();
    }

    this.objects.set(num, node);
    return node;
  }

  deref(node: Node | undefined): Node | null {
    if (!node) return null;
    return node.kind === 'ref' ? this.object(node.num) : node;
  }

  dictAt(dict: DictNode | null, key: string): DictNode | null {
    const node = dict ? this.deref(dict.entries.get(key)) : null;
    return node?.kind === 'dict' ? node : null;
  }

  arrayAt(dict: DictNode | null, key: string): ArrayNode | null {
    const node = dict ? this.deref(dict.entries.get(key)) : null;
    return node?.kind === 'array' ? node : null;
  }

  /** The object with this number when it is a dictionary, else null. */
  dictOf(num: number): DictNode | null {
    const node = this.object(num);
    return node?.kind === 'dict' ? node : null;
  }

  /** The object number of a field's `/Parent`, or null at the root. */
  parentOf(num: number): number | null {
    const parent = this.dictOf(num)?.entries.get('Parent');
    return parent?.kind === 'ref' ? parent.num : null;
  }

  /** Overwrite every reference to `num` in the array with spaces. */
  blank(array: ArrayNode, num: number): boolean {
    let hit = false;
    for (const item of array.items) {
      if (item.kind !== 'ref' || item.num !== num || item.blanked) continue;
      this.bytes.fill(SPACE, item.start, item.end);
      item.blanked = true;
      hit = true;
    }
    return hit;
  }

  /** How many elements the array still holds. */
  remaining(array: ArrayNode): number {
    return array.items.filter((item) => !(item.kind === 'ref' && item.blanked)).length;
  }
}

/**
 * Detach form fields from the AcroForm tree of a saved document.
 *
 * `widgetObjectNumbers` are the indirect object numbers of widget
 * annotations that have already been removed from their pages' `/Annots`.
 * Each is removed from its parent's `/Kids`, or from `/AcroForm /Fields` when
 * it is a root field. A parent left with no kids is removed from its own
 * parent in turn, up to the root. Every field removed also leaves `/CO`.
 *
 * Returns a new buffer of exactly the same length; the input is not touched.
 * A widget the tree never referred to — a producer bug that is common enough
 * — is left alone, and a document with no form comes back unchanged.
 */
export function detachFieldsFromForm(bytes: Uint8Array, widgetObjectNumbers: number[]): Uint8Array {
  const widgets = [...new Set(widgetObjectNumbers)].filter((n) => n > 0);
  const out = bytes.slice();
  if (widgets.length === 0) return out;

  const file = new SavedPdf(out);
  const catalog = file.dictAt(file.trailer, 'Root');
  const acroForm = file.dictAt(catalog, 'AcroForm');
  if (!acroForm) return out;

  const fields = file.arrayAt(acroForm, 'Fields');
  const calculationOrder = file.arrayAt(acroForm, 'CO');

  for (const widget of widgets) {
    let target = widget;
    let parent = file.parentOf(target);

    for (;;) {
      const kids = parent === null ? null : file.arrayAt(file.dictOf(parent), 'Kids');
      const inKids = kids !== null && file.blank(kids, target);
      // A widget with no parent sits in /Fields itself. So does one whose
      // parent's /Kids does not list it, if the producer wired it that way.
      const inFields = !inKids && fields !== null && file.blank(fields, target);
      if (inKids || inFields) {
        if (calculationOrder) file.blank(calculationOrder, target);
      }

      if (!inKids || kids === null || parent === null) break;
      if (file.remaining(kids) > 0) break;

      // The parent has no children left, so it is a field with no widget:
      // take it out of its own parent, or out of /Fields at the root.
      target = parent;
      parent = file.parentOf(target);
    }
  }

  return out;
}
