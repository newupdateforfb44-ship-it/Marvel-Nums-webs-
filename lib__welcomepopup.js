// ── Welcome Popup (WhatsApp channel promo) ──────────────────────────────────
// One settings document in MongoDB, edited from Admin → Welcome Popup.
//   GET  /api/welcome-popup            public  - only the fields customers need
//   GET  /api/admin/welcome-popup      admin   - full settings (+ defaults)
//   PUT  /api/admin/welcome-popup      admin   - validate + save
//   POST /api/admin/welcome-popup/reset admin  - restore defaults (keeps nothing else)
// Admin routes use the same passcode check (adminAuth) as the rest of the owner-only
// settings; support sub-admins cannot change them. Everything is validated here on
// the server - the browser-side checks are only for convenience.

const DEFAULTS = Object.freeze({
  enabled: false,           // switched on by the admin once a channel link is saved
  channelUrl: '',
  heading: 'Welcome to King Social Hub',
  subtitle: "We're happy to have you here! 🎉",
  description: 'King Social Hub is your trusted marketplace for premium digital products, social media services and more.',
  additionalMessage: 'Stay connected with us so you never miss important updates, new services and special offers.',
  whatsappButtonText: 'Join Our WhatsApp Channel',
  dismissButtonText: 'Maybe Later',
  displayFrequency: 'first',
  displayDelay: 1000,
  eligiblePages: ['all']
});

const FREQUENCIES = ['first', '7d', '15d', '30d', 'every'];
const DELAYS = [0, 1000, 3000, 5000];
const PAGES = ['dashboard', 'home', 'marketplace', 'all'];
const LIMITS = { heading: 120, subtitle: 160, description: 500, additionalMessage: 500, whatsappButtonText: 60, dismissButtonText: 60, channelUrl: 300 };

// Plain text only: strip tags and control characters, collapse nothing else so line breaks survive.
function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

// Accepts https://whatsapp.com/channel/<id> (and the www. form). Returns the cleaned URL,
// '' when empty, or null when it is not a legitimate WhatsApp channel link.
function normaliseChannelUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.length > LIMITS.channelUrl) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (host !== 'whatsapp.com' && host !== 'www.whatsapp.com') return null;
  const m = u.pathname.match(/^\/channel\/([A-Za-z0-9_-]{6,80})\/?$/);
  if (!m) return null;
  return `https://${host}/channel/${m[1]}`;
}

// Returns { ok, value } or { ok:false, error }.
function validate(body) {
  const b = body || {};
  const out = {};
  if (typeof b.enabled !== 'boolean') return { ok: false, error: 'Enabled must be on or off.' };
  out.enabled = b.enabled;

  const url = normaliseChannelUrl(b.channelUrl);
  if (url === null) return { ok: false, error: 'Enter a valid WhatsApp channel link, like https://whatsapp.com/channel/XXXXXXXX (https only).' };
  out.channelUrl = url;

  for (const k of ['heading', 'subtitle', 'description', 'additionalMessage', 'whatsappButtonText', 'dismissButtonText']) {
    const raw = String(b[k] == null ? '' : b[k]);
    if (raw.length > LIMITS[k] * 3) return { ok: false, error: `${k} is far too long (max ${LIMITS[k]} characters).` };
    const v = cleanText(raw, LIMITS[k] + 1);
    if (v.length > LIMITS[k]) return { ok: false, error: `${k} is too long (max ${LIMITS[k]} characters).` };
    out[k] = v;
  }
  if (!out.heading) return { ok: false, error: 'The heading cannot be empty.' };
  if (!out.whatsappButtonText) return { ok: false, error: 'The WhatsApp button text cannot be empty.' };
  if (!out.dismissButtonText) return { ok: false, error: 'The "Maybe Later" button text cannot be empty.' };

  if (!FREQUENCIES.includes(b.displayFrequency)) return { ok: false, error: 'Pick how often the popup should appear.' };
  out.displayFrequency = b.displayFrequency;

  const delay = Number(b.displayDelay);
  if (!DELAYS.includes(delay)) return { ok: false, error: 'Pick a valid delay.' };
  out.displayDelay = delay;

  if (!Array.isArray(b.eligiblePages) || !b.eligiblePages.length) return { ok: false, error: 'Choose at least one page for the popup to appear on.' };
  const pages = [...new Set(b.eligiblePages.map(String))];
  if (pages.some(p => !PAGES.includes(p))) return { ok: false, error: 'Unknown page selection.' };
  out.eligiblePages = pages;

  if (out.enabled && !out.channelUrl) {
    // Allowed (customers then see a "not configured" note) but it is almost never what the admin wants.
    out.warning = 'The popup is on but no WhatsApp channel link is saved, so the button will be disabled for customers.';
  }
  return { ok: true, value: out };
}

function register(app, deps) {
  const { mongoose, adminAuth } = deps;

  const schema = new mongoose.Schema({
    key: { type: String, default: 'main', unique: true },
    enabled: { type: Boolean, default: DEFAULTS.enabled },
    channelUrl: { type: String, default: DEFAULTS.channelUrl },
    heading: { type: String, default: DEFAULTS.heading },
    subtitle: { type: String, default: DEFAULTS.subtitle },
    description: { type: String, default: DEFAULTS.description },
    additionalMessage: { type: String, default: DEFAULTS.additionalMessage },
    whatsappButtonText: { type: String, default: DEFAULTS.whatsappButtonText },
    dismissButtonText: { type: String, default: DEFAULTS.dismissButtonText },
    displayFrequency: { type: String, default: DEFAULTS.displayFrequency },
    displayDelay: { type: Number, default: DEFAULTS.displayDelay },
    eligiblePages: { type: [String], default: DEFAULTS.eligiblePages },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: '' }
  });
  const WelcomePopup = mongoose.models.WelcomePopup || mongoose.model('WelcomePopup', schema);

  const fields = Object.keys(DEFAULTS);
  const pick = (doc) => {
    const o = {};
    for (const k of fields) o[k] = doc && doc[k] !== undefined && doc[k] !== null ? doc[k] : DEFAULTS[k];
    return o;
  };

  async function load() {
    try { return pick(await WelcomePopup.findOne({ key: 'main' }).lean()); }
    catch (e) { return { ...DEFAULTS, eligiblePages: [...DEFAULTS.eligiblePages] }; }
  }

  // Public - only what a customer needs. Short cache so admin edits show up within a minute.
  app.get('/api/welcome-popup', async (req, res) => {
    try {
      const s = await load();
      res.set('Cache-Control', 'public, max-age=30');
      res.json({
        enabled: !!s.enabled,
        channelUrl: s.channelUrl,
        heading: s.heading, subtitle: s.subtitle, description: s.description, additionalMessage: s.additionalMessage,
        whatsappButtonText: s.whatsappButtonText, dismissButtonText: s.dismissButtonText,
        displayFrequency: s.displayFrequency, displayDelay: s.displayDelay, eligiblePages: s.eligiblePages
      });
    } catch (e) {
      res.set('Cache-Control', 'no-store');
      res.json({ enabled: false });
    }
  });

  app.get('/api/admin/welcome-popup', adminAuth, async (req, res) => {
    try {
      const doc = await WelcomePopup.findOne({ key: 'main' }).lean();
      res.json({ settings: pick(doc), updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || '', defaults: DEFAULTS, limits: LIMITS });
    } catch (e) { res.status(500).json({ error: 'Could not load the popup settings.' }); }
  });

  app.put('/api/admin/welcome-popup', adminAuth, async (req, res) => {
    const v = validate(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    try {
      const { warning, ...set } = v.value;
      set.updatedAt = new Date();
      set.updatedBy = 'Admin';
      await WelcomePopup.updateOne({ key: 'main' }, { $set: set, $setOnInsert: { key: 'main' } }, { upsert: true });
      const doc = await WelcomePopup.findOne({ key: 'main' }).lean();
      res.json({ ok: true, warning: warning || '', settings: pick(doc), updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
    } catch (e) { console.error('[WelcomePopup] save failed:', e.message); res.status(500).json({ error: 'Could not save. Please try again.' }); }
  });

  app.post('/api/admin/welcome-popup/reset', adminAuth, async (req, res) => {
    try {
      const set = { ...DEFAULTS, eligiblePages: [...DEFAULTS.eligiblePages], updatedAt: new Date(), updatedBy: 'Admin' };
      await WelcomePopup.updateOne({ key: 'main' }, { $set: set, $setOnInsert: { key: 'main' } }, { upsert: true });
      const doc = await WelcomePopup.findOne({ key: 'main' }).lean();
      res.json({ ok: true, settings: pick(doc), updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
    } catch (e) { res.status(500).json({ error: 'Could not reset the settings.' }); }
  });
}

module.exports = { register, validate, normaliseChannelUrl, DEFAULTS };
