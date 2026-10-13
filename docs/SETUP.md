# Limitless Expressions order integration — setup and release gates

Status: implementation prepared for review. Nothing has been deployed or merged. The existing Stripe live link must not be edited without owner approval.

Brand: Limitless Expressions. Legal company: Armanie Distributions Inc. Notification recipient: **argon.ecomm@gmail.com** (fixed server-side).

## 1. Restore GitHub write access and create the draft PR

The connected GitHub integration returned `403 Resource not accessible by integration` when asked to create a branch. Repository metadata reported user write permission, but the integration itself cannot write Git refs. Reconnect or update the GitHub integration's installation permissions to allow repository Contents write and Pull requests write for `Limitless-Expressions/Limitless-Expressions`. Do not grant access to unrelated repositories. Alternatively, use your own authenticated GitHub checkout.

This local implementation is in a separate directory and branch named `codex/secure-stripe-order-workflow`. It is based on GitHub main commit `acec4633c2d4622212f520064155dada8408b9bb`, not the older Downloads prototype. This local directory contains source and tests, not a complete image checkout. Existing remote images are unchanged. Apply `review.patch` to a full checkout of the base commit, then push the new branch and open a **draft** PR into `main`. If main moved, rebase and verify the product/photo preservation test against the new baseline before proceeding. Do not merge.

## 2. Prepare isolated Cloudflare resources (owner action; no live deployment)

1. Confirm the current live storefront URL and hosting provider. Check whether branch previews automatically publish anywhere before enabling a preview.
2. Create a Cloudflare account or select the existing one. Install Node 24+ and the Cloudflare Wrangler CLI on your machine. This project has no runtime package dependencies; its tests use Node's built-in SQLite and test runner.
3. Create a staging D1 database named `orders` and an R2 bucket named `limitless-artwork-staging`. Keep R2 public access and `r2.dev` disabled. Do not use production buckets or databases for testing.
4. Replace `REPLACE_WITH_STAGING_D1_ID` in `backend/wrangler.toml` with the staging database ID. Resource IDs are configuration, not secrets.
5. Keep `ORDER_SUBMISSIONS_ENABLED`, `CHECKOUT_ENABLED`, and `LIVE_READINESS_APPROVED` false until each corresponding gate is ready. `workers_dev = false` prevents a default public Worker URL. A staging HTTPS hostname/route must be configured separately after staging deployment is approved.
6. Configure `STOREFRONT_ORIGIN` to the exact staging page origin, and `PUBLIC_API_ORIGIN` to the staging API origin. No trailing slash in the storefront origin. Requests from other origins are rejected. Production cross-origin browser requests require HTTPS.
7. Create a Cloudflare Turnstile widget for the staging hostname. Add its public site key to `TURNSTILE_SITE_KEY`; store its secret as `TURNSTILE_SECRET_KEY`. Challenge verification checks both hostname and action. The only challenge bypass is a test Worker reached through localhost without a configured secret.
8. Apply the migration locally first: `npm run db:local`. Applying it to remote staging requires approved staging account access. Production migrations require a separate approval.

## 3. Configure secrets privately

For local work, copy `backend/.env.example` to `backend/.dev.vars` and replace the placeholder values. The copy is ignored by Git. Never place real values in the example, source, screenshots, PR, or chat.

For the staging Worker, enter secrets through Cloudflare's secret settings or Wrangler's interactive prompts (`wrangler secret put NAME --config backend/wrangler.toml`). Required secret names:

- `STRIPE_SECRET_KEY`: staging Stripe test-mode secret key, with access to retrieve Payment Links, Checkout Sessions and line items. A standard `sk_test_` key is supported by this implementation. Live keys are rejected in test mode.
- `STRIPE_WEBHOOK_SECRET`: test endpoint signing secret. A local Stripe CLI listener has its own different signing secret.
- `RESEND_API_KEY`: transactional email API key.
- `ADMIN_TOKEN`: generate a random value with at least 32 bytes of entropy. It protects administrator order and artwork endpoints. Keep it in a password manager; never enter it in browser URLs or the storefront.
- `TURNSTILE_SECRET_KEY`: staging challenge verification secret.

## 4. Create a separate Stripe test link

1. Enter **Stripe test mode** (or an isolated sandbox). Do not change `https://buy.stripe.com/6oU8w0eQtaHl7io21r9EI00`.
2. Create a one-time USD price of **$15.00** for Custom 3D NFC Keychain / Keytag. This implementation treats $15 as the pre-tax product subtotal. Use exclusive tax behavior when charging tax. If $15 must include tax, stop: that needs a reviewed code/configuration change.
3. Create a test Payment Link with exactly that price and quantity **1**. Disable adjustable quantity, promotion codes, optional products and upsells. Do not add other products or bulk prices to this link.
4. Record the test link URL (`https://buy.stripe.com/test_...`), `plink_...` Payment Link ID and `price_...` Price ID in the corresponding Wrangler variables. IDs and URLs are public configuration; the API key is a secret.
5. Require shipping address collection. Confirm permitted countries, shipping rate, and whether shipping is free. Set `SHIPPING_COUNTRIES` to comma-separated country codes (for example `US`, only if the business confirms that destination). Set `SHIPPING_RATE_IDS` to the permitted shipping-rate IDs, or blank for free shipping without rates. Set `SHIPPING_AMOUNT_CENTS` to the fixed charge. This initial implementation supports one fixed shipping amount; variable country/rate charges and pickup need a separate implementation.
6. Set the test link's redirect URL to the staging storefront plus `?session_id={CHECKOUT_SESSION_ID}`. The page only reads the saved order's server status; a supplied Session ID never proves payment. Keep the same browser session to recover the saved order token. The original order remains in D1 even if that browser session is lost.
7. Set business display information and policies for Limitless Expressions / Armanie Distributions Inc. Review delivery times, custom-order cancellation/refunds, privacy and terms before live release.

## 5. Review sales tax with business information

1. Provide the legal business location and confirm where Armanie Distributions Inc. is registered or required to collect sales tax. A timezone or customer address is not evidence of a tax obligation.
2. Confirm the product's tax classification and shipping tax treatment with the business's tax adviser where necessary.
3. Configure Stripe Tax business information, product tax code and applicable registrations. Enable automatic tax on the test link. `TAX_MODE = "automatic"` requires a complete calculation before marking paid.
4. `TAX_MODE = "none"` is available only after an explicit business review determines no tax should be collected for the supported checkout. The link must then have automatic tax off and the verified Session must have zero tax. Never use this setting to bypass incomplete tax setup.
5. Once test shipping and tax match the approved policy, set `SHIPPING_REVIEWED` and `TAX_REVIEWED` true in staging only.

## 6. Configure and verify Resend

1. Create a Resend account and add a sending domain owned by the business, preferably a transactional subdomain.
2. Add the required DNS verification records and wait for verification. Gmail is the recipient, not the sender domain.
3. Set `RESEND_FROM` to an address on that verified domain and store the API key privately.
4. After verifying the service, set `EMAIL_VERIFIED` true in staging. Confirm both submitted and paid notifications actually arrive at **argon.ecomm@gmail.com**, including spam-folder checks.
5. The Worker cron retries pending notifications every five minutes and keeps failures visible through the authenticated `/api/admin/notifications` endpoint. Keep the cron enabled for approved environments. Provider acceptance is recorded separately from actual mailbox delivery; inspect Resend delivery/bounce logs.
6. Resend idempotency keys reduce retry duplicates, but provider idempotency has a retention window. A delivery whose acknowledgement is lost can be duplicated on a very late retry. Order payment and production matching remain idempotent in D1.

## 7. Register and test the Stripe webhook (staging approval required)

1. When a staging Worker deployment is explicitly approved, expose the isolated HTTPS endpoint `/api/stripe/webhook`. Do not deploy to the live storefront route.
2. Register a **snapshot** webhook for test-mode account events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Use API version `2025-03-31.basil`, matching the pinned retrieval version. Revisit and test version upgrades deliberately.
3. Store the endpoint's signing secret. Do not substitute the Stripe CLI's local secret for the deployed endpoint secret.
4. Enable staging order submissions. For a local frontend, serve the full GitHub checkout on `http://localhost:8080`; `npm run dev:backend` serves the API. Edit staging `order-config.js` to `enabled: true` and the staging API base. Leave `allowLiveCheckout: false`.
5. Once staging storage, webhook, email, shipping and tax are configured, enable staging `CHECKOUT_ENABLED`. The Worker also checks the actual Stripe link configuration before returning its URL.
6. Submit a single keytag with artwork and an http/https NFC link. Verify the D1 order and private R2 file exist **before** payment. Confirm the Stripe URL's `client_reference_id` matches the saved order. Do not put personal details or bearer tokens in that URL.
7. Use Stripe test cards only with the test link. Verify payment succeeds, the webhook arrives, exactly one order becomes paid, and its Stripe Session/PaymentIntent, total and shipping address are recorded.
8. Test failed/cancelled checkout, delayed-payment success/failure, webhook retries, invalid signatures, missing/altered references, unexpected quantity/price, missing shipping, incomplete tax, duplicate sessions and email failure/recovery. Verify bulk quantities and other products never receive this link.
9. Test all 11 products and photo galleries on desktop and mobile. Confirm their image positioning and existing prices are unchanged. Automated source preservation checks complement this visual review; no browser QA or external-service test is claimed before it is performed.

## 8. Administrator access and operational handling

Use an authenticated API client with `Authorization: Bearer <ADMIN_TOKEN>`, never a token-bearing URL:

- `GET /api/admin/orders/LE-<uuid>`: order, customization, verified payment information and artwork IDs.
- `GET /api/admin/artwork/<uuid>`: downloads the private original as an attachment, always `application/octet-stream` with `nosniff` and sandbox headers. Treat SVG/PDF originals as untrusted. There is no inline artwork preview or public bucket URL.
- `GET /api/admin/notifications`: delivery queue state and retry information.

Order recipients receive plain-text production details and private artwork IDs. This initial version uses administrator API access, not an admin browser dashboard. Customer read access exposes only reference, payment status and eligibility, protected by a random session-only bearer token. Saved customization is immutable; create a new submission to change it.

Payments with missing references, wrong amounts/configuration or extra sessions are retained in `payment_events` and queued for manual review. The system never automatically refunds or assigns those payments. Review them in Stripe and D1 before production. A valid payment received while checkout gates are disabled is also held for review. Resolving held orders, refunds/disputes, abandoned-order retention and lost browser access are operator responsibilities for V1; agree on and implement a retention procedure before production. Do not delete paid records without an accounting policy. R2 cleanup on failed submission is best effort; periodically audit orphan objects after storage outages.

## 9. Live release requires a new explicit approval

After test evidence is reviewed, request approval to configure production resources, the existing live payment link, and deployment. Keep test and live databases, buckets, keys, webhook secrets and domains separate. Live requires every review flag, `LIVE_READINESS_APPROVED = "true"`, live Stripe IDs/key, the exact supplied live link, and `allowLiveCheckout: true` in the reviewed frontend configuration. None of those changes are authorized by the current implementation request. Do not merge or deploy this branch now.

## Checks

Run `npm test` with Node 24+. Tests use real SQLite with a D1-compatible adapter, private-storage fakes and mocked Stripe/Resend responses. They verify persistence, atomic rollback, matching, delayed payment, signature tampering, protected downloads and notification retries. They do not certify Cloudflare bindings, Stripe account settings, sales-tax applicability or real email delivery. The preservation test compares the original inline storefront to its GitHub blob SHA; it will intentionally need review if the original storefront is edited.
