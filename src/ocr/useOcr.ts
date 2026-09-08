'use client';

import { useCallback, useState } from 'react';
import { measureTransform } from '@/editor/transform';
import { apply } from '@/editor/transform';
import type { Engine } from '@/editor/useEngine';
import { OCR_SCALE, recognisePage, type OcrLine, type OcrProgress } from './recognise';

/**
 * Running OCR over a page and keeping the result.
 *
 * The engine renders the page, this hands the pixels to the recogniser, and
 * the word boxes come back in bitmap coordinates. Turning those into PDF
 * points goes through the engine's own device-to-page mapping rather than a
 * hand-rolled divide-by-scale, because that mapping is the only thing that
 * knows about page rotation and a crop box that does not start at the origin.
 */

export interface OcrState {
  /** Recognised lines, by page index. */
  lines: Record<number, OcrLine[]>;
  /** The page currently being read, if any. */
  busyPage: number | null;
  progress: OcrProgress | null;
  error: string | null;
}

export interface UseOcr extends OcrState {
  run: (page: number) => Promise<OcrLine[]>;
  clearPage: (page: number) => void;
  clearAll: () => void;
  linesFor: (page: number) => OcrLine[];
  /** Replace one recognised line, e.g. after the user edits it. */
  updateLine: (page: number, id: string, text: string) => void;
  removeLine: (page: number, id: string) => void;
}

export function useOcr(engine: Engine): UseOcr {
  const [state, setState] = useState<OcrState>({
    lines: {},
    busyPage: null,
    progress: null,
    error: null,
  });

  const run = useCallback(
    async (page: number): Promise<OcrLine[]> => {
      setState((s) => ({ ...s, busyPage: page, progress: null, error: null }));

      try {
        // Render well above display resolution: recognition accuracy depends
        // far more on this than on anything else here.
        const rendered = await engine.renderPage(page, { scale: OCR_SCALE });

        // The bitmap is treated as a device of its own size, so the engine's
        // mapping converts recognised boxes straight into page space.
        const transform = await measureTransform(
          engine,
          page,
          rendered.width,
          rendered.height,
        );

        const lines = await recognisePage(
          {
            page,
            data: rendered.data,
            width: rendered.width,
            height: rendered.height,
            toPdf: (x, y) => apply(transform.toPage, x, y),
          },
          (progress) => setState((s) => ({ ...s, progress })),
        );

        setState((s) => ({
          ...s,
          lines: { ...s.lines, [page]: lines },
          busyPage: null,
          progress: null,
        }));
        return lines;
      } catch (error) {
        setState((s) => ({
          ...s,
          busyPage: null,
          progress: null,
          error:
            error instanceof Error
              ? error.message
              : 'The page could not be read.',
        }));
        return [];
      }
    },
    [engine],
  );

  const clearPage = useCallback((page: number) => {
    setState((s) => {
      const next = { ...s.lines };
      delete next[page];
      return { ...s, lines: next };
    });
  }, []);

  const clearAll = useCallback(() => {
    setState({ lines: {}, busyPage: null, progress: null, error: null });
  }, []);

  const linesFor = useCallback((page: number) => state.lines[page] ?? [], [state.lines]);

  const updateLine = useCallback((page: number, id: string, text: string) => {
    setState((s) => ({
      ...s,
      lines: {
        ...s.lines,
        [page]: (s.lines[page] ?? []).map((line) =>
          line.id === id
            ? // Once edited, the text is the user's rather than a guess, so it
              // is marked fully confident and stops being flagged as uncertain.
              { ...line, text, confidence: 100 }
            : line,
        ),
      },
    }));
  }, []);

  const removeLine = useCallback((page: number, id: string) => {
    setState((s) => ({
      ...s,
      lines: {
        ...s.lines,
        [page]: (s.lines[page] ?? []).filter((line) => line.id !== id),
      },
    }));
  }, []);

  return { ...state, run, clearPage, clearAll, linesFor, updateLine, removeLine };
}

/** Find the recognised line under a point in PDF space. */
export function ocrLineAt(lines: OcrLine[], x: number, y: number): OcrLine | null {
  let best: OcrLine | null = null;
  let bestArea = Infinity;

  for (const line of lines) {
    const { bounds } = line;
    // A small vertical tolerance, because a recognised box hugs the ink and a
    // click aimed at a line of small print often lands just outside it.
    const pad = Math.max(1, (bounds.top - bounds.bottom) * 0.25);
    if (
      x < bounds.left - pad ||
      x > bounds.right + pad ||
      y < bounds.bottom - pad ||
      y > bounds.top + pad
    ) {
      continue;
    }
    // Prefer the tightest match, so a click inside a short line is not
    // claimed by a long one that happens to overlap it.
    const area = (bounds.right - bounds.left) * (bounds.top - bounds.bottom);
    if (area < bestArea) {
      best = line;
      bestArea = area;
    }
  }

  return best;
}
