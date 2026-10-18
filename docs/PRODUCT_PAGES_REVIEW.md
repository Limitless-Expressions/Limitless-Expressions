# Complete product detail pages

Branch: `feature/complete-product-detail-pages`.

Base: latest fetched `origin/main` at `5dae07f` (merged hollow double-stroke previews). No old feature branch was merged or rewritten.

## Audit and recovered work

Main had one dedicated route, `?product=nfc-keytag`. Its seven other active products still opened the generic modal. The historical `feature/nfc-keytag-product-page` branch contained Hype Chain and eight-product layout work; `feature/all-product-detail-pages` contained a later generalization of the same NFC template. The latter's `initNfcProductPage` implementation was recovered and adapted in place rather than rebuilding the pages. Existing DOM IDs/classes are retained for compatibility.

| Product | Before | Current route |
| --- | --- | --- |
| Custom 3D Printed Hype Chain | Popup; historical page available | `?product=hype-chain` |
| Custom 3D NFC Keychain / Keytag | Dedicated page | `?product=nfc-keytag` |
| 3D Printed Google Review NFC Display | Popup | `?product=google-review-display` |
| Custom 3D Printed Name / Desk Plate | Popup | `?product=name-desk-plate` |
| Custom Name / Initial Sign | Popup; additional active product | `?product=name-initial-sign` |
| Custom 3D Printed Name Light Box | Popup | `?product=name-light-box` |
| Custom 3D Printed Neon Name Sign | Popup with complete configurator | `?product=neon-name-sign` |
| Custom Business Logo / Sign | Popup | `?product=business-logo-sign` |

3D Printed Dogs, Custom 3D Printed Parts, and Digital STL Files remain Coming Soon, without enabled product links or ordering. Invalid/unsupported product slugs return to the storefront view.

The separate `stripe-order-workflow` directory in the preparation workspace was inspected: it is an older disabled-by-default implementation package, not a directory in current main. It was not copied over the live repository. Current main's enabled configuration, saved-order workflow, automatic Stripe redirect, server-owned prices and security remain the authoritative implementation.

## Implementation and compatibility

Storefront customization links now navigate to query-string product URLs. The existing NFC layout receives each product's title, description, photos, price and existing form. Native browser navigation handles back/forward and refresh; there are no extensionless paths or server rewrite requirements on GitHub Pages. Breadcrumb and header links return to the catalog/homepage. Existing galleries, photo order and positioning logic are reused; single-photo products use the same gallery markup. Arrows remain accessible on touch devices alongside native horizontal swipe/scroll.

The existing form and checkout integration are moved into the shared dedicated layout. Contact fields remain below customization. All selections retain their existing field IDs and product names. Neon renderer/font assets are unchanged. Small scoped CSS additions prevent overflow and retain normal radio dimensions in the dedicated layout.

Added optional order fields: Google Review Notes, Desk plate mounting (Stand / Mounting holes / Stand and mounting holes), and Business Logo Material preference (Recommend a material / Acrylic / ACM UV Printed). Material choices come from the published 45-inch sign description and remain subject to quotation. Missing new optional fields remain absent during legacy submission validation, preserving older retry fingerprints. No database migration or saved-order rewrite is required.

Logo uploads are required for Hype Chain, NFC Keytag and Business Logo orders. Frontend validation preserves the current file limits and instructions; backend validation enforces the chain/business requirement alongside the existing NFC requirement. Desk-plate artwork remains optional.

Stripe endpoints, redirect validation, pricing logic, shipping eligibility, Turnstile integration and saved-order readers are retained. Quote-only selections have a Submit quote request label but use the existing order-save endpoint and server-controlled eligibility. UI labels cannot enable checkout.

## Pricing decisions

Main's published catalog and `backend/src/pricing.js` were preserved. The older all-product branch approved a $50 five-inch Hype Chain price; that change is not present on main and was deliberately excluded. Four-inch / quantity-one chains retain $40 checkout. Five-inch and other chain quantities request a quote. No chain options beyond the published catalog were invented.

NFC pricing remains $15 for one, $50 for five, and $7 each for ten or more. The existing server requires bulk-shipping review for ten or more, so those orders remain quote-only. Review display and desk plate retain $35 base prices; initial signs retain $25; light boxes retain $40 and their shipping-review requirement. Neon and business signs retain all current size prices, estimates and quote conditions.

## Validation

- `node --test tests/*.test.js`: 20 passing preservation, order, upload and Stripe tests.
- `node tests/product-pages.browser.cjs`: all eight active products at 390px touch/mobile and 1280px desktop (16 page cases), including reload/direct links, correct gallery filenames/order, arrows, required uploads, quantities, fields, material/mounting/LED choices, submitted selection equality, mocked Turnstile renewal, mocked eligible Stripe redirects, quote-only saves, homepage/Coming Soon states and back/forward/catalog navigation.
- `node tests/neon.browser.cjs`: all 48 hollow font/text/viewport cases plus existing single-stroke, saved-selection and NFC checks pass.
- Desktop/mobile screenshots for all eight products were generated and inspected locally. Set `PRODUCT_SCREENSHOT_DIR` when running the product browser test to regenerate them.

Browser tests mock the order API, Stripe and Turnstile: no customer orders, real payments or live service changes occur. The site is static and has no build script. Production Turnstile/Stripe and hosted GitHub Pages smoke checks remain release-time checks; no deployment is performed here.

Protected snapshots assert current catalog content/prices/photos/Coming Soon states, homepage markup, merged neon assets, enabled checkout configuration and server pricing/Stripe implementations. Existing tests were updated only where the prior whole-page neon fixture could not accommodate the explicitly requested page routing and additive options.

The branch is committed locally for review. It is not pushed, published, merged or deployed.
