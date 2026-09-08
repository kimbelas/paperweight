'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';

/**
 * Capturing a signature: draw it, type it, or upload a photo of it.
 *
 * All three produce the same thing — RGBA pixels with a transparent
 * background — because that is what can be placed on a page and printed
 * identically everywhere.
 *
 * Transparency is the part that matters. A signature on an opaque white
 * rectangle covers the line it is meant to sit on, which is the giveaway that
 * a tool has done this badly.
 */

export interface CapturedSignature {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** For the saved-signatures list. */
  dataUrl: string;
}

interface SignatureModalProps {
  open: boolean;
  onClose: () => void;
  onUse: (signature: CapturedSignature) => void;
}

type Mode = 'draw' | 'type' | 'upload';

/** Script faces offered for a typed signature, matching the bundled fonts. */
const SCRIPT_FONTS = [
  { key: 'script-dancing', label: 'Dancing Script', css: '"DancingScriptPreview", cursive' },
  { key: 'script-vibes', label: 'Great Vibes', css: '"GreatVibesPreview", cursive' },
  { key: 'script-caveat', label: 'Caveat', css: '"CaveatPreview", cursive' },
];

/** Rendered signature size in pixels. Generous, so scaling down stays crisp. */
const OUT_WIDTH = 600;
const OUT_HEIGHT = 200;

export function SignatureModal({ open, onClose, onUse }: SignatureModalProps) {
  const [mode, setMode] = useState<Mode>('draw');
  const [typed, setTyped] = useState('');
  const [fontKey, setFontKey] = useState(SCRIPT_FONTS[0].key);
  const [uploaded, setUploaded] = useState<CapturedSignature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inkColour, setInkColour] = useState('#111a5c');

  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);

  // Load the script faces for the on-screen preview. The PDF itself embeds
  // the real font files; these are only so the preview matches.
  useEffect(() => {
    if (!open) return;
    const faces = [
      new FontFace('DancingScriptPreview', 'url(/fonts/DancingScript-Variable.ttf)'),
      new FontFace('GreatVibesPreview', 'url(/fonts/GreatVibes-Regular.ttf)'),
      new FontFace('CaveatPreview', 'url(/fonts/Caveat-Variable.ttf)'),
    ];
    for (const face of faces) {
      face
        .load()
        .then((loaded) => document.fonts.add(loaded))
        .catch(() => {
          /* The preview falls back to a generic cursive; not worth an error. */
        });
    }
  }, [open]);

  // Set up the drawing pad.
  useEffect(() => {
    if (!open || mode !== 'draw') return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;

    // The pad must be sized in device pixels or the stroke is blurry, which
    // is the single most common flaw in browser signature capture.
    const dpr = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx?.scale(dpr, dpr);

    const pad = new SignaturePad(canvas, {
      penColor: inkColour,
      // Transparent, so the page shows through where there is no ink.
      backgroundColor: 'rgba(0,0,0,0)',
      minWidth: 0.8,
      maxWidth: 2.4,
    });
    padRef.current = pad;

    return () => {
      pad.off();
      padRef.current = null;
    };
  }, [open, mode, inkColour]);

  const reset = useCallback(() => {
    setTyped('');
    setUploaded(null);
    setError(null);
    padRef.current?.clear();
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Close on Escape, which is expected of any modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleUse = async () => {
    setError(null);
    try {
      let captured: CapturedSignature | null = null;

      if (mode === 'draw') {
        const pad = padRef.current;
        if (!pad || pad.isEmpty()) {
          setError('Draw your signature first.');
          return;
        }
        captured = trimToInk(drawCanvasRef.current!);
      } else if (mode === 'type') {
        if (typed.trim() === '') {
          setError('Type your name first.');
          return;
        }
        captured = renderTyped(typed, fontKey, inkColour);
      } else {
        if (!uploaded) {
          setError('Choose an image first.');
          return;
        }
        captured = uploaded;
      }

      if (!captured) {
        setError('That signature could not be prepared.');
        return;
      }
      onUse(captured);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That signature could not be prepared.');
    }
  };

  const handleUpload = async (file: File) => {
    setError(null);
    try {
      setUploaded(await imageToSignature(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be read.');
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgb(0 0 0 / 0.45)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl"
        style={{
          background: 'var(--app-panel)',
          border: '1px solid var(--app-border)',
          boxShadow: 'var(--app-shadow)',
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add a signature"
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--app-border)' }}
        >
          <h2 className="text-sm font-semibold">Add a signature</h2>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded px-2 py-1 text-lg leading-none"
            style={{ background: 'transparent', border: 'none', color: 'var(--app-text-dim)', cursor: 'pointer' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {(['draw', 'type', 'upload'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setMode(option);
                setError(null);
              }}
              className="focus-ring rounded-md px-3 py-1.5 text-xs font-medium capitalize"
              style={{
                background: mode === option ? 'var(--app-accent-soft)' : 'transparent',
                color: mode === option ? 'var(--app-accent)' : 'var(--app-text-dim)',
                border: `1px solid ${mode === option ? 'var(--app-accent)' : 'var(--app-border)'}`,
                cursor: 'pointer',
              }}
            >
              {option}
            </button>
          ))}

          <label className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--app-text-dim)' }}>
            Ink
            <input
              type="color"
              value={inkColour}
              onChange={(event) => setInkColour(event.target.value)}
              className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
              aria-label="Ink colour"
            />
          </label>
        </div>

        <div className="px-4 py-3">
          {mode === 'draw' && (
            <div>
              <canvas
                ref={drawCanvasRef}
                className="block w-full touch-none rounded-md"
                style={{
                  height: 180,
                  background:
                    'repeating-conic-gradient(var(--app-panel-2) 0% 25%, var(--app-panel) 0% 50%) 50% / 16px 16px',
                  border: '1px dashed var(--app-border-strong)',
                  cursor: 'crosshair',
                }}
                aria-label="Draw your signature here"
              />
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs" style={{ color: 'var(--app-text-faint)' }}>
                  Draw with a mouse, trackpad, stylus or finger.
                </p>
                <button
                  type="button"
                  onClick={() => padRef.current?.clear()}
                  className="focus-ring rounded px-2 py-1 text-xs"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--app-border)',
                    color: 'var(--app-text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {mode === 'type' && (
            <div>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Your name"
                className="focus-ring w-full rounded-md px-3 py-2 text-sm"
                style={{
                  background: 'var(--app-panel-2)',
                  border: '1px solid var(--app-border)',
                  color: 'var(--app-text)',
                }}
                aria-label="Name to render as a signature"
              />

              <div className="mt-3 grid gap-2">
                {SCRIPT_FONTS.map((font) => (
                  <button
                    key={font.key}
                    type="button"
                    onClick={() => setFontKey(font.key)}
                    className="focus-ring flex items-center justify-between rounded-md px-3 py-2 text-left"
                    style={{
                      background: fontKey === font.key ? 'var(--app-accent-soft)' : 'var(--app-panel-2)',
                      border: `1px solid ${fontKey === font.key ? 'var(--app-accent)' : 'var(--app-border)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: font.css,
                        fontSize: 26,
                        color: inkColour,
                        lineHeight: 1.2,
                      }}
                    >
                      {typed.trim() || 'Your name'}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--app-text-faint)' }}>
                      {font.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'upload' && (
            <div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUpload(file);
                }}
                className="focus-ring w-full rounded-md px-3 py-2 text-sm"
                style={{
                  background: 'var(--app-panel-2)',
                  border: '1px solid var(--app-border)',
                  color: 'var(--app-text)',
                }}
                aria-label="Signature image file"
              />
              <p className="mt-2 text-xs" style={{ color: 'var(--app-text-faint)' }}>
                A photo or scan works. The background is made transparent automatically, so the
                signature sits on the page rather than in a white box.
              </p>

              {uploaded && (
                <div
                  className="mt-3 grid place-items-center rounded-md p-2"
                  style={{
                    background:
                      'repeating-conic-gradient(var(--app-panel-2) 0% 25%, var(--app-panel) 0% 50%) 50% / 16px 16px',
                    border: '1px solid var(--app-border)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={uploaded.dataUrl}
                    alt="Signature preview"
                    style={{ maxHeight: 140, maxWidth: '100%' }}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <p
              className="mt-3 rounded-md px-3 py-2 text-xs"
              style={{ background: 'var(--app-danger-soft)', color: 'var(--app-danger)' }}
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--app-border)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="focus-ring rounded-md px-3 py-1.5 text-xs"
            style={{
              background: 'transparent',
              border: '1px solid var(--app-border)',
              color: 'var(--app-text-dim)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleUse()}
            className="focus-ring rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--app-accent)', border: 'none', color: '#fff', cursor: 'pointer' }}
          >
            Place on page
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turning each input mode into transparent pixels
// ---------------------------------------------------------------------------

/**
 * Crop a drawn signature to its ink.
 *
 * Without this the placed image carries the whole pad's worth of empty space,
 * so the visible signature ends up a fraction of the box the user positioned
 * and sizing it feels broken.
 */
function trimToInk(source: HTMLCanvasElement): CapturedSignature {
  const ctx = source.getContext('2d');
  if (!ctx) throw new Error('The drawing could not be read.');

  const { width, height } = source;
  const pixels = ctx.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels.data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) throw new Error('Draw your signature first.');

  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  const outCtx = out.getContext('2d');
  if (!outCtx) throw new Error('The drawing could not be prepared.');
  outCtx.drawImage(source, minX, minY, out.width, out.height, 0, 0, out.width, out.height);

  return toCaptured(out);
}

/** Render typed text in a script face onto a transparent canvas. */
function renderTyped(text: string, fontKey: string, colour: string): CapturedSignature {
  const font = SCRIPT_FONTS.find((f) => f.key === fontKey) ?? SCRIPT_FONTS[0];

  const canvas = document.createElement('canvas');
  canvas.width = OUT_WIDTH;
  canvas.height = OUT_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The signature could not be drawn.');

  // Fit the name to the canvas rather than clipping a long one.
  let size = 120;
  ctx.textBaseline = 'alphabetic';
  do {
    ctx.font = `${size}px ${font.css}`;
    if (ctx.measureText(text).width <= OUT_WIDTH - 40) break;
    size -= 4;
  } while (size > 24);

  ctx.fillStyle = colour;
  const metrics = ctx.measureText(text);
  ctx.fillText(text, (OUT_WIDTH - metrics.width) / 2, OUT_HEIGHT * 0.68);

  return trimToInk(canvas);
}

/**
 * Read an uploaded image and make its background transparent.
 *
 * A photographed signature is dark ink on off-white paper. Alpha is set from
 * how dark each pixel is, on a ramp rather than a hard threshold: a threshold
 * leaves jagged, aliased edges that look obviously cut out.
 */
async function imageToSignature(file: File): Promise<CapturedSignature> {
  const bitmap = await loadImage(file);

  // Cap the size: a phone photo is far larger than a signature ever needs.
  const scale = Math.min(1, OUT_WIDTH / bitmap.width, (OUT_HEIGHT * 2) / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('That image could not be processed.');
  ctx.drawImage(bitmap, 0, 0, width, height);

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  // If the source already has meaningful transparency, it is a cut-out PNG
  // and must be left alone; re-keying it would eat the ink.
  let transparentPixels = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) transparentPixels++;
  }
  const alreadyCut = transparentPixels > data.length / 4 / 20;

  if (!alreadyCut) {
    const LIGHT = 235; // At or above this, treat as paper.
    const DARK = 120; // At or below this, treat as full ink.

    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luma >= LIGHT) {
        data[i + 3] = 0;
      } else if (luma > DARK) {
        // Ramp through the midtones so edges stay smooth.
        data[i + 3] = Math.round(255 * (1 - (luma - DARK) / (LIGHT - DARK)));
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  return trimToInk(canvas);
}

function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read.'));
    };
    img.src = url;
  });
}

function toCaptured(canvas: HTMLCanvasElement): CapturedSignature {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The signature could not be prepared.');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    data: image.data,
    width: canvas.width,
    height: canvas.height,
    dataUrl: canvas.toDataURL('image/png'),
  };
}
