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
 // Fail closed until the email delivery and verification endpoints are wired.
 throw new HttpError(503,'Email confirmation is not yet enabled. No entry has been recorded.');
}
