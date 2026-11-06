import {HttpError,json} from './security.js';
const bytes=new TextEncoder();
async function signature(env,payload){
 if(!env.GIVEAWAY_TEST_SECRET||env.GIVEAWAY_TEST_SECRET.length<32)throw new HttpError(503,'Test secret not configured.');
 const key=await crypto.subtle.importKey('raw',bytes.encode(env.GIVEAWAY_TEST_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes.encode(payload)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function sendVerificationTest(env){
 if(!env.RESEND_API_KEY||!env.RESEND_FROM||!env.NOTIFICATION_EMAIL||env.EMAIL_VERIFIED!=='true'||!env.PUBLIC_API_ORIGIN)throw new HttpError(503,'Email configuration incomplete.');
 const payload=(Date.now()+900000)+'.'+crypto.randomUUID();
 const url=new URL('/api/giveaway/test-verify',env.PUBLIC_API_ORIGIN);
 url.searchParams.set('token',payload+'.'+await signature(env,payload));
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.GIVEAWAY_RESEND_FROM||env.RESEND_FROM,to:[env.NOTIFICATION_EMAIL],subject:'Giveaway #001 — verification link test',text:'Open this test verification link within 15 minutes:\n'+url.href+'\n\nTEST ONLY. No giveaway entry is created.'}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new HttpError(503,'Email provider rejected test.');
 return json({message:'Verification test email accepted. Check your inbox and click its link within 15 minutes. No entry was created.'});
}
export async function verifyTestLink(request,env){
 const token=new URL(request.url).searchParams.get('token')||'';
 const match=/^(\d{13}\.\w{8}-\w{4}-\w{4}-\w{4}-\w{12})\.([a-f0-9]{64})$/.exec(token);
 if(!match)throw new HttpError(400,'Invalid test link.');
 const expires=Number(match[1].split('.')[0]);
 if(expires<Date.now()||expires>Date.now()+900000)throw new HttpError(400,'Test link expired.');
 const expected=await signature(env,match[1]);
 let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^match[2].charCodeAt(i);
 if(diff)throw new HttpError(400,'Invalid test link.');
 return new Response('Success! Giveaway test verification link works. No real entry was created.',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}
