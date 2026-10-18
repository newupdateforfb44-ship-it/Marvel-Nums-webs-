// ══════════════════════ TOOLS PAGE ══════════════════════
// Standalone page logic. script.js provides req(), renderCard(), esc(), skeletons(),
// openModal() — this file only adds loading, search, category filtering and sort on top.
// It reads categories from the SAME /api/categories endpoint the marketplace uses and
// filters client-side, so no API contract changes and nothing else breaks.


// ── Friendly category URLs: /tools/vpn works like /tools?category=VPN ─────
function toolCatSlug(name) {
  return String(name || '').toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function toolsWantedCategory() {
  const q = new URLSearchParams(window.location.search).get('category');
  if (q) return q;
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts.length > 1 ? decodeURIComponent(parts[1]) : '';
}
function syncToolsUrl(cat) {
  const url = (!cat || cat === 'all') ? '/tools' : `/tools/${toolCatSlug(cat)}`;
  try { history.replaceState(null, '', url); } catch (e) {}
}

let allTools = [];
let toolsCategory = 'all';
let toolsSearch = '';
let toolsSort = 'default';

async function initToolsPage() {
  const grid = document.getElementById('toolsGrid');
  if (!grid) return;
  grid.innerHTML = typeof skeletons === 'function' ? skeletons(6) : '';
  try {
    allTools = await req('/api/logs?type=tool', 'GET', null, true);
    if (!Array.isArray(allTools)) allTools = [];
    await loadToolsCategories();
    // Deep link support: /tools?category=Software opens pre-filtered.
    const wanted = toolsWantedCategory();
    if (wanted) {
      const match = toolCategoryNames().find(c => c.toLowerCase() === wanted.toLowerCase() || toolCatSlug(c) === toolCatSlug(wanted));
      if (match) { toolsCategory = match; syncToolsCatUI(match); }
    }
    renderToolsChips();
    applyToolsFilters();
    const itemId = new URLSearchParams(window.location.search).get('item');
    if (itemId && allTools.some(item => String(item._id) === itemId)) setTimeout(() => openModal(itemId), 80);
  } catch (e) {
    grid.innerHTML = `<div class="no-items">Failed to load tools — check your connection.<br/><button class="btn-secondary" style="margin-top:10px" onclick="initToolsPage()"><svg class="icon i-refresh" aria-hidden="true"><use href="#i-refresh"/></svg> Retry</button></div>`;
  }
}

// Only lists categories that actually have tools in them, so a buyer never taps a
// category and lands on an empty grid.
function toolCategoryNames() {
  return [...new Set(allTools.map(t => t.category).filter(Boolean))].sort();
}

async function loadToolsCategories() {
  const menu = document.getElementById('toolsCatMenu');
  if (!menu) return;
  let apiOrder = [];
  try {
    const cats = await req('/api/categories', 'GET', null, false);
    if (Array.isArray(cats)) apiOrder = cats.map(c => c.name);
  } catch (e) { /* fall back to the categories present on the tools themselves */ }
  const present = toolCategoryNames();
  const ordered = [...apiOrder.filter(n => present.includes(n)), ...present.filter(n => !apiOrder.includes(n))];
  const icon = name => (typeof catIconHtml === 'function' ? catIconHtml(name) : '');
  menu.innerHTML = `<button class="cat-opt active" data-cat="all" onclick="filterToolsCat('all',this)"><svg class="icon i-folder-open" aria-hidden="true"><use href="#i-folder-open"/></svg> All Categories</button>`
    + ordered.map(n => `<button class="cat-opt" data-cat="${esc(n)}" onclick="filterToolsCat('${esc(n).replace(/'/g, "\\'")}',this)">${icon(n)} ${esc(n)}</button>`).join('');
}

function renderToolsChips() {
  const box = document.getElementById('toolsChips');
  if (!box) return;
  const cats = toolCategoryNames();
  box.innerHTML = [['all', 'All'], ...cats.map(c => [c, c])]
    .map(([val, label]) =>
      `<button type="button" class="mkt-chip${val === toolsCategory ? ' active' : ''}" data-chip="${esc(val)}" onclick="pickToolsChip('${esc(String(val)).replace(/'/g, "\\'")}')">${esc(label)}</button>`)
    .join('');
}

function pickToolsChip(cat) {
  toolsCategory = cat;
  syncToolsUrl(cat);
  syncToolsCatUI(cat === 'all' ? 'All Categories' : cat);
  applyToolsFilters();
}

function filterToolsCat(cat, btn) {
  document.querySelectorAll('#toolsCatMenu .cat-opt').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  toolsCategory = cat;
  syncToolsUrl(cat);
  syncToolsCatUI(btn ? btn.textContent.trim() : cat);
  closeToolsCatDropdown();
  applyToolsFilters();
}

function syncToolsCatUI(label) {
  const lbl = document.getElementById('toolsCatLabel');
  if (lbl) lbl.textContent = label;
  document.querySelectorAll('#toolsChips .mkt-chip').forEach(b => b.classList.toggle('active', b.dataset.chip === toolsCategory));
  document.querySelectorAll('#toolsCatMenu .cat-opt').forEach(b => b.classList.toggle('active', b.dataset.cat === toolsCategory));
}

function toggleToolsCatDropdown() {
  document.getElementById('toolsCatMenu')?.classList.toggle('open');
  document.getElementById('toolsCatBtn')?.classList.toggle('open');
}
function closeToolsCatDropdown() {
  document.getElementById('toolsCatMenu')?.classList.remove('open');
  document.getElementById('toolsCatBtn')?.classList.remove('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#toolsCatMenu') && !e.target.closest('#toolsCatBtn')) closeToolsCatDropdown();
});

function onToolsSearchInput() {
  toolsSearch = (document.getElementById('toolsSearchInput')?.value || '').trim().toLowerCase();
  applyToolsFilters();
}
function onToolsSortChange() {
  toolsSort = document.getElementById('toolsSortSelect')?.value || 'default';
  applyToolsFilters();
}

function applyToolsFilters() {
  let items = allTools.slice();
  if (toolsCategory !== 'all') items = items.filter(t => t.category === toolsCategory);
  if (toolsSearch) items = items.filter(t => `${t.title} ${t.description} ${t.category}`.toLowerCase().includes(toolsSearch));
  if (toolsSort === 'price-asc') items.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  else if (toolsSort === 'price-desc') items.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  else if (toolsSort === 'newest') items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const grid = document.getElementById('toolsGrid');
  if (!grid) return;
  try {
    grid.innerHTML = items.length
      ? items.map(renderCard).join('')
      : '<div class="no-items">No tools match your search</div>';
  } catch (e) {
    grid.innerHTML = '<div class="no-items">Something went wrong showing these tools — please refresh.</div>';
  }
  const out = document.getElementById('toolsResultCount');
  const total = allTools.length;
  if (out) out.textContent = (toolsSearch || toolsCategory !== 'all')
    ? `Showing ${items.length} of ${total} tools`
    : `${total} tool${total === 1 ? '' : 's'} available`;
}
