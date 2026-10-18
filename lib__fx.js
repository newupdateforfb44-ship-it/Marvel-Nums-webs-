/**
 * lib/fx.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Live foreign-exchange rates for multi-currency deposits.
 *
 * The King Social Hub ledger is denominated in NGN. Anyone in the world may pay in their
 * own currency; this module converts what they pay into the NGN that lands in
 * their wallet (and the other way round for display).
 *
 * Rates come from open.er-api.com (free, no key, ~24h refresh) and are cached
 * in memory for FX_CACHE_MINUTES. If the network call fails we fall back to a
 * conservative built-in table so deposits never hard-fail.
 */
const axios = require('axios');

const CACHE_MINUTES = Number(process.env.FX_CACHE_MINUTES || 30);
/** Spread applied in King Social Hub's favour so FX drift between quote and settlement never costs the platform. */
const SPREAD = Number(process.env.FX_SPREAD || 0.015);

/** Fallback: units of currency per 1 USD. Only used when the rate API is unreachable. */
const FALLBACK_PER_USD = {
  USD: 1, NGN: 1550, GHS: 15.2, KES: 129, ZAR: 18.2, UGX: 3750, TZS: 2600, RWF: 1330,
  XOF: 605, XAF: 605, EGP: 48.5, MAD: 9.9, ZMW: 26.5, EUR: 0.92, GBP: 0.78, CAD: 1.37,
  AUD: 1.52, INR: 84, AED: 3.67, SAR: 3.75, BRL: 5.6, MXN: 18.5, PHP: 58, IDR: 15800,
  MYR: 4.5, SGD: 1.34, CNY: 7.2, JPY: 152, TRY: 34.5, PKR: 278, BDT: 120,
};

let cache = { at: 0, rates: null };

async function getRates() {
  const fresh = cache.rates && Date.now() - cache.at < CACHE_MINUTES * 60_000;
  if (fresh) return cache.rates;
  try {
    const r = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 8000 });
    const rates = r.data && r.data.rates;
    if (rates && rates.NGN) {
      cache = { at: Date.now(), rates };
      return rates;
    }
    throw new Error('malformed rate payload');
  } catch (e) {
    console.warn('[fx] live rates unavailable, using fallback table:', e.message);
    cache = { at: Date.now() - (CACHE_MINUTES - 5) * 60_000, rates: { ...FALLBACK_PER_USD } };
    return cache.rates;
  }
}

function isSupported(rates, code) {
  return Boolean(rates[String(code || '').toUpperCase()]);
}

/** Raw mid-market conversion, no spread. */
async function convert(amount, from, to) {
  const rates = await getRates();
  const f = rates[String(from).toUpperCase()];
  const t = rates[String(to).toUpperCase()];
  if (!f || !t) throw new Error(`Unsupported currency pair ${from}->${to}`);
  return (Number(amount) / f) * t;
}

/**
 * How much foreign currency the customer must pay to have `ngnAmount`
 * credited to their NGN wallet (spread included, rounded up sensibly).
 */
async function quoteChargeForNgn(ngnAmount, currency) {
  const cur = String(currency || 'NGN').toUpperCase();
  if (cur === 'NGN') return { currency: 'NGN', amount: round(ngnAmount, 'NGN'), rate: 1, spread: 0 };
  const raw = await convert(ngnAmount, 'NGN', cur);
  const withSpread = raw * (1 + SPREAD);
  const rates = await getRates();
  return {
    currency: cur,
    amount: round(withSpread, cur),
    rate: rates[cur] / rates.NGN, // 1 NGN = rate <cur>
    spread: SPREAD,
  };
}

/** How much NGN to credit for a payment that actually settled in `currency`. */
async function ngnCreditForPayment(amount, currency) {
  const cur = String(currency || 'NGN').toUpperCase();
  if (cur === 'NGN') return Number(amount);
  const raw = await convert(amount, cur, 'NGN');
  return Math.floor(raw / (1 + SPREAD));
}

const ZERO_DECIMAL = ['NGN', 'JPY', 'UGX', 'RWF', 'XOF', 'XAF', 'KRW', 'VND', 'CLP', 'IDR', 'TZS'];
function round(value, currency) {
  const cur = String(currency).toUpperCase();
  if (ZERO_DECIMAL.includes(cur)) return Math.ceil(value);
  return Math.ceil(value * 100) / 100;
}

function format(amount, currency, locale) {
  const cur = String(currency || 'NGN').toUpperCase();
  try {
    return new Intl.NumberFormat(locale || 'en', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: ZERO_DECIMAL.includes(cur) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${cur}`;
  }
}

module.exports = { getRates, convert, quoteChargeForNgn, ngnCreditForPayment, format, round, isSupported, SPREAD };
