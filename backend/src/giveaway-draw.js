import {HttpError,json,digest} from './security.js';

const ID='001';
const RESPONSE_WINDOW=72*60*60*1000;

async function eligible(env,closesAt) {
 const rows=(await env.DB.prepare(
  'SELECT id FROM giveaway_entries WHERE giveaway_id=? AND verified_at IS NOT NULL AND created_at<? AND verified_at<=created_at+86400000 ORDER BY id LIMIT 100001'
 ).bind(ID,closesAt).all()).results;
 if(!rows.length||rows.length>100000)throw new HttpError(409,'Eligible entry count requires review.');
 return rows;
}
function pick(rows) {
 const max=Math.floor(4294967296/rows.length)*rows.length;
 let value;
 do{value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=max);
 return rows[value%rows.length];
}
async function current(env) {
 return env.DB.prepare('SELECT * FROM giveaway_winner_rounds WHERE giveaway_id=? ORDER BY round_number DESC LIMIT 1').bind(ID).first();
}
async function publicRound(env,row) {
 const contact=await env.DB.prepare('SELECT email FROM giveaway_entries WHERE id=?').bind(row.entry_id).first();
 return {round:row.round_number,status:row.outcome,winnerEmail:contact?.email,selectedAt:row.selected_at,notifiedAt:row.notified_at,responseDeadlineAt:row.response_deadline_at,respondedAt:row.responded_at};
}
export async function closeGiveaway(env) {
 const now=Date.now();
 const result=await env.DB.prepare("UPDATE giveaways SET status='closed' WHERE id=? AND status='open' AND closes_at<=?").bind(ID,now).run();
 if(!result.meta.changes)throw new HttpError(409,'Giveaway cannot close yet.');
 return json({status:'closed'});
}
export async function drawGiveaway(env) {
 const g=await env.DB.prepare('SELECT status,closes_at FROM giveaways WHERE id=?').bind(ID).first();
 if(!g||g.status!=='closed'||Date.now()<g.closes_at+86400000)throw new HttpError(409,'Wait 24 hours after entries close before drawing.');
 if(await current(env))throw new HttpError(409,'A winner was already selected.');
 const rows=await eligible(env,g.closes_at),winner=pick(rows),hash=await digest(rows.map(x=>x.id).join('|')),now=Date.now(),id=crypto.randomUUID();
 // Keep the legacy audit record, and insert the first notification round together.
 const statements=[
  env.DB.prepare('INSERT INTO giveaway_draws (id,giveaway_id,entry_id,eligible_count,selected_at,selection_method,audit_hash) VALUES (?,?,?,?,?,?,?)').bind(id,ID,winner.id,rows.length,now,'crypto.getRandomValues rejection sampling',hash),
  env.DB.prepare("INSERT INTO giveaway_winner_rounds (id,giveaway_id,round_number,entry_id,eligible_count,selected_at,selection_method,audit_hash) VALUES (?,?,1,?,?,?,?,?)").bind(crypto.randomUUID(),ID,winner.id,rows.length,now,'crypto.getRandomValues rejection sampling',hash),
  env.DB.prepare("UPDATE giveaways SET status='drawn' WHERE id=? AND status='closed'").bind(ID)
 ];
 try{await env.DB.batch(statements);}catch{throw new HttpError(409,'Drawing was already completed or could not be saved.');}
 return json({status:'drawn',...(await publicRound(env,await current(env))),eligibleCount:rows.length,auditHash:hash});
}
export async function winnerStatus(env) {
 const row=await current(env);
 if(!row)return json({round:null});
 return json({...(await publicRound(env,row)),eligibleCount:row.eligible_count});
}
export async function markWinnerNotified(env) {
 const row=await current(env);
 if(!row||row.outcome!=='selected')throw new HttpError(409,'No selected winner awaiting notification.');
 const now=Date.now();
 const result=await env.DB.prepare("UPDATE giveaway_winner_rounds SET outcome='notified',notified_at=?,response_deadline_at=? WHERE id=? AND outcome='selected'").bind(now,now+RESPONSE_WINDOW,row.id).run();
 if(!result.meta.changes)throw new HttpError(409,'Winner status changed.');
 return json({...(await publicRound(env,await current(env)))});
}
export async function acceptWinner(env) {
 const row=await current(env),now=Date.now();
 if(!row||row.outcome!=='notified'||now>row.response_deadline_at)throw new HttpError(409,'Winner has not been notified or response deadline passed.');
 const result=await env.DB.prepare("UPDATE giveaway_winner_rounds SET outcome='accepted',responded_at=? WHERE id=? AND outcome='notified' AND response_deadline_at>=?").bind(now,row.id,now).run();
 if(!result.meta.changes)throw new HttpError(409,'Winner status changed.');
 return json({...(await publicRound(env,await current(env)))});
}
export async function drawAlternate(env) {
 const previous=await current(env),now=Date.now();
 if(!previous)throw new HttpError(409,'Draw the first winner before selecting an alternate.');
 if(previous.outcome==='accepted')throw new HttpError(409,'A winner has already accepted.');
 if(previous.outcome==='selected')throw new HttpError(409,'Notify or disqualify the selected winner first.');
 if(previous.outcome==='notified'&&now<previous.response_deadline_at)throw new HttpError(409,'The 72-hour response deadline has not passed.');
 const g=await env.DB.prepare('SELECT status,closes_at FROM giveaways WHERE id=?').bind(ID).first();
 if(!g||g.status!=='drawn')throw new HttpError(409,'Giveaway is not ready for an alternate.');
 const all=await eligible(env,g.closes_at);
 const excluded=(await env.DB.prepare('SELECT entry_id FROM giveaway_winner_rounds WHERE giveaway_id=?').bind(ID).all()).results;
 const excludedIds=new Set(excluded.map(x=>x.entry_id)),remaining=all.filter(x=>!excludedIds.has(x.id));
 if(!remaining.length)throw new HttpError(409,'No remaining eligible entries.');
 const winner=pick(remaining),hash=await digest(remaining.map(x=>x.id).join('|')),round=previous.round_number+1;
 const oldOutcome=previous.outcome==='notified'?'expired':previous.outcome;
 // Conditional insert ensures a concurrent request cannot advance the same round twice.
 const result=await env.DB.prepare(
  "INSERT OR IGNORE INTO giveaway_winner_rounds (id,giveaway_id,round_number,entry_id,eligible_count,selected_at,selection_method,audit_hash) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM giveaway_winner_rounds WHERE id=? AND outcome=? AND (outcome IN ('expired','ineligible') OR (outcome='notified' AND response_deadline_at<=?)))"
 ).bind(crypto.randomUUID(),ID,round,winner.id,remaining.length,now,'crypto.getRandomValues rejection sampling',hash,previous.id,previous.outcome,now).run();
 if(!result.meta.changes)throw new HttpError(409,'Winner status changed or alternate already selected.');
 if(oldOutcome!==previous.outcome)await env.DB.prepare("UPDATE giveaway_winner_rounds SET outcome='expired' WHERE id=? AND outcome='notified' AND response_deadline_at<=?").bind(previous.id,now).run();
 return json({status:'alternate_selected',...(await publicRound(env,await current(env))),eligibleCount:remaining.length,auditHash:hash});
}
export async function disqualifyWinner(env) {
 const row=await current(env);
 if(!row||!['selected','notified'].includes(row.outcome))throw new HttpError(409,'No pending winner to disqualify.');
 const result=await env.DB.prepare("UPDATE giveaway_winner_rounds SET outcome='ineligible' WHERE id=? AND outcome IN ('selected','notified')").bind(row.id).run();
 if(!result.meta.changes)throw new HttpError(409,'Winner status changed.');
 return json({...(await publicRound(env,await current(env)))});
}
