/* ────────────────────────────────────────────────────────────────────────────
   King Social Hub App Shell (js)

   Runs on every page. Responsibilities:
     1. Mark <body> as app-shell and remove the old slide-out drawer.
     2. Render the fixed bottom tab bar.
     3. Build the app-style dashboard on the logged-in home page
        (greeting + notifications, balance card, quick actions, service grid,
        recent activity).
     4. Provide ONE unified history feed (wallet + purchases + boost orders +
        Server 1 / Server 2 number orders) used by the home page and by the
        Transactions page.
     5. Add a "Back to menu" control on inner pages.
   Pure add-on: nothing in the original scripts is modified.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var TOKEN = function () { try { return localStorage.getItem('ksl_token'); } catch (e) { return null; } };
  var USER = function () { try { return JSON.parse(localStorage.getItem('ksl_user') || 'null'); } catch (e) { return null; } };
  var hideBal = false;
  try { hideBal = localStorage.getItem('ksl_hide_balance') === '1'; } catch (e) {}

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ico(name) { return '<svg class="icon" aria-hidden="true"><use href="#' + name + '"/></svg>'; }
  function money(n) {
    var v = Number(n || 0);
    return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function when(d) {
    if (!d) return '';
    var t = new Date(d);
    if (isNaN(t)) return '';
    return t.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }) + ', ' +
      t.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  }
  function get(path) {
    var t = TOKEN();
    return fetch(path, { headers: t ? { Authorization: 'Bearer ' + t } : {} })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ── 1. Shell + drawer removal ─────────────────────────────────────────── */
  function initShell() {
    document.body.classList.add('app-shell');
    // Icons the shell needs that some page sprites do not carry.
    if (!document.getElementById('i-grid')) {
      var sp = document.createElement('div');
      sp.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      sp.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<symbol id="i-grid" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/>' +
        '<rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>' +
        '<rect x="14" y="14" width="7" height="7" rx="1.5"/></g></symbol></svg>';
      document.body.appendChild(sp);
    }
    ['mobileMenu', 'drawerBackdrop', 'hamburger'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  /* ── 2. Bottom tab bar ─────────────────────────────────────────────────── */
  var TABS = [
    { href: '/dashboard', label: 'Home', icon: 'i-home', match: ['/', '/index.html', '/dashboard'] },
    { href: '/marketplace', label: 'Logs', icon: 'i-grid', match: ['/marketplace', '/purchases'] },
    { href: '/boost', label: 'Boost', icon: 'i-zap', match: ['/boost', '/boost-services', '/boost-history'] },
    { href: '/buy-number', label: 'Numbers', icon: 'i-smartphone', match: ['/buy-number', '/number-history', '/order-status'] },
    { href: '/settings', label: 'Me', icon: 'i-user', match: ['/settings', '/transactions', '/wallet', '/referrals', '/notifications', '/support'] }
  ];
  function currentPath() {
    var p = location.pathname.replace(/\.html$/, '');
    return p.length > 1 ? p.replace(/\/$/, '') : '/';
  }
  function renderTabs() {
    if (!TOKEN()) return;
    if (document.querySelector('.app-tabbar')) return;
    var here = currentPath();
    var nav = document.createElement('nav');
    nav.className = 'app-tabbar';
    nav.setAttribute('aria-label', 'Main');
    nav.innerHTML = TABS.map(function (t) {
      var active = t.match.indexOf(here) > -1;
      return '<a class="app-nav-item' + (active ? ' active' : '') + '" href="' + t.href + '">' +
        '<span class="app-nav-icon">' + ico(t.icon) + '</span><span>' + t.label + '</span></a>';
    }).join('');
    document.body.appendChild(nav);
  }

  /* ── 3. Unified history feed ───────────────────────────────────────────── */
  var cache = null;
  function loadHistory() {
    if (cache) return Promise.resolve(cache);
    return Promise.all([
      get('/api/user/transactions'),
      get('/api/numbers/my-orders'),
      get('/api/boost/orders-live')
    ]).then(function (r) {
      var items = [];
      (Array.isArray(r[0]) ? r[0] : []).forEach(function (t) {
        var isCredit = t.type === 'deposit' || t.type === 'admin_credit' || t.type === 'refund' || t.type === 'bonus';
        items.push({
          group: isCredit ? 'wallet' : 'purchase',
          icon: isCredit ? 'i-credit-card' : 'i-cart',
          title: t.description || t.note || (t.type === 'deposit' ? 'Wallet deposit' : 'Purchase'),
          date: t.createdAt,
          amount: (isCredit ? '+' : '-') + money(Math.abs(Number(t.amount || 0))),
          dir: isCredit ? 'up' : 'down',
          status: t.status || 'success'
        });
      });
      (Array.isArray(r[1]) ? r[1] : []).forEach(function (n) {
        items.push({
          group: n.server === 'server2' ? 'server2' : 'server1',
          icon: 'i-smartphone',
          title: (n.server === 'server2' ? 'Server 2' : 'Server 1') + ' — ' + (n.phoneNumber || 'Number order'),
          date: n.createdAt,
          amount: '-' + money(n.sellPrice || 0),
          dir: 'down',
          status: n.status,
          sub: [n.country, n.operator, n.code ? 'Code: ' + n.code : ''].filter(Boolean).join(' • ')
        });
      });
      var boost = Array.isArray(r[2]) ? r[2] : (r[2] && Array.isArray(r[2].orders) ? r[2].orders : []);
      boost.forEach(function (b) {
        items.push({
          group: 'boost',
          icon: 'i-zap',
          title: 'Boost — ' + (b.serviceName || b.service || 'Order'),
          date: b.createdAt || b.date,
          amount: '-' + money(b.charge || b.price || b.amount || 0),
          dir: 'down',
          status: b.status || 'processing',
          sub: [b.quantity ? 'Qty ' + Number(b.quantity).toLocaleString() : '', b.link || ''].filter(Boolean).join(' • ')
        });
      });
      items.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
      cache = items;
      return items;
    });
  }
  function statusClass(s) {
    s = String(s || '').toLowerCase();
    if (['success', 'delivered', 'completed', 'approved', 'paid'].indexOf(s) > -1) return '';
    if (['failed', 'cancelled', 'rejected', 'expired'].indexOf(s) > -1) return ' bad';
    return ' warn';
  }
  function rowHtml(it) {
    return '<div class="hm-row">' +
      '<span class="hm-row-ico">' + ico(it.icon) + '</span>' +
      '<span class="hm-row-main"><span class="hm-row-t">' + esc(it.title) + '</span>' +
      '<span class="hm-row-s">' + esc(when(it.date)) + (it.sub ? ' • ' + esc(it.sub) : '') + '</span></span>' +
      '<span class="hm-row-side"><span class="hm-row-amt ' + it.dir + '">' + it.amount + '</span>' +
      '<span class="hm-chip' + statusClass(it.status) + '">' + esc(it.status || 'success') + '</span></span>' +
      '</div>';
  }
  function renderFeed(box, items, empty) {
    if (!box) return;
    box.innerHTML = items.length
      ? items.map(rowHtml).join('')
      : '<div class="hm-empty">' + esc(empty || 'Nothing here yet.') + '</div>';
  }

  /* ── 4. App-style home dashboard ───────────────────────────────────────── */
  function buildHome() {
    var host = document.getElementById('page-home');
    if (!host || !TOKEN() || document.getElementById('hmDash')) return;
    var u = USER() || {};
    var name = String(u.username || u.name || u.email || 'there').split('@')[0];
    var initial = name.charAt(0).toUpperCase();

    host.querySelectorAll('.hero-section, .hero').forEach(function (el) { el.style.display = 'none'; });

    var wrap = document.createElement('div');
    wrap.className = 'hm';
    wrap.id = 'hmDash';
    wrap.innerHTML =
      '<div class="hm-top">' +
        '<span class="hm-ava" id="hmAva">' + esc(initial) + '</span>' +
        '<span class="hm-hi">Hi, ' + esc(name) + '<small>Welcome back to King Social Hub</small></span>' +
        '<a class="hm-ico-btn" href="/support" aria-label="Support">' + ico('i-headset') + '</a>' +
        '<a class="hm-ico-btn" href="/notifications" aria-label="Notifications">' + ico('i-bell') +
          '<span class="hm-dot" id="hmNotifDot" style="display:none">0</span></a>' +
      '</div>' +
      '<a class="hm-ticker" id="hmTicker" href="/notifications">' + ico('i-bell') +
        '<span id="hmTickerText">King Social Hub is fully operational — deposits and orders are running normally</span>' + ico('i-arrow-right') + '</a>' +
      '<div>' +
        '<div class="hm-bal">' +
          '<div class="hm-bal-row">' +
            '<span class="hm-bal-label">' + ico('i-shield') + ' Available Balance' +
              '<button class="hm-eye" id="hmEye" type="button" aria-label="Show or hide balance">' + ico('i-eye') + '</button></span>' +
            '<a class="hm-bal-link" href="/transactions">Transaction History ›</a>' +
          '</div>' +
          '<div class="hm-bal-foot">' +
            '<div class="hm-bal-amt" id="hmBal">₦0.00</div>' +
            '<a class="hm-add" href="/deposit">+ Add Money</a>' +
          '</div>' +
        '</div>' +
        '<a class="hm-sub" href="/referrals">' + ico('i-link') +
          '<span>Referral earnings — <b id="hmRef">₦0.00</b></span>' +
          '<span class="hm-sub-go">' + ico('i-arrow-right') + '</span></a>' +
      '</div>' +
      '<div class="hm-card" id="hmRecentCard">' +
        '<div id="hmRecent"><div class="hm-empty">Loading your activity…</div></div>' +
      '</div>' +
      '<div class="hm-quick">' +
        '<a href="/deposit"><span class="hm-q-ico">' + ico('i-credit-card') + '</span>Add Money</a>' +
        '<a href="/buy-number"><span class="hm-q-ico">' + ico('i-smartphone') + '</span>Buy Number</a>' +
        '<a href="/boost"><span class="hm-q-ico">' + ico('i-zap') + '</span>Boost</a>' +
      '</div>' +
      '<div class="hm-card">' +
        '<div class="hm-grid">' +
          '<a href="/dashboard"><span class="hm-g-ico">' + ico('i-grid') + '</span>Dashboard</a>' +
          '<a href="/marketplace"><span class="hm-g-ico">' + ico('i-cart') + '</span>Logs</a>' +
          '<a href="/buy-number"><span class="hm-g-ico">' + ico('i-smartphone') + '</span>Numbers</a>' +
          '<a href="/boost"><span class="hm-g-ico">' + ico('i-zap') + '</span>Boost</a>' +
          '<a href="/tools"><span class="hm-g-ico">' + ico('i-wrench') + '</span>Tools &amp; FMT</a>' +
          '<a href="/games"><span class="hm-g-ico">' + ico('i-gamepad') + '</span>Games</a>' +
          '<a href="/giveaways"><span class="hm-g-ico">' + ico('i-gift') + '</span>Giveaways</a>' +
          '<a href="/referrals"><span class="hm-g-ico">' + ico('i-link') + '</span>Referrals</a>' +
          '<a href="/settings"><span class="hm-g-ico">' + ico('i-settings') + '</span>Settings</a>' +
        '</div>' +
      '</div>' +
      '<div class="hm-card">' +
        '<div class="hm-head"><h3>All Activity</h3><a href="/transactions">See all ›</a></div>' +
        '<div class="hm-tabs" id="hmTabs" style="padding:0 14px 8px">' +
          '<button class="hm-tab active" data-f="all" type="button">All</button>' +
          '<button class="hm-tab" data-f="wallet" type="button">Wallet</button>' +
          '<button class="hm-tab" data-f="purchase" type="button">Purchases</button>' +
          '<button class="hm-tab" data-f="boost" type="button">Boost</button>' +
          '<button class="hm-tab" data-f="server1" type="button">Server 1</button>' +
          '<button class="hm-tab" data-f="server2" type="button">Server 2</button>' +
        '</div>' +
        '<div id="hmFeed"><div class="hm-empty">Loading history…</div></div>' +
      '</div>';

    // Keep the home page purely app-style: hide the old marketing sections.
    Array.prototype.slice.call(host.children).forEach(function (el) { el.style.display = 'none'; });
    host.insertBefore(wrap, host.firstChild);

    applyBalanceUi();
    document.getElementById('hmEye').addEventListener('click', function () {
      hideBal = !hideBal;
      try { localStorage.setItem('ksl_hide_balance', hideBal ? '1' : '0'); } catch (e) {}
      applyBalanceUi();
    });

    get('/api/user/wallet').then(function (w) {
      if (!w) return;
      window.__kslBalance = Number(w.balance != null ? w.balance : (w.wallet || 0));
      applyBalanceUi();
    });
    get('/api/referrals/summary').then(function (s) {
      if (!s) return;
      var el = document.getElementById('hmRef');
      if (el) el.textContent = money(s.totalEarned || s.earnings || 0);
    });
    get('/api/user/notifications').then(function (n) {
      var items = Array.isArray(n) ? n : (n && n.items) || [];
      var unread = (n && n.unread != null) ? n.unread : items.length;
      var dot = document.getElementById('hmNotifDot');
      if (dot && unread) { dot.style.display = 'flex'; dot.textContent = unread > 99 ? '99+' : unread; }
      if (items.length && items[0].title) {
        var t = document.getElementById('hmTickerText');
        if (t) t.textContent = String(items[0].title).trim() + (items[0].message ? ' — ' + items[0].message : '');
      }
    });
    get('/api/user/profile').then(function (p) {
      var url = p && (p.profilePicture || p.avatar);
      if (url) document.getElementById('hmAva').innerHTML = '<img src="' + esc(url) + '" alt=""/>';
    });

    loadHistory().then(function (items) {
      renderFeed(document.getElementById('hmRecent'), items.slice(0, 2), 'No transactions yet — add money to get started.');
      renderFeed(document.getElementById('hmFeed'), items.slice(0, 8), 'Your boosting, numbers and wallet history will show here.');
      var tabs = document.getElementById('hmTabs');
      tabs.addEventListener('click', function (e) {
        var b = e.target.closest('.hm-tab');
        if (!b) return;
        tabs.querySelectorAll('.hm-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
        var f = b.dataset.f;
        renderFeed(document.getElementById('hmFeed'),
          (f === 'all' ? items : items.filter(function (i) { return i.group === f; })).slice(0, 8),
          'Nothing in this section yet.');
      });
    });
  }
  function applyBalanceUi() {
    var el = document.getElementById('hmBal');
    if (!el) return;
    el.textContent = hideBal ? '₦••••••' : money(window.__kslBalance || 0);
  }

  /* ── 5. Transactions page: one unified history ─────────────────────────── */
  function buildHistoryPage() {
    var page = document.getElementById('page-transactions');
    if (!page || !TOKEN() || document.getElementById('hmHistWrap')) return;
    var seg = document.getElementById('txnSegmented');
    var list = document.getElementById('txnsList');
    if (seg) seg.style.display = 'none';
    if (list) list.style.display = 'none';

    var box = document.createElement('div');
    box.id = 'hmHistWrap';
    box.innerHTML =
      '<div class="hm-tabs" id="hmHistTabs" style="margin-bottom:12px">' +
        '<button class="hm-tab active" data-f="all" type="button">All</button>' +
        '<button class="hm-tab" data-f="wallet" type="button">Wallet</button>' +
        '<button class="hm-tab" data-f="purchase" type="button">Purchases</button>' +
        '<button class="hm-tab" data-f="boost" type="button">Boost</button>' +
        '<button class="hm-tab" data-f="server1" type="button">Numbers — Server 1</button>' +
        '<button class="hm-tab" data-f="server2" type="button">Numbers — Server 2</button>' +
      '</div>' +
      '<div class="hm-card" id="hmHistFeed"><div class="hm-empty">Loading your full history…</div></div>';
    if (list && list.parentNode) list.parentNode.insertBefore(box, list);
    else page.appendChild(box);

    loadHistory().then(function (items) {
      var feed = document.getElementById('hmHistFeed');
      renderFeed(feed, items, 'No history yet.');
      document.getElementById('hmHistTabs').addEventListener('click', function (e) {
        var b = e.target.closest('.hm-tab');
        if (!b) return;
        this.querySelectorAll('.hm-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
        var f = b.dataset.f;
        renderFeed(feed, f === 'all' ? items : items.filter(function (i) { return i.group === f; }), 'Nothing in this section yet.');
      });
    });
  }

  /* ── 6. Back to menu on inner pages ────────────────────────────────────── */
  function addBackToMenu() {
    if (!TOKEN()) return;
    var here = currentPath();
    if (here === '/' || here === '/dashboard' || document.querySelector('.app-backbar')) return;
    var bar = document.createElement('div');
    bar.className = 'app-backbar';
    bar.innerHTML = '<a class="app-back" href="/">' + ico('i-arrow-left') + ' Back to menu</a>';
    var nav = document.querySelector('.navbar');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
  }

  function boot() {
    initShell();
    renderTabs();
    buildHome();
    buildHistoryPage();
    addBackToMenu();
    // The index page swaps sections without reloading — keep the shell in sync.
    window.addEventListener('popstate', function () {
      setTimeout(function () { buildHome(); buildHistoryPage(); }, 60);
    });
    document.addEventListener('click', function () {
      setTimeout(function () { buildHome(); buildHistoryPage(); }, 150);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
