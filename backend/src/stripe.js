import {HttpError, configured} from './security.js';
import {NFC_PRODUCT} from './orders.js';
import {fixedPriceQuote} from './pricing.js';
export const LIVE_LINK = 'https://buy.stripe.com/fZu4gy5fTaHldGM5dD9EI01';
export function readiness(env) {
  const required = ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PAYMENT_LINK_ID','STRIPE_PRICE_ID','RESEND_API_KEY','RESEND_FROM'];
  if (!env.DB || !env.ARTWORK || required.some(k => !configured(env[k]))) return false;
  if (!['test','live','production'].includes(env.ENVIRONMENT) || env.CHECKOUT_ENABLED !== 'true' ||
      ['SHIPPING_REVIEWED','TAX_REVIEWED','EMAIL_VERIFIED'].some(k => env[k] !== 'true')) return false;
  if (env.DELIVERY_MODE !== 'shipping' || !env.SHIPPING_COUNTRIES || !['automatic','none'].includes(env.TAX_MODE)) return false;
  if (['live','production'].includes(env.ENVIRONMENT)) return env.LIVE_READINESS_APPROVED === 'true' && /^(sk_live_|rk_live_)/.test(env.STRIPE_SECRET_KEY) && env.STRIPE_PAYMENT_LINK_URL === LIVE_LINK;
  return env.STRIPE_SECRET_KEY.startsWith('sk_test_') && /^https:\/\/buy\.stripe\.com\/test_[a-zA-Z0-9]+$/.test(env.STRIPE_PAYMENT_LINK_URL);
}
// Temporary, non-sensitive readiness diagnostics: return condition names only, never values.
export function readinessIssue(env) {
  const required = ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PAYMENT_LINK_ID','STRIPE_PRICE_ID','RESEND_API_KEY','RESEND_FROM'];
  if (!env.DB || !env.ARTWORK) return 'storage_binding';
  if (required.some(k => !configured(env[k]))) return 'missing_required_configuration';
  if (!['test','live','production'].includes(env.ENVIRONMENT)) return 'environment';
  if (env.CHECKOUT_ENABLED !== 'true') return 'checkout_flag';
  if (['SHIPPING_REVIEWED','TAX_REVIEWED','EMAIL_VERIFIED'].some(k => env[k] !== 'true')) return 'review_flags';
  if (env.DELIVERY_MODE !== 'shipping' || !env.SHIPPING_COUNTRIES || !['automatic','none'].includes(env.TAX_MODE)) return 'shipping_tax_configuration';
  if (['live','production'].includes(env.ENVIRONMENT)) {
    if (env.LIVE_READINESS_APPROVED !== 'true') return 'live_approval';
    if (!/^(sk_live_|rk_live_)/.test(env.STRIPE_SECRET_KEY)) return 'stripe_key_format';
    if (env.STRIPE_PAYMENT_LINK_URL !== LIVE_LINK) return 'payment_link_url';
  } else {
    if (!env.STRIPE_SECRET_KEY.startsWith('sk_test_')) return 'test_key_format';
    if (!/^https:\/\/buy\.stripe\.com\/test_[a-zA-Z0-9]+$/.test(env.STRIPE_PAYMENT_LINK_URL)) return 'test_payment_link_url';
  }
  return null;
}
export async function stripeGet(env, path) {
  if (!configured(env.STRIPE_SECRET_KEY)) throw new HttpError(503, 'Stripe is not configured.');
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version':env.STRIPE_API_VERSION || '2025-03-31.basil'},
    signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new HttpError(503, 'Stripe verification is temporarily unavailable.');
  return response.json();
}
export function assertLink(link, lines, env) {
  const expectedLive = ['live','production'].includes(env.ENVIRONMENT);
  if (!link.active || link.id !== env.STRIPE_PAYMENT_LINK_ID || link.url !== env.STRIPE_PAYMENT_LINK_URL || link.livemode !== expectedLive ||
      lines.has_more || lines.data.length !== 1) throw new HttpError(503, 'Payment link configuration does not match this order.');
  const line = lines.data[0];
  if (line.quantity !== 1 || line.adjustable_quantity?.enabled || line.price?.id !== env.STRIPE_PRICE_ID ||
      line.price?.unit_amount !== 1500 || line.price?.currency !== 'usd' || line.price?.recurring || line.price?.tax_behavior === 'inclusive' ||
      (link.optional_items?.length || 0) || link.allow_promotion_codes) throw new HttpError(503, 'Payment link must charge one fixed $15 keytag.');
  const countries = (env.SHIPPING_COUNTRIES || '').split(',').map(s => s.trim()).filter(Boolean).sort();
  const actual = [...(link.shipping_address_collection?.allowed_countries || [])].sort();
  if (JSON.stringify(countries) !== JSON.stringify(actual) || !actual.length || !!link.automatic_tax?.enabled !== (env.TAX_MODE === 'automatic'))
    throw new HttpError(503, 'Shipping or tax settings need review.');
  const rates = (env.SHIPPING_RATE_IDS || '').split(',').filter(Boolean).sort();
  const actualRates = (link.shipping_options || []).map(v => typeof v.shipping_rate === 'string' ? v.shipping_rate : v.shipping_rate.id).sort();
  if (JSON.stringify(rates) !== JSON.stringify(actualRates)) throw new HttpError(503, 'Shipping rates need review.');
  const shippingAmount = Number(env.SHIPPING_AMOUNT_CENTS);
  if (!Number.isSafeInteger(shippingAmount) || shippingAmount < 0 || (!rates.length && shippingAmount !== 0)) throw new HttpError(503, 'Shipping amount needs review.');
}
export function assertShippingRate(rate, env) {
  if (!rate.active || rate.type !== 'fixed_amount' || rate.fixed_amount?.currency !== 'usd' ||
      rate.fixed_amount?.amount !== Number(env.SHIPPING_AMOUNT_CENTS) || rate.tax_behavior === 'inclusive')
    throw new HttpError(503, 'Shipping rate does not match the approved fixed charge.');
}
export function paymentMismatch(session, lines, order, env) {
  if (!order) return 'Unknown or missing order reference';
  if (!order.checkout_eligible || order.product !== NFC_PRODUCT || order.quantity !== 1) return 'Order is not a single NFC keytag';
  if (session.client_reference_id !== order.id || session.payment_link !== env.STRIPE_PAYMENT_LINK_ID || session.livemode !== (['live','production'].includes(env.ENVIRONMENT))) return 'Payment link, reference or environment mismatch';
  if (session.mode !== 'payment' || session.currency !== 'usd' || session.payment_status !== 'paid' || !session.payment_intent) return 'Payment is not verified as paid';
  if (lines.has_more || lines.data.length !== 1) return 'Unexpected line items';
  const line = lines.data[0];
  if (line.quantity !== 1 || line.price?.id !== env.STRIPE_PRICE_ID || line.price?.unit_amount !== 1500 || line.price?.currency !== 'usd' ||
      line.price?.recurring || line.amount_subtotal !== 1500 || session.amount_subtotal !== 1500 || session.total_details?.amount_discount !== 0) return 'Price or quantity mismatch';
  const shipping = session.collected_information?.shipping_details || session.shipping_details;
  const countries = (env.SHIPPING_COUNTRIES || '').split(',').map(v => v.trim());
  if (!shipping?.name || !shipping.address?.line1 || !shipping.address?.postal_code || !countries.includes(shipping.address.country)) return 'Missing or unsupported shipping address';
  if (env.TAX_MODE === 'automatic' && (!session.automatic_tax?.enabled || session.automatic_tax.status !== 'complete')) return 'Tax calculation incomplete';
  const tax = session.total_details?.amount_tax, shippingAmount = session.total_details?.amount_shipping;
  const expectedShipping = Number(env.SHIPPING_AMOUNT_CENTS);
  if (!Number.isSafeInteger(tax) || tax < 0 || (env.TAX_MODE === 'none' && tax !== 0) || !Number.isSafeInteger(expectedShipping) || expectedShipping < 0 || shippingAmount !== expectedShipping || session.amount_total !== 1500 + tax + shippingAmount) return 'Total, shipping or tax mismatch';
  if (order.stripe_session_id && order.stripe_session_id !== session.id) return 'Additional payment for an already matched order';
  return null;
}


// New per-order Stripe Checkout Sessions (opt-in; existing payment link stays untouched).
export function dynamicCheckoutReady(env) {
  return readiness(env) && env.DYNAMIC_CHECKOUT_ENABLED === 'true' &&
    /^https:\/\//.test(env.STOREFRONT_ORIGIN || '') &&
    (env.SHIPPING_RATE_IDS || '').split(',').filter(Boolean).length === 1 &&
    Number(env.SHIPPING_AMOUNT_CENTS) === 600;
}
export async function createDynamicSession(env, order, quote) {
  if (!dynamicCheckoutReady(env)) throw new HttpError(503, 'Per-order checkout is not enabled.');
  const rateId = env.SHIPPING_RATE_IDS.split(',').filter(Boolean)[0];
  const params = new URLSearchParams({
    mode:'payment',
    'payment_method_types[0]':'card',
    client_reference_id:order.id,
    customer_email:order.customer_email,
    'metadata[order_id]':order.id,
    'line_items[0][price_data][currency]':'usd',
    'line_items[0][price_data][unit_amount]':String(quote.unitCents),
    'line_items[0][price_data][product_data][name]':order.product,
    'line_items[0][quantity]':String(quote.quantity),
    'shipping_address_collection[allowed_countries][0]':'US',
    'shipping_options[0][shipping_rate]':rateId,
    'automatic_tax[enabled]':env.TAX_MODE === 'automatic' ? 'true' : 'false',
    success_url:env.STOREFRONT_ORIGIN + '/?session_id={CHECKOUT_SESSION_ID}',
    cancel_url:env.STOREFRONT_ORIGIN + '/',
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method:'POST',
    headers:{
      Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version':env.STRIPE_API_VERSION || '2025-03-31.basil',
      'Content-Type':'application/x-www-form-urlencoded',
      'Idempotency-Key':'limitless-order-' + order.id
    },
    body:params,
    signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new HttpError(503, 'Could not start Stripe checkout. Please try again.');
  const session = await response.json();
  if (session.client_reference_id !== order.id || session.mode !== 'payment' ||
      session.amount_subtotal !== quote.subtotalCents ||
      session.currency !== 'usd' ||
      session.livemode !== ['live','production'].includes(env.ENVIRONMENT) ||
      !/^https:\/\/checkout\.stripe\.com\//.test(session.url || ''))
    throw new HttpError(503, 'Stripe checkout response did not match the order.');
  return session;
}
export function dynamicPaymentMismatch(session, lines, order, env) {
  if (!order || !order.checkout_eligible) return 'Unknown or ineligible order';
  const customization = JSON.parse(order.customization || '{}');
  const quote = fixedPriceQuote(order.product, order.quantity, customization);
  if (!quote) return 'No fixed price for this order';
  if (session.payment_link || session.client_reference_id !== order.id ||
      session.metadata?.order_id !== order.id ||
      session.livemode !== ['live','production'].includes(env.ENVIRONMENT))
    return 'Checkout session reference or environment mismatch';
  if (session.mode !== 'payment' || session.currency !== 'usd' ||
      session.payment_status !== 'paid' || !session.payment_intent)
    return 'Payment not verified';
  if (lines.has_more || lines.data.length !== 1) return 'Unexpected checkout line items';
  const line = lines.data[0];
  if (line.quantity !== quote.quantity || line.price?.unit_amount !== quote.unitCents ||
      line.price?.currency !== 'usd' || line.price?.recurring ||
      line.amount_subtotal !== quote.subtotalCents ||
      session.amount_subtotal !== quote.subtotalCents ||
      session.total_details?.amount_discount !== 0)
    return 'Product amount or quantity mismatch';
  const shipping = session.collected_information?.shipping_details || session.shipping_details;
  if (!shipping?.name || !shipping.address?.line1 || !shipping.address?.postal_code ||
      shipping.address.country !== 'US') return 'Missing or unsupported shipping address';
  if (env.TAX_MODE === 'automatic' &&
      (!session.automatic_tax?.enabled || session.automatic_tax.status !== 'complete'))
    return 'Tax calculation incomplete';
  const tax = session.total_details?.amount_tax;
  const shippingAmount = session.total_details?.amount_shipping;
  if (!Number.isSafeInteger(tax) || tax < 0 ||
      (env.TAX_MODE === 'none' && tax !== 0) ||
      shippingAmount !== quote.shippingCents ||
      session.amount_total !== quote.subtotalCents + quote.shippingCents + tax)
    return 'Total, tax or shipping mismatch';
  if (order.stripe_session_id && order.stripe_session_id !== session.id)
    return 'Additional payment for an already matched order';
  return null;
}
