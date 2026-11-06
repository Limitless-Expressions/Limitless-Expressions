import {HttpError,json,digest} from './security.js';
const ID='001';
export async function createTestEntry(env){
 if(!env.DB||!env.RESEND_API_KEY||!env.RESEND_FROM||!env.NOTIFICATION_EMAIL||env.EMAIL_VERIFIED!=='true'||!env.PUBLIC_API_ORIGIN)throw new HttpError(503,'Test configuration incomplete.');
 const now=Date.now(),token=crypto.randomUUID()+crypto.randomUUID(),hash=await digest(token),id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO giveaway_test_entries (id,giveaway_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)').bind(id,ID,hash,now,now+900000).run();
 const link=new URL('/api/giveaway/test-entry-verify',env.PUBLIC_API_ORIGIN);
 link.searchParams.set('token',token);
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.GIVEAWAY_RESEND_FROM||env.RESEND_FROM,to:[env.NOTIFICATION_EMAIL],subject:'Giveaway #001 — isolated entry verification test',text:'This is an isolated test entry. Verify within 15 minutes:\n'+link.href+'\nNo real entry or drawing eligibility is created.'}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Provider rejected message');
 }catch{
  await env.DB.prepare('DELETE FROM giveaway_test_entries WHERE id=?').bind(id).run();
  throw new HttpError(503,'Could not send isolated test email.');
 }
 return json({message:'Isolated test entry created and email accepted. Click the link within 15 minutes, then refresh the test count.'});
}
export async function confirmTestEntry(request,env){
 const token=new URL(request.url).searchParams.get('token')||'';
 if(!/^[a-f0-9-]{72}$/.test(token))throw new HttpError(400,'Invalid test confirmation link.');
 const hash=await digest(token),now=Date.now();
 const result=await env.DB.prepare('UPDATE giveaway_test_entries SET verified_at=?,token_hash=NULL WHERE giveaway_id=? AND token_hash=? AND verified_at IS NULL AND expires_at>?').bind(now,ID,hash,now).run();
 if(!result.meta.changes)throw new HttpError(400,'Test link expired, invalid, or already used.');
 return new Response('SUCCESS! Your isolated test entry is verified. This is NOT a real giveaway entry and cannot be selected as a winner.',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}
export async function testEntrySummary(env){
 const row=await env.DB.prepare('SELECT COUNT(*) AS total,COUNT(verified_at) AS verified FROM giveaway_test_entries WHERE giveaway_id=?').bind(ID).first();
 return json({total:row.total,verified:row.verified,realEntriesAffected:false});
}
