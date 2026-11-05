import test from 'node:test';
import assert from 'node:assert/strict';
import {entryStatus,submitEntry} from '../backend/src/giveaway-entries.js';
import {giveawayActivate,giveawayFollowerMilestone} from '../backend/src/giveaways.js';
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

test('activation uses published November 19 hard deadline instead of seven days',async()=>{
 let values;
 const env={GIVEAWAY_ENTRIES_ENABLED:'true',GIVEAWAY_RULES_APPROVED:'true',TURNSTILE_SITE_KEY:'sitekey',TURNSTILE_SECRET_KEY:'secret',RESEND_API_KEY:'key',RESEND_FROM:'giveaways@example.com',EMAIL_VERIFIED:'true',PUBLIC_API_ORIGIN:'https://api.example.com',STOREFRONT_ORIGIN:'https://example.com',DB:{prepare:()=>({bind:(...args)=>{values=args;return {run:async()=>({meta:{changes:1}})};}})}};
 const response=await giveawayActivate(env);
 const body=await response.json();
 assert.equal(body.closesAt,Date.parse('2026-11-20T05:59:00Z'));
 assert.equal(values[6],body.closesAt);
});
test('100-follower milestone sets close to 24 hours after recording',async()=>{
 let values;
 const env={GIVEAWAY_ENTRIES_ENABLED:'true',DB:{prepare:()=>({bind:(...args)=>{values=args;return {run:async()=>({meta:{changes:1}})};}})}};
 const before=Date.now();
 const response=await giveawayFollowerMilestone(env);
 const body=await response.json();
 assert.equal(body.status,'open');
 assert.ok(body.milestoneRecordedAt>=before);
 assert.equal(body.closesAt,Math.min(body.milestoneRecordedAt+86400000,Date.parse('2026-11-20T05:59:00Z')));
 assert.equal(values[0],body.closesAt);
 assert.equal(body.drawingNotBefore,body.closesAt+86400000);
});
test('100-follower milestone cannot be recorded twice',async()=>{
 const env={GIVEAWAY_ENTRIES_ENABLED:'true',DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:0}})})})}};
 await assert.rejects(giveawayFollowerMilestone(env),error=>error.status===409);
});
test('milestone endpoint fails closed when giveaway disabled',async()=>{
 await assert.rejects(giveawayFollowerMilestone({GIVEAWAY_ENTRIES_ENABLED:'false'}),error=>error.status===409);
});
