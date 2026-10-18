/**
 * lib/boost.js
 * ─────────────────────────────────────────────────────────────────────────────
 * SOCIAL MEDIA BOOSTING (SMM) — powered by the Really Simple Social panel.
 *
 * PROVIDER API (documented at https://reallysimplesocial.com/api)
 *   POST https://reallysimplesocial.com/api/v2   (form-encoded, JSON response)
 *     key=<api key>&action=services                    → service catalogue
 *     key=…&action=add&service=&link=&quantity=        → { order: 23501 }
 *     key=…&action=status&order=                       → { charge, start_count, status, remains, currency }
 *     key=…&action=status&orders=1,2,3                 → keyed map of the above
 *     key=…&action=refill&order=                       → { refill: "1" }
 *     key=…&action=cancel&orders=1,2                   → [{ order, cancel }]
 *     key=…&action=balance                             → { balance, currency }
 *
 *   Provider prices ("rate") are per 1000 units in the panel currency (USD by
 *   default). King Social Hub sells in NGN: cost = rate × qty / 1000 × usdRate, then a flat
 *   profit is added from the quantity tier table below.
 *
 * SAFETY
 *   Every route lives under /api/boost and /api/admin/boost, so nothing in this
 *   module can shadow an existing endpoint. The whole feature is behind an
 *   admin on/off switch (BoostSettings.enabled) and, when the switch is off or
 *   the API key is missing, the pages render a friendly "coming soon" state
 *   instead of erroring.
 *
 * Mounted from server.js once every shared model exists.
 */
const axios = require('axios');
const fx = require('./fx');

const PROVIDER_URL = process.env.BOOST_API_URL || 'https://reallysimplesocial.com/api/v2';

/** Default profit markup (NGN) by ordered quantity — editable from the admin panel. */
const DEFAULT_TIERS = [
  { upTo: 500, profit: 350 },     //      1 –    500  → +₦350
  { upTo: 1000, profit: 450 },    //    501 –  1,000  → +₦450
  { upTo: 5000, profit: 700 },    //  1,001 –  5,000  → +₦700
  { upTo: 10000, profit: 1200 },  //  5,001 – 10,000  → +₦1,200
  { upTo: 20000, profit: 2000 },  // 10,001 – 20,000  → +₦2,000
  { upTo: 0, profit: 2000 },      // upTo 0 = "everything above the previous tier"
];

/** Bump this whenever DEFAULT_TIERS changes so saved settings pick the new table
 *  up once. Admin edits after that are always preserved (tiersVersion is stored). */
const TIERS_VERSION = 2;

/** Provider status → the three buckets the history page filters on. */
function bucketFor(status) {
  const s = String(status || '').toLowerCase();
  if (['completed', 'complete', 'delivered'].includes(s)) return 'delivered';
  if (['canceled', 'cancelled', 'refunded', 'failed', 'error'].includes(s)) return 'failed';
  return 'pending'; // pending, processing, in progress, partial
}

module.exports = function mountBoost(ctx) {
  const { app, mongoose, User, Transaction, auth, anyAdminAuth, SystemError } = ctx;
  // Optional: header-based API-key auth (X-API-Key / X-API-Secret) from server.js.
  // When present it unlocks the public /api/v1/boost/* endpoints for third-party developers.
  const apiKeyAuth = ctx.apiKeyAuth || null;

  // ══════════════════════════════════════════════════════════════════════════
  // MODELS
  // ══════════════════════════════════════════════════════════════════════════
  const settingsSchema = new mongoose.Schema({
    _id: { type: String, default: 'singleton' },
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' },
    apiUrl: { type: String, default: PROVIDER_URL },
    // 0 = use the live FX rate from lib/fx. Any other value pins the NGN price of $1.
    usdRate: { type: Number, default: 0 },
    // Currency the provider panel prices in. Really Simple Social bills in NGN,
    // so no FX conversion is applied unless this says otherwise.
    providerCurrency: { type: String, default: 'NGN' },
    tiers: { type: Array, default: DEFAULT_TIERS },
    tiersVersion: { type: Number, default: 0 },
    disabledMessage: { type: String, default: 'Boosting is under maintenance right now. We are upgrading the service — please check back shortly.' },
    envBootstrapped: { type: Boolean, default: false },
    adminTouchedEnabled: { type: Boolean, default: false },
    webhookSecret: { type: String, default: '' },
    lastWebhookAt: { type: Date },
    lastSyncAt: { type: Date },
    lastSyncCount: { type: Number, default: 0 },   // services returned by the provider
    lastSyncStored: { type: Number, default: 0 },  // services stored locally afterwards
    lastSyncMs: { type: Number, default: 0 },
    lastSyncBy: { type: String, default: '' },     // 'schedule' | 'admin:<email>' | 'auto-heal'
    lastProviderBalance: { type: Number, default: null },
    lastProviderBalanceAt: { type: Date, default: null },
    lastSyncOk: { type: Boolean, default: false },
    lastError: { type: String, default: '' },
    lastErrorAt: { type: Date },
    syncHistory: { type: Array, default: [] },     // last 25 runs, newest first
    autoSyncHours: { type: Number, default: Number(process.env.BOOST_SYNC_HOURS || 6) },
    updatedAt: { type: Date, default: Date.now },
  }, { _id: false });
  const BoostSettings = mongoose.models.BoostSettings || mongoose.model('BoostSettings', settingsSchema);

  /** Audit trail — every enable/disable toggle and every profit-table edit. */
  const auditSchema = new mongoose.Schema({
    action: { type: String, default: '' },     // 'enabled' | 'disabled' | 'tiers' | 'settings' | 'sync'
    summary: { type: String, default: '' },
    before: { type: Object },
    after: { type: Object },
    actor: { type: String, default: '' },      // admin email / name
    ip: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
  });
  const BoostAudit = mongoose.models.BoostAudit || mongoose.model('BoostAudit', auditSchema);

  /** Per-customer favourite services (powers the "Favorite services" category). */
  const favoriteSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  });
  favoriteSchema.index({ userId: 1, serviceId: 1 }, { unique: true });
  const BoostFavorite = mongoose.models.BoostFavorite || mongoose.model('BoostFavorite', favoriteSchema);

  function actorOf(req) {
    const u = (req && (req.admin || req.user)) || {};
    return String(u.email || u.name || u.username || 'admin');
  }
  async function audit(req, action, summary, before, after) {
    try {
      await BoostAudit.create({
        action, summary,
        before: before || undefined,
        after: after || undefined,
        actor: actorOf(req),
        ip: String((req && (req.headers['x-forwarded-for'] || req.ip)) || '').split(',')[0].trim(),
      });
    } catch { /* auditing must never block an admin action */ }
  }


  const serviceSchema = new mongoose.Schema({
    serviceId: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    category: { type: String, default: '', index: true },
    platform: { type: String, default: 'Other', index: true },
    type: { type: String, default: 'Default' },
    rate: { type: Number, default: 0 },      // provider price per 1000, in provider currency
    min: { type: Number, default: 1 },
    max: { type: Number, default: 1000 },
    refill: { type: Boolean, default: false },
    cancel: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },   // visible to customers
    description: { type: String, default: '' },  // admin-written, shown on the card
    deliveryTime: { type: String, default: '' }, // e.g. "0–6 hours"
    sortOrder: { type: Number, default: 0 },
    syncedAt: { type: Date, default: Date.now },
  });
  const BoostService = mongoose.models.BoostService || mongoose.model('BoostService', serviceSchema);

  const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceId: { type: String, default: '' },
    serviceName: { type: String, default: '' },
    platform: { type: String, default: '' },
    category: { type: String, default: '' },
    link: { type: String, default: '' },
    quantity: { type: Number, default: 0 },
    price: { type: Number, default: 0 },   // NGN charged to the wallet
    cost: { type: Number, default: 0 },    // NGN cost from the provider
    profit: { type: Number, default: 0 },  // NGN markup kept by King Social Hub
    providerOrderId: { type: String, default: '', index: true },
    status: { type: String, default: 'Pending' },      // provider wording
    bucket: { type: String, default: 'pending', index: true }, // pending | delivered | failed
    startCount: { type: Number, default: 0 },
    remains: { type: Number, default: 0 },
    deliveryTime: { type: String, default: '' },
    note: { type: String, default: '' },
    refunded: { type: Boolean, default: false },
    refundAmount: { type: Number, default: 0 },      // NGN actually returned to the wallet
    cancelSupported: { type: Boolean, default: false }, // provider allows action=cancel
    canceledAt: { type: Date },
    deliveredAtCancel: { type: Number, default: 0 }, // units already delivered when cancelled
    lastSyncAt: { type: Date },
    createdAt: { type: Date, default: Date.now, index: true },
  });
  const BoostOrder = mongoose.models.BoostOrder || mongoose.model('BoostOrder', orderSchema);

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS + PRICING
  // ══════════════════════════════════════════════════════════════════════════
  let cachedSettings = null;
  let cachedAt = 0;
  async function getSettings(force) {
    if (!force && cachedSettings && Date.now() - cachedAt < 15000) return cachedSettings;
    let doc = await BoostSettings.findById('singleton');
    if (!doc) doc = await BoostSettings.create({ _id: 'singleton' });

    // ── .env bootstrap ───────────────────────────────────────────────────
    // The panel key (and, optionally, the on/off switch) can live in .env so a
    // fresh deployment works before anyone opens the admin panel. The admin
    // panel always wins once it has been used (adminTouchedEnabled).
    let dirty = false;
    const envKey = String(process.env.BOOST_API_KEY || '').trim();
    if (envKey && !doc.apiKey) { doc.apiKey = envKey; dirty = true; }
    const envUrl = String(process.env.BOOST_API_URL || '').trim();
    if (envUrl && !doc.apiUrl) { doc.apiUrl = envUrl; dirty = true; }
    const envSecret = String(process.env.BOOST_WEBHOOK_SECRET || '').trim();
    if (envSecret && doc.webhookSecret !== envSecret) { doc.webhookSecret = envSecret; dirty = true; }
    if (!doc.envBootstrapped && !doc.adminTouchedEnabled) {
      const flag = String(process.env.BOOST_ENABLED || '').trim().toLowerCase();
      // Default: if a key is present in .env, turn boosting on automatically.
      const wanted = flag ? ['1', 'true', 'yes', 'on'].includes(flag) : !!envKey;
      if (wanted && doc.apiKey) { doc.enabled = true; }
      doc.envBootstrapped = true;
      dirty = true;
    }
    // ── one-time profit-tier refresh ─────────────────────────────────────
    // Older installs stored the previous default table. Roll them forward once;
    // after that the admin panel is the only thing that writes tiers.
    if ((Number(doc.tiersVersion) || 0) < TIERS_VERSION) {
      doc.tiers = DEFAULT_TIERS.map(t => ({ ...t }));
      doc.tiersVersion = TIERS_VERSION;
      dirty = true;
    }

    if (dirty) { try { await doc.save(); } catch { /* non-fatal */ } }

    cachedSettings = doc;
    cachedAt = Date.now();
    return doc;
  }

  /**
   * Multiplier that turns one unit of the provider's currency into NGN.
   *
   * Really Simple Social prices and bills in NGN (action=balance returns
   * {"currency":"NGN"}), so the multiplier is 1 and the panel's "rate" is
   * already the naira price per 1000. Only a non-NGN panel triggers FX.
   */
  async function usdToNgn(settings) {
    const cur = String(settings.providerCurrency || 'NGN').toUpperCase();
    if (cur === 'NGN') return 1;
    if (settings.usdRate && settings.usdRate > 0) return settings.usdRate;
    try {
      const rates = await fx.getRates();
      if (rates && rates.NGN) return rates.NGN * (1 + fx.SPREAD);
    } catch { /* fall through to the conservative default below */ }
    return Number(process.env.BOOST_FALLBACK_USD_RATE || 1600);
  }

  function tiersOf(settings) {
    const t = Array.isArray(settings.tiers) && settings.tiers.length ? settings.tiers : DEFAULT_TIERS;
    return t.map(x => ({ upTo: Number(x.upTo) || 0, profit: Number(x.profit) || 0 }));
  }

  /** Flat NGN profit for a quantity, from the tier table. */
  function profitFor(quantity, settings) {
    const tiers = tiersOf(settings);
    for (const tier of tiers) {
      if (tier.upTo > 0 && quantity <= tier.upTo) return tier.profit;
    }
    const last = tiers[tiers.length - 1];
    return last ? last.profit : 0;
  }

  /** Cost + markup for a quantity. Rounded up to the nearest ₦10 so prices read cleanly. */
  function quoteFor(service, quantity, rate, settings) {
    const qty = Math.max(0, Math.floor(Number(quantity) || 0));
    const cost = (Number(service.rate) || 0) * (qty / 1000) * rate;
    const profit = profitFor(qty, settings);
    const price = Math.ceil((cost + profit) / 10) * 10;
    return {
      quantity: qty,
      cost: Math.round(cost * 100) / 100,
      profit,
      price,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROVIDER CLIENT
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Really Simple Social speaks ONE endpoint, form-encoded POST, JSON back:
   *   key=<api key>&action=<services|add|status|refill|refill_status|cancel|balance>&…
   * There are NO webhooks on this panel — order state is pulled with action=status
   * (see sweepOpenOrders below), which is why nothing here listens for callbacks.
   *
   * Failure modes handled:
   *   • network timeout / DNS / reset  → 1 automatic retry, then a friendly message
   *   • HTTP 5xx from the panel        → 1 automatic retry
   *   • HTML / empty body (Cloudflare, maintenance page) → readable message
   *   • { "error": "…" } JSON body     → mapped to plain English where we recognise it
   * Thrown errors carry .userMessage (safe to display) and .providerError (raw text).
   */
  const PROVIDER_ERROR_MAP = {
    'incorrect request': 'The request sent to the boosting provider was rejected. Please try a different service.',
    'invalid api key': 'The boosting API key is invalid. Update it in Admin → Boosting.',
    'incorrect api key': 'The boosting API key is invalid. Update it in Admin → Boosting.',
    'not enough funds': 'Boosting is temporarily paused (provider balance is empty). Please try again later.',
    'not enough funds in the balance': 'Boosting is temporarily paused (provider balance is empty). Please try again later.',
    'incorrect service id': 'That boosting service is no longer offered by our provider.',
    'incorrect link': 'That link is not accepted for this service — check the profile/post URL.',
    'incorrect quantity': 'That quantity is outside the allowed range for this service.',
    'the order id is incorrect': 'We could not find that order at the provider.',
    'incorrect order id': 'We could not find that order at the provider.',
    'no orders': 'There are no matching orders at the provider.',
  };

  function providerError(rawText, action) {
    const raw = String(rawText || '').trim();
    const friendly = PROVIDER_ERROR_MAP[raw.toLowerCase()] ||
      `The boosting provider rejected this request: ${raw || 'unknown error'}`;
    const err = new Error(friendly);
    err.userMessage = friendly;
    err.providerError = raw;
    err.action = action;
    return err;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function providerCall(action, params = {}, settings) {
    const s = settings || await getSettings();
    if (!s.apiKey) {
      const err = new Error('Boost provider API key is not set — add it in Admin → Boosting.');
      err.userMessage = 'Boosting is not configured yet. Please check back shortly.';
      throw err;
    }
    const url = s.apiUrl || PROVIDER_URL;
    const body = new URLSearchParams({ key: s.apiKey, action, ...params }).toString();

    let lastDetail = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await axios.post(url, body, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          timeout: 30000,
          // We parse ourselves so an HTML error page never explodes as a JSON crash.
          transformResponse: [d => d],
          validateStatus: () => true,
        });

        if (r.status >= 500) { lastDetail = `HTTP ${r.status}`; if (attempt === 1) { await sleep(800); continue; } break; }

        const text = String(r.data || '').trim();
        if (!text) { lastDetail = `empty body (HTTP ${r.status})`; if (attempt === 1) { await sleep(800); continue; } break; }

        let data;
        try { data = JSON.parse(text); }
        catch {
          lastDetail = `non-JSON reply: ${text.slice(0, 200)}`;
          logProviderError(`Boost provider "${action}" returned non-JSON`, lastDetail, params);
          const err = new Error('The boosting provider returned an unexpected response. Please try again shortly.');
          err.userMessage = err.message;
          throw err;
        }

        if (data && data.error) {
          logProviderError(`Boost provider "${action}" error`, String(data.error), params);
          throw providerError(data.error, action);
        }
        if (r.status >= 400) {
          lastDetail = `HTTP ${r.status}: ${text.slice(0, 200)}`;
          break;
        }
        return data;
      } catch (e) {
        if (e.userMessage) throw e;                       // already a clean, mapped error
        lastDetail = e.code ? `${e.code} ${e.message}` : e.message;
        if (attempt === 1) { await sleep(800); continue; }
      }
    }

    logProviderError(`Boost provider call "${action}" failed`, lastDetail, params);
    const err = new Error('The boosting provider is not responding right now — please try again shortly.');
    err.userMessage = err.message;
    err.providerError = lastDetail;
    throw err;
  }

  function logProviderError(message, detail, context) {
    try { if (SystemError) SystemError.create({ source: 'boost', message, detail: String(detail).slice(0, 4000), context }).catch(() => {}); }
    catch { /* logging must never break a purchase */ }
  }

  /** Guess a platform label from the provider's category/name so the UI can group services. */
  const PLATFORMS = [
    'Instagram', 'TikTok', 'Twitter', 'X', 'Facebook', 'YouTube', 'Telegram', 'WhatsApp',
    'Threads', 'Spotify', 'LinkedIn', 'Snapchat', 'Discord', 'Twitch', 'Reddit', 'Pinterest',
    'SoundCloud', 'Apple Music', 'Deezer', 'Shazam', 'Kick', 'Trustpilot', 'Google',
    'Audiomack', 'Boomplay', 'Website',
  ];
  function platformOf(text) {
    const t = String(text || '').toLowerCase();
    for (const p of PLATFORMS) if (t.includes(p.toLowerCase())) return p === 'X' ? 'Twitter' : p;
    return 'Other';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUSTOMER API
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/boost/config — is the feature live, and what does the pricing look like? */
  app.get('/api/boost/config', async (req, res) => {
    try {
      const s = await getSettings();
      res.json({
        enabled: !!s.enabled && !!s.apiKey,
        disabledMessage: s.disabledMessage,
        tiers: tiersOf(s),
      });
    } catch (e) { res.status(500).json({ error: 'Could not load boosting settings' }); }
  });

  // ── Catalogue response cache ─────────────────────────────────────────────
  // The shaped catalogue is identical for every customer (favourites are merged
  // per-request), so it is built once and reused for CATALOGUE_CACHE_MS. That
  // keeps /api/boost/services off the database on every page load and makes the
  // page open instantly while a background sync is running.
  const CATALOGUE_CACHE_MS = Math.max(5, Number(process.env.BOOST_CACHE_SECONDS || 120)) * 1000;
  let catalogueCache = null; // { at, payload }
  function invalidateCatalogueCache() { catalogueCache = null; }

  async function buildCatalogue(s) {
    if (catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_CACHE_MS) return catalogueCache.payload;
    const rate = await usdToNgn(s);
    const services = await BoostService.find({ enabled: true })
      .sort({ sortOrder: 1, platform: 1, name: 1 }).limit(5000).lean();
    const out = services.map(sv => {
      const per1000 = quoteFor(sv, Math.max(sv.min, 1000), rate, s);
      return {
        id: sv.serviceId,
        name: sv.name,
        platform: sv.platform,
        category: sv.category || sv.platform || 'Other',
        min: sv.min,
        max: sv.max,
        rate: Math.round((Number(sv.rate) || 0) * rate * 100) / 100, // provider cost per 1000, in NGN
        refill: sv.refill,
        cancel: sv.cancel,
        description: sv.description,
        deliveryTime: sv.deliveryTime || 'Usually starts within 0–6 hours',
        pricePer1000: per1000.price,
        startingPrice: quoteFor(sv, sv.min, rate, s).price,
      };
    });
    const payload = {
      services: out,
      platforms: [...new Set(out.map(o => o.platform))].sort(),
      categories: [...new Set(out.map(o => o.category))].sort(),
      tiers: tiersOf(s),
    };
    catalogueCache = { at: Date.now(), payload };
    return payload;
  }

  /** GET /api/boost/services — the customer-visible catalogue with NGN pricing. */
  app.get('/api/boost/services', auth, async (req, res) => {
    try {
      const s = await getSettings();
      if (!s.enabled || !s.apiKey) return res.json({ enabled: false, maintenance: true, message: s.disabledMessage || 'Boosting is under maintenance right now. Please check back shortly.', services: [], platforms: [] });
      // First visit after go-live: the catalogue may not have been pulled yet.
      try { await ensureCatalogue(s); } catch { /* the empty-state below explains it */ }
      const data = await buildCatalogue(s);
      if (!data.services.length) {
        return res.json({
          enabled: true,
          services: [],
          platforms: [],
          categories: [],
          message: 'The boosting catalogue is still loading from our provider. Please refresh in a moment.',
        });
      }
      const favs = new Set(
        (await BoostFavorite.find({ userId: req.user._id }, { serviceId: 1, _id: 0 }).lean()).map(f => String(f.serviceId))
      );
      res.json({
        enabled: true,
        ...data,
        services: data.services.map(sv => ({ ...sv, favorite: favs.has(sv.id) })),
        favorites: [...favs],
        syncedAt: s.lastSyncAt,
      });
    } catch (e) { res.status(500).json({ error: 'Could not load boosting services' }); }
  });

  /** GET /api/boost/favorites — ids only (used after a toggle). */
  app.get('/api/boost/favorites', auth, async (req, res) => {
    try {
      const favs = await BoostFavorite.find({ userId: req.user._id }, { serviceId: 1, _id: 0 }).lean();
      res.json({ favorites: favs.map(f => String(f.serviceId)) });
    } catch (e) { res.status(500).json({ error: 'Could not load your favourites' }); }
  });

  /** POST /api/boost/favorites { serviceId, favorite } — star / unstar a service. */
  app.post('/api/boost/favorites', auth, async (req, res) => {
    try {
      const serviceId = String(req.body.serviceId || '').trim();
      if (!serviceId) return res.status(400).json({ error: 'serviceId is required' });
      const want = req.body.favorite === undefined ? true : !!req.body.favorite;
      if (want) {
        const exists = await BoostService.countDocuments({ serviceId });
        if (!exists) return res.status(404).json({ error: 'Unknown service' });
        await BoostFavorite.updateOne(
          { userId: req.user._id, serviceId },
          { $setOnInsert: { userId: req.user._id, serviceId, createdAt: new Date() } },
          { upsert: true }
        );
      } else {
        await BoostFavorite.deleteOne({ userId: req.user._id, serviceId });
      }
      const favs = await BoostFavorite.find({ userId: req.user._id }, { serviceId: 1, _id: 0 }).lean();
      res.json({ ok: true, favorite: want, favorites: favs.map(f => String(f.serviceId)) });
    } catch (e) { res.status(500).json({ error: 'Could not update your favourites' }); }
  });

  /** POST /api/boost/quote { serviceId, quantity } — live price as the quantity changes. */
  app.post('/api/boost/quote', auth, async (req, res) => {
    try {
      const s = await getSettings();
      if (!s.enabled || !s.apiKey) return res.status(503).json({ error: s.disabledMessage || 'Boosting is under maintenance right now. Please check back shortly.', maintenance: true });
      const sv = await BoostService.findOne({ serviceId: String(req.body.serviceId || ''), enabled: true });
      if (!sv) return res.status(404).json({ error: 'That boosting service is no longer available' });
      const qty = Math.floor(Number(req.body.quantity) || 0);
      if (qty < sv.min || qty > sv.max) {
        return res.status(400).json({ error: `Quantity must be between ${sv.min.toLocaleString()} and ${sv.max.toLocaleString()}` });
      }
      const rate = await usdToNgn(s);
      const q = quoteFor(sv, qty, rate, s);
      const user = await User.findById(req.user._id, { balance: 1, isAdmin: 1, role: 1 }).lean();
      const isAdmin = !!(user && (user.isAdmin || ['admin', 'owner', 'super'].includes(String(user.role || '').toLowerCase())));
      res.json({
        serviceId: sv.serviceId,
        quantity: qty,
        price: q.price,
        // Live breakdown for the customer preview: base rate + our flat service fee.
        base: Math.round(q.cost * 100) / 100,
        serviceFee: Math.max(0, q.price - Math.round(q.cost * 100) / 100),
        pricePer1000: quoteFor(sv, 1000, rate, s).price,
        balance: user ? Number(user.balance || 0) : 0,
        affordable: !!user && Number(user.balance || 0) >= q.price,
        // The raw provider cost / profit split is only exposed to admins.
        ...(isAdmin ? { cost: q.cost, profit: q.profit } : {}),
        min: sv.min,
        max: sv.max,
        deliveryTime: sv.deliveryTime || 'Usually starts within 0–6 hours',
      });
    } catch (e) { res.status(500).json({ error: 'Could not price that order' }); }
  });


  /** POST /api/boost/order { serviceId, link, quantity } — charge the wallet, place the order. */
  app.post('/api/boost/order', auth, async (req, res) => {
    try {
      const s = await getSettings();
      if (!s.enabled || !s.apiKey) return res.status(503).json({ error: s.disabledMessage || 'Boosting is under maintenance right now. Please check back shortly.', maintenance: true });

      const sv = await BoostService.findOne({ serviceId: String(req.body.serviceId || ''), enabled: true });
      if (!sv) return res.status(404).json({ error: 'That boosting service is no longer available' });

      const link = String(req.body.link || '').trim();
      if (!/^https?:\/\/.+\..+/i.test(link)) return res.status(400).json({ error: 'Enter the full link to your profile or post (starting with https://)' });

      const qty = Math.floor(Number(req.body.quantity) || 0);
      if (qty < sv.min || qty > sv.max) return res.status(400).json({ error: `Quantity must be between ${sv.min.toLocaleString()} and ${sv.max.toLocaleString()}` });

      const rate = await usdToNgn(s);
      const q = quoteFor(sv, qty, rate, s);

      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ error: 'Account not found' });
      if ((user.balance || 0) < q.price) return res.status(400).json({ error: 'Insufficient balance. Please deposit funds and try again.' });

      // Debit first so a double-submit cannot place two orders on one balance,
      // then refund automatically if the provider rejects the order.
      const debited = await User.findOneAndUpdate(
        { _id: user._id, balance: { $gte: q.price } },
        { $inc: { balance: -q.price } },
        { new: true }
      );
      if (!debited) return res.status(400).json({ error: 'Insufficient balance. Please deposit funds and try again.' });

      let placed;
      try {
        placed = await providerCall('add', { service: sv.serviceId, link, quantity: String(qty) }, s);
      } catch (e) {
        await User.updateOne({ _id: user._id }, { $inc: { balance: q.price } });
        return res.status(502).json({ error: e.message });
      }
      if (!placed || !placed.order) {
        await User.updateOne({ _id: user._id }, { $inc: { balance: q.price } });
        return res.status(502).json({ error: 'The provider did not accept that order — nothing was charged.' });
      }

      const order = await BoostOrder.create({
        userId: user._id,
        serviceId: sv.serviceId,
        serviceName: sv.name,
        platform: sv.platform,
        category: sv.category,
        link, quantity: qty,
        price: q.price, cost: q.cost, profit: q.profit,
        providerOrderId: String(placed.order),
        status: 'Pending', bucket: 'pending',
        cancelSupported: !!sv.cancel,
        deliveryTime: sv.deliveryTime || 'Usually starts within 0–6 hours',
      });

      await Transaction.create({
        userId: user._id, type: 'purchase', amount: q.price,
        description: `Boost: ${sv.name} × ${qty.toLocaleString()}`, status: 'success',
      });

      res.json({ ok: true, orderId: order._id, price: q.price, balance: debited.balance, status: order.status });
    } catch (e) {
      res.status(500).json({ error: 'Could not place that boost order: ' + e.message });
    }
  });

  /** GET /api/boost/orders?bucket=pending|delivered|failed — the history page. */
  app.get('/api/boost/orders', auth, async (req, res) => {
    try {
      const filter = { userId: req.user._id };
      const bucket = String(req.query.bucket || 'all');
      if (['pending', 'delivered', 'failed'].includes(bucket)) filter.bucket = bucket;
      const orders = await BoostOrder.find(filter).sort({ createdAt: -1 }).limit(200).lean();
      const counts = await BoostOrder.aggregate([
        { $match: { userId: req.user._id } },
        { $group: { _id: '$bucket', n: { $sum: 1 } } },
      ]);
      const tally = { all: 0, pending: 0, delivered: 0, failed: 0 };
      counts.forEach(c => { tally[c._id] = c.n; tally.all += c.n; });
      res.json({ counts: tally, orders: orders.map(shapeOrder) });
    } catch (e) { res.status(500).json({ error: 'Could not load your boost history' }); }
  });

  /** GET /api/boost/orders/:id — one order, refreshed from the provider on demand. */
  app.get('/api/boost/orders/:id', auth, async (req, res) => {
    try {
      const order = await BoostOrder.findOne({ _id: req.params.id, userId: req.user._id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.bucket === 'pending') { try { await syncOrder(order); } catch { /* stale data is fine */ } }
      res.json(shapeOrder(order.toObject ? order.toObject() : order));
    } catch (e) { res.status(500).json({ error: 'Could not load that order' }); }
  });

  /** POST /api/boost/orders/:id/refill — for services that support it. */
  app.post('/api/boost/orders/:id/refill', auth, async (req, res) => {
    try {
      const order = await BoostOrder.findOne({ _id: req.params.id, userId: req.user._id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.bucket !== 'delivered') return res.status(400).json({ error: 'Only completed orders can be refilled' });
      const out = await providerCall('refill', { order: order.providerOrderId });
      order.note = `Refill requested (ref ${out.refill || 'n/a'})`;
      await order.save();
      res.json({ ok: true, refill: out.refill || '' });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  /**
   * Work out what a cancellation is worth.
   *
   * Really Simple Social stops an order where it is and only returns the value
   * of the units it never delivered. King Social Hub mirrors that: the customer keeps
   * paying for what already landed (pro-rata on the price they were charged)
   * and gets the rest back.
   */
  function refundSplit(order, remainsOverride) {
    const qty = Math.max(0, Number(order.quantity) || 0);
    const price = Math.max(0, Number(order.price) || 0);
    let remaining = remainsOverride === undefined || remainsOverride === null
      ? Number(order.remains) || 0
      : Number(remainsOverride) || 0;
    // remains is unknown (0) while the order is still queued → nothing delivered.
    if (!remaining && !order.startCount && !order.lastSyncAt) remaining = qty;
    remaining = Math.min(qty, Math.max(0, Math.round(remaining)));
    const delivered = Math.max(0, qty - remaining);
    if (!qty) return { delivered: 0, remaining: 0, refund: price, charged: 0 };
    let refund = Math.round((price * remaining) / qty);
    refund = Math.min(price, Math.max(0, refund));
    return { delivered, remaining, refund, charged: price - refund };
  }

  /**
   * POST /api/boost/orders/:id/cancel
   * Cancels a running order at Really Simple Social (action=cancel) and refunds
   * only the undelivered part of the order to the wallet.
   */
  app.post('/api/boost/orders/:id/cancel', auth, async (req, res) => {
    try {
      const order = await BoostOrder.findOne({ _id: req.params.id, userId: req.user._id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.refunded) return res.status(400).json({ error: 'This order was already cancelled and settled.' });
      if (order.bucket !== 'pending') return res.status(400).json({ error: 'Only orders that are still running can be cancelled.' });
      if (!order.providerOrderId) return res.status(400).json({ error: 'This order has no provider reference yet — try again in a moment.' });

      // 1. Ask the provider for the live progress so the split is accurate.
      let remains = order.remains;
      try {
        const info = await providerCall('status', { order: order.providerOrderId });
        if (info && !info.error) {
          order.status = info.status || order.status;
          order.startCount = Number(info.start_count) || order.startCount;
          remains = info.remains === undefined ? remains : Number(info.remains) || 0;
          order.remains = remains;
        }
      } catch { /* fall back to the last known progress */ }

      if (bucketFor(order.status) === 'delivered') {
        order.bucket = 'delivered';
        await order.save();
        return res.status(400).json({ error: 'This order already completed, so it can no longer be cancelled.' });
      }

      // 2. Cancel it for real on reallysimplesocial.com.
      let providerCancelled = false, providerNote = '';
      try {
        const out = await providerCall('cancel', { orders: String(order.providerOrderId) });
        const row = Array.isArray(out) ? out[0] : out;
        const val = row && (row.cancel !== undefined ? row.cancel : row.error);
        if (row && row.error) { providerNote = String(row.error); }
        else { providerCancelled = true; providerNote = String(val || 'cancelled'); }
      } catch (e) {
        providerNote = e.providerError || e.message;
      }
      if (!providerCancelled) {
        return res.status(400).json({
          error: `The provider could not cancel this order: ${providerNote || 'unknown reason'}. Orders that already finished delivering cannot be cancelled.`,
        });
      }

      // 3. Refund only what was never delivered.
      const split = refundSplit(order, remains);
      order.refunded = true;
      order.refundAmount = split.refund;
      order.deliveredAtCancel = split.delivered;
      order.canceledAt = new Date();
      order.status = 'Canceled';
      order.bucket = 'failed';
      order.lastSyncAt = new Date();
      order.note = split.delivered > 0
        ? `Cancelled by you after ${split.delivered.toLocaleString()} of ${order.quantity.toLocaleString()} units — ₦${split.refund.toLocaleString()} refunded, ₦${split.charged.toLocaleString()} kept for delivered units`
        : 'Cancelled by you before delivery started — fully refunded';
      await order.save();

      if (split.refund > 0) {
        await User.updateOne({ _id: order.userId }, { $inc: { balance: split.refund } });
        await Transaction.create({
          userId: order.userId, type: 'admin_credit', amount: split.refund,
          description: `Refund: cancelled boost ${order.serviceName} (${split.delivered.toLocaleString()}/${order.quantity.toLocaleString()} delivered)`,
          status: 'success',
        });
      }
      const user = await User.findById(order.userId, { balance: 1 }).lean();
      res.json({
        ok: true,
        cancelled: true,
        delivered: split.delivered,
        remaining: split.remaining,
        refund: split.refund,
        charged: split.charged,
        balance: user ? user.balance || 0 : undefined,
        order: shapeOrder(order),
      });
    } catch (e) { res.status(400).json({ error: e.userMessage || e.message }); }
  });

  /** POST /api/boost/orders/:id/cancel-quote — what a cancellation would cost. */
  app.post('/api/boost/orders/:id/cancel-quote', auth, async (req, res) => {
    try {
      const order = await BoostOrder.findOne({ _id: req.params.id, userId: req.user._id });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      let remains = order.remains;
      try {
        const info = await providerCall('status', { order: order.providerOrderId });
        if (info && !info.error) remains = info.remains === undefined ? remains : Number(info.remains) || 0;
      } catch { /* use the stored progress */ }
      res.json({ ok: true, ...refundSplit(order, remains), price: order.price, quantity: order.quantity });
    } catch (e) { res.status(400).json({ error: e.userMessage || e.message }); }
  });

  function shapeOrder(o) {
    return {
      id: String(o._id),
      service: o.serviceName,
      platform: o.platform,
      category: o.category,
      link: o.link,
      quantity: o.quantity,
      price: o.price,
      status: o.status,
      bucket: o.bucket,
      startCount: o.startCount,
      remains: o.remains,
      delivered: Math.max(0, (o.quantity || 0) - (o.remains || 0)),
      deliveryTime: o.deliveryTime,
      note: o.note,
      refunded: !!o.refunded,
      refundAmount: Number(o.refundAmount || 0),
      cancelSupported: !!o.cancelSupported,
      // A running order can be cancelled while it is still pending; the customer
      // is refunded only for the units that have NOT been delivered yet.
      canCancel: o.bucket === 'pending' && !o.refunded && !!o.providerOrderId,
      deliveredAtCancel: Number(o.deliveredAtCancel || 0),
      providerOrderId: o.providerOrderId,
      createdAt: o.createdAt,
      lastSyncAt: o.lastSyncAt,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATUS SYNC
  // ══════════════════════════════════════════════════════════════════════════
  async function applyStatus(order, info) {
    if (!info || info.error) return order;
    order.status = info.status || order.status;
    order.startCount = Number(info.start_count) || order.startCount;
    order.remains = Number(info.remains) || 0;
    const bucket = bucketFor(order.status);
    // A cancelled/refunded order returns the money once, never twice — and only
    // for the part that was never delivered (same rule as the provider panel).
    if (bucket === 'failed' && !order.refunded) {
      const r = refundSplit(order);
      order.refunded = true;
      order.refundAmount = r.refund;
      order.deliveredAtCancel = r.delivered;
      if (r.refund > 0) {
        await User.updateOne({ _id: order.userId }, { $inc: { balance: r.refund } });
        await Transaction.create({
          userId: order.userId, type: 'admin_credit', amount: r.refund,
          description: `Refund: boost ${order.serviceName} (${order.status}) — ${r.delivered.toLocaleString()} of ${(order.quantity || 0).toLocaleString()} delivered`,
          status: 'success',
        });
      }
      order.note = r.refund > 0
        ? (r.delivered > 0
            ? `Cancelled after ${r.delivered.toLocaleString()} units — ₦${r.refund.toLocaleString()} refunded for the ${r.remaining.toLocaleString()} undelivered units`
            : 'Cancelled before delivery — fully refunded to wallet')
        : 'Cancelled after full delivery — no refund due';
    }
    order.bucket = bucket;
    order.lastSyncAt = new Date();
    await order.save();
    return order;
  }

  async function syncOrder(order) {
    const info = await providerCall('status', { order: order.providerOrderId });
    return applyStatus(order, info);
  }

  /** Sweep every open order in batches of 100 (the provider's documented limit). */
  async function sweepOpenOrders() {
    const s = await getSettings(true);
    if (!s.enabled || !s.apiKey) return { checked: 0 };
    const open = await BoostOrder.find({ bucket: 'pending', providerOrderId: { $ne: '' } }).sort({ createdAt: -1 }).limit(300);
    let checked = 0;
    for (let i = 0; i < open.length; i += 100) {
      const chunk = open.slice(i, i + 100);
      let map;
      try { map = await providerCall('status', { orders: chunk.map(o => o.providerOrderId).join(',') }, s); }
      catch { continue; }
      for (const order of chunk) {
        const info = map && map[order.providerOrderId];
        if (!info) continue;
        try { await applyStatus(order, info); checked++; } catch { /* keep sweeping */ }
      }
    }
    return { checked };
  }

  // ── HOW STATUS UPDATES ARRIVE ────────────────────────────────────────────
  // 1. Webhook (instant)  — the provider calls POST /api/boost/webhook.
  // 2. Fast sweep         — every BOOST_FAST_SWEEP_SECONDS (default 60s) for
  //                          orders placed in the last few hours.
  // 3. Full sweep         — every BOOST_SWEEP_MINUTES (default 5) for the rest.
  // 4. On-demand          — opening an order refreshes it from the provider.
  const SWEEP_MINUTES = Number(process.env.BOOST_SWEEP_MINUTES || 5);
  const FAST_SWEEP_SECONDS = Math.max(15, Number(process.env.BOOST_FAST_SWEEP_SECONDS || 60));
  const FAST_WINDOW_HOURS = Math.max(1, Number(process.env.BOOST_FAST_WINDOW_HOURS || 6));
  setInterval(() => { sweepOpenOrders().catch(() => {}); }, SWEEP_MINUTES * 60 * 1000);

  /** Recent orders only — cheap enough to run every minute. */
  async function sweepRecentOrders() {
    const s = await getSettings();
    if (!s.enabled || !s.apiKey) return { checked: 0 };
    const since = new Date(Date.now() - FAST_WINDOW_HOURS * 3600 * 1000);
    const open = await BoostOrder.find({
      bucket: 'pending', providerOrderId: { $ne: '' }, createdAt: { $gte: since },
    }).sort({ createdAt: -1 }).limit(100);
    if (!open.length) return { checked: 0 };
    let map;
    try { map = await providerCall('status', { orders: open.map(o => o.providerOrderId).join(',') }, s); }
    catch { return { checked: 0 }; }
    let checked = 0;
    for (const order of open) {
      const info = map && map[order.providerOrderId];
      if (!info) continue;
      try { await applyStatus(order, info); checked++; } catch { /* keep going */ }
    }
    return { checked };
  }
  setInterval(() => { sweepRecentOrders().catch(() => {}); }, FAST_SWEEP_SECONDS * 1000);

  /**
   * POST /api/boost/webhook — instant status pushes from the provider panel.
   *
   * Configure the URL in the panel as
   *   https://yourdomain.com/api/boost/webhook?secret=<BOOST_WEBHOOK_SECRET>
   * (the secret may also be sent as the X-Boost-Secret header).
   *
   * Body may be a single order or a list; only the order id is trusted — the
   * real status is always re-read from the provider API, so a spoofed payload
   * can never mark an order delivered.
   */
  async function handleWebhook(req, res) {
    try {
      const s = await getSettings();
      const secret = s.webhookSecret || process.env.BOOST_WEBHOOK_SECRET || '';
      const given = String(req.query.secret || req.headers['x-boost-secret'] || '');
      if (!secret || given !== secret) return res.status(401).json({ error: 'Invalid webhook secret' });

      const body = req.body || {};
      const raw = Array.isArray(body) ? body : (Array.isArray(body.orders) ? body.orders : [body]);
      const ids = raw
        .map(o => String((o && (o.order || o.order_id || o.id)) || '').trim())
        .filter(Boolean);
      if (!ids.length) return res.json({ ok: true, updated: 0 });

      const orders = await BoostOrder.find({ providerOrderId: { $in: ids } });
      let updated = 0;
      for (const order of orders) {
        try { await syncOrder(order); updated++; } catch { /* provider hiccup */ }
      }
      s.lastWebhookAt = new Date();
      try { await s.save(); } catch {}
      res.json({ ok: true, updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
  app.post('/api/boost/webhook', handleWebhook);
  app.get('/api/boost/webhook', handleWebhook); // some panels ping with GET

  /** GET /api/boost/orders-live — the history page polls this while an order
   *  is still pending, so the customer sees changes without a page reload. */
  app.get('/api/boost/orders-live', auth, async (req, res) => {
    try {
      const pending = await BoostOrder.find({ userId: req.user._id, bucket: 'pending' })
        .sort({ createdAt: -1 }).limit(20);
      if (pending.length) {
        const s = await getSettings();
        if (s.enabled && s.apiKey) {
          try {
            const map = await providerCall('status', { orders: pending.map(o => o.providerOrderId).filter(Boolean).join(',') }, s);
            for (const order of pending) {
              const info = map && map[order.providerOrderId];
              if (info) { try { await applyStatus(order, info); } catch {} }
            }
          } catch { /* show the cached rows instead */ }
        }
      }
      const orders = await BoostOrder.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
      res.json({ orders: orders.map(shapeOrder), pollSeconds: Number(process.env.BOOST_POLL_SECONDS || 15) });
    } catch (e) { res.status(500).json({ error: 'Could not refresh your boost orders' }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN API
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/admin/boost/settings', anyAdminAuth, async (req, res) => {
    try {
      const s = await getSettings(true);
      const rate = await usdToNgn(s);
      const total = await BoostService.countDocuments();
      const live = await BoostService.countDocuments({ enabled: true });
      res.json({
        enabled: !!s.enabled,
        hasApiKey: !!s.apiKey,
        apiKeyHint: s.apiKey ? '••••' + s.apiKey.slice(-4) : '',
        apiUrl: s.apiUrl || PROVIDER_URL,
        usdRate: s.usdRate || 0,
        providerCurrency: String(s.providerCurrency || 'NGN').toUpperCase(),
        effectiveUsdRate: Math.round(rate * 100) / 100,
        tiers: tiersOf(s),
        disabledMessage: s.disabledMessage,
        lastSyncAt: s.lastSyncAt, lastSyncCount: s.lastSyncCount, lastError: s.lastError,
        services: { total, live },
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/boost/settings', anyAdminAuth, async (req, res) => {
    try {
      const s = await getSettings(true);
      const b = req.body || {};
      const before = { enabled: !!s.enabled, tiers: tiersOf(s), usdRate: s.usdRate, providerCurrency: s.providerCurrency, disabledMessage: s.disabledMessage };
      if (b.enabled !== undefined) { s.enabled = !!b.enabled; s.adminTouchedEnabled = true; }
      if (typeof b.apiKey === 'string' && b.apiKey.trim() && !b.apiKey.includes('••')) s.apiKey = b.apiKey.trim();
      if (typeof b.apiUrl === 'string' && b.apiUrl.trim()) s.apiUrl = b.apiUrl.trim();
      if (b.usdRate !== undefined) s.usdRate = Math.max(0, Number(b.usdRate) || 0);
      if (b.autoSyncHours !== undefined) s.autoSyncHours = Math.min(72, Math.max(0, Number(b.autoSyncHours) || 0));
      if (typeof b.providerCurrency === 'string' && b.providerCurrency.trim()) {
        s.providerCurrency = b.providerCurrency.trim().toUpperCase().slice(0, 8);
      }
      if (typeof b.disabledMessage === 'string') s.disabledMessage = b.disabledMessage.slice(0, 300);
      if (Array.isArray(b.tiers) && b.tiers.length) {
        s.tiers = b.tiers
          .map(t => ({ upTo: Math.max(0, Math.floor(Number(t.upTo) || 0)), profit: Math.max(0, Number(t.profit) || 0) }))
          .sort((a, x) => (a.upTo || Infinity) - (x.upTo || Infinity));
      }
      s.updatedAt = new Date();
      await s.save();
      cachedSettings = null;
      invalidateCatalogueCache();

      // Audit trail — one entry per meaningful change.
      const after = { enabled: !!s.enabled, tiers: tiersOf(s), usdRate: s.usdRate, providerCurrency: s.providerCurrency, disabledMessage: s.disabledMessage };
      if (before.enabled !== after.enabled) {
        await audit(req, after.enabled ? 'enabled' : 'disabled', `Boosting turned ${after.enabled ? 'ON' : 'OFF'}`, { enabled: before.enabled }, { enabled: after.enabled });
      }
      if (JSON.stringify(before.tiers) !== JSON.stringify(after.tiers)) {
        await audit(req, 'tiers', `Profit table updated (${after.tiers.length} tiers)`, { tiers: before.tiers }, { tiers: after.tiers });
      }
      if (before.usdRate !== after.usdRate || before.providerCurrency !== after.providerCurrency || before.disabledMessage !== after.disabledMessage) {
        await audit(req, 'settings', 'Boost settings updated', before, after);
      }
      res.json({ ok: true, tiers: after.tiers, enabled: after.enabled });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** POST /api/admin/boost/sync — pull the provider catalogue into BoostService. */
  app.post('/api/admin/boost/sync', anyAdminAuth, async (req, res) => {
    try {
      const out = await syncCatalogue({ by: `admin:${actorOf(req)}`, force: true });
      await audit(req, 'sync', `Manual sync — ${out.stored} services stored`, null, out);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /** GET /api/admin/boost/sync-status — everything the status page shows. */
  app.get('/api/admin/boost/sync-status', anyAdminAuth, async (req, res) => {
    try {
      const s = await getSettings(true);
      const [total, live, disabled] = await Promise.all([
        BoostService.countDocuments(),
        BoostService.countDocuments({ enabled: true }),
        BoostService.countDocuments({ enabled: false }),
      ]);
      const byPlatform = await BoostService.aggregate([
        { $group: { _id: '$platform', total: { $sum: 1 }, live: { $sum: { $cond: ['$enabled', 1, 0] } } } },
        { $sort: { total: -1 } },
      ]);
      res.json({
        enabled: !!s.enabled,
        running: !!catalogueSyncing,
        lastSyncAt: s.lastSyncAt,
        lastSyncOk: !!s.lastSyncOk,
        lastSyncBy: s.lastSyncBy || '',
        lastSyncMs: s.lastSyncMs || 0,
        providerCount: s.lastSyncCount || 0,
        storedCount: total,
        lastError: s.lastError || '',
        lastErrorAt: s.lastErrorAt || null,
        autoSyncHours: s.autoSyncHours || 0,
        nextSyncAt: s.lastSyncAt && s.autoSyncHours
          ? new Date(new Date(s.lastSyncAt).getTime() + s.autoSyncHours * 3600 * 1000)
          : null,
        services: { total, live, disabled },
        platforms: byPlatform.map(p => ({ platform: p._id || 'Other', total: p.total, live: p.live })),
        history: (s.syncHistory || []).slice(0, 25),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** GET /api/admin/boost/audit?limit= — enable/disable + profit-table history. */
  app.get('/api/admin/boost/audit', anyAdminAuth, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const rows = await BoostAudit.find({}).sort({ createdAt: -1 }).limit(limit).lean();
      res.json({
        entries: rows.map(r => ({
          id: String(r._id), action: r.action, summary: r.summary,
          before: r.before || null, after: r.after || null,
          actor: r.actor, ip: r.ip, createdAt: r.createdAt,
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Provider service-list cache ──────────────────────────────────────────
  // The provider list barely changes; caching it means a retry (or a second
  // admin clicking "Sync now") does not hit reallysimplesocial again.
  const PROVIDER_CACHE_MS = Math.max(0, Number(process.env.BOOST_PROVIDER_CACHE_SECONDS || 600)) * 1000;
  let providerListCache = null; // { at, list }
  async function fetchServiceList(s, force) {
    if (!force && providerListCache && Date.now() - providerListCache.at < PROVIDER_CACHE_MS) {
      return providerListCache.list;
    }
    const list = await providerCall('services', {}, s);
    if (!Array.isArray(list)) throw new Error('The provider returned an unexpected service list');
    providerListCache = { at: Date.now(), list };
    return list;
  }

  /** Pull the provider catalogue into BoostService. Shared by the admin button,
   *  the scheduler, the boot-time bootstrap and the "catalogue is empty" self-heal.
   *  Retries transient provider/database failures before giving up. */
  async function syncCatalogue(opts) {
    const { by = 'auto', force = false, attempts = 3, onStep = null } = opts || {};
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (onStep && attempt > 1) onStep(`Retrying (attempt ${attempt} of ${attempts})…`);
        return await runSync({ by, force: force || attempt > 1, onStep });
      } catch (e) {
        lastErr = e;
        logProviderError('Boost catalogue sync failed', e.message, { attempt, by });
        if (attempt < attempts) await new Promise(r => setTimeout(r, attempt * 3000));
      }
    }
    try {
      const st = await getSettings(true);
      st.lastSyncOk = false;
      st.lastError = lastErr ? lastErr.message : 'Sync failed';
      st.lastErrorAt = new Date();
      st.syncHistory = [{ at: new Date(), by, ok: false, error: st.lastError }, ...(st.syncHistory || [])].slice(0, 25);
      await st.save();
      cachedSettings = null;
    } catch { /* the thrown error below is still surfaced */ }
    throw lastErr || new Error('Sync failed');
  }

  async function runSync({ by, force, onStep }) {
    const startedAt = Date.now();
    const step = (msg, extra) => { try { if (onStep) onStep(msg, extra || {}); } catch { /* progress must never break a sync */ } };
    step('Reading boosting settings…');
    const s = await getSettings(true);
    if (!s.apiKey) throw new Error('No provider API key is saved — add it in Admin → Boost.');

    // Keep the panel currency in step with the provider so pricing can never
    // silently apply (or skip) an FX conversion.
    step('Checking the provider connection and panel currency…');
    try {
      const bal = await providerCall('balance', {}, s);
      const cur = String((bal && bal.currency) || '').trim().toUpperCase();
      if (cur && cur !== String(s.providerCurrency || '').toUpperCase()) s.providerCurrency = cur;
    } catch { /* pricing keeps the stored currency */ }

    step('Downloading the service list from the provider…');
    const list = await fetchServiceList(s, force);
    step(`Provider returned ${list.length.toLocaleString()} services.`, { providerCount: list.length });

    // The provider ships ~750 services. The old implementation did a findOne +
    // save round-trip per service inside the HTTP request, which routinely died
    // part-way through and left the catalogue holding only the first ~150 rows
    // (Instagram / Threads / Twitter). Everything now goes out as a handful of
    // bulkWrite batches, and a single bad row can never abort the run.
    const existing = new Set(
      (await BoostService.find({}, { serviceId: 1, _id: 0 }).lean()).map(x => String(x.serviceId))
    );

    const ops = [];
    let created = 0, updated = 0, skipped = 0;
    for (const item of list) {
      try {
        const id = String(item && item.service != null ? item.service : '').trim();
        if (!id) { skipped++; continue; }
        const type = String((item && item.type) || 'Default');
        const min = Math.max(1, Math.floor(Number(item.min) || 1));
        const max = Math.max(min, Math.floor(Number(item.max) || 1000));
        const patch = {
          name: String(item.name || '').slice(0, 200),
          category: String(item.category || '').slice(0, 120),
          platform: platformOf(`${item.category || ''} ${item.name || ''}`),
          type,
          rate: Number(item.rate) || 0,
          min,
          max,
          refill: !!item.refill,
          cancel: !!item.cancel,
          syncedAt: new Date(),
        };
        if (existing.has(id)) {
          // Never touch enabled/description/deliveryTime/sortOrder — those are admin-owned.
          ops.push({ updateOne: { filter: { serviceId: id }, update: { $set: patch } } });
          updated++;
        } else {
          // Everything the provider sells is stocked and live by default so the
          // customer catalogue is never silently limited to a few platforms.
          ops.push({
            updateOne: {
              filter: { serviceId: id },
              update: { $set: patch, $setOnInsert: { serviceId: id, enabled: true } },
              upsert: true,
            },
          });
          created++;
        }
      } catch { skipped++; }
    }

    step(`Preparing ${ops.length.toLocaleString()} updates (${created} new, ${updated} existing${skipped ? `, ${skipped} unreadable` : ''})…`, { providerCount: list.length });
    let written = 0;
    for (let i = 0; i < ops.length; i += 200) {
      const chunk = ops.slice(i, i + 200);
      try {
        const r = await BoostService.bulkWrite(chunk, { ordered: false });
        written += (r.upsertedCount || 0) + (r.modifiedCount || 0) + (r.matchedCount || 0);
      } catch (e) {
        // ordered:false — Mongo already applied every non-conflicting op in the
        // batch, so log and keep going instead of losing the rest of the sync.
        logProviderError('Boost catalogue batch partially failed', e.message, { from: i });
      }
      step(`Saved ${Math.min(i + 200, ops.length).toLocaleString()} of ${ops.length.toLocaleString()} services…`, { providerCount: list.length });
    }

    step('Counting the stored catalogue…');
    const total = await BoostService.countDocuments();
    const ms = Date.now() - startedAt;
    // A run that stored materially fewer rows than the provider returned is a
    // failure even though no exception was thrown — surface it and let the
    // caller's retry loop have another go.
    const short = total < Math.floor(list.length * 0.9);
    s.lastSyncAt = new Date();
    s.lastSyncCount = list.length;
    s.lastSyncStored = total;
    s.lastSyncMs = ms;
    s.lastSyncBy = by;
    s.lastSyncOk = !short;
    s.lastError = short
      ? `Only ${total} of ${list.length} services were stored`
      : (skipped ? `${skipped} service(s) from the provider were skipped as unreadable` : '');
    if (s.lastError) s.lastErrorAt = new Date();
    s.syncHistory = [
      { at: s.lastSyncAt, by, ok: !short, provider: list.length, stored: total, created, updated, skipped, ms, error: s.lastError || '' },
      ...(s.syncHistory || []),
    ].slice(0, 25);
    await s.save();
    cachedSettings = null;
    invalidateCatalogueCache();
    if (short) throw new Error(s.lastError);
    step(`Done — ${total.toLocaleString()} services stored in ${(ms / 1000).toFixed(1)}s.`, { providerCount: list.length, storedCount: total, done: true });
    return { total: list.length, created, updated, skipped, stored: total, written, ms };
  }

  /** Self-heal: if boosting is on but no services were ever pulled, pull them
   *  now so the customer page is never mysteriously empty. */
  let catalogueSyncing = null;
  const CATALOGUE_MAX_AGE_MS = 12 * 3600 * 1000;
  function startSync(by, force) {
    if (!catalogueSyncing) {
      catalogueSyncing = syncCatalogue({ by, force })
        .catch(() => null)
        .finally(() => { catalogueSyncing = null; });
    }
    return catalogueSyncing;
  }
  async function ensureCatalogue(s) {
    if (!s.enabled || !s.apiKey) return 0;
    const have = await BoostService.countDocuments();
    // Re-pull when the catalogue is empty, obviously truncated (an old partial
    // sync that only stored the first few platforms), or simply stale.
    const truncated = !!(s.lastSyncCount && have < Math.floor(s.lastSyncCount * 0.9));
    const stale = !s.lastSyncAt || (Date.now() - new Date(s.lastSyncAt).getTime()) > CATALOGUE_MAX_AGE_MS;
    if (have && !truncated && !stale) return have;
    const run = startSync('auto-heal', truncated);
    // Only block the request when there is nothing to show yet; otherwise the
    // refresh runs in the background and the customer sees the cached catalogue.
    if (!have) await run;
    return BoostService.countDocuments();
  }

  /** Background scheduler — checks every 15 minutes and re-syncs when due. */
  const SCHEDULER_TICK_MS = 15 * 60 * 1000;
  async function scheduledSyncTick() {
    try {
      const s = await getSettings();
      if (!s.enabled || !s.apiKey) return;
      const hours = Number(s.autoSyncHours || 0);
      if (!hours) return;
      const due = !s.lastSyncAt || (Date.now() - new Date(s.lastSyncAt).getTime()) >= hours * 3600 * 1000;
      if (due) await startSync('schedule', true);
    } catch { /* the next tick tries again */ }
  }
  if (process.env.BOOST_DISABLE_SCHEDULER !== '1') {
    const timer = setInterval(scheduledSyncTick, SCHEDULER_TICK_MS);
    if (timer.unref) timer.unref();
    setTimeout(scheduledSyncTick, 30_000).unref?.();
  }


  /** GET /api/admin/boost/services?q=&platform= */
  app.get('/api/admin/boost/services', anyAdminAuth, async (req, res) => {
    try {
      const s = await getSettings();
      const rate = await usdToNgn(s);
      const filter = {};
      const q = String(req.query.q || '').trim();
      if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { category: new RegExp(q, 'i') }, { serviceId: q }];
      if (req.query.platform && req.query.platform !== 'all') filter.platform = req.query.platform;
      const services = await BoostService.find(filter).sort({ platform: 1, name: 1 }).limit(500).lean();
      res.json({
        count: services.length,
        services: services.map(sv => ({
          id: sv.serviceId, name: sv.name, category: sv.category, platform: sv.platform, type: sv.type,
          rate: sv.rate, min: sv.min, max: sv.max, enabled: sv.enabled,
          description: sv.description, deliveryTime: sv.deliveryTime,
          price1000: quoteFor(sv, 1000, rate, s).price,
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** POST /api/admin/boost/services/bulk { enabled, platform? } — turn a whole
   *  platform (or the entire catalogue) on/off in one click. This is also the
   *  repair path for catalogues where an old sync stored services disabled. */
  app.post('/api/admin/boost/services/bulk', anyAdminAuth, async (req, res) => {
    try {
      const enabled = !!(req.body || {}).enabled;
      const platform = String((req.body || {}).platform || 'all');
      const filter = platform && platform !== 'all' ? { platform } : {};
      const r = await BoostService.updateMany(filter, { $set: { enabled } });
      invalidateCatalogueCache();
      await audit(req, enabled ? 'enabled' : 'disabled',
        `${enabled ? 'Enabled' : 'Disabled'} ${r.modifiedCount} service(s) — ${platform === 'all' ? 'all platforms' : platform}`,
        null, { platform, enabled, changed: r.modifiedCount });
      res.json({ ok: true, changed: r.modifiedCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/admin/boost/services/:id', anyAdminAuth, async (req, res) => {
    try {
      const sv = await BoostService.findOne({ serviceId: String(req.params.id) });
      if (!sv) return res.status(404).json({ error: 'Service not found' });
      const b = req.body || {};
      const was = !!sv.enabled;
      if (b.enabled !== undefined) sv.enabled = !!b.enabled;
      if (typeof b.description === 'string') sv.description = b.description.slice(0, 400);
      if (typeof b.deliveryTime === 'string') sv.deliveryTime = b.deliveryTime.slice(0, 80);
      if (b.sortOrder !== undefined) sv.sortOrder = Number(b.sortOrder) || 0;
      await sv.save();
      invalidateCatalogueCache();
      if (was !== !!sv.enabled) {
        await audit(req, sv.enabled ? 'enabled' : 'disabled', `${sv.enabled ? 'Enabled' : 'Disabled'} “${sv.name}” (#${sv.serviceId})`, { enabled: was }, { enabled: !!sv.enabled });
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });


  /** GET /api/admin/boost/orders?bucket=&q= */
  app.get('/api/admin/boost/orders', anyAdminAuth, async (req, res) => {
    try {
      const filter = {};
      const bucket = String(req.query.bucket || 'all');
      if (['pending', 'delivered', 'failed'].includes(bucket)) filter.bucket = bucket;
      const q = String(req.query.q || '').trim();
      if (q) filter.$or = [{ link: new RegExp(q, 'i') }, { serviceName: new RegExp(q, 'i') }, { providerOrderId: q }];
      const orders = await BoostOrder.find(filter).sort({ createdAt: -1 }).limit(200).populate('userId', 'name email').lean();
      const totals = await BoostOrder.aggregate([
        { $group: { _id: null, revenue: { $sum: '$price' }, profit: { $sum: '$profit' }, n: { $sum: 1 } } },
      ]);
      res.json({
        totals: totals[0] ? { revenue: totals[0].revenue, profit: totals[0].profit, count: totals[0].n } : { revenue: 0, profit: 0, count: 0 },
        orders: orders.map(o => ({
          ...shapeOrder(o),
          profitNgn: o.profit,
          customer: o.userId ? { name: o.userId.name, email: o.userId.email } : null,
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/admin/boost/sync-orders', anyAdminAuth, async (req, res) => {
    try { res.json(await sweepOpenOrders()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/boost/balance', anyAdminAuth, async (req, res) => {
    try { res.json(await checkProviderBalance(true)); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });

  async function checkProviderBalance(manual) {
    const s = await getSettings(true);
    const result = await providerCall('balance', {}, s);
    const balance = Number(result && result.balance);
    if (!Number.isFinite(balance)) return result;
    const previous = s.lastProviderBalance == null ? null : Number(s.lastProviderBalance);
    s.lastProviderBalance = balance;
    s.lastProviderBalanceAt = new Date();
    await s.save();
    cachedSettings = null;
    if (!manual && previous !== null && balance > previous && ctx.Announcement) {
      const recent = await ctx.Announcement.findOne({ title: 'Boost services restocked', createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } }).lean();
      if (!recent) await ctx.Announcement.create({ title: 'Boost services restocked', message: 'Boosting balance has been topped up. Browse available services and place your order now.', link: '/boost', linkLabel: 'Browse services', level: 'success', active: true, createdBy: 'system', expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });
    }
    return { ...result, previousBalance: previous };
  }

  setTimeout(() => {
    checkProviderBalance(false).catch(() => {});
    const timer = setInterval(() => checkProviderBalance(false).catch(() => {}), 15 * 60 * 1000);
    if (timer.unref) timer.unref();
  }, 30000);

  // ══════════════════════════════════════════════════════════════════════════
  // TROUBLESHOOTING  +  LIVE "SYNC NOW" PROGRESS
  // ══════════════════════════════════════════════════════════════════════════

  /** In-memory progress jobs for the streaming "Sync now" button. */
  const syncJobs = new Map(); // id -> { steps, done, ok, error, providerCount, storedCount, startedAt, by }
  function pruneJobs() {
    const cutoff = Date.now() - 20 * 60 * 1000;
    for (const [id, job] of syncJobs) if (job.startedAt < cutoff) syncJobs.delete(id);
  }

  /** POST /api/admin/boost/sync-progress — start a sync and follow it step by step. */
  app.post('/api/admin/boost/sync-progress', anyAdminAuth, async (req, res) => {
    try {
      pruneJobs();
      const id = 'sync_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const by = `admin:${actorOf(req)}`;
      const job = { id, by, startedAt: Date.now(), steps: [], done: false, ok: false, error: '', providerCount: 0, storedCount: 0 };
      syncJobs.set(id, job);
      const onStep = (message, extra = {}) => {
        job.steps.push({ at: new Date(), message });
        if (job.steps.length > 60) job.steps.shift();
        if (extra.providerCount) job.providerCount = extra.providerCount;
        if (extra.storedCount) job.storedCount = extra.storedCount;
      };
      onStep('Starting sync…');
      // Fire and forget — the browser polls the job below.
      syncCatalogue({ by, force: true, onStep })
        .then(async out => {
          job.ok = true;
          job.providerCount = out.total || job.providerCount;
          job.storedCount = out.stored || job.storedCount;
          job.result = out;
          onStep(`Finished: ${out.stored.toLocaleString()} services stored (${out.created} new, ${out.updated} updated).`);
          await audit(req, 'sync', `Sync now — ${out.stored} services stored`, null, out);
        })
        .catch(e => {
          job.ok = false;
          job.error = e.userMessage || e.message || 'Sync failed';
          onStep('Failed: ' + job.error);
        })
        .finally(() => { job.done = true; });
      res.json({ ok: true, jobId: id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /** GET /api/admin/boost/sync-progress/:id — poll the steps of a running sync. */
  app.get('/api/admin/boost/sync-progress/:id', anyAdminAuth, async (req, res) => {
    const job = syncJobs.get(String(req.params.id));
    if (!job) return res.status(404).json({ error: 'That sync job has expired — start a new one.' });
    res.json({
      id: job.id, done: job.done, ok: job.ok, error: job.error,
      providerCount: job.providerCount, storedCount: job.storedCount,
      elapsedMs: Date.now() - job.startedAt,
      steps: job.steps.map(s => ({ at: s.at, message: s.message })),
      result: job.result || null,
    });
  });

  /**
   * GET /api/admin/boost/troubleshoot — one page that answers "why is boosting
   * broken?": configuration problems, failed sync runs, provider reachability,
   * and every service that the provider no longer returns.
   */
  app.get('/api/admin/boost/troubleshoot', anyAdminAuth, async (req, res) => {
    try {
      const s = await getSettings(true);
      const checks = [];
      const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, fix: fix || '' });

      add('Boosting switch', !!s.enabled,
        s.enabled ? 'Boosting is ON — customers can order.' : 'Boosting is OFF — the /boost page shows your message.',
        s.enabled ? '' : 'Tick “Boosting is live” above and save.');
      add('Provider API key', !!s.apiKey,
        s.apiKey ? 'A key is saved (••••' + s.apiKey.slice(-4) + ').' : 'No API key saved.',
        s.apiKey ? '' : 'Paste your Really Simple Social key above and save.');

      // Provider reachability + balance.
      let balance = null, providerOk = false, providerDetail = '';
      if (s.apiKey) {
        try {
          const bal = await providerCall('balance', {}, s);
          balance = bal;
          providerOk = true;
          providerDetail = `Connected. Panel balance: ${bal.balance} ${bal.currency || ''}`.trim();
          if (Number(bal.balance) <= 0) {
            providerOk = false;
            providerDetail = `Connected, but the panel balance is ${bal.balance} ${bal.currency || ''} — new orders will be rejected.`;
          }
        } catch (e) { providerDetail = e.userMessage || e.message; }
      } else { providerDetail = 'Skipped — no API key.'; }
      add('Provider connection', providerOk, providerDetail,
        providerOk ? '' : 'Check the API key/URL, then top up the panel balance if it is empty.');

      const [total, live, disabled, zeroRate, unmapped] = await Promise.all([
        BoostService.countDocuments(),
        BoostService.countDocuments({ enabled: true }),
        BoostService.countDocuments({ enabled: false }),
        BoostService.countDocuments({ rate: { $lte: 0 } }),
        BoostService.countDocuments({ platform: 'Other' }),
      ]);
      add('Catalogue stored', total > 0, `${total.toLocaleString()} services stored, ${live.toLocaleString()} live, ${disabled.toLocaleString()} hidden.`,
        total ? '' : 'Run “Rebuild services” below.');
      add('Last sync', !!s.lastSyncOk,
        s.lastSyncAt
          ? `${s.lastSyncOk ? 'Succeeded' : 'Failed'} ${new Date(s.lastSyncAt).toLocaleString()} — provider returned ${s.lastSyncCount || 0}, stored ${s.lastSyncStored || total}.`
          : 'The catalogue has never been synced.',
        s.lastSyncOk ? '' : (s.lastError || 'Run “Sync now” and watch the progress log.'));
      add('Visible to customers', live > 0, live ? `${live.toLocaleString()} services are visible on /boost.` : 'Every service is hidden.',
        live ? '' : 'Click “Enable all services”.');
      add('Pricing sanity', zeroRate === 0, zeroRate ? `${zeroRate} service(s) have a provider rate of 0 and would sell at pure profit only.` : 'Every service has a provider rate.',
        zeroRate ? 'Run a sync to refresh rates; hide any service the provider no longer prices.' : '');

      // Services the provider no longer returns → "missing provider" reasons.
      const missing = [];
      let providerIds = null;
      if (s.apiKey) {
        try {
          const list = await fetchServiceList(s, false);
          providerIds = new Set(list.map(x => String(x && x.service)));
        } catch (e) { providerDetail = providerDetail || (e.userMessage || e.message); }
      }
      if (providerIds) {
        const stored = await BoostService.find({}, { serviceId: 1, name: 1, platform: 1, enabled: 1, syncedAt: 1, _id: 0 }).lean();
        for (const sv of stored) {
          if (!providerIds.has(String(sv.serviceId))) {
            missing.push({
              serviceId: sv.serviceId, name: sv.name, platform: sv.platform, enabled: !!sv.enabled,
              lastSeen: sv.syncedAt,
              reason: 'The provider no longer lists this service ID — it was withdrawn from the panel.',
            });
          }
        }
        add('Withdrawn services', missing.length === 0,
          missing.length ? `${missing.length} stored service(s) are no longer offered by the provider.` : 'Every stored service still exists at the provider.',
          missing.length ? 'Use “Rebuild services” to drop them (orders and history are kept).' : '');
      }

      // Orders that never got a provider reference or are stuck pending.
      const [orphanOrders, stuck] = await Promise.all([
        BoostOrder.countDocuments({ providerOrderId: '' }),
        BoostOrder.countDocuments({ bucket: 'pending', createdAt: { $lt: new Date(Date.now() - 48 * 3600 * 1000) } }),
      ]);
      add('Orders linked to the provider', orphanOrders === 0,
        orphanOrders ? `${orphanOrders} order(s) have no provider reference.` : 'Every order has a provider reference.',
        orphanOrders ? 'Refund those customers manually — the provider never accepted the order.' : '');
      add('Stuck orders', stuck === 0,
        stuck ? `${stuck} order(s) have been pending for more than 48 hours.` : 'No long-running pending orders.',
        stuck ? 'Click “Refresh order statuses”; contact the provider if they never move.' : '');

      const failures = (s.syncHistory || []).filter(h => !h.ok).slice(0, 15);
      let recentErrors = [];
      try {
        if (SystemError) {
          recentErrors = await SystemError.find({ source: 'boost' }).sort({ createdAt: -1 }).limit(20).lean()
            .then(rows => rows.map(r => ({ at: r.createdAt, message: r.message, detail: String(r.detail || '').slice(0, 300) })));
        }
      } catch { /* error log is optional */ }

      res.json({
        healthy: checks.every(c => c.ok),
        checks,
        counts: { total, live, disabled, zeroRate, unmapped },
        missing: missing.slice(0, 200),
        missingCount: missing.length,
        syncFailures: failures,
        recentErrors,
        balance,
        lastSyncAt: s.lastSyncAt,
        lastError: s.lastError || '',
        running: !!catalogueSyncing,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /**
   * POST /api/admin/boost/rebuild — one-click repair.
   * Pulls a fresh list from the provider, re-stocks everything, and removes the
   * stored services the provider no longer offers. Orders/history are untouched.
   */
  app.post('/api/admin/boost/rebuild', anyAdminAuth, async (req, res) => {
    try {
      const s = await getSettings(true);
      if (!s.apiKey) return res.status(400).json({ error: 'Add the provider API key first.' });
      providerListCache = null;
      const out = await syncCatalogue({ by: `rebuild:${actorOf(req)}`, force: true });
      const list = await fetchServiceList(s, false);
      const ids = list.map(x => String(x && x.service));
      const removal = await BoostService.deleteMany({ serviceId: { $nin: ids } });
      let enabled = 0;
      if ((req.body || {}).enableAll !== false) {
        const r = await BoostService.updateMany({}, { $set: { enabled: true } });
        enabled = r.modifiedCount || 0;
      }
      invalidateCatalogueCache();
      cachedSettings = null;
      const total = await BoostService.countDocuments();
      await audit(req, 'sync', `Rebuilt services — ${total} stored, ${removal.deletedCount || 0} withdrawn removed`, null, { ...out, removed: removal.deletedCount });
      res.json({ ok: true, ...out, removed: removal.deletedCount || 0, reEnabled: enabled, stored: total });
    } catch (e) { res.status(502).json({ error: e.userMessage || e.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC DEVELOPER API — /api/v1/boost/*
  // ──────────────────────────────────────────────────────────────────────────
  // Same wallet, same pricing and the same provider as the website, exposed to
  // third-party developers with the King Social Hub API key pair:
  //     X-API-Key: ksl_live_…      X-API-Secret: …
  // Generate the pair in Settings → Developer API. Documented in docs/BOOST_API.md
  // and on /api-docs. Really Simple Social has no webhooks, so order state is
  // polled with GET /api/v1/boost/order/:id (which refreshes from the provider).
  // ══════════════════════════════════════════════════════════════════════════
  if (apiKeyAuth) {
    const fail = (res, status, message, extra) =>
      res.status(status).json({ ok: false, error: message, ...(extra || {}) });

    /** GET /api/v1/boost/services — full catalogue with your NGN price. */
    app.get('/api/v1/boost/services', apiKeyAuth, async (req, res) => {
      try {
        const s = await getSettings();
        if (!s.enabled || !s.apiKey) return fail(res, 503, s.disabledMessage || 'Boosting is under maintenance right now. Please check back shortly.');
        try { await ensureCatalogue(s); } catch { /* served from cache below */ }
        const rate = await usdToNgn(s);
        const q = { enabled: true };
        if (req.query.platform) q.platform = new RegExp('^' + String(req.query.platform).trim() + '$', 'i');
        if (req.query.search) q.name = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const list = await BoostService.find(q).sort({ platform: 1, name: 1 }).limit(2000).lean();
        res.json({
          ok: true,
          count: list.length,
          services: list.map(sv => ({
            serviceId: sv.serviceId,
            name: sv.name,
            platform: sv.platform,
            category: sv.category,
            type: sv.type,
            min: sv.min,
            max: sv.max,
            refill: !!sv.refill,
            cancel: !!sv.cancel,
            pricePer1000Ngn: quoteFor(sv, 1000, rate, s).price,
            deliveryTime: sv.deliveryTime || 'Usually starts within 0–6 hours',
          })),
        });
      } catch (e) { fail(res, 500, 'Could not load boosting services'); }
    });

    /** POST /api/v1/boost/quote { serviceId, quantity } — exact NGN price, nothing is charged. */
    app.post('/api/v1/boost/quote', apiKeyAuth, async (req, res) => {
      try {
        const s = await getSettings();
        if (!s.enabled || !s.apiKey) return fail(res, 503, s.disabledMessage || 'Boosting is under maintenance right now. Please check back shortly.');
        const sv = await BoostService.findOne({ serviceId: String(req.body.serviceId || ''), enabled: true });
        if (!sv) return fail(res, 404, 'Unknown serviceId');
        const qty = Math.floor(Number(req.body.quantity) || 0);
        if (!qty) return fail(res, 400, 'quantity is required');
        if (qty < sv.min || qty > sv.max) return fail(res, 400, `quantity must be between ${sv.min} and ${sv.max}`, { min: sv.min, max: sv.max });
        const rate = await usdToNgn(s);
        const q = quoteFor(sv, qty, rate, s);
        res.json({ ok: true, serviceId: sv.serviceId, name: sv.name, quantity: qty, priceNgn: q.price, currency: 'NGN', deliveryTime: sv.deliveryTime || 'Usually starts within 0–6 hours' });
      } catch (e) { fail(res, 500, 'Could not price that order'); }
    });

    /** POST /api/v1/boost/order { serviceId, link, quantity } — charges your King Social Hub wallet. */
    app.post('/api/v1/boost/order', apiKeyAuth, async (req, res) => {
      try {
        const s = await getSettings();
        if (!s.enabled || !s.apiKey) return fail(res, 503, s.disabledMessage || 'Boosting is under maintenance right now. Please check back shortly.');

        const sv = await BoostService.findOne({ serviceId: String(req.body.serviceId || ''), enabled: true });
        if (!sv) return fail(res, 404, 'Unknown serviceId');

        const link = String(req.body.link || '').trim();
        if (!/^https?:\/\/.+\..+/i.test(link)) return fail(res, 400, 'link must be a full URL starting with http(s)://');

        const qty = Math.floor(Number(req.body.quantity) || 0);
        if (qty < sv.min || qty > sv.max) return fail(res, 400, `quantity must be between ${sv.min} and ${sv.max}`, { min: sv.min, max: sv.max });

        const rate = await usdToNgn(s);
        const q = quoteFor(sv, qty, rate, s);

        // Debit first (prevents double-spend on concurrent calls), refund on provider failure.
        const debited = await User.findOneAndUpdate(
          { _id: req.apiUser._id, balance: { $gte: q.price } },
          { $inc: { balance: -q.price } },
          { new: true }
        );
        if (!debited) return fail(res, 402, 'Insufficient wallet balance', { priceNgn: q.price });

        let placed;
        try {
          placed = await providerCall('add', { service: sv.serviceId, link, quantity: String(qty) }, s);
        } catch (e) {
          await User.updateOne({ _id: req.apiUser._id }, { $inc: { balance: q.price } });
          return fail(res, 502, e.userMessage || e.message, { charged: false });
        }
        if (!placed || !placed.order) {
          await User.updateOne({ _id: req.apiUser._id }, { $inc: { balance: q.price } });
          return fail(res, 502, 'The provider did not accept that order — nothing was charged.', { charged: false });
        }

        const order = await BoostOrder.create({
          userId: req.apiUser._id,
          serviceId: sv.serviceId, serviceName: sv.name, platform: sv.platform, category: sv.category,
          link, quantity: qty,
          price: q.price, cost: q.cost, profit: q.profit,
          providerOrderId: String(placed.order),
          status: 'Pending', bucket: 'pending',
          deliveryTime: sv.deliveryTime || 'Usually starts within 0–6 hours',
          note: 'Placed via developer API',
        });
        await Transaction.create({
          userId: req.apiUser._id, type: 'purchase', amount: q.price,
          description: `Boost (API): ${sv.name} × ${qty.toLocaleString()}`, status: 'success',
        });

        res.json({ ok: true, orderId: String(order._id), status: 'Pending', quantity: qty, priceNgn: q.price, balanceNgn: debited.balance });
      } catch (e) { fail(res, 500, 'Could not place that boost order'); }
    });

    /** GET /api/v1/boost/order/:id — live status (pulled from the provider when still open). */
    app.get('/api/v1/boost/order/:id', apiKeyAuth, async (req, res) => {
      try {
        const order = await BoostOrder.findOne({ _id: req.params.id, userId: req.apiUser._id });
        if (!order) return fail(res, 404, 'Order not found');
        if (order.bucket === 'pending') { try { await syncOrder(order); } catch { /* serve last known state */ } }
        res.json({ ok: true, order: shapeOrder(order.toObject ? order.toObject() : order) });
      } catch (e) { fail(res, 500, 'Could not load that order'); }
    });

    /** GET /api/v1/boost/orders?status=pending|delivered|failed&limit=50 */
    app.get('/api/v1/boost/orders', apiKeyAuth, async (req, res) => {
      try {
        const filter = { userId: req.apiUser._id };
        const bucket = String(req.query.status || 'all');
        if (['pending', 'delivered', 'failed'].includes(bucket)) filter.bucket = bucket;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const orders = await BoostOrder.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
        res.json({ ok: true, count: orders.length, orders: orders.map(shapeOrder) });
      } catch (e) { fail(res, 500, 'Could not load your boost orders'); }
    });

    /** POST /api/v1/boost/order/:id/refill — only for completed, refill-enabled services. */
    app.post('/api/v1/boost/order/:id/refill', apiKeyAuth, async (req, res) => {
      try {
        const order = await BoostOrder.findOne({ _id: req.params.id, userId: req.apiUser._id });
        if (!order) return fail(res, 404, 'Order not found');
        if (order.bucket !== 'delivered') return fail(res, 400, 'Only completed orders can be refilled');
        const out = await providerCall('refill', { order: order.providerOrderId });
        order.note = `Refill requested (ref ${out.refill || 'n/a'})`;
        await order.save();
        res.json({ ok: true, refill: out.refill || '' });
      } catch (e) { fail(res, 502, e.userMessage || e.message); }
    });

    /** POST /api/v1/boost/order/:id/cancel — cancel at the provider, pro-rata refund. */
    app.post('/api/v1/boost/order/:id/cancel', apiKeyAuth, async (req, res) => {
      try {
        const order = await BoostOrder.findOne({ _id: req.params.id, userId: req.apiUser._id });
        if (!order) return fail(res, 404, 'Order not found');
        if (order.refunded) return fail(res, 400, 'Already cancelled');
        if (order.bucket !== 'pending') return fail(res, 400, 'Only running orders can be cancelled');
        let remains = order.remains;
        try {
          const info = await providerCall('status', { order: order.providerOrderId });
          if (info && !info.error) { remains = Number(info.remains) || 0; order.remains = remains; order.status = info.status || order.status; }
        } catch { /* use stored progress */ }
        const out = await providerCall('cancel', { orders: String(order.providerOrderId) });
        const row = Array.isArray(out) ? out[0] : out;
        if (row && row.error) return fail(res, 400, String(row.error));
        const split = refundSplit(order, remains);
        order.refunded = true; order.refundAmount = split.refund; order.deliveredAtCancel = split.delivered;
        order.canceledAt = new Date(); order.status = 'Canceled'; order.bucket = 'failed'; order.lastSyncAt = new Date();
        order.note = `Cancelled via API — ${split.delivered} delivered, ₦${split.refund} refunded`;
        await order.save();
        if (split.refund > 0) {
          await User.updateOne({ _id: order.userId }, { $inc: { balance: split.refund } });
          await Transaction.create({
            userId: order.userId, type: 'admin_credit', amount: split.refund,
            description: `Refund: cancelled boost ${order.serviceName}`, status: 'success',
          });
        }
        res.json({ ok: true, delivered: split.delivered, remaining: split.remaining, refundNgn: split.refund, chargedNgn: split.charged });
      } catch (e) { fail(res, 502, e.userMessage || e.message); }
    });

    /** GET /api/v1/boost/balance — your King Social Hub wallet balance in NGN. */
    app.get('/api/v1/boost/balance', apiKeyAuth, async (req, res) => {
      try {
        const u = await User.findById(req.apiUser._id).select('balance');
        res.json({ ok: true, balanceNgn: u ? u.balance || 0 : 0, currency: 'NGN' });
      } catch (e) { fail(res, 500, 'Could not load your balance'); }
    });
  }

  return { BoostSettings, BoostService, BoostOrder, getSettings, sweepOpenOrders, quoteFor };
};
