import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import worker from '../backend/src/worker.js';
import {catalog} from '../backend/src/catalog.js';
import {validateDetails, validateArtwork} from '../backend/src/orders.js';
import {readiness, assertLink, assertShippingRate, paymentMismatch, LIVE_LINK} from '../backend/src/stripe.js';
import {verifyStripeSignature} from '../backend/src/security.js';
import {flushNotifications} from '../backend/src/notifications.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../backend/migrations/0001_orders.sql', import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../backend/migrations/0002_artwork_retention.sql', import.meta.url),'utf8'));
  const db = {
    prepare(sql) {
      const make = values => ({
        bind(...next) { return make(next); },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return {results:sqlite.prepare(sql).all(...values)}; },
        async run() { const r = sqlite.prepare(sql).run(...values); return {meta:{changes:Number(r.changes)}}; }
      });
      return make([]);
    },
    async batch(items) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const item of items) results.push(await item.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  const objects = new Map();
  const env = {
    DB:db, ARTWORK:{async put(key, bytes) { objects.set(key,bytes); },async delete(key) { objects.delete(key); }, async get(key) {return objects.has(key) ? {body:objects.get(key)} : null;}},
    ENVIRONMENT:'test', ORDER_SUBMISSIONS_ENABLED:'true', CHECKOUT_ENABLED:'false', SHIPPING_REVIEWED:'true', TAX_REVIEWED:'true', EMAIL_VERIFIED:'true',
    STOREFRONT_ORIGIN:'http://localhost:8080', STRIPE_SECRET_KEY:'sk_test_fixture', STRIPE_WEBHOOK_SECRET:'whsec_fixture',
    STRIPE_PAYMENT_LINK_ID:'plink_fixture', STRIPE_PRICE_ID:'price_fixture', STRIPE_PAYMENT_LINK_URL:'https://buy.stripe.com/test_fixture',
    RESEND_API_KEY:'test_fixture', RESEND_FROM:'Orders <orders@fixture.test>', ADMIN_TOKEN:'x'.repeat(64),
    DELIVERY_MODE:'shipping', TAX_MODE:'automatic', SHIPPING_COUNTRIES:'US', SHIPPING_RATE_IDS:'', SHIPPING_AMOUNT_CENTS:'0'
  };
  return {env,sqlite,objects};
}
const token = 'a'.repeat(64);
const details = () => ({product:catalog[1].name,quantity:1,customerName:'Test Customer',customerEmail:'customer@example.com',accessToken:token,
  customization:{'Keytag size':'2 in','NFC destination URL':'https://example.com','Notes':'Gold logo'}});
function orderRequest(data = details(), files = true) {
  const form = new FormData(); form.set('details',JSON.stringify(data));
  if (files) form.append('artwork',new Blob([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1])],{type:'image/png'}),'logo.png');
  return new Request('http://localhost:8787/api/orders',{method:'POST',headers:{Origin:'http://localhost:8080'},body:form});
}
function session(id, overrides = {}) {
  return {id:'cs_test_fixture',client_reference_id:id,payment_link:'plink_fixture',livemode:false,mode:'payment',currency:'usd',payment_status:'paid',payment_intent:'pi_fixture',
    amount_subtotal:1500,amount_total:1620,total_details:{amount_discount:0,amount_tax:120,amount_shipping:0},automatic_tax:{enabled:true,status:'complete'},
    shipping_details:{name:'Test Customer',address:{line1:'123 Test St',postal_code:'60601',country:'US'}},...overrides};
}
const lines = () => ({has_more:false,data:[{quantity:1,amount_subtotal:1500,price:{id:'price_fixture',unit_amount:1500,currency:'usd',tax_behavior:'exclusive'}}]});
function webhookRequest(env, current, type = 'checkout.session.completed', eventId = 'evt_fixture') {
  const body = JSON.stringify({id:eventId,type,livemode:false,data:{object:current}}), timestamp = Math.floor(Date.now()/1000);
  const signature = createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  return new Request('http://localhost:8787/api/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':`t=${timestamp},v1=${signature}`},body});
}
async function withFetch(fn, run) { const previous = globalThis.fetch; globalThis.fetch = fn; try {return await run();} finally {globalThis.fetch = previous;} }

test('storefront catalog, product data and checkout integrations are preserved', () => {
  const source = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const original = source.replace('<script src="order-config.js"></script><script src="order-workflow.js"></script>','');
  assert.match(source, /id="photo-position-data"/);
  assert.match(source, /initNfcProductPage\(\)/);
  assert.match(source, /const productSlugs=\["hype-chain","nfc-keytag"/);
  assert.doesNotMatch(source, /matches\('(?:button\.)?customize'\)\)openProduct/);
  assert.doesNotMatch(source, /<button class="customize"/);
  assert.match(source, /<script src="order-config.js"><\/script><script src="order-workflow.js"><\/script>/);
  const extracted = vm.runInNewContext(original.slice(original.indexOf('const products='),original.indexOf('function galleryHTML'))+';products');
  assert.equal(catalog.length,11);
  assert.deepEqual(JSON.parse(JSON.stringify(extracted)),catalog);
  const config = readFileSync(new URL('../order-config.js',import.meta.url),'utf8');
  assert.match(config,/enabled: true/); assert.match(config,/allowLiveCheckout: true/);
});
test('approved small NFC quantities are eligible; other quantities remain quote-only', () => {
  assert.equal(validateDetails(details()).eligible,true);
  assert.equal(validateDetails({...details(),quantity:5}).eligible,true);
  for (const quantity of [2,10,25]) assert.equal(validateDetails({...details(),quantity}).eligible,false);
  assert.match(catalog[1].price,/5 for \$50/);
  assert.throws(() => validateDetails({...details(),quantity:1.5}));
  assert.throws(() => validateDetails({...details(),customization:{...details().customization,'NFC destination URL':'javascript:alert(1)'}}));
  assert.throws(() => validateDetails({...details(),product:'Digital STL Files'}));
});
test('file inspection rejects disguised executables, accepts private SVG originals', async () => {
  await assert.rejects(validateArtwork(new File(['MZ executable'],'logo.png',{type:'image/png'})));
  const svg = await validateArtwork(new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],'logo.svg'));
  assert.equal(svg.type,'image/svg+xml'); // Never rendered inline; admin attachment route tested below.
});
test('readiness is off by default and requires separate live approval', () => {
  const {env} = fixture(); assert.equal(readiness(env),false);
  env.CHECKOUT_ENABLED = 'true'; assert.equal(readiness(env),true);
  env.STRIPE_PAYMENT_LINK_URL = LIVE_LINK; assert.equal(readiness(env),false);
  env.ENVIRONMENT = 'live'; env.STRIPE_SECRET_KEY = 'sk_live_fixture'; assert.equal(readiness(env),false);
  env.LIVE_READINESS_APPROVED = 'true'; assert.equal(readiness(env),true);
  env.EMAIL_VERIFIED = 'false'; assert.equal(readiness(env),false);
});
test('link validation blocks adjustable quantity, wrong prices, shipping and tax', () => {
  const {env} = fixture();
  const link = {id:'plink_fixture',url:env.STRIPE_PAYMENT_LINK_URL,active:true,livemode:false,shipping_address_collection:{allowed_countries:['US']},automatic_tax:{enabled:true},shipping_options:[]};
  assert.doesNotThrow(() => assertLink(link,lines(),env));
  const changed = lines(); changed.data[0].adjustable_quantity = {enabled:true};
  assert.throws(() => assertLink(link,changed,env));
  assert.throws(() => assertLink({...link,automatic_tax:{enabled:false}},lines(),env));
  assert.throws(() => assertLink({...link,shipping_address_collection:null},lines(),env));
});
test('checkout URL is returned only after persisted order and verified link configuration', async () => {
  const {env} = fixture(); env.CHECKOUT_ENABLED = 'true';
  const saved = await (await worker.fetch(orderRequest(),env)).json();
  const link = {id:'plink_fixture',url:env.STRIPE_PAYMENT_LINK_URL,active:true,livemode:false,shipping_address_collection:{allowed_countries:['US']},automatic_tax:{enabled:true},shipping_options:[]};
  await withFetch(async url => new Response(JSON.stringify(String(url).includes('/line_items') ? lines() : link)),async () => {
    const request = new Request(`http://localhost:8787/api/orders/${saved.id}/checkout`,{method:'POST',headers:{Origin:env.STOREFRONT_ORIGIN,Authorization:`Bearer ${token}`}});
    const response = await worker.fetch(request,env); assert.equal(response.status,200);
    const result = await response.json(); assert.equal(new URL(result.url).searchParams.get('client_reference_id'),saved.id);
    assert.equal(new URL(result.url).pathname,'/test_fixture');
  });
  assert.throws(() => assertShippingRate({active:true,type:'fixed_amount',fixed_amount:{currency:'usd',amount:500}},env));
  assert.doesNotThrow(() => assertShippingRate({active:true,type:'fixed_amount',fixed_amount:{currency:'usd',amount:0}},env));
});
test('disabled frontend exits without reading or mutating the page', () => {
  const script = readFileSync(new URL('../order-workflow.js',import.meta.url),'utf8');
  vm.runInNewContext(script,{window:{LIMITLESS_ORDER_CONFIG:{enabled:false,apiBase:''}}});
});
test('submission stores bytes and immutable details before payment, retries deduplicate', async () => {
  const {env,sqlite,objects} = fixture();
  const first = await worker.fetch(orderRequest(),env); assert.equal(first.status,201);
  const saved = await first.json(); assert.match(saved.id,/^LE-/);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM orders').get().n,1);
  assert.equal(objects.size,1);
  assert.equal(sqlite.prepare('SELECT status FROM orders').get().status,'submitted');
  assert.equal(sqlite.prepare('SELECT kind FROM notifications').get().kind,'submitted');
  assert.equal((await worker.fetch(orderRequest(),env)).status,200);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM orders').get().n,1);
  assert.equal((await worker.fetch(orderRequest({...details(),quantity:5}),env)).status,409);
  const checkout = new Request(`http://localhost:8787/api/orders/${saved.id}/checkout`,{method:'POST',headers:{Origin:env.STOREFRONT_ORIGIN,Authorization:`Bearer ${token}`}});
  assert.equal((await worker.fetch(checkout,env)).status,503);
  const forgedRedirect = new Request(`http://localhost:8787/api/orders/${saved.id}?session_id=cs_forged`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal((await (await worker.fetch(forgedRedirect,env)).json()).paymentVerified,false);
  assert.equal((await worker.fetch(new Request(`http://localhost:8787/api/orders/${saved.id}`),env)).status,404);
});
test('failed upload does not save an order or leave already uploaded objects', async () => {
  const {env,sqlite,objects} = fixture();
  env.ARTWORK.put = async (key,bytes) => { if (objects.size) throw Error('Storage failure'); objects.set(key,bytes); };
  const request = orderRequest(); const form = await request.formData();
  form.append('artwork',new Blob([new Uint8Array([0xff,0xd8,0xff,1])]),'second.jpg');
  const response = await worker.fetch(new Request(request.url,{method:'POST',headers:{Origin:env.STOREFRONT_ORIGIN},body:form}),env);
  assert.equal(response.status,503); assert.equal(objects.size,0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM orders').get().n,0);
});
test('cross-origin submissions and missing keytag artwork are rejected', async () => {
  const {env} = fixture();
  const request = orderRequest(); request.headers.set('Origin','https://attacker.example');
  assert.equal((await worker.fetch(request,env)).status,403);
  assert.equal((await worker.fetch(orderRequest(details(),false),env)).status,400);
});
test('webhook signature rejects tampering and stale signatures', async () => {
  const secret = 'whsec_fixture', body = '{}', timestamp = Math.floor(Date.now()/1000);
  const signature = createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
  await verifyStripeSignature(body,`t=${timestamp},v1=${signature}`,secret);
  await assert.rejects(verifyStripeSignature('{"changed":true}',`t=${timestamp},v1=${signature}`,secret));
  await assert.rejects(verifyStripeSignature(body,`t=${timestamp},v1=${signature}`,secret,Date.now()+600000));
});
test('verified payment matches once, duplicates do not resend; extra payment is reviewed', async () => {
  const {env,sqlite} = fixture(); env.CHECKOUT_ENABLED = 'true';
  const saved = await (await worker.fetch(orderRequest(),env)).json();
  let current = session(saved.id);
  await withFetch(async url => new Response(JSON.stringify(String(url).includes('/line_items') ? lines() : current)),async () => {
    assert.equal((await worker.fetch(webhookRequest(env,current),env)).status,200);
    assert.equal((await worker.fetch(webhookRequest(env,current),env)).status,200);
    assert.equal((await worker.fetch(webhookRequest(env,current,'checkout.session.async_payment_succeeded','evt_second'),env)).status,200);
    assert.equal(sqlite.prepare('SELECT status FROM orders').get().status,'paid');
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notifications WHERE kind = 'paid'").get().n,1);
    current = session(saved.id,{id:'cs_test_extra'});
    await worker.fetch(webhookRequest(env,current,'checkout.session.completed','evt_extra'),env);
    assert.equal(sqlite.prepare('SELECT stripe_session_id FROM orders').get().stripe_session_id,'cs_test_fixture');
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notifications WHERE kind = 'review'").get().n,1);
  });
});
test('pending and failed delayed payments never mark an order paid; later success does', async () => {
  const {env,sqlite} = fixture(); env.CHECKOUT_ENABLED = 'true';
  const saved = await (await worker.fetch(orderRequest(),env)).json();
  let current = session(saved.id,{payment_status:'unpaid'});
  await withFetch(async url => new Response(JSON.stringify(String(url).includes('/line_items') ? lines() : current)),async () => {
    await worker.fetch(webhookRequest(env,current),env);
    assert.equal(sqlite.prepare('SELECT status FROM orders').get().status,'submitted');
    await worker.fetch(webhookRequest(env,current,'checkout.session.async_payment_failed','evt_failure'),env);
    assert.notEqual(sqlite.prepare('SELECT status FROM orders').get().status,'paid');
    current = session(saved.id);
    await worker.fetch(webhookRequest(env,current,'checkout.session.async_payment_succeeded','evt_success'),env);
    assert.equal(sqlite.prepare('SELECT status FROM orders').get().status,'paid');
  });
});
test('wrong totals, quantity, missing shipping and unpaid state fail reconciliation', () => {
  const {env} = fixture(); const order = {id:'LE-fixture',product:catalog[1].name,quantity:1,checkout_eligible:1};
  assert.equal(paymentMismatch(session(order.id),lines(),order,env),null);
  for (const overrides of [{amount_total:1500},{shipping_details:null},{payment_status:'unpaid'},{livemode:true}])
    assert.ok(paymentMismatch(session(order.id,overrides),lines(),order,env));
  const changed = lines(); changed.data[0].quantity = 5;
  assert.ok(paymentMismatch(session(order.id),changed,order,env));
});
test('missing references are retained for manual review, unrelated links ignored', async () => {
  const {env,sqlite} = fixture(); env.CHECKOUT_ENABLED = 'true';
  let current = session(null);
  await withFetch(async url => new Response(JSON.stringify(String(url).includes('/line_items') ? lines() : current)),async () => {
    await worker.fetch(webhookRequest(env,current),env);
    assert.equal(sqlite.prepare('SELECT outcome FROM payment_events').get().outcome,'review: Unknown or missing order reference');
    current = session(null,{payment_link:'plink_other'});
    await worker.fetch(webhookRequest(env,current,'checkout.session.completed','evt_other'),env);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM notifications').get().n,1);
  });
});
test('private artwork requires admin authentication and downloads as an attachment', async () => {
  const {env,sqlite} = fixture(); await worker.fetch(orderRequest(),env);
  const file = sqlite.prepare('SELECT id FROM artwork').get();
  const url = `http://localhost:8787/api/admin/artwork/${file.id}`;
  assert.equal((await worker.fetch(new Request(url),env)).status,401);
  const response = await worker.fetch(new Request(url,{headers:{Authorization:`Bearer ${env.ADMIN_TOKEN}`}}),env);
  assert.equal(response.status,200); assert.match(response.headers.get('Content-Disposition'),/^attachment/);
  assert.equal(response.headers.get('Content-Type'),'application/octet-stream');
});
test('email provider failures remain queued and retry without changing payment state', async () => {
  const {env,sqlite} = fixture(); await worker.fetch(orderRequest(),env);
  await withFetch(async () => new Response('{}',{status:503}),() => flushNotifications(env));
  assert.equal(sqlite.prepare('SELECT state FROM notifications').get().state,'pending');
  sqlite.prepare('UPDATE notifications SET next_attempt = 0').run();
  let calls = 0;
  await withFetch(async (url,options) => { calls++; const mail = JSON.parse(options.body); assert.deepEqual(mail.to,['argon.ecomm@gmail.com']); assert.ok(options.headers['Idempotency-Key']); return new Response('{"id":"mail_fixture"}'); },async () => {
    await flushNotifications(env); await flushNotifications(env);
  });
  assert.equal(calls,1); assert.equal(sqlite.prepare('SELECT state FROM notifications').get().state,'sent');
  assert.equal(sqlite.prepare('SELECT status FROM orders').get().status,'submitted');
});

test('neon selections survive validation; legacy orders need no new field', async () => {
  const legacy = {...details(),product:'Custom 3D Printed Neon Name Sign',customization:{'Font style':'Original handwritten request','Mounting preference':'Legacy wall mount'}};
  assert.equal(validateDetails(legacy).customization['Font style'],'Original handwritten request');
  assert.equal(validateDetails(legacy).customization['Neon channel style'],'');
  const customization = {'Neon channel style':'Double-Stroke Neon','Font style':'Pacifico','Mounting preference':'Wall Standoffs (Request Quote)'};
  assert.deepEqual({...validateDetails({...legacy,customization}).customization,...customization},validateDetails({...legacy,customization}).customization);
  const {env,sqlite} = fixture();
  const response = await worker.fetch(orderRequest({...legacy,customization},false),env,{});
  assert.equal(response.status,201);
  const saved = sqlite.prepare('SELECT * FROM orders').get();
  const snapshot = JSON.stringify(saved);
  for (const value of Object.values(customization)) assert.ok(snapshot.includes(value));
  sqlite.close();
});

test('product pages require chain/sign artwork and retain published checkout eligibility', async () => {
  for(const product of ['Custom 3D Printed Hype Chain','Custom Business Logo / Sign']) {
    const {env,sqlite}=fixture();
    const customization=product.includes('Hype')?{'Pendant size':'4 in'}:{'Neon sign size':'10 in'};
    const data={...details(),product,customization};
    assert.equal((await worker.fetch(orderRequest(data,false),env,{})).status,400);
    assert.equal((await worker.fetch(orderRequest(data,true),env,{})).status,201);
    assert.equal((await worker.fetch(orderRequest(data,true),env,{})).status,200,'identical retry reuses the saved order');
    assert.equal(sqlite.prepare('SELECT COUNT(*) as count FROM orders').get().count,1);
    sqlite.close();
  }
  assert.equal(validateDetails({...details(),product:'Custom 3D Printed Hype Chain',customization:{'Pendant size':'5 in'}}).eligible,true);
  const desk={...details(),product:'Custom 3D Printed Name / Desk Plate',customization:{'Name / Top Row':'Alex','Bottom Row':'CEO','Desk plate mounting':'Stand and mounting holes'}};
  const {env,sqlite}=fixture();
  assert.equal((await worker.fetch(orderRequest(desk,false),env,{})).status,201);
  assert.match(sqlite.prepare('SELECT customization FROM orders').get().customization,/Stand and mounting holes/);
  const legacy={...desk,customization:{'Name / Top Row':'Legacy'}};
  assert.equal(Object.hasOwn(validateDetails(legacy).customization,'Desk plate mounting'),false);
  assert.equal((await worker.fetch(orderRequest(desk,false),env,{})).status,200);
  assert.equal(Object.hasOwn(validateDetails({...details(),product:'Custom Business Logo / Sign',customization:{}}).customization,'Material preference'),false);
  assert.equal(Object.hasOwn(validateDetails({...details(),product:'3D Printed Google Review NFC Display',customization:{}}).customization,'Notes'),false);
  sqlite.close();
});

test('manual fulfillment requires admin, a paid order, and is idempotent', async () => {
  const {env,sqlite} = fixture();
  await worker.fetch(orderRequest(),env);
  const id=sqlite.prepare('SELECT id FROM orders').get().id;
  const url='http://localhost:8787/api/admin/orders/'+id+'/fulfill';
  const unauthorized=await worker.fetch(new Request(url,{method:'POST',headers:{Origin:'http://localhost:8787'}}),env);
  assert.equal(unauthorized.status,401);
  const request=()=>new Request(url,{method:'POST',headers:{Origin:'http://localhost:8787',Authorization:'Bearer '+env.ADMIN_TOKEN}});
  assert.equal((await worker.fetch(request(),env)).status,409);
  sqlite.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(id);
  const first=await worker.fetch(request(),env);
  assert.equal(first.status,200);
  const result=await first.json();
  assert.ok(result.fulfilledAt>0);
  assert.equal(result.artworkDeleteAfter-result.fulfilledAt,90*24*60*60*1000);
  const second=await (await worker.fetch(request(),env)).json();
  assert.equal(second.fulfilledAt,result.fulfilledAt);
  assert.equal(second.alreadyFulfilled,true);
});

test('scheduled cleanup retains unfulfilled and recent artwork, deletes overdue fulfilled artwork', async () => {
  const {env,sqlite,objects}=fixture();
  await worker.fetch(orderRequest(),env);
  const order=sqlite.prepare('SELECT id FROM orders').get().id;
  const key=sqlite.prepare('SELECT object_key FROM artwork').get().object_key;
  assert.equal(objects.has(key),true);
  const schedule=async()=>{const tasks=[];await worker.scheduled({},env,{waitUntil(p){tasks.push(p)}});await Promise.all(tasks)};
  await schedule();
  assert.equal(objects.has(key),true);
  sqlite.prepare('UPDATE orders SET fulfilled_at = ? WHERE id = ?').run(Date.now()-89*86400000,order);
  await schedule();
  assert.equal(objects.has(key),true);
  sqlite.prepare('UPDATE orders SET fulfilled_at = ? WHERE id = ?').run(Date.now()-91*86400000,order);
  await schedule();
  assert.equal(objects.has(key),false);
  assert.ok(sqlite.prepare('SELECT deleted_at FROM artwork').get().deleted_at>0);
});

test('administrator dashboard serves a protected-by-token management interface', async () => {
  const {env,sqlite}=fixture();
  const response=await worker.fetch(new Request('http://localhost:8787/admin'),env,{});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/html/);
  assert.equal(response.headers.get('x-frame-options'),'DENY');
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const html=await response.text();
  assert.match(html,/Limitless Expressions — Orders/);
  assert.match(html,/type="password"/);
  assert.match(html,/Mark fulfilled/);
  assert.match(html,/View order \/ artwork/);
  assert.match(html,/Download artwork/);
  assert.match(html,/\/api\/admin\/artwork\//);
  assert.ok(!html.includes(env.ADMIN_TOKEN),'the administrator token must not be embedded in HTML');
  const unauthorized=await worker.fetch(new Request('http://localhost:8787/api/admin/orders'),env,{});
  assert.equal(unauthorized.status,401);
  sqlite.close();
});
