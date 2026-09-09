/**
 * Build an `ImageData` from engine pixels.
 *
 * The buffer arriving from the worker is typed as backed by `ArrayBufferLike`,
 * which `ImageData` will not accept because it could in principle be a
 * `SharedArrayBuffer`. It never is here — the engine is single-threaded by
 * design, and a transferred buffer is always a plain `ArrayBuffer` — so this
 * narrows once, in one place, instead of at every canvas call site.
 */
export function toImageData(pixels: Uint8ClampedArray, width: number, height: number): ImageData {
  return new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height);
}
