import {HttpError, digest, json, configured} from './security.js';
import {stripeGet} from './stripe.js';

const live = env => ['live','production'].includes(env.ENVIRONMENT);
const urlSafe = value => /^[a-f0-9-]{36}$/.test(value);
function assertReady(env) {
 if (env.DEPOSITS_ENABLED !== 'true' || !configured(env.STRIPE_SECRET_KEY) || !env.DB || !/^https:\/\//.test(env.STOREFRONT_ORIGIN || '')) throw new HttpError(503,'Deposits are not configured.');
 if (live(env) !== /^(sk_live_|rk_live_)/.test(env.STRIPE_SECRET_KEY)) throw new HttpError(503,'Stripe environment mismatch.');
}
async function stripePost(env, path, params, idempotencyKey) {
 const response = await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded','Stripe-Version':env.STRIPE_API_VERSION || '2025-03-31.basil','Idempotency-Key':idempotencyKey},body:params,signal:AbortSignal.timeout(15000)});
 if (!response.ok) throw new HttpError(503,'Stripe checkout is temporarily unavailable.');
 return response.json();
}
export async function createDeposit(request,env) {
 assertReady(env);
 const data=await request.json().catch(()=>null);
 const name=String(data?.customerName||'').trim(), description=String(data?.description||'').trim(), email=String(data?.customerEmail||'').trim();
 const total=Number(data?.totalCents), deposit=Number(data?.depositCents);
 if (name.length<2||name.length>120||description.length<3||description.length>1000||email.length>254||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||!Number.isSafeInteger(total)||total<100||total>10000000||!Number.isSafeInteger(deposit)||deposit<50||deposit>total) throw new HttpError(400,'Invalid deposit request.');
 const id=crypto.randomUUID(), token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const now=Date.now(), expires=now+7*86400000;
 await env.DB.prepare('INSERT INTO deposits (id,token_hash,customer_name,customer_email,description,total_cents,deposit_cents,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,await digest(token),name,email||null,description,total,deposit,now,expires).run();
 return json({id,url:env.STOREFRONT_ORIGIN+'/deposit.html?id='+encodeURIComponent(id)+'&token='+token,depositCents:deposit,totalCents:total},201);
}
async function find(request,env,id) {
 if (!urlSafe(id)) throw new HttpError(404,'Deposit not found.');
 const token=new URL(request.url).searchParams.get('token')||'';
 if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(404,'Deposit not found.');
 const row=await env.DB.prepare('SELECT * FROM deposits WHERE id=? AND token_hash=?').bind(id,await digest(token)).first();
 if (!row) throw new HttpError(404,'Deposit not found.');
 return row;
}
export async function getDeposit(request,env,id) {
 const row=await find(request,env,id);
 return json({id:row.id,customerName:row.customer_name,description:row.description,totalCents:row.total_cents,depositCents:row.deposit_cents,status:row.status,expired:row.expires_at<Date.now()});
}
export async function depositCheckout(request,env,id) {
 assertReady(env);
 const row=await find(request,env,id);
 if (row.expires_at<Date.now()||!['open','checkout_pending'].includes(row.status)) throw new HttpError(409,'Deposit link expired or already paid.');
 if (row.stripe_session_id) {
  const previous=await stripeGet(env,'checkout/sessions/'+encodeURIComponent(row.stripe_session_id));
  if (previous.status==='open'&&previous.url) return json({url:previous.url});
  if (previous.payment_status==='paid') throw new HttpError(409,'Payment already received; awaiting verification.');
  // Never issue another session until the previous one is definitively expired.
  if (previous.status!=='expired') throw new HttpError(409,'Previous checkout is still processing.');
 }
 const params=new URLSearchParams({
  mode:'payment',client_reference_id:'deposit:'+id,
  'metadata[deposit_id]':id,
  'line_items[0][price_data][currency]':'usd',
  'line_items[0][price_data][unit_amount]':String(row.deposit_cents),
  'line_items[0][price_data][product_data][name]':'Custom order deposit: '+row.description.slice(0,100),
  'line_items[0][quantity]':'1',
  'automatic_tax[enabled]':'false',
  'success_url':env.STOREFRONT_ORIGIN+'/deposit.html?id='+id+'&token='+new URL(request.url).searchParams.get('token')+'&return=success',
  'cancel_url':env.STOREFRONT_ORIGIN+'/deposit.html?id='+id+'&token='+new URL(request.url).searchParams.get('token')
 });
 if(row.customer_email) params.set('customer_email',row.customer_email);
 const session=await stripePost(env,'checkout/sessions',params,'deposit-'+id+'-'+(row.stripe_session_id||'initial'));
 if(!session.url||session.livemode!==live(env)) throw new HttpError(503,'Checkout configuration mismatch.');
 const result=await env.DB.prepare("UPDATE deposits SET stripe_session_id=?,status='checkout_pending' WHERE id=? AND status IN ('open','checkout_pending') AND (stripe_session_id IS NULL OR stripe_session_id=?)").bind(session.id,id,row.stripe_session_id).run();
 if(!result.meta.changes) throw new HttpError(409,'Deposit state changed.');
 return json({url:session.url});
}
export async function handleDepositWebhook(env,event,session) {
 const id=session.metadata?.deposit_id;
 if(!id||session.client_reference_id!=='deposit:'+id) throw new HttpError(400,'Invalid deposit reference.');
 const row=await env.DB.prepare('SELECT * FROM deposits WHERE id=?').bind(id).first();
 if(!row) throw new HttpError(400,'Unknown deposit.');
 if(session.id!==row.stripe_session_id) throw new HttpError(503,'Deposit checkout confirmation pending.');
 if(session.livemode!==live(env)||session.mode!=='payment'||session.currency!=='usd'||session.amount_subtotal!==row.deposit_cents||session.amount_total!==row.deposit_cents||(session.total_details?.amount_discount||0)!==0||session.payment_status!=='paid'||!session.payment_intent) {
  await env.DB.prepare("UPDATE deposits SET status='review_required' WHERE id=? AND status!='paid'").bind(id).run();
  return json({received:true,review:true});
 }
 await env.DB.prepare("UPDATE deposits SET status='paid',payment_intent_id=?,paid_at=? WHERE id=? AND stripe_session_id=? AND status='checkout_pending'").bind(typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent.id,Date.now(),id,session.id).run();
 return json({received:true});
}
export async function completePickup(request,env,id) {
 if(!urlSafe(id)) throw new HttpError(404,'Deposit not found.');
 const data=await request.json().catch(()=>null);
 if(data?.confirm !== 'picked_up') throw new HttpError(400,'Pickup confirmation required.');
 const now=Date.now();
 const result=await env.DB.prepare("UPDATE deposits SET picked_up_at=? WHERE id=? AND status='paid' AND picked_up_at IS NULL").bind(now,id).run();
 if(!result.meta.changes) throw new HttpError(409,'Order is not paid or has already been marked picked up.');
 return json({id,pickedUpAt:now});
}
export async function listDeposits(env) {
 const rows=await env.DB.prepare('SELECT id,customer_name,description,total_cents,deposit_cents,status,created_at,paid_at,picked_up_at FROM deposits ORDER BY created_at DESC LIMIT 100').all();
 return json(rows.results);
}
