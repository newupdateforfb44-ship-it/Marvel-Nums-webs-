/* Marvel Nums - welcome popup (WhatsApp channel promo)
 *
 * Settings come from GET /api/welcome-popup and are edited in Admin -> Welcome Popup.
 * Styled only with the site's own CSS variables (--gold, --card, --border, --t1 ...), so it
 * follows the dark / light / off themes automatically.
 *
 * Frequency memory lives in this browser only (localStorage), so "first visit only" means
 * first visit per browser profile - not per account or per device.
 *   first / 7d / 15d / 30d : remembered from the last dismissal.
 *   every                  : once per browser session (tab), so it does not reappear on every
 *                            page change or reload inside the same visit.
 */
(function () {
  'use strict';
  if (window.KSHWelcomePopup) return;

  var STORE_KEY = 'ksh_welcome_popup_v1';
  var SESSION_KEY = 'ksh_welcome_popup_session';
  var DAY = 24 * 60 * 60 * 1000;
  var WA_RE = /^https:\/\/(www\.)?whatsapp\.com\/channel\/[A-Za-z0-9_-]{6,80}\/?$/;
  var memorySession = false;   // fallback when sessionStorage is blocked
  var current = null;          // the open popup, if any

  // ── tiny safe storage helpers ──────────────────────────────────────────────
  function lsGet() { try { var v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
  function lsSet(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* private mode: ignore */ } }
  function sessionSeen() { try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return memorySession; } }
  function markSession() { memorySession = true; try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) { /* ignore */ } }

  // ── page eligibility ───────────────────────────────────────────────────────
  function pageKey() {
    var p = (location.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
    if (/^\/(login|register|signup|sign-up|forgot|reset|verify|auth|api)/.test(p) || /^\/admin/.test(p) || /admin/.test(p.split('/')[1] || '')) return null;
    if (p === '/' || p === '/index.html' || p === '/home') return 'home';
    if (p === '/dashboard') return 'dashboard';
    if (p.indexOf('/marketplace') === 0) return 'marketplace';
    return 'other';
  }
  function eligible(cfg) {
    var k = pageKey();
    if (!k) return false;
    var pages = Array.isArray(cfg.eligiblePages) ? cfg.eligiblePages : ['all'];
    return pages.indexOf('all') !== -1 || pages.indexOf(k) !== -1;
  }

  // ── frequency rules ────────────────────────────────────────────────────────
  function shouldShow(cfg) {
    var f = cfg.displayFrequency;
    if (f === 'every') return !sessionSeen();
    var rec = lsGet();
    if (!rec || !rec.dismissedAt) return true;
    if (f === 'first') return false;
    var days = { '7d': 7, '15d': 15, '30d': 30 }[f];
    if (!days) return false;
    var elapsed = Date.now() - Number(rec.dismissedAt);
    if (!(elapsed >= 0)) return true;                 // clock was changed; do not lock the visitor out forever
    return elapsed >= days * DAY;
  }
  function recordDismissal() { lsSet({ dismissedAt: Date.now() }); }

  // ── styles (injected once) ─────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('kshwp-style')) return;
    var css = [
      '.kshwp-lock,.kshwp-lock body{overflow:hidden!important}',
      '.kshwp-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;',
      'background:rgba(5,5,12,.66);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .24s ease;overscroll-behavior:contain}',
      '.kshwp-overlay.kshwp-in{opacity:1}',
      '.kshwp-dialog{position:relative;width:100%;max-width:440px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;',
      'border-radius:var(--r24,24px);background:linear-gradient(180deg,var(--card2,#1a1a2b),var(--card,#131320));color:var(--t1,#eeeef5);',
      'border:1px solid var(--border2,#2e2e42);box-shadow:var(--sh,0 8px 32px rgba(0,0,0,.5)),0 0 44px -24px var(--gold,#0788e8);',
      'font-family:var(--kls-font-body,"Plus Jakarta Sans",system-ui,-apple-system,sans-serif);transform:translateY(10px) scale(.96);opacity:0;',
      'transition:transform .28s cubic-bezier(.2,.7,.3,1),opacity .24s ease}',
      '.kshwp-in .kshwp-dialog{transform:none;opacity:1}',
      '.kshwp-dialog:before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;pointer-events:none;opacity:.75;',
      'background:linear-gradient(140deg,var(--gold,#0788e8),transparent 52%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);',
      '-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}',
      '.kshwp-body{overflow-y:auto;overscroll-behavior:contain;padding:34px 24px 24px;text-align:center;-webkit-overflow-scrolling:touch}',
      '.kshwp-close{position:absolute;top:8px;right:8px;z-index:2;width:44px;height:44px;border:0;border-radius:12px;background:transparent;color:var(--t2,#8888a8);',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .18s,color .18s}',
      '.kshwp-close:hover{background:var(--bg4,#1c1c2a);color:var(--t1,#eeeef5)}',
      '.kshwp-close svg{width:20px;height:20px}',
      '.kshwp-icon{width:68px;height:68px;margin:0 auto 18px;border-radius:20px;display:flex;align-items:center;justify-content:center;',
      'background:linear-gradient(135deg,var(--gold,#0788e8),var(--gold2,#0a6fd0));box-shadow:0 10px 26px -6px var(--gold,#0788e8);color:#fff;',
      'animation:kshwp-pop .5s .12s cubic-bezier(.2,.9,.3,1.3) both}',
      '.kshwp-icon svg{width:34px;height:34px}',
      '.kshwp-title{margin:0 0 6px;font-family:var(--kls-font-display,"Sora","Plus Jakarta Sans",system-ui,sans-serif);font-size:24px;line-height:1.25;font-weight:800;color:var(--t1,#eeeef5);letter-spacing:-.2px;word-wrap:break-word}',
      '.kshwp-brand{color:var(--gold,#0788e8)}',
      '.kshwp-sub{margin:0 0 14px;font-size:15px;font-weight:600;color:var(--t1,#eeeef5)}',
      '.kshwp-desc,.kshwp-more{margin:0 0 12px;font-size:14px;line-height:1.6;color:var(--t2,#8888a8);white-space:pre-line;word-wrap:break-word}',
      '.kshwp-more{margin-bottom:20px}',
      '.kshwp-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:50px;padding:13px 18px;border-radius:12px;font:inherit;font-size:15px;',
      'font-weight:800;line-height:1.2;text-decoration:none!important;cursor:pointer;transition:transform .15s,box-shadow .2s,background .2s,color .2s,border-color .2s;-webkit-tap-highlight-color:transparent}',
      '.kshwp-btn svg{width:20px;height:20px;flex:none}',
      '.kshwp-wa{border:0;background:linear-gradient(135deg,var(--gold,#0788e8),var(--gold2,#0a6fd0));color:#04140a;box-shadow:0 6px 18px rgba(7,136,232,.28)}',
      'html[data-theme="light"] .kshwp-wa,html[data-theme="off"] .kshwp-wa{color:#fff}',
      '.kshwp-wa:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(7,136,232,.36)}',
      '.kshwp-wa:active{transform:translateY(0) scale(.99)}',
      '.kshwp-wa[aria-disabled="true"]{opacity:.5;cursor:not-allowed;box-shadow:none;transform:none;pointer-events:none}',
      '.kshwp-later{margin-top:10px;background:transparent;border:1.5px solid var(--border2,#2e2e42);color:var(--t2,#8888a8);font-weight:700}',
      '.kshwp-later:hover{background:var(--bg4,#1c1c2a);color:var(--t1,#eeeef5)}',
      '.kshwp-later:active{transform:scale(.99)}',
      '.kshwp-note{margin:10px 0 0;font-size:12.5px;color:var(--t3,#55557a)}',
      '.kshwp-preview-tag{position:absolute;top:14px;left:16px;z-index:2;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--gold,#0788e8)}',
      '.kshwp-dialog :focus-visible{outline:2px solid var(--gold,#0788e8);outline-offset:2px}',
      '@keyframes kshwp-pop{from{transform:scale(.6) rotate(-8deg);opacity:0}to{transform:none;opacity:1}}',
      '@keyframes kshwp-glow{0%,100%{box-shadow:0 10px 26px -6px var(--gold,#0788e8)}50%{box-shadow:0 10px 38px 2px var(--gold,#0788e8)}}',
      '@keyframes kshwp-shine{0%{background-position:0% 50%}100%{background-position:200% 50%}}',
      '.kshwp-icon{animation:kshwp-pop .5s .12s cubic-bezier(.2,.9,.3,1.3) both,kshwp-glow 2.6s 0.7s ease-in-out infinite!important}',
      '.kshwp-title .kshwp-brand{background:linear-gradient(95deg,#25c9ff,#1769ff,#ff3e87,#25c9ff);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:kshwp-shine 3.4s linear infinite}',
      '@media (max-width:420px){.kshwp-body{padding:30px 18px 20px}.kshwp-title{font-size:21px}}',
      '@media (prefers-reduced-motion:reduce){.kshwp-overlay,.kshwp-dialog,.kshwp-btn,.kshwp-close{transition:none!important}.kshwp-icon,.kshwp-title .kshwp-brand{animation:none!important}}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'kshwp-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  var ICON_BOLT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.2 2.4 4.6 13.3a.8.8 0 0 0 .62 1.3h5.1l-1.1 6.3a.5.5 0 0 0 .9.38l8.6-10.9a.8.8 0 0 0-.62-1.3h-5.1l1.1-6.3a.5.5 0 0 0-.9-.38Z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  var ICON_WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.9L2 22l5.25-1.5A9.9 9.9 0 1 0 12.04 2Zm0 18.1c-1.5 0-2.95-.4-4.2-1.15l-.3-.18-3.1.88.9-3.02-.2-.31a8.1 8.1 0 1 1 6.9 3.78Zm4.44-6.06c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06a6.6 6.6 0 0 1-3.28-2.87c-.25-.43.25-.4.71-1.32.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.1 3.64 1.52.66 2.12.72 2.88.6.46-.07 1.43-.58 1.63-1.15.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z"/></svg>';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // "Marvel Nums" inside the heading is shown in the brand colour; everything is plain text.
  function fillHeading(h, text) {
    var parts = String(text).split(/(marvel nums)/i);
    parts.forEach(function (part) {
      if (!part) return;
      if (/^marvel nums$/i.test(part)) h.appendChild(el('span', 'kshwp-brand', part));
      else h.appendChild(document.createTextNode(part));
    });
  }

  // ── open / close ───────────────────────────────────────────────────────────
  function close(opts) {
    if (!current) return;
    var c = current; current = null;
    document.removeEventListener('keydown', c.onKey, true);
    window.removeEventListener('pagehide', c.onHide);
    c.overlay.classList.remove('kshwp-in');
    var done = function () {
      if (c.overlay.parentNode) c.overlay.parentNode.removeChild(c.overlay);
      document.documentElement.classList.remove('kshwp-lock');
      if (c.prevFocus && typeof c.prevFocus.focus === 'function' && document.contains(c.prevFocus)) { try { c.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      if (c.onClosed) c.onClosed();
    };
    // Release the scroll lock straight away so the page never feels stuck, then remove the node after the fade.
    document.documentElement.classList.remove('kshwp-lock');
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || (opts && opts.instant)) done(); else setTimeout(done, 240);
  }

  function open(cfg, opts) {
    opts = opts || {};
    if (current || document.getElementById('kshwp-overlay')) return false;
    injectStyles();

    var overlay = el('div', 'kshwp-overlay'); overlay.id = 'kshwp-overlay';
    var dialog = el('div', 'kshwp-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'kshwp-title');
    dialog.setAttribute('aria-describedby', 'kshwp-desc');

    var closeBtn = el('button', 'kshwp-close'); closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close'); closeBtn.innerHTML = ICON_X;
    var body = el('div', 'kshwp-body');
    var icon = el('div', 'kshwp-icon'); icon.innerHTML = ICON_BOLT;
    var h = el('h2', 'kshwp-title'); h.id = 'kshwp-title'; fillHeading(h, cfg.heading || 'Welcome');
    body.appendChild(icon); body.appendChild(h);
    if (cfg.subtitle) body.appendChild(el('p', 'kshwp-sub', cfg.subtitle));
    var d = el('p', 'kshwp-desc', cfg.description || ''); d.id = 'kshwp-desc'; if (cfg.description) body.appendChild(d);
    if (cfg.additionalMessage) body.appendChild(el('p', 'kshwp-more', cfg.additionalMessage));

    var url = WA_RE.test(String(cfg.channelUrl || '')) ? String(cfg.channelUrl) : '';
    var wa;
    if (url) {
      wa = el('a', 'kshwp-btn kshwp-wa'); wa.href = url; wa.target = '_blank'; wa.rel = 'noopener noreferrer';
    } else {
      wa = el('a', 'kshwp-btn kshwp-wa'); wa.setAttribute('role', 'link'); wa.setAttribute('aria-disabled', 'true'); wa.tabIndex = -1;
    }
    wa.innerHTML = ICON_WA; wa.appendChild(el('span', '', cfg.whatsappButtonText || 'Join Our WhatsApp Channel'));
    var later = el('button', 'kshwp-btn kshwp-later', cfg.dismissButtonText || 'Maybe Later'); later.type = 'button';
    body.appendChild(wa);
    if (!url) body.appendChild(el('p', 'kshwp-note', 'Our WhatsApp channel link is not set up yet. Please check back soon.'));
    body.appendChild(later);

    if (opts.preview) dialog.appendChild(el('div', 'kshwp-preview-tag', 'Preview'));
    dialog.appendChild(closeBtn); dialog.appendChild(body); overlay.appendChild(dialog);

    var c = { overlay: overlay, prevFocus: document.activeElement, preview: !!opts.preview, onClosed: opts.onClosed };
    function dismiss() { if (!c.preview) recordDismissal(); close(); }
    closeBtn.addEventListener('click', dismiss);
    later.addEventListener('click', dismiss);
    if (url) wa.addEventListener('click', function () { if (!c.preview) recordDismissal(); close(); });   // link opens in a new tab on its own

    // Keyboard: Escape closes, Tab stays inside the dialog.
    c.onKey = function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); dismiss(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(dialog.querySelectorAll('a[href],button:not([disabled])'), function (n) { return n.offsetParent !== null; });
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!dialog.contains(a)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    };
    c.onHide = function () { document.documentElement.classList.remove('kshwp-lock'); };
    document.addEventListener('keydown', c.onKey, true);
    window.addEventListener('pagehide', c.onHide);

    current = c;
    document.body.appendChild(overlay);
    document.documentElement.classList.add('kshwp-lock');
    if (!c.preview && cfg.displayFrequency === 'every') markSession();
    // two frames so the browser registers the starting state and the transition runs
    requestAnimationFrame(function () { requestAnimationFrame(function () { overlay.classList.add('kshwp-in'); (url ? wa : later).focus({ preventScroll: true }); }); });
    return true;
  }

  // ── startup ────────────────────────────────────────────────────────────────
  function fetchConfig() {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : null;
    return fetch('/api/welcome-popup', { credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (t) clearTimeout(t); return r.ok ? r.json() : null; })
      .catch(function () { if (t) clearTimeout(t); return null; });
  }

  function start() {
    try {
      if (window.KSH_NO_WELCOME_AUTOSTART) return;                                  // admin panel sets this: preview only, never auto-open
      if (/admin/.test((location.pathname || '').split('/')[1] || '')) return;
      if (!pageKey()) return;
      fetchConfig().then(function (cfg) {
        if (!cfg || !cfg.enabled || !eligible(cfg) || !shouldShow(cfg)) return;
        var delay = Math.max(0, Math.min(10000, Number(cfg.displayDelay) || 0));
        setTimeout(function () {
          // Re-check at the moment of showing: the visitor may have moved to a login page, or another tab may have shown it.
          if (!eligible(cfg) || !shouldShow(cfg)) return;
          open(cfg, {});
        }, delay);
      });
    } catch (e) { /* the popup must never break the site */ }
  }

  window.KSHWelcomePopup = {
    preview: function (cfg, onClosed) { return open(cfg || {}, { preview: true, onClosed: onClosed }); },
    close: function () { close({ instant: true }); },
    clearBrowserMemory: function () { try { localStorage.removeItem(STORE_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } memorySession = false; }
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
})();
