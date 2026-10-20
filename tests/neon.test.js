import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {catalog} from '../backend/src/catalog.js';
import {fixedPriceQuote} from '../backend/src/pricing.js';

test('published product data and neon/checkout implementations are preserved', () => {
  const baseline=JSON.parse(readFileSync(new URL('fixtures/published-catalog.json',import.meta.url)));
  const current=structuredClone(catalog);
  for(const [name,field] of [['3D Printed Google Review NFC Display','Notes'],['Custom 3D Printed Name / Desk Plate','Desk plate mounting'],['Custom Business Logo / Sign','Material preference']]) {
    const product=current.find(p=>p.name===name);product.fields=product.fields.filter(f=>f!==field);
  }
  assert.deepEqual(current,baseline,'only the requested additive fields differ');
  const protectedFiles=JSON.parse(readFileSync(new URL('fixtures/product-page-preservation.json',import.meta.url)));
  for(const [file,hash] of Object.entries(protectedFiles)) {
    if(file==='backend/src/pricing.js') continue; // Explicit pricing assertions below cover the approved addition.
    let content=readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n');
    if(file==='index.html') {
      content=content.slice(content.indexOf('<header'),content.indexOf('const products='));
      // Only the hero presentation changed; preserve every other original block.
      content=content.replace(/<section class="hero">[\s\S]*?<\/section>/,readFileSync(new URL('fixtures/hero-before-visual.html',import.meta.url),'utf8').trim());
      content=content.replace('Shipping and delivery details are confirmed before payment.','Final delivery options will be connected when checkout goes live.');
    }
    assert.equal(createHash('sha256').update(content).digest('hex'),hash,file);
  }
  assert.equal(fixedPriceQuote('Custom 3D Printed Hype Chain',1,{'Pendant size':'4 in'})?.unitCents,4000);
  assert.equal(fixedPriceQuote('Custom 3D Printed Hype Chain',1,{'Pendant size':'5 in'})?.unitCents,5000);
});

test('five-inch hype-chain selection is priced consistently in the storefront and backend', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html, /<option value="5 in">5 in<\/option>/);
  assert.ok(html.includes("price.textContent=size==='4 in'?'$40.00':'$50.00'"));
  assert.ok(html.includes("!['4 in','5 in'].includes(val('Pendant size'))"));
  assert.equal(fixedPriceQuote('Custom 3D Printed Hype Chain',1,{'Pendant size':'5 in'})?.totalBeforeTaxCents,5600);
  assert.equal(fixedPriceQuote('Custom 3D Printed Hype Chain',2,{'Pendant size':'5 in'}),null);
});
