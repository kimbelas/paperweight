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
    mode === 'width' ? byWidth : Math.min(byWidth, ...pages.map((p) => availableHeight / p.height));
  return Math.max(0.1, Math.min(4, next));
}
