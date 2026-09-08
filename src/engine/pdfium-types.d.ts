// This import is what makes the file a module, so the block below augments
// `@embedpdf/pdfium` rather than replacing its type declarations.
import '@embedpdf/pdfium';

/**
 * Type augmentation for the PDFium module.
 *
 * `@embedpdf/pdfium` types its module as `EmscriptenModule` plus the runtime
 * helpers it re-exports, and the bundled `@types/emscripten` does not declare
 * the typed-array heap views. They exist at runtime — every Emscripten build
 * has them — so they are declared here rather than being reached through
 * casts at each of the dozen call sites that copy bytes in or out.
 */
declare module '@embedpdf/pdfium' {
  interface PdfiumModule {
    HEAPU8: Uint8Array;
    HEAP8: Int8Array;
    HEAPU16: Uint16Array;
    HEAP16: Int16Array;
    HEAPU32: Uint32Array;
    HEAP32: Int32Array;
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;
  }
}
