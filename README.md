# Limitless Expressions

Existing static storefront plus a disabled-by-default order backend for Cloudflare Workers, D1, private R2, Stripe Payment Links and Resend.

All 11 products, current pricing, customization fields, galleries and saved image positioning are retained. The sole storefront change while the feature is disabled is loading two inert integration scripts.

Read [the setup and release instructions](docs/SETUP.md). Start with local tests (`npm test`, Node 24+) and isolated staging resources. No deployment automation is included. Never commit `.dev.vars`, `.env`, keys or customer data.
