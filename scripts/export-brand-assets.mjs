#!/usr/bin/env node
/**
 * Regenerates all Meridian / SimplexDM raster brand assets from the canonical
 * vector mark (`build/meridian-icon.svg`) and refreshes `public/assets/meridian-icon.svg`.
 *
 * Outputs:
 *   - build/icons/icon-{16,32,48,64,128,256,512,1024,2048,4096}.png
 *   - build/icon.png   (high-res Electron window & Linux icon)
 *   - build/icon.ico   (multi-size Windows installer & shortcut icon)
 *   - build/icon.icns  (macOS app bundle & DMG icon)
 *   - public/assets/meridian-icon.svg (renderer favicon & static icon)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SRC_SVG = path.join(ROOT_DIR, 'build', 'meridian-icon.svg');
const PUBLIC_SVG = path.join(ROOT_DIR, 'public', 'assets', 'meridian-icon.svg');
const ICONS_DIR = path.join(ROOT_DIR, 'build', 'icons');
const OUT_PNG = path.join(ROOT_DIR, 'build', 'icon.png');
const OUT_ICO = path.join(ROOT_DIR, 'build', 'icon.ico');
const OUT_ICNS = path.join(ROOT_DIR, 'build', 'icon.icns');

const EXPORT_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024, 2048, 4096];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function resolvePngToIco() {
    const mod = await import('png-to-ico');
    return mod.default || mod.imagesToIco || mod;
}

export async function exportBrandAssets({ sizes = EXPORT_SIZES, quiet = false } = {}) {
    if (!fs.existsSync(SRC_SVG)) {
        throw new Error(`Canonical brand SVG not found: ${SRC_SVG}`);
    }

    const { Resvg } = require('@resvg/resvg-js');
    const png2icons = require('png2icons');
    const pngToIco = await resolvePngToIco();

    fs.mkdirSync(ICONS_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(PUBLIC_SVG), { recursive: true });

    // 1. Copy canonical SVG to public/assets/meridian-icon.svg
    const svgBuffer = fs.readFileSync(SRC_SVG);
    fs.writeFileSync(PUBLIC_SVG, svgBuffer);

    // 2. Rasterize each target size
    const buffers = new Map();
    for (const size of sizes) {
        const resvg = new Resvg(svgBuffer, {
            fitTo: { mode: 'width', value: size },
        });
        const pngData = resvg.render().asPng();
        const buf = Buffer.from(pngData);
        buffers.set(size, buf);
        fs.writeFileSync(path.join(ICONS_DIR, `icon-${size}.png`), buf);
    }

    // 3. Write primary build/icon.png (prefer 1024 or largest generated size)
    const maxSize = Math.max(...sizes);
    const primaryPng = buffers.get(4096) || buffers.get(1024) || buffers.get(512) || buffers.get(maxSize);
    fs.writeFileSync(OUT_PNG, primaryPng);

    // 4. Build multi-resolution Windows ICO
    const icoInputs = ICO_SIZES.map((s) => buffers.get(s)).filter(Boolean);
    if (icoInputs.length > 0) {
        const icoBuf = await pngToIco(icoInputs);
        fs.writeFileSync(OUT_ICO, icoBuf);
    }

    // 5. Build macOS ICNS from 1024px (or 512px fallback) PNG
    const icnsSource = buffers.get(1024) || buffers.get(512) || primaryPng;
    const icnsBuf = png2icons.createICNS(icnsSource, png2icons.BILINEAR, 0);
    if (!icnsBuf || icnsBuf.length === 0) {
        throw new Error('png2icons failed to produce build/icon.icns');
    }
    fs.writeFileSync(OUT_ICNS, icnsBuf);

    if (!quiet) {
        console.log(
            `✓ Brand assets exported (${sizes.length} PNGs, icon.png, icon.ico, icon.icns, public/assets/meridian-icon.svg)`
        );
    }

    return {
        svgPath: PUBLIC_SVG,
        pngPath: OUT_PNG,
        icoPath: OUT_ICO,
        icnsPath: OUT_ICNS,
        sizes,
    };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
    exportBrandAssets().catch((err) => {
        console.error('✗ Brand asset export failed:', err.message);
        process.exit(1);
    });
}
