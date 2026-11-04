import {HttpError,json} from './security.js';
export async function closeGiveaway(env) {
 const now=Date.now();
 const result=await env.DB.prepare("UPDATE giveaways SET status='closed' WHERE id='001' AND status='open' AND closes_at<=?").bind(now).run();
 if(!result.meta.changes)throw new HttpError(409,'Giveaway cannot close yet.');
 return json({status:'closed'});
}
