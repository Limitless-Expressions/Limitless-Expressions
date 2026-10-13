// Staging preview only. This branch is not published to the live GitHub Pages storefront.
// The backend independently gates order submissions and checkout.
window.LIMITLESS_ORDER_CONFIG = Object.freeze({
  enabled: false,
  apiBase: 'https://limitless-expressions-api.argon-ecomm.workers.dev',
  allowLiveCheckout: false
});
