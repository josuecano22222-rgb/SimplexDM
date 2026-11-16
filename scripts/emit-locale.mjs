#!/usr/bin/env node
/**
 * SimplexDM i18n Locale Emitter (`scripts/emit-locale.mjs`)
 *
 * Deep-merges `scripts/locale-en-part{1,2,3}.mjs` and `scripts/locale-ar-part{1,2,3}.mjs`,
 * enforces 100% structural key parity between English and Arabic, and writes:
 *   - `public/js/core/appI18n.locale-en.js` (`window.__SIMPLEX_LOCALE_EN`)
 *   - `public/js/core/appI18n.locale-ar.js` (`window.__SIMPLEX_LOCALE_AR`)
 *
 * Flags:
 *   --check   Verify parity and confirm generated files are up to date without writing.
 *   --quiet   Suppress summary log output.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import enPart1 from './locale-en-part1.mjs';
import enPart2 from './locale-en-part2.mjs';
import enPart3 from './locale-en-part3.mjs';
import arPart1 from './locale-ar-part1.mjs';
import arPart2 from './locale-ar-part2.mjs';
import arPart3 from './locale-ar-part3.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge(...sources) {
  const target = {};
  for (const src of sources) {
    if (!isPlainObject(src)) continue;
    for (const [key, val] of Object.entries(src)) {
      if (isPlainObject(val) && isPlainObject(target[key])) {
        target[key] = deepMerge(target[key], val);
      } else if (isPlainObject(val)) {
        target[key] = deepMerge(val);
      } else {
        target[key] = val;
      }
    }
  }
  return target;
}

export function flattenKeys(obj, prefix = '', out = {}) {
  for (const [key, val] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val)) {
      flattenKeys(val, full, out);
    } else {
      out[full] = val;
    }
  }
  return out;
}

export function buildLocales() {
  const en = deepMerge(enPart1, enPart2, enPart3);
  const ar = deepMerge(arPart1, arPart2, arPart3);

  const flatEn = flattenKeys(en);
  const flatAr = flattenKeys(ar);
  const enKeys = Object.keys(flatEn);
  const arKeys = Object.keys(flatAr);

  const missingInAr = enKeys.filter((k) => !(k in flatAr));
  const missingInEn = arKeys.filter((k) => !(k in flatEn));
  const emptyValues = [
    ...enKeys.filter((k) => typeof flatEn[k] !== 'string' || flatEn[k].length === 0).map((k) => `en:${k}`),
    ...arKeys.filter((k) => typeof flatAr[k] !== 'string' || flatAr[k].length === 0).map((k) => `ar:${k}`),
  ];

  return {
    en,
    ar,
    keyCount: enKeys.length,
    missingInAr,
    missingInEn,
    emptyValues,
  };
}

export function renderLocaleScript(globalName, localeObj) {
  return `${globalName} = ${JSON.stringify(localeObj, null, 2)};\n`;
}

export function emitLocales(options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const checkOnly = Boolean(options.check);
  const quiet = Boolean(options.quiet);

  const built = buildLocales();
  if (built.missingInAr.length || built.missingInEn.length || built.emptyValues.length) {
    const details = [];
    if (built.missingInAr.length) details.push(`Missing in AR (${built.missingInAr.length}): ${built.missingInAr.slice(0, 10).join(', ')}`);
    if (built.missingInEn.length) details.push(`Missing in EN (${built.missingInEn.length}): ${built.missingInEn.slice(0, 10).join(', ')}`);
    if (built.emptyValues.length) details.push(`Empty/non-string (${built.emptyValues.length}): ${built.emptyValues.slice(0, 10).join(', ')}`);
    throw new Error(`Locale parity check failed:\n  ${details.join('\n  ')}`);
  }

  const enPath = path.join(rootDir, 'public', 'js', 'core', 'appI18n.locale-en.js');
  const arPath = path.join(rootDir, 'public', 'js', 'core', 'appI18n.locale-ar.js');
  const enContent = renderLocaleScript('window.__SIMPLEX_LOCALE_EN', built.en);
  const arContent = renderLocaleScript('window.__SIMPLEX_LOCALE_AR', built.ar);

  if (checkOnly) {
    const curEn = fs.existsSync(enPath) ? fs.readFileSync(enPath, 'utf8').replace(/\r\n/g, '\n') : '';
    const curAr = fs.existsSync(arPath) ? fs.readFileSync(arPath, 'utf8').replace(/\r\n/g, '\n') : '';
    if (curEn !== enContent || curAr !== arContent) {
      throw new Error('Emitted locale files are out of sync with scripts/locale-*-part*.mjs. Run `node scripts/emit-locale.mjs`.');
    }
    if (!quiet) {
      console.log(`[emit-locale] Verified ${built.keyCount} keys (100% EN/AR parity).`);
    }
    return { ...built, enPath, arPath };
  }

  fs.mkdirSync(path.dirname(enPath), { recursive: true });
  fs.writeFileSync(enPath, enContent, 'utf8');
  fs.writeFileSync(arPath, arContent, 'utf8');

  if (!quiet) {
    console.log(`[emit-locale] Wrote ${built.keyCount} keys to appI18n.locale-en.js and appI18n.locale-ar.js (100% EN/AR parity).`);
  }
  return { ...built, enPath, arPath };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const args = new Set(process.argv.slice(2));
  try {
    emitLocales({ check: args.has('--check'), quiet: args.has('--quiet') });
  } catch (err) {
    console.error(`[emit-locale] ${err.message}`);
    process.exit(1);
  }
}
