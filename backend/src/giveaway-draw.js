import {HttpError,json,digest} from './security.js';
export async function closeGiveaway(env) {
 const now=Date.now();
 const result=await env.DB.prepare("UPDATE giveaways SET status='closed' WHERE id='001' AND status='open' AND closes_at<=?").bind(now).run();
 if(!result.meta.changes)throw new HttpError(409,'Giveaway cannot close yet.');
 return json({status:'closed'});
}

export async function drawGiveaway(env) {
 const g=await env.DB.prepare('SELECT status,closes_at FROM giveaways WHERE id=?').bind('001').first();
 if(!g||g.status!=='closed'||Date.now()<g.closes_at)throw new HttpError(409,'Close the giveaway after its deadline first.');
 const rows=(await env.DB.prepare('SELECT id FROM giveaway_entries WHERE giveaway_id=? AND verified_at IS NOT NULL AND verified_at<=? ORDER BY id LIMIT 100001').bind('001',g.closes_at).all()).results;
 if(!rows.length||rows.length>100000)throw new HttpError(409,'Eligible entry count requires review.');
 const max=Math.floor(4294967296/rows.length)*rows.length;
 let value;
 do{value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=max);
 const winner=rows[value%rows.length];
 const auditHash=await digest(rows.map(row=>row.id).join('|'));
 const now=Date.now();
 const result=await env.DB.prepare('INSERT OR IGNORE INTO giveaway_draws (id,giveaway_id,entry_id,eligible_count,selected_at,selection_method,audit_hash) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'001',winner.id,rows.length,now,'crypto.getRandomValues rejection sampling',auditHash).run();
 if(!result.meta.changes)throw new HttpError(409,'A draw already exists.');
 await env.DB.prepare("UPDATE giveaways SET status='drawn' WHERE id='001' AND status='closed'").run();
 const contact=await env.DB.prepare('SELECT email FROM giveaway_entries WHERE id=?').bind(winner.id).first();
 return json({status:'drawn',winnerEmail:contact.email,eligibleCount:rows.length,auditHash});
}
