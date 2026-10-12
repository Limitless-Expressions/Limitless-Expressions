// Public settings only. Leave disabled until the isolated backend is configured and tested.
// No URL parameter or browser storage can enable this feature.
window.LIMITLESS_ORDER_CONFIG = Object.freeze({
  enabled: false,
  apiBase: '', // e.g. https://orders-staging.your-domain.example
  allowLiveCheckout: false
});
