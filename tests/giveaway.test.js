import test from 'node:test';
import assert from 'node:assert/strict';
import {entryStatus,submitEntry} from '../backend/src/giveaway-entries.js';
import {giveawayActivate,giveawayMilestoneReached} from '../backend/src/giveaways.js';
import {confirmGiveawayEmail} from '../backend/src/giveaway-verification.js';
import {closeGiveaway,drawGiveaway} from '../backend/src/giveaway-draw.js';

const db = row => ({prepare: () => ({bind: () => ({first:async()=>row})})});
test('status is pending while feature flag is disabled',async()=>{
 const response=await entryStatus({DB:db({status:'open',opens_at:1,closes_at:9999999999999}),GIVEAWAY_ENTRIES_ENABLED:'false'});
 assert.equal((await response.json()).status,'pending');
});
test('entry endpoint fails closed when disabled',async()=>{
 await assert.rejects(submitEntry(new Request('https://example.com',{method:'POST'}),{GIVEAWAY_ENTRIES_ENABLED:'false'}),error=>error.status===503);
});
test('activation requires explicit feature flag',async()=>{
 await assert.rejects(giveawayActivate({GIVEAWAY_ENTRIES_ENABLED:'false'}),error=>error.status===409);
});
test('draw requires a closed giveaway',async()=>{
 await assert.rejects(drawGiveaway({DB:db({status:'open',closes_at:1})}),error=>error.status===409);
});
test('closing is refused when no row is updated',async()=>{
 const env={DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:0}})})})}};
 await assert.rejects(closeGiveaway(env),error=>error.status===409);
});

test('activation refuses unapproved rules even when services are configured',async()=>{
 const env={GIVEAWAY_ENTRIES_ENABLED:'true',GIVEAWAY_RULES_APPROVED:'false',TURNSTILE_SITE_KEY:'sitekey',TURNSTILE_SECRET_KEY:'secret',RESEND_API_KEY:'key',RESEND_FROM:'giveaways@example.com',EMAIL_VERIFIED:'true',PUBLIC_API_ORIGIN:'https://api.example.com',STOREFRONT_ORIGIN:'https://example.com'};
 await assert.rejects(giveawayActivate(env),error=>error.status===409);
});
test('activation refuses missing email configuration',async()=>{
 const env={GIVEAWAY_ENTRIES_ENABLED:'true',GIVEAWAY_RULES_APPROVED:'true',TURNSTILE_SITE_KEY:'sitekey',TURNSTILE_SECRET_KEY:'secret',EMAIL_VERIFIED:'true',PUBLIC_API_ORIGIN:'https://api.example.com',STOREFRONT_ORIGIN:'https://example.com'};
 await assert.rejects(giveawayActivate(env),error=>error.status===503);
});
test('draw refuses a second draw',async()=>{
 const env={DB:{prepare:sql=>({bind:()=>({
  first:async()=>({status:'closed',closes_at:1}),
  all:async()=>({results:[{id:'entry-1'}]}),
  run:async()=>({meta:{changes:0}})
 })})}};
 await assert.rejects(drawGiveaway(env),error=>error.status===409);
});

test('milestone records a 24-hour deadline with one-time guard',async()=>{
 let sql='',params=[];
 const env={DB:{prepare:query=>{sql=query;return {bind:(...values)=>{params=values;return {run:async()=>({meta:{changes:1}})}}}}}};
 const response=await giveawayMilestoneReached(env);
 const result=await response.json();
 assert.equal(result.milestoneReached,true);
 assert.match(sql,/closes_at-opens_at>=\?/);
 assert.equal(params[0],29*86400000);
 assert.ok(result.closesAt>Date.now()+23*3600000);
 assert.ok(result.closesAt<Date.now()+25*3600000);
});
test('milestone cannot be confirmed again after update guard rejects it',async()=>{
 const env={DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:0}})})})}};
 await assert.rejects(giveawayMilestoneReached(env),error=>error.status===409);
});

test('email confirmation rejects disabled entries without modifying database',async()=>{
 let updated=false;
 const env={GIVEAWAY_ENTRIES_ENABLED:'false',DB:{prepare:sql=>({bind:()=>({first:async()=>({status:'open'}),run:async()=>{updated=true;return {meta:{changes:1}}}})})}};
 const token='a'.repeat(72);
 await assert.rejects(confirmGiveawayEmail(new Request('https://api.example.com/api/giveaway/verify?token='+token),env),error=>error.status===409);
 assert.equal(updated,false);
});
test('email confirmation rejects malformed links',async()=>{
 await assert.rejects(confirmGiveawayEmail(new Request('https://api.example.com/api/giveaway/verify?token=bad'),{}),error=>error.status===400);
});
test('email confirmation accepts an unexpired token once',async()=>{
 const token='a'.repeat(72);let updateCalls=0,params;
 const env={GIVEAWAY_ENTRIES_ENABLED:'true',DB:{prepare:sql=>({bind:(...values)=>({
  first:async()=>({status:'open',closes_at:Date.now()+86400000}),
  run:async()=>{updateCalls++;params=values;return {meta:{changes:updateCalls===1?1:0}}}
 })})}};
 const url='https://api.example.com/api/giveaway/verify?token='+token;
 const response=await confirmGiveawayEmail(new Request(url),env);
 assert.equal(response.status,200);
 assert.match(await response.text(),/confirmed/i);
 assert.equal(params[1],'001');
 assert.equal(params[2].length,64);
 await assert.rejects(confirmGiveawayEmail(new Request(url),env),error=>error.status===400);
});
test('email confirmation accepts pending verification after entries close',async()=>{
 const token='b'.repeat(72);
 const env={GIVEAWAY_ENTRIES_ENABLED:'true',DB:{prepare:()=>({bind:()=>({
  first:async()=>({status:'closed',closes_at:Date.now()-1000}),
  run:async()=>({meta:{changes:1}})
 })})}};
 const response=await confirmGiveawayEmail(new Request('https://api.example.com/api/giveaway/verify?token='+token),env);
 assert.equal(response.status,200);
});
test('email confirmation rejects expired or already-used tokens',async()=>{
 const token='c'.repeat(72);
 const env={GIVEAWAY_ENTRIES_ENABLED:'true',DB:{prepare:()=>({bind:()=>({
  first:async()=>({status:'open'}),
  run:async()=>({meta:{changes:0}})
 })})}};
 await assert.rejects(confirmGiveawayEmail(new Request('https://api.example.com/api/giveaway/verify?token='+token),env),error=>error.status===400);
});
