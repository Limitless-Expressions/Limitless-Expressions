# Neon-only branch review

Branch: `feature/neon-name-sign-configurator`.

Base: fetched GitHub `origin/main` at `c49eb1f0e97ba11e2674b1115d639d7f66397a23` (Design dedicated NFC keytag product page, PR #5).

## Conflicting branch audit

A non-mutating merge simulation of `origin/main` and `origin/feature/nfc-keytag-product-page` reported a content conflict in `index.html`. Its only other changed file was `tests/workflow.test.js`.

The old feature branch contains nine commits not in main's ancestry:

- `99badd9` Reuse product detail layout for all eight active catalog products
- `5c0d6eb` Add Hype Chain product detail page with 4-inch $40 and 5-inch $50 prices
- `8717e1e` Hide duplicate NFC pricing field on dedicated product page
- `daf3bc7` Move customer contact section below NFC customization fields
- `45614ff` Remove accidental duplicate workflow script and stale markup tail
- `3a1620a` Restore valid NFC product quantity pricing expression
- `bf8395f` Fix malformed NFC quantity price script that prevented product rendering
- `d805cb9` Test product page route and retained storefront integrations without stale blob hash
- `aa7ba5d` Add responsive NFC product detail view with existing gallery and checkout

These are outside the neon task; none were cherry-picked. Some NFC work is already represented by main's squashed PR #5. The new branch starts at main and retains that published implementation, including the earlier automatic Stripe redirect work. The original local feature branch and its files are untouched.

## Changes

- `index.html`: load the configurator assets; add the neon-only channel field; render the neon font/mounting controls and initialize their previews. Existing gallery, navigation, pricing and product-page routing remain intact.
- `assets/neon-configurator.js` and `.css`: responsive channel examples, distinct font previews, live text, incompatible-font resets, missing-font messages, mounting presets and saved-field immutability.
- `assets/neon-fonts/`: nine actual font files with redistribution licenses. Hershey Script and EMS Allure remain visibly unavailable until exact assets and redistribution permission are provided.
- `backend/src/catalog.js`: allow the optional neon channel field alongside the existing font and mounting fields. No schema migration or saved-order rewrite.
- `tests/neon.test.js`: undo only the explicit neon HTML hooks and verify the entire remaining page against main's Git blob `c0c51741c604b42a06765ea3065f6101f66677e7`. This protects all unrelated products, pricing, galleries and published NFC page code.
- `tests/workflow.test.js`: add new/legacy neon order validation and persistence coverage; retain main's existing tests unchanged.
- `tests/neon.browser.cjs`: desktop/mobile controls, font-load failures, exact serialized submission values, saved font immutability and published NFC route/quantity-price checks. All API traffic is mocked; no live submissions or payments.

Checkout scripts/configuration, Stripe logic, pricing code, upload validation, database schema, saved-order retrieval and workflows are unchanged from main.

## Fonts and verification

Sacramento, Dancing Script (weight 700), Pacifico, Lobster, Courgette, Kaushan Script and Allura include SIL Open Font Licenses. Satisfy and Yellowtail include Apache 2.0 licenses. All assets came from the official Google Fonts repository. Retain their license files when publishing. Lettering previews are not manufacturing paths; the page explains that final channels may require production adjustments.

Run `npm test` for the 19 backend, order, checkout and preservation checks. Run `node tests/neon.browser.cjs` from the repository root for browser checks with Playwright and installed Edge; `PLAYWRIGHT_MODULE` can point to an installed Playwright module. Set `NEON_SCREENSHOT_DIR` to an output directory for optional screenshots. The site is static and has no build step; the browser test serves it over local HTTP.

No PR, merge or deployment is performed by this change. The existing workflow does not deploy this branch on push.
