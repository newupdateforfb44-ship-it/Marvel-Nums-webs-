/**
 * lib/flw-methods.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The exact Flutterwave payment options this merchant account is APPROVED for,
 * mapped per market. Anything that is still "Pending review" on the Flutterwave
 * dashboard is deliberately absent — offering it would only fail at checkout.
 *
 * Live rails on this account:
 *   Cards (local + international) ............ worldwide
 *   Bank Transfer — Nigeria (virtual account) . Nigeria only
 *   Pay With Bank — Nigeria ................... Nigeria only
 *   Pay With Bank — UK and EU ................. UK / EU
 *   USSD, NQR, OPay, eNaira ................... Nigeria only
 *   Apple Pay ................................. worldwide
 *   Mobile Money (GH, KE, UG, TZ, RW, MW) ..... local currency only
 *
 * Not live (pending review / disabled): Bank Transfer Ghana, Momo Zambia,
 * Momo Francophone XOF & XAF, Pay With Bank South Africa, Google Pay, PayPal.
 */

/** Markets where Flutterwave has approved us to open dedicated virtual accounts. */
const VIRTUAL_ACCOUNT_COUNTRIES = ['NG'];

/** UK + EU markets covered by the approved "Pay With Bank — UK and EU" rail. */
const UK_EU = [
  'GB', 'IE', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'PT', 'AT', 'SE', 'DK', 'FI',
  'PL', 'CZ', 'GR', 'HU', 'RO', 'SK', 'SI', 'HR', 'BG', 'EE', 'LV', 'LT', 'LU',
  'MT', 'CY', 'NO', 'IS', 'LI',
];

/** Mobile-money markets that are live (not pending) on this account. */
const MOMO = {
  GH: 'mobilemoneyghana',
  KE: 'mpesa',
  UG: 'mobilemoneyuganda',
  TZ: 'mobilemoneytanzania',
  RW: 'mobilemoneyrwanda',
  MW: 'mobilemoneymalawi',
};

/** True when we may create a Flutterwave virtual account for this country. */
function supportsVirtualAccount(code) {
  return VIRTUAL_ACCOUNT_COUNTRIES.includes(String(code || '').toUpperCase());
}

/**
 * Flutterwave `payment_options` string for a checkout.
 * Nigeria is charged in NGN and gets the full local stack; every other market
 * is charged in USD, which only cards and Apple Pay can settle — plus the
 * approved UK/EU bank rail where it applies.
 */
function paymentOptionsFor(code, currency) {
  const c = String(code || '').toUpperCase();
  const cur = String(currency || 'USD').toUpperCase();

  if (c === 'NG' && cur === 'NGN') {
    return 'card,banktransfer,ussd,account,opay,nqr,enaira';
  }
  const opts = ['card', 'applepay'];
  if (UK_EU.includes(c)) opts.push('account');
  return opts.join(',');
}

/** Human-readable list of what a country can actually use — for the UI. */
function describeFor(code) {
  const c = String(code || '').toUpperCase();
  if (c === 'NG') {
    return ['Dedicated virtual account (bank transfer)', 'Cards', 'Pay with Bank', 'USSD', 'NQR', 'OPay', 'eNaira'];
  }
  const list = ['International cards (Visa, Mastercard)', 'Apple Pay'];
  if (UK_EU.includes(c)) list.push('Pay with Bank (UK & EU)');
  if (MOMO[c]) list.push('Mobile Money is available at checkout in local currency where supported');
  return list;
}

module.exports = {
  VIRTUAL_ACCOUNT_COUNTRIES,
  UK_EU,
  MOMO,
  supportsVirtualAccount,
  paymentOptionsFor,
  describeFor,
};
