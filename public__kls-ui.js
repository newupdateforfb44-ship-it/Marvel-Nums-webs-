/* King Social Hub — in-page banners & confirmation cards.
 * Replaces the browser's plain "website says…" pop-ups.
 *   alert(msg)              -> slides in a banner (non-blocking)
 *   showToast(msg, type)    -> same banner style
 *   await kslConfirm(msg)   -> nice confirmation card, resolves true / false
 *   KLS.banner(msg, 'success'|'error'|'info'|'warn', {title, ms})
 */
(function () {
  if (window.KLS) return;
  var ICONS = {
    success: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.6 2.6L16 9.5"/></svg>',
    error:   '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    warn:    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18.2v.1"/></svg>',
    info:    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5v.1"/></svg>'
  };
  var TITLES = { success: 'Success', error: 'Something went wrong', warn: 'Please note', info: 'Notice' };
  var css = '' +
    '#klsBanners{position:fixed;left:0;right:0;top:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px;pointer-events:none}' +
    '.kls-b{pointer-events:auto;display:flex;align-items:flex-start;gap:12px;width:min(520px,100%);box-sizing:border-box;padding:14px 16px;border-radius:16px;background:#12141c;color:#f4f4f8;border:1px solid rgba(255,255,255,.08);box-shadow:0 14px 40px rgba(0,0,0,.35);transform:translateY(-130%);opacity:0;transition:transform .35s cubic-bezier(.2,.9,.3,1.2),opacity .25s;font-family:inherit;border-left:5px solid var(--kc)}' +
    '.kls-b.in{transform:none;opacity:1}.kls-b .ic{color:var(--kc);flex:0 0 auto;margin-top:1px}' +
    '.kls-b .tx{flex:1;min-width:0}.kls-b .tt{font-weight:800;font-size:15px;margin:0 0 2px}.kls-b .ms{font-size:14px;line-height:1.45;opacity:.9;word-break:break-word;white-space:pre-line}' +
    '.kls-b .x{background:none;border:0;color:inherit;opacity:.6;font-size:20px;line-height:1;cursor:pointer;padding:0 2px}.kls-b .x:hover{opacity:1}' +
    '.kls-b.success{--kc:#22c55e}.kls-b.error{--kc:#ef4444}.kls-b.warn{--kc:#f59e0b}.kls-b.info{--kc:#38bdf8}' +
    '#klsDlg{position:fixed;inset:0;z-index:2147483100;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(5,7,12,.62);backdrop-filter:blur(3px)}' +
    '#klsDlg.show{display:flex;animation:klsFade .18s}@keyframes klsFade{from{opacity:0}to{opacity:1}}' +
    '.kls-card{width:min(430px,100%);background:#12141c;color:#f4f4f8;border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:24px 22px 20px;box-shadow:0 24px 70px rgba(0,0,0,.5);animation:klsPop .25s cubic-bezier(.2,.9,.3,1.25)}' +
    '@keyframes klsPop{from{transform:scale(.92);opacity:0}to{transform:none;opacity:1}}' +
    '.kls-card .hd{display:flex;align-items:center;gap:12px;margin-bottom:10px}.kls-card .hd .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:rgba(7,136,232,.16);color:#22c55e}' +
    '.kls-card h3{margin:0;font-size:18px}.kls-card p{margin:0 0 20px;font-size:14.5px;line-height:1.55;opacity:.85;white-space:pre-line}' +
    '.kls-card .row{display:flex;gap:10px}.kls-card button{flex:1;padding:12px 14px;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;border:1px solid rgba(255,255,255,.14);background:transparent;color:inherit}' +
    '.kls-card button.ok{background:#0788e8;border-color:#0788e8;color:#fff}.kls-card button.ok.danger{background:#dc2626;border-color:#dc2626}.kls-card button:active{transform:scale(.98)}' +
    '@media (prefers-color-scheme:light){html:not([data-theme="dark"]) .kls-b,html:not([data-theme="dark"]) .kls-card{background:#fff;color:#111827;border-color:rgba(0,0,0,.1)}}' +
    '[data-theme="light"] .kls-b,[data-theme="light"] .kls-card{background:#fff;color:#111827;border-color:rgba(0,0,0,.1)}';
  var box, dlg;
  function ready(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function mount() {
    if (box) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    box = document.createElement('div'); box.id = 'klsBanners'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box);
    dlg = document.createElement('div'); dlg.id = 'klsDlg'; document.body.appendChild(dlg);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function guess(msg, type) {
    var t = String(type || '').toLowerCase();
    if (/^(ok|success|good)$/.test(t)) return 'success';
    if (/^(err|error|bad|fail)/.test(t)) return 'error';
    if (/^(warn|warning)$/.test(t)) return 'warn';
    if (/^(info)$/.test(t)) return 'info';
    var m = String(msg || '');
    if (/✓|✅|success|successful|submitted|received|copied|saved|refunded|credited|added|done|cancelled|selected/i.test(m)) return 'success';
    if (/fail|error|invalid|insufficient|not available|unable|couldn.t|can.t|wrong|denied|expired|rejected|no longer|please (log|select|enter|choose|re-)/i.test(m)) return 'error';
    return 'info';
  }
  function banner(msg, type, opts) {
    opts = opts || {};
    ready(function () {
      mount();
      var kind = guess(msg, type);
      var el = document.createElement('div');
      el.className = 'kls-b ' + kind; el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      el.innerHTML = '<span class="ic">' + ICONS[kind] + '</span><div class="tx"><div class="tt">' + esc(opts.title || TITLES[kind]) + '</div><div class="ms">' + esc(String(msg == null ? '' : msg).replace(/^\s+/, '')) + '</div></div><button class="x" aria-label="Close">×</button>';
      box.appendChild(el);
      while (box.children.length > 3) box.removeChild(box.firstChild);
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('in'); }); });
      var gone = false;
      function close() { if (gone) return; gone = true; el.classList.remove('in'); setTimeout(function () { el.remove(); }, 350); }
      el.querySelector('.x').onclick = close;
      var ms = opts.ms || (kind === 'error' ? 7000 : 4500);
      setTimeout(close, ms);
    });
  }
  var queue = Promise.resolve();
  function confirmCard(message, opts) {
    opts = opts || {};
    var run = function () {
      return new Promise(function (resolve) {
        ready(function () {
          mount();
          var danger = !!opts.danger || /cancel|revoke|sign .*out|delete|close this/i.test(String(message));
          dlg.innerHTML = '<div class="kls-card" role="dialog" aria-modal="true"><div class="hd"><span class="ic">' + ICONS[danger ? 'warn' : 'info'] + '</span><h3>' + esc(opts.title || (danger ? 'Are you sure?' : 'Please confirm')) + '</h3></div><p>' + esc(message) + '</p><div class="row"><button type="button" class="no">' + esc(opts.cancelText || 'No, go back') + '</button><button type="button" class="ok' + (danger ? ' danger' : '') + '">' + esc(opts.okText || (danger ? 'Yes, continue' : 'Yes, confirm')) + '</button></div></div>';
          dlg.classList.add('show');
          var done = false;
          function finish(v) { if (done) return; done = true; dlg.classList.remove('show'); dlg.innerHTML = ''; document.removeEventListener('keydown', key); resolve(v); }
          function key(e) { if (e.key === 'Escape') finish(false); if (e.key === 'Enter') finish(true); }
          dlg.querySelector('.ok').onclick = function () { finish(true); };
          dlg.querySelector('.no').onclick = function () { finish(false); };
          dlg.onclick = function (e) { if (e.target === dlg) finish(false); };
          document.addEventListener('keydown', key);
          setTimeout(function () { var b = dlg.querySelector('.ok'); if (b) b.focus(); }, 30);
        });
      });
    };
    var p = queue.then(run); queue = p.catch(function () {}); return p;
  }

  /* ───────── Tap-to-choose pickers ─────────
   * The big "select tiles" (server / country / service / pool) used to open the phone's own
   * picker, which needs a "Done" tap. Now a tile opens our own sheet instead: tap an item and it
   * is chosen and the sheet closes straight away. The real <select> stays underneath, so every
   * page's existing logic keeps working (we just set its value and fire "change").
   */
  var pcss = '' +
    '.select-tile select{pointer-events:none!important}.select-tile{-webkit-tap-highlight-color:transparent}' +
    '#klsPick{position:fixed;inset:0;z-index:2147483050;display:none;align-items:flex-end;justify-content:center;background:rgba(5,7,12,.6);backdrop-filter:blur(3px)}' +
    '#klsPick.show{display:flex;animation:klsFade .18s}' +
    '.kp-sheet{width:min(560px,100%);max-height:86vh;display:flex;flex-direction:column;background:#12141c;color:#f4f4f8;border:1px solid rgba(255,255,255,.09);border-radius:22px 22px 0 0;box-shadow:0 -18px 60px rgba(0,0,0,.5);animation:kpUp .28s cubic-bezier(.2,.9,.3,1.05)}' +
    '@keyframes kpUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}' +
    '@media (min-width:700px){#klsPick{align-items:center}.kp-sheet{border-radius:22px;max-height:78vh}}' +
    '.kp-hd{display:flex;align-items:center;gap:10px;padding:16px 16px 8px}.kp-hd h3{margin:0;font-size:17px;flex:1}.kp-x{background:rgba(255,255,255,.08);border:0;color:inherit;width:34px;height:34px;border-radius:50%;font-size:20px;line-height:1;cursor:pointer}' +
    '.kp-search{margin:4px 16px 10px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:inherit;font-size:16px;outline:none}.kp-search:focus{border-color:#0788e8}' +
    '.kp-list{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 8px 14px;flex:1;min-height:120px}' +
    '.kp-grp{position:sticky;top:0;z-index:1;padding:8px 10px 4px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;opacity:.65;background:#12141c}' +
    '.kp-item{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;text-align:left;padding:12px 10px;border:0;background:transparent;color:inherit;border-radius:12px;cursor:pointer;font-size:15px;font-family:inherit}' +
    '.kp-item:hover,.kp-item:focus{background:rgba(255,255,255,.07);outline:none}.kp-item:active{background:rgba(7,136,232,.2)}.kp-item.sel{background:rgba(7,136,232,.16)}' +
    '.kp-ic{width:28px;height:28px;flex:0 0 auto;display:grid;place-items:center;font-size:20px}.kp-ic img{width:26px;height:26px;object-fit:contain;border-radius:6px}.kp-ic img.fl{width:28px;height:20px;object-fit:cover;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.15)}' +
    '.kp-tx{flex:1;min-width:0}.kp-nm{font-weight:700;overflow:hidden;text-overflow:ellipsis}.kp-mt{font-size:12.5px;opacity:.7;margin-top:2px}.kp-ck{color:#22c55e;font-weight:900}' +
    '.kp-empty{padding:26px 14px;text-align:center;opacity:.7}' +
    '[data-theme="light"] .kp-sheet{background:#fff;color:#111827;border-color:rgba(0,0,0,.1)}[data-theme="light"] .kp-grp{background:#fff}[data-theme="light"] .kp-search{background:#f3f4f6;border-color:#d1d5db}[data-theme="light"] .kp-item:hover{background:#f3f4f6}[data-theme="light"] .kp-x{background:#eceff3}' +
    '@media (prefers-color-scheme:light){html:not([data-theme="dark"]) .kp-sheet{background:#fff;color:#111827;border-color:rgba(0,0,0,.1)}html:not([data-theme="dark"]) .kp-grp{background:#fff}html:not([data-theme="dark"]) .kp-search{background:#f3f4f6;border-color:#d1d5db}html:not([data-theme="dark"]) .kp-x{background:#eceff3}}';
  var pickEl, pickState = null;
  function flagUrl(emoji) {
    var cp = Array.from(emoji).map(function (c) { return c.codePointAt(0); }).filter(function (c) { return c >= 127462 && c <= 127487; });
    return cp.length === 2 ? 'https://flagcdn.com/w40/' + String.fromCharCode(cp[0] - 127397, cp[1] - 127397).toLowerCase() + '.png' : '';
  }
  function readOptions(sel) {
    var out = [], group = '';
    Array.prototype.forEach.call(sel.children, function (n) {
      if (n.tagName === 'OPTGROUP') {
        group = n.label || '';
        Array.prototype.forEach.call(n.children, function (o) { push(o, group); });
      } else if (n.tagName === 'OPTION') push(n, '');
    });
    function push(o, g) {
      if (o.value === '' || o.disabled) return;
      var text = (o.textContent || '').trim(), icon = o.getAttribute('data-icon') || '', name = o.getAttribute('data-name'), meta = o.getAttribute('data-meta');
      var lead = '';
      var fm = text.match(/^([\u{1F1E6}-\u{1F1FF}]{2})\s*/u);
      if (fm) { lead = 'flag:' + flagUrl(fm[1]); text = text.slice(fm[0].length); }
      if (name == null) {
        var parts = text.split(' — ');
        name = parts.shift(); meta = meta != null ? meta : parts.join(' — ');
        if (!fm && !icon) { var em = name.match(/^([^\w\s]{1,3}(?:\uFE0F)?)\s+(.*)$/u); if (em) { lead = 'emoji:' + em[1]; name = em[2]; } }
      }
      out.push({ value: o.value, name: name, meta: meta || '', icon: icon, lead: lead, group: g, selected: o.selected && sel.value === o.value });
    }
    return out;
  }
  function iconHtml(it) {
    if (it.icon) return '<img src="' + esc(it.icon) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'📱\'))">';
    if (it.lead.indexOf('flag:') === 0 && it.lead.length > 5) return '<img class="fl" src="' + esc(it.lead.slice(5)) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'🌍\'))">';
    if (it.lead.indexOf('emoji:') === 0) return esc(it.lead.slice(6));
    return '';
  }
  function closePick() { if (!pickEl) return; pickEl.classList.remove('show'); pickEl.innerHTML = ''; pickState = null; document.removeEventListener('keydown', pickKey); }
  function pickKey(e) { if (e.key === 'Escape') closePick(); }
  function openPick(sel, tile) {
    ready(function () {
      mount();
      if (!pickEl) {
        var st = document.createElement('style'); st.textContent = pcss; document.head.appendChild(st);
        pickEl = document.createElement('div'); pickEl.id = 'klsPick'; document.body.appendChild(pickEl);
      }
      var items = readOptions(sel);
      var title = ((tile.querySelector('.st-label') || {}).textContent || 'Choose').trim();
      var touch = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
      pickEl.innerHTML = '<div class="kp-sheet" role="dialog" aria-modal="true"><div class="kp-hd"><h3>' + esc(title) + '</h3><button class="kp-x" type="button" aria-label="Close">×</button></div>' +
        (items.length > 7 ? '<input class="kp-search" type="search" placeholder="Search…" autocomplete="off">' : '') + '<div class="kp-list"></div></div>';
      pickEl.classList.add('show');
      var list = pickEl.querySelector('.kp-list'), search = pickEl.querySelector('.kp-search');
      var view = [], shown = 0, STEP = 80;
      pickState = { sel: sel };
      function row(it, i) {
        return '<button type="button" class="kp-item' + (it.selected ? ' sel' : '') + '" data-i="' + i + '"><span class="kp-ic">' + iconHtml(it) + '</span><span class="kp-tx"><div class="kp-nm">' + esc(it.name) + '</div>' + (it.meta ? '<div class="kp-mt">' + esc(it.meta) + '</div>' : '') + '</span>' + (it.selected ? '<span class="kp-ck">✓</span>' : '') + '</button>';
      }
      function paint(reset) {
        if (reset) { list.innerHTML = ''; shown = 0; }
        if (!view.length) { list.innerHTML = '<div class="kp-empty">Nothing matches your search.</div>'; return; }
        var html = '', last = shown ? view[shown - 1].it.group : null;
        view.slice(shown, shown + STEP).forEach(function (v) {
          if (v.it.group && v.it.group !== last) { html += '<div class="kp-grp">' + esc(v.it.group) + '</div>'; }
          last = v.it.group; html += row(v.it, v.i);
        });
        shown += STEP;
        list.insertAdjacentHTML('beforeend', html);
      }
      function filter() {
        var q = search ? search.value.trim().toLowerCase() : '';
        view = items.map(function (it, i) { return { it: it, i: i }; }).filter(function (v) { return !q || (v.it.name + ' ' + v.it.meta).toLowerCase().indexOf(q) !== -1; });
        paint(true);
        if (!q) { var s = list.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'center' }); }
      }
      list.addEventListener('scroll', function () { if (shown < view.length && list.scrollTop + list.clientHeight > list.scrollHeight - 300) paint(false); });
      list.addEventListener('click', function (e) {
        var b = e.target.closest('.kp-item'); if (!b) return;
        var it = items[Number(b.getAttribute('data-i'))]; if (!it) return;
        closePick();
        sel.value = it.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      if (search) { search.addEventListener('input', filter); if (!touch) setTimeout(function () { search.focus(); }, 40); }
      pickEl.querySelector('.kp-x').onclick = closePick;
      pickEl.onclick = function (e) { if (e.target === pickEl) closePick(); };
      document.addEventListener('keydown', pickKey);
      filter();
    });
  }
  function installPickers() {
    ready(function () {
      var st = document.createElement('style'); st.textContent = '.select-tile select{pointer-events:none!important}'; document.head.appendChild(st);
    });
    document.addEventListener('click', function (e) {
      var tile = e.target.closest && e.target.closest('.select-tile');
      if (!tile) return;
      var sel = tile.querySelector('select'); if (!sel) return;
      e.preventDefault();
      if (sel.disabled) { var hint = ((tile.querySelector('.st-value') || {}).textContent || '').trim(); if (hint) banner(hint, 'info', { title: 'One step at a time', ms: 2600 }); return; }
      openPick(sel, tile);
    }, true);
  }
  installPickers();

  window.KLS = { banner: banner, confirm: confirmCard };
  window.kslConfirm = confirmCard;
  window.alert = function (m) { banner(m); };
  // Wrap each page's own showToast (defined later by page scripts) so it uses the banner too.
  function hookToast() {
    var cur = window.showToast;
    if (typeof cur === 'function' && !cur.__kls) {
      var w = function (m, t) { banner(m, t); }; w.__kls = true; window.showToast = w;
    }
  }
  window.addEventListener('DOMContentLoaded', hookToast);
  window.addEventListener('load', hookToast);
  setTimeout(hookToast, 1500);
})();
