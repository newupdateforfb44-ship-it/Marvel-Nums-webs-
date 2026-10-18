// ── King Social Hub engagement + account-security layer ─────────────────────────────────
// Everything in this file is additive; server.js mounts it once, near the end,
// and keeps working unchanged if this module is removed.
//
//   1. Forgot / reset password by emailed 6-digit code (login page only)
//   2. "We miss you" win-back emails for customers idle 4+ days
//   4. Device / session manager: see every logged-in device, end other sessions
//      — with the 24-hour rule: a brand-new session cannot kill older sessions
//   5. Account creation date exposed to the UI
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mailer = require('./mailer');
const { sendMail } = mailer;

const DAY = 24 * 60 * 60 * 1000;

// Tunables (all overridable with env vars, sensible defaults out of the box)
const CODE_TTL_MIN = Number(process.env.RESET_CODE_TTL_MINUTES || 15);
const CODE_RESEND_SEC = Number(process.env.RESET_CODE_RESEND_SECONDS || 60);
const CODE_MAX_TRIES = Number(process.env.RESET_CODE_MAX_ATTEMPTS || 6);
const WINBACK_IDLE_DAYS = Number(process.env.WINBACK_IDLE_DAYS || 4);
const WINBACK_COOLDOWN_DAYS = Number(process.env.WINBACK_COOLDOWN_DAYS || 7);
const WINBACK_BATCH = Number(process.env.WINBACK_BATCH || 40);
const REVOKE_GRACE_HOURS = Number(process.env.SESSION_REVOKE_GRACE_HOURS || 24);

function siteUrl() {
  return (process.env.SITE_URL || '').replace(/\/$/, '') || 'https://klslogs.com';
}
function sixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
}
// Friendly "iPhone · Safari" style label from a raw user-agent string.
function describeDevice(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  let os = 'Unknown device';
  if (/iPhone/i.test(s)) os = 'iPhone';
  else if (/iPad/i.test(s)) os = 'iPad';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Windows/i.test(s)) os = 'Windows PC';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'Mac';
  else if (/Linux/i.test(s)) os = 'Linux';
  let browser = '';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = 'Chrome';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Safari\//i.test(s)) browser = 'Safari';
  return browser ? `${os} · ${browser}` : os;
}
const klsSettings = require('./settings');

module.exports = function initEngagement(ctx) {
  klsSettings.init(ctx.mongoose);
  const cfg = () => klsSettings.get();
  const { app, mongoose, User, Transaction, auth } = ctx;

  // ── Extra user fields (added to the existing schema, nothing is replaced) ──
  User.schema.add({
    resetCodeHash: { type: String, default: '' },
    resetCodeExpires: { type: Date, default: null },
    resetCodeAttempts: { type: Number, default: 0 },
    resetCodeSentAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    lastWinbackEmailAt: { type: Date, default: null }
  });

  // ── Sessions (one row per logged-in device) ───────────────────────────────
  const sessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    ip: String,
    userAgent: String,
    device: String,
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: '' }
  });
  const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

  /** Create a device session and return a JWT that is bound to it. */
  async function issueToken(user, req) {
    const s = await Session.create({
      userId: user._id,
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] || '').slice(0, 400),
      device: describeDevice(req.headers['user-agent'])
    });
    return jwt.sign({ id: user._id, sid: String(s._id) }, process.env.JWT_SECRET, { expiresIn: '7d' });
  }

  /** Called from the auth middleware: false = this session was terminated. */
  async function touchSession(sid, userId) {
    if (!sid || !mongoose.Types.ObjectId.isValid(sid)) return true; // legacy token, still valid
    const s = await Session.findById(sid).select('revokedAt lastSeenAt userId');
    if (!s || String(s.userId) !== String(userId)) return false;
    if (s.revokedAt) return false;
    if (!s.lastSeenAt || Date.now() - s.lastSeenAt.getTime() > 2 * 60 * 1000) {
      Session.updateOne({ _id: sid }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    }
    return true;
  }

  function currentSid(req) {
    try {
      const t = req.headers.authorization?.split(' ')[1];
      return t ? (jwt.decode(t) || {}).sid || null : null;
    } catch { return null; }
  }

  // ══ 1. FORGOT / RESET PASSWORD BY EMAIL CODE ══════════════════════════════
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Enter the email address on your account' });
      const user = await User.findOne({ email });
      // Always answer the same way — never reveal whether an email is registered.
      const generic = {
        message: `If ${email} has a King Social Hub account, a 6-digit reset code is on its way. It expires in ${CODE_TTL_MIN} minutes.`,
        spamNote: "Can't see it? Check your Spam / Junk / Promotions folder and mark it as \"Not spam\".",
        cooldownSeconds: CODE_RESEND_SEC
      };
      if (!user) return res.json(generic);
      if (user.restricted) return res.json(generic);
      if (user.resetCodeSentAt && Date.now() - user.resetCodeSentAt.getTime() < CODE_RESEND_SEC * 1000) {
        return res.status(429).json({ error: `Please wait ${CODE_RESEND_SEC} seconds before requesting another code.` });
      }
      // Password resets live inside a protected daily reserve (10 of the 100
      // Resend mails per day). If today's reserve is gone we say so plainly
      // instead of pretending a code was sent.
      if (!mailer.canSend('reset')) {
        return res.status(429).json({
          error: 'Our email limit for today has been reached. Please try again later — password reset emails will work again shortly.',
          retryLater: true
        });
      }
      const code = sixDigitCode();
      user.resetCodeHash = hashCode(code);
      user.resetCodeExpires = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000);
      user.resetCodeAttempts = 0;
      user.resetCodeSentAt = new Date();
      await user.save();

      const result = await sendMail({
        to: user.email,
        userId: user._id,
        category: 'reset',
        subject: `${code} is your King Social Hub password reset code`,
        content: {
          title: 'Reset your King Social Hub password',
          preheader: `Your reset code is ${code} — it expires in ${CODE_TTL_MIN} minutes.`,
          greeting: `Hi ${user.name || 'there'},`,
          lines: [
            'We received a request to reset the password on your King Social Hub account. Enter the code below on the login page to set a new password.'
          ],
          code,
          footNote: `This code expires in ${CODE_TTL_MIN} minutes and can only be used once. If you did not ask for a password reset you can safely ignore this email — your password stays the same.<br/><br/><b>Not in your inbox?</b> Check your Spam / Junk / Promotions folder and mark this message as "Not spam" so future King Social Hub emails arrive properly.`
        }
      });
      if (!result.sent) {
        console.error('[reset] email not sent:', result.reason);
        // Roll the code back so the customer is not locked behind a code that
        // never arrived, and tell them to try again later.
        user.resetCodeHash = ''; user.resetCodeExpires = null; user.resetCodeSentAt = null;
        await user.save().catch(() => {});
        return res.status(503).json({
          error: result.quotaExhausted
            ? 'Our email limit for today has been reached. Please try again later.'
            : 'We could not send the reset email right now. Please try again later.',
          retryLater: true
        });
      }
      res.json(generic);
    } catch (e) {
      res.status(500).json({ error: 'Could not start the password reset. Please try again.' });
    }
  });

  app.post('/api/auth/reset-password-with-code', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const code = String(req.body?.code || '').trim();
      const newPassword = String(req.body?.newPassword || '');
      if (!email || !code || !newPassword) return res.status(400).json({ error: 'Email, code and new password are all required' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const user = await User.findOne({ email });
      if (!user || !user.resetCodeHash || !user.resetCodeExpires) {
        return res.status(400).json({ error: 'That code is not valid. Request a new one.' });
      }
      if (user.resetCodeExpires.getTime() < Date.now()) {
        return res.status(400).json({ error: 'That code has expired. Request a new one.' });
      }
      if ((user.resetCodeAttempts || 0) >= CODE_MAX_TRIES) {
        return res.status(429).json({ error: 'Too many wrong codes. Request a fresh code and try again.' });
      }
      if (hashCode(code) !== user.resetCodeHash) {
        user.resetCodeAttempts = (user.resetCodeAttempts || 0) + 1;
        await user.save();
        return res.status(400).json({ error: 'Incorrect code. Please check the email and try again.' });
      }
      user.password = await bcrypt.hash(newPassword, 12);
      user.authProvider = user.googleId ? user.authProvider : 'local';
      user.resetCodeHash = '';
      user.resetCodeExpires = null;
      user.resetCodeAttempts = 0;
      user.passwordChangedAt = new Date();
      await user.save();
      // A password reset kills every device — that is the whole point of it.
      await Session.updateMany({ userId: user._id, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'password_reset' } });

      sendMail({
        to: user.email,
        userId: user._id,
        category: 'security',
        subject: 'Your King Social Hub password was changed',
        content: {
          title: 'Your password was changed',
          greeting: `Hi ${user.name || 'there'},`,
          lines: [
            'The password on your King Social Hub account was just reset, and every device that was signed in has been logged out.',
            'If this was not you, reply to this email immediately and change your password again.'
          ],
          ctaText: 'Log in to King Social Hub',
          ctaUrl: `${siteUrl()}/login`
        }
      }).catch(() => {});

      res.json({ message: 'Password updated. You can now log in with your new password.' });
    } catch (e) {
      res.status(500).json({ error: 'Could not reset the password. Please try again.' });
    }
  });

  // ══ 4 + 7. DEVICES, SESSIONS AND ACCOUNT AGE ══════════════════════════════
  app.get('/api/user/security', auth, async (req, res) => {
    try {
      const sid = currentSid(req);
      const sessions = await Session.find({ userId: req.user._id, revokedAt: null }).sort({ lastSeenAt: -1 }).limit(50).lean();
      const me = sessions.find(s => String(s._id) === String(sid));
      const myAgeHours = me ? (Date.now() - new Date(me.createdAt).getTime()) / 3600000 : Infinity;
      res.json({
        accountCreatedAt: req.user.createdAt,
        currentSessionId: sid,
        // A session younger than 24h may only end sessions that are NEWER than itself.
        canEndOlderSessions: myAgeHours >= REVOKE_GRACE_HOURS,
        hoursUntilCanEndOlder: Math.max(0, Math.ceil(REVOKE_GRACE_HOURS - myAgeHours)),
        graceHours: REVOKE_GRACE_HOURS,
        sessions: sessions.map(s => ({
          id: String(s._id),
          device: s.device || describeDevice(s.userAgent),
          ip: s.ip || '',
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          current: String(s._id) === String(sid)
        }))
      });
    } catch (e) { res.status(500).json({ error: 'Could not load your devices' }); }
  });

  async function revokeGuard(req, targets) {
    const sid = currentSid(req);
    const me = sid && mongoose.Types.ObjectId.isValid(sid) ? await Session.findById(sid) : null;
    const myAgeHours = me ? (Date.now() - me.createdAt.getTime()) / 3600000 : Infinity;
    if (myAgeHours >= REVOKE_GRACE_HOURS) return { ok: true, sid };
    // Young session: only allowed to end sessions created AFTER it.
    const older = targets.filter(t => me && t.createdAt.getTime() <= me.createdAt.getTime());
    if (older.length) {
      return {
        ok: false,
        error: `For your security, a device that signed in less than ${REVOKE_GRACE_HOURS} hours ago cannot log out older devices. You can do this in ${Math.ceil(REVOKE_GRACE_HOURS - myAgeHours)} hour(s).`
      };
    }
    return { ok: true, sid };
  }

  app.post('/api/user/security/sessions/:id/revoke', auth, async (req, res) => {
    try {
      const target = await Session.findOne({ _id: req.params.id, userId: req.user._id, revokedAt: null });
      if (!target) return res.status(404).json({ error: 'That device is already signed out' });
      const sid = currentSid(req);
      if (String(target._id) === String(sid)) return res.status(400).json({ error: 'Use Log out to end the device you are using right now' });
      const guard = await revokeGuard(req, [target]);
      if (!guard.ok) return res.status(403).json({ error: guard.error });
      target.revokedAt = new Date();
      target.revokedReason = 'user_revoked';
      await target.save();
      res.json({ message: `${target.device || 'That device'} has been signed out` });
    } catch (e) { res.status(500).json({ error: 'Could not sign that device out' }); }
  });

  app.post('/api/user/security/sessions/revoke-others', auth, async (req, res) => {
    try {
      const sid = currentSid(req);
      const targets = await Session.find({ userId: req.user._id, revokedAt: null, _id: { $ne: sid } });
      if (!targets.length) return res.json({ message: 'No other devices are signed in', revoked: 0 });
      const guard = await revokeGuard(req, targets);
      if (!guard.ok) return res.status(403).json({ error: guard.error });
      await Session.updateMany({ _id: { $in: targets.map(t => t._id) } },
        { $set: { revokedAt: new Date(), revokedReason: 'user_revoked_all' } });
      res.json({ message: `Signed out ${targets.length} other device(s)`, revoked: targets.length });
    } catch (e) { res.status(500).json({ error: 'Could not sign the other devices out' }); }
  });

  // Ends only the session that made the call (normal logout).
  app.post('/api/auth/logout', auth, async (req, res) => {
    const sid = currentSid(req);
    if (sid && mongoose.Types.ObjectId.isValid(sid)) {
      await Session.updateOne({ _id: sid, userId: req.user._id }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } }).catch(() => {});
    }
    res.json({ message: 'Logged out' });
  });

  // ══ 2. "WE MISS YOU" WIN-BACK EMAILS ══════════════════════════════════════
  async function runWinbackSweep(opts = {}) {
    // Win-back ("we miss you") emails have been removed. King Social Hub only sends
    // password-reset and welcome (account created) emails now, so this sweep
    // is a no-op that is kept only so the admin panel keeps working.
    return { emailed: 0, paused: true, disabled: true, reason: 'Win-back emails are disabled' };
    /* eslint-disable no-unreachable */
    let emailed = 0;
    try {
      // Admin panel owns the timing; env vars are only the fallback defaults.
      const c = cfg();
      if (!c.winbackEnabled && !opts.force) return { emailed: 0, paused: true };
      const IDLE = c.winbackIdleDays, COOLDOWN = c.winbackCooldownDays;
      // Never plan more mails than today's general allowance (90/day) still has
      // room for. Everyone we cannot reach today keeps their place in the queue
      // and is picked up by the next sweep — thousands of idle customers drain
      // 90 per day without ever touching the password-reset reserve.
      const room = mailer.remainingFor('winback');
      if (room <= 0) {
        console.log('[winback] daily 90-email allowance used up — remaining customers rescheduled for tomorrow');
        return { emailed: 0, rescheduled: true, reason: 'daily allowance reached' };
      }
      const BATCH = Math.min(c.winbackBatch, room);
      const idleBefore = new Date(Date.now() - IDLE * DAY);
      const cooldownBefore = new Date(Date.now() - COOLDOWN * DAY);
      const candidates = await User.find({
        restricted: { $ne: true },
        email: { $exists: true, $ne: '' },
        $and: [
          { $or: [{ lastActiveAt: { $lt: idleBefore } }, { lastActiveAt: null, createdAt: { $lt: idleBefore } }] },
          { $or: [{ lastLoginAt: { $lt: idleBefore } }, { lastLoginAt: null }] },
          { $or: [{ lastWinbackEmailAt: null }, { lastWinbackEmailAt: { $lt: cooldownBefore } }] }
        ]
      }).limit(BATCH);

      for (const user of candidates) {
        // Skip anyone who bought or deposited inside the idle window.
        const recent = await Transaction.findOne({ userId: user._id, createdAt: { $gte: idleBefore } }).select('_id');
        if (recent) { user.lastWinbackEmailAt = new Date(); await user.save(); continue; }
        const daysAway = Math.max(
          IDLE,
          Math.floor((Date.now() - new Date(user.lastActiveAt || user.lastLoginAt || user.createdAt).getTime()) / DAY)
        );
        const r = await sendMail({
          to: user.email,
          userId: user._id,
          category: 'winback',
          unsubscribable: true,
          subject: `We've missed you at King Social Hub, ${String(user.name || '').split(' ')[0] || 'friend'}`,
          content: {
            title: 'We really missed you 👋',
            preheader: `A lot has changed on King Social Hub in the last ${daysAway} days — come and see.`,
            greeting: `Hi ${user.name || 'there'},`,
            lines: [
              `It has been about ${daysAway} days since you last stopped by, and the site is not the same place you left.`,
              'Fresh verified stock lands daily, delivery is instant to your Purchases page, deposits clear straight into your wallet, and there are now giveaways, games and a 4% referral commission waiting for you.',
              'Your account, balance and history are exactly where you left them.'
            ],
            ctaText: 'See what is new on King Social Hub',
            ctaUrl: `${siteUrl()}/marketplace`,
            footNote: 'If you would rather not get these occasional check-ins, just reply with "unsubscribe" and we will stop.'
          }
        });
        if (r.sent) {
          user.lastWinbackEmailAt = new Date();
          await user.save();
          emailed++;
        } else if (r.quotaExhausted) {
          // Out of room for today: leave lastWinbackEmailAt untouched so this
          // customer is first in line on the next sweep.
          console.log('[winback] daily allowance reached — rescheduling the rest for tomorrow');
          break;
        } else {
          console.error('[winback] failed for', user.email, r.reason);
        }
        await new Promise(r2 => setTimeout(r2, 400)); // gentle pacing protects sender reputation
      }
      if (candidates.length) console.log(`[winback] processed ${candidates.length} idle customer(s)`);
      return { emailed, scanned: candidates.length };
    } catch (e) {
      console.error('[winback] sweep failed:', e.message);
      return { emailed, error: e.message };
    }
  }

  // Sweep a few times a day; the per-user cooldown does the real throttling.
  // No scheduled win-back sweep any more — nothing is mailed on a timer.

  return { Session, issueToken, touchSession, describeDevice, runWinbackSweep, sendMail };
};
