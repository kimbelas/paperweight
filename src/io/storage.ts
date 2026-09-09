'use client';

import { get, set } from 'idb-keyval';
import type { SavedSignature } from '@/editor/store';

/**
 * The few things worth remembering between visits.
 *
 * Signatures, mostly. Capturing one takes deliberate effort — drawing it with
 * a mouse especially — and losing it on every reload made the feature feel
 * disposable. They are stored as data URLs in IndexedDB, which stays on the
 * device like everything else here.
 *
 * Documents are never stored. Keeping a copy of someone's contract in browser
 * storage they did not ask for would undercut the point of the app.
 */

const SIGNATURES_KEY = 'paperweight:signatures';
const PREFS_KEY = 'paperweight:prefs';

/** How many to keep. Older ones fall off rather than growing without limit. */
const MAX_SIGNATURES = 8;

export async function loadSignatures(): Promise<SavedSignature[]> {
  try {
    const stored = await get<SavedSignature[]>(SIGNATURES_KEY);
    if (!Array.isArray(stored)) return [];
    // Guard against a shape change or a partially written record rather than
    // letting a bad entry break the panel.
    return stored.filter(
      (s): s is SavedSignature =>
        typeof s?.id === 'string' &&
        typeof s.dataUrl === 'string' &&
        s.dataUrl.startsWith('data:image/'),
    );
  } catch {
    // Private windows and blocked site data both throw here. A missing
    // signature list is not worth surfacing as an error.
    return [];
  }
}

export async function saveSignatures(signatures: SavedSignature[]): Promise<void> {
  try {
    await set(SIGNATURES_KEY, signatures.slice(-MAX_SIGNATURES));
  } catch {
    // Storage unavailable. The signature still works for this session.
  }
}

export interface Preferences {
  /** The pages rail, on the right. */
  showThumbnails: boolean;
  /** The actions rail, on the left. */
  showTools: boolean;
  fitMode: 'width' | 'page';
}

const DEFAULT_PREFS: Preferences = { showThumbnails: true, showTools: true, fitMode: 'width' };

export async function loadPreferences(): Promise<Preferences> {
  try {
    const stored = await get<Partial<Preferences>>(PREFS_KEY);
    return {
      showThumbnails:
        typeof stored?.showThumbnails === 'boolean'
          ? stored.showThumbnails
          : DEFAULT_PREFS.showThumbnails,
      showTools:
        typeof stored?.showTools === 'boolean' ? stored.showTools : DEFAULT_PREFS.showTools,
      fitMode: stored?.fitMode === 'page' ? 'page' : DEFAULT_PREFS.fitMode,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  try {
    await set(PREFS_KEY, prefs);
  } catch {
    // Not important enough to report.
  }
}

/** Read an image file the user picked, as RGBA pixels. */
export async function readImageFile(
  file: File,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);

  // Cap the size: a phone photo is far larger than a page needs, and the
  // pixels are copied through the worker on apply.
  const maxEdge = 2000;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });

  const ctx = (canvas as HTMLCanvasElement).getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('That image could not be read.');

  ctx.drawImage(bitmap, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  bitmap.close?.();

  return { data: image.data, width, height };
}

/** Prompt for an image file. */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
