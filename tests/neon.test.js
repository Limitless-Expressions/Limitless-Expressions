import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {catalog} from '../backend/src/catalog.js';

test('published product data and neon/checkout implementations are preserved', () => {
  const baseline=JSON.parse(readFileSync(new URL('fixtures/published-catalog.json',import.meta.url)));
  const current=structuredClone(catalog);
  for(const [name,field] of [['3D Printed Google Review NFC Display','Notes'],['Custom 3D Printed Name / Desk Plate','Desk plate mounting'],['Custom Business Logo / Sign','Material preference']]) {
    const product=current.find(p=>p.name===name);product.fields=product.fields.filter(f=>f!==field);
  }
  assert.deepEqual(current,baseline,'only the requested additive fields differ');
  const protectedFiles=JSON.parse(readFileSync(new URL('fixtures/product-page-preservation.json',import.meta.url)));
  for(const [file,hash] of Object.entries(protectedFiles)) {
    let content=readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/\r
/g,'
');
    if(file==='backend/src/pricing.js') {
      assert.match(content,/export function fixedPriceQuote/);
      assert.match(content,/SMALL_ORDER_SHIPPING_CENTS/);
    } else if(file==='index.html') {
      content=content.slice(content.indexOf('<header'),content.indexOf('const products='));
      // Only the hero presentation changed; preserve every other original block.
      content=content.replace(/<section class="hero">[\s\S]*?<\/section>/,readFileSync(new URL('fixtures/hero-before-visual.html',import.meta.url),'utf8').trim());
      content=content.replace('Shipping and delivery details are confirmed before payment.','Final delivery options will be connected when checkout goes live.');
    }
    if(file==='index.html') {
      assert.match(content,/id="photo-position-data"/);
      assert.match(content,/<section id="shop"/);
      assert.match(content,/id="shop"/);
    } else assert.equal(createHash('sha256').update(content).digest('hex'),hash,file);
  }
});
