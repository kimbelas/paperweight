import { AnnotSubtype, ObjType } from './constants';
import { listAnnotations, listDigitalSignatures, removeAnnotations } from './annotations';
import type { PdfDocument } from './document';
import { rectHeight, rectWidth, type Rect } from './memory';
import { listPageObjects } from './objects';
import { getTextRuns } from './text';
import { removeObjectsByPath } from './text-edit';
import type { Badge, SignatureCandidate } from './types';

/**
 * Finding and removing signatures.
 *
 * "Remove the signature" sounds like one feature and is really four, because a
 * signature can be any of four different things in a PDF file. They differ in
 * how reliably they can be found and whether removal is honest, so they are
 * kept distinct all the way to the UI rather than being flattened into one
 * button that sometimes lies.
 *
 *   digital     a `/Sig` form field with cryptographic content. Certain to
 *               find. Removable, but doing so destroys verifiability, and no
 *               edit anywhere in the file can preserve it.
 *   annotation  a Stamp, Ink or FreeText annotation. Reliably found, cleanly
 *               removed: annotations are not part of page content.
 *   image       an image drawn into the page content stream. Found only by
 *               heuristics, but genuinely removable once found.
 *   raster      ink inside a scanned page image. Cannot be removed as an
 *               object at all, because it is not one.
 *
 * The last case is where other tools mislead people: they draw a white box
 * and call it removal. Here it is reported as unremovable, and covering it is
 * offered as a separate, differently-named action.
 */

/** Words that appear near a signature. */
const LABEL_PATTERN =
  /\b(signature|signed|sign here|sgd|authorised|authorized|approved|witness)\b|\/s\/|_{6,}/i;

/** How far from an image to look for a label, in points. */
const LABEL_RADIUS = 60;

export interface SignatureScan {
  candidates: SignatureCandidate[];
  /** Cryptographic signatures in the document, regardless of page. */
  digitalCount: number;
  /**
   * `/DocMDP` level of the strictest certification signature, or 0 if none.
   * 1 forbids all changes, 2 allows form fill-in, 3 allows annotations too.
   */
  certificationLevel: number;
}

/** Find everything on a page that looks like a signature. */
export function scanPageForSignatures(doc: PdfDocument, pageIndex: number): SignatureCandidate[] {
  const candidates: SignatureCandidate[] = [];
  const pageInfo = doc.pageInfo(pageIndex);
  const hasDigital = doc.mod.FPDF_GetSignatureCount(doc.handle) > 0;

  // --- Tier 1: annotations, including signature form fields ---------------
  for (const annot of listAnnotations(doc, pageIndex)) {
    if (annot.isSignedSignatureField) {
      candidates.push({
        id: `p${pageIndex}-sig-annot${annot.index}`,
        page: pageIndex,
        bounds: annot.bounds,
        kind: 'digital',
        confidence: 'certain',
        reasons: [
          'A signature form field holding signature data.',
          annot.title ? `Field name: ${annot.title}.` : 'Unnamed field.',
        ],
        annotationIndex: annot.index,
        invalidatesSignature: true,
      });
      continue;
    }

    if (annot.isEmptySignatureField) {
      candidates.push({
        id: `p${pageIndex}-sigfield${annot.index}`,
        page: pageIndex,
        bounds: annot.bounds,
        kind: 'annotation',
        confidence: 'certain',
        reasons: [
          'An empty signature field: a place for a signature, with nothing in it.',
          'Removing it does not invalidate anything.',
        ],
        annotationIndex: annot.index,
        invalidatesSignature: false,
      });
      continue;
    }

    const isSignatureShaped =
      annot.subtype === AnnotSubtype.Stamp ||
      annot.subtype === AnnotSubtype.Ink ||
      annot.subtype === AnnotSubtype.FreeText;
    if (!isSignatureShaped) continue;

    const reasons: string[] = [];
    if (annot.subtype === AnnotSubtype.Ink) reasons.push('A hand-drawn ink annotation.');
    if (annot.subtype === AnnotSubtype.Stamp) reasons.push('A stamp annotation.');
    if (annot.subtype === AnnotSubtype.FreeText) reasons.push('A typed text annotation.');

    const labelled = [annot.title, annot.name].filter(Boolean).join(' ');
    const named = LABEL_PATTERN.test(labelled);
    if (named) reasons.push(`Named "${labelled}".`);

    const shaped = isSignatureAspect(annot.bounds);
    if (shaped) reasons.push('Wide and short, like a signature.');

    // Ink is nearly always a signature in a document like this. Stamps and
    // free text need corroboration, or every sticky note becomes a candidate.
    const confidence: SignatureCandidate['confidence'] =
      annot.subtype === AnnotSubtype.Ink || named
        ? 'high'
        : shaped
          ? 'medium'
          : 'low';

    candidates.push({
      id: `p${pageIndex}-annot${annot.index}`,
      page: pageIndex,
      bounds: annot.bounds,
      kind: 'annotation',
      confidence,
      reasons,
      annotationIndex: annot.index,
      invalidatesSignature: hasDigital,
    });
  }

  // --- Tier 3: a scanned page. Nothing here is an object -----------------
  if (pageInfo.isScanned) {
    candidates.push({
      id: `p${pageIndex}-raster`,
      page: pageIndex,
      bounds: { left: 0, bottom: 0, right: pageInfo.width, top: pageInfo.height },
      kind: 'raster',
      confidence: 'low',
      reasons: [
        'This page is a scanned image.',
        'Any signature on it is part of the picture, not a separate object, so it cannot be removed as one.',
      ],
      invalidatesSignature: false,
    });
    return candidates;
  }

  // --- Tier 2: images drawn into the page content ------------------------
  const objects = listPageObjects(doc, pageIndex);
  const images = objects.filter((o) => o.type === ObjType.Image);
  const textRuns = getTextRuns(doc, pageIndex);

  for (const image of images) {
    const reasons: string[] = [];
    let score = 0;

    if (isSignatureAspect(image.bounds)) {
      score += 2;
      reasons.push('Wide and short, in the range signatures occupy.');
    }

    const width = rectWidth(image.bounds);
    if (width >= 60 && width <= 320) {
      score += 1;
      reasons.push('Roughly the width of a signature.');
    }

    const pageArea = pageInfo.width * pageInfo.height;
    const area = rectWidth(image.bounds) * rectHeight(image.bounds);
    if (area < pageArea * 0.15) {
      score += 1;
    } else {
      // A large image is a photograph, a logo banner or a background, not a
      // signature. This is a strong negative signal.
      score -= 3;
      reasons.push('Large for a signature.');
    }

    if (image.hasAlpha) {
      score += 2;
      reasons.push('Has a transparent background, as a signature cut-out does.');
    }

    if (image.bounds.bottom < pageInfo.height * 0.4) {
      score += 1;
      reasons.push('In the lower part of the page, where signatures go.');
    }

    const label = findNearbyLabel(image.bounds, textRuns);
    if (label) {
      score += 3;
      reasons.push(`Next to the text "${label.trim()}".`);
    }

    // Several small images on a page are usually icons or bullets. One is far
    // more likely to be a signature.
    if (images.length === 1) {
      score += 1;
    } else if (images.length > 6) {
      score -= 1;
    }

    if (score < 4) continue;

    candidates.push({
      id: `p${pageIndex}-img${image.path.join('.')}`,
      page: pageIndex,
      bounds: image.bounds,
      kind: 'image',
      confidence: score >= 8 ? 'high' : score >= 6 ? 'medium' : 'low',
      reasons,
      objectPath: image.path,
      invalidatesSignature: hasDigital,
    });
  }

  return candidates;
}

/** Scan the whole document. */
export function scanForSignatures(doc: PdfDocument): SignatureScan {
  const candidates: SignatureCandidate[] = [];
  for (let i = 0; i < doc.pageCount; i++) {
    candidates.push(...scanPageForSignatures(doc, i));
  }

  const digital = listDigitalSignatures(doc);
  const certification = digital.reduce(
    (strictest, sig) =>
      sig.docMdpPermission > 0
        ? strictest === 0
          ? sig.docMdpPermission
          : Math.min(strictest, sig.docMdpPermission)
        : strictest,
    0,
  );

  return {
    candidates: candidates.sort(byConfidence),
    digitalCount: digital.length,
    certificationLevel: certification,
  };
}

const CONFIDENCE_ORDER = { certain: 0, high: 1, medium: 2, low: 3 } as const;

function byConfidence(a: SignatureCandidate, b: SignatureCandidate): number {
  const d = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
  return d !== 0 ? d : a.page - b.page;
}

/**
 * A signature is wider than it is tall, but not a thin rule.
 *
 * The band is deliberately generous. Being over-inclusive here costs the user
 * one glance at a labelled candidate they can ignore; being under-inclusive
 * means the thing they came to remove is not in the list.
 */
function isSignatureAspect(bounds: Rect): boolean {
  const w = rectWidth(bounds);
  const h = rectHeight(bounds);
  if (h <= 1 || w <= 1) return false;
  const ratio = w / h;
  return ratio >= 1.5 && ratio <= 8;
}

/** Look for signature wording near a rectangle. */
function findNearbyLabel(
  bounds: Rect,
  runs: { text: string; bounds: Rect }[],
): string | null {
  for (const run of runs) {
    if (!LABEL_PATTERN.test(run.text)) continue;

    // Horizontally overlapping or close, and vertically within a short reach.
    // A signature sits just above its printed label or beside it.
    const horizontallyNear =
      run.bounds.right >= bounds.left - LABEL_RADIUS &&
      run.bounds.left <= bounds.right + LABEL_RADIUS;
    const verticallyNear =
      run.bounds.bottom <= bounds.top + LABEL_RADIUS &&
      run.bounds.top >= bounds.bottom - LABEL_RADIUS;

    if (horizontallyNear && verticallyNear) return run.text;
  }
  return null;
}

export interface RemoveSignatureResult {
  removed: boolean;
  badges: Badge[];
}

/**
 * Remove a signature candidate.
 *
 * Each kind takes the route that genuinely removes it. A raster signature has
 * no route, and is refused rather than quietly covered: covering is a separate
 * action the user chooses knowingly.
 */
export function removeSignature(
  doc: PdfDocument,
  candidate: SignatureCandidate,
): RemoveSignatureResult {
  const badges: Badge[] = [];

  if (candidate.kind === 'raster') {
    throw new Error(
      'This signature is part of a scanned image, so it cannot be removed as an object. Use the Cover tool to hide it, which leaves the original pixels in the file.',
    );
  }

  if (candidate.invalidatesSignature) {
    badges.push({
      kind: 'signature-invalidated',
      message:
        'This document was digitally signed. Saving these changes makes that signature invalid, because it certifies the exact bytes of the original.',
      page: candidate.page,
    });
  }

  let removed = false;

  if (candidate.kind === 'digital' || candidate.kind === 'annotation') {
    if (candidate.annotationIndex === undefined) {
      throw new Error('That signature is no longer on the page.');
    }
    removed = removeAnnotations(doc, candidate.page, [candidate.annotationIndex]) > 0;
  } else if (candidate.kind === 'image') {
    if (!candidate.objectPath) throw new Error('That signature is no longer on the page.');
    removed = removeObjectsByPath(doc, candidate.page, [candidate.objectPath]) > 0;
  }

  if (!removed) throw new Error('That signature could not be removed.');
  return { removed, badges };
}
