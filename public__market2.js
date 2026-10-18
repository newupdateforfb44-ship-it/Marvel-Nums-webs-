// ══════════════════════ MARKETPLACE TWO PAGE ══════════════════════
// Same look as the manual marketplace, but products come from /api/market2 (RakibSocials).
// Loaded after script.js — reuses req(), esc(), P(), showToast(), skeletons(), toggleCatDropdown().

let m2Items = [];
let m2Cat = 'all', m2Q = '', m2SortBy = 'default';

function m2Maintenance(msg) {
  document.querySelector('.mkt-toolbar')?.remove();
  document.getElementById('mktChips')?.remove();
  document.getElementById('mktResultCount')?.remove();
  const grid = document.getElementById('marketGrid');
  if (grid) {
    grid.innerHTML =
      '<div class="no-items" style="grid-column:1/-1;padding:50px 20px"><div style="font-size:40px">🛠️</div>' +
      '<h3 style="margin:10px 0">Under maintenance</h3><p>' + esc(msg || 'Marketplace Two is under maintenance. Please check back shortly.') + '</p></div>';
  }
}

async function initMarket2() {
  const grid = document.getElementById('marketGrid');
  if (!grid) return;
  grid.innerHTML = skeletons(6);
  try {
    m2Items = await req('/api/market2/products', 'GET', null, false);
  } catch (e) {
    if (e.maintenance) return m2Maintenance(e.message);
    grid.innerHTML = `<div class="no-items">${esc(e.message)}<br/><button class="btn-secondary" style="margin-top:10px" onclick="initMarket2()">Retry</button></div>`;
    return;
  }
  const cats = [...new Set(m2Items.map(i => i.category))].sort();
  const menu = document.getElementById('catDropdownMenu');
  if (menu) menu.innerHTML = [['all', 'All Categories'], ...cats.map(c => [c, c])]
    .map(([v, l]) => `<button class="cat-opt${v === m2Cat ? ' active' : ''}" onclick="filterMarket('${esc(v).replace(/'/g, "\\'")}',this)">${esc(l)}</button>`).join('');
  const chips = document.getElementById('mktChips');
  if (chips) chips.innerHTML = [['all', 'All'], ...cats.map(c => [c, c])]
    .map(([v, l]) => `<button type="button" class="mkt-chip${v === m2Cat ? ' active' : ''}" data-chip="${esc(v)}" onclick="pickMktChip('${esc(v).replace(/'/g, "\\'")}')">${esc(l)}</button>`).join('');
  m2Apply();
}

function pickMktChip(cat) {
  m2Cat = cat;
  document.querySelectorAll('.mkt-chip[data-chip]').forEach(b => b.classList.toggle('active', b.dataset.chip === cat));
  const label = document.getElementById('catDropdownLabel');
  if (label) label.textContent = cat === 'all' ? 'All Categories' : cat;
  m2Apply();
}
function filterMarket(cat, btn) {
  document.querySelectorAll('.cat-opt').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (typeof closeCatDropdown === 'function') closeCatDropdown();
  pickMktChip(cat);
}
function onMktSearchInput() { m2Q = document.getElementById('mktSearchInput').value.trim().toLowerCase(); m2Apply(); }
function onMktSortChange() { m2SortBy = document.getElementById('mktSortSelect').value; m2Apply(); }

function m2Card(item) {
  const out = !item.inStock;
  const imgHtml = item.picture
    ? `<div class="prod-img"><img src="${esc(item.picture)}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.outerHTML='<div class=\\'prod-img-ph\\'><svg class=\\'icon i-package\\' aria-hidden=\\'true\\'><use href=\\'#i-package\\'/></svg></div>'"/></div>`
    : `<div class="prod-img-ph"><svg class="icon i-package" aria-hidden="true"><use href="#i-package"/></svg></div>`;

  return `<div class="prod-card-wrap"><div class="prod-card">
    <div class="prod-badge">${esc(item.category)}</div>
    ${imgHtml}
    <div class="prod-body">
      <div class="prod-cat">${esc(item.category)}</div>
      <div class="prod-title">${esc(item.title)}</div>
      <div class="prod-desc" style="white-space:pre-line;max-height:72px;overflow:hidden;text-overflow:ellipsis">${esc(item.description || 'Instant delivery after purchase.')}</div>
      <div class="prod-footer">
        <div class="prod-price">${out ? '<span style="color:var(--red)">Sold Out</span>' : P(item.price)}</div>
        <div class="prod-meta"><div class="prod-qty" style="color:${out ? 'var(--red)' : 'var(--green,#2ecc71)'}">${out ? 'Sold Out' : item.stock + ' available'}</div></div>
      </div>
      <button class="prod-select-btn" ${out ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''} onclick="m2Open(${item.id})">${out ? 'Sold Out' : '<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now'}</button>
    </div></div></div>`;
}

function m2Apply() {
  let items = m2Items.slice();
  if (m2Cat !== 'all') items = items.filter(i => i.category === m2Cat);
  if (m2Q) items = items.filter(i => `${i.title} ${i.description} ${i.category}`.toLowerCase().includes(m2Q));
  if (m2SortBy === 'price-asc') items.sort((a, b) => a.price - b.price);
  else if (m2SortBy === 'price-desc') items.sort((a, b) => b.price - a.price);
  items.sort((a, b) => Number(b.inStock) - Number(a.inStock));
  document.getElementById('marketGrid').innerHTML = items.length ? items.map(m2Card).join('') : '<div class="no-items">No listings match your search</div>';
  const c = document.getElementById('mktResultCount');
  if (c) c.textContent = `${items.length} listing${items.length === 1 ? '' : 's'} available`;
}

// ── Buy modal ──
function m2Open(id) {
  const item = m2Items.find(i => i.id === id);
  if (!item) return;
  const max = Math.min(item.stock, 100);
  document.getElementById('itemModal').classList.add('open');
  const imgHtml = item.picture ? `<img class="m-img" src="${esc(item.picture)}" alt="${esc(item.title)}" onerror="this.style.display='none'"/>` : '';
  document.getElementById('modalBody').innerHTML = `${imgHtml}<div style="padding:22px">
    <div class="prod-cat">${esc(item.category)}</div>
    <h2 style="margin:6px 0 8px">${esc(item.title)}</h2>
    <p style="color:var(--t2);margin:0 0 14px;white-space:pre-line">${esc(item.description || 'Instant delivery after purchase.')}</p>
    <p style="margin:0 0 6px"><b>${P(item.price)}</b> each · ${item.stock} available</p>
    <label style="display:block;font-size:13px;color:var(--t2);margin:12px 0 6px">Quantity</label>
    <input type="number" id="m2Qty" class="input-field" min="1" max="${max}" value="1" oninput="m2Total(${item.price})" style="width:100%"/>
    <p id="m2TotalTxt" style="margin:10px 0 14px">Total: <b>${P(item.price)}</b></p>
    <button class="prod-select-btn" id="m2BuyBtn" onclick="m2Buy(${item.id})"><svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now</button>
    <div id="m2Result"></div>
  </div>`;
}
function m2Total(price) {
  const q = Math.max(1, parseInt(document.getElementById('m2Qty').value, 10) || 1);
  document.getElementById('m2TotalTxt').innerHTML = `Total: <b>${P(price * q)}</b>`;
}
async function m2Buy(id) {
  if (typeof token === 'undefined' || !token) { showToast('Please log in to buy', 'err'); setTimeout(() => { window.location.href = '/login'; }, 800); return; }
  const btn = document.getElementById('m2BuyBtn');
  const quantity = Math.max(1, parseInt(document.getElementById('m2Qty').value, 10) || 1);
  btn.disabled = true; btn.textContent = 'Processing…';
  try {
    const r = await req('/api/market2/buy', 'POST', { productId: id, quantity }, true);
    const keys = (r.keys || []).join('\n');
    document.getElementById('m2Result').innerHTML = `<div class="pc-details-wrap" style="margin-top:16px">
      <p style="color:var(--green,#2ecc71);font-weight:700;margin:0 0 8px">Purchase successful — ${P(r.amountPaid)}</p>
      <pre id="m2Keys" class="pc-details">${esc(keys || 'Delivered')}</pre>
      <button class="copy-details-btn" onclick="navigator.clipboard.writeText(document.getElementById('m2Keys').textContent);showToast('Copied','ok')">Copy Details</button>
      <p style="font-size:12px;color:var(--t2);margin-top:8px">You can view this again anytime in <a href="/purchases">My Purchases</a>.</p></div>`;
    btn.style.display = 'none';
    showToast('Purchase successful', 'ok');
    if (typeof updateNav === 'function') try { updateNav(); } catch (e) {}
    const it = m2Items.find(i => i.id === id); if (it) { it.stock = Math.max(0, it.stock - quantity); it.inStock = it.stock > 0; m2Apply(); }
  } catch (e) {
    if (e.maintenance) { document.getElementById('itemModal').classList.remove('open'); return m2Maintenance(e.message); }
    showToast(e.message, 'err');
    btn.disabled = false; btn.innerHTML = '<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now';
  }
}
