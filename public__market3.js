// ══════════════════════ MARKETPLACE THREE PAGE ══════════════════════
// Same look as the manual marketplace, but products come from /api/market3 (RakibSocials).
// Loaded after script.js — reuses req(), esc(), P(), showToast(), skeletons(), toggleCatDropdown().

let m3Items = [];
let m3Cat = 'all', m3Q = '', m3SortBy = 'default';

function m3Maintenance(msg) {
  document.querySelector('.mkt-toolbar')?.remove();
  document.getElementById('mktChips')?.remove();
  document.getElementById('mktResultCount')?.remove();
  const grid = document.getElementById('marketGrid');
  if (grid) {
    grid.innerHTML =
      '<div class="no-items" style="grid-column:1/-1;padding:50px 20px"><div style="font-size:40px">🛠️</div>' +
      '<h3 style="margin:10px 0">Under maintenance</h3><p>' + esc(msg || 'Marketplace Three is under maintenance. Please check back shortly.') + '</p></div>';
  }
}

async function initMarket3() {
  const grid = document.getElementById('marketGrid');
  if (!grid) return;
  grid.innerHTML = skeletons(6);
  try {
    m3Items = await req('/api/market3/products', 'GET', null, false);
  } catch (e) {
    if (e.maintenance) return m3Maintenance(e.message);
    grid.innerHTML = `<div class="no-items">${esc(e.message)}<br/><button class="btn-secondary" style="margin-top:10px" onclick="initMarket3()">Retry</button></div>`;
    return;
  }
  const cats = [...new Set(m3Items.map(i => i.category))].sort();
  const menu = document.getElementById('catDropdownMenu');
  if (menu) menu.innerHTML = [['all', 'All Categories'], ...cats.map(c => [c, c])]
    .map(([v, l]) => `<button class="cat-opt${v === m3Cat ? ' active' : ''}" onclick="filterMarket('${esc(v).replace(/'/g, "\\'")}',this)">${esc(l)}</button>`).join('');
  const chips = document.getElementById('mktChips');
  if (chips) chips.innerHTML = [['all', 'All'], ...cats.map(c => [c, c])]
    .map(([v, l]) => `<button type="button" class="mkt-chip${v === m3Cat ? ' active' : ''}" data-chip="${esc(v)}" onclick="pickMktChip('${esc(v).replace(/'/g, "\\'")}')">${esc(l)}</button>`).join('');
  m3Apply();
}

function pickMktChip(cat) {
  m3Cat = cat;
  document.querySelectorAll('.mkt-chip[data-chip]').forEach(b => b.classList.toggle('active', b.dataset.chip === cat));
  const label = document.getElementById('catDropdownLabel');
  if (label) label.textContent = cat === 'all' ? 'All Categories' : cat;
  m3Apply();
}
function filterMarket(cat, btn) {
  document.querySelectorAll('.cat-opt').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (typeof closeCatDropdown === 'function') closeCatDropdown();
  pickMktChip(cat);
}
function onMktSearchInput() { m3Q = document.getElementById('mktSearchInput').value.trim().toLowerCase(); m3Apply(); }
function onMktSortChange() { m3SortBy = document.getElementById('mktSortSelect').value; m3Apply(); }

function m3Card(item) {
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
      <button class="prod-select-btn" ${out ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''} onclick="m3Open(${item.id})">${out ? 'Sold Out' : '<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now'}</button>
    </div></div></div>`;
}

function m3Apply() {
  let items = m3Items.slice();
  if (m3Cat !== 'all') items = items.filter(i => i.category === m3Cat);
  if (m3Q) items = items.filter(i => `${i.title} ${i.description} ${i.category}`.toLowerCase().includes(m3Q));
  if (m3SortBy === 'price-asc') items.sort((a, b) => a.price - b.price);
  else if (m3SortBy === 'price-desc') items.sort((a, b) => b.price - a.price);
  items.sort((a, b) => Number(b.inStock) - Number(a.inStock));
  document.getElementById('marketGrid').innerHTML = items.length ? items.map(m3Card).join('') : '<div class="no-items">No listings match your search</div>';
  const c = document.getElementById('mktResultCount');
  if (c) c.textContent = `${items.length} listing${items.length === 1 ? '' : 's'} available`;
}

// ── Buy modal ──
// m3Ref is the idempotency key for one purchase attempt. It is sent with the buy
// request so a double-tap, or a retry after a dropped connection, can never
// charge twice or lose the credentials - the server just returns the same order.
let m3Ref = '';
function m3NewRef() {
  const raw = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('r' + Date.now() + Math.random().toString(36).slice(2));
  return String(raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

function m3Open(id) {
  const item = m3Items.find(i => i.id === id);
  if (!item) return;
  m3Ref = m3NewRef();
  const max = Math.min(item.stock, 100);
  document.getElementById('itemModal').classList.add('open');
  const imgHtml = item.picture ? `<img class="m-img" src="${esc(item.picture)}" alt="${esc(item.title)}" onerror="this.style.display='none'"/>` : '';
  document.getElementById('modalBody').innerHTML = `${imgHtml}<div style="padding:22px">
    <div class="prod-cat">${esc(item.category)}</div>
    <h2 style="margin:6px 0 8px">${esc(item.title)}</h2>
    <p style="color:var(--t2);margin:0 0 14px;white-space:pre-line">${esc(item.description || 'Instant delivery after purchase.')}</p>
    <p style="margin:0 0 6px"><b>${P(item.price)}</b> each · ${item.stock} available</p>
    <label style="display:block;font-size:13px;color:var(--t2);margin:12px 0 6px">Quantity</label>
    <input type="number" id="m3Qty" class="input-field" min="1" max="${max}" value="1" oninput="m3Total(${item.price})" style="width:100%"/>
    <p id="m3TotalTxt" style="margin:10px 0 14px">Total: <b>${P(item.price)}</b></p>
    <button class="prod-select-btn" id="m3BuyBtn" onclick="m3Buy(${item.id})"><svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now</button>
    <div id="m3Result"></div>
  </div>`;
}
function m3Total(price) {
  const q = Math.max(1, parseInt(document.getElementById('m3Qty').value, 10) || 1);
  document.getElementById('m3TotalTxt').innerHTML = `Total: <b>${P(price * q)}</b>`;
}

const M3_NET_ERR = /connection problem|taking too long|offline|invalid server response/i;
const m3Wait = (ms) => new Promise(r => setTimeout(r, ms));

// Credentials block - shown the moment the server confirms delivery.
function m3ShowKeys(r, id, qty) {
  const keys = (r.keys || []).join('\n');
  const partial = r.partial ? `<p style="font-size:13px;color:var(--gold);margin:0 0 8px">Only ${r.quantity} of the ${qty} you ordered were available. The difference was refunded to your balance.</p>` : '';
  const unsaved = r.saved === false ? `<p style="font-size:13px;color:var(--red);margin:0 0 8px"><b>Copy your details now.</b> They are still being added to My Purchases.</p>` : '';
  document.getElementById('m3Result').innerHTML = `<div class="pc-details-wrap" style="margin-top:16px">
      <p style="color:var(--green,#2ecc71);font-weight:700;margin:0 0 8px">Purchase successful — ${P(r.amountPaid)}</p>
      ${partial}${unsaved}
      <pre id="m3Keys" class="pc-details">${esc(keys || 'Delivered')}</pre>
      <button class="copy-details-btn" onclick="navigator.clipboard.writeText(document.getElementById('m3Keys').textContent);showToast('Copied','ok')">Copy Details</button>
      <p style="font-size:12px;color:var(--t2);margin-top:8px">You can view this again anytime in <a href="/purchases">My Purchases</a>.</p></div>`;
  const btn = document.getElementById('m3BuyBtn'); if (btn) btn.style.display = 'none';
  showToast('Purchase successful', 'ok');
  if (typeof updateNav === 'function') try { updateNav(); } catch (e) {}
  const it = m3Items.find(i => i.id === id); if (it) { it.stock = Math.max(0, it.stock - (r.quantity || qty)); it.inStock = it.stock > 0; m3Apply(); }
}

// Payment received but delivery is still being confirmed - the customer is told exactly what to do.
function m3ShowPending(r, id, qty) {
  const ref = r.ref || m3Ref;
  document.getElementById('m3Result').innerHTML = `<div class="pc-details-wrap" style="margin-top:16px">
      <p style="color:var(--gold);font-weight:700;margin:0 0 8px">Order received - finalising delivery</p>
      <p style="font-size:13px;color:var(--t2);margin:0 0 10px">${esc(r.message || 'Your credentials will appear in My Purchases shortly. Please do not buy again.')}</p>
      <button class="copy-details-btn" id="m3CheckBtn" onclick="m3CheckOrder('${esc(ref)}',${id},${qty})">Check status</button>
      <p style="font-size:12px;color:var(--t2);margin-top:8px">Or open <a href="/purchases">My Purchases</a>.</p></div>`;
  const btn = document.getElementById('m3BuyBtn'); if (btn) btn.style.display = 'none';
}

async function m3FetchOrder(ref) {
  const list = await req('/api/market3/orders?ref=' + encodeURIComponent(ref), 'GET', null, true);
  return Array.isArray(list) ? list[0] : null;
}

async function m3CheckOrder(ref, id, qty) {
  const b = document.getElementById('m3CheckBtn'); if (b) { b.disabled = true; b.textContent = 'Checking…'; }
  try {
    const o = await m3FetchOrder(ref);
    if (o && (o.status === 'delivered' || o.status === 'partial') && o.keys.length) {
      return m3ShowKeys({ keys: o.keys, amountPaid: o.amountPaid, quantity: o.keys.length, partial: o.status === 'partial' }, id, qty);
    }
    if (o && (o.status === 'failed' || o.status === 'refunded')) {
      document.getElementById('m3Result').innerHTML = '<p style="color:var(--red);margin-top:16px">This order did not go through. Your payment was returned to your balance.</p>';
      if (typeof updateNav === 'function') try { updateNav(); } catch (e) {}
      return;
    }
    showToast('Still processing - please check again in a minute', 'err');
  } catch (e) { showToast(e.message, 'err'); }
  if (b) { b.disabled = false; b.textContent = 'Check status'; }
}

async function m3Buy(id) {
  if (typeof token === 'undefined' || !token) { showToast('Please log in to buy', 'err'); setTimeout(() => { window.location.href = '/login'; }, 800); return; }
  const btn = document.getElementById('m3BuyBtn');
  const quantity = Math.max(1, parseInt(document.getElementById('m3Qty').value, 10) || 1);
  const ref = m3Ref || (m3Ref = m3NewRef());
  btn.disabled = true; btn.textContent = 'Processing…';
  try {
    const r = await req('/api/market3/buy', 'POST', { productId: id, quantity, clientRef: ref }, true);
    m3Ref = m3NewRef();
    if (r.pending) return m3ShowPending(r, id, quantity);
    m3ShowKeys(r, id, quantity);
  } catch (e) {
    if (e.maintenance) { document.getElementById('itemModal').classList.remove('open'); return m3Maintenance(e.message); }

    if (M3_NET_ERR.test(e.message || '')) {
      // The request may have reached the server even though we never saw the answer.
      // Look the order up by its ref instead of letting the customer guess.
      btn.textContent = 'Confirming your order…';
      for (let i = 0; i < 6; i++) {
        await m3Wait(2000);
        try {
          const o = await m3FetchOrder(ref);
          if (!o) { if (i >= 2) break; continue; }   // never created: nothing was charged
          if ((o.status === 'delivered' || o.status === 'partial') && o.keys.length) {
            m3Ref = m3NewRef();
            return m3ShowKeys({ keys: o.keys, amountPaid: o.amountPaid, quantity: o.keys.length, partial: o.status === 'partial' }, id, quantity);
          }
          if (o.status === 'failed' || o.status === 'refunded') { m3Ref = m3NewRef(); showToast('This order did not go through - nothing was charged', 'err'); break; }
          if (i === 5) return m3ShowPending({ ref, message: 'Your payment was received and your order is still being processed. Please do not buy again - your credentials will appear in My Purchases shortly.' }, id, quantity);
        } catch (e2) { /* keep trying */ }
      }
      showToast('Connection problem - check My Purchases before trying again', 'err');
    } else {
      m3Ref = m3NewRef();            // a definite answer from the server: next attempt is a fresh order
      showToast(e.message, 'err');
    }
    btn.disabled = false; btn.innerHTML = '<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now';
  }
}
