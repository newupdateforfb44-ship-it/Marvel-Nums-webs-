/**
 * lib/restock-notify.js
 * ─────────────────────────────────────────────────────────────────────────────
 * "Fully restocked" alerts.
 *
 * Whenever the owner tops up an SMS server, the boost provider, or the log /
 * tool catalogue, every user should be told on the website. This module watches
 * the stock numbers on a timer and, the moment a category goes from EMPTY to
 * AVAILABLE, posts a normal Announcement — so it shows up in the notification
 * bell, the home ticker and as the blue restock alert (public/js/app-guide.js).
 *
 * Deliberately dumb and safe:
 *   • read-only checks, nothing is ever written to stock
 *   • one announcement per category per cooldown window (default 6 hours)
 *   • any failure is swallowed and retried on the next tick
 */

const CATEGORY_LABEL = {
  server1: 'Numbers — Server 1 (USA WhatsApp)',
  server2: 'Numbers — Server 2 (all apps)',
  boost: 'Boost services',
};

function mountRestockNotify(ctx) {
  const {
    Announcement,          // mongoose model
    NumberListing,         // mongoose model
    Log,                   // mongoose model
    boostServiceModel,     // () => mongoose model | null
    intervalMs = 5 * 60 * 1000,
    cooldownMs = 6 * 60 * 60 * 1000,
  } = ctx;

  /** Remember the previous count so we only announce the empty → stocked jump. */
  const previous = new Map();

  async function announce(key, label, count) {
    const since = new Date(Date.now() - cooldownMs);
    const dupe = await Announcement.findOne({
      title: { $regex: `^Fully restocked — ${escapeRe(label)}$` },
      createdAt: { $gte: since },
    }).select('_id').lean();
    if (dupe) return;

    await Announcement.create({
      title: `Fully restocked — ${label}`,
      message: count
        ? `${label} is fully restocked — ${count.toLocaleString('en-NG')} now available. Order while stock lasts.`
        : `${label} is fully restocked and available again.`,
      level: 'success',
      link: linkFor(key),
      linkLabel: 'Open',
      active: true,
      createdBy: 'system',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    console.log(`[restock] announced: ${label} (${count})`);
  }

  function linkFor(key) {
    if (key === 'boost') return '/boost';
    if (key.startsWith('server')) return '/buy-number';
    return '/marketplace';
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Announce when a count crosses from 0 (or unknown-and-empty) to > 0. */
  async function track(key, label, count) {
    const was = previous.get(key);
    previous.set(key, count);
    if (was === undefined) return;          // first tick only records a baseline
    if (was === 0 && count > 0) await announce(key, label, count);
  }

  async function tick() {
    try {
      // ── SMS servers ──────────────────────────────────────────────────────
      for (const server of ['server1', 'server2']) {
        const n = await NumberListing.countDocuments({ server, status: 'available' });
        await track(server, CATEGORY_LABEL[server], n);
      }

      // ── Boost catalogue ──────────────────────────────────────────────────
      const BoostService = typeof boostServiceModel === 'function' ? boostServiceModel() : null;
      if (BoostService) {
        const n = await BoostService.countDocuments({ enabled: true });
        await track('boost', CATEGORY_LABEL.boost, n);
      }

      // ── Logs & tools, per category ───────────────────────────────────────
      const rows = await Log.aggregate([
        { $match: { available: true } },
        { $group: { _id: { type: '$type', category: '$category' }, n: { $sum: 1 } } },
      ]);
      const seen = new Set();
      for (const r of rows) {
        const kind = r._id.type === 'tool' ? 'Tools & FMT' : 'Logs';
        const label = `${kind} — ${r._id.category || 'General'}`;
        const key = `log:${r._id.type}:${r._id.category}`;
        seen.add(key);
        await track(key, label, r.n);
      }
      // A category that disappeared from the list is empty now.
      for (const key of previous.keys()) {
        if (key.startsWith('log:') && !seen.has(key)) previous.set(key, 0);
      }
    } catch (err) {
      console.error('[restock] check failed (non-fatal):', err.message);
    }
  }

  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  setTimeout(tick, 20 * 1000);   // baseline shortly after boot

  return { tick, announce, CATEGORY_LABEL };
}

/**
 * Instant "new stock added" alert.
 *
 * Called the moment the admin saves a new marketplace account or tool, so every
 * user gets the notification (bell + popup) right away instead of waiting for
 * the 5-minute stock sweep. Each item has its own image and purchase deep link.
 */
async function announceNewStock(Announcement, log, opts = {}) {
  if (!Announcement || !log) return null;
  const isTool = log.type === 'tool';
  const kind = isTool ? 'Tools & FMT' : 'Marketplace';
  const category = log.category || 'General';
  const label = `${kind} — ${category}`;
  const base = isTool ? '/tools' : '/marketplace';
  const link = `${base}?item=${encodeURIComponent(String(log._id))}`;

  return Announcement.create({
    title: `Just added — ${log.title || label}`,
    message: `${log.title ? `"${log.title}" ` : 'A new item '}was just added to ${label}. Open it to review the details and buy when ready.`,
    level: 'success',
    link,
    linkLabel: 'Browse item',
    image: log.picture || '',
    itemId: log._id,
    active: true,
    createdBy: 'system',
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  });
}

module.exports = mountRestockNotify;
module.exports.announceNewStock = announceNewStock;

