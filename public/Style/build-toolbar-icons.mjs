/**
 * Smart3D map toolbar icons — full asset pipeline:
 * 1) Writes standalone SVGs to Buttons/v2/icons/ (complete files, one per tool).
 * 2) Regenerates Smart3d_Style.toolbar.css (embedded data URIs for reliable rendering).
 *
 * Source of truth: Buttons/v2/all_buttons.svg
 * Run: node public/Style/build-toolbar-icons.mjs
 * Or:  npm run build:toolbar-icons
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.join(__dirname, 'Buttons', 'v2', 'all_buttons.svg');
const iconsDir = path.join(__dirname, 'Buttons', 'v2', 'icons');
const outPath = path.join(__dirname, 'Smart3d_Style.toolbar.css');
const manifestPath = path.join(iconsDir, 'manifest.json');

const raw = fs.readFileSync(svgPath, 'utf8');
/** Brighter than legacy #d4e4f8 so glyphs stay readable on hover / pressed tint. */
const FILL_TOOLBAR = '#eef3fc';

/** Symbol id → kebab-case filename (no .svg) */
const symbolIdToFile = {
  white2: 'white-model',
  printScreen: 'print-screen',
  elevationProfile: 'elevation-profile',
  streetView: 'street-view',
  viewshed2: 'viewshed',
  remapColors: 'remap-colors',
  special_effects: 'special-effects',
  topView: 'top-view',
  gotoPrev: 'goto-prev',
  gotoNext: 'goto-next'
};

function fileNameForSymbol(id) {
  if (symbolIdToFile[id]) return symbolIdToFile[id];
  return id.replace(/_/g, '-').replace(/([A-Z])/g, '-$1').replace(/^-/, '').toLowerCase();
}

function extractSymbol(id) {
  const re = new RegExp(`<symbol id="${id}"[^>]*>([\\s\\S]*?)</symbol>`);
  const m = raw.match(re);
  if (!m) throw new Error('Missing <symbol id="' + id + '"> in all_buttons.svg');
  return m[1].trim();
}

/** CSS class → symbol id (same as previous map) */
const cssClassMap = [
  ['transparency', 'transparency'],
  ['fog', 'fog'],
  ['white', 'white2'],
  ['slope', 'slope'],
  ['height', 'height'],
  ['distance', 'distance'],
  ['direction', 'direction'],
  ['snow', 'snow'],
  ['clouds', 'clouds'],
  ['ortho', 'ortho'],
  ['remapColors', 'remapColors'],
  ['layersIC', 'layers'],
  ['home', 'home'],
  ['gotoPrev', 'gotoPrev'],
  ['gotoNext', 'gotoNext'],
  ['topview', 'topView'],
  ['share', 'share'],
  ['printscreen', 'printScreen'],
  ['measure', 'measure'],
  ['lineofsight', 'los'],
  ['viewshed', 'viewshed2'],
  ['elevationProfile', 'elevationProfile'],
  ['streetview', 'streetView'],
  ['flightmode', 'flight'],
  ['clipplane', 'cut'],
  ['split', 'split'],
  ['special_effects', 'special_effects']
];

function toDataUri(inner) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function innerForToolbar(innerRaw) {
  return innerRaw.replace(/currentColor/g, FILL_TOOLBAR);
}

function writeStandaloneSvg(symbolId, innerRaw) {
  const inner = innerRaw.replace(/currentColor/g, 'currentColor');
  const file = path.join(iconsDir, fileNameForSymbol(symbolId) + '.svg');
  const doc = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
${inner.replace(/^/gm, '  ')}
</svg>
`;
  fs.writeFileSync(file, doc, 'utf8');
  return fileNameForSymbol(symbolId) + '.svg';
}

// --- Export every <symbol> in the master sprite as a standalone file ---
const symbolIds = [...raw.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
fs.mkdirSync(iconsDir, { recursive: true });

const manifest = {
  version: 1,
  source: 'Buttons/v2/all_buttons.svg',
  generated: new Date().toISOString(),
  note: 'Standalone SVGs use fill currentColor on paths for theming. Toolbar CSS uses embedded copies with fixed fill.',
  icons: []
};

for (const id of symbolIds) {
  const inner = extractSymbol(id);
  const file = writeStandaloneSvg(id, inner);
  manifest.icons.push({
    symbolId: id,
    file,
    fileBase: fileNameForSymbol(id)
  });
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

// --- Toolbar CSS (data URIs) ---
let out = `/**
 * Map toolbar icons — embedded SVG data URIs (no external #fragment).
 * Toolbar tiles use fill ${FILL_TOOLBAR} for contrast on dark buttons.
 * Standalone sources: Buttons/v2/icons/*.svg — regenerate: node public/Style/build-toolbar-icons.mjs
 */

`;

for (const [cls, sym] of cssClassMap) {
  const inner = innerForToolbar(extractSymbol(sym));
  out += `.${cls} { background-image: ${toDataUri(inner)}; }\n`;
}

const northInner = innerForToolbar(extractSymbol('north'));
out += `
.north-arrow {
  background-image: ${toDataUri(northInner)};
  background-repeat: no-repeat;
  background-position: center;
  background-size: 18px 18px;
}
`;

fs.writeFileSync(outPath, out, 'utf8');

console.log('Icons:', manifest.icons.length, 'files →', iconsDir);
console.log('Manifest:', manifestPath);
console.log('CSS:', outPath, '(' + out.length + ' bytes)');
