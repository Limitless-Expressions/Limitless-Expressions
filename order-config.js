// Production storefront configuration. Backend independently validates payment readiness.
window.LIMITLESS_ORDER_CONFIG = Object.freeze({
  enabled: true,
  apiBase: 'https://limitless-expressions-api.argon-ecomm.workers.dev',
  allowLiveCheckout: true
});
