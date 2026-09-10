/**
 * The engine's wire types.
 *
 * Everything here crosses the worker boundary, so it must be structured-
 * cloneable: plain data only, no class instances, no PDFium handles. The UI
 * imports this module for types alone and never touches PDFium itself.
 *
 * All geometry is in PDF user space: points, y-up, origin at the bottom-left
 * of the page's crop box.
 */
import type { MarkShape, MarkWeight } from './marks';
import type { Matrix, Rect, Rgba } from './memory';
import type { ObjectPath } from './object-path';

export type { Rect, Matrix, Rgba } from './memory';
export type { ObjectPath } from './object-path';
export type { MarkShape, MarkWeight } from './marks';

/** What a page-level operation did, so the UI knows what to re-render. */
export interface CommitResult {
  /** Pages whose bitmaps are now stale. */
  changedPages: number[];
  /** Non-fatal facts the user should see, e.g. a font substitution. */
  badges: Badge[];
  /** Id of the undo entry this created, if any. */
  undoId?: string;
}

export type BadgeKind =
  | 'font-substituted'
  | 'text-overflows'
  | 'kerning-lost'
  | 'signature-invalidated'
  | 'partial-removal';

export interface Badge {
  kind: BadgeKind;
  message: string;
  page?: number;
}

/** Summary produced once, when a document is opened. */
export interface DocumentInfo {
  pageCount: number;
  pages: PageInfo[];
  /** Cryptographic signatures found via `FPDF_GetSignatureCount`. */
  signatureCount: number;
  /** True when the file was encrypted; editing may be restricted. */
  encrypted: boolean;
  /** True when an owner password would be needed to unlock permissions. */
  ownerLocked: boolean;
}

export interface PageInfo {
  index: number;
  /** Page size in points, after `/Rotate` is applied. */
  width: number;
  height: number;
  /** `/Rotate`, normalised to 0, 90, 180 or 270. */
  rotation: number;
  /**
   * A page with no text objects and a single page-filling image is a scan.
   * Text editing is impossible on one, and the UI says so rather than
   * presenting an editor that cannot work.
   */
  isScanned: boolean;
  /** Count of text objects, used for the scan heuristic and for empty states. */
  textObjectCount: number;
}

/** One glyph, as reported by the text page. */
export interface Glyph {
  charIndex: number;
  unicode: number;
  /** Tight ink box. Matches what `FPDFText_GetCharIndexAtPos` hit-tests. */
  box: Rect;
  /** Layout box, including ascent and descent. Better for drawing carets. */
  looseBox: Rect;
}

/** Font identity read off a text object, used to choose a fallback. */
export interface FontDescriptor {
  /** Best available name: `baseFont` when present, else `resolvedFamily`. */
  family: string;
  /**
   * The document's own `/BaseFont`, e.g. `Helvetica-Bold` or
   * `ABCDEF+Calibri`. This is what the PDF asked for and is the authority on
   * identity.
   */
  baseFont: string;
  /**
   * What PDFium actually resolved the font to. For a non-embedded font this is
   * a host substitute and says nothing about the document's intent.
   */
  resolvedFamily: string;
  /** PDF `/Flags` bits; see `FontFlag`. */
  flags: number;
  /** 100-900, or 0 when unknown. */
  weight: number;
  italicAngle: number;
  isEmbedded: boolean;
  isSerif: boolean;
  isFixedPitch: boolean;
  isItalic: boolean;
  isBold: boolean;
  /** True for Type 3 and other programs we cannot introspect; read-only. */
  isUnsupported: boolean;
}

/** A run of text drawn by a single PDF text object. */
export interface TextRun {
  /** Path from the page down to this object; see `object-path.ts`. */
  path: ObjectPath;
  /** True when the run lives inside a form XObject. */
  nested: boolean;
  text: string;
  bounds: Rect;
  /**
   * The font size as the object declares it. This is **not** the size the
   * text appears at: the object's matrix may carry a scale, and commonly does
   * inside a form XObject, where a size of 1 with a matrix scale of 12 renders
   * as 12pt. Use this when creating a replacement object, since the matrix is
   * copied along with it.
   */
  fontSize: number;
  /**
   * The size the text actually appears at, in points.
   *
   * `fontSize` multiplied by the matrix's vertical scale. This is the number
   * to show a user and to size an on-screen editor with; using the raw
   * `fontSize` there renders a 12pt line as 1px on any document that puts the
   * scale in the matrix.
   */
  effectiveFontSize: number;
  font: FontDescriptor;
  colour: Rgba;
  /** The object's own transform, needed to place a replacement identically. */
  matrix: Matrix;
}

/**
 * A visually contiguous line, formed by clustering runs that share a baseline.
 *
 * This is the unit the user edits. Word and InDesign routinely split one
 * visual line into many text objects to apply kerning, so a run is too small
 * to be a useful editing target and a paragraph is not represented in PDF at
 * all.
 */
export interface TextLine {
  id: string;
  page: number;
  runs: TextRun[];
  text: string;
  bounds: Rect;
  /** Baseline y in PDF space, averaged across the runs. */
  baseline: number;
  /** Dominant declared font size, taken from the widest run. */
  fontSize: number;
  /** The size the line appears at, in points. See `TextRun.effectiveFontSize`. */
  effectiveFontSize: number;
  /** Font of the widest run, used for the editor's styling and fallbacks. */
  font: FontDescriptor;
  colour: Rgba;
  /** False when any run's font cannot be edited, e.g. Type 3. */
  editable: boolean;
  /** Why editing is unavailable, when `editable` is false. */
  notEditableReason?: string;
}

/** A page object, for selection and deletion. */
export interface PageObject {
  page: number;
  path: ObjectPath;
  nested: boolean;
  type: number;
  bounds: Rect;
  /** Present for text objects. */
  text?: string;
  /** True when the image carries an alpha channel or soft mask. */
  hasAlpha?: boolean;
}

/** An annotation, including signature widgets. */
export interface Annotation {
  page: number;
  index: number;
  subtype: number;
  bounds: Rect;
  /** `FPDF_FORMFIELD_*` when this is a widget, else undefined. */
  formFieldType?: number;
  /** `/T`, the field or annotation title, when present. */
  title?: string;
}

/** Why something was identified as a signature, and how sure we are. */
export interface SignatureCandidate {
  id: string;
  page: number;
  bounds: Rect;
  /**
   * How the signature is stored, which decides whether removal is clean.
   *
   * - `digital`   a `/Sig` form field with cryptographic content
   * - `annotation` a Stamp, Ink or FreeText annotation
   * - `image`     an image object drawn into the page content
   * - `raster`    pixels inside a scanned page; not removable as an object
   */
  kind: 'digital' | 'annotation' | 'image' | 'raster';
  confidence: 'certain' | 'high' | 'medium' | 'low';
  /** The signals that fired, shown in the UI so the guess is auditable. */
  reasons: string[];
  /** Set for `annotation` and `digital`. */
  annotationIndex?: number;
  /** Set for `image`. */
  objectPath?: ObjectPath;
  /** True when removing this will invalidate a cryptographic signature. */
  invalidatesSignature: boolean;
}

/** A rendered page bitmap, ready for `putImageData`. */
export interface RenderedPage {
  page: number;
  width: number;
  height: number;
  /** RGBA, obtained with `FPDF_REVERSE_BYTE_ORDER` so no swizzle is needed. */
  data: Uint8ClampedArray;
  /** The scale this was rendered at, including device pixel ratio. */
  scale: number;
}

/** Text, image, rectangle and mark additions, flattened into the page on apply. */
export type Placement = TextPlacement | ImagePlacement | RectPlacement | PathPlacement;

export interface TextPlacement {
  type: 'text';
  page: number;
  /** Baseline origin in PDF space. */
  x: number;
  y: number;
  text: string;
  fontSize: number;
  colour: Rgba;
  /** Key into the bundled font set; see `fonts.ts`. */
  fontKey: string;
}

export interface ImagePlacement {
  type: 'image';
  page: number;
  rect: Rect;
  /** RGBA pixels. */
  data: Uint8ClampedArray;
  pixelWidth: number;
  pixelHeight: number;
}

export interface RectPlacement {
  type: 'rect';
  page: number;
  rect: Rect;
  colour: Rgba;
}

/**
 * A mark drawn as a vector path: a cross, a tick, a ring, a dot, a rule.
 *
 * For the checkbox that is printed on the page rather than being an
 * interactive field, which is most of them. The shape names a definition in
 * `marks.ts` rather than carrying its own coordinates, so the preview the user
 * positions and the path written into the file come from one source.
 */
export interface PathPlacement {
  type: 'path';
  page: number;
  /** The box the mark is drawn into, in PDF points. */
  rect: Rect;
  shape: MarkShape;
  weight: MarkWeight;
  colour: Rgba;
}

/** What kind of form field something is, in words the interface can use. */
export type FormFieldKind =
  'text' | 'choice' | 'list' | 'checkbox' | 'radio' | 'button' | 'signature' | 'unknown';

/**
 * A field of an interactive form.
 *
 * Separate from `TextLine` deliberately. A line of text is an object in the
 * page's content stream; a field value is a string in the form, painted from
 * its own appearance stream. They are edited by different means and the
 * interface has to say which one the user is touching, so they do not share
 * a type.
 */
export interface FormFieldInfo {
  page: number;
  /** The field's name in the form, e.g. `Surname`. */
  name: string;
  kind: FormFieldKind;
  /** The value currently stored in the field. */
  value: string;
  /** The widget's rectangle, in PDF user space. */
  rect: Rect;
  /** True when the form itself marks the field read-only. */
  readOnly: boolean;
  /** True when the value can be typed into. */
  editable: boolean;
  /** True when a click should tick it rather than open an editor. */
  toggleable: boolean;
  /**
   * The size the value is really drawn at, in points. Never "auto".
   *
   * A widget's box height says nothing about its type size — a 24pt-tall
   * field on a form set in 9pt is ordinary — so anything drawing or measuring
   * the value has to be told. The interface used to guess from the box and
   * showed a 9pt value at 14pt: the value appeared to swell the moment it was
   * clicked, and every width measured off that preview was half as big again
   * as it should have been.
   */
  textSize: number;
  /**
   * True when the value is cut off at the edge of the widget's rectangle.
   *
   * Only a field the engine will leave as a field clips. One whose appearance
   * PDFium cannot be trusted to rebuild is drawn into the page instead, and
   * page text runs on in full — so for those, neither the cut-off warning nor
   * the offer to widen the box means anything.
   */
  clips: boolean;
  /** Why it cannot be changed, when it cannot. */
  notEditableReason?: string;
}

/**
 * Whether a value fits its field, and what it would take to make it fit.
 *
 * A field clips its appearance to its own rectangle, so a value wider than
 * the box is simply cut off — on screen and on paper alike. The exception is
 * a field this engine will draw into the page rather than leave as a field:
 * page text runs on, so nothing is cut off however long the value. See
 * `FormFieldInfo.clips`.
 */
export interface FormFieldFit {
  /** False when the value is wider than the box and will be cut off. */
  fits: boolean;
  /** True when the document declares no type size for the field, i.e. `0 Tf`. */
  autoSized: boolean;
  /** Measured width of the text, in points. */
  textWidth: number;
  /** Width the field needs for the value, clamped to the page. */
  requiredWidth: number;
  /** Widest the field can be before running off the page. */
  maxWidth: number;
}

/** Result of asking whether a font can render a string. */
export interface CoverageResult {
  covered: boolean;
  /** Code points with no glyph in the embedded program. */
  missing: string[];
  /** Why coverage could not be determined, when that is the case. */
  reason?: string;
}
