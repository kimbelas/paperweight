/**
 * PDFium enum values, transcribed from the public headers.
 *
 * These are ABI constants: they must match the compiled WASM, so they are
 * written out literally rather than derived. Sources are named per group.
 */

/** `FPDF_PAGEOBJ_*` — fpdf_edit.h */
export const ObjType = {
  Unknown: 0,
  Text: 1,
  Path: 2,
  Image: 3,
  Shading: 4,
  Form: 5,
} as const;
export type ObjTypeValue = (typeof ObjType)[keyof typeof ObjType];

/** `FPDFBitmap_*` formats — fpdfview.h */
export const BitmapFormat = {
  Unknown: 0,
  Gray: 1,
  BGR: 2,
  BGRx: 3,
  BGRA: 4,
} as const;

/** Render flags — fpdfview.h */
export const RenderFlag = {
  Annot: 0x01,
  LcdText: 0x02,
  NoNativeText: 0x04,
  Grayscale: 0x08,
  /** Emit RGBA rather than BGRA, which is what canvas ImageData wants. */
  ReverseByteOrder: 0x10,
  NoCatch: 0x100,
  LimitedImageCache: 0x200,
  ForceHalftone: 0x400,
  Printing: 0x800,
  NoSmoothText: 0x1000,
  NoSmoothImage: 0x2000,
  NoSmoothPath: 0x4000,
} as const;

/** `FPDF_FONT_*` — fpdf_edit.h */
export const FontType = {
  Type1: 1,
  TrueType: 2,
} as const;

/** `FPDF_ANNOT_*` subtypes — fpdf_annot.h */
export const AnnotSubtype = {
  Unknown: 0,
  Text: 1,
  Link: 2,
  FreeText: 3,
  Line: 4,
  Square: 5,
  Circle: 6,
  Polygon: 7,
  Polyline: 8,
  Highlight: 9,
  Underline: 10,
  Squiggly: 11,
  StrikeOut: 12,
  Stamp: 13,
  Caret: 14,
  Ink: 15,
  Popup: 16,
  FileAttachment: 17,
  Sound: 18,
  Movie: 19,
  Widget: 20,
  Screen: 21,
  PrinterMark: 22,
  TrapNet: 23,
  Watermark: 24,
  ThreeD: 25,
  RichMedia: 26,
  XfaWidget: 27,
  Redact: 28,
} as const;

/** `FORMTYPE_*` — fpdfview.h. `None` means the document has no AcroForm. */
export const FormType = {
  None: 0,
  AcroForm: 1,
  XfaFull: 2,
  XfaForeground: 3,
} as const;

/** `FPDF_FORMFIELD_*` — fpdf_formfill.h */
export const FormFieldType = {
  Unknown: 0,
  PushButton: 1,
  CheckBox: 2,
  RadioButton: 3,
  ComboBox: 4,
  ListBox: 5,
  TextField: 6,
  Signature: 7,
} as const;

/**
 * PDF font descriptor `/Flags` bits — PDF 32000-1 Table 123.
 * Returned by `FPDFFont_GetFlags`.
 */
export const FontFlag = {
  FixedPitch: 1 << 0,
  Serif: 1 << 1,
  Symbolic: 1 << 2,
  Script: 1 << 3,
  Nonsymbolic: 1 << 5,
  Italic: 1 << 6,
  AllCap: 1 << 16,
  SmallCap: 1 << 17,
  ForceBold: 1 << 18,
} as const;

/** `FPDF_SaveAsCopy` flags — fpdf_save.h */
export const SaveFlag = {
  Incremental: 1,
  NoIncremental: 2,
  RemoveSecurity: 3,
} as const;

/** `FPDFPath_SetDrawMode` fill modes — fpdf_edit.h */
export const FillMode = {
  None: 0,
  Alternate: 1,
  Winding: 2,
} as const;

/** `CFX_GraphStateData::LineCap` — fpdf_edit.h */
export const LineCap = {
  Butt: 0,
  Round: 1,
  Square: 2,
} as const;

/** `CFX_GraphStateData::LineJoin` — fpdf_edit.h */
export const LineJoin = {
  Miter: 0,
  Round: 1,
  Bevel: 2,
} as const;

/** Error codes from `FPDF_GetLastError` — fpdfview.h */
export const PdfError = {
  Success: 0,
  Unknown: 1,
  File: 2,
  Format: 3,
  Password: 4,
  Security: 5,
  Page: 6,
} as const;

export const PDF_ERROR_MESSAGES: Record<number, string> = {
  0: 'No error.',
  1: 'Unknown error while loading the document.',
  2: 'The file could not be read.',
  3: 'This file is not a valid PDF, or it is damaged beyond repair.',
  4: 'This PDF is password protected. A correct password is required.',
  5: 'This PDF uses an unsupported security scheme.',
  6: 'A page could not be loaded.',
};

/** Sizes in bytes of the PDFium structs we marshal by hand. */
export const StructSize = {
  /** `FS_MATRIX` — 6 floats (a, b, c, d, e, f). */
  Matrix: 24,
  /** `FS_RECTF` — 4 floats, in the order left, top, right, bottom. */
  RectF: 16,
  /** `FS_POINTF` — 2 floats. */
  PointF: 8,
  /** `FS_QUADPOINTSF` — 8 floats, four corners. */
  QuadPointsF: 32,
  /** `FPDF_FILEWRITE` — an int version plus a function pointer. */
  FileWrite: 8,
  /**
   * `FPDF_FORMFILLINFO` — an int version followed by ~35 callback pointers.
   *
   * Deliberately over-allocated and zero-filled rather than sized exactly.
   * Every callback is optional and PDFium null-checks each one before calling
   * it, so a zeroed block is a valid "provide nothing" struct; the only thing
   * that must be right is the version at offset 0. Over-allocating costs a
   * few bytes once per document and cannot under-run if the struct grows in a
   * later PDFium, whereas an exact size that drifts is a heap overflow.
   */
  FormFillInfo: 256,
} as const;
