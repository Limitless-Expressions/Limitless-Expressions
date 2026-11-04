import {HttpError,json,digest} from './security.js';
const ID='001';
export async function confirmGiveawayEmail(request,env) {
 const url=new URL(request.url);
 const token=url.searchParams.get('token');
 if(!token||! /^[a-f0-9-]{72}$/.test(token)) throw new HttpError(400,'Invalid confirmation link.');
 const hash=await digest(token);
 const now=Date.now();
 const g=await env.DB.prepare('SELECT status,closes_at FROM giveaways WHERE id=?').bind(ID).first();
 if(env.GIVEAWAY_ENTRIES_ENABLED!=='true'||!g||g.status!=='open'||now>=g.closes_at) throw new HttpError(409,'Confirmation is closed.');
 const result=await env.DB.prepare('UPDATE giveaway_entries SET verified_at=?,verification_token_hash=NULL,verification_expires_at=NULL WHERE giveaway_id=? AND verification_token_hash=? AND verified_at IS NULL AND verification_expires_at>?').bind(now,ID,hash,now).run();
 if(!result.meta.changes) throw new HttpError(400,'This link is expired, invalid, or already used.');
 return new Response('Your giveaway entry has been confirmed. Good luck!',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}
