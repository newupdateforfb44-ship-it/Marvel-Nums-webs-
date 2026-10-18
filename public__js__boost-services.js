/* public/js/boost-services.js — "All services" catalogue.
 *
 * Lists the entire boost catalogue on one page, sorted by price per 1000 from
 * the cheapest service to the most expensive. Tapping (or keyboard-selecting)
 * a service sends the customer to /boost?service=<id>, where boost.js selects
 * the category the service belongs to plus the service itself, leaving only the
 * quantity to type.
 */
(function () {
  const T = () => localStorage.getItem('ksl_token') || '';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (window.KLSMoney && typeof window.KLSMoney.amount === 'function')
    ? window.KLSMoney.amount(n)
    : '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let services = [];
  let favorites = new Set();
  let sort = 'cheap';
  let filter = '';

  const catOf = s => (s.category || s.platform || 'Other').trim();
  const rate = s => Number(s.pricePer1000 || 0);

  async function api(url) {
    let r;
    try {
      r = await fetch(url, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T() } });
    } catch (e) { throw new Error('No connection to King Social Hub. Check your internet and try again.'); }
    const raw = await r.text();
    let d = {};
    if (raw) { try { d = JSON.parse(raw); } catch { d = {}; } }
    if (r.status === 401 || r.status === 403) {
      try { localStorage.removeItem('ksl_token'); } catch (e) {}
      window.location.replace('/login?next=/boost-services');
      throw new Error('Session expired');
    }
    if (!r.ok) throw new Error(d.error || 'Could not load the catalogue (' + r.status + ').');
    return d;
  }

  function visible() {
    const q = filter.trim().toLowerCase();
    let list = services.slice();
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      list = list.filter(s => {
        const hay = ((s.name || '') + ' ' + catOf(s) + ' ' + (s.platform || '')).toLowerCase();
        return words.every(w => hay.includes(w));
      });
    }
    list.sort((a, b) => (sort === 'cheap' ? rate(a) - rate(b) : rate(b) - rate(a))
      || String(a.name || '').localeCompare(String(b.name || '')));
    return list;
  }

  function render() {
    const list = visible();
    const box = $('bsvcList');
    const count = $('bsvcCount');
    if (count) {
      count.textContent = list.length
        ? `${list.length.toLocaleString()} service${list.length === 1 ? '' : 's'} — ${sort === 'cheap' ? 'cheapest' : 'most expensive'} first. Tap one to order.`
        : '';
    }
    if (!list.length) {
      box.innerHTML = '<div class="bst-empty">No service matches that filter — try a platform name like “TikTok views”.</div>';
      return;
    }
    box.innerHTML = list.map((s, i) => `
      <a class="bsvc-item" href="/boost?service=${encodeURIComponent(s.id)}" data-id="${esc(s.id)}">
        <span class="bsvc-rank">${i + 1}</span>
        <span class="bsvc-main">
          <span class="bsvc-name">${favorites.has(String(s.id)) ? '★ ' : ''}${esc(s.name)}</span>
          <span class="bsvc-cat">${esc(catOf(s))}</span>
          <span class="bsvc-meta">
            <span>Qty ${Number(s.min || 0).toLocaleString()}–${Number(s.max || 0).toLocaleString()}</span>
            ${s.deliveryTime ? `<span>${esc(s.deliveryTime)}</span>` : ''}
          </span>
        </span>
        <span class="bsvc-side">
          <span class="bsvc-price">${money(rate(s))}</span>
          <span class="bsvc-per">per 1000</span>
          <span class="bsvc-cta">Order <svg class="icon i-arrow-right" aria-hidden="true"><use href="#i-arrow-right"/></svg></span>
        </span>
      </a>`).join('');
  }

  function wire() {
    const tabs = $('bsvcSort');
    if (tabs) {
      tabs.addEventListener('click', e => {
        const btn = e.target.closest('.bst-tab');
        if (!btn) return;
        sort = btn.dataset.sort === 'expensive' ? 'expensive' : 'cheap';
        tabs.querySelectorAll('.bst-tab').forEach(b => b.classList.toggle('active', b === btn));
        render();
      });
    }
    const search = $('bsvcSearch');
    if (search) search.addEventListener('input', e => { filter = e.target.value; render(); });
  }

  async function init() {
    const pg = document.getElementById('page-boost-services');
    if (pg) pg.classList.add('active');
    if (!T()) { window.location.replace('/login?next=/boost-services'); return; }
    let data;
    try { data = await api('/api/boost/services'); }
    catch (e) { $('bsvcList').innerHTML = '<div class="bst-empty">' + esc(e.message) + '</div>'; return; }
    if (!data.enabled) {
      $('bsvcList').innerHTML = '<div class="bst-empty">' + esc(data.message || 'Boosting is under maintenance — please check back shortly.') + '</div>';
      return;
    }
    services = (data.services || []).filter(s => s && s.id);
    favorites = new Set((data.favorites || []).map(String));
    if (!services.length) {
      $('bsvcList').innerHTML = '<div class="bst-empty">The catalogue is still loading from our provider — please refresh in a moment.</div>';
      return;
    }
    wire();
    render();
  }

  document.addEventListener('kls:currency', () => { if (services.length) render(); });
  const boot = () => setTimeout(init, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(() => { document.getElementById('page-boost-services')?.classList.add('active'); }, 1200);
})();
