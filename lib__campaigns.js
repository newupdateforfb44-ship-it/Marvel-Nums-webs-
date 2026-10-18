// ── King Social Hub campaigns, email delivery tracking & referral rewards ───────────────
// Mounted once from server.js, after lib/engagement.js. Everything here is
// additive — remove the mount and the rest of the site is unaffected.
//
//   1. Email delivery log  — every send attempt from lib/mailer.js is recorded,
//      then enriched by Resend webhooks with opens, clicks, bounces and
//      spam complaints, and surfaced in the admin "Email Delivery" dashboard.
//   2. Welcome email       — sent the moment an account is created (email or
//      Google sign-up), so the customer gets a real message in their inbox.
//   3. Admin campaign panel— live control over win-back timing
//      amounts, referral bonuses, plus pause switches and a manual "run now".
//   4. Referral rewards    — the referrer AND the new customer both get wallet
//      credit the first time the new customer buys something or funds their
//      wallet. Paid once per referred account.
const crypto = require('crypto');
const mailer = require('./mailer');
const settings = require('./settings');

const { sendMail } = mailer;

function siteUrl() {
  return (process.env.SITE_URL || '').replace(/\/$/, '') || 'https://klslogs.com';
}
function money(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG');
}

module.exports = function initCampaigns(ctx) {
  const { app, mongoose, User, Transaction, auth, anyAdminAuth, engagement, AdminAccount } = ctx;

  settings.init(mongoose);

  // ══ 1. EMAIL DELIVERY LOG ═════════════════════════════════════════════════
  const emailLogSchema = new mongoose.Schema({
    to: { type: String, index: true },
    subject: String,
    category: { type: String, default: 'general', index: true }, // password_reset | winback | welcome | referral | …
    provider: { type: String, default: '', index: true },        // resend | none
    status: { type: String, default: 'sent', index: true },      // sent | failed | delivered | opened | clicked | bounced | complained
    messageId: { type: String, default: '', index: true },
    error: { type: String, default: '' },
    failover: { type: Boolean, default: false },                 // primary provider failed, backup saved it
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    openedAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null },
    bouncedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    opens: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    lastEvent: { type: String, default: '' },
    lastEventAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now, index: true }
  });
  const EmailLog = mongoose.models.EmailLog || mongoose.model('EmailLog', emailLogSchema);

  // Every send attempt made anywhere in the app now lands here.
  mailer.setLogger(async (entry) => {
    try {
      await EmailLog.create({
        to: String(entry.to || '').toLowerCase(),
        subject: String(entry.subject || '').slice(0, 300),
        category: entry.category || 'general',
        provider: entry.provider || '',
        status: entry.status || 'sent',
        messageId: entry.messageId || '',
        error: String(entry.error || '').slice(0, 600),
        failover: !!entry.failover,
        userId: entry.userId || null
      });
    } catch (e) { console.error('[emaillog] write failed:', e.message); }
  });

  // Keep the log from growing forever — 90 days of history is plenty.
  setInterval(() => {
    EmailLog.deleteMany({ createdAt: { $lt: new Date(Date.now() - 90 * 864e5) } }).catch(() => {});
  }, 12 * 60 * 60 * 1000);

  /** Apply a provider event (open/click/bounce/…) to the matching log row. */
  async function applyEvent({ messageId, email, type, detail }) {
    const set = { lastEvent: type, lastEventAt: new Date() };
    const inc = {};
    if (type === 'delivered') { set.deliveredAt = new Date(); set.status = 'delivered'; }
    else if (type === 'opened') { set.openedAt = new Date(); set.status = 'opened'; inc.opens = 1; }
    else if (type === 'clicked') { set.clickedAt = new Date(); set.status = 'clicked'; inc.clicks = 1; }
    else if (type === 'bounced') { set.bouncedAt = new Date(); set.status = 'bounced'; set.error = String(detail || 'Bounced').slice(0, 600); }
    else if (type === 'complained') { set.status = 'complained'; set.error = String(detail || 'Marked as spam').slice(0, 600); }
    else return;

    // "opened" must never downgrade a row that already recorded a click.
    const rank = { sent: 0, delivered: 1, opened: 2, clicked: 3, bounced: 4, complained: 5, failed: 6 };
    const query = messageId
      ? { messageId }
      : { to: String(email || '').toLowerCase(), createdAt: { $gte: new Date(Date.now() - 30 * 864e5) } };
    const row = await EmailLog.findOne(query).sort({ createdAt: -1 });
    if (!row) return;
    if ((rank[set.status] ?? 0) < (rank[row.status] ?? 0)) delete set.status;
    const update = { $set: set };
    if (Object.keys(inc).length) update.$inc = inc;
    await EmailLog.updateOne({ _id: row._id }, update);
  }

  // ── Provider webhooks ─────────────────────────────────────────────────────
  // Point these URLs at the site in each provider's dashboard:
  //   Resend → https://YOURSITE/api/webhooks/resend
  // Both accept an optional shared secret (EMAIL_WEBHOOK_SECRET) as ?key=… so
  // random visitors cannot inject fake delivery events.
  function webhookAllowed(req) {
    const secret = process.env.EMAIL_WEBHOOK_SECRET;
    if (!secret) return true; // not configured — accept, but events are advisory only
    const given = req.query.key || req.headers['x-webhook-key'] || '';
    const a = Buffer.from(String(given));
    const b = Buffer.from(String(secret));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  const RESEND_MAP = {
    'email.delivered': 'delivered', 'email.opened': 'opened', 'email.clicked': 'clicked',
    'email.bounced': 'bounced', 'email.complained': 'complained'
  };
  app.post('/api/webhooks/resend', async (req, res) => {
    if (!webhookAllowed(req)) return res.status(401).json({ error: 'Bad key' });
    try {
      const type = RESEND_MAP[req.body?.type];
      const data = req.body?.data || {};
      if (type) {
        await applyEvent({
          messageId: data.email_id || data.id || '',
          email: Array.isArray(data.to) ? data.to[0] : data.to,
          type,
          detail: data.bounce?.message || data.reason || ''
        });
      }
    } catch (e) { console.error('[webhook:resend]', e.message); }
    res.json({ ok: true }); // always 200 — providers retry aggressively on errors
  });

  // ── Admin: delivery dashboard ─────────────────────────────────────────────
  // Live daily-quota view of the single Resend key (90 general + 10 reset reserve).
  // Lets the owner see, at a glance, how many mails are still available today and
  // which key is currently parked because it hit its provider limit.
  app.get('/api/admin/email/quota', anyAdminAuth, async (req, res) => {
    try { res.json({ ok: true, ...mailer.getMailQuota() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/email/stats', anyAdminAuth, async (req, res) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
      const since = new Date(Date.now() - days * 864e5);

      const rows = await EmailLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { provider: '$provider', status: '$status' }, n: { $sum: 1 }, opens: { $sum: '$opens' }, clicks: { $sum: '$clicks' } } }
      ]);

      const blank = () => ({ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, failed: 0, total: 0 });
      const byProvider = { resend: blank() };
      const totals = blank();
      for (const r of rows) {
        const p = r._id.provider === 'resend' ? 'resend' : null;
        const st = r._id.status in blank() ? r._id.status : 'sent';
        totals[st] += r.n; totals.total += r.n;
        if (p) { byProvider[p][st] += r.n; byProvider[p].total += r.n; }
      }
      // Anything that left the building counts as "accepted" for rate maths.
      const accepted = (o) => o.total - o.failed;
      const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
      const shape = (o) => ({
        ...o,
        accepted: accepted(o),
        deliveryRate: pct(accepted(o) - o.bounced, o.total),
        openRate: pct(o.opened + o.clicked, Math.max(1, accepted(o))),
        clickRate: pct(o.clicked, Math.max(1, accepted(o))),
        bounceRate: pct(o.bounced, Math.max(1, accepted(o))),
        failRate: pct(o.failed, Math.max(1, o.total))
      });

      const byCategory = await EmailLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$category', total: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
        { $sort: { total: -1 } }
      ]);

      const daily = await EmailLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            total: { $sum: 1 },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            bounced: { $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] } }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      const failoverCount = await EmailLog.countDocuments({ createdAt: { $gte: since }, failover: true });
      const recentFailures = await EmailLog.find({ createdAt: { $gte: since }, status: { $in: ['failed', 'bounced', 'complained'] } })
        .sort({ createdAt: -1 }).limit(15).lean();

      res.json({
        days,
        configured: { resend: !!process.env.RESEND_API_KEY },
        primary: 'resend',
        webhookSecured: !!process.env.EMAIL_WEBHOOK_SECRET,
        webhookUrls: { resend: `${siteUrl()}/api/webhooks/resend` },
        totals: shape(totals),
        providers: { resend: shape(byProvider.resend) },
        byCategory: byCategory.map(c => ({ category: c._id || 'general', total: c.total, failed: c.failed })),
        daily: daily.map(d => ({ date: d._id, total: d.total, failed: d.failed, bounced: d.bounced })),
        failoverCount,
        recentFailures: recentFailures.map(f => ({
          to: f.to, subject: f.subject, provider: f.provider, status: f.status,
          error: f.error, createdAt: f.createdAt
        }))
      });
    } catch (e) { res.status(500).json({ error: 'Could not load email stats: ' + e.message }); }
  });

  app.get('/api/admin/email/logs', anyAdminAuth, async (req, res) => {
    try {
      const q = {};
      if (req.query.provider && req.query.provider !== 'all') q.provider = req.query.provider;
      if (req.query.status && req.query.status !== 'all') q.status = req.query.status;
      if (req.query.category && req.query.category !== 'all') q.category = req.query.category;
      if (req.query.q) q.to = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
      const logs = await EmailLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
      res.json({
        logs: logs.map(l => ({
          id: String(l._id), to: l.to, subject: l.subject, category: l.category,
          provider: l.provider, status: l.status, error: l.error, failover: l.failover,
          opens: l.opens, clicks: l.clicks, createdAt: l.createdAt, lastEvent: l.lastEvent,
          lastEventAt: l.lastEventAt
        }))
      });
    } catch (e) { res.status(500).json({ error: 'Could not load email logs' }); }
  });


  // ══ 1b. EMAIL HEALTH ALERTS (bounce / failure spikes) ═════════════════════
  // Watches the Resend delivery log. When bounces or
  // failed sends spike above the admin's thresholds inside the rolling window,
  // an alert row is stored (shown in the admin panel) and an email is sent to
  // the alert address. A per-provider cooldown stops alert storms.
  const mailAlertSchema = new mongoose.Schema({
    provider: { type: String, default: '', index: true },   // resend
    kind: { type: String, default: 'bounce' },              // bounce | failure
    message: { type: String, default: '' },
    windowMinutes: { type: Number, default: 60 },
    total: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    bounceRate: { type: Number, default: 0 },
    failRate: { type: Number, default: 0 },
    severity: { type: String, default: 'warning' },       // warning | critical
    notified: { type: Boolean, default: false },
    notifiedTo: { type: String, default: '' },
    notifyError: { type: String, default: '' },            // why the alert email itself could not be sent
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now, index: true }
  });
  const MailAlert = mongoose.models.MailAlert || mongoose.model('MailAlert', mailAlertSchema);

  const alertCooldown = { resend: 0 };

  const SEVERITIES = ['warning', 'critical'];

  function globalRecipient(cfg) {
    return String(cfg.mailAlertEmail || process.env.MAIL_ALERT_EMAIL || process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || '')
      .trim().toLowerCase();
  }

  /**
   * Everyone who should be emailed about an alert of this severity.
   * The owner address from the settings card always counts, and on top of it
   * every active admin whose own notification preference opts them in.
   * Pass severity = null to get every possible recipient (used by "Test email").
   */
  async function alertRecipients(cfg, severity) {
    const out = new Map();
    const owner = globalRecipient(cfg);
    if (owner) out.set(owner, { email: owner, name: 'Alert address', source: 'settings' });
    if (AdminAccount) {
      try {
        const admins = await AdminAccount.find({ active: true }).select('name email alertEmailEnabled alertSeverities').lean();
        for (const a of admins) {
          const email = String(a.email || '').trim().toLowerCase();
          if (!email || a.alertEmailEnabled === false) continue;
          const sevs = (a.alertSeverities && a.alertSeverities.length) ? a.alertSeverities : SEVERITIES;
          if (severity && !sevs.includes(severity)) continue;
          if (!out.has(email)) out.set(email, { email, name: a.name || email, source: 'admin' });
        }
      } catch (e) { console.error('[mail-alert] could not read admin preferences:', e.message); }
    }
    return [...out.values()];
  }

  /** One pass over the window. Returns the alerts it raised (used by "check now"). */
  async function runMailHealthCheck(opts = {}) {
    const cfg = settings.get();
    const force = !!opts.force;
    if (!cfg.mailAlertsEnabled && !force) return { skipped: true, alerts: [] };

    const windowMinutes = Math.max(5, Number(cfg.mailAlertWindowMinutes) || 60);
    const since = new Date(Date.now() - windowMinutes * 60000);
    const raised = [];

    // 'alert' emails are excluded so a failing alert email can never alert about itself.
    const rows = await EmailLog.aggregate([
      { $match: { createdAt: { $gte: since }, category: { $ne: 'mail_alert' }, provider: 'resend' } },
      { $group: { _id: { provider: '$provider', status: '$status' }, n: { $sum: 1 } } }
    ]);

    const stats = { resend: { total: 0, bounced: 0, failed: 0 } };
    for (const r of rows) {
      const p = stats[r._id.provider];
      if (!p) continue;
      p.total += r.n;
      if (r._id.status === 'bounced') p.bounced += r.n;
      if (r._id.status === 'failed') p.failed += r.n;
    }

    for (const provider of ['resend']) {
      const s = stats[provider];
      if (s.total < Math.max(1, Number(cfg.mailAlertMinVolume) || 10)) continue;

      const bounceRate = Math.round((s.bounced / s.total) * 1000) / 10;
      const failRate = Math.round((s.failed / s.total) * 1000) / 10;
      const reasons = [];
      if (bounceRate >= Number(cfg.mailAlertBounceRate || 10)) {
        reasons.push(`bounce rate ${bounceRate}% (${s.bounced} of ${s.total}) is at or above the ${cfg.mailAlertBounceRate}% threshold`);
      }
      if (failRate >= Number(cfg.mailAlertFailRate || 20) || s.failed >= Number(cfg.mailAlertFailCount || 5)) {
        reasons.push(`${s.failed} failed send(s) — ${failRate}% of ${s.total} in the window`);
      }
      if (!reasons.length) continue;

      const cooldownMs = Math.max(5, Number(cfg.mailAlertCooldownMinutes) || 120) * 60000;
      if (!force && Date.now() < (alertCooldown[provider] || 0)) continue;
      alertCooldown[provider] = Date.now() + cooldownMs;

      const bounceThreshold = Number(cfg.mailAlertBounceRate || 10);
      const failThreshold = Number(cfg.mailAlertFailRate || 20);
      const failCountThreshold = Number(cfg.mailAlertFailCount || 5);
      // "critical" = double the threshold (or triple the absolute fail count):
      // a real outage rather than a wobble.
      const severity = (bounceRate >= bounceThreshold * 2 || failRate >= failThreshold * 2 || s.failed >= failCountThreshold * 3)
        ? 'critical' : 'warning';

      const label = 'Resend';
      const message = `${label}: ${reasons.join('; ')} in the last ${windowMinutes} minutes.`;
      const alert = await MailAlert.create({
        provider, kind: bounceRate >= Number(cfg.mailAlertBounceRate || 10) ? 'bounce' : 'failure',
        message, windowMinutes, total: s.total, bounced: s.bounced, failed: s.failed, bounceRate, failRate, severity
      });
      raised.push(alert);
      console.warn('[mail-alert]', message);

      const people = await alertRecipients(cfg, severity);
      if (!people.length) {
        await MailAlert.updateOne({ _id: alert._id }, { $set: { notifyError: 'No admin is subscribed to ' + severity + ' alerts' } });
      } else {
        const okTo = [];
        const errs = [];
        for (const person of people) {
          const r = await sendMail({
            to: person.email, category: 'mail_alert',
            subject: `${severity === 'critical' ? '🚨' : '⚠'} Email delivery problem on ${label}`,
            content: {
              title: `${label} delivery is degrading`,
              preheader: message,
              greeting: person.name && person.source === 'admin' ? `Hi ${person.name},` : '',
              lines: [
                `<b>Severity:</b> ${severity.toUpperCase()}`,
                message,
                `<b>Window:</b> last ${windowMinutes} minutes<br/><b>Sent:</b> ${s.total}<br/><b>Bounced:</b> ${s.bounced} (${bounceRate}%)<br/><b>Failed:</b> ${s.failed} (${failRate}%)`,
                'Check the sending domain (SPF/DKIM/DMARC), the provider dashboard and the API key. The other provider keeps taking over automatically in the meantime.'
              ],
              ctaText: 'Open the Email Delivery dashboard',
              ctaUrl: `${siteUrl()}/admin`
            }
          });
          if (r.sent) okTo.push(person.email); else errs.push(`${person.email}: ${r.reason || 'send failed'}`);
        }
        await MailAlert.updateOne({ _id: alert._id }, { $set: {
          notified: okTo.length > 0,
          notifiedTo: okTo.join(', '),
          notifyError: errs.join(' | ').slice(0, 500)
        } });
        if (errs.length) console.error('[mail-alert] alert email failed —', errs.join(' | '));
      }
    }

    return { skipped: false, alerts: raised, stats, windowMinutes };
  }

  // Background sweep — every 10 minutes, quietly.
  setInterval(() => { runMailHealthCheck().catch(e => console.error('[mail-alert]', e.message)); }, 10 * 60 * 1000);
  setTimeout(() => { runMailHealthCheck().catch(() => {}); }, 60 * 1000);

  // Keep alert history tidy (180 days).
  setInterval(() => {
    MailAlert.deleteMany({ createdAt: { $lt: new Date(Date.now() - 180 * 864e5) } }).catch(() => {});
  }, 24 * 60 * 60 * 1000);

  // ── Admin: alert settings, history and manual check ───────────────────────
  app.get('/api/admin/email/alerts', anyAdminAuth, async (req, res) => {
    try {
      const cfg = await settings.load(true);
      const alerts = await MailAlert.find({}).sort({ createdAt: -1 }).limit(30).lean();
      res.json({
        settings: {
          mailAlertsEnabled: cfg.mailAlertsEnabled,
          mailAlertWindowMinutes: cfg.mailAlertWindowMinutes,
          mailAlertMinVolume: cfg.mailAlertMinVolume,
          mailAlertBounceRate: cfg.mailAlertBounceRate,
          mailAlertFailRate: cfg.mailAlertFailRate,
          mailAlertFailCount: cfg.mailAlertFailCount,
          mailAlertCooldownMinutes: cfg.mailAlertCooldownMinutes,
          mailAlertEmail: cfg.mailAlertEmail || ''
        },
        recipient: globalRecipient(cfg),
        recipients: await alertRecipients(cfg, null),
        admins: AdminAccount
          ? (await AdminAccount.find({ active: true }).select('name email alertEmailEnabled alertSeverities').sort({ createdAt: 1 }).lean())
              .map(a => ({
                id: String(a._id), name: a.name || '', email: a.email || '',
                alertEmailEnabled: a.alertEmailEnabled !== false,
                alertSeverities: (a.alertSeverities && a.alertSeverities.length) ? a.alertSeverities : SEVERITIES
              }))
          : [],
        severities: SEVERITIES,
        // Sending health — the usual cause of "alerts are not working" is the
        // sender domain not being verified or an API key that was rotated.
        providers: {
          from: mailer.FROM_EMAIL,
          fromDomain: String(mailer.FROM_EMAIL).split('@')[1] || '',
          resendKey: !!process.env.RESEND_API_KEY,
          lastFailure: await (async () => {
            const f = await EmailLog.findOne({ status: 'failed' }).sort({ createdAt: -1 }).select('provider error createdAt').lean();
            return f ? { provider: f.provider, error: String(f.error || '').slice(0, 300), at: f.createdAt } : null;
          })()
        },
        unacknowledged: await MailAlert.countDocuments({ acknowledged: false }),
        alerts: alerts.map(a => ({
          id: String(a._id), provider: a.provider, kind: a.kind, message: a.message,
          total: a.total, bounced: a.bounced, failed: a.failed,
          bounceRate: a.bounceRate, failRate: a.failRate,
          severity: a.severity || 'warning',
          notified: a.notified, notifiedTo: a.notifiedTo, notifyError: a.notifyError || '',
          acknowledged: a.acknowledged, createdAt: a.createdAt
        }))
      });
    } catch (e) { res.status(500).json({ error: 'Could not load email alerts: ' + e.message }); }
  });

  app.put('/api/admin/email/alerts/settings', anyAdminAuth, async (req, res) => {
    try {
      const cfg = await settings.update(req.body || {}, req.admin?.email || req.user?.email || 'admin');
      res.json({ message: 'Alert settings saved', settings: cfg });
    } catch (e) { res.status(500).json({ error: 'Could not save alert settings' }); }
  });

  app.post('/api/admin/email/alerts/check', anyAdminAuth, async (req, res) => {
    try {
      const r = await runMailHealthCheck({ force: true });
      res.json({
        message: r.alerts.length ? `${r.alerts.length} alert(s) raised` : 'No delivery problems detected right now',
        raised: r.alerts.length, stats: r.stats || null
      });
    } catch (e) { res.status(500).json({ error: 'Check failed: ' + e.message }); }
  });

  // ── Test email: proves the configured recipients really get alerts ────────
  // Sends the same style of message the monitor sends, to every address that
  // would be notified, and reports the outcome per address.
  app.post('/api/admin/email/alerts/test', anyAdminAuth, async (req, res) => {
    try {
      const cfg = await settings.load(true);
      const severity = SEVERITIES.includes(String(req.body?.severity || '')) ? req.body.severity : null;
      const one = String(req.body?.to || '').trim().toLowerCase();
      const people = one
        ? [{ email: one, name: one, source: 'manual' }]
        : await alertRecipients(cfg, severity);
      if (!people.length) {
        return res.status(400).json({ error: 'Nobody is set to receive alerts yet — add an alert address or switch an admin on below.' });
      }
      const results = [];
      for (const person of people) {
        const r = await sendMail({
          to: person.email, category: 'mail_alert_test',
          subject: '✅ Test — King Social Hub delivery alerts are working',
          content: {
            title: 'Delivery alerts test',
            preheader: 'This is a test of the email delivery alert system.',
            greeting: person.name && person.source === 'admin' ? `Hi ${person.name},` : '',
            lines: [
              'This is a test message from the <b>Delivery alerts</b> card in your admin panel.',
              'If you can read this, alerts about bounce and failed-send spikes on Resend will reach this inbox.',
              `Sent from <b>${mailer.FROM_EMAIL}</b>.`
            ],
            ctaText: 'Open the Email Delivery dashboard',
            ctaUrl: `${siteUrl()}/admin`
          }
        });
        results.push({ email: person.email, sent: !!r.sent, via: r.via || '', error: r.sent ? '' : String(r.reason || 'Send failed').slice(0, 300) });
      }
      const ok = results.filter(r => r.sent).length;
      res.json({
        message: ok === results.length
          ? `Test email sent to ${ok} recipient(s).`
          : `${ok} of ${results.length} test email(s) went out — see the details below.`,
        results
      });
    } catch (e) { res.status(500).json({ error: 'Test failed: ' + e.message }); }
  });

  // ── Per-admin notification preferences ────────────────────────────────────
  app.put('/api/admin/email/alerts/recipients', anyAdminAuth, async (req, res) => {
    try {
      if (!AdminAccount) return res.status(400).json({ error: 'Admin accounts are not available' });
      const list = Array.isArray(req.body?.admins) ? req.body.admins : [];
      let saved = 0;
      for (const row of list) {
        if (!row || !mongoose.Types.ObjectId.isValid(row.id)) continue;
        const sevs = Array.isArray(row.alertSeverities)
          ? row.alertSeverities.filter(x => SEVERITIES.includes(x))
          : SEVERITIES;
        await AdminAccount.updateOne({ _id: row.id }, { $set: {
          alertEmailEnabled: !!row.alertEmailEnabled,
          alertSeverities: sevs
        } });
        saved++;
      }
      res.json({ message: `Notification preferences saved for ${saved} admin(s)` });
    } catch (e) { res.status(500).json({ error: 'Could not save notification preferences: ' + e.message }); }
  });

  app.post('/api/admin/email/alerts/:id/ack', anyAdminAuth, async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Bad alert id' });
      await MailAlert.updateOne({ _id: req.params.id }, { $set: { acknowledged: true, acknowledgedAt: new Date() } });
      res.json({ message: 'Alert acknowledged' });
    } catch (e) { res.status(500).json({ error: 'Could not update the alert' }); }
  });

  // Owner-only smoke test: proves the keys work end to end.
  app.post('/api/admin/email/test', anyAdminAuth, async (req, res) => {
    const to = String(req.body?.to || '').trim();
    if (!to) return res.status(400).json({ error: 'Enter an email address to send the test to' });
    const r = await sendMail({
      to, category: 'test',
      subject: 'King Social Hub email delivery test',
      content: {
        title: 'Your King Social Hub email setup works',
        preheader: 'Test message from the King Social Hub admin panel.',
        lines: ['If you can read this, sending is configured correctly and reaching the inbox.'],
        ctaText: 'Open King Social Hub', ctaUrl: siteUrl(),
        footNote: 'Sent from Admin → Email Delivery → Send test.'
      }
    });
    res.json({ sent: r.sent, via: r.via || '', reason: r.reason || '' });
  });

  // ══ 2. WELCOME EMAIL ══════════════════════════════════════════════════════
  // Fired from server.js right after an account is created (email/password and
  // Google both). Never awaited by the signup response — a slow mail provider
  // must not slow down registration.
  async function sendWelcomeEmail(user) {
    if (!settings.get().welcomeEmailEnabled) return { sent: false, reason: 'disabled' };
    const first = String(user.name || '').split(' ')[0] || 'there';
    return sendMail({
      to: user.email,
      userId: user._id,
      category: 'welcome',
      subject: `Welcome to King Social Hub, ${first} — your account is ready`,
      content: {
        title: 'Your King Social Hub account is live 🎉',
        preheader: 'Here is everything your new King Social Hub account can do.',
        greeting: `Hi ${user.name || 'there'},`,
        lines: [
          'Thanks for joining <b>King Social Hub</b>. Your account is active and your wallet is ready to fund.',
          '<b>What you can do right now:</b>',
          '• Browse verified social accounts, logs and digital goods — delivery is instant<br/>'
          + '• Buy SMS verification numbers from any country<br/>'
          + `• Invite friends with your referral link and you both earn wallet credit`,
          `Your referral code is <b>${String(user.referralCode || '').toUpperCase()}</b> — share it and get paid.`
        ],
        ctaText: 'Start browsing the marketplace',
        ctaUrl: `${siteUrl()}/marketplace`,
        footNote: 'Keep this email — it confirms the address on your account. '
          + 'If it landed in Spam or Promotions, please move it to your inbox and mark it "Not spam" so you never miss a purchase or deposit alert.'
      }
    });
  }

  // ══ 3. REFERRAL REWARD ON FIRST PURCHASE OR DEPOSIT ═══════════════════════
  // Both sides get paid, once, the first time the invited customer actually
  // spends or funds their wallet — which is the moment a referral is worth
  // something. The 4% lifetime commission elsewhere in the app is unaffected.
  User.schema.add({
    referralBonusPaidAt: { type: Date, default: null },
    referralBonusEarned: { type: Number, default: 0 }
  });

  async function maybePayReferral(referredUserId, kind, amount) {
    try {
      const cfg = settings.get();
      if (!cfg.referralEnabled) return;
      if (!(Number(amount) >= cfg.referralMinAmount)) return;

      // Atomic claim — two simultaneous transactions can never double-pay.
      const claimed = await User.findOneAndUpdate(
        { _id: referredUserId, referredBy: { $ne: null }, referralBonusPaidAt: null },
        { $set: { referralBonusPaidAt: new Date() } },
        { new: true }
      );
      if (!claimed) return;

      const referrer = await User.findById(claimed.referredBy);
      if (!referrer) return;

      const forNew = cfg.refereeBonus;
      const forRef = cfg.referrerBonus;
      const label = kind === 'deposit' ? 'first wallet funding' : 'first purchase';

      if (forNew > 0) {
        claimed.balance = (claimed.balance || 0) + forNew;
        claimed.referralBonusEarned = (claimed.referralBonusEarned || 0) + forNew;
        await claimed.save();
        await Transaction.create({
          userId: claimed._id, type: 'referral_commission', amount: forNew, status: 'success',
          description: `Referral welcome bonus — ${label} completed`
        });
      }
      if (forRef > 0) {
        referrer.balance = (referrer.balance || 0) + forRef;
        referrer.referralBonusEarned = (referrer.referralBonusEarned || 0) + forRef;
        await referrer.save();
        await Transaction.create({
          userId: referrer._id, type: 'referral_commission', amount: forRef, status: 'success',
          description: `Referral reward — ${claimed.name} made their ${label}`
        });
      }

      sendMail({
        to: referrer.email, userId: referrer._id, category: 'referral',
        subject: `You just earned ${money(forRef)} from a referral`,
        content: {
          title: 'Your referral paid off 💸',
          preheader: `${claimed.name} completed their ${label} — ${money(forRef)} is in your wallet.`,
          greeting: `Hi ${referrer.name || 'there'},`,
          lines: [
            `<b>${claimed.name}</b> joined King Social Hub with your referral link and has now completed their ${label}.`,
            `<b>${money(forRef)}</b> has been added to your wallet — and they got ${money(forNew)} too.`,
            'Keep sharing your link: every friend who joins and buys pays you again, on top of your ongoing 4% commission.'
          ],
          ctaText: 'Share your link again',
          ctaUrl: `${siteUrl()}/referrals`,
          footNote: 'Rewards are paid once per referred customer, on their first purchase or deposit.'
        }
      }).catch(() => {});

      sendMail({
        to: claimed.email, userId: claimed._id, category: 'referral',
        subject: `${money(forNew)} referral bonus added to your King Social Hub wallet`,
        content: {
          title: 'Here is your welcome bonus 🎁',
          preheader: `${money(forNew)} has been added to your King Social Hub wallet.`,
          greeting: `Hi ${claimed.name || 'there'},`,
          lines: [
            `Because you joined through a friend's referral link and completed your ${label}, we have credited <b>${money(forNew)}</b> to your wallet.`,
            'You now have your own referral link too — share it and earn the same way.'
          ],
          ctaText: 'Get your referral link',
          ctaUrl: `${siteUrl()}/referrals`
        }
      }).catch(() => {});

      console.log(`[referral] paid ${forRef} to ${referrer.email} and ${forNew} to ${claimed.email}`);
    } catch (e) {
      console.error('[referral] payout failed:', e.message);
    }
  }

  // Every successful deposit/purchase anywhere in the app flows through a
  // Transaction row, so one hook covers every payment path (card, transfer,
  // virtual account, admin credit is excluded on purpose).
  Transaction.schema.post('save', function (doc) {
    try {
      if (!doc || !doc.userId) return;
      if (!['deposit', 'purchase'].includes(doc.type)) return;
      if (doc.status && doc.status !== 'success') return;
      if (/referral/i.test(doc.description || '')) return; // bonuses don't unlock bonuses
      maybePayReferral(doc.userId, doc.type, Math.abs(Number(doc.amount) || 0));
    } catch { /* never break a transaction write */ }
  });

  // What the customer sees on the Referrals page.
  app.get('/api/referrals/bonus-info', auth, async (req, res) => {
    const cfg = settings.get();
    res.json({
      enabled: cfg.referralEnabled,
      referrerBonus: cfg.referrerBonus,
      refereeBonus: cfg.refereeBonus,
      minAmount: cfg.referralMinAmount,
      youEarned: req.user.referralBonusEarned || 0,
      bonusUnlocked: !!req.user.referralBonusPaidAt
    });
  });

  // ══ 4. ADMIN CAMPAIGN PANEL ═══════════════════════════════════════════════
  app.get('/api/admin/campaigns/settings', anyAdminAuth, async (req, res) => {
    try {
      const cfg = await settings.load(true);
      const since = new Date(Date.now() - 30 * 864e5);
      const [winbackSent, referralPaid] = await Promise.all([
        EmailLog.countDocuments({ category: 'winback', createdAt: { $gte: since } }),
        User.countDocuments({ referralBonusPaidAt: { $ne: null } })
      ]);
      res.json({
        settings: cfg,
        defaults: settings.DEFAULTS(),
        stats: { winbackSent30d: winbackSent, referralsRewarded: referralPaid },
        lastWinbackRun: lastRun.winback
      });
    } catch (e) { res.status(500).json({ error: 'Could not load campaign settings' }); }
  });

  app.put('/api/admin/campaigns/settings', anyAdminAuth, async (req, res) => {
    try {
      const cfg = await settings.update(req.body || {}, req.adminRole || 'admin');
      res.json({ message: 'Campaign settings saved', settings: cfg });
    } catch (e) { res.status(500).json({ error: 'Could not save campaign settings' }); }
  });

  const lastRun = { winback: null };
  app.post('/api/admin/campaigns/winback/run', anyAdminAuth, async (req, res) => {
    if (!engagement?.runWinbackSweep) return res.status(500).json({ error: 'Win-back campaign is not available' });
    try {
      const out = await engagement.runWinbackSweep({ force: true });
      lastRun.winback = new Date();
      res.json({ message: `Win-back sweep finished — ${out?.emailed || 0} customer(s) emailed`, ...out });
    } catch (e) { res.status(500).json({ error: 'Sweep failed: ' + e.message }); }
  });

  // ── Purchase confirmation email ──────────────────────────────
  async function sendPurchaseEmail({ user, item, newBalance }) {
    if (!user || !user.email) return { sent: false, reason: 'no user email' };
    try {
      return await sendMail({
        to: user.email, category: 'transactional',
        subject: `✅ Purchase Confirmed — ${item.title} | King Social Hub`,
        content: {
          title: 'Your purchase was successful!',
          preheader: `You just bought ${item.title} on King Social Hub.`,
          lines: [
            `Hi <b>${esc(user.name || 'there')}</b>, your purchase is confirmed and ready.`,
            `<b>Item:</b> ${esc(item.title)}`,
            `<b>Type:</b> ${esc(item.type || 'Item')}`,
            `<b>Amount charged:</b> ₦${Number(item.price || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
            `<b>Remaining wallet balance:</b> ₦${Number(newBalance || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
            'Your item is available in <b>My Purchases</b>. Go to Purchases to access your account details or tool link.',
            'If you have any issues with this order, contact us on WhatsApp with your purchase reference.'
          ],
          ctaText: 'View My Purchases', ctaUrl: siteUrl() + '/purchases'
        }
      });
    } catch (e) {
      console.error('[purchase-email] failed:', e.message);
      return { sent: false, reason: e.message };
    }
  }

  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { EmailLog, sendWelcomeEmail, sendPurchaseEmail, maybePayReferral, settings };
};
