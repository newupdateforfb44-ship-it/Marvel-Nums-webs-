/**
 * lib/geo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One place that answers "which country is this request / this user in?".
 *
 * IMPORTANT (VPN fix): the answer NEVER comes from the visitor's IP address or
 * from a CDN geo header any more. A customer on a VPN was being read as a
 * foreign visitor, which switched their currency and hid Nigeria-only features
 * such as virtual accounts and bank transfer.
 *
 * Order of truth now:
 *   1. The country saved on the user's profile (chosen at signup / settings).
 *   2. The country implied by the user's saved E.164 phone number's dial
 *      code (works for any country, not just Nigeria).
 *   3. The country the visitor picked themselves in the browser (hint).
 *   4. 'NG' as the final fallback.
 *
 * Nothing here may ever throw, and nothing here makes a network call, so a
 * VPN, a proxy or a rate-limited lookup service can no longer break a page.
 */
const countries = require('./countries');

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.ip || req.connection?.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

function isPrivate(ip) {
  return !ip
    || ip === '::1'
    || ip.startsWith('127.')
    || ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/**
 * Kept for backwards compatibility only — deliberately returns nothing.
 * IP / header geo-location is no longer part of how King Social Hub decides anything.
 */
function countryFromHeaders() { return ''; }
async function countryFromIp() { return ''; }

/** A saved E.164 phone number is enough to resolve the visitor's country —
 *  no IP lookup needed. Uses the same dial-code table as the phone-country
 *  picker (lib/countries.js#byPhone), so it works for every country, not
 *  just Nigeria. */
function countryFromPhone(user) {
  const phone = String(user?.contactPhone || user?.phone || '').trim();
  if (!phone) return '';
  const match = countries.byPhone(phone);
  return match ? match.code : '';
}

/**
 * Resolve the country to use for a request.
 * @param {object} req            express request (unused for geo, kept for API shape)
 * @param {object|null} user      the authenticated user document (optional)
 * @param {object} [opts]
 * @param {string} [opts.hint]    the country the visitor selected in the browser
 * @returns {Promise<{code:string, source:string}>}
 */
async function resolveCountry(req, user, opts = {}) {
  const profile = String(user?.country || '').toUpperCase();
  if (profile && countries.byCode(profile)) return { code: profile, source: 'profile' };

  const phone = countryFromPhone(user);
  if (phone) return { code: phone, source: 'phone' };

  const hint = String(opts.hint || '').toUpperCase();
  if (hint && countries.byCode(hint)) return { code: hint, source: 'selected' };

  return { code: 'NG', source: 'default' };
}

/** True only when we treat this request as belonging to Nigeria. */
async function isNigeria(req, user, opts) {
  const { code } = await resolveCountry(req, user, opts);
  return code === 'NG';
}

module.exports = {
  clientIp,
  isPrivate,
  countryFromHeaders,
  countryFromIp,
  countryFromPhone,
  resolveCountry,
  isNigeria
};
