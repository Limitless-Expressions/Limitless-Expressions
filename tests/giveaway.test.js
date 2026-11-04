import test from 'node:test';
import assert from 'node:assert/strict';
import {entryStatus,submitEntry} from '../backend/src/giveaway-entries.js';
import {giveawayActivate} from '../backend/src/giveaways.js';
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
