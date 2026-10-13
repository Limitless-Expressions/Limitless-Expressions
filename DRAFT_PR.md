# Add disabled secure order workflow for single NFC keytag checkout

The existing prototype discards customization and artwork when adding to the test cart. This change adds a disabled-by-default order flow that persists immutable details and private artwork before payment, then matches the supplied single-$15-keytag Payment Link through server-verified Stripe events.

The storefront's original source is preserved except for two new script tags. All 11 products, prices, customization options, galleries and desktop/mobile image-position settings are checked against the GitHub baseline. Other products and quantities can be saved for order/quote follow-up, but cannot use the $15 link. Coming-soon products remain unavailable.

The Worker includes private administrator downloads, bounded uploads, strict origins, Turnstile verification, rate limits, webhook signature verification, authoritative Session/line-item reconciliation, duplicate-payment review and a durable Resend notification queue targeting argon.ecomm@gmail.com. Checkout gates default off and require reviewed shipping, tax, email and separate live approval. Test configuration uses placeholders and an isolated test link.

Validation: Node tests exercise actual SQLite through a D1 adapter with storage and provider fakes. External Cloudflare/Stripe/Resend setup and visual checkout testing remain pending; see docs/SETUP.md. No service deployment, live Stripe setting change or merge is included. Open this PR as a draft only.
