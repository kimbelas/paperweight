'use client';

import { useSyncExternalStore } from 'react';

/**
 * Read a CSS media query as React state.
 *
 * A media query rather than a resize listener because the browser already
 * knows the answer, and `useSyncExternalStore` reads it during the first
 * render — so a phone never paints the desktop arrangement before correcting
 * itself.
 *
 * `Editor` is loaded with `ssr: false`, so there is no server snapshot to
 * disagree with; the third argument exists only because the signature
 * requires one.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscriberFor(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * One subscribe function per query, kept for the life of the page.
 *
 * `useSyncExternalStore` resubscribes whenever the function it is handed
 * changes, so building a fresh closure on each render would tear down and
 * rebuild the listener on every one of them.
 */
const subscribers = new Map<string, (onChange: () => void) => () => void>();

function subscriberFor(query: string): (onChange: () => void) => () => void {
  let subscribe = subscribers.get(query);
  if (!subscribe) {
    subscribe = (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    };
    subscribers.set(query, subscribe);
  }
  return subscribe;
}
