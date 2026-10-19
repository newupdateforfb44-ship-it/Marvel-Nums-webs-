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

  /* ───────── Marvel Nums bottom-sheet pickers ─────────
   * Every big "select tile" (server / country / service / provider / operator) opens this ONE reusable sheet.
   * The real <select> stays underneath: choosing an item sets its value and fires "change", so each page's
   * existing logic (and its clearing of dependent choices) keeps working untouched.
   * The sheet is LIVE — it watches the <select>, so "Loading…" turns into the real list by itself, and a failed
   * load shows an error with a Try again button (wired through data-retry on the <select>).
   */
  var pcss = '' +
    '.select-tile select{pointer-events:none!important}.select-tile{-webkit-tap-highlight-color:transparent}' +
    '#klsPick{position:fixed;inset:0;z-index:2147483050;display:none;align-items:flex-end;justify-content:center;background:rgba(2,6,24,.66);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}' +
    '#klsPick.show{display:flex;animation:kpFadeIn .22s ease both}#klsPick.closing{animation:kpFadeOut .22s ease both}' +
    '@keyframes kpFadeIn{from{opacity:0}to{opacity:1}}@keyframes kpFadeOut{from{opacity:1}to{opacity:0}}' +
    '.kp-sheet{width:min(560px,100%);max-height:86vh;max-height:86dvh;display:flex;flex-direction:column;color:#f4f6ff;' +
      'background:linear-gradient(180deg,rgba(16,28,60,.98),rgba(7,14,36,.99));border:1px solid rgba(38,177,255,.28);border-bottom:0;' +
      'border-radius:24px 24px 0 0;box-shadow:0 -20px 60px rgba(0,0,0,.55),0 -1px 0 rgba(22,200,255,.25) inset;' +
      'padding-bottom:env(safe-area-inset-bottom,0);animation:kpUp .3s cubic-bezier(.22,.9,.28,1) both;will-change:transform}' +
    '#klsPick.closing .kp-sheet{animation:kpDown .22s cubic-bezier(.4,0,1,1) both}' +
    '@keyframes kpUp{from{transform:translateY(100%)}to{transform:none}}@keyframes kpDown{from{transform:none}to{transform:translateY(100%)}}' +
    '@media (min-width:700px){#klsPick{align-items:center}.kp-sheet{border-radius:24px;border-bottom:1px solid rgba(38,177,255,.28);max-height:78vh}' +
      '@keyframes kpUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}@keyframes kpDown{from{transform:none;opacity:1}to{transform:translateY(40px);opacity:0}}}' +
    '.kp-grab{width:42px;height:5px;border-radius:99px;background:rgba(255,255,255,.22);margin:9px auto 0;flex:0 0 auto;touch-action:none}' +
    '.kp-hd{display:flex;align-items:center;gap:10px;padding:12px 16px 6px;touch-action:none}.kp-hd h3{margin:0;font-size:18px;font-weight:800;flex:1}' +
    '.kp-cnt{font-size:12px;opacity:.6;font-weight:700}' +
    '.kp-x{background:rgba(255,255,255,.09);border:0;color:inherit;width:34px;height:34px;border-radius:50%;font-size:20px;line-height:1;cursor:pointer;flex:0 0 auto}.kp-x:hover{background:rgba(255,255,255,.16)}' +
    '.kp-search{margin:6px 16px 10px;padding:13px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;font-size:16px;outline:none;font-family:inherit;flex:0 0 auto}' +
    '.kp-search:focus{border-color:#16c8ff;box-shadow:0 0 0 3px rgba(22,200,255,.18)}.kp-search:disabled{opacity:.45}' +
    '.kp-list{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0 8px 14px;flex:1;min-height:150px}' +
    '.kp-grp{position:sticky;top:0;z-index:1;padding:8px 10px 4px;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;opacity:.8;color:#7fdcff;background:#0c1836}' +
    '.kp-item{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;text-align:left;padding:12px 12px;margin:2px 0;border:1px solid transparent;background:transparent;color:inherit;border-radius:14px;cursor:pointer;font-size:15px;font-family:inherit;transition:background .15s,border-color .15s,transform .1s}' +
    '.kp-item:hover,.kp-item:focus{background:rgba(255,255,255,.07);outline:none}.kp-item:active{transform:scale(.985);background:rgba(22,200,255,.16)}' +
    '.kp-item.sel{background:linear-gradient(90deg,rgba(22,200,255,.17),rgba(23,105,255,.13));border-color:rgba(22,200,255,.45)}' +
    '.kp-ic{width:30px;height:30px;flex:0 0 auto;display:grid;place-items:center;font-size:20px}.kp-ic img{width:28px;height:28px;object-fit:contain;border-radius:7px}' +
    '.kp-ic img.fl{width:30px;height:21px;object-fit:cover;border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.18)}' +
    '.kp-tx{flex:1;min-width:0}.kp-nm{font-weight:700;overflow:hidden;text-overflow:ellipsis}.kp-mt{font-size:12.5px;opacity:.7;margin-top:2px}' +
    '.kp-ck{color:#22c55e;font-weight:900;font-size:18px;flex:0 0 auto}' +
    '.kp-state{padding:34px 20px;text-align:center}.kp-state .kp-big{font-size:30px;margin-bottom:8px}.kp-state p{margin:0 0 4px;font-size:14.5px;line-height:1.5}.kp-state .kp-sub{font-size:12.5px;opacity:.65}' +
    '.kp-state.err .kp-msg{color:#ff8a80}.kp-btn{margin-top:14px;padding:11px 20px;border-radius:12px;border:1px solid rgba(22,200,255,.5);background:rgba(22,200,255,.12);color:#bdeeff;font:inherit;font-weight:800;font-size:14px;cursor:pointer}' +
    '.kp-btn:active{transform:scale(.97)}' +
    '.kp-spin{width:30px;height:30px;margin:0 auto 12px;border-radius:50%;border:3px solid rgba(255,255,255,.14);border-top-color:#16c8ff;animation:kpSpin .8s linear infinite}@keyframes kpSpin{to{transform:rotate(360deg)}}' +
    '.kp-sk{height:46px;border-radius:14px;margin:6px 4px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.12),rgba(255,255,255,.05));background-size:200% 100%;animation:kpSh 1.2s linear infinite}@keyframes kpSh{to{background-position:-200% 0}}' +
    '@media (prefers-reduced-motion:reduce){.kp-sheet,#klsPick.show,#klsPick.closing{animation-duration:.01s!important}.kp-spin,.kp-sk{animation:none}}';
  var pickEl, pickState = null, pickCloseT = null, pickSeq = 0, prevOverflow = '';
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
  function placeholderOf(sel) {
    var o = Array.prototype.filter.call(sel.options, function (x) { return x.value === ''; })[0];
    return o ? (o.textContent || '').trim() : '';
  }
  // What should the sheet show right now? Decided from the REAL <select>, never from made-up data.
  function classify(sel, items) {
    if (items.length) return { kind: 'list' };
    var t = placeholderOf(sel);
    if (/loading|checking/i.test(t)) return { kind: 'loading', msg: t };
    if (/fail|could not|couldn.t|error|unable|try again/i.test(t)) return { kind: 'error', msg: t };
    return { kind: 'empty', msg: t || 'Nothing to choose from yet.' };
  }
  function iconHtml(it) {
    if (it.icon) return '<img src="' + esc(it.icon) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'📱\'))">';
    if (it.lead.indexOf('flag:') === 0 && it.lead.length > 5) return '<img class="fl" src="' + esc(it.lead.slice(5)) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'🌍\'))">';
    if (it.lead.indexOf('emoji:') === 0) return esc(it.lead.slice(6));
    return '';
  }
  function closePick(now) {
    if (!pickEl || !pickEl.classList.contains('show') || pickEl.classList.contains('closing')) return;
    if (pickState && pickState.obs) pickState.obs.disconnect();
    document.removeEventListener('keydown', pickKey);
    var seq = pickSeq, reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    var finish = function () {
      if (seq !== pickSeq) return;                    // a newer sheet was opened meanwhile — leave it alone
      pickEl.classList.remove('show', 'closing'); pickEl.innerHTML = ''; pickState = null;
      document.documentElement.style.overflow = prevOverflow;
    };
    if (now || reduce) { finish(); return; }
    pickEl.classList.add('closing'); clearTimeout(pickCloseT); pickCloseT = setTimeout(finish, 230);
  }
  function pickKey(e) { if (e.key === 'Escape') closePick(); }
  function openPick(sel, tile) {
    ready(function () {
      mount();
      if (!pickEl) {
        var st = document.createElement('style'); st.textContent = pcss; document.head.appendChild(st);
        pickEl = document.createElement('div'); pickEl.id = 'klsPick'; document.body.appendChild(pickEl);
      }
      clearTimeout(pickCloseT); pickSeq++;
      pickEl.classList.remove('closing');
      if (!pickEl.classList.contains('show')) { prevOverflow = document.documentElement.style.overflow; }
      if (pickState && pickState.obs) pickState.obs.disconnect();
      var items = readOptions(sel);
      var title = ((tile.querySelector('.st-label') || {}).textContent || 'Choose').trim();
      var touch = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
      pickEl.innerHTML = '<div class="kp-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
        '<div class="kp-grab"></div><div class="kp-hd"><h3>' + esc(title) + '</h3><span class="kp-cnt"></span><button class="kp-x" type="button" aria-label="Close">×</button></div>' +
        '<input class="kp-search" type="search" placeholder="Search ' + esc(title.replace(/^select\s+/i, '').toLowerCase()) + '…" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Search">' +
        '<div class="kp-list" role="listbox"></div></div>';
      pickEl.classList.add('show');
      document.documentElement.style.overflow = 'hidden';
      var sheet = pickEl.querySelector('.kp-sheet'), list = pickEl.querySelector('.kp-list'), search = pickEl.querySelector('.kp-search'), cnt = pickEl.querySelector('.kp-cnt');
      var view = [], shown = 0, STEP = 80, retrying = false;
      pickState = { sel: sel };

      function row(it, i) {
        return '<button type="button" role="option" aria-selected="' + (it.selected ? 'true' : 'false') + '" class="kp-item' + (it.selected ? ' sel' : '') + '" data-i="' + i + '"><span class="kp-ic">' + iconHtml(it) +
          '</span><span class="kp-tx"><div class="kp-nm">' + esc(it.name) + '</div>' + (it.meta ? '<div class="kp-mt">' + esc(it.meta) + '</div>' : '') + '</span>' + (it.selected ? '<span class="kp-ck">✓</span>' : '') + '</button>';
      }
      function paint(reset) {
        if (reset) { list.innerHTML = ''; shown = 0; }
        var html = '', last = shown ? view[shown - 1].it.group : null;
        view.slice(shown, shown + STEP).forEach(function (v) {
          if (v.it.group && v.it.group !== last) html += '<div class="kp-grp">' + esc(v.it.group) + '</div>';
          last = v.it.group; html += row(v.it, v.i);
        });
        shown += STEP;
        list.insertAdjacentHTML('beforeend', html);
      }
      function stateBox(kind, big, msg, sub, btn) {
        list.innerHTML = '<div class="kp-state ' + kind + '">' + (kind === 'load' ? '<div class="kp-spin"></div>' : '<div class="kp-big">' + big + '</div>') +
          '<p class="kp-msg">' + esc(msg) + '</p>' + (sub ? '<div class="kp-sub">' + esc(sub) + '</div>' : '') + (btn ? '<button type="button" class="kp-btn" data-act="' + btn[0] + '">' + btn[1] + '</button>' : '') + '</div>';
      }
      function render() {
        var c = classify(sel, items);
        search.disabled = c.kind !== 'list';
        if (c.kind === 'loading' || retrying) {
          cnt.textContent = ''; stateBox('load', '', retrying ? 'Trying again…' : c.msg.replace(/…$/, '') + '…', 'Fetching live data'); 
          list.insertAdjacentHTML('beforeend', '<div class="kp-sk"></div><div class="kp-sk"></div><div class="kp-sk"></div>'); return;
        }
        if (c.kind === 'error') {
          cnt.textContent = '';
          var canRetry = !!(sel.getAttribute('data-retry') && typeof window[sel.getAttribute('data-retry')] === 'function');
          stateBox('err', '⚠️', 'We could not load this list.', c.msg, canRetry ? ['retry', 'Try again'] : null); return;
        }
        if (c.kind === 'empty') { cnt.textContent = ''; stateBox('empty', '📭', c.msg, 'Nothing is available for your earlier choices right now.'); return; }
        var q = search.value.trim().toLowerCase();
        view = items.map(function (it, i) { return { it: it, i: i }; }).filter(function (v) { return !q || (v.it.name + ' ' + v.it.meta).toLowerCase().indexOf(q) !== -1; });
        cnt.textContent = (q ? view.length + ' of ' : '') + items.length + ' available';
        if (!view.length) { stateBox('empty', '🔍', 'No match for “' + q + '”.', 'Try a different spelling.', ['clear', 'Clear search']); return; }
        paint(true);
        if (!q && !pickState.scrolled) { var s = list.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'center' }); pickState.scrolled = true; }
      }
      list.addEventListener('scroll', function () { if (shown < view.length && list.scrollTop + list.clientHeight > list.scrollHeight - 300) paint(false); });
      list.addEventListener('click', function (e) {
        var act = e.target.closest('[data-act]');
        if (act) {
          if (act.getAttribute('data-act') === 'clear') { search.value = ''; render(); search.focus(); return; }
          if (act.getAttribute('data-act') === 'retry') {
            var fn = window[sel.getAttribute('data-retry')], arg = sel.getAttribute('data-retry-arg');
            retrying = true; render();
            try { fn(arg === 'true' ? true : undefined); } catch (_) {}
            setTimeout(function () { retrying = false; render(); }, 12000); // never spin forever
            return;
          }
        }
        var b = e.target.closest('.kp-item'); if (!b) return;
        var it = items[Number(b.getAttribute('data-i'))]; if (!it) return;
        sel.value = it.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        closePick();
      });
      // Live: the page may finish loading, fail, or reset this <select> while the sheet is open.
      var t = null;
      try {
        pickState.obs = new MutationObserver(function () {
          clearTimeout(t);
          t = setTimeout(function () { if (!pickState || pickState.sel !== sel) return; retrying = false; items = readOptions(sel); render(); }, 60);
        });
        pickState.obs.observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
      } catch (_) {}
      search.addEventListener('input', render);
      pickEl.querySelector('.kp-x').onclick = function () { closePick(); };
      pickEl.onclick = function (e) { if (e.target === pickEl) closePick(); };
      // Swipe down on the handle/header to dismiss (touch devices).
      var y0 = null, dy = 0, hd = pickEl.querySelector('.kp-hd'), gr = pickEl.querySelector('.kp-grab');
      [hd, gr].forEach(function (el) {
        el.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; dy = 0; sheet.style.animation = 'none'; sheet.style.transition = 'none'; }, { passive: true });
        el.addEventListener('touchmove', function (e) { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = 'translateY(' + dy + 'px)'; }, { passive: true });
        el.addEventListener('touchend', function () { if (y0 == null) return; y0 = null; sheet.style.transition = 'transform .2s'; if (dy > 90) { sheet.style.transform = ''; sheet.style.animation = ''; closePick(); } else sheet.style.transform = ''; });
      });
      document.addEventListener('keydown', pickKey);
      render();
      if (!touch) setTimeout(function () { if (!search.disabled) search.focus(); }, 60);
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
      if (sel.disabled && !/loading|checking/i.test(placeholderOf(sel))) {
        var hint = ((tile.querySelector('.st-value') || {}).textContent || '').trim(); if (hint) banner(hint, 'info', { title: 'One step at a time', ms: 2600 }); return;
      }
      openPick(sel, tile);
    }, true);
  }
  installPickers();

  /* ───────── Marvel Nums purchase confirmation modal ─────────
   * KLS.purchase({ title, rows:[[label,value],…], price, priceText, getBalance(), fmt(n), notice, fine,
   *                confirm(): Promise<result>, successText(result), onSuccess(result), depositUrl })
   * Shows the REAL selections / price / wallet balance, then runs confirm() (the page's real purchase request).
   * Nothing is submitted until "Confirm Purchase"; double taps are ignored; success is shown only after confirm() resolves.
   */
  var bcss = '' +
    '#mnBuy{position:fixed;inset:0;z-index:2147483200;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(2,6,24,.7);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}' +
    '#mnBuy.show{display:flex;animation:mnbIn .2s ease both}#mnBuy.closing{animation:mnbOut .2s ease both}' +
    '@keyframes mnbIn{from{opacity:0}to{opacity:1}}@keyframes mnbOut{from{opacity:1}to{opacity:0}}' +
    '.mnb-card{width:min(430px,100%);max-height:92vh;overflow:auto;color:#f4f6ff;background:linear-gradient(180deg,rgba(18,32,68,.98),rgba(7,14,36,.99));border:1px solid rgba(38,177,255,.3);border-radius:24px;padding:22px 20px 18px;box-shadow:0 26px 80px rgba(0,0,0,.6);animation:mnbPop .28s cubic-bezier(.2,.9,.3,1.15) both}' +
    '#mnBuy.closing .mnb-card{animation:mnbPopOut .2s ease both}@keyframes mnbPop{from{transform:translateY(24px) scale(.95);opacity:0}to{transform:none;opacity:1}}@keyframes mnbPopOut{to{transform:translateY(16px) scale(.96);opacity:0}}' +
    '@media (max-width:560px){#mnBuy{align-items:flex-end;padding:0}.mnb-card{width:100%;border-radius:24px 24px 0 0;padding-bottom:calc(18px + env(safe-area-inset-bottom,0))}}' +
    '.mnb-hd{display:flex;align-items:center;gap:12px;margin-bottom:14px}.mnb-ic{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#16c8ff,#1769ff);color:#fff;flex:0 0 auto}' +
    '.mnb-hd h3{margin:0;font-size:19px;font-weight:800}.mnb-hd p{margin:2px 0 0;font-size:12.5px;opacity:.65}' +
    '.mnb-notice{margin:0 0 12px;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.45;background:rgba(244,185,66,.12);border:1px solid rgba(244,185,66,.4);color:#ffd98a}' +
    '.mnb-rows{border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;background:rgba(255,255,255,.04)}' +
    '.mnb-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 14px;font-size:14px}.mnb-row+.mnb-row{border-top:1px solid rgba(255,255,255,.07)}' +
    '.mnb-row span{opacity:.7;flex:0 0 auto}.mnb-row b{text-align:right;word-break:break-word;font-weight:700}' +
    '.mnb-row.price b{font-size:18px;color:#7fdcff}.mnb-row.after b{color:#22c55e}.mnb-row.low b{color:#ff8a80}' +
    '.mnb-sk{display:inline-block;width:80px;height:14px;border-radius:7px;background:linear-gradient(90deg,rgba(255,255,255,.08),rgba(255,255,255,.2),rgba(255,255,255,.08));background-size:200% 100%;animation:kpSh 1.1s linear infinite}' +
    '.mnb-msg{display:none;margin-top:12px;padding:10px 12px;border-radius:12px;font-size:13.5px;line-height:1.45}.mnb-msg.err{display:block;background:rgba(255,69,58,.12);border:1px solid rgba(255,69,58,.4);color:#ff9d95}' +
    '.mnb-msg.err a{color:#bdeeff;font-weight:800}' +
    '.mnb-act{display:flex;gap:10px;margin-top:16px}.mnb-act button,.mnb-act a{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 12px;border-radius:14px;font:inherit;font-weight:800;font-size:15px;cursor:pointer;text-decoration:none;box-sizing:border-box;border:1px solid rgba(255,255,255,.16);background:transparent;color:inherit}' +
    '.mnb-act button#mnbCancel{flex:.8}.mnb-act .ok{flex:1.4;white-space:nowrap;border-color:transparent;background:linear-gradient(135deg,#16c8ff,#1769ff);color:#fff;box-shadow:0 8px 24px rgba(23,105,255,.4)}.mnb-act button:active,.mnb-act a:active{transform:scale(.98)}.mnb-act [disabled]{opacity:.55;cursor:not-allowed;box-shadow:none}' +
    '.mnb-fine{margin:12px 2px 0;font-size:12px;line-height:1.5;opacity:.6;text-align:center}' +
    '.mnb-spin{width:16px;height:16px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;animation:kpSpin .8s linear infinite}' +
    '.mnb-done{text-align:center;padding:14px 4px 6px}.mnb-done .mnb-tick{width:64px;height:64px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;background:rgba(34,197,94,.15);color:#22c55e;box-shadow:0 0 0 8px rgba(34,197,94,.08);animation:mnbPop .35s ease both}' +
    '.mnb-done h3{margin:0 0 6px;font-size:20px}.mnb-done p{margin:0;font-size:14px;opacity:.8}.mnb-done .num{font-size:22px;font-weight:800;letter-spacing:.02em;margin:10px 0 4px;opacity:1}' +
    '@media (prefers-reduced-motion:reduce){#mnBuy.show,#mnBuy.closing,.mnb-card,.mnb-spin,.mnb-sk{animation-duration:.01s!important}}';
  var buyEl, buyBusy = false, buyOpen = false;
  function purchaseModal(o) {
    o = o || {};
    return new Promise(function (resolve) {
      ready(function () {
        if (buyOpen) return resolve({ status: 'ignored' });       // never stack two purchase dialogs
        buyOpen = true; mount();
        if (!buyEl) {
          var st = document.createElement('style'); st.textContent = bcss; document.head.appendChild(st);
          buyEl = document.createElement('div'); buyEl.id = 'mnBuy'; document.body.appendChild(buyEl);
        }
        var fmt = o.fmt || function (n) { return String(n); };
        var price = Number(o.price), havePrice = isFinite(price);
        var rowsHtml = (o.rows || []).map(function (r) { return '<div class="mnb-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('');
        var cart = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>';
        buyEl.innerHTML = '<div class="mnb-card" role="dialog" aria-modal="true" aria-labelledby="mnbT"><div id="mnbBody">' +
          '<div class="mnb-hd"><div class="mnb-ic">' + cart + '</div><div><h3 id="mnbT">' + esc(o.title || 'Confirm purchase') + '</h3><p>Review the details before you pay</p></div></div>' +
          (o.notice ? '<div class="mnb-notice">' + esc(o.notice) + '</div>' : '') +
          '<div class="mnb-rows">' + rowsHtml +
            '<div class="mnb-row price"><span>Price</span><b>' + esc(o.priceText || '—') + '</b></div>' +
            '<div class="mnb-row" id="mnbBalRow"><span>Wallet balance</span><b id="mnbBal"><i class="mnb-sk"></i></b></div>' +
            '<div class="mnb-row after" id="mnbAfterRow" style="display:none"><span>Balance after</span><b id="mnbAfter">—</b></div>' +
          '</div><div class="mnb-msg" id="mnbMsg" role="alert"></div>' +
          '<div class="mnb-act"><button type="button" id="mnbCancel">Cancel</button><button type="button" class="ok" id="mnbOk" disabled>Confirm Purchase</button></div>' +
          '<p class="mnb-fine">' + esc(o.fine || 'The price is deducted from your wallet now and refunded automatically if no code arrives in time.') + '</p>' +
          '</div></div>';
        buyEl.classList.remove('closing'); buyEl.classList.add('show');
        var $ = function (id) { return buyEl.querySelector('#' + id); };
        var cancelBtn = $('mnbCancel'), okBtn = $('mnbOk'), msg = $('mnbMsg'), body = $('mnbBody');
        var balance = null, short = false, finished = false;

        function close(result) {
          if (finished) return; finished = true;
          document.removeEventListener('keydown', key);
          buyEl.classList.add('closing');
          setTimeout(function () { buyEl.classList.remove('show', 'closing'); buyEl.innerHTML = ''; buyOpen = false; buyBusy = false; resolve(result); }, 210);
        }
        function key(e) { if (e.key === 'Escape' && !buyBusy) close({ status: 'cancelled' }); }
        function setShort() {
          short = true;
          $('mnbBalRow').classList.add('low');
          msg.className = 'mnb-msg err';
          msg.innerHTML = 'Your wallet balance is too low for this number. <a href="' + esc(o.depositUrl || '/deposit') + '">Fund your wallet</a> and come back — your selections are kept.';
          okBtn.outerHTML = '<a class="ok" id="mnbOk" href="' + esc(o.depositUrl || '/deposit') + '">Fund wallet</a>';
        }
        // Fresh wallet balance every time the dialog opens (the backend still re-checks on purchase).
        Promise.resolve().then(function () { return o.getBalance ? o.getBalance() : null; }).catch(function () { return null; }).then(function (b) {
          if (finished) return;
          balance = (b == null || !isFinite(Number(b))) ? null : Number(b);
          $('mnbBal').textContent = balance == null ? 'Unavailable' : fmt(balance);
          if (balance != null && havePrice) {
            if (balance < price) { setShort(); return; }
            $('mnbAfterRow').style.display = ''; $('mnbAfter').textContent = fmt(balance - price);
          }
          okBtn.disabled = false;
        });

        cancelBtn.onclick = function () { if (!buyBusy) close({ status: 'cancelled' }); };
        buyEl.onclick = function (e) { if (e.target === buyEl && !buyBusy) close({ status: 'cancelled' }); };
        document.addEventListener('keydown', key);
        buyEl.addEventListener('click', function onOk(e) {
          var btn = e.target.closest && e.target.closest('#mnbOk'); if (!btn || btn.tagName === 'A') return;
          if (buyBusy || btn.disabled || short || finished) return;      // duplicate-submit guard
          buyBusy = true; btn.disabled = true; cancelBtn.disabled = true; msg.className = 'mnb-msg';
          btn.innerHTML = '<span class="mnb-spin"></span> Placing your order…';
          Promise.resolve().then(function () { return o.confirm(); }).then(function (result) {
            // Success is announced only now — after the real purchase request resolved.
            var text = o.successText ? o.successText(result) : {};
            body.innerHTML = '<div class="mnb-done"><div class="mnb-tick"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
              '<h3>Purchase successful</h3>' + (text.number ? '<div class="num">' + esc(text.number) + '</div>' : '') + '<p>' + esc(text.line || 'Opening your number…') + '</p></div>';
            setTimeout(function () { close({ status: 'success', result: result }); if (o.onSuccess) o.onSuccess(result); }, 900);
          }).catch(function (err) {
            buyBusy = false; cancelBtn.disabled = false;
            var m = (err && err.message) || 'The purchase could not be completed.';
            msg.className = 'mnb-msg err';
            if (/insufficient balance/i.test(m)) { msg.innerHTML = esc(m) + ' — <a href="' + esc(o.depositUrl || '/deposit') + '">fund your wallet</a>. Nothing was charged.'; btn.innerHTML = 'Confirm Purchase'; btn.disabled = true; }
            else { msg.textContent = m + (/charged|deduct/i.test(m) ? '' : ' Nothing was charged.'); btn.innerHTML = 'Try again'; btn.disabled = false; }
            if (o.onError) try { o.onError(err); } catch (_) {}
          });
        });
      });
    });
  }
  window.KLS = { banner: banner, confirm: confirmCard, purchase: purchaseModal };
  window.mnPurchase = purchaseModal;
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
