/* public/js/boost.js — Social boosting order page. */
(function () {
  const T = () => localStorage.getItem('ksl_token') || '';
  /**
   * Fetch wrapper with real error handling.
   *  - network down / DNS / CORS  -> friendly "connection" message
   *  - non-JSON reply (HTML error page, proxy 502) -> readable message, never "undefined"
   *  - 401 / 403                  -> session expired, bounce to /login (keeps ?next)
   *  - anything else              -> server-provided .error text
   * Errors carry .status so callers can react (e.g. hide the buy button on 503).
   */
  const api = async (url, opts = {}) => {
    let r;
    try {
      r = await fetch(url, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T(), ...(opts.headers || {}) },
      });
    } catch (netErr) {
      const e = new Error('No connection to King Social Hub. Check your internet and try again.');
      e.status = 0; throw e;
    }
    const raw = await r.text();
    let d = {};
    if (raw) { try { d = JSON.parse(raw); } catch { d = { error: r.ok ? '' : 'The server returned an unexpected response (' + r.status + ').' }; } }
    if (r.status === 401 || r.status === 403) {
      try { localStorage.removeItem('ksl_token'); } catch (e) {}
      const err = new Error('Your session expired — please log in again.');
      err.status = r.status;
      setTimeout(() => { window.location.href = '/login?next=' + encodeURIComponent(location.pathname); }, 1200);
      throw err;
    }
    if (!r.ok) {
      const err = new Error(d.error || 'Something went wrong (' + r.status + ').');
      err.status = r.status; throw err;
    }
    return d;
  };
  /* Nigeria sees naira; every other country sees US dollars. Ledger stays in NGN. */
  const money = n => (window.KLSMoney && typeof window.KLSMoney.amount === 'function')
    ? window.KLSMoney.amount(n)
    : '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => (window.showToast ? window.showToast(m) : alert(m));
  const $ = id => document.getElementById(id);

  const FAV = '★ Favorite services';
  const ALL = '🔎 All search results';
  /** Category/platform synonyms so "ig", "yt", "fb"… find the right services. */
  const SYNONYMS = {
    ig: 'instagram', insta: 'instagram', gram: 'instagram',
    yt: 'youtube', tt: 'tiktok', tik: 'tiktok', fb: 'facebook',
    wa: 'whatsapp', tg: 'telegram', x: 'twitter', tweet: 'twitter',
    subs: 'subscribers', sub: 'subscribers', fans: 'followers', follow: 'followers',
    watchtime: 'watch time', likes: 'like', views: 'view', comments: 'comment',
    members: 'member', reels: 'reel', shares: 'share', saves: 'save',
  };
  const expand = q => q.split(/\s+/).filter(Boolean)
    .map(w => SYNONYMS[w] || w);
  let services = [];        // full catalogue from /api/boost/services
  let categories = [];      // provider categories, in catalogue order
  let category = '';        // currently selected category
  let picked = null;        // selected service object
  let search = '';          // free-text filter (matches name + category)
  let quoteTimer = null, quoted = null;
  let favorites = new Set(); // service ids the customer starred
  let lastSearchTerm = '';   // used to auto-jump to "All search results"


  /** Show the fallback card. Also force the page container visible so an error is never a blank screen. */
  function showOff(title, message, retry) {
    revealPage();
    const card = $('boostOffCard'); const main = $('boostMain');
    if (main) main.style.display = 'none';
    if (!card) { alert(message); return; }
    card.style.display = '';
    const h = card.querySelector('h3'); if (h && title) h.textContent = title;
    const msg = $('boostOffMsg'); if (msg) msg.textContent = message;
    let btn = card.querySelector('.bst-retry');
    if (retry) {
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'btn-primary bst-retry';
        btn.style.marginTop = '14px';
        btn.textContent = 'Try again';
        card.appendChild(btn);
      }
      btn.style.display = '';
      btn.onclick = () => { btn.disabled = true; btn.textContent = 'Loading…'; init().finally(() => { btn.disabled = false; btn.textContent = 'Try again'; }); };
    } else if (btn) { btn.style.display = 'none'; }
  }

  /** The site router hides every .page div; on this standalone file ours must stay active. */
  function revealPage() {
    const pg = document.getElementById('page-boost');
    if (pg && !pg.classList.contains('active')) pg.classList.add('active');
  }

  let booted = false;
  async function init() {
    if (booted) return; booted = true;
    revealPage();
    if (!T()) { window.location.replace('/login?next=/boost'); return; }
    let data;
    try { data = await api('/api/boost/services'); }
    catch (e) {
      booted = false;
      showOff('Boosting could not load', e.message, e.status !== 401 && e.status !== 403);
      return;
    }
    booted = false;
    if (!data.enabled) { showOff('\uD83D\uDEE0\uFE0F Boosting is under maintenance', data.message || 'We are upgrading the boosting service right now. Please check back shortly.', false); return; }
    services = (data.services || []).filter(s => s && s.id);
    if (!services.length) {
      showOff('Almost ready', data.message || 'The boosting catalogue is still loading from our provider — please refresh in a moment.', true);
      return;
    }

    favorites = new Set((data.favorites || []).map(String));

    // Categories come straight from the provider so the dropdown reads exactly
    // like the panel ("Instagram Followers", "TikTok Live Stream Views", …).
    const seen = new Set();
    categories = [];
    for (const s of services) {
      const c = (s.category || s.platform || 'Other').trim();
      if (!seen.has(c)) { seen.add(c); categories.push(c); }
    }
    categories.sort((a, b) => a.localeCompare(b));
    // Every service keeps its own menu entry; starred ones also appear in the
    // synthetic "Favorite services" category pinned to the top of the list.
    categories.unshift(FAV);

    const count = $('boostCount');
    if (count) count.textContent = `${services.length.toLocaleString()} services across ${new Set(services.map(s => s.platform)).size} platforms`;

    $('boostOffCard').style.display = 'none';
    $('boostMain').style.display = '';
    category = favorites.size ? FAV : (categories[1] || FAV);
    renderCategories();
    renderServices();
    wire();
    applyDeepLink();
    // Expose a tiny API for the step-by-step wizard (boost-wizard.js).
    window.__boostApi = { services: () => services, chooseService, money: v => money(v), favorites: () => favorites };
    document.dispatchEvent(new Event('boost:ready'));
  }

  /**
   * Services matching the search box.
   *
   * Searching a CATEGORY (e.g. "instagram followers", "tiktok", "ig likes")
   * returns every related service across the whole catalogue — each word has to
   * appear somewhere in the service name, its category or its platform, so a
   * category name naturally pulls up all of its services.
   */
  function searched() {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    const words = expand(q);
    const scored = [];
    for (const s of services) {
      const cat = (s.category || '').toLowerCase();
      const name = (s.name || '').toLowerCase();
      const plat = (s.platform || '').toLowerCase();
      const hay = name + ' ' + cat + ' ' + plat;
      if (!words.every(w => hay.includes(w))) continue;
      // Category matches first, then name matches, then everything else.
      let score = 0;
      if (words.every(w => cat.includes(w))) score += 100;
      if (cat.startsWith(words[0])) score += 40;
      if (words.every(w => name.includes(w))) score += 20;
      if (plat.includes(words[0])) score += 10;
      scored.push({ s, score });
    }
    scored.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
    return scored.map(x => x.s);
  }

  const catOf = s => (s.category || s.platform || 'Other').trim();
  const inCategory = (s, c) =>
    c === ALL ? true : (c === FAV ? favorites.has(String(s.id)) : catOf(s) === c);

  function renderCategories() {
    const pool = searched();
    const searching = !!search.trim();
    const counts = new Map();
    for (const s of pool) {
      const c = catOf(s);
      counts.set(c, (counts.get(c) || 0) + 1);
      if (favorites.has(String(s.id))) counts.set(FAV, (counts.get(FAV) || 0) + 1);
    }
    let list = categories.filter(c => counts.has(c));
    if (searching && pool.length) {
      // While searching, an "All search results" entry sits on top so a category
      // search shows every related service in one list.
      counts.set(ALL, pool.length);
      list = [ALL, ...list.filter(c => c !== ALL)];
      if (lastSearchTerm !== search) { category = ALL; lastSearchTerm = search; }
    } else {
      lastSearchTerm = '';
      list = list.filter(c => c !== ALL);
    }
    if (!list.length) {
      $('boostCategory').innerHTML = '<option value="">No category matches that search</option>';
      category = '';
      const hint = $('boostSearchHint');
      if (hint) hint.textContent = 'Nothing matched that search — try a platform name like “Instagram followers”.';
      return;
    }
    if (!counts.has(category)) category = list[0];
    $('boostCategory').innerHTML = list
      .map(c => `<option value="${esc(c)}"${c === category ? ' selected' : ''}>${esc(c)} (${counts.get(c)})</option>`)
      .join('');
    const hint = $('boostSearchHint');
    if (hint) {
      hint.textContent = searching
        ? `${pool.length.toLocaleString()} related service${pool.length === 1 ? '' : 's'} in ${list.filter(c => c !== ALL).length} categor${list.length === 2 ? 'y' : 'ies'} match “${search.trim()}”.`
        : '';
    }
  }

  /* ── Search suggestions ─────────────────────────────────────────────────────
   * Typing shows the related services themselves (name, category, price per
   * 1000 and the quantity range). Clicking one selects its category and the
   * service in one go, so the user never hunts through the category dropdown.
   */
  const SUGGEST_MAX = 12;
  let suggestList = [];
  let suggestIdx = -1;

  /** Announce suggestion state to screen readers without changing the visible layout. */
  function sayStatus(msg) {
    const live = $('boostSuggestStatus');
    if (live) live.textContent = msg;
  }

  function hideSuggest() {
    const box = $('boostSuggest');
    suggestList = []; suggestIdx = -1;
    if (box) { box.hidden = true; box.innerHTML = ''; }
    const input = $('boostSearch');
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    sayStatus('');
  }

  function renderSuggest() {
    const box = $('boostSuggest');
    const input = $('boostSearch');
    if (!box) return;
    const q = search.trim();
    if (!q) { hideSuggest(); return; }
    const pool = searched();
    suggestList = pool.slice(0, SUGGEST_MAX);
    suggestIdx = -1;
    if (!suggestList.length) {
      box.innerHTML = '<div class="bst-sg-empty" role="status">No service matches “' + esc(q) + '”. Try a platform name like “Instagram followers”.</div>';
      box.hidden = false;
      if (input) { input.setAttribute('aria-expanded', 'true'); input.removeAttribute('aria-activedescendant'); }
      sayStatus('No services match ' + q + '.');
      return;
    }
    box.innerHTML = suggestList.map((s, i) => `
      <button type="button" class="bst-sg-item" role="option" id="bst-sg-${i}" aria-selected="false" tabindex="-1"
        aria-posinset="${i + 1}" aria-setsize="${suggestList.length}" data-i="${i}" data-id="${esc(s.id)}"
        aria-label="${esc(s.name)}, ${esc(catOf(s))}, ${esc(money(s.pricePer1000))} per 1000, quantity ${Number(s.min || 0).toLocaleString()} to ${Number(s.max || 0).toLocaleString()}, suggestion ${i + 1} of ${suggestList.length}">
        <div class="bst-sg-name">${favorites.has(String(s.id)) ? '★ ' : ''}${esc(s.name)}</div>
        <div class="bst-sg-meta">
          <span>${money(s.pricePer1000)} per 1000</span>
          <span>Qty ${Number(s.min || 0).toLocaleString()}–${Number(s.max || 0).toLocaleString()}</span>
        </div>
        <div class="bst-sg-cat">${esc(catOf(s))}</div>
      </button>`).join('')
      + (pool.length > suggestList.length
        ? `<div class="bst-sg-more">+ ${(pool.length - suggestList.length).toLocaleString()} more — press Enter to see all results</div>`
        : '');
    box.hidden = false;
    if (input) { input.setAttribute('aria-expanded', 'true'); input.removeAttribute('aria-activedescendant'); }
    sayStatus(suggestList.length + (suggestList.length === 1 ? ' service suggestion available.' : ' service suggestions available. Use the arrow keys to review them.'));
  }

  function highlightSuggest(delta) {
    if (!suggestList.length) return;
    const n = suggestList.length;
    suggestIdx = suggestIdx + delta;
    if (suggestIdx >= n) suggestIdx = 0;
    if (suggestIdx < 0) suggestIdx = n - 1;
    const items = $('boostSuggest').querySelectorAll('.bst-sg-item');
    items.forEach((el, i) => {
      const on = i === suggestIdx;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const input = $('boostSearch');
    if (input) {
      if (suggestIdx >= 0 && items[suggestIdx]) input.setAttribute('aria-activedescendant', items[suggestIdx].id);
      else input.removeAttribute('aria-activedescendant');
    }
    if (suggestIdx >= 0 && items[suggestIdx]) {
      items[suggestIdx].scrollIntoView({ block: 'nearest' });
      const s = suggestList[suggestIdx];
      if (s) sayStatus(s.name + ', suggestion ' + (suggestIdx + 1) + ' of ' + n);
    }
  }

  /** Pick a service straight from the suggestions: sets its category, then selects it. */
  function chooseService(id, opts = {}) {
    const svc = services.find(s => String(s.id) === String(id));
    if (!svc) { if (opts.quiet !== true) toast('That service is no longer available.'); return; }
    hideSuggest();
    category = catOf(svc);
    lastSearchTerm = search;   // stop renderCategories from jumping back to "All search results"
    picked = svc;
    renderCategories();
    $('boostCategory').value = category;
    renderServices();
    const sel = $('boostService');
    if (sel && [...sel.options].some(o => o.value === String(svc.id))) {
      sel.value = String(svc.id);
      picked = svc;
      onServiceChanged();
    }
    // Reflect the pick in the search field so it's obvious what was selected,
    // then send the customer straight to the only thing left to type: quantity.
    const input = $('boostSearch');
    if (input && opts.keepSearch !== true) { input.value = svc.name; search = svc.name; lastSearchTerm = search; }
    const qty = $('boostQty');
    if (qty) {
      if (opts.quantity) { qty.value = opts.quantity; refreshQuote(); }
      try { qty.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      if (opts.focusQty !== false) setTimeout(() => { try { qty.focus({ preventScroll: true }); qty.select && qty.select(); } catch (e) {} }, 120);
    }
  }

  /**
   * Deep link support: /boost?service=<id>&qty=<n> (used by the "All services" page).
   * The category the service belongs to is selected automatically, the service itself
   * is picked, and only the quantity is left for the customer.
   */
  function applyDeepLink() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }
    const id = params.get('service') || params.get('serviceId');
    if (!id) return;
    const qty = parseInt(params.get('qty') || params.get('quantity') || '', 10);
    chooseService(id, { quantity: qty > 0 ? qty : 0, keepSearch: false });
  }

  function renderServices() {
    const pool = searched().filter(s => inCategory(s, category));
    const sel = $('boostService');
    if (!pool.length) {

      sel.innerHTML = '<option value="">No service available</option>';
      picked = null;
      paint();
      return;
    }
    sel.innerHTML = pool
      .map(s => `<option value="${esc(s.id)}">${favorites.has(String(s.id)) ? '★ ' : ''}${esc(s.name)} — ${money(s.pricePer1000)} per 1000</option>`)
      .join('');
    // Keep the current pick when it survives the filter, otherwise take the first.
    const keep = picked && pool.find(s => s.id === picked.id);
    picked = keep || pool[0];
    sel.value = picked.id;
    onServiceChanged();
  }

  /** Human instructions for the selected service — admin text when set, sensible default otherwise. */
  function describe(s) {
    if (s.description) return s.description;
    const what = /follower/i.test(s.name) ? 'profile or page'
      : /(subscriber|member)/i.test(s.name) ? 'channel or group'
      : /(view|like|comment|share|reaction|retweet|save|play)/i.test(s.name) ? 'post or video'
      : 'profile or post';
    return `LINK | Your Link is your ${s.platform} ${what} link.\n\n`
      + `Make sure the account is public before ordering.\n\n`
      + `Don't make multiple orders to the same link. Wait for the first to finish before starting another order.`;
  }

  function paintFavButton() {
    const btn = $('boostFav');
    if (!btn) return;
    if (!picked) { btn.style.display = 'none'; return; }
    const on = favorites.has(String(picked.id));
    btn.style.display = '';
    btn.textContent = on ? '★ Favourited' : '☆ Add to favourites';
    btn.classList.toggle('on', on);
  }

  function onServiceChanged() {
    if (!picked) { paint(); return; }
    $('boostDesc').textContent = describe(picked);
    $('boostQtyHint').textContent = `Min: ${picked.min.toLocaleString()} · Max: ${picked.max.toLocaleString()}`;
    $('boostQty').min = picked.min;
    $('boostQty').max = picked.max;
    const cur = parseInt($('boostQty').value, 10) || 0;
    if (!cur || cur < picked.min || cur > picked.max) $('boostQty').value = picked.min;
    $('boostAvgTime').value = picked.deliveryTime || 'Usually starts within 0–6 hours';
    $('boostLink').placeholder = 'https://';
    paintFavButton();
    refreshQuote();
  }

  /** Reset the read-only summary fields when nothing usable is selected. */
  function paint() {
    if (picked) return;
    $('boostDesc').textContent = 'Choose a service to see its instructions.';
    $('boostQtyHint').textContent = 'Min: — · Max: —';
    $('boostAvgTime').value = '';
    $('boostCharge').value = '';
    $('boostBuy').disabled = true;
    paintFavButton();
    showPreview(null);
  }

  /** Live pricing preview — rate, service fee and the final charge. */
  function showPreview(q, note) {
    const box = $('boostPreview');
    if (!box) return;
    if (!q) {
      box.style.display = note ? '' : 'none';
      if (note) box.innerHTML = `<div class="bp-note">${esc(note)}</div>`;
      return;
    }
    box.style.display = '';
    box.innerHTML = `
      <div class="bp-row"><span>Quantity</span><b>${q.quantity.toLocaleString()}</b></div>
      <div class="bp-row"><span>Rate per 1000</span><b>${money(q.pricePer1000)}</b></div>
      <div class="bp-row"><span>Base price</span><b>${money(q.base)}</b></div>
      <div class="bp-row"><span>Service fee</span><b>${money(q.serviceFee)}</b></div>
      ${q.profit !== undefined ? `<div class="bp-row bp-admin"><span>Provider cost / profit (admin)</span><b>${money(q.cost)} / ${money(q.profit)}</b></div>` : ''}
      <div class="bp-row bp-total"><span>You pay</span><b>${money(q.price)}</b></div>
      <div class="bp-row bp-bal ${q.affordable ? '' : 'bad'}"><span>Wallet balance</span><b>${money(q.balance)}${q.affordable ? '' : ' — top up needed'}</b></div>
    `;
  }

  function refreshQuote() {
    clearTimeout(quoteTimer);
    quoted = null;
    $('boostBuy').disabled = true;
    const qty = parseInt($('boostQty').value, 10) || 0;
    if (!picked || !qty) { $('boostCharge').value = ''; showPreview(null); return; }
    if (qty < picked.min || qty > picked.max) {
      $('boostCharge').value = '';
      $('boostQtyHint').textContent = `Quantity must be between ${picked.min.toLocaleString()} and ${picked.max.toLocaleString()}`;
      showPreview(null, `Enter a quantity between ${picked.min.toLocaleString()} and ${picked.max.toLocaleString()}.`);
      return;
    }
    $('boostQtyHint').textContent = `Min: ${picked.min.toLocaleString()} · Max: ${picked.max.toLocaleString()}`;
    $('boostCharge').value = 'Calculating…';
    showPreview(null, 'Calculating your price…');
    quoteTimer = setTimeout(async () => {
      try {
        const q = await api('/api/boost/quote', { method: 'POST', body: JSON.stringify({ serviceId: picked.id, quantity: qty }) });
        quoted = q;
        $('boostCharge').value = money(q.price);
        $('boostAvgTime').value = q.deliveryTime || picked.deliveryTime || '';
        showPreview(q);
        $('boostBuy').disabled = !q.affordable;
        if (!q.affordable) toast('Your wallet balance is too low for this order.');
      } catch (e) { $('boostCharge').value = ''; showPreview(null, e.message); toast(e.message); }
    }, 350);
  }

  async function toggleFavorite() {
    if (!picked) return;
    const id = String(picked.id);
    const want = !favorites.has(id);
    try {
      const r = await api('/api/boost/favorites', { method: 'POST', body: JSON.stringify({ serviceId: id, favorite: want }) });
      favorites = new Set((r.favorites || []).map(String));
      paintFavButton();
      renderCategories();
      renderServices();
      toast(want ? 'Added to your favourites' : 'Removed from your favourites');
    } catch (e) { toast(e.message); }
  }

  function wire() {
    const searchInput = $('boostSearch');
    document.querySelectorAll('[data-boost-search]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-boost-search]').forEach(item => item.classList.toggle('active', item === button));
        searchInput.value = button.dataset.boostSearch || '';
        search = searchInput.value;
        renderSuggest(); renderCategories(); renderServices();
        searchInput.focus();
      });
    });
    searchInput.oninput = e => {
      search = e.target.value;
      renderSuggest();
      renderCategories();
      renderServices();
    };
    searchInput.onfocus = () => { if (search.trim()) renderSuggest(); };
    searchInput.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlightSuggest(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlightSuggest(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const target = suggestIdx >= 0 ? suggestList[suggestIdx] : suggestList[0];
        if (target) chooseService(target.id);
        else hideSuggest();
      } else if (e.key === 'Escape') { hideSuggest(); }
      else if (e.key === 'Tab' && suggestIdx >= 0 && suggestList[suggestIdx]) { e.preventDefault(); chooseService(suggestList[suggestIdx].id); }
      else if (e.key === 'Home' && suggestList.length) { e.preventDefault(); suggestIdx = -1; highlightSuggest(1); }
      else if (e.key === 'End' && suggestList.length) { e.preventDefault(); suggestIdx = 0; highlightSuggest(-1); }
    };
    // Selection works for mouse, touch and pen: pointerdown fires before the input
    // loses focus (so the list can't close underneath a finger), and the click
    // fallback covers browsers/assistive tech that don't emit pointer events.
    const suggestBox = $('boostSuggest');
    let pickedByPointer = 0;
    const pickFrom = (e, viaPointer) => {
      const item = e.target.closest('.bst-sg-item');
      if (!item) return;
      if (viaPointer) pickedByPointer = Date.now();
      else if (Date.now() - pickedByPointer < 600) return; // already handled by pointerdown
      e.preventDefault();
      chooseService(item.dataset.id);
    };
    suggestBox.addEventListener('pointerdown', e => pickFrom(e, true));
    suggestBox.addEventListener('click', e => pickFrom(e, false));
    // Moving a finger or mouse over an option keeps the ARIA active option in sync.
    suggestBox.addEventListener('pointermove', e => {
      const item = e.target.closest('.bst-sg-item');
      if (!item) return;
      const i = Number(item.dataset.i);
      if (Number.isNaN(i) || i === suggestIdx) return;
      suggestIdx = i - 1;
      highlightSuggest(1);
    });
    suggestBox.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('.bst-sg-item');
      if (!item) return;
      e.preventDefault();
      chooseService(item.dataset.id);
    });
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('.bst-search-wrap')) hideSuggest();
    });
    $('boostCategory').onchange = e => { hideSuggest(); category = e.target.value; picked = null; renderServices(); };
    $('boostService').onchange = e => {
      picked = services.find(s => s.id === e.target.value) || null;
      onServiceChanged();
    };
    $('boostQty').oninput = refreshQuote;
    if ($('boostFav')) $('boostFav').onclick = ev => { ev.preventDefault(); toggleFavorite(); };


    $('boostForm').onsubmit = async ev => {
      ev.preventDefault();
      if (!picked) return toast('Choose a service first.');
      if (!quoted) { refreshQuote(); return toast('Your latest price is still being calculated.'); }
      const link = $('boostLink').value.trim();
      if (!/^https?:\/\/.+\..+/i.test(link)) return toast('Paste the full link starting with https://');
      if (!await kslConfirm(`Boost ${quoted.quantity.toLocaleString()} × ${picked.name} for ${money(quoted.price)}?`)) return;
      const btn = $('boostBuy'); btn.disabled = true; btn.textContent = 'Placing order…';
      try {
        await api('/api/boost/order', { method: 'POST', body: JSON.stringify({ serviceId: picked.id, link, quantity: quoted.quantity }) });
        toast('Boost order placed — track it in your boost history.');
        setTimeout(() => (window.location.href = '/boost-history'), 900);
      } catch (e) {
        toast(e.message); btn.disabled = false; btn.textContent = 'Submit';
      }
    };
  }

  /**
   * Currency sync — Nigeria pays in naira, every other country sees US dollars.
   * The ledger stays in naira, so we only change how the numbers are displayed.
   */
  async function syncCurrency() {
    if (!window.KLSMoney) return;
    let code = '';
    try { code = localStorage.getItem('kls_country') || ''; } catch (e) {}
    if (!code && T()) {
      try {
        const st = await api('/api/user/profile-status');
        code = (st && st.country) || '';
        if (code) { try { localStorage.setItem('kls_country', code); } catch (e) {} }
      } catch (e) { /* keep the cached currency */ }
    }
    if (code) window.KLSMoney.setCountry(code);
    if (window.KLSMoney.isUsd()) await window.KLSMoney.refresh();
    repaintMoney();
  }

  function repaintMoney() {
    try {
      if (services.length) { renderCategories(); renderServices(); }
      if (picked) refreshQuote();
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('kls:currency', repaintMoney);
  document.addEventListener('kls:profile-updated', () => { syncCurrency(); });

  // The site router (script.js) runs on DOMContentLoaded and toggles .page visibility,
  // so boot AFTER it to make sure our page stays active.
  const boot = () => setTimeout(() => { syncCurrency(); init(); }, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // Last-resort guard: if something upstream hid the page, force it back.
  setTimeout(revealPage, 1200);
})();
