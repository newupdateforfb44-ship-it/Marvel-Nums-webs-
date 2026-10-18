/* public/js/announcements.js — admin broadcast notifications.
 *
 * The owner posts announcements from Admin → Notifications bar. Every logged-in
 * user gets a popup with three actions:
 *   • Don't show again  → permanently dismissed for that user (saved server-side)
 *   • Cancel            → closed for this session only, shown again next visit
 *   • Read more         → opens the admin's link, or the in-app /notifications
 *                         page when the announcement has no link
 *
 * Read + dismissed state is stored per user in the database (not just in this
 * browser), so it survives logout, a cleared cache and a brand new device.
 */
(function () {
  const T = () => { try { return localStorage.getItem('ksl_token') || ''; } catch (e) { return ''; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SESSION_KEY = 'kls_ann_snoozed';   // ids the user pressed "Cancel" on, this session only

  const snoozed = () => {
    try { return new Set(JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]')); } catch (e) { return new Set(); }
  };
  const snooze = id => {
    try {
      const s = snoozed(); s.add(String(id));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...s]));
    } catch (e) {}
  };

  let items = [];
  let queue = [];
  let openId = null;

  async function api(url, opts = {}) {
    const r = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T(), ...(opts.headers || {}) },
    });
    const raw = await r.text();
    let d = {};
    if (raw) { try { d = JSON.parse(raw); } catch (e) { d = {}; } }
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  const setState = (id, body) => api('/api/announcements/' + encodeURIComponent(id) + '/state', {
    method: 'POST', body: JSON.stringify(body),
  }).catch(() => {});

  const timeAgo = iso => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
    return Math.floor(mins / 1440) + 'd ago';
  };

  /* ── Popup ─────────────────────────────────────────────────────────────── */
  function ensureModal() {
    let el = document.getElementById('klsAnnModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'klsAnnModal';
    el.className = 'klsann-modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'klsAnnModalTitle');
    el.hidden = true;
    el.innerHTML = `
      <div class="klsann-backdrop" data-klsann="cancel"></div>
      <div class="klsann-box">
        <div class="klsann-level" id="klsAnnModalLevel">Announcement</div>
        <img class="klsann-image" id="klsAnnModalImage" alt="" hidden/>
        <h3 class="klsann-title" id="klsAnnModalTitle"></h3>
        <div class="klsann-msg" id="klsAnnModalMsg"></div>
        <div class="klsann-actions">
          <button type="button" class="klsann-btn klsann-btn-primary" data-klsann="readmore" id="klsAnnReadMore">Read more</button>
          <button type="button" class="klsann-btn" data-klsann="cancel">Cancel</button>
          <button type="button" class="klsann-btn klsann-btn-ghost" data-klsann="never">Don't show again</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const act = e.target.closest('[data-klsann]')?.dataset.klsann;
      if (!act) return;
      if (act === 'cancel') { snooze(openId); close(); next(); }
      if (act === 'never') { const id = openId; setState(id, { dismissed: true }); markLocal(id, { read: true, dismissed: true }); close(); next(); }
      if (act === 'readmore') readMore();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !el.hidden) { snooze(openId); close(); }
    });
    return el;
  }

  function markLocal(id, patch) {
    const a = items.find(x => String(x.id) === String(id));
    if (a) Object.assign(a, patch);
    renderPage();
    paintBadge();
  }

  function readMore() {
    const a = items.find(x => String(x.id) === String(openId));
    // Analytics: "Read more" is the click we measure against views.
    setState(openId, { read: true, clicked: true });
    markLocal(openId, { read: true });
    close();
    if (a && a.link) {
      if (/^https?:\/\//i.test(a.link)) window.open(a.link, '_blank', 'noopener');
      else window.location.href = a.link;
      return;
    }
    // No link from the admin → take them straight to the notifications page.
    window.location.href = '/notifications';
  }

  function close() {
    const el = document.getElementById('klsAnnModal');
    if (el) el.hidden = true;
    document.body.classList.remove('klsann-open');
    openId = null;
  }

  function show(a) {
    const el = ensureModal();
    openId = a.id;
    el.querySelector('#klsAnnModalTitle').textContent = a.title;
    el.querySelector('#klsAnnModalMsg').textContent = a.message;
    const image = el.querySelector('#klsAnnModalImage');
    if (a.image) { image.src = a.image; image.alt = a.title || 'New item'; image.hidden = false; }
    else { image.removeAttribute('src'); image.hidden = true; }
    const lvl = el.querySelector('#klsAnnModalLevel');
    lvl.textContent = ({ info: 'Announcement', success: 'Good news', warning: 'Please note', urgent: 'Important' })[a.level] || 'Announcement';
    el.querySelector('.klsann-box').setAttribute('data-level', a.level || 'info');
    const btn = el.querySelector('#klsAnnReadMore');
    btn.textContent = a.linkLabel || 'Read more';
    el.hidden = false;
    document.body.classList.add('klsann-open');
    // Analytics: record that this user actually saw the announcement.
    setState(a.id, { viewed: true });
    setTimeout(() => { try { btn.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }

  /** Another blocking overlay (e.g. the complete-your-profile gate) owns the screen. */
  function blocked() {
    const gate = document.getElementById('klsProfileGate');
    return !!(gate && gate.offsetParent !== null);
  }

  function next() {
    if (blocked()) { setTimeout(next, 4000); return; }   // wait until the user clears it
    const skip = snoozed();
    while (queue.length) {
      const a = queue.shift();
      if (!a || a.dismissed || a.read || skip.has(String(a.id))) continue;
      show(a);
      return;
    }
  }


  /* ── Notifications page list ───────────────────────────────────────────── */
  function pageHost() {
    const list = document.getElementById('notifPageList');
    if (!list) return null;
    let host = document.getElementById('klsAnnPageList');
    if (!host) {
      host = document.createElement('div');
      host.id = 'klsAnnPageList';
      host.className = 'klsann-page';
      list.parentNode.insertBefore(host, list);
    }
    return host;
  }

  function renderPage() {
    const host = pageHost();
    if (!host) return;
    if (!items.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="klsann-page-head">From King Social Hub <span class="klsann-page-count">${items.filter(a => !a.read).length} unread</span></div>`
      + items.map(a => `
      <article class="klsann-card ${a.read ? 'is-read' : 'is-unread'}" data-level="${esc(a.level || 'info')}" data-id="${esc(a.id)}">
        ${a.image ? `<img class="klsann-card-image" src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy">` : ''}
        <div class="klsann-card-top">
          <span class="klsann-dot" aria-hidden="true"></span>
          <h4 class="klsann-card-title">${esc(a.title)}</h4>
          <span class="klsann-card-state">${a.read ? 'Read' : 'New'}</span>
        </div>
        <p class="klsann-card-msg">${esc(a.message)}</p>
        <div class="klsann-card-foot">
          <span class="klsann-card-time">${esc(timeAgo(a.createdAt))}</span>
          ${a.link ? `<a class="klsann-card-link" href="${esc(a.link)}"${/^https?:\/\//i.test(a.link) ? ' target="_blank" rel="noopener"' : ''} data-read="${esc(a.id)}">${esc(a.linkLabel || 'Read more')}</a>` : ''}
          ${a.read ? '' : `<button type="button" class="klsann-card-btn" data-read="${esc(a.id)}">Mark as read</button>`}
        </div>
      </article>`).join('');
    host.querySelectorAll('[data-read]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.read;
        const isLink = el.classList.contains('klsann-card-link');
        setState(id, isLink ? { read: true, clicked: true } : { read: true });
        markLocal(id, { read: true });
      });
    });
  }

  async function paintBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    let unread = items.filter(a => !a.read).length;
    try {
      const all = await api('/api/user/notifications');
      unread = Number(all.count || unread);
    } catch (e) {}
    if (unread > 0) { badge.style.display = 'flex'; badge.textContent = unread > 9 ? '9+' : String(unread); }
    else badge.style.display = 'none';
  }

  async function load() {
    if (!T()) return;
    let d;
    try { d = await api('/api/announcements'); } catch (e) { return; }
    items = d.items || [];
    queue = items.filter(a => (d.popups || []).map(String).includes(String(a.id)));
    renderPage();
    paintBadge();
    if (!document.getElementById('klsAnnModal') || document.getElementById('klsAnnModal').hidden) next();
  }

  window.KLSAnnouncements = { reload: load, renderPage };

  const boot = () => setTimeout(load, 600);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
