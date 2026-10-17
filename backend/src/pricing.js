// Server-owned checkout pricing. Never trust amounts supplied by the storefront.
// Only known fixed-price, small-package orders qualify for $6 shipping.
// A missing rule means quote/review required, NOT a zero-dollar checkout.
export const SMALL_ORDER_SHIPPING_CENTS = 600;
export function fixedPriceQuote(product, quantity, customization = {}) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) return null;
  let unitCents;
  switch (product) {
    case 'Custom 3D NFC Keychain / Keytag':
      if (!['2 in', '3 in'].includes(customization['Keytag size'])) return null;
      if (quantity === 1) unitCents = 1500;
      else if (quantity === 5) unitCents = 1000;
      else if (quantity >= 10) return null; // Bulk shipping needs a separate approved rate.
      else return null; // No published checkout price for 2–4 or 6–9.
      break;
    case 'Custom 3D Printed Hype Chain':
      if (quantity !== 1 || !['4 in', '4"'].includes(customization['Pendant size'])) return null;
      unitCents = 4000;
      break;
    case '3D Printed Google Review NFC Display':
      if (quantity !== 1) return null;
      unitCents = 3500;
      break;
    case 'Custom 3D Printed Name / Desk Plate':
      if (quantity !== 1) return null;
      unitCents = 3500;
      break;
    case 'Custom Name / Initial Sign':
      if (quantity !== 1) return null;
      unitCents = 2500;
      break;
    // Light boxes and larger signage need packaged shipping reviewed first.
    default:
      return null;
  }
  const subtotalCents = unitCents * quantity;
  if (!Number.isSafeInteger(subtotalCents)) return null;
  return Object.freeze({
    currency: 'usd', quantity, unitCents, subtotalCents,
    shippingCents: SMALL_ORDER_SHIPPING_CENTS,
    totalBeforeTaxCents: subtotalCents + SMALL_ORDER_SHIPPING_CENTS
  });
}
