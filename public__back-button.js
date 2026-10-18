/* Adds a slim "Back" bar at the top of every inner page. */
(function () {
  if (window.__kslBackBar) return; window.__kslBackBar = true;
  var path = location.pathname.replace(/\/+$/, '') || '/';
  var skip = ['/', '/dashboard', '/login', '/register', '/welcome', '/terms'];
  if (skip.indexOf(path) !== -1 || /admin/i.test(path)) return;
  function mount() {
    if (document.getElementById('kslBackBar') || !document.body) return;
    var st = document.createElement('style');
    st.textContent = '#kslBackBar{position:sticky;top:0;z-index:9990;display:flex;align-items:center;padding:8px 12px;background:var(--card,#fff);border-bottom:1px solid var(--border,rgba(0,0,0,.1))}' +
      '#kslBackBar button{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid #0788e8;background:transparent;color:#0788e8;border-radius:999px;font-weight:700;font-size:14px;cursor:pointer}' +
      '[data-theme="dark"] #kslBackBar{background:#12141c}';
    document.head.appendChild(st);
    var bar = document.createElement('div');
    bar.id = 'kslBackBar';
    bar.innerHTML = '<button type="button" aria-label="Go back">\u2190 Back</button>';
    bar.querySelector('button').onclick = function () {
      if (path === '/boost1' || path === '/boost2') { location.href = '/boost'; return; }
      if (path === '/boost') { location.href = '/dashboard'; return; }
      var sameSite = document.referrer && document.referrer.indexOf(location.origin) === 0;
      if (sameSite && history.length > 1) history.back(); else location.href = '/dashboard';
    };
    document.body.insertBefore(bar, document.body.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
