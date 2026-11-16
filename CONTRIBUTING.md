# Contributing to SimplexDM (Meridian)

Thank you for your interest in contributing to **SimplexDM v2.0.0** (branded in-app as **Meridian**). This guide covers environment setup, architecture conventions, localization, testing, security requirements, and pull request workflow.

## Development Prerequisites

- **Node.js** `>= 16.0.0` (Node 20 LTS or 22 LTS recommended)
- **npm** `>= 7.0.0`
- **Python** `>= 3.8` (optional — for offline OSM tile caching and custom SQLite label pack generation)
- **Git**

## Quick Setup

```bash
git clone https://github.com/josuecano22222-rgb/SimplexDM.git
cd SimplexDM
npm install
npm run setup        # Optional: copy CesiumJS static assets to public/lib/cesium
npm run electron:dev # Desktop Electron workstation
# or:
npm start            # Standalone HTTP server (http://localhost:8000, auto-finds open port)
```

> **Note:** When `public/lib/cesium/` has not been copied, `server/server.js` automatically serves CesiumJS directly from `node_modules/cesium/Build/Cesium/` for fast development checkouts. Run `npm run setup` before packaging production desktop installers.

## Architecture Conventions

1. **Process boundary & security**
   - Renderer code runs with `contextIsolation: true`, `nodeIntegration: false`, and strict Content Security Policy.
   - All privileged desktop operations live in `electron-main.js` and `main/gis/`, exposed exclusively via typed channel wrappers in `preload.js`.
   - Keep `public/js/core/webGisBridge.js` and `server/gisApiRoutes.js` in parity with `preload.js` so standalone browser mode behaves identically to Electron.
   - Escape all untrusted or external strings before inserting into `innerHTML`.
   - Never hardcode API keys, access tokens, or external telemetry endpoints.

2. **Modularity & runtime gating**
   - Place renderer modules in the appropriate directory under `public/js/{core,features,gis,navigation,ui,utils}/`.
   - Respect `data/config/app-config.json` feature gates and `jsonConfigUpdated` events (see `public/js/core/jsonConfigManager.js` and `public/js/core/moduleRuntimeGate.js`).
   - When adding a new first-party renderer script, include it in `public/index.html` and register it in `public/js/core/projectIntegrationIndex.js` so Webpack bundles it in exact execution order.

3. **Internationalization (EN / AR RTL)**
   - Add UI strings to `scripts/locale-en-part{1,2,3}.mjs` and `scripts/locale-ar-part{1,2,3}.mjs` with 1:1 key parity.
   - Regenerate and validate compiled locale bundles:
     ```bash
     npm run i18n:emit
     npm run i18n:check
     ```
   - Use logical CSS properties (`inset-inline-start`, `margin-inline-start`, `text-align: start`) so RTL layouts mirror cleanly.

4. **Accessibility & motion**
   - Every icon-only control must carry an `aria-label` (or `data-i18n-aria`) and `title`.
   - Dialogs must declare `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and close on `Escape`.
   - Maintain WCAG AA contrast and honor `@media (prefers-reduced-motion: reduce)`.

5. **CommonJS / ESM compatibility in Electron main**
   - Main-process and server modules must load cleanly under Node's CommonJS loader (`node --no-experimental-require-module`). Lazy-load pure-ESM packages via dynamic `import()` when required.

## Quality Checks Before Opening a Pull Request

Run the complete verification suite locally:

```bash
npm test                # Jest unit & integration tests
npm run i18n:check      # 100% EN/AR locale parity check
npm run webpack         # Production renderer bundle into public-bundled/
```

If you modify native SQLite or offline data pipelines, also verify:

```bash
npm run seed:labels     # Regenerate data/labels-world-base.db & sample .rlp
npm run seed:samples    # Regenerate data/samples/meridian-campus/ 3D Tiles 1.1 showcase
```

## Pull Request Process

1. Create a focused feature or fix branch from `main`.
2. Write clear, descriptive commit messages explaining *why* as well as *what*.
3. Add or update unit/integration tests under `tests/` covering new behavior or bug fixes.
4. Keep generated build outputs (`dist/`, `public-bundled/`, `public/lib/cesium/`, large user datasets) out of commits in accordance with `.gitignore`.
5. Open a Pull Request summarizing the change, design decisions, and exact verification commands executed.

## License

By contributing to SimplexDM, you agree that your contributions will be licensed under the [MIT License](LICENSE).
