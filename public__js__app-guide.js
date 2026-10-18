/* ────────────────────────────────────────────────────────────────────────────
   King Social Hub App Guide — presentation-only add-on that runs on every page.

     1. Injects a friendly "How it works" panel on the Numbers, Boost and
        Deposit pages so customers know exactly what to do.
     2. Makes the Server 1 / Server 2 choice obvious (adds badges + keeps the
        selected card highlighted) on phone, tablet and desktop.
     3. Shows a blue restock alert when numbers, boost services or logs are
        topped up by the admin.
     4. Prefills the deposit amount when arriving from the dashboard
        (/deposit?amount=2000).
   No business logic is touched.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TOKEN = function () { try { return localStorage.getItem('ksl_token'); } catch (e) { return null; } };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Inline SVGs (not sprite refs) so the panels look right on every page,
  // including pages whose sprite does not carry these icons.
  var SVG = {
    'i-info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    'i-chevron-down': '<path d="M6 9l6 6 6-6"/>',
    'i-bell': '<path d="M18 16V11a6 6 0 1 0-12 0v5l-2 3h16z"/><path d="M10 22h4"/>'
  };
  function icon(id) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (SVG[id] || '') + '</svg>';
  }
  function path() {
    var p = location.pathname.replace(/\.html$/, '');
    return p.length > 1 ? p.replace(/\/$/, '') : '/';
  }

  /* ── 1. Instruction panels ─────────────────────────────────────────────── */
  var GUIDES = {
    '/buy-number': {
      title: 'How buying a number works',
      steps: [
        '<b>Pick a server.</b> <b>Server 1</b> is USA numbers for <b>WhatsApp Business only</b>. <b>Server 2</b> covers every other app (Telegram, Facebook, Instagram, banking apps…) and many countries.',
        '<b>Choose the app and country</b> you need the code for, then check the price shown before you continue.',
        '<b>Press buy.</b> The cost leaves your wallet and the number appears on screen straight away.',
        '<b>Use the number</b> in the app you are registering, then come back — the code lands on the order page automatically.',
        '<b>No code?</b> Cancel the order before it expires and you are refunded automatically.'
      ],
      note: 'One number = one code for one app. Never reuse a number on a second app. Keep this page open while you wait — the code usually arrives in under 2 minutes.'
    },
    '/boost': {
      title: 'How boosting works',
      steps: [
        '<b>Choose a platform</b> (Instagram, TikTok, YouTube…) then pick the exact service — followers, likes, views and so on.',
        '<b>Paste your link or username</b> exactly as it appears in the app, and make sure the account is <b>public</b>.',
        '<b>Enter the quantity.</b> The price updates live and shows the total before you pay.',
        '<b>Press order.</b> The amount leaves your wallet and delivery starts, usually within minutes.',
        '<b>Track it</b> under Boost history — you will see start count, delivered amount and status.'
      ],
      note: 'Do not change your username or make the account private while an order is running — that stops delivery and cannot be refunded. Anything the provider fails to deliver is refunded to your wallet automatically.'
    },
    '/boost-services': {
      title: 'How to browse services',
      steps: [
        '<b>Search</b> by platform or keyword — for example “TikTok views”.',
        '<b>Compare</b> the price per 1,000, minimum and maximum quantity, and the delivery speed on each card.',
        '<b>Tap a service</b> to open the order form with everything already filled in.'
      ],
      note: 'Prices are per 1,000 units. The list is sorted cheapest first so you can always see the best rate.'
    },
    '/deposit': {
      title: 'How to add money',
      steps: [
        '<b>Enter the amount</b> you want credited to your wallet.',
        '<b>Pick a method</b> — bank transfer or card. Bank transfer is credited automatically within seconds.',
        '<b>Complete payment</b>, then return here. Your new balance shows at the top of every page.'
      ],
      note: 'A small processing fee applies to card and payment-link deposits — the fee is always shown before you pay.'
    }
  };

  function buildGuide() {
    var g = GUIDES[path()];
    if (!g || document.querySelector('.gd[data-auto]')) return;
    var box = document.createElement('div');
    box.className = 'gd open';
    box.setAttribute('data-auto', '1');
    box.innerHTML =
      '<button class="gd-head" type="button" data-gd-toggle>' + icon('i-info') + ' ' + esc(g.title) +
        '<span class="gd-caret">' + icon('i-chevron-down') + '</span></button>' +
      '<div class="gd-body"><ol>' + g.steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
      '</ol><div class="gd-note">' + esc(g.note) + '</div></div>';

    var anchor = document.querySelector('.app-backbar') || document.querySelector('.navbar');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else document.body.insertBefore(box, document.body.firstChild);
  }

  document.addEventListener('click', function (e) {
    var h = e.target.closest('[data-gd-toggle]');
    if (h) h.parentNode.classList.toggle('open');
  });

  /* ── 2. Clearer Server 1 / Server 2 choice ─────────────────────────────── */
  var SRV_BADGE = {
    srvTab1: 'USA · WhatsApp Business',
    srvTab2: 'All apps · 100+ countries'
  };
  function decorateServers() {
    Object.keys(SRV_BADGE).forEach(function (id) {
      var card = document.getElementById(id);
      if (!card || card.querySelector('.srv-badge')) return;
      var body = card.querySelector('.srv-body') || card;
      var b = document.createElement('span');
      b.className = 'srv-badge';
      b.textContent = SRV_BADGE[id];
      body.appendChild(b);
    });
    document.addEventListener('click', function (e) {
      var card = e.target.closest('.srv-card');
      if (!card) return;
      document.querySelectorAll('.srv-card').forEach(function (c) { c.classList.toggle('selected', c === card); });
    });
  }

  /* ── 3. Restock alerts ─────────────────────────────────────────────────── */
  var RESTOCK_RE = /restock|back in stock|re-?stocked|now available/i;
  function seenKey() { return 'ksl_restock_seen'; }
  function seen() { try { return JSON.parse(localStorage.getItem(seenKey()) || '[]'); } catch (e) { return []; } }
  function markSeen(id) {
    try {
      var s = seen(); s.push(String(id));
      localStorage.setItem(seenKey(), JSON.stringify(s.slice(-40)));
    } catch (e) {}
  }
  function toast(item) {
    if (document.querySelector('.rs-toast')) return;
    var a = document.createElement('a');
    a.className = 'rs-toast';
    a.href = '/notifications';
    a.innerHTML =
      '<span class="rs-ico">' + icon('i-bell') + '</span>' +
      '<span><span class="rs-t">' + esc(item.title) + '</span>' +
      '<span class="rs-s">' + esc(String(item.message || '').slice(0, 110)) + '</span></span>' +
      '<button class="rs-x" type="button" aria-label="Close">×</button>';
    a.querySelector('.rs-x').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); a.remove();
    });
    document.body.appendChild(a);
    setTimeout(function () { if (a.parentNode) a.remove(); }, 12000);
  }
  function checkRestock() {
    if (!TOKEN()) return;
    fetch('/api/announcements', { headers: { Authorization: 'Bearer ' + TOKEN() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (r) {
        var items = Array.isArray(r) ? r : (r && (r.items || r.announcements)) || [];
        var done = seen();
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var id = String(it._id || it.id || it.title);
          if (done.indexOf(id) > -1) continue;
          if (!RESTOCK_RE.test(String(it.title || '') + ' ' + String(it.message || ''))) continue;
          markSeen(id);
          toast(it);
          break;
        }
      })
      .catch(function () {});
  }

  /* ── 4. Deposit amount handed over from the dashboard ──────────────────── */
  function prefillDeposit() {
    if (path() !== '/deposit') return;
    var v = new URLSearchParams(location.search).get('amount');
    if (!v) return;
    var tries = 0;
    var t = setInterval(function () {
      var input = document.getElementById('depPlAmountInput');
      if (input) {
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        clearInterval(t);
      }
      if (++tries > 20) clearInterval(t);
    }, 250);
  }

  function boot() {
    buildGuide();
    decorateServers();
    prefillDeposit();
    checkRestock();
    setInterval(checkRestock, 90000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
