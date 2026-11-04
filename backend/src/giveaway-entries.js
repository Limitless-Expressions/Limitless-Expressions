import {HttpError, json, digest, readLimited} from './security.js';
const GIVEAWAY_ID='001';
export async function entryStatus(env) {
 const g=await env.DB.prepare('SELECT status,opens_at,closes_at FROM giveaways WHERE id=?').bind(GIVEAWAY_ID).first();
 return json({status:env.GIVEAWAY_ENTRIES_ENABLED==='true'?g?.status||'pending':'pending',opensAt:g?.opens_at||null,closesAt:g?.closes_at||null});
}
export async function submitEntry(request,env) {
 if(env.GIVEAWAY_ENTRIES_ENABLED!=='true') throw new HttpError(503,'Giveaway is not open.');
 const g=await env.DB.prepare('SELECT * FROM giveaways WHERE id=?').bind(GIVEAWAY_ID).first();
 const now=Date.now();
 if(!g||g.status!=='open'||now<g.opens_at||now>=g.closes_at) throw new HttpError(409,'Entries are closed.');
 const ip=request.headers.get('CF-Connecting-IP');
 if(!ip) throw new HttpError(403,'Unable to verify request origin.');
 const window=Math.floor(now/3600000);
 const limitKey=await digest('giveaway-rate:'+ip+':'+window);
 const counter=await env.DB.prepare('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(limitKey,now+7200000).first();
 if(counter.count>8) throw new HttpError(429,'Too many attempts. Please try again later.');
 const raw=await readLimited(request,2048);
 let body;
 try {body=JSON.parse(new TextDecoder().decode(raw));}catch{throw new HttpError(400,'Invalid entry.');}
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||body.acceptRules!==true) throw new HttpError(400,'Valid email and rules acceptance required.');
 if(!env.TURNSTILE_SECRET_KEY||!body.turnstileToken) throw new HttpError(503,'Human verification unavailable.');
 const verification=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:body.turnstileToken}),signal:AbortSignal.timeout(10000)});
 if(!verification.ok) throw new HttpError(503,'Verification service unavailable.');
 const proof=await verification.json();
 if(!proof.success||proof.action!=='giveaway'||proof.hostname!==new URL(env.STOREFRONT_ORIGIN).hostname) throw new HttpError(400,'Human verification failed.');
 const key=await digest('giveaway:'+email);
 const exists=await env.DB.prepare('SELECT id FROM giveaway_entries WHERE giveaway_id=? AND email_hash=?').bind(GIVEAWAY_ID,key).first();
 if(exists) return json({message:'If eligible, check your email for confirmation.'},202);
 if(!env.RESEND_API_KEY||!env.RESEND_FROM||env.EMAIL_VERIFIED!=='true') throw new HttpError(503,'Confirmation email service unavailable.');
 const token=crypto.randomUUID()+crypto.randomUUID();
 const tokenHash=await digest(token);
 const id=crypto.randomUUID();
 const inserted=await env.DB.prepare('INSERT OR IGNORE INTO giveaway_entries (id,giveaway_id,email,email_hash,verification_token_hash,verification_expires_at,created_at,marketing_opt_in) VALUES (?,?,?,?,?,?,?,?)').bind(id,GIVEAWAY_ID,email,key,tokenHash,now+86400000,now,body.marketingOptIn===true?1:0).run();
 if(!inserted.meta.changes) return json({message:'If eligible, check your email for confirmation.'},202);
 const verifyUrl=new URL('/api/giveaway/verify',env.PUBLIC_API_ORIGIN);
 verifyUrl.searchParams.set('token',token);
 try {
  const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'giveaway-'+id},body:JSON.stringify({from:env.RESEND_FROM,to:[email],subject:'Confirm your giveaway entry',text:'Confirm your free entry within 24 hours:\\n'+verifyUrl.href+'\\nNo purchase necessary. If you did not request this, ignore this email.'}),signal:AbortSignal.timeout(15000)});
  if(!sent.ok) throw new Error('Delivery failed');
 }catch{
  await env.DB.prepare('DELETE FROM giveaway_entries WHERE id=? AND verified_at IS NULL').bind(id).run();
  throw new HttpError(503,'Could not send confirmation email. Try again.');
 }
 return json({message:'Check your inbox to confirm your entry within 24 hours.'},202);
}
