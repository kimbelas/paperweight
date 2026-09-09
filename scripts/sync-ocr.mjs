/**
 * Put the OCR engine's assets into `public/tesseract/`.
 *
 * tesseract.js defaults to fetching its worker, its WASM core and its language
 * model from jsdelivr. That would quietly break the one promise this app
 * makes — that nothing leaves the device — and it would also mean OCR simply
 * does not work offline. So everything is hosted locally and the paths are
 * pinned explicitly in `src/ocr/recognise.ts`.
 *
 * Only the SIMD LSTM core is copied. tesseract.js picks a variant by feature
 * detection when `corePath` names a directory, but pointing it straight at one
 * file skips that and saves shipping five unused builds, about 13 MB of them.
 * WebAssembly SIMD has been available in every current browser engine for
 * years, and the app already requires WebAssembly to do anything at all.
 *
 * The language model is the `fast` LSTM build: 1.9 MB against roughly 15 MB
 * for the full one, and accuracy on printed documents is close. It is fetched
 * once, checked against a pinned hash, and then lives in the repo's gitignored
 * `public/`.
 *
 * Run with `node scripts/sync-ocr.mjs`.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const outDir = join(process.cwd(), 'public', 'tesseract');

await mkdir(outDir, { recursive: true });

/**
 * Resolve a file inside an installed package, whatever the store layout.
 *
 * `tesseract.js-core` is a transitive dependency, and pnpm does not put those
 * at the project root, so it is resolved from `tesseract.js` rather than from
 * here.
 */
const tesseractDir = dirname(require.resolve('tesseract.js/package.json'));
const requireFromTesseract = createRequire(join(tesseractDir, 'package.json'));

function resolveIn(pkg, file) {
  const resolver = pkg === 'tesseract.js' ? require : requireFromTesseract;
  const entry = resolver.resolve(`${pkg}/package.json`);
  return join(dirname(entry), file);
}

const copies = [
  // The worker script tesseract.js spawns.
  [resolveIn('tesseract.js', 'dist/worker.min.js'), 'worker.min.js'],
  // The recognition core: Emscripten glue plus its WASM.
  [
    resolveIn('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'),
    'tesseract-core-simd-lstm.wasm.js',
  ],
  [
    resolveIn('tesseract.js-core', 'tesseract-core-simd-lstm.wasm'),
    'tesseract-core-simd-lstm.wasm',
  ],
  // Licence, because these are redistributed assets.
  [resolveIn('tesseract.js-core', 'LICENSE'), 'LICENSE-tesseract-core.txt'],
];

let total = 0;
for (const [from, name] of copies) {
  const to = join(outDir, name);
  await copyFile(from, to);
  const { size } = await stat(to);
  total += size;
  console.log(`  ${name} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

// The language model. Downloaded once and verified; skipped when a copy that
// matches the pin is already on disk, so this script stays fast and works
// offline afterwards.
const MODEL = 'eng.traineddata.gz';
const MODEL_URL =
  'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz';

/**
 * SHA-256 of the model, pinned.
 *
 * The file comes from a third party's GitHub Pages branch, fetched at build
 * time. Without a pin, anyone who could write to that branch would change what
 * every later build's recogniser reads, and nothing here would notice. The
 * hash is of the file at gh-pages commit f787a9c (2019-06-02), which is what
 * the URL still serves; it is checked on every download and on any copy
 * already on disk. To move to a newer model: download it, check it by hand,
 * and change this constant in the same commit.
 */
const MODEL_SHA256 = '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b';
const modelPath = join(outDir, MODEL);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

let model = null;
try {
  const existing = await readFile(modelPath);
  if (sha256(existing) === MODEL_SHA256) {
    model = existing;
  } else {
    console.warn(`  ${MODEL} on disk does not match the pinned hash; fetching it again`);
  }
} catch {
  // Not downloaded yet.
}

if (model) {
  console.log(`  ${MODEL} (already present, hash verified)`);
} else {
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(
      `Could not download the OCR language model (HTTP ${res.status}). ` +
        `Fetch it manually from ${MODEL_URL} into public/tesseract/ and check its SHA-256 ` +
        `against MODEL_SHA256 in scripts/sync-ocr.mjs.`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== MODEL_SHA256) {
    throw new Error(
      `The OCR language model served at ${MODEL_URL} does not match the pinned SHA-256.\n` +
        `  expected ${MODEL_SHA256}\n` +
        `  received ${actual}\n` +
        `Nothing was written. The upstream file has changed; if that is expected, verify ` +
        `the new file and update MODEL_SHA256 in scripts/sync-ocr.mjs in the same commit.`,
    );
  }
  await writeFile(modelPath, bytes);
  model = bytes;
  console.log(
    `  ${MODEL} (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB, downloaded and verified)`,
  );
}
total += model.byteLength;

await writeFile(
  join(outDir, 'assets.json'),
  JSON.stringify(
    {
      tesseractJs: JSON.parse(await readFile(join(tesseractDir, 'package.json'), 'utf8')).version,
      core: 'tesseract-core-simd-lstm',
      language: 'eng (tessdata_fast 4.0.0)',
      languageSha256: MODEL_SHA256,
      syncedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);

console.log(`OCR assets → public/tesseract/ (${(total / 1024 / 1024).toFixed(1)} MB total)`);
