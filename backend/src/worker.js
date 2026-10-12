import {HttpError, digest, equalSecrets, readLimited, verifyStripeSignature, configured, json} from './security.js';
import {validateDetails, validateArtwork, MAX_REQUEST} from './orders.js';
import {readiness, stripeGet, assertLink, assertShippingRate, paymentMismatch} from './stripe.js';
import {notificationStatement, flushNotifications} from './notifications.js';

const PAYMENT_EVENTS = new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed']);
const statements = (env, event, outcome, now) => env.DB.prepare('INSERT OR IGNORE INTO payment_events (id, session_id, order_reference, outcome, created_at) VALUES (?, ?, ?, ?, ?)')
  .bind(event.id, event.data.object.id, event.data.object.client_reference_id || null, outcome, now);

async function limitSubmissions(request, env) {
  const now = Date.now(), window = Math.floor(now / 3600000);
  const key = await digest(`orders:${request.headers.get('CF-Connecting-IP') || 'local'}:${window}`);
  const row = await env.DB.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(key, now + 7200000).first();
  if (row.count > 20) throw new HttpError(429, 'Too many submissions. Please try again later.');
}
async function verifyHuman(request, env, token) {
  const local = ['localhost','127.0.0.1'].includes(new URL(request.url).hostname);
  if (env.ENVIRONMENT === 'test' && local && !configured(env.TURNSTILE_SECRET_KEY)) return;
  if (!configured(env.TURNSTILE_SECRET_KEY) || !token) throw new HttpError(503, 'Order protection is not configured.');
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY, response:token, remoteip:request.headers.get('CF-Connecting-IP') || undefined}),
    signal:AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || !result.success || result.hostname !== new URL(env.STOREFRONT_ORIGIN).hostname || result.action !== 'order')
    throw new HttpError(400, 'Please complete the order verification again.');
}
async function createOrder(request, env) {
  if (env.ORDER_SUBMISSIONS_ENABLED !== 'true') throw new HttpError(503, 'Order submissions are not enabled yet.');
  await limitSubmissions(request, env);
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new HttpError(400, 'Use multipart order submission.');
  const body = await readLimited(request, MAX_REQUEST);
  let form, details;
  try {
    form = await new Response(body, {headers:{'Content-Type':request.headers.get('content-type')}}).formData();
    const text = form.get('details');
    if (typeof text !== 'string' || text.length > 60000) throw Error();
    details = JSON.parse(text);
  } catch { throw new HttpError(400, 'Invalid order submission.'); }
  const order = validateDetails(details);
  if ([...form.keys()].some(k => !['details','artwork'].includes(k))) throw new HttpError(400, 'Unexpected form field.');
  const rawFiles = form.getAll('artwork');
  if (rawFiles.length > 3) throw new HttpError(400, 'Upload at most three artwork files.');
  const files = await Promise.all(rawFiles.map(validateArtwork));
  if (order.product === 'Custom 3D NFC Keychain / Keytag' && !files.length) throw new HttpError(400, 'Upload your keytag artwork.');
  const accessHash = await digest(details.accessToken);
  const requestHash = await digest(JSON.stringify({order, files:files.map(f => ({filename:f.filename, hash:f.hash}))}));
  const existing = await env.DB.prepare('SELECT id, request_hash, status FROM orders WHERE access_hash = ?').bind(accessHash).first();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new HttpError(409, 'This order is already saved. Start a new order to change its details.');
    return json({id:existing.id, status:existing.status}, 200);
  }
  await verifyHuman(request, env, details.turnstileToken);
  const id = 'LE-' + crypto.randomUUID(), now = Date.now(), uploaded = [];
  try {
    const fileRows = [];
    for (const file of files) {
      const fileId = crypto.randomUUID(), key = `${id}/${fileId}`;
      await env.ARTWORK.put(key, file.bytes, {httpMetadata:{contentType:'application/octet-stream'}});
      uploaded.push(key);
      fileRows.push(env.DB.prepare('INSERT INTO artwork (id, order_id, object_key, filename, content_type, bytes, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(fileId, id, key, file.filename, file.type, file.bytes.length, file.hash));
    }
    await env.DB.batch([
      env.DB.prepare('INSERT INTO orders (id, access_hash, request_hash, product, quantity, customer_name, customer_email, customization, pricing_snapshot, checkout_eligible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, accessHash, requestHash, order.product, order.quantity, order.customerName, order.customerEmail, JSON.stringify(order.customization), order.pricingSnapshot, Number(order.eligible), now),
      ...fileRows,
      notificationStatement(env, `submitted-${id}`, id, 'submitted', {status:'submitted', paymentVerified:false}, now)
    ]);
  } catch (error) {
    await Promise.allSettled(uploaded.map(key => env.ARTWORK.delete(key)));
    // A concurrent retry may have committed the same immutable submission.
    const saved = await env.DB.prepare('SELECT id, request_hash, status FROM orders WHERE access_hash = ?').bind(accessHash).first();
    if (saved?.request_hash === requestHash) return json({id:saved.id,status:saved.status});
    throw error;
  }
  return json({id, status:'submitted'}, 201);
}
async function customerOrder(request, env, id) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /,'');
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new HttpError(404, 'Order not found.');
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND access_hash = ?').bind(id, await digest(token)).first();
  if (!order) throw new HttpError(404, 'Order not found.');
  return order;
}
async function checkout(request, env, id) {
  const order = await customerOrder(request, env, id);
  if (order.status === 'paid' || order.status === 'review_required') throw new HttpError(409, 'This order cannot start another payment.');
  if (!order.checkout_eligible) throw new HttpError(409, 'This payment link is only for one $15 NFC keytag.');
  if (!readiness(env)) throw new HttpError(503, 'Checkout remains disabled until configuration and testing are complete.');
  const link = await stripeGet(env, `payment_links/${encodeURIComponent(env.STRIPE_PAYMENT_LINK_ID)}`);
  const lines = await stripeGet(env, `payment_links/${encodeURIComponent(env.STRIPE_PAYMENT_LINK_ID)}/line_items?limit=100`);
  assertLink(link, lines, env);
  for (const rate of (env.SHIPPING_RATE_IDS || '').split(',').filter(Boolean)) {
    assertShippingRate(await stripeGet(env, `shipping_rates/${encodeURIComponent(rate)}`), env);
  }
  const result = await env.DB.prepare("UPDATE orders SET status = 'awaiting_payment' WHERE id = ? AND status IN ('submitted','awaiting_payment')")
    .bind(id).run();
  if (!result.meta.changes) throw new HttpError(409, 'Order status changed. Please refresh.');
  const url = new URL(env.STRIPE_PAYMENT_LINK_URL);
  url.searchParams.set('client_reference_id', id);
  return json({url:url.href, id});
}
async function webhook(request, env) {
  const raw = new TextDecoder().decode(await readLimited(request, 1024 * 1024));
  await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  let event;
  try { event = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid event.'); }
  if (!PAYMENT_EVENTS.has(event.type)) return json({received:true});
  if (!/^evt_/.test(event.id || '') || !/^cs_/.test(event.data?.object?.id || '') || event.livemode !== (env.ENVIRONMENT === 'live'))
    throw new HttpError(400, 'Unexpected webhook event.');
  if (await env.DB.prepare('SELECT id FROM payment_events WHERE id = ?').bind(event.id).first()) return json({received:true});
  const session = await stripeGet(env, `checkout/sessions/${encodeURIComponent(event.data.object.id)}`);
  if (session.payment_link !== env.STRIPE_PAYMENT_LINK_ID) {
    await statements(env, event, 'ignored_other_payment_link', Date.now()).run();
    return json({received:true});
  }
  // The authoritative reference comes from the retrieved Session, not the browser or webhook snapshot.
  event.data.object = session;
  const order = session.client_reference_id ? await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(session.client_reference_id).first() : null;
  const now = Date.now();
  if (session.payment_status !== 'paid') {
    const failed = event.type === 'checkout.session.async_payment_failed';
    await env.DB.batch([statements(env, event, failed ? 'payment_failed' : 'pending', now),
      ...(failed ? [notificationStatement(env, `failed-${session.id}`, order?.id || null, 'review', {sessionId:session.id, reason:'Delayed payment failed; order is unpaid'}, now)] : [])]);
    return json({received:true});
  }
  const lines = await stripeGet(env, `checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=100`);
  let reason = paymentMismatch(session, lines, order, env);
  if (!readiness(env)) reason = reason || 'Payment received while checkout configuration was disabled';
  if (!reason) {
    // D1 batches are atomic; conditional notification insertion handles concurrent distinct events and sessions.
    const shipping = session.collected_information?.shipping_details || session.shipping_details;
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET status = 'paid', stripe_session_id = ?, payment_intent_id = ?, shipping_details = ?, amount_total = ?, currency = ? WHERE id = ? AND stripe_session_id IS NULL AND status IN ('submitted','awaiting_payment')")
        .bind(session.id, typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id, JSON.stringify(shipping), session.amount_total, session.currency, order.id),
      env.DB.prepare("INSERT OR IGNORE INTO notifications (id, order_id, kind, payload, next_attempt) SELECT ?, id, 'paid', ?, ? FROM orders WHERE id = ? AND stripe_session_id = ? AND status = 'paid'")
        .bind(`paid-${order.id}`, JSON.stringify({sessionId:session.id,paymentIntent:session.payment_intent,amountTotal:session.amount_total,currency:session.currency}), now, order.id, session.id)
    ]);
    const matched = await env.DB.prepare('SELECT stripe_session_id, status FROM orders WHERE id = ?').bind(order.id).first();
    if (matched.stripe_session_id !== session.id || matched.status !== 'paid') reason = 'Concurrent or additional payment requires review';
  }
  if (reason) {
    await env.DB.batch([
      statements(env, event, 'review: ' + reason, now),
      ...(order ? [env.DB.prepare("UPDATE orders SET status = 'review_required' WHERE id = ? AND status != 'paid'").bind(order.id)] : []),
      notificationStatement(env, `review-${session.id}`, order?.id || null, 'review', {sessionId:session.id,reference:session.client_reference_id || null,reason}, now)
    ]);
  } else await statements(env, event, 'paid', now).run();
  return json({received:true});
}
async function requireAdmin(request, env) {
  if (!configured(env.ADMIN_TOKEN) || env.ADMIN_TOKEN.length < 32 || !await equalSecrets(request.headers.get('Authorization'), `Bearer ${env.ADMIN_TOKEN}`))
    throw new HttpError(401, 'Administrator authentication required.');
}
export async function route(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/config' && request.method === 'GET') return json({
    submissionsEnabled:env.ORDER_SUBMISSIONS_ENABLED === 'true' && configured(env.TURNSTILE_SITE_KEY) && configured(env.TURNSTILE_SECRET_KEY), checkoutEnabled:readiness(env),
    turnstileSiteKey:configured(env.TURNSTILE_SITE_KEY) ? env.TURNSTILE_SITE_KEY : null,
    environment:env.ENVIRONMENT,
    ...(env.ENVIRONMENT === 'test' ? {setup: {
      turnstileReady: configured(env.TURNSTILE_SITE_KEY) && configured(env.TURNSTILE_SECRET_KEY),
      stripeReady: configured(env.STRIPE_SECRET_KEY) && env.STRIPE_SECRET_KEY.startsWith('sk_test_') &&
        configured(env.STRIPE_WEBHOOK_SECRET) && configured(env.STRIPE_PAYMENT_LINK_ID) &&
        configured(env.STRIPE_PRICE_ID) && /^https:\\/\\/buy\\.stripe\\.com\\/test_[a-zA-Z0-9]+$/.test(env.STRIPE_PAYMENT_LINK_URL || ''),
      emailReady: configured(env.RESEND_API_KEY) && configured(env.RESEND_FROM) && env.EMAIL_VERIFIED === 'true',
      shippingReviewed: env.SHIPPING_REVIEWED === 'true' && !!env.SHIPPING_COUNTRIES,
      taxReviewed: env.TAX_REVIEWED === 'true'
    }} : {})
  });
  if (!env.DB || !env.ARTWORK) throw new HttpError(503, 'Order storage is not configured.');
  if (path === '/api/stripe/webhook' && request.method === 'POST') return webhook(request, env);
  if (path === '/api/orders' && request.method === 'POST') return createOrder(request, env);
  const orderMatch = path.match(/^\/api\/orders\/(LE-[a-f0-9-]{36})(\/checkout)?$/);
  if (orderMatch) {
    if (orderMatch[2] && request.method === 'POST') return checkout(request, env, orderMatch[1]);
    if (!orderMatch[2] && request.method === 'GET') {
      const order = await customerOrder(request, env, orderMatch[1]);
      return json({id:order.id,status:order.status,checkoutEligible:!!order.checkout_eligible,paymentVerified:order.status === 'paid'});
    }
  }
  if (path.startsWith('/api/admin/')) {
    await requireAdmin(request, env);
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    if (path === '/api/admin/notifications') return json((await env.DB.prepare('SELECT id, kind, state, attempts, last_error FROM notifications ORDER BY next_attempt DESC LIMIT 100').all()).results);
    const match = path.match(/^\/api\/admin\/orders\/(LE-[a-f0-9-]{36})$/);
    if (match) {
      const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(match[1]).first();
      if (!order) throw new HttpError(404, 'Order not found.');
      delete order.access_hash; delete order.request_hash;
      const artwork = (await env.DB.prepare('SELECT id, filename, content_type, bytes, sha256 FROM artwork WHERE order_id = ?').bind(order.id).all()).results;
      return json({order, artwork});
    }
    const file = path.match(/^\/api\/admin\/artwork\/([a-f0-9-]{36})$/);
    if (file) {
      const record = await env.DB.prepare('SELECT * FROM artwork WHERE id = ?').bind(file[1]).first();
      if (!record) throw new HttpError(404, 'Artwork not found.');
      const object = await env.ARTWORK.get(record.object_key);
      if (!object) throw new HttpError(404, 'Artwork not found.');
      return new Response(object.body, {headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${record.filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
    }
  }
  throw new HttpError(404, 'Not found.');
}
export default {
  async fetch(request, env) {
    const webhookPath = new URL(request.url).pathname === '/api/stripe/webhook';
    const origin = request.headers.get('Origin');
    let response;
    try {
      if (!webhookPath && origin && origin !== env.STOREFRONT_ORIGIN) throw new HttpError(403, 'Origin not allowed.');
      if (!webhookPath && request.method === 'POST' && origin !== env.STOREFRONT_ORIGIN) throw new HttpError(403, 'Origin required.');
      if (request.method === 'OPTIONS') {
        if (origin !== env.STOREFRONT_ORIGIN) throw new HttpError(403, 'Origin not allowed.');
        response = new Response(null, {status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
      } else response = await route(request, env);
    } catch (error) {
      response = json({error:error instanceof HttpError ? error.message : 'Order service temporarily unavailable. Please retry.'}, error instanceof HttpError ? error.status : 503);
    }
    const headers = new Headers(response.headers);
    if (origin === env.STOREFRONT_ORIGIN) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary','Origin');
    headers.set('Cache-Control','no-store');
    headers.set('X-Content-Type-Options','nosniff');
    return new Response(response.body, {status:response.status,headers});
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      await flushNotifications(env);
      await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Date.now()).run();
    })());
  }
};
