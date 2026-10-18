/* King Social Hub dashboard — wallet, unified activity, profile and balance controls. */
(function () {
  'use strict';

  var hidden = false;
  var balance = 0;
  try { hidden = localStorage.getItem('ksl_hide_balance') === '1'; } catch (e) {}

  function token() { try { return localStorage.getItem('ksl_token'); } catch (e) { return null; } }
  function user() { try { return JSON.parse(localStorage.getItem('ksl_user') || 'null') || {}; } catch (e) { return {}; } }
  function get(path) {
    var t = token();
    return fetch(path, { headers: t ? { Authorization: 'Bearer ' + t } : {} })
      .then(function (response) { return response.ok ? response.json() : null; })
      .catch(function () { return null; });
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function money(value) {
    return '₦' + Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function when(value) {
    var date = new Date(value);
    if (!value || isNaN(date)) return '';
    return date.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }) + ', ' +
      date.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  }
  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="#' + name + '"/></svg>';
  }
  function showBalance() {
    var element = document.getElementById('dshBal');
    if (element) element.textContent = hidden ? '₦••••••' : money(balance);
  }
  function setIdentity() {
    var current = user();
    var name = String(current.username || current.name || current.email || 'there').split('@')[0];
    var greeting = document.getElementById('dshHi');
    var avatar = document.getElementById('dshAvatar');
    if (greeting) greeting.textContent = 'Hi, ' + name;
    if (avatar) avatar.textContent = name.charAt(0).toUpperCase() || 'K';
  }
  function activityRow(item) {
    return '<a class="dashboard-activity-row" href="/transactions">' +
      '<span class="dashboard-activity-icon">' + icon(item.icon) + '</span>' +
      '<span class="dashboard-activity-copy"><b>' + esc(item.title) + '</b><small>' + esc(when(item.date)) + '</small></span>' +
      '<span class="dashboard-activity-value"><b>' + esc(item.amount) + '</b><small>' + esc(item.status || 'Successful') + '</small></span>' +
      '</a>';
  }
  function loadActivity() {
    Promise.all([get('/api/user/transactions'), get('/api/numbers/my-orders'), get('/api/boost/orders-live')]).then(function (responses) {
      var items = [];
      var transactions = Array.isArray(responses[0]) ? responses[0] : [];
      transactions.forEach(function (entry) {
        var credit = ['deposit', 'admin_credit', 'refund', 'bonus'].indexOf(entry.type) > -1;
        items.push({
          icon: credit ? 'i-credit-card' : 'i-cart',
          title: entry.description || entry.note || (credit ? 'Wallet deposit' : 'Marketplace purchase'),
          date: entry.createdAt,
          amount: (credit ? '+' : '-') + money(Math.abs(Number(entry.amount || 0))),
          status: entry.status || 'Successful'
        });
      });
      var numbers = Array.isArray(responses[1]) ? responses[1] : [];
      numbers.forEach(function (entry) {
        items.push({ icon: 'i-smartphone', title: entry.phoneNumber || 'Number order', date: entry.createdAt, amount: '-' + money(entry.sellPrice || 0), status: entry.status || 'Processing' });
      });
      var boosts = Array.isArray(responses[2]) ? responses[2] : ((responses[2] && responses[2].orders) || []);
      boosts.forEach(function (entry) {
        items.push({ icon: 'i-zap', title: entry.serviceName || entry.service || 'Boost order', date: entry.createdAt || entry.date, amount: '-' + money(entry.charge || entry.price || entry.amount || 0), status: entry.status || 'Processing' });
      });
      items.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
      var box = document.getElementById('dshActivity');
      if (!box) return;
      box.innerHTML = items.length ? items.slice(0, 2).map(activityRow).join('') : '<div class="dashboard-empty">Your latest transactions will appear here.</div>';
    });
  }

  setIdentity();
  showBalance();
  var eye = document.getElementById('dshEye');
  if (eye) eye.addEventListener('click', function () {
    hidden = !hidden;
    try { localStorage.setItem('ksl_hide_balance', hidden ? '1' : '0'); } catch (e) {}
    showBalance();
  });
  get('/api/user/wallet').then(function (wallet) {
    if (!wallet) return;
    balance = Number(wallet.balance != null ? wallet.balance : (wallet.wallet || 0));
    showBalance();
  });
  get('/api/referrals/summary').then(function (summary) {
    var element = document.getElementById('dshRef');
    if (element && summary) element.textContent = money(summary.totalEarned || summary.earnings || 0);
  });
  get('/api/user/profile').then(function (profile) {
    var source = profile && (profile.profilePicture || profile.avatar);
    var avatar = document.getElementById('dshAvatar');
    if (source && avatar) avatar.innerHTML = '<img src="' + esc(source) + '" alt="Profile photo"/>';
  });
  get('/api/user/notifications').then(function (response) {
    var items = Array.isArray(response) ? response : ((response && response.items) || []);
    var unread = response && response.unread != null ? response.unread : items.length;
    var notice = document.getElementById('dshNotif');
    if (notice && unread) { notice.hidden = false; notice.textContent = unread > 99 ? '99+' : unread; }
  });
  loadActivity();
  setInterval(function () {
    if (document.hidden) return;
    get('/api/user/wallet').then(function (wallet) {
      if (!wallet) return;
      balance = Number(wallet.balance != null ? wallet.balance : (wallet.wallet || 0));
      showBalance();
    });
  }, 15000);
})();
