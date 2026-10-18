// ── King Social Hub transactional mailer (Resend only) ──────────────────────────────────
// ONE provider, ONE API key: Resend (RESEND_API_KEY).
//
// The free Resend plan allows 100 emails per day. That daily budget is split
// into two protected buckets so a marketing sweep can never eat the quota a
// customer needs to get back into their account:
//
//   • 90 / day  → "general" mail: win-back ("we miss you"), welcome, campaigns
//   • 10 / day  → RESERVED, only password-reset / security codes
//
// When the general bucket is empty the win-back sweep simply stops for the day
// and the remaining customers are rescheduled to the next day's 90 (they are
// never marked as emailed, so nobody is skipped — thousands of idle users are
// drained 90 per day, day after day).
//
// When the reserved bucket is also empty a password reset answers with a plain
// "email limit reached, please try again later" instead of silently failing.
//
// Deliverability (staying OUT of the spam folder) is handled here too:
//   • a real display name + reply-to address
//   • BOTH an HTML part and a plain-text part (HTML-only mail scores as spam)
//   • List-Unsubscribe + List-Unsubscribe-Post headers on marketing-ish mail
//   • the From domain must be SPF/DKIM/DMARC-verified inside Resend
const axios = require('axios');

const BRAND = process.env.MAIL_BRAND_NAME || 'King Social Hub';
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || 'noreply@klslogs.com';
const REPLY_TO = process.env.MAIL_REPLY_TO || process.env.SUPPORT_EMAIL || FROM_EMAIL;
const SITE_URL = (process.env.SITE_URL || 'https://klslogs.com').replace(/\/$/, '');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A light, table-free, inline-styled layout. Dark-mode safe and Gmail-clipping safe.
function renderEmail({ title, preheader, greeting, lines = [], code, ctaText, ctaUrl, footNote }) {
  const body = lines.map(l => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#334155">${l}</p>`).join('');
  const codeBlock = code
    ? `<div style="margin:22px 0;text-align:center">
         <div style="display:inline-block;padding:14px 26px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;
                     font-family:'Courier New',monospace;font-size:30px;font-weight:700;letter-spacing:9px;color:#0f172a">${esc(code)}</div>
       </div>`
    : '';
  const cta = ctaText && ctaUrl
    ? `<div style="margin:26px 0 6px;text-align:center">
         <a href="${esc(ctaUrl)}" style="display:inline-block;padding:13px 30px;border-radius:10px;background:#2f7bf6;
            color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${esc(ctaText)}</a>
       </div>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || title)}</div>
<div style="max-width:560px;margin:0 auto;padding:28px 22px;font-family:Segoe UI,Helvetica,Arial,sans-serif">
  <div style="padding-bottom:18px;border-bottom:1px solid #e2e8f0">
    <span style="font-size:17px;font-weight:800;color:#0f172a">${esc(BRAND)}</span>
  </div>
  <h1 style="margin:24px 0 14px;font-size:21px;line-height:1.35;color:#0f172a">${esc(title)}</h1>
  ${greeting ? `<p style="margin:0 0 14px;font-size:15px;color:#334155">${esc(greeting)}</p>` : ''}
  ${body}
  ${codeBlock}
  ${cta}
  ${footNote ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748b">${footNote}</p>` : ''}
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#94a3b8">
    You are receiving this email because you have an account on
    <a href="${esc(SITE_URL)}" style="color:#2f7bf6;text-decoration:none">${esc(SITE_URL.replace(/^https?:\/\//, ''))}</a>.<br/>
    Questions? Just reply to this email — a real person reads it.
  </div>
</div>
</body></html>`;
}

// Plain-text twin of the HTML. Sending both parts is one of the biggest
// single wins against the spam folder.
function toText({ title, greeting, lines = [], code, ctaText, ctaUrl, footNote }) {
  const strip = s => String(s).replace(/<[^>]+>/g, '');
  return [
    title, '',
    greeting || '',
    ...lines.map(strip),
    code ? `\nYour code: ${code}\n` : '',
    ctaText && ctaUrl ? `${ctaText}: ${ctaUrl}` : '',
    footNote ? `\n${strip(footNote)}` : '',
    '', `${BRAND} — ${SITE_URL}`
  ].filter(Boolean).join('\n');
}

async function viaResend({ to, subject, html, text, headers, replyTo }) {
  const r = await axios.post('https://api.resend.com/emails', {
    from: `${BRAND} <${FROM_EMAIL}>`,
    to: [to],
    subject,
    html,
    text,
    reply_to: replyTo,
    headers
  }, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, timeout: 15000 });
  return r.data?.id || '';
}

// ── Daily budget with a protected password-reset reserve ────────────────────
const DAILY_LIMIT = Math.max(1, Number(process.env.RESEND_DAILY_LIMIT || 100));
const RESET_RESERVE = Math.min(DAILY_LIMIT - 1, Math.max(0, Number(process.env.RESEND_RESET_RESERVE || 10)));
const GENERAL_LIMIT = DAILY_LIMIT - RESET_RESERVE; // 90 by default

// ── Which emails King Social Hub is allowed to send at all ──────────────────────────────
// Only two emails go out to customers now:
//   • password reset / security codes   (category: reset)
//   • the welcome mail sent when an account is created (category: welcome)
// Everything else — win-back ("we miss you"), campaigns, mail alerts, referral
// and test mail — is switched off at the source, so no other code path can
// accidentally mail a customer.
const ALLOWED_CATEGORIES = new Set(['reset', 'password-reset', 'password_reset', 'otp', 'welcome']);
function isAllowed(category) { return ALLOWED_CATEGORIES.has(String(category || '').toLowerCase()); }

// Categories that are allowed to dip into the reserved 10.
const PRIORITY_CATEGORIES = new Set(['reset', 'password-reset', 'security', 'otp']);
function isPriority(category) { return PRIORITY_CATEGORIES.has(String(category || '').toLowerCase()); }

function today() { return new Date().toISOString().slice(0, 10); }
let counter = { day: today(), general: 0, reset: 0, blocked: false, lastError: '' };
function state() {
  const d = today();
  if (counter.day !== d) counter = { day: d, general: 0, reset: 0, blocked: false, lastError: '' };
  return counter;
}

function hasKey() { return !!String(process.env.RESEND_API_KEY || '').trim(); }

/** How many mails of this kind are still allowed today. */
function remainingFor(category) {
  const st = state();
  if (st.blocked) return 0;
  return isPriority(category)
    ? Math.max(0, RESET_RESERVE - st.reset)
    : Math.max(0, GENERAL_LIMIT - st.general);
}

/** True when a mail of this category can go out right now. */
function canSend(category) { return isAllowed(category) && hasKey() && remainingFor(category) > 0; }

/** Snapshot for the admin "Email Delivery" dashboard. */
function getMailQuota() {
  const st = state();
  const generalRemaining = st.blocked ? 0 : Math.max(0, GENERAL_LIMIT - st.general);
  const resetRemaining = st.blocked ? 0 : Math.max(0, RESET_RESERVE - st.reset);
  return {
    day: st.day,
    provider: 'resend',
    dailyLimits: { resend: DAILY_LIMIT },
    dailyLimit: DAILY_LIMIT,
    generalLimit: GENERAL_LIMIT,
    resetReserve: RESET_RESERVE,
    generalSent: st.general,
    resetSent: st.reset,
    generalRemaining,
    resetRemaining,
    totalCapacity: DAILY_LIMIT,
    remainingToday: generalRemaining + resetRemaining,
    keys: [
      {
        provider: 'resend', env: 'RESEND_API_KEY (general 90/day)',
        limit: GENERAL_LIMIT, sent: st.general, remaining: generalRemaining,
        status: !hasKey() ? 'no key configured'
          : st.blocked ? 'parked (provider quota)'
            : (generalRemaining > 0 ? 'ready' : 'daily cap reached — rescheduled to tomorrow'),
        lastError: st.lastError || ''
      },
      {
        provider: 'resend', env: 'RESEND_API_KEY (password-reset reserve)',
        limit: RESET_RESERVE, sent: st.reset, remaining: resetRemaining,
        status: !hasKey() ? 'no key configured'
          : st.blocked ? 'parked (provider quota)'
            : (resetRemaining > 0 ? 'ready' : 'reserve used up — users are asked to try again later'),
        lastError: st.lastError || ''
      }
    ]
  };
}

function isQuotaError(detail, status) {
  const t = String(detail || '').toLowerCase();
  return status === 429 || status === 402
    || t.includes('rate limit') || t.includes('too many requests')
    || t.includes('quota') || t.includes('daily') || t.includes('limit exceeded')
    || t.includes('credits') || t.includes('not enough');
}

// ── Delivery logging sink ───────────────────────────────────────────────────
// lib/campaigns.js installs a logger here so every attempt (and every provider
// failure) lands in the admin Email Delivery dashboard.
let logSink = null;
function setLogger(fn) { logSink = typeof fn === 'function' ? fn : null; }
function record(entry) {
  if (!logSink) return;
  try { Promise.resolve(logSink(entry)).catch(() => {}); } catch { /* logging must never break a send */ }
}

/**
 * Send one email to one recipient through Resend.
 * Returns { sent, reason, quotaExhausted } — it never throws, so a mail problem
 * can never break the request that triggered it.
 */
async function sendMail({ to, subject, content, unsubscribable = false, category = 'general', userId = null }) {
  const target = String(to || '').trim().toLowerCase();
  if (!target || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target) === false) {
    record({ to: String(to || ''), subject, category, userId, provider: 'none', status: 'failed', error: 'Invalid recipient address' });
    return { sent: false, reason: 'Invalid recipient address' };
  }
  if (!isAllowed(category)) {
    const reason = `Email sending is limited to password-reset and welcome emails — "${category}" mail is disabled`;
    record({ to: target, subject, category, userId, provider: 'none', status: 'skipped', error: reason });
    return { sent: false, reason, disabled: true };
  }
  if (!hasKey()) {
    const reason = 'No RESEND_API_KEY configured';
    record({ to: target, subject, category, userId, provider: 'none', status: 'failed', error: reason });
    return { sent: false, reason };
  }

  const priority = isPriority(category);
  if (!canSend(category)) {
    const reason = priority
      ? `Password-reset email reserve (${RESET_RESERVE}/day) is used up for today — ask the customer to try again later.`
      : `Daily campaign allowance (${GENERAL_LIMIT}/day) is used up — this recipient has been rescheduled for tomorrow.`;
    record({ to: target, subject, category, userId, provider: 'resend', status: 'failed', error: reason });
    return { sent: false, reason, quotaExhausted: true, rescheduled: !priority };
  }

  const html = renderEmail(content);
  const text = toText(content);
  const headers = {};
  if (unsubscribable) {
    // Gmail/Yahoo bulk-sender requirement — also a strong "not spam" signal.
    headers['List-Unsubscribe'] = `<mailto:${REPLY_TO}?subject=unsubscribe>, <${SITE_URL}/settings>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const st = state();
  try {
    const messageId = await viaResend({ to: target, subject, html, text, headers, replyTo: REPLY_TO });
    if (priority) st.reset += 1; else st.general += 1;
    record({ to: target, subject, category, userId, provider: 'resend', status: 'sent', messageId });
    return { sent: true, via: 'resend', messageId, remainingToday: remainingFor(category) };
  } catch (e) {
    const status = e.response?.status;
    const detail = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
    st.lastError = detail;
    // Resend itself says we are over the limit: park the key for the rest of the
    // day so every later send is rescheduled instead of hammering a dead quota.
    if (isQuotaError(detail, status)) st.blocked = true;
    console.error(`[mail] resend failed for ${target}: ${detail}`);
    record({ to: target, subject, category, userId, provider: 'resend', status: 'failed', error: detail });
    return { sent: false, reason: detail, quotaExhausted: isQuotaError(detail, status) };
  }
}

module.exports = {
  sendMail, renderEmail, toText, setLogger, getMailQuota, canSend, remainingFor, isAllowed,
  DAILY_LIMIT, GENERAL_LIMIT, RESET_RESERVE, BRAND, FROM_EMAIL, SITE_URL
};
