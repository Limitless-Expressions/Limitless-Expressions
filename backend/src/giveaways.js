import {HttpError,json,configured} from './security.js';
export async function giveawayStatus(env) {
 const g=await env.DB.prepare('SELECT id,title,status,opens_at,closes_at FROM giveaways WHERE id=?').bind('001').first();
 return json({giveaway:g||null,entriesEnabled:env.GIVEAWAY_ENTRIES_ENABLED==='true'});
}
export async function giveawayAdminSummary(env) {
 const g=await env.DB.prepare('SELECT * FROM giveaways WHERE id=?').bind('001').first();
 const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id=? AND verified_at IS NOT NULL').bind('001').first();
 return json({giveaway:g,verifiedEntries:count.count});
}
export async function giveawayActivate(env) {
 if(env.GIVEAWAY_ENTRIES_ENABLED!=='true') throw new HttpError(409,'Giveaway feature flag is disabled.');
 if(!configured(env.TURNSTILE_SITE_KEY)||!configured(env.TURNSTILE_SECRET_KEY)||!configured(env.RESEND_API_KEY)||!configured(env.RESEND_FROM)||env.EMAIL_VERIFIED!=='true'||!configured(env.PUBLIC_API_ORIGIN)||!configured(env.STOREFRONT_ORIGIN)) throw new HttpError(503,'Giveaway verification, email or public URLs are not configured.');
 if(env.GIVEAWAY_RULES_APPROVED!=='true') throw new HttpError(409,'Official rules must be approved before activation.');
 const now=Date.now();
 const result=await env.DB.prepare('INSERT OR IGNORE INTO giveaways (id,title,prize_description,prize_value_cents,status,opens_at,closes_at,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('001','Custom Hype Chain Giveaway','One custom hype chain',4000,'open',now,now+30*86400000,now).run();
 if(!result.meta.changes) throw new HttpError(409,'Giveaway has already been initialized.');
 return json({status:'open',opensAt:now,closesAt:now+30*86400000});
}

export async function giveawayMilestoneReached(env) {
 const now=Date.now(),closeAt=now+86400000;
 const result=await env.DB.prepare("UPDATE giveaways SET closes_at=? WHERE id='001' AND status='open' AND closes_at-opens_at>=? AND closes_at>?").bind(29*86400000,now).run();
 if(!result.meta.changes) throw new HttpError(409,'Giveaway is not open, the milestone is already recorded, or the deadline is sooner.');
 return json({status:'open',milestoneReached:true,closesAt:closeAt});
}
