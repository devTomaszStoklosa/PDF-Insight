import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Copies the predefined Adobe CMaps from pdfjs-dist into public/, which Vite serves under the
// base path (/PDF-Insight/pdfjs/cmaps/ on GitHub Pages). pdf.js needs them to turn text set in
// CID-keyed fonts without a ToUnicode map, common in CJK documents, into Unicode.
//
// Runs before `npm run dev` and `npm run build`; starting Vite another way skips it. The copy
// is not tracked by git, so it always matches the installed pdf.js. The target must match
// CMAP_PATH in src/lib/pdfExtractor.ts.

const source = fileURLToPath(new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url));
const target = fileURLToPath(new URL('../public/pdfjs/cmaps/', import.meta.url));

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.info(`Copied the pdf.js CMaps to ${target}`);
