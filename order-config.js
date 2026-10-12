// Staging preview only. This branch is not published to the live GitHub Pages storefront.
// The backend independently gates order submissions and checkout.
window.LIMITLESS_ORDER_CONFIG = Object.freeze({
  enabled: true,
  apiBase: 'https://limitless-expressions-api-staging.argon-ecomm.workers.dev',
  allowLiveCheckout: false
});
