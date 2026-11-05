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
 const finalDeadline=Date.parse('2026-11-20T05:59:00Z'); // Nov 19, 11:59 p.m. CST
 if(now>=finalDeadline) throw new HttpError(409,'The published entry deadline has passed.');
 const result=await env.DB.prepare('INSERT OR IGNORE INTO giveaways (id,title,prize_description,prize_value_cents,status,opens_at,closes_at,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('001','Custom Hype Chain Giveaway','One custom hype chain',4000,'open',now,finalDeadline,now).run();
 if(!result.meta.changes) throw new HttpError(409,'Giveaway has already been initialized.');
 return json({status:'open',opensAt:now,closesAt:finalDeadline});
}

// Administrator records the first verified public 100-follower milestone.
// The database close timestamp is authoritative for entry submission and drawing.
export async function giveawayFollowerMilestone(env) {
 if(env.GIVEAWAY_ENTRIES_ENABLED!=='true') throw new HttpError(409,'Giveaway is disabled.');
 const now=Date.now();
 const deadline=Date.parse('2026-11-20T05:59:00Z');
 const closesAt=Math.min(now+86400000,deadline);
 const result=await env.DB.prepare("UPDATE giveaways SET closes_at=? WHERE id='001' AND status='open' AND closes_at=? AND ? < closes_at").bind(closesAt,deadline,now).run();
 if(!result.meta.changes) throw new HttpError(409,'Milestone already recorded, giveaway closed, or deadline passed.');
 return json({status:'open',milestoneRecordedAt:now,closesAt,drawingNotBefore:closesAt+86400000});
}
