// ── King Social Hub engagement settings store ───────────────────────────────────────────
// One tiny Mongo document holds every knob the owner can turn from the admin
// panel (win-back timing, referral bonuses, campaign
// pause switches). Env vars stay as the defaults, so nothing breaks if the
// document has never been saved.
//
// The value is cached in memory and refreshed on save + every 60s, so hot paths
// (the win-back sweep) never pay a database round trip.

const DEFAULTS = () => ({
  // Win-back ("we miss you") campaign
  winbackEnabled: false, // win-back ("we miss you") emails are permanently off
  winbackIdleDays: Number(process.env.WINBACK_IDLE_DAYS || 4),
  winbackCooldownDays: Number(process.env.WINBACK_COOLDOWN_DAYS || 7),
  winbackBatch: Number(process.env.WINBACK_BATCH || 40),
  winbackSweepHours: Number(process.env.WINBACK_SWEEP_HOURS || 6),

  // Referral: paid out when the invited customer first buys or deposits
  referralEnabled: true,
  referrerBonus: Number(process.env.REFERRAL_REFERRER_BONUS || 300),
  refereeBonus: Number(process.env.REFERRAL_REFEREE_BONUS || 200),
  referralMinAmount: Number(process.env.REFERRAL_MIN_AMOUNT || 500),

  // Welcome email on account creation
  welcomeEmailEnabled: true,

  // Email deliverability alerts (Resend bounce + failure spikes)
  mailAlertsEnabled: true,
  mailAlertWindowMinutes: Number(process.env.MAIL_ALERT_WINDOW_MIN || 60),
  mailAlertMinVolume: Number(process.env.MAIL_ALERT_MIN_VOLUME || 10),
  mailAlertBounceRate: Number(process.env.MAIL_ALERT_BOUNCE_RATE || 10),
  mailAlertFailRate: Number(process.env.MAIL_ALERT_FAIL_RATE || 20),
  mailAlertFailCount: Number(process.env.MAIL_ALERT_FAIL_COUNT || 5),
  mailAlertCooldownMinutes: Number(process.env.MAIL_ALERT_COOLDOWN_MIN || 120),
  mailAlertEmail: String(process.env.MAIL_ALERT_EMAIL || process.env.SUPPORT_EMAIL || '')
});

// Every field is a plain number/boolean, so validation is simple and total.
const NUMERIC = [
  'winbackIdleDays', 'winbackCooldownDays', 'winbackBatch', 'winbackSweepHours',
  'referrerBonus', 'refereeBonus', 'referralMinAmount',
  'mailAlertWindowMinutes', 'mailAlertMinVolume', 'mailAlertBounceRate',
  'mailAlertFailRate', 'mailAlertFailCount', 'mailAlertCooldownMinutes'
];
const STRING = ['mailAlertEmail'];
const BOOLEAN = ['winbackEnabled', 'referralEnabled', 'welcomeEmailEnabled', 'mailAlertsEnabled'];

const LIMITS = {
  winbackIdleDays: [1, 365], winbackCooldownDays: [1, 365], winbackBatch: [1, 500],
  winbackSweepHours: [1, 168], referrerBonus: [0, 1000000], refereeBonus: [0, 1000000],
  referralMinAmount: [0, 10000000],
  mailAlertWindowMinutes: [5, 1440], mailAlertMinVolume: [1, 100000],
  mailAlertBounceRate: [1, 100], mailAlertFailRate: [1, 100],
  mailAlertFailCount: [1, 100000], mailAlertCooldownMinutes: [5, 10080]
};

let cache = DEFAULTS();
let Model = null;
let lastLoad = 0;

function init(mongoose) {
  if (Model) return Model;
  const schema = new mongoose.Schema({
    key: { type: String, unique: true, default: 'engagement' },
    values: { type: Object, default: {} },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String, default: '' }
  });
  Model = mongoose.models.EngagementSetting || mongoose.model('EngagementSetting', schema);
  load().catch(() => {});
  setInterval(() => { load().catch(() => {}); }, 60 * 1000);
  return Model;
}

async function load(force) {
  if (!Model) return cache;
  if (!force && Date.now() - lastLoad < 5000) return cache;
  lastLoad = Date.now();
  const doc = await Model.findOne({ key: 'engagement' }).lean();
  cache = { ...DEFAULTS(), ...(doc?.values || {}) };
  return cache;
}

/** Current settings — always safe to call, always synchronous. */
function get() {
  return cache;
}

/** Coerce whatever the admin panel sent into a clean, in-range patch. */
function sanitize(patch = {}) {
  const out = {};
  for (const k of NUMERIC) {
    if (patch[k] === undefined || patch[k] === null || patch[k] === '') continue;
    const n = Number(patch[k]);
    if (!Number.isFinite(n)) continue;
    const [min, max] = LIMITS[k];
    out[k] = Math.min(max, Math.max(min, n));
  }
  for (const k of STRING) {
    if (patch[k] === undefined || patch[k] === null) continue;
    out[k] = String(patch[k]).trim().slice(0, 200);
  }
  for (const k of BOOLEAN) {
    if (patch[k] === undefined) continue;
    out[k] = patch[k] === true || patch[k] === 'true' || patch[k] === 1 || patch[k] === '1';
  }
  return out;
}

async function update(patch, who) {
  if (!Model) return cache;
  const clean = sanitize(patch);
  const current = await load(true);
  const values = { ...current, ...clean };
  await Model.updateOne(
    { key: 'engagement' },
    { $set: { values, updatedAt: new Date(), updatedBy: String(who || 'admin') } },
    { upsert: true }
  );
  cache = { ...DEFAULTS(), ...values };
  return cache;
}

module.exports = { init, load, get, update, sanitize, DEFAULTS };
