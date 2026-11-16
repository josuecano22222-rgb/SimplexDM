# Font Awesome Local Installation

This directory contains Font Awesome 6.4.0 files downloaded locally for offline use.

## Directory Structure

```
lib/fontawesome/
├── css/
│   └── all.min.css          # Main Font Awesome stylesheet
└── webfonts/
    ├── fa-solid-900.woff2   # Solid icons font (WOFF2)
    ├── fa-solid-900.ttf     # Solid icons font (TTF fallback)
    ├── fa-regular-400.woff2 # Regular icons font (WOFF2)
    ├── fa-regular-400.ttf   # Regular icons font (TTF fallback)
    ├── fa-brands-400.woff2  # Brand icons font (WOFF2)
    └── fa-brands-400.ttf    # Brand icons font (TTF fallback)
```

## Usage

The Font Awesome CSS is included in `index.html` with:
```html
<link rel="stylesheet" href="lib/fontawesome/css/all.min.css">
```

## Font Paths

The CSS file uses relative paths (`../webfonts/`) which correctly resolve to the `webfonts` directory when loaded from the `css` directory.

## Files Downloaded

- **CSS**: `all.min.css` - Complete Font Awesome stylesheet
- **Fonts**: All required font files in WOFF2 (modern) and TTF (fallback) formats

## Benefits of Local Installation

1. ✅ Works offline - no internet connection required
2. ✅ Faster loading - no CDN latency
3. ✅ No CSP issues - no external domain restrictions
4. ✅ Version control - exact version is locked
5. ✅ Privacy - no external requests

## Updating Font Awesome

To update to a newer version:

1. Download the new CSS file from: `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/VERSION/css/all.min.css`
2. Download the new font files from: `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/VERSION/webfonts/`
3. Replace the files in this directory
4. Update the version number in this README

## License

Font Awesome Free is free, open source, and GPL friendly. You can use it for commercial projects, open source projects, or really almost whatever you want.

- Icons: CC BY 4.0 License (https://creativecommons.org/licenses/by/4.0/)
- Fonts: SIL OFL 1.1 License (https://scripts.sil.org/OFL)
- Code: MIT License (https://opensource.org/licenses/MIT)
