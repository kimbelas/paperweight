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
 * once and then lives in the repo's gitignored `public/`.
 *
 * Run with `node scripts/sync-ocr.mjs`.
 */
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
  [resolveIn('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [resolveIn('tesseract.js-core', 'tesseract-core-simd-lstm.wasm'), 'tesseract-core-simd-lstm.wasm'],
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

// The language model. Downloaded once; skipped when already present, so this
// script stays fast and works offline afterwards.
const MODEL = 'eng.traineddata.gz';
const MODEL_URL =
  'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz';
const modelPath = join(outDir, MODEL);

let haveModel = false;
try {
  const { size } = await stat(modelPath);
  haveModel = size > 500_000;
} catch {
  haveModel = false;
}

if (haveModel) {
  console.log(`  ${MODEL} (already present)`);
} else {
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(
      `Could not download the OCR language model (HTTP ${res.status}). ` +
        `Fetch it manually from ${MODEL_URL} into public/tesseract/.`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeFile(modelPath, bytes);
  total += bytes.byteLength;
  console.log(`  ${MODEL} (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB, downloaded)`);
}

const { size: modelSize } = await stat(modelPath);
await writeFile(
  join(outDir, 'assets.json'),
  JSON.stringify(
    {
      tesseractJs: JSON.parse(
        await readFile(join(tesseractDir, 'package.json'), 'utf8'),
      ).version,
      core: 'tesseract-core-simd-lstm',
      language: 'eng (tessdata_fast 4.0.0)',
      syncedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `OCR assets → public/tesseract/ (${((total + (haveModel ? modelSize : 0)) / 1024 / 1024).toFixed(1)} MB total)`,
);
