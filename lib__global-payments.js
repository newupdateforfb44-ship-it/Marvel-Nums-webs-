/**
 * lib/global-payments.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything that makes King Social Hub usable outside Nigeria:
 *
 *   1. A worldwide country/dial-code/currency directory for the UI.
 *   2. Currency quoting for every deposit method.
 *   3. Per-user locale (country, language, currency, international phone).
 *
 * DEPOSIT RAILS
 * ─────────────
 *   Nigeria      → dedicated virtual account + payment link, priced in ₦
 *   Everywhere   → payment link only, priced in US dollars ($)
 *
 * Virtual accounts are hard-limited to the markets Flutterwave has approved on
 * this merchant account (see lib/flw-methods.js) — today that is Nigeria only.
 */
const fx = require('./fx');
const countries = require('./countries');
const flwMethods = require('./flw-methods');

module.exports = function mountGlobalPayments(ctx) {
  const { app, express, User, auth, SystemError } = ctx;

  // The operational layer (settings + webhook ledger) is mounted after this
  // module, so it is injected later via setPlatform().
  let platform = null;
  function setPlatform(p) { platform = p; }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════
  const MIN_NGN = Number(process.env.MIN_DEPOSIT_NGN || 100);

  function detectCountry(req) {
    const hdr = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'] || '';
    const code = String(hdr).toUpperCase();
    return countries.byCode(code) ? code : '';
  }

  async function logError(source, message, detail, context) {
    try { if (SystemError) await SystemError.create({ source, message, detail: String(detail).slice(0, 4000), context }); }
    catch { /* logging must never break a payment path */ }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. INTERNATIONAL DIRECTORY
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/intl/countries — full searchable directory (cached hard, it never changes). */
  app.get('/api/intl/countries', (req, res) => {
    const { q, limit } = req.query;
    const list = q ? countries.search(q, Number(limit) || 40) : countries.COUNTRIES;
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ count: list.length, countries: list });
  });

  /** GET /api/intl/detect — best-effort country + currency for a first-time visitor. */
  app.get('/api/intl/detect', (req, res) => {
    const code = detectCountry(req) || 'NG';
    const country = countries.byCode(code);
    res.json({ country: country ? country.code : 'NG', currency: country ? country.currency : 'NGN', detected: Boolean(detectCountry(req)), data: country });
  });

  /** GET /api/intl/rates — live FX table (NGN base) for client-side price display. */
  app.get('/api/intl/rates', async (req, res) => {
    try {
      const rates = await fx.getRates();
      const ngnPerUsd = rates.NGN;
      const out = {};
      for (const [cur, perUsd] of Object.entries(rates)) out[cur] = perUsd / ngnPerUsd; // 1 NGN = out[cur]
      res.set('Cache-Control', 'public, max-age=600');
      res.json({ base: 'NGN', spread: fx.SPREAD, rates: out });
    } catch (e) {
      res.status(503).json({ error: 'Exchange rates are temporarily unavailable' });
    }
  });

  /** GET /api/intl/methods?country=GH — which deposit rails that market can use. */
  app.get('/api/intl/methods', async (req, res) => {
    const code = String(req.query.country || detectCountry(req) || 'NG').toUpperCase();
    const country = countries.byCode(code);
    if (!country) return res.status(400).json({ error: 'Unknown country code' });
    const payCurrency = countries.payCurrencyFor(country.code);
    let localMin = null;
    try { localMin = await fx.quoteChargeForNgn(MIN_NGN, payCurrency); } catch { /* non-fatal */ }
    res.json({
      country: country.code,
      currency: country.currency,
      blocked: country.blocked,
      methods: country.methods,
      payCurrency,
      virtualAccount: flwMethods.supportsVirtualAccount(country.code),
      checkoutMethods: flwMethods.describeFor(country.code),
      minimumDeposit: { ngn: MIN_NGN, local: localMin },
    });
  });

  /**
   * Flat deposit service charge in naira. Mirrors calcDepositFee() in server.js
   * so international quotes and local deposits always agree.
   */
  function depositFee(creditNgn) {
    if (creditNgn >= 100 && creditNgn <= 499) return 10;
    if (creditNgn >= 500 && creditNgn <= 999) return 20;
    if (creditNgn >= 1000 && creditNgn <= 9999) return 50;
    if (creditNgn >= 10000) return 100;
    return 0;
  }

  /** POST /api/intl/quote { ngnAmount, currency } — what the customer will actually be charged. */
  app.post('/api/intl/quote', express.json(), async (req, res) => {
    try {
      const ngnAmount = Number(req.body && req.body.ngnAmount);
      const currency = String((req.body && req.body.currency) || 'NGN').toUpperCase();
      if (!ngnAmount || ngnAmount < MIN_NGN) return res.status(400).json({ error: `Minimum deposit is ₦${MIN_NGN}` });
      // Customers outside Nigeria pay the same flat service charge as local
      // deposits — it is added on top of the amount so the wallet is credited
      // with the full naira value they asked for.
      const fee = depositFee(ngnAmount);
      const quote = await fx.quoteChargeForNgn(ngnAmount + fee, currency);
      res.json({
        ngnAmount, feeNgn: fee, ...quote,
        display: fx.format(quote.amount, quote.currency),
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. USER LOCALE
  // ══════════════════════════════════════════════════════════════════════════

  /** PATCH /api/me/locale — country, language, display currency and phone number. */
  app.patch('/api/me/locale', auth, express.json(), async (req, res) => {
    try {
      const { country, language, currency, phone } = req.body || {};
      const update = {};
      if (country) {
        const c = countries.byCode(country);
        if (!c) return res.status(400).json({ error: 'Unknown country' });
        if (c.blocked) return res.status(403).json({ error: 'We are unable to serve customers in this country.' });
        update.country = c.code;
        if (!currency) update.displayCurrency = c.currency;
      }
      if (currency) update.displayCurrency = String(currency).toUpperCase();
      if (language) update.language = String(language).slice(0, 8).toLowerCase();
      if (phone !== undefined) {
        const code = country || (await User.findById(req.user._id).lean()).country || 'NG';
        const normalized = countries.normalizePhone(code, phone);
        if (phone && !normalized) return res.status(400).json({ error: 'That phone number is not valid for the selected country' });
        update.contactPhone = normalized;
      }
      const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true });
      res.json({
        ok: true,
        country: user.country || '',
        language: user.language || 'en',
        currency: user.displayCurrency || 'NGN',
        phone: user.contactPhone || '',
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return { setPlatform, logError };
};
