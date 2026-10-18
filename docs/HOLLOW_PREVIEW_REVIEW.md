# Hollow double-stroke lettering previews

Branch: `feature/hollow-double-stroke-previews`, based on `origin/main` at `2ce2d54` (the merged neon configurator).

## Rendering

The browser shapes complete words with the existing loaded font family and weight. Canvas rasterizes the filled glyph geometry at four times display resolution, including counters, kerning, and overlapping connections between cursive letters. A morphological boundary of that combined mask produces the visible contour. Solid stroke interiors and counter interiors are transparent. Subpixel sampling keeps outlines approximately half a CSS pixel wide at their narrowest; diagonal segments vary slightly with pixel orientation. This is a visual raster preview, not manufacturing geometry or a centerline path.

All eight double-stroke font cards and the selected live preview use this renderer. Their existing gold colors are retained; this version did not previously tie lettering color to the Neon Color selection. Single-stroke lettering continues to use the existing DOM text/font rendering. No font substitutions or additional dependencies were added.

Resize observation redraws the lettering at the available width. Long text wraps at words where possible, then grapheme boundaries, without squeezing or stretching glyphs. Unchanged previews are cached to avoid redrawing every font on selection. Canvases include an accessible image label and fallback text. Detached/hidden controls are skipped safely.

## Scope and tests

Changed production files are only `assets/neon-configurator.js` and `assets/neon-configurator.css`. Font assets, `index.html`, product catalog, mounting controls, pricing, checkout scripts/configuration, backend and saved orders are unchanged from main.

`node --test tests/*.test.js`: all 19 existing preservation, order and checkout tests pass.

`node tests/neon.browser.cjs`: all eight fonts with `ABOPR`, `Armanie`, and `Yalla` at 390px and 1280px widths (48 font/text/viewport combinations). Pixel checks compare the resulting canvases with their original filled glyph masks and confirm transparent stroke interiors, visible contours, and gold color. The existing live-text, font reset, saved-selection, missing-font, mounting and published NFC route checks still pass. Order endpoints are mocked; no live orders or payments are created. Optional screenshots use `NEON_SCREENSHOT_DIR` as documented in the original configurator review.

No PR, merge or deployment is performed automatically.
