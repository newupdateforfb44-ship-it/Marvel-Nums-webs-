/**
 * lib/countries.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Worldwide country registry used by King Social Hub for:
 *   • phone-number country pickers (dial codes, searchable names, flags)
 *   • local currency resolution / display
 *   • which deposit methods are offered to a visitor from that country
 *
 * The raw dataset (countries.data.json) is ISO-3166-1 alpha-2 based and holds
 * { c: code, n: english name, d: dial code, cur: ISO-4217 currency }.
 */
const RAW = require('./countries.data.json');

/** Turn "NG" into the 🇳🇬 regional-indicator emoji. */
function flagEmoji(code) {
  return String(code)
    .toUpperCase()
    .replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

/**
 * Deposit methods per market.
 *  - card        : available everywhere Flutterwave accepts cards
 *  - banktransfer: Nigerian dedicated virtual accounts
 *  - mobilemoney : African mobile-money rails (MTN, M-Pesa, Airtel …)
 *  - opay/ussd   : Nigeria only
 */
const NG = ['banktransfer', 'paymentlink'];
const MOBILE_MONEY_MARKETS = ['GH', 'KE', 'UG', 'TZ', 'RW', 'ZM', 'CM', 'CI', 'SN', 'BF', 'ML', 'MW', 'CD'];
const CARD_FIRST_MARKETS = ['ZA', 'EG', 'MA', 'GB', 'US', 'CA', 'AU', 'NZ', 'IE', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'PT', 'SE', 'NO', 'DK', 'FI', 'PL', 'AE', 'SA', 'QA', 'IN', 'SG', 'MY', 'PH', 'ID', 'BR', 'MX', 'AR', 'CL', 'CO'];

/** Markets that cannot be served at all (sanctions / provider restrictions). */
const BLOCKED = ['KP', 'IR', 'SY', 'CU'];

function methodsFor(code) {
  const c = String(code || '').toUpperCase();
  if (BLOCKED.includes(c)) return [];
  // Nigeria: dedicated virtual account (bank transfer) + payment link, in ₦.
  if (c === 'NG') return NG.slice();
  // Rest of the world: payment link only, always priced in US dollars.
  return ['paymentlink'];
}

/** Currency a customer from `code` actually pays in. NGN at home, USD everywhere else. */
function payCurrencyFor(code) {
  return String(code || '').toUpperCase() === 'NG' ? 'NGN' : 'USD';
}

const COUNTRIES = RAW.map(r => ({
  code: r.c,
  name: r.n,
  dialCode: '+' + r.d,
  flag: flagEmoji(r.c),
  currency: r.cur,
  methods: methodsFor(r.c),
  payCurrency: payCurrencyFor(r.c),
  blocked: BLOCKED.includes(r.c),
}));

const BY_CODE = new Map(COUNTRIES.map(c => [c.code, c]));
const BY_DIAL = COUNTRIES.slice().sort((a, b) => b.dialCode.length - a.dialCode.length);

function byCode(code) {
  return BY_CODE.get(String(code || '').toUpperCase()) || null;
}

/** Best-effort country match for a full international phone number. */
function byPhone(phone) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  if (!p.startsWith('+')) return null;
  return BY_DIAL.find(c => p.startsWith(c.dialCode)) || null;
}

/** Case/diacritic-insensitive search over name, code and dial code. */
function search(term, limit = 40) {
  const q = String(term || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!q) return COUNTRIES.slice(0, limit);
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const starts = [];
  const contains = [];
  for (const c of COUNTRIES) {
    const n = norm(c.name);
    if (n.startsWith(q) || norm(c.code) === q || c.dialCode.replace('+', '').startsWith(q.replace('+', ''))) starts.push(c);
    else if (n.includes(q)) contains.push(c);
  }
  return starts.concat(contains).slice(0, limit);
}

/**
 * Validate + normalise a phone number to E.164 using the selected country.
 * Returns '' when the number cannot be trusted.
 */
function normalizePhone(countryCode, rawNumber) {
  const country = byCode(countryCode);
  if (!country) return '';
  let digits = String(rawNumber || '').replace(/[^\d]/g, '');
  const dial = country.dialCode.replace('+', '');
  if (digits.startsWith('00' + dial)) digits = digits.slice(2);
  if (digits.startsWith(dial) && digits.length > dial.length + 5) digits = digits.slice(dial.length);
  digits = digits.replace(/^0+/, '');
  if (digits.length < 5 || digits.length > 14) return '';
  return '+' + dial + digits;
}

module.exports = { COUNTRIES, byCode, byPhone, search, methodsFor, payCurrencyFor, normalizePhone, flagEmoji, BLOCKED };
