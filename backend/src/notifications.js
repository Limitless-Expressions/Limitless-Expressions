import {configured} from './security.js';
export function notificationStatement(env, id, orderId, kind, payload, now) {
  return env.DB.prepare('INSERT OR IGNORE INTO notifications (id, order_id, kind, payload, next_attempt) VALUES (?, ?, ?, ?, ?)')
    .bind(id, orderId, kind, JSON.stringify(payload), now);
}
export async function flushNotifications(env) {
  if (!configured(env.RESEND_API_KEY) || !configured(env.RESEND_FROM) || env.EMAIL_VERIFIED !== 'true') return;
  const now = Date.now();
  const {results} = await env.DB.prepare("SELECT * FROM notifications WHERE (state = 'pending' AND next_attempt <= ?) OR (state = 'sending' AND claimed_at < ?) LIMIT 20")
    .bind(now, now - 120000).all();
  for (const job of results) {
    const claimed = await env.DB.prepare("UPDATE notifications SET state = 'sending', claimed_at = ?, attempts = attempts + 1 WHERE id = ? AND ((state = 'pending' AND next_attempt <= ?) OR (state = 'sending' AND claimed_at < ?))")
      .bind(now, job.id, now, now - 120000).run();
    if (!claimed.meta.changes) continue;
    let deliveryStage = 'preparing';
    let providerStatus = null;
    let providerErrorType = null;
    let providerErrorDetail = null;
    try {
      const payload = JSON.parse(job.payload);
      const order = job.order_id ? await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(job.order_id).first() : null;
      const artwork = order ? (await env.DB.prepare('SELECT id, filename FROM artwork WHERE order_id = ?').bind(order.id).all()).results : [];
      const subject = job.kind === 'paid' ? 'Payment verified' : job.kind === 'review' ? 'Payment needs manual review' : 'Order submitted — awaiting payment or quote';
      const text = [
        'Limitless Expressions — Armanie Distributions Inc.', subject,
        order ? `Order: ${order.id}\nProduct: ${order.product}\nQuantity: ${order.quantity}\nCustomer: ${order.customer_name} <${order.customer_email}>\nPricing: ${order.pricing_snapshot}\nCustomization: ${order.customization}` : '',
        `Payment information: ${JSON.stringify(payload)}`,
        order?.shipping_details ? `Shipping: ${order.shipping_details}` : '',
        ...artwork.map(a => `Private artwork: ${a.filename} (ID ${a.id})`),
        'Artwork and full orders require administrator authentication; see docs/SETUP.md. Never begin production from an unpaid submission.'
      ].filter(Boolean).join('\n\n');
      deliveryStage = 'requesting';
      const response = await fetch('https://api.resend.com/emails', {
        method:'POST', headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':job.id},
        body:JSON.stringify({from:env.RESEND_FROM, to:['argon.ecomm@gmail.com'], subject:`${subject} — ${order?.id || payload.sessionId || 'Stripe'}`, text}),
        signal:AbortSignal.timeout(15000)
      });
      providerStatus = response.status;
      if (!response.ok) {
        // Resend returns a machine-readable error name. Never store its message or response body.
        try {
          const providerError = await response.json();
          const rawCode = providerError?.name ?? providerError?.code ?? providerError?.error?.code ?? providerError?.error?.type;
          if (typeof rawCode === 'string' && /^[a-z][a-z0-9_-]{0,63}$/i.test(rawCode)) providerErrorType = rawCode.toLowerCase();
          const rawMessage = providerError?.message ?? providerError?.error?.message;
          if (typeof rawMessage === 'string') {
            // Keep a short, redacted diagnostic only; never persist emails, tokens, or raw provider bodies.
            providerErrorDetail = rawMessage
              .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
              .replace(/\b(re_[A-Za-z0-9_-]{8,}|Bearer\s+\S+)\b/gi, '[redacted]')
              .replace(/[^a-zA-Z0-9 _.,:;()\[\]'-]/g, '')
              .trim().slice(0, 120);
          }
        } catch {
          // An unreadable error response still has a useful HTTP status.
        }
        throw Error('Provider rejected notification');
      }
      deliveryStage = 'reading_receipt';
      const sent = await response.json();
      if (!sent.id) throw Error('Missing provider receipt');
      deliveryStage = 'saving_receipt';
      await env.DB.prepare("UPDATE notifications SET state = 'sent', provider_id = ?, last_error = NULL WHERE id = ? AND claimed_at = ?")
        .bind(sent.id, job.id, now).run();
    } catch (error) {
      // Persist only operational categories. Never log API keys, payloads, customer data or provider bodies.
      const category = providerStatus !== null && providerStatus >= 400
        ? 'resend_http_' + providerStatus + (providerErrorType ? '_' + providerErrorType : '') + (providerErrorDetail ? ': ' + providerErrorDetail : '')
        : error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? 'request_timeout'
          : deliveryStage === 'requesting' ? 'request_failed'
          : deliveryStage === 'reading_receipt' ? 'invalid_provider_receipt'
          : deliveryStage === 'saving_receipt' ? 'receipt_database_error'
          : 'preparation_failed';
      const delay = Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7));
      await env.DB.prepare("UPDATE notifications SET state = 'pending', next_attempt = ?, last_error = ? WHERE id = ? AND claimed_at = ?")
        .bind(Date.now() + delay, category, job.id, now).run();
    }
  }
}
