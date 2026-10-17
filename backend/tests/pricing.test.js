import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedPriceQuote} from '../src/pricing.js';

test('known small products have server-owned prices and one $6 shipping charge', () => {
  assert.deepEqual(fixedPriceQuote('Custom 3D NFC Keychain / Keytag', 1, {'Keytag size':'2 in'}), {
    currency:'usd', quantity:1, unitCents:1500, subtotalCents:1500, shippingCents:600, totalBeforeTaxCents:2100
  });
  assert.equal(fixedPriceQuote('Custom 3D NFC Keychain / Keytag', 5, {'Keytag size':'3 in'}).subtotalCents, 5000);
  assert.equal(fixedPriceQuote('Custom 3D NFC Keychain / Keytag', 10, {'Keytag size':'2 in'}), null);
  assert.equal(fixedPriceQuote('Custom 3D Printed Hype Chain', 1, {'Pendant size':'4 in'}).subtotalCents, 4000);
  assert.equal(fixedPriceQuote('3D Printed Google Review NFC Display', 1).subtotalCents, 3500);
  assert.equal(fixedPriceQuote('Custom 3D Printed Name / Desk Plate', 1).subtotalCents, 3500);
  assert.equal(fixedPriceQuote('Custom Name / Initial Sign', 1).subtotalCents, 2500);
});
test('ambiguous quantities, large items, and unpriced variants never get automatic prices', () => {
  for (const q of [2,3,4,6,7,8,9]) assert.equal(fixedPriceQuote('Custom 3D NFC Keychain / Keytag', q, {'Keytag size':'2 in'}), null);
  assert.equal(fixedPriceQuote('Custom 3D NFC Keychain / Keytag', 1, {}), null);
  assert.equal(fixedPriceQuote('Custom 3D Printed Hype Chain', 1, {'Pendant size':'5 in'}), null);
  assert.equal(fixedPriceQuote('Custom 3D Printed Name Light Box', 1), null);
  assert.equal(fixedPriceQuote('Custom 3D Printed Neon Name Sign', 1), null);
  assert.equal(fixedPriceQuote('Custom Business Logo / Sign', 1), null);
  assert.equal(fixedPriceQuote('Custom Name / Initial Sign', 2), null);
  assert.equal(fixedPriceQuote('Custom Name / Initial Sign', 0), null);
});
