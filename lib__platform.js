/**
 * lib/platform.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The operational layer that sits on top of every deposit rail:
 *
 *   1. Payment settings   — the country → methods/currency map (Nigeria gets the
 *                           virtual account rail, everywhere else the link).
 *   2. Wallet view        — one endpoint that returns the confirmed balance and
 *                           an itemised pending vs confirmed deposit breakdown.
 *   3. Admin deposit desk — search every rail at once, manually retry a
 *                           confirmation, export CSV / PDF reports.
 *   4. Webhook ledger     — every inbound webhook is recorded with its outcome,
 *                           so failed deliveries, FX conversion errors and
 *                           idempotency conflicts are visible and alertable.
 *
 * Mounted from server.js after every model exists.
 */
const axios = require('axios');
const countries = require('./countries');
const geo = require('./geo');
const jwt = require('jsonwebtoken');
const fx = require('./fx');
const { buildTablePdf } = require('./minipdf');
const flwMethods = require('./flw-methods');

module.exports = function mountPlatform(ctx) {
  const {
    app, express, mongoose, auth, adminAuth, anyAdminAuth,
    User, Transaction, SystemError,
    VirtualAccountDeposit, PaymentLinkDeposit, BankTransferDeposit,
    retryDeposit,
  } = ctx;

  // ══════════════════════════════════════════════════════════════════════════
  // MODELS
  // ══════════════════════════════════════════════════════════════════════════
  const paymentSettingsSchema = new mongoose.Schema({
    _id: { type: String, default: 'singleton' },
    virtualAccountCountries: { type: [String], default: ['NG'] },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String, default: '' },
  }, { _id: false });
  const PaymentSettings = mongoose.models.PaymentSettings || mongoose.model('PaymentSettings', paymentSettingsSchema);

  const webhookEventSchema = new mongoose.Schema({
    provider: { type: String, default: 'flutterwave' },
    channel: { type: String, default: 'charge' },          // charge | paymentlink | virtualaccount
    event: { type: String, default: '' },
    reference: { type: String, default: '', index: true },
    txId: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: '' },
    // received → the outcome of processing it
    status: {
      type: String,
      enum: ['received', 'processed', 'ignored', 'duplicate', 'failed', 'signature_rejected', 'conversion_error'],
      default: 'received',
      index: true,
    },
    message: { type: String, default: '' },
    attempts: { type: Number, default: 1 },
    alerted: { type: Boolean, default: false },
    payload: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, index: true },
  });
  const WebhookEvent = mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', webhookEventSchema);

  const ALERT_STATUSES = ['failed', 'signature_rejected', 'conversion_error', 'duplicate'];

  // ── AUDIT TRAIL ───────────────────────────────────────────────────────────
  // Every privileged action on money (deposit retries, manual confirmations,
  // exports, settings changes) is written here BEFORE the answer goes out, so
  // "who changed what, when, and from where" is always answerable.
  const auditLogSchema = new mongoose.Schema({
    actorRole: { type: String, default: '', index: true },   // super | support | …
    actorId: { type: String, default: '' },                  // sub-admin _id, blank for the owner passcode
    actorName: { type: String, default: '' },
    actorEmail: { type: String, default: '' },
    action: { type: String, required: true, index: true },    // deposit.retry | deposit.confirm | deposit.export | payments.settings.update
    target: { type: String, default: '' },                   // e.g. paymentlink/652f…
    reference: { type: String, default: '', index: true },
    amountNgn: { type: Number, default: 0 },
    outcome: { type: String, enum: ['success', 'noop', 'denied', 'error'], default: 'success', index: true },
    message: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, index: true },
  });
  const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

  /**
   * What each admin role is allowed to do. The owner passcode ("super") keeps
   * full access; scoped sub-admins can look but not touch money.
   */
  const ROLE_PERMISSIONS = {
    super: ['deposits.view', 'deposits.retry', 'deposits.confirm', 'deposits.export', 'payments.settings', 'webhooks.view', 'audit.view'],
    support: ['deposits.view', 'webhooks.view'],
  };
  function roleCan(role, permission) {
    return (ROLE_PERMISSIONS[role] || []).includes(permission);
  }
  function actorOf(req) {
    const a = req.subAdmin;
    return {
      actorRole: req.adminRole || (a ? a.role : ''),
      actorId: a ? String(a._id) : '',
      actorName: a ? a.name : 'Owner (passcode)',
      actorEmail: a ? a.email : '',
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '',
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    };
  }
  async function writeAudit(req, entry) {
    try {
      return await AuditLog.create({ ...actorOf(req), ...entry });
    } catch (e) {
      // An audit write must never be silently lost: shout about it.
      console.error('[audit] FAILED to record', entry.action, e.message);
      await alertOps('audit_write_failed', `Audit record for ${entry.action} could not be saved`, e.message, entry);
      return null;
    }
  }

  /**
   * Gate an admin route on a single permission. Runs after anyAdminAuth, so
   * req.adminRole is already resolved. Denials are audited too — an attempt to
   * reach a privileged action is exactly what an owner wants to see.
   */
  function requirePermission(permission) {
    return async (req, res, next) => {
      if (roleCan(req.adminRole, permission)) return next();
      await writeAudit(req, {
        action: permission, target: `${req.method} ${req.path}`, outcome: 'denied',
        message: `Role "${req.adminRole || 'unknown'}" is not allowed to ${permission}`,
      });
      res.status(403).json({ error: `Your admin role cannot perform this action (${permission}).`, permission, role: req.adminRole || null });
    };
  }

  /**
   * Best-effort "who is calling?" for public endpoints. Returns the user
   * document when a valid token is present, otherwise null. Never throws.
   */
  async function optionalUser(req) {
    try {
      const h = String(req.headers.authorization || '');
      if (!h.startsWith('Bearer ')) return null;
      const payload = jwt.verify(h.slice(7), process.env.JWT_SECRET);
      const id = payload.userId || payload.id || payload._id;
      if (!id) return null;
      return await User.findById(id).select('country name email').lean();
    } catch { return null; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════════════════════
  let settingsCache = { at: 0, doc: null };

  async function getPaymentSettings(force) {
    if (!force && settingsCache.doc && Date.now() - settingsCache.at < 15_000) return settingsCache.doc;
    let doc = await PaymentSettings.findById('singleton');
    if (!doc) doc = await PaymentSettings.create({ _id: 'singleton' });
    settingsCache = { at: Date.now(), doc };
    return doc;
  }

  /** Methods a country may use. Nigeria only for the virtual-account rail. */
  async function methodsForCountry(code) {
    const country = countries.byCode(code) || countries.byCode('NG');
    const methods = countries.methodsFor(country.code);
    return {
      country: country.code,
      countryName: country.name,
      flag: country.flag,
      methods,
      payCurrency: countries.payCurrencyFor(country.code),
      localCurrency: country.currency,
      blocked: country.blocked,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ALERTING
  // ══════════════════════════════════════════════════════════════════════════
  const ALERT_URL = process.env.OPS_ALERT_WEBHOOK_URL || '';

  async function alertOps(kind, message, detail, context) {
    const line = `[ALERT:${kind}] ${message}`;
    console.error(line, detail || '');
    try { if (SystemError) await SystemError.create({ source: `alert:${kind}`, message, detail: String(detail || '').slice(0, 4000), context: context || {} }); }
    catch { /* alerting must never break a payment path */ }
    if (!ALERT_URL) return;
    try {
      await axios.post(ALERT_URL, {
        text: `${line}\n${String(detail || '').slice(0, 800)}`,
        content: `${line}\n${String(detail || '').slice(0, 800)}`, // Discord-compatible
        kind, message, detail: String(detail || '').slice(0, 2000), context: context || {},
      }, { timeout: 6000 });
    } catch (e) {
      console.warn('[alert] delivery failed:', e.message);
    }
  }

  /**
   * Record a webhook delivery and its outcome. Every rail funnels through this,
   * so the admin desk shows one unified timeline.
   */
  async function logWebhook(entry) {
    try {
      const doc = await WebhookEvent.create({
        provider: entry.provider || 'flutterwave',
        channel: entry.channel || 'charge',
        event: entry.event || '',
        reference: entry.reference || '',
        txId: String(entry.txId || ''),
        amount: Number(entry.amount || 0),
        currency: entry.currency || '',
        status: entry.status || 'received',
        message: String(entry.message || '').slice(0, 900),
        payload: entry.payload,
      });
      if (ALERT_STATUSES.includes(doc.status)) {
        await alertOps(`webhook_${doc.status}`, `${doc.channel} webhook ${doc.status}: ${doc.message || doc.event}`,
          JSON.stringify({ reference: doc.reference, txId: doc.txId, amount: doc.amount }), { webhookEventId: String(doc._id) });
        await WebhookEvent.updateOne({ _id: doc._id }, { $set: { alerted: true } });
      }
      return doc;
    } catch (e) {
      console.warn('[webhook-log] could not record event:', e.message);
      return null;
    }
  }

  /** Convenience wrappers used by the deposit pipelines. */
  const logConversionError = (message, detail, context) =>
    logWebhook({ channel: 'conversion', status: 'conversion_error', message, payload: { detail: String(detail || ''), context } });
  const logIdempotencyConflict = (reference, message, payload) =>
    logWebhook({ channel: 'idempotency', status: 'duplicate', reference, message, payload });

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC / USER ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/payments/config?country=GH — what this visitor may actually use.
   *
   * The country is resolved SERVER-SIDE and in this order: the signed-in user's
   * saved profile country → CDN header → IP lookup → the ?country= hint. A
   * client can therefore never talk its way into the Nigeria-only rails by
   * sending ?country=NG or by having a stale value in localStorage — which is
   * exactly how non-Nigerian accounts were still being shown virtual accounts.
   */
  app.get('/api/payments/config', async (req, res) => {
    try {
      const user = await optionalUser(req);
      const { code, source } = await geo.resolveCountry(req, user, { hint: req.query.country });
      const cfg = await methodsForCountry(code);
      const settings = await getPaymentSettings();
      res.json({
        ...cfg,
        countrySource: source,
        virtualAccountAvailable: cfg.methods.includes('banktransfer'),
        checkoutMethods: flwMethods.describeFor(cfg.country),
        settingsUpdatedAt: settings.updatedAt,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });


  /**
   * GET /api/user/wallet — the wallet screen in one call.
   * Confirmed balance is instant; pending money is listed separately so a user
   * always knows what has landed and what is still being confirmed.
   */
  app.get('/api/user/wallet', auth, async (req, res) => {
    try {
      const userId = req.user._id;
      // Auto-check any pending deposits for this user on-demand so they confirm without delay
      try {
        const pendingPls = await PaymentLinkDeposit.find({ userId, status: 'pending' }).limit(5);
        for (const p of pendingPls) {
          if (typeof retryDeposit === 'function') await retryDeposit('paymentlink', p._id).catch(() => {});
        }
        const pendingVas = await VirtualAccountDeposit.find({ userId, status: 'pending' }).limit(5);
        for (const p of pendingVas) {
          if (typeof retryDeposit === 'function') await retryDeposit('virtualaccount', p._id).catch(() => {});
        }
      } catch (checkErr) { /* non-blocking */ }
      const user = await User.findById(userId).select('balance country displayCurrency contactPhone name email').lean();
      const country = (user && user.country) || 'NG';
      const payCurrency = countries.payCurrencyFor(country);

      const [va, pl, bt] = await Promise.all([
        VirtualAccountDeposit.find({ userId }).sort({ createdAt: -1 }).limit(60).lean(),
        PaymentLinkDeposit.find({ userId }).sort({ createdAt: -1 }).limit(60).lean(),
        BankTransferDeposit.find({ userId }).sort({ createdAt: -1 }).limit(60).lean(),
      ]);

      const items = [];
      for (const d of va) items.push({ id: String(d._id), source: 'virtualaccount', method: 'Virtual Account', reference: d.flwRef, amountNgn: d.creditAmount || d.amount, status: d.status, createdAt: d.createdAt });
      for (const d of pl) items.push({ id: String(d._id), source: 'paymentlink', method: 'Payment Link', reference: d.txRef, amountNgn: d.creditAmount, status: d.status, createdAt: d.createdAt });
      for (const d of bt) items.push({ id: String(d._id), source: 'banktransfer', method: 'Bank Transfer', reference: d.reference, amountNgn: d.creditAmount, status: d.status, createdAt: d.createdAt });
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const pending = items.filter(i => i.status === 'pending');
      const confirmed = items.filter(i => i.status === 'success');
      const failed = items.filter(i => i.status === 'failed' || i.status === 'expired');
      const sum = list => list.reduce((a, i) => a + (Number(i.amountNgn) || 0), 0);

      let rate = null;
      if (payCurrency !== 'NGN') {
        try { rate = 1 / (await fx.convert(1, payCurrency, 'NGN')); } catch { rate = null; }
      }
      const inPay = ngn => (payCurrency === 'NGN' ? ngn : (rate ? Math.round(ngn * rate * 100) / 100 : null));

      res.json({
        balance: { ngn: user ? user.balance || 0 : 0, display: inPay(user ? user.balance || 0 : 0), currency: payCurrency },
        country,
        payCurrency,
        totals: {
          confirmedNgn: sum(confirmed),
          pendingNgn: sum(pending),
          failedNgn: sum(failed),
          confirmedDisplay: inPay(sum(confirmed)),
          pendingDisplay: inPay(sum(pending)),
        },
        pending: pending.slice(0, 25),
        confirmed: confirmed.slice(0, 25),
        failed: failed.slice(0, 10),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PROFILE GATE — every account must carry a phone number + country
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/user/profile-status
   * The frontend calls this on every page load. When `needsProfile` is true the
   * blocking "add your phone number" modal is shown — including for Google
   * sign-ups, which never collect a phone. Once saved it never appears again.
   */
  app.get('/api/user/profile-status', auth, async (req, res) => {
    try {
      const user = await User.findById(req.user._id).select('contactPhone country name email').lean();
      if (!user) return res.status(404).json({ error: 'User not found' });
      const country = String(user.country || '').toUpperCase();
      const needsProfile = !user.contactPhone || !country;
      const cfg = needsProfile ? null : await methodsForCountry(country);
      res.json({
        needsProfile,
        phone: user.contactPhone || '',
        country: country || '',
        countryName: country ? (countries.byCode(country) || {}).name || '' : '',
        methods: cfg ? cfg.methods : [],
        payCurrency: country ? countries.payCurrencyFor(country) : null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /api/countries — dial codes + flags for the country picker. */
  app.get('/api/countries', (req, res) => {
    const q = String(req.query.q || '').trim();
    const list = q ? countries.search(q) : countries.COUNTRIES;
    res.json(list.filter(c => !c.blocked).map(c => ({
      code: c.code, name: c.name, dialCode: c.dialCode, flag: c.flag,
      currency: c.currency, payCurrency: c.payCurrency, methods: c.methods,
    })));
  });

  /**
   * PUT /api/user/profile/phone — country-aware phone update.
   * Accepts any supported country (not just Nigeria) and stores the number in
   * E.164 form, then reports back which payment methods the user just unlocked.
   */
  app.put('/api/user/profile/phone', auth, express.json(), async (req, res) => {
    try {
      const code = String((req.body && req.body.country) || '').toUpperCase();
      const raw = String((req.body && req.body.phone) || '').trim();
      const country = countries.byCode(code);
      if (!country) return res.status(400).json({ error: 'Please choose your country from the list.' });
      if (country.blocked) return res.status(403).json({ error: 'We are unable to serve customers in this country.' });
      const normalized = countries.normalizePhone(code, raw);
      if (!normalized) return res.status(400).json({ error: `Enter a valid ${country.name} phone number (e.g. ${country.dialCode} 8012345678).` });

      const dup = await User.findOne({ contactPhone: normalized, _id: { $ne: req.user._id } }).select('_id').lean();
      if (dup) return res.status(409).json({ error: 'That phone number is already linked to another account.' });

      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const switchedAway = String(user.country || '').toUpperCase() === 'NG' && code !== 'NG';
      user.contactPhone = normalized;
      user.country = code;
      await user.save();

      // A Nigerian virtual account cannot follow a user abroad — retire it.
      if (switchedAway && user.virtualAccount && user.virtualAccount.enabled) {
        user.virtualAccount.enabled = false;
        await user.save();
      }

      const cfg = await methodsForCountry(code);
      res.json({
        message: 'Phone number and country saved',
        phone: normalized,
        country: code,
        countryName: country.name,
        methods: cfg.methods,
        payCurrency: countries.payCurrencyFor(code),
        needsProfile: false,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — SETTINGS
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/api/admin/payments/settings', anyAdminAuth, requirePermission('payments.settings'), async (req, res) => {
    const s = await getPaymentSettings(true);
    res.json({ virtualAccountCountries: s.virtualAccountCountries || ['NG'], updatedAt: s.updatedAt });
  });

  app.put('/api/admin/payments/settings', anyAdminAuth, requirePermission('payments.settings'), express.json(), async (req, res) => {
    try {
      const update = { updatedAt: new Date(), updatedBy: 'owner' };
      // Virtual accounts stay Nigeria-only until Flutterwave approves another
      // market on this merchant account, so the list is not editable here.
      const s = await PaymentSettings.findByIdAndUpdate('singleton', { $set: update }, { new: true, upsert: true });
      settingsCache = { at: Date.now(), doc: s };
      await writeAudit(req, {
        action: 'payments.settings.update', target: 'paymentSettings',
        outcome: 'success', message: 'payment settings updated',
        meta: {},
      });
      res.json({ ok: true, virtualAccountCountries: s.virtualAccountCountries || ['NG'] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — DEPOSIT DESK
  // ══════════════════════════════════════════════════════════════════════════

  /** Pull matching deposits from every rail into one normalised list. */
  async function searchDeposits({ q, status, source, from, to, limit }) {
    const cap = Math.min(Number(limit) || 200, 2000);
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(new Date(to).getTime() + 86_399_000);
    const dateFilter = Object.keys(range).length ? { createdAt: range } : {};

    // Resolve a free-text query to user ids as well as references.
    let userIds = [];
    if (q) {
      const users = await User.find({
        $or: [
          { email: new RegExp(escapeRe(q), 'i') },
          { name: new RegExp(escapeRe(q), 'i') },
          { contactPhone: new RegExp(escapeRe(q), 'i') },
          ...(mongoose.isValidObjectId(q) ? [{ _id: q }] : []),
        ],
      }).select('_id').limit(50).lean();
      userIds = users.map(u => u._id);
    }

    function refQuery(fields) {
      if (!q) return {};
      const or = fields.map(f => ({ [f]: new RegExp(escapeRe(q), 'i') }));
      if (userIds.length) or.push({ userId: { $in: userIds } });
      return { $or: or };
    }

    const wanted = s => !source || source === 'all' || source === s;
    const tasks = [];

    if (wanted('virtualaccount')) tasks.push(VirtualAccountDeposit.find({ ...dateFilter, ...refQuery(['flwRef', 'flwTxId', 'accountNumber']) }).sort({ createdAt: -1 }).limit(cap).lean()
      .then(rows => rows.map(d => norm('virtualaccount', 'Virtual Account', d, d.flwRef, d.creditAmount || d.amount, d.status))));
    if (wanted('paymentlink')) tasks.push(PaymentLinkDeposit.find({ ...dateFilter, ...refQuery(['txRef', 'flwTransactionId', 'gatewayTxId']) }).sort({ createdAt: -1 }).limit(cap).lean()
      .then(rows => rows.map(d => norm('paymentlink', 'Payment Link', d, d.txRef, d.creditAmount, d.status))));
    if (wanted('banktransfer')) tasks.push(BankTransferDeposit.find({ ...dateFilter, ...refQuery(['reference', 'flwChargeId', 'accountNumber']) }).sort({ createdAt: -1 }).limit(cap).lean()
      .then(rows => rows.map(d => norm('banktransfer', 'Bank Transfer', d, d.reference, d.creditAmount, d.status))));

    let rows = (await Promise.all(tasks)).flat();
    if (status && status !== 'all') rows = rows.filter(r => r.status === status);
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    rows = rows.slice(0, cap);

    // Attach the customer to each row.
    const ids = [...new Set(rows.map(r => String(r.userId)).filter(Boolean))];
    const users = await User.find({ _id: { $in: ids } }).select('name email contactPhone country').lean();
    const byId = new Map(users.map(u => [String(u._id), u]));
    for (const r of rows) {
      const u = byId.get(String(r.userId));
      r.user = u ? { name: u.name, email: u.email, phone: u.contactPhone || '', country: u.country || '' } : null;
    }
    return rows;
  }

  function norm(source, method, d, reference, amountNgn, status) {
    return {
      id: String(d._id), source, method, reference: reference || '',
      amountNgn: Number(amountNgn || 0), status, userId: d.userId,
      createdAt: d.createdAt, creditedAt: d.creditedAt || null,
      providerRef: d.flwRef || d.flwTransactionId || d.flwChargeId || d.providerRef || '',
    };
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** GET /api/admin/deposits/search?q=&status=&source=&from=&to= */
  app.get('/api/admin/deposits/search', anyAdminAuth, requirePermission('deposits.view'), async (req, res) => {
    try {
      const rows = await searchDeposits(req.query);
      const totals = rows.reduce((acc, r) => {
        acc.count++;
        acc[r.status] = (acc[r.status] || 0) + 1;
        if (r.status === 'success') acc.creditedNgn += r.amountNgn;
        if (r.status === 'pending') acc.pendingNgn += r.amountNgn;
        return acc;
      }, { count: 0, creditedNgn: 0, pendingNgn: 0 });
      res.json({ totals, deposits: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** POST /api/admin/deposits/:source/:id/retry — re-run confirmation by hand. */
  app.post('/api/admin/deposits/:source/:id/retry', anyAdminAuth, requirePermission('deposits.retry'), express.json(), async (req, res) => {
    const target = `${req.params.source}/${req.params.id}`;
    try {
      if (typeof retryDeposit !== 'function') return res.status(501).json({ error: 'Retry pipeline unavailable' });
      const out = await retryDeposit(req.params.source, req.params.id);
      await logWebhook({
        channel: 'manual-retry', event: 'admin.retry', reference: out.reference || req.params.id,
        status: out.credited ? 'processed' : (out.ok ? 'ignored' : 'failed'),
        message: out.message || '', amount: out.creditNgn || 0, payload: { source: req.params.source },
      });
      await writeAudit(req, {
        action: 'deposit.retry', target, reference: out.reference || '',
        amountNgn: out.creditNgn || 0,
        outcome: out.ok ? (out.credited ? 'success' : 'noop') : 'error',
        message: out.message || '',
        meta: { source: req.params.source, credited: Boolean(out.credited), note: String((req.body && req.body.note) || '').slice(0, 300) },
      });
      res.json(out);
    } catch (e) {
      await writeAudit(req, { action: 'deposit.retry', target, outcome: 'error', message: e.message });
      await alertOps('manual_retry_failed', `Manual retry failed for ${target}`, e.stack || e.message, {});
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/admin/deposits/:source/:id/confirm — manual confirmation.
   * Same idempotent pipeline as the retry, but it is a deliberate, separate
   * action so the audit trail distinguishes "I re-checked the provider" from
   * "I confirmed this payment by hand". A reason is mandatory.
   */
  app.post('/api/admin/deposits/:source/:id/confirm', anyAdminAuth, requirePermission('deposits.confirm'), express.json(), async (req, res) => {
    const target = `${req.params.source}/${req.params.id}`;
    const reason = String((req.body && req.body.reason) || '').trim();
    if (reason.length < 5) {
      await writeAudit(req, { action: 'deposit.confirm', target, outcome: 'denied', message: 'No reason supplied' });
      return res.status(400).json({ error: 'Please state why you are confirming this deposit by hand (min 5 characters).' });
    }
    try {
      const out = await retryDeposit(req.params.source, req.params.id);
      await logWebhook({
        channel: 'manual-confirm', event: 'admin.confirm', reference: out.reference || req.params.id,
        status: out.credited ? 'processed' : (out.ok ? 'ignored' : 'failed'),
        message: `${out.message || ''} — reason: ${reason}`, amount: out.creditNgn || 0,
        payload: { source: req.params.source, reason },
      });
      await writeAudit(req, {
        action: 'deposit.confirm', target, reference: out.reference || '',
        amountNgn: out.creditNgn || 0,
        outcome: out.ok ? (out.credited ? 'success' : 'noop') : 'error',
        message: `${out.message || ''} — reason: ${reason}`,
        meta: { source: req.params.source, reason, credited: Boolean(out.credited) },
      });
      res.json(out);
    } catch (e) {
      await writeAudit(req, { action: 'deposit.confirm', target, outcome: 'error', message: `${e.message} — reason: ${reason}` });
      await alertOps('manual_confirm_failed', `Manual confirmation failed for ${target}`, e.stack || e.message, {});
      res.status(500).json({ error: e.message });
    }
  });

  // ── Exports ────────────────────────────────────────────────────────────────
  const EXPORT_COLUMNS = [
    { header: 'Date', key: 'date', width: 1.3 },
    { header: 'Method', key: 'method', width: 1.4 },
    { header: 'Reference', key: 'reference', width: 2.2 },
    { header: 'Customer', key: 'customer', width: 1.8 },
    { header: 'Email', key: 'email', width: 2 },
    { header: 'Country', key: 'country', width: 0.7 },
    { header: 'Amount (NGN)', key: 'amount', width: 1.1 },
    { header: 'Status', key: 'status', width: 0.9 },
  ];

  function toExportRows(rows) {
    return rows.map(r => ({
      date: new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 16),
      method: r.method,
      reference: r.reference,
      customer: r.user ? r.user.name : '(unknown)',
      email: r.user ? r.user.email : '',
      country: r.user ? r.user.country : '',
      amount: Number(r.amountNgn || 0).toLocaleString('en-NG'),
      status: r.status,
    }));
  }

  app.get('/api/admin/deposits/export.csv', anyAdminAuth, requirePermission('deposits.export'), async (req, res) => {
    try {
      const rows = toExportRows(await searchDeposits({ ...req.query, limit: 5000 }));
      await writeAudit(req, {
        action: 'deposit.export', target: 'csv', outcome: 'success',
        message: `Exported ${rows.length} deposit row(s) as CSV`,
        meta: { format: 'csv', rows: rows.length, filters: req.query },
      });
      const head = EXPORT_COLUMNS.map(c => c.header).join(',');
      const body = rows.map(r => EXPORT_COLUMNS.map(c => `"${String(r[c.key] == null ? '' : r[c.key]).replace(/"/g, '""')}"`).join(',')).join('\n');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="kls-deposits-${Date.now()}.csv"`);
      res.send('\uFEFF' + head + '\n' + body);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/deposits/export.pdf', anyAdminAuth, requirePermission('deposits.export'), async (req, res) => {
    try {
      const raw = await searchDeposits({ ...req.query, limit: 2000 });
      const rows = toExportRows(raw);
      await writeAudit(req, {
        action: 'deposit.export', target: 'pdf', outcome: 'success',
        message: `Exported ${rows.length} deposit row(s) as PDF`,
        meta: { format: 'pdf', rows: rows.length, filters: req.query },
      });
      const credited = raw.filter(r => r.status === 'success').reduce((a, r) => a + r.amountNgn, 0);
      const pdf = buildTablePdf({
        title: 'KLS Deposit Report',
        subtitle: `${rows.length} deposit(s) - credited NGN ${credited.toLocaleString('en-NG')} - generated ${new Date().toUTCString()}`,
        columns: EXPORT_COLUMNS,
        rows,
      });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="kls-deposits-${Date.now()}.pdf"`);
      res.send(pdf);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — WEBHOOK LEDGER & ALERTS
  // ══════════════════════════════════════════════════════════════════════════
  app.get('/api/admin/webhooks', anyAdminAuth, requirePermission('webhooks.view'), async (req, res) => {
    try {
      const query = {};
      if (req.query.status && req.query.status !== 'all') query.status = req.query.status;
      if (req.query.channel && req.query.channel !== 'all') query.channel = req.query.channel;
      if (req.query.q) query.$or = [
        { reference: new RegExp(escapeRe(req.query.q), 'i') },
        { txId: new RegExp(escapeRe(req.query.q), 'i') },
        { message: new RegExp(escapeRe(req.query.q), 'i') },
      ];
      const events = await WebhookEvent.find(query).sort({ createdAt: -1 }).limit(Number(req.query.limit) || 200).lean();
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const problems = await WebhookEvent.countDocuments({ createdAt: { $gte: since }, status: { $in: ALERT_STATUSES } });
      res.json({ events, problems24h: problems });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/webhooks/health', anyAdminAuth, requirePermission('webhooks.view'), async (req, res) => {
    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const agg = await WebhookEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      const byStatus = Object.fromEntries(agg.map(a => [a._id, a.count]));
      res.json({ window: '24h', byStatus, healthy: !ALERT_STATUSES.some(s => byStatus[s]) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN — AUDIT TRAIL
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /api/admin/audit-logs?action=&outcome=&actor=&q=&from=&to= */
  app.get('/api/admin/audit-logs', anyAdminAuth, requirePermission('audit.view'), async (req, res) => {
    try {
      const query = {};
      if (req.query.action && req.query.action !== 'all') query.action = req.query.action;
      if (req.query.outcome && req.query.outcome !== 'all') query.outcome = req.query.outcome;
      if (req.query.role && req.query.role !== 'all') query.actorRole = req.query.role;
      if (req.query.actor) query.$or = [
        { actorName: new RegExp(escapeRe(req.query.actor), 'i') },
        { actorEmail: new RegExp(escapeRe(req.query.actor), 'i') },
      ];
      if (req.query.q) query.$and = [{ $or: [
        { reference: new RegExp(escapeRe(req.query.q), 'i') },
        { target: new RegExp(escapeRe(req.query.q), 'i') },
        { message: new RegExp(escapeRe(req.query.q), 'i') },
      ] }];
      if (req.query.from || req.query.to) {
        query.createdAt = {};
        if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
        if (req.query.to) query.createdAt.$lte = new Date(new Date(req.query.to).getTime() + 86_399_000);
      }
      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const denied24h = await AuditLog.countDocuments({ createdAt: { $gte: since }, outcome: 'denied' });
      res.json({ logs, denied24h, permissions: ROLE_PERMISSIONS, yourRole: req.adminRole || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /api/admin/audit-logs/export.csv — the trail itself is exportable. */
  app.get('/api/admin/audit-logs/export.csv', anyAdminAuth, requirePermission('audit.view'), async (req, res) => {
    try {
      const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(5000).lean();
      const cols = ['createdAt', 'actorRole', 'actorName', 'actorEmail', 'action', 'target', 'reference', 'amountNgn', 'outcome', 'message', 'ip'];
      const body = logs.map(l => cols.map(c => `"${String(l[c] == null ? '' : l[c]).replace(/"/g, '""')}"`).join(',')).join('\n');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="kls-audit-${Date.now()}.csv"`);
      res.send('\uFEFF' + cols.join(',') + '\n' + body);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /api/admin/whoami — lets the admin UI hide controls the role cannot use. */
  app.get('/api/admin/whoami', anyAdminAuth, (req, res) => {
    res.json({
      role: req.adminRole || null,
      name: req.subAdmin ? req.subAdmin.name : 'Owner',
      email: req.subAdmin ? req.subAdmin.email : '',
      permissions: ROLE_PERMISSIONS[req.adminRole] || [],
    });
  });

  return {
    AuditLog, writeAudit, roleCan, requirePermission, ROLE_PERMISSIONS,
    PaymentSettings, WebhookEvent,
    getPaymentSettings, methodsForCountry,
    logWebhook, logConversionError, logIdempotencyConflict, alertOps,
    searchDeposits,
  };
};
