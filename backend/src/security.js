export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
export async function digest(value) {
  return hex(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value));
}
export async function equalSecrets(a, b) {
  if (!a || !b) return false;
  const left = await digest(a), right = await digest(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}
export async function readLimited(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413, 'Request too large.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), parts = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Request too large.'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
export async function verifyStripeSignature(body, signature, secret, now = Date.now()) {
  if (!secret || secret.includes('REPLACE')) throw new HttpError(503, 'Webhook is not configured.');
  const parts = (signature || '').split(',').map(p => p.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 't');
  const timestamp = Number(timestamps[0]?.[1]);
  if (timestamps.length !== 1 || !Number.isInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300)
    throw new HttpError(400, 'Invalid webhook signature.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
  const signed = new TextEncoder().encode(`${timestamp}.${body}`);
  for (const [version, value] of parts) {
    if (version !== 'v1' || !/^[a-f0-9]{64}$/i.test(value || '')) continue;
    const bytes = Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, signed)) return;
  }
  throw new HttpError(400, 'Invalid webhook signature.');
}
export function configured(value) { return !!value && !/REPLACE|example\.invalid/.test(value); }
export function json(value, status = 200) {
  return new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
