(() => {
  'use strict';
  const config = window.LIMITLESS_ORDER_CONFIG;
  if (!config?.enabled || !config.apiBase) return; // Existing storefront remains identical by default.
  let base;
  try {
    base = new URL(config.apiBase);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname)))) throw Error();
  } catch { return; }
  const form = document.getElementById('form'), button = document.getElementById('addCart');
  const panel = document.createElement('div');
  panel.innerHTML = '<div class="formgrid"><div class="field"><label for="orderName">Your name</label><input id="orderName" autocomplete="name" maxlength="120"></div><div class="field"><label for="orderEmail">Email address</label><input id="orderEmail" type="email" autocomplete="email" maxlength="254"></div></div><div id="orderChallenge"></div><p id="orderStatus" role="status" aria-live="polite"></p><button id="orderPay" class="primary" type="button" hidden>Continue to secure payment</button><button id="orderRefresh" class="secondary" type="button" hidden>Check payment status</button>';
  document.getElementById('summary').after(panel);
  const status = panel.querySelector('#orderStatus'), pay = panel.querySelector('#orderPay'), refresh = panel.querySelector('#orderRefresh');
  button.textContent = 'Continue to secure payment';
  button.disabled = true;
  document.querySelector('#modal .note').textContent = 'Your order details and artwork are saved securely before payment. Submission alone does not confirm payment.';
  let backend = null, saved = null, busy = false, token = null, challenge = null, widget = null, fingerprint = null, selected = null;
  const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2,'0')).join('');
  const message = text => { status.textContent = text; };
  async function api(path, options = {}) {
    const response = await fetch(new URL(path, base), {...options, cache:'no-store'});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Order service unavailable.');
    return result;
  }
  function remember() {
    // Session-only bearer access; no customer details, artwork or credentials are put in URLs.
    try { sessionStorage.setItem('limitless-last-order', JSON.stringify(saved)); } catch { /* Current tab still works. */ }
  }
  async function checkStatus() {
    if (!saved) return;
    try {
      const current = await api(`/api/orders/${saved.id}`, {headers:{Authorization:`Bearer ${saved.token}`}});
      message(current.paymentVerified ? `Payment verified for ${current.id}. Your order is saved.` : current.status === 'review_required' ? `Order ${current.id} needs payment review. Please contact Limitless Expressions.` : `Order ${current.id} is saved. Payment is not yet verified.`);
      refresh.hidden = false;
      pay.hidden = !current.checkoutEligible || !backend?.checkoutEnabled || current.paymentVerified || current.status === 'review_required' || (['live','production'].includes(backend.environment) && !config.allowLiveCheckout);
      return current;
    } catch (error) { message(error.message); return null; }
  }
  function reset(product) {
    selected = product; token = randomToken(); saved = null; fingerprint = null;
    pay.hidden = true; refresh.hidden = true; challenge = null;
    if (widget !== null && window.turnstile) window.turnstile.reset(widget);
    message(backend?.submissionsEnabled ? 'Submit your details to receive an order reference.' : 'Order submissions are not enabled yet.');
    button.disabled = !backend?.submissionsEnabled;
    panel.querySelectorAll('input').forEach(input => { input.disabled = false; });
  }
  document.addEventListener('click', event => {
    if (event.target.matches('.customize')) reset(products[Number(event.target.dataset.i)]);
  });
  button.onclick = async () => {
    if (busy || !active || !backend?.submissionsEnabled) return;
    if (saved) { await checkStatus(); return; }
    busy = true; button.disabled = true; pay.hidden = true;
    const productButtons = [...document.querySelectorAll('.customize')].filter(control => !control.disabled);
    productButtons.forEach(control => { control.disabled = true; });
    try {
      const name = panel.querySelector('#orderName'), email = panel.querySelector('#orderEmail');
      if (!name.value.trim() || !email.value || !email.checkValidity()) throw Error('Enter your name and a valid email address.');
      const customization = {}, files = [];
      for (const field of active.fields) {
        if (field === 'Quantity') continue;
        const input = document.getElementById('f_' + field.replace(/\W+/g,'_'));
        if (/upload/i.test(field)) { if (input?.files) files.push(...input.files); }
        else customization[field] = input?.value || '';
      }
      const quantity = Number(document.getElementById('f_Quantity')?.value);
      if (!Number.isInteger(quantity) || quantity < 1) throw Error('Choose a whole number quantity.');
      if (files.length > 3 || files.some(file => !file.size || file.size > 5 * 1024 * 1024)) throw Error('Upload at most three files, each up to 5 MB.');
      const details = {product:active.name, quantity, customerName:name.value, customerEmail:email.value, customization};
      // Retain the token for identical retries; changed content becomes a new immutable order.
      const nextFingerprint = JSON.stringify({details, files:files.map(f => [f.name,f.size,f.lastModified])});
      if (fingerprint && fingerprint !== nextFingerprint) token = randomToken();
      fingerprint = nextFingerprint;
      const submissionToken = token;
      const data = new FormData();
      data.set('details', JSON.stringify({...details, accessToken:submissionToken, turnstileToken:challenge}));
      files.forEach(file => data.append('artwork', file));
      message('Saving your order details and artwork…');
      const result = await api('/api/orders', {method:'POST', body:data});
      saved = {id:result.id,token:submissionToken}; remember();
      form.querySelectorAll('input, select, textarea').forEach(input => { input.disabled = true; });
      panel.querySelectorAll('input').forEach(input => { input.disabled = true; });
      button.textContent = 'Order details saved';
      const current = await checkStatus();
      // Automatically open Stripe only for orders the server confirms are eligible.
      if (current?.checkoutEligible && backend?.checkoutEnabled && !current.paymentVerified && current.status !== 'review_required' &&
          (!['live','production'].includes(backend.environment) || config.allowLiveCheckout)) {
        await startCheckout();
      }
    } catch (error) {
      message(error.message);
      if (widget !== null && window.turnstile) window.turnstile.reset(widget);
      challenge = null;
    } finally { busy = false; button.disabled = !!saved || !backend?.submissionsEnabled; productButtons.forEach(control => { control.disabled = false; }); }
  };
  async function startCheckout() {
    if (!saved) return;
    pay.disabled = true;
    try {
      const result = await api(`/api/orders/${saved.id}/checkout`, {method:'POST',headers:{Authorization:`Bearer ${saved.token}`}});
      const destination = new URL(result.url);
      if (!['https://buy.stripe.com','https://checkout.stripe.com'].includes(destination.origin) ||
          (destination.origin === 'https://buy.stripe.com' && destination.searchParams.get('client_reference_id') !== saved.id) ||
          (['live','production'].includes(backend.environment) && !config.allowLiveCheckout)) throw Error('Checkout is disabled.');
      remember(); window.location.assign(destination.href);
    } catch (error) { message(error.message); }
    finally { pay.disabled = false; }
  }
  pay.onclick = async () => {
    if (busy) return;
    busy = true;
    try { await startCheckout(); }
    finally { busy = false; }
  };
  refresh.onclick = checkStatus;
  document.getElementById('cartBtn').textContent = 'Check saved order';
  document.getElementById('cartBtn').onclick = () => {
    try { saved = JSON.parse(sessionStorage.getItem('limitless-last-order')); } catch { saved = null; }
    document.getElementById('modal').classList.add('open');
    if (saved) checkStatus(); else message('No saved order in this browser session. Customize a product to begin.');
  };
  api('/api/config').then(result => {
    backend = result;
    if (result.turnstileSiteKey) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload = () => {
        widget = window.turnstile.render(panel.querySelector('#orderChallenge'), {sitekey:result.turnstileSiteKey,action:'order',
          callback:value => { challenge = value; }, 'expired-callback':() => { challenge = null; }});
      };
      script.onerror = () => message('Order verification could not load. Please retry.');
      document.head.appendChild(script);
    }
    if (active) reset(active);
    if (new URLSearchParams(location.search).has('session_id')) {
      // The redirect is only a prompt to read server state; it is never proof of payment.
      try { saved = JSON.parse(sessionStorage.getItem('limitless-last-order')); } catch { saved = null; }
      document.getElementById('modal').classList.add('open');
      if (saved) checkStatus(); else message('Check your saved order or contact us for verified payment status.');
    }
  }).catch(() => message('Order service is not configured yet. Checkout is disabled.'));
  new MutationObserver(() => { if (active !== selected && document.getElementById('modal').classList.contains('open')) reset(active); button.textContent = saved ? 'Order details saved' : 'Continue to secure payment'; })
    .observe(form, {childList:true});
})();
