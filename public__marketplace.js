// ══════════════════════ MARKETPLACE PAGE ══════════════════════
// Standalone page logic (loaded after script.js, which provides req(), renderCard(), loadMarket(),
// loadMarketCategories(), openModal(), etc. — this file only adds search/sort on top of those).


// ── Friendly category URLs ────────────────────────────────────────────────
// /marketplace/whatsapp, /logs/gmail and /marketplace?category=Gmail all work.
function catSlug(name) {
  return String(name || '').toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function wantedCategoryFromUrl() {
  const q = new URLSearchParams(window.location.search).get('category');
  if (q) return q;
  const parts = window.location.pathname.split('/').filter(Boolean);
  // ['marketplace','whatsapp'] or ['logs','gmail']
  return parts.length > 1 ? decodeURIComponent(parts[1]) : '';
}
function syncCategoryUrl(cat) {
  const base = window.location.pathname.split('/').filter(Boolean)[0] || 'marketplace';
  const url = (!cat || cat === 'all') ? `/${base}` : `/${base}/${catSlug(cat)}`;
  try { history.replaceState(null, '', url); } catch (e) {}
}

let mktCategory = 'all';
let mktSearch = '';
let mktSort = 'default';

async function initMarketplacePage() {
  // Check market status before attempting to load or render anything
  try {
    const s = await req('/api/market/status', 'GET', null, false);
    if (s && s.market1Enabled === false) {
      if (typeof showMarket1Maintenance === 'function') {
        showMarket1Maintenance(s.maintenanceMessage);
      }
      return;
    }
  } catch (e) {}

  const wanted = wantedCategoryFromUrl();
  const ok = await loadMarket('all');
  if (!ok) return; // If disabled / maintenance or failed, stop here so maintenance screen is preserved

  if (wanted) {
    const match = [...new Set((allMarketLogs || []).map(i => i.category).filter(Boolean))]
      .find(c => c.toLowerCase() === wanted.toLowerCase() || catSlug(c) === catSlug(wanted));
    if (match) {
      mktCategory = match;
      const label = document.getElementById('catDropdownLabel');
      if (label) label.textContent = match;
    }
  }
  renderMktChips();
  applyMarketFilters();
  const itemId = new URLSearchParams(window.location.search).get('item');
  if (itemId && (allMarketLogs || []).some(item => String(item._id) === itemId)) setTimeout(() => openModal(itemId), 80);
}

// Builds one-tap chips from the categories that actually have listings, so buyers can pick a
// market without opening the dropdown.
function renderMktChips() {
  const box = document.getElementById('mktChips');
  if (!box) return;
  const cats = [...new Set((allMarketLogs || []).map(i => i.category).filter(Boolean))].sort();
  box.innerHTML = [['all', 'All'], ...cats.map(c => [c, c])]
    .map(([val, label]) =>
      `<button type="button" class="mkt-chip${val === mktCategory ? ' active' : ''}" data-chip="${esc(val)}" onclick="pickMktChip('${esc(String(val)).replace(/'/g, "\\'")}')">${esc(label)}</button>`)
    .join('');
}

function pickMktChip(cat) {
  mktCategory = cat;
  syncCategoryUrl(cat);
  document.querySelectorAll('.mkt-chip').forEach(b => b.classList.toggle('active', b.dataset.chip === cat));
  // keep the dropdown label in sync so the two controls never disagree
  const label = document.getElementById('catDropdownLabel');
  if (label) label.textContent = cat === 'all' ? 'All Categories' : cat;
  applyMarketFilters();
}


function onMktSearchInput() {
  mktSearch = document.getElementById('mktSearchInput').value.trim().toLowerCase();
  // Typing is a relevance question — switch the sort to Best Match automatically the first time
  // someone searches, so the closest matches come first instead of whatever "Featured" order was.
  const sel = document.getElementById('mktSortSelect');
  if (sel && mktSearch && mktSort === 'default') { mktSort = 'relevance'; sel.value = 'relevance'; }
  if (sel && !mktSearch && mktSort === 'relevance') { mktSort = 'default'; sel.value = 'default'; }
  applyMarketFilters();
}

function onMktSortChange() {
  mktSort = document.getElementById('mktSortSelect').value;
  applyMarketFilters();
}

// Overrides script.js's version: instead of re-fetching from the server on every category click,
// just re-filter the already-loaded list client-side — instant, and composes cleanly with the
// search box and sort dropdown instead of fighting them.
function filterMarket(cat, btn) {
  document.querySelectorAll('.cat-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('catDropdownLabel').textContent = btn.textContent;
  closeCatDropdown();
  mktCategory = cat;
  syncCategoryUrl(cat);
  document.querySelectorAll('.mkt-chip').forEach(b => b.classList.toggle('active', b.dataset.chip === cat));
  applyMarketFilters();
}

// How well one listing matches the current search text: title beats category beats description,
// and an exact/prefix hit on the title ranks above a hit buried in the middle of it.
function mktRelevance(item) {
  if (!mktSearch) return 0;
  const q = mktSearch;
  const title = String(item.title || '').toLowerCase();
  const cat = String(item.category || '').toLowerCase();
  const desc = String(item.description || '').toLowerCase();
  let score = 0;
  if (title === q) score += 100;
  if (title.startsWith(q)) score += 60;
  if (title.includes(q)) score += 40;
  if (cat === q) score += 30; else if (cat.includes(q)) score += 15;
  if (desc.includes(q)) score += 8;
  // every word of a multi-word query that lands somewhere adds a little more
  q.split(/\s+/).filter(Boolean).forEach(w => {
    if (title.includes(w)) score += 6;
    if (cat.includes(w)) score += 3;
    if (desc.includes(w)) score += 1;
  });
  return score;
}

function applyMarketFilters() {
  let items = (allMarketLogs || []).slice();

  if (mktCategory !== 'all') items = items.filter(i => i.category === mktCategory);
  if (mktSearch) {
    items = items.filter(i => `${i.title} ${i.description} ${i.category}`.toLowerCase().includes(mktSearch));
  }
  if (mktSort === 'relevance') {
    items.sort((a, b) => mktRelevance(b) - mktRelevance(a)
      || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }
  else if (mktSort === 'price-asc') items.sort((a, b) => (a.priceFrom ?? a.price ?? 0) - (b.priceFrom ?? b.price ?? 0));
  else if (mktSort === 'price-desc') items.sort((a, b) => (b.priceFrom ?? b.price ?? 0) - (a.priceFrom ?? a.price ?? 0));
  else if (mktSort === 'newest') items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const grid = document.getElementById('marketGrid');
  const total = (allMarketLogs || []).length;
  try {
    grid.innerHTML = items.length ? items.map(renderCard).join('') : '<div class="no-items">No listings match your search</div>';
  } catch (e) {
    // A bad field on one specific listing shouldn't take the whole grid down with it — this at
    // least shows something explicit instead of leaving whatever was on screen before, or an
    // uncaught error that breaks further clicks on the page.
    grid.innerHTML = '<div class="no-items">Something went wrong showing these listings — please refresh.</div>';
    reportClientError(`applyMarketFilters render failed: ${e.message}`, window.location.href, null, null);
  }
  const countEl = document.getElementById('mktResultCount');
  if (countEl) countEl.textContent = (mktSearch || mktCategory !== 'all')
    ? `Showing ${items.length} of ${total} listings`
    : `${total} listing${total === 1 ? '' : 's'} available`;
}
