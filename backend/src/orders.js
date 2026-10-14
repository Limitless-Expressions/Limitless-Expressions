import {catalog} from './catalog.js';
import {fixedPriceQuote} from './pricing.js';
import {HttpError, digest} from './security.js';

export const MAX_FILE = 5 * 1024 * 1024;
export const MAX_REQUEST = 16 * 1024 * 1024;
export const NFC_PRODUCT = 'Custom 3D NFC Keychain / Keytag';
export function validateDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) throw new HttpError(400, 'Invalid order.');
  const product = catalog.find(p => p.name === details.product && !p.comingSoon);
  if (!product) throw new HttpError(400, 'This product is not available for orders.');
  if (!Number.isInteger(details.quantity) || details.quantity < 1 || details.quantity > 1000) throw new HttpError(400, 'Quantity must be a whole number from 1 to 1000.');
  if (!/^[a-f0-9]{64}$/.test(details.accessToken || '')) throw new HttpError(400, 'Invalid order access token.');
  const customerName = String(details.customerName || '').trim();
  const customerEmail = String(details.customerEmail || '').trim().toLowerCase();
  if (customerName.length < 2 || customerName.length > 120 || /[\r\n]/.test(customerName)) throw new HttpError(400, 'Enter your name.');
  if (customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new HttpError(400, 'Enter a valid email address.');
  if (!details.customization || typeof details.customization !== 'object' || Array.isArray(details.customization)) throw new HttpError(400, 'Invalid customization.');
  const allowed = product.fields.filter(f => !/upload/i.test(f) && f !== 'Quantity');
  if (Object.keys(details.customization).some(f => !allowed.includes(f))) throw new HttpError(400, 'Unknown customization field.');
  const customization = {};
  for (const field of allowed) {
    const value = details.customization[field] ?? '';
    if (typeof value !== 'string' || value.length > 4000) throw new HttpError(400, 'Customization is too long.');
    customization[field] = value.trim();
  }
  if (product.name === NFC_PRODUCT) {
    if (!['2 in','3 in'].includes(customization['Keytag size'])) throw new HttpError(400, 'Choose a keytag size.');
    try {
      const url = new URL(customization['NFC destination URL']);
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error();
    } catch { throw new HttpError(400, 'Enter a complete http or https NFC destination URL.'); }
  }
  const pricingSnapshot = product.price;
  return {product:product.name, quantity:details.quantity, customerName, customerEmail, customization, pricingSnapshot,
    eligible:!!fixedPriceQuote(product.name, details.quantity, customization)};
}
export async function validateArtwork(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || file.size < 1 || file.size > MAX_FILE) throw new HttpError(400, 'Each artwork file must be 1 byte to 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const starts = pattern => pattern.every((v,i) => bytes[i] === v);
  let type;
  if (starts([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) type = 'image/png';
  else if (starts([0xff,0xd8,0xff])) type = 'image/jpeg';
  else if (new TextDecoder().decode(bytes.slice(0,6)).match(/^GIF8[79]a$/)) type = 'image/gif';
  else if (new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP') type = 'image/webp';
  else if (new TextDecoder().decode(bytes.slice(0,5)) === '%PDF-') type = 'application/pdf';
  else if (/\.svg$/i.test(file.name) && /<svg(?:\s|>)/i.test(new TextDecoder().decode(bytes.slice(0,4096)))) type = 'image/svg+xml';
  else throw new HttpError(400, 'Supported artwork: PNG, JPEG, GIF, WebP, PDF or SVG.');
  // SVG/PDF are untrusted originals: private storage and attachment downloads only, never inline rendering.
  const filename = file.name.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,120) || 'artwork';
  return {bytes, type, filename, hash:await digest(bytes)};
}
