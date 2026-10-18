/* MARVINUMS background selection and light-touch brand consistency. */
(function(){
  function pick(){
    var p=(location.pathname||'/').toLowerCase();
    if(p==='/' || p.endsWith('/index.html') || p==='/login' || p==='/register') return 'mz-bg-hero';
    if(/buy-number|number-history|virtual-account|deposit|wallet|transactions|purchases|referral|settings/.test(p)) return 'mz-bg-phone';
    if(/boost|marketplace|tools|game|groups|giveaway|data-bill/.test(p)) return 'mz-bg-speed';
    return 'mz-bg-social';
  }
  function apply(){
    try{
      var b=document.body; if(!b) return;
      b.classList.remove('mz-bg-hero','mz-bg-phone','mz-bg-speed','mz-bg-social');
      b.classList.add(pick());
    }catch(e){}
  }
  try {
    apply();
    // The main app switches pages without reloading, so re-pick the artwork on every navigation.
    ['pushState','replaceState'].forEach(function(fn){
      var orig=history[fn];
      history[fn]=function(){ var r=orig.apply(this,arguments); setTimeout(apply,0); return r; };
    });
    window.addEventListener('popstate',apply);
    // Keep existing application logic intact; update only document branding.
    if(document.title) document.title=document.title.replace(/King Social Hub|KingSocialHub|King Social/gi,'MARVINUMS');
    var desc=document.querySelector('meta[name="application-name"]');
    if(desc) desc.setAttribute('content','MARVINUMS');
  } catch(e) {}
})();

/* ════════════════════════════════════════════════════════════════════════════
   MARVINUMS PAGE FX  (added)
   1. Loading screen + top progress bar on EVERY page change (links, bottom
      menu buttons, anything that opens another page) - not only the first time.
   2. Smooth fade/slide when the new page appears (pairs with the html fade-in
      in /css/marvinums-brand.css).
   3. Home (dashboard) bottom menu now uses the same floating rounded card as
      the Wallet / Marketplace pages.
   Tune the feel with the two numbers just below.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__mzFx) return;
  window.__mzFx = true;

  var DELAY = 380;                         // ms the loading screen shows before the next page opens
  var MESSAGES = ['Loading…', 'Almost there…'];
  try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) DELAY = 120; } catch (e) {}

  /* ── CSS ─────────────────────────────────────────────────────────────── */
  var css = [
    /* loading screen */
    '#mz-fx-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;',
    'background:#040817;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .24s ease,visibility 0s linear .24s}',
    'html[data-theme="light"] #mz-fx-overlay{background:#eef2fb}',
    '#mz-fx-overlay.show{opacity:1;visibility:visible;pointer-events:all;transition:opacity .24s ease,visibility 0s}',
    '.mz-fx-brand{position:relative;width:68px;height:68px;display:flex;align-items:center;justify-content:center;transform:scale(.88);transition:transform .35s cubic-bezier(.2,.9,.3,1.2)}',
    '#mz-fx-overlay.show .mz-fx-brand{transform:scale(1)}',
    '.mz-fx-brand img{width:50px;height:50px;border-radius:15px;object-fit:cover;border:1px solid rgba(28,194,255,.45);box-shadow:0 0 22px rgba(0,157,255,.30)}',
    '.mz-fx-ring{position:absolute;inset:0;border-radius:50%;border:3px solid rgba(7,136,232,.16);border-top-color:#15d2ff;animation:mzFxSpin .9s cubic-bezier(.5,.15,.5,.85) infinite}',
    '.mz-fx-text{font:600 13px/1 "Plus Jakarta Sans",system-ui,sans-serif;letter-spacing:.03em;color:#8ea3c8}',
    'html[data-theme="light"] .mz-fx-text{color:#55566e}',
    '@keyframes mzFxSpin{to{transform:rotate(360deg)}}',

    /* top progress bar */
    '#mz-fx-bar{position:fixed;top:0;left:0;height:3px;width:0;z-index:2147483001;pointer-events:none;opacity:0;',
    'background:linear-gradient(90deg,#087cff,#15d2ff 60%,#ec2677);box-shadow:0 0 10px rgba(21,210,255,.7)}',
    '#mz-fx-bar.run{opacity:1;width:86%;transition:width 3s cubic-bezier(.1,.7,.2,1)}',
    '#mz-fx-bar.arrive{opacity:1;width:86%;transition:none}',
    '#mz-fx-bar.done{opacity:1;width:100%;transition:width .22s ease}',
    '#mz-fx-bar.hide{opacity:0;width:100%;transition:opacity .3s ease}',

    /* smooth swap when the app switches inner pages without reloading */
    '.page.active{animation:mzPageSwap .36s cubic-bezier(.22,.8,.3,1) backwards}',
    '@keyframes mzPageSwap{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',

    /* Home (dashboard) bottom menu = same floating card as the Wallet page */
    'nav.dsh-bottom-nav{position:fixed!important;left:50%!important;right:auto!important;bottom:calc(8px + env(safe-area-inset-bottom,0px))!important;',
    'transform:translateX(-50%)!important;width:92%!important;max-width:456px!important;padding:8px 4px!important;',
    'background:rgba(15,25,44,.94)!important;border:1px solid rgba(48,168,241,.18)!important;border-radius:34px!important;',
    'box-shadow:0 12px 36px rgba(0,0,0,.28)!important;-webkit-backdrop-filter:blur(18px) saturate(1.2);backdrop-filter:blur(18px) saturate(1.2);z-index:250!important}',
    'nav.dsh-bottom-nav .dsh-nav-item{flex:1;min-width:0;gap:3px!important;padding:8px 2px!important;border-radius:10px!important;',
    'color:var(--t3,#55557a)!important;font-size:10.5px!important;font-weight:700;background:none!important;border:none!important;',
    'box-shadow:none!important;transition:color .2s ease,transform .15s ease!important}',
    'nav.dsh-bottom-nav .dsh-nav-item svg{width:22px!important;height:22px!important}',
    'nav.dsh-bottom-nav .dsh-nav-item.active{color:var(--gold,#0788e8)!important}',
    'nav.dsh-bottom-nav .dsh-nav-item.active svg{stroke:var(--gold,#0788e8)!important}',
    'nav.dsh-bottom-nav .dsh-nav-item:active{transform:scale(.93)!important}',
    'nav.dsh-bottom-nav .dsh-nav-dot{top:5px!important;border-color:rgba(15,25,44,.94)!important}',
    '.dsh-shell{padding-bottom:104px!important}',
    '.dsh-toast{bottom:calc(100px + env(safe-area-inset-bottom,0px))!important}',
    '.dsh-support-fab{bottom:calc(94px + env(safe-area-inset-bottom,0px))!important}',
    '@media(prefers-reduced-motion:reduce){.page.active{animation:none}.mz-fx-ring{animation-duration:1.6s}}'
  ].join('');
  var st = document.createElement('style');
  st.id = 'mz-fx-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  /* ── Loading screen + bar ────────────────────────────────────────────── */
  var overlay, bar, label, msgTimer, safetyTimer, navigating = false;

  function build() {
    if (overlay || !document.body) return;
    overlay = document.createElement('div');
    overlay.id = 'mz-fx-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<div class="mz-fx-brand"><img src="/img/marvinums-logo.webp" alt=""><div class="mz-fx-ring"></div></div>' +
                        '<div class="mz-fx-text">' + MESSAGES[0] + '</div>';
    bar = document.createElement('div');
    bar.id = 'mz-fx-bar';
    document.body.appendChild(overlay);
    document.body.appendChild(bar);
    label = overlay.querySelector('.mz-fx-text');
  }

  function start() {
    build();
    if (!overlay) return;
    clearTimeout(safetyTimer);
    overlay.classList.add('show');
    var i = 0;
    label.textContent = MESSAGES[0];
    clearInterval(msgTimer);
    msgTimer = setInterval(function () { i = (i + 1) % MESSAGES.length; label.textContent = MESSAGES[i]; }, 400);
    bar.className = '';
    void bar.offsetWidth;
    bar.className = 'run';
  }

  function stop() {
    navigating = false;
    clearInterval(msgTimer);
    clearTimeout(safetyTimer);
    if (!overlay) return;
    overlay.classList.remove('show');
    bar.className = 'done';
    setTimeout(function () { bar.className = 'hide'; }, 230);
    setTimeout(function () { bar.className = ''; }, 560);
  }

  function go(url) {
    if (navigating) return;
    navigating = true;
    try { sessionStorage.setItem('mzfx', '1'); } catch (e) {}
    start();
    setTimeout(function () { location.href = url; }, DELAY);
    safetyTimer = setTimeout(stop, 8000);          // never leave the screen stuck if something blocks the navigation
  }

  /* ── Which clicks count as "going to another page" ───────────────────── */
  function toUrl(href) {
    try { var u = new URL(href, location.href); return u.origin === location.origin ? u : null; } catch (e) { return null; }
  }
  function eligible(u) {
    if (!u) return false;
    if (u.pathname === location.pathname && u.search === location.search) return false;   // same page / only a #hash
    if (/^\/api\//.test(u.pathname)) return false;
    if (/\.(pdf|zip|apk|png|jpe?g|webp|gif|svg|mp4|mp3|txt|csv|docx?|xlsx?)$/i.test(u.pathname)) return false;
    return true;
  }
  function plainClick(e) {
    return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  }

  /* 1) normal links */
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || !plainClick(e)) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if ((a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-no-fx')) return;
    var raw = a.getAttribute('href') || '';
    if (!raw || raw.charAt(0) === '#' || /^(javascript|mailto|tel|sms|whatsapp|blob|data):/i.test(raw)) return;
    var u = toUrl(a.href);
    if (!eligible(u)) return;
    e.preventDefault();
    go(u.href);
  }, false);

  /* 2) buttons written as onclick="window.location.href='/page'" (bottom menu, cards...) */
  var LOC_ASSIGN = /^\s*(?:return\s+)?(?:window\.|document\.)?location(?:\.href)?\s*=\s*(['"])([^'"$`]+)\1\s*;?\s*$/;
  var LOC_CALL = /^\s*(?:window\.)?location\.(?:assign|replace)\(\s*(['"])([^'"$`]+)\1\s*\)\s*;?\s*$/;
  window.addEventListener('click', function (e) {
    if (!plainClick(e) || !e.target.closest) return;
    var t = e.target.closest('[onclick]');
    if (!t || t.disabled) return;
    var near = e.target.closest('button,a,input,select,textarea,label,[onclick],[role="button"]');
    if (near !== t) return;
    var code = t.getAttribute('onclick') || '';
    var m = code.match(LOC_ASSIGN) || code.match(LOC_CALL);
    if (!m) return;
    var u = toUrl(m[2]);
    if (!eligible(u)) return;
    e.preventDefault();
    e.stopPropagation();                // stops the inline onclick, we open the page ourselves with the effect
    go(u.href);
  }, true);

  /* 3) anything else that leaves the page (scripts, redirects): show the loader if the browser has time to paint it */
  window.addEventListener('beforeunload', function () {
    if (navigating) return;
    if (overlay && overlay.classList.contains('show')) return;
    start();
    safetyTimer = setTimeout(stop, 3500);     // file downloads don't leave the page, so clear it again
  });

  /* Back/forward button restores the old page from memory - make sure no loader is left on top of it */
  window.addEventListener('pageshow', function (e) { if (e.persisted) stop(); });

  /* ── Arrival: finish the bar so every page change feels like one continuous load ─── */
  function arrive() {
    var came = false;
    try { came = sessionStorage.getItem('mzfx') === '1'; sessionStorage.removeItem('mzfx'); } catch (e) {}
    if (!came) return;
    build();
    if (!bar) return;
    bar.className = 'arrive';
    var finish = function () {
      setTimeout(function () {
        bar.className = 'done';
        setTimeout(function () { bar.className = 'hide'; }, 230);
        setTimeout(function () { bar.className = ''; }, 560);
      }, 80);
    };
    if (document.readyState === 'complete') finish(); else window.addEventListener('load', finish, { once: true });
  }
  arrive();

  /* warm the logo so the loading screen never pops in half-drawn */
  try { var pre = new Image(); pre.src = '/img/marvinums-logo.webp'; } catch (e) {}
})();
