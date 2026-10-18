# Homepage product navigation

Branch: `fix/homepage-product-navigation`, based on latest main `5a50f9c`.

Current main already rendered dedicated-page anchors. Its unused document-level `button.customize` handlers still opened/reset the old modal, and two older standalone preparation copies outside this Git repository still generated modal buttons. Those copies match the reported behavior; production HTML could not be independently retrieved during this change, so a hosted reproduction is not claimed.

The tracked homepage now uses one native-link template for every active product, including NFC. The old popup-launch handler and its obsolete order-reset click handler are removed. The dedicated page initializer still opens the existing shared form normally. Native browser navigation preserves Back/Forward behavior, modifier-clicks and opening links in new tabs.

The repository contains one deployable storefront (`index.html`), not a second `stripe-order-workflow/index.html`. The two historical copies in the parent preparation workspace were also updated locally: their eight supported active products link to existing canonical dedicated pages at `https://limitlessexpressions3d.com/?product=...`, because those old packages do not contain the dedicated-page renderer. Their handlers are restricted to remaining legacy buttons. Old product data and unrelated/Coming Soon entries are not replaced. These preparation files are outside this branch and are not deployment inputs.

No dedicated-page layout, gallery, product fields, prices, Coming Soon state, styling, Stripe/API behavior, or saved-order logic is changed.

Validation:

- 20 automated order, checkout and preservation tests pass.
- Existing product-page browser tests pass at 390px touch/mobile and 1280px desktop, now clicking all eight homepage links and verifying Back/Forward plus catalog navigation for each product.
- All 48 neon font/text/viewport checks pass.
- Both historical local copies pass all eight link/Back cases at both viewport sizes (32 additional navigation cases). Canonical pages were intercepted and served from this checkout; order services were mocked. No live orders or payments were submitted.

No pull request, merge or deployment is created automatically.
