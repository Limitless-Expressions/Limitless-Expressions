import test from 'node:test';
import assert from 'node:assert/strict';
import {dynamicPaymentMismatch, dynamicCheckoutReady, createDynamicSession} from '../src/stripe.js';
const product = 'Custom Name / Initial Sign';
const order = {id:'LE-123',product,quantity:1,checkout_eligible:1,customization:'{}',stripe_session_id:null};
const env = {ENVIRONMENT:'test',TAX_MODE:'automatic'};
function paidSession() {
  return {
    id:'cs_test_123',client_reference_id:order.id,metadata:{order_id:order.id},
    payment_link:null,livemode:false,mode:'payment',currency:'usd',
    payment_status:'paid',payment_intent:'pi_test_123',amount_subtotal:2500,amount_total:3100,
    total_details:{amount_discount:0,amount_tax:0,amount_shipping:600},
    automatic_tax:{enabled:true,status:'complete'},
    shipping_details:{name:'Customer',address:{line1:'123 Main St',postal_code:'77001',country:'US'}}
  };
}
function paidLines() {
  return {has_more:false,data:[{quantity:1,price:{unit_amount:2500,currency:'usd',recurring:null},amount_subtotal:2500}]};
}
test('valid paid checkout matches server-owned product price and $6 shipping', () => {
  assert.equal(dynamicPaymentMismatch(paidSession(),paidLines(),order,env),null);
});
test('reject manipulated product price, quantity, tax, shipping, and references', () => {
  const changes = [
    s => {s.amount_total = 2500;},
    s => {s.total_details.amount_shipping = 0; s.amount_total = 2500;},
    s => {s.metadata.order_id = 'another-order';},
    s => {s.payment_status = 'unpaid';},
    s => {s.automatic_tax.status = 'failed';},
    s => {s.shipping_details.address.country = 'CA';},
    s => {s.total_details.amount_discount = 100;},
  ];
  for (const change of changes) {
    const session = paidSession();change(session);
    assert.notEqual(dynamicPaymentMismatch(session,paidLines(),order,env),null);
  }
  const lines=paidLines();lines.data[0].price.unit_amount=100;
  assert.notEqual(dynamicPaymentMismatch(paidSession(),lines,order,env),null);
  const more=paidLines();more.data[0].quantity=2;
  assert.notEqual(dynamicPaymentMismatch(paidSession(),more,order,env),null);
});

test('dynamic checkout is disabled unless every production prerequisite is explicitly enabled', () => {
  const ready = {
    DB:{},ARTWORK:{},ENVIRONMENT:'production',CHECKOUT_ENABLED:'true',
    DYNAMIC_CHECKOUT_ENABLED:'true',LIVE_READINESS_APPROVED:'true',
    STRIPE_SECRET_KEY:'sk_live_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',
    STRIPE_PAYMENT_LINK_ID:'plink_fixture',STRIPE_PRICE_ID:'price_fixture',
    STRIPE_PAYMENT_LINK_URL:'https://buy.stripe.com/fZu4gy5fTaHldGM5dD9EI01',
    RESEND_API_KEY:'test',RESEND_FROM:'orders@example.com',
    SHIPPING_REVIEWED:'true',TAX_REVIEWED:'true',EMAIL_VERIFIED:'true',
    DELIVERY_MODE:'shipping',SHIPPING_COUNTRIES:'US',TAX_MODE:'automatic',
    STOREFRONT_ORIGIN:'https://limitlessexpressions3d.com',
    SHIPPING_RATE_IDS:'shr_fixture',SHIPPING_AMOUNT_CENTS:'600'
  };
  assert.equal(dynamicCheckoutReady(ready),true);
  for (const [field,value] of [
    ['DYNAMIC_CHECKOUT_ENABLED','false'],
    ['SHIPPING_AMOUNT_CENTS','0'],
    ['SHIPPING_RATE_IDS','shr_a,shr_b'],
    ['STOREFRONT_ORIGIN','http://example.com'],
    ['LIVE_READINESS_APPROVED','false']
  ]) {
    assert.equal(dynamicCheckoutReady({...ready,[field]:value}),false,field);
  }
});
