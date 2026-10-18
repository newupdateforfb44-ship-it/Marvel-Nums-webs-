/* Step-by-step boost picker: Platform → Type → Service → Link & pay. Touch-friendly for iOS, Android and PC. */
(function () {
  var PLATS = [
    ['Instagram', 'instagram', '#E4405F'], ['TikTok', 'tiktok', '#000000'], ['YouTube', 'youtube', '#FF0000'],
    ['Facebook', 'facebook', '#1877F2'], ['Telegram', 'telegram', '#26A5E4'], ['Twitter', 'x', '#000000'],
    ['WhatsApp', 'whatsapp', '#25D366'], ['Snapchat', 'snapchat', '#FFFC00'], ['Spotify', 'spotify', '#1DB954'],
    ['Threads', 'threads', '#000000'], ['LinkedIn', 'linkedin', '#0A66C2'], ['Twitch', 'twitch', '#9146FF'],
    ['Discord', 'discord', '#5865F2'], ['Pinterest', 'pinterest', '#BD081C'], ['SoundCloud', 'soundcloud', '#FF5500']
  ];
  var TYPES = ['Followers', 'Likes', 'Views', 'Comments', 'Subscribers', 'Members', 'Shares', 'Reactions', 'Live', 'Story', 'Saves', 'Plays', 'Votes', 'Reels'];
  var st = { plat: null, type: null, sort: 'price' };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api() { return window.__boostApi; }
  function platOf(s) { return String(s.platform || '') + ' ' + String(s.category || '') + ' ' + String(s.name || ''); }
  function matchPlat(s, p) {
    var t = platOf(s).toLowerCase(), n = p.toLowerCase();
    if (n === 'twitter') return /twitter|\bx\b|tweet/.test(t);
    if (n === 'other') return !PLATS.some(function (x) { return x[0] !== 'Other' && matchPlat(s, x[0]); });
    return t.indexOf(n) !== -1;
  }
  function typeOf(s) {
    var t = (String(s.category || '') + ' ' + String(s.name || '')).toLowerCase();
    for (var i = 0; i < TYPES.length; i++) if (t.indexOf(TYPES[i].toLowerCase().replace(/s$/, '')) !== -1) return TYPES[i];
    return 'Other';
  }
  function go(n) {
    document.querySelectorAll('.bw-step').forEach(function (el) { el.hidden = el.dataset.step !== String(n); });
    document.querySelectorAll('.bw-progress li').forEach(function (li) {
      var k = Number(li.dataset.step); li.classList.toggle('on', k === n); li.classList.toggle('done', k < n);
    });
    $('bwWizard').classList.toggle('bw-collapsed', n === 4);
    $('boostForm').classList.toggle('bw-show', n === 4);
    $('bwStep4Head').hidden = n !== 4;
    try { (n === 4 ? $('boostForm') : $('bwWizard')).scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }
  function icon(slug, color) {
    return '<span class="bw-ico" style="--c:' + color + '"><img src="https://cdn.simpleicons.org/' + slug + '" alt="" loading="lazy" onerror="this.remove()"/></span>';
  }
  function renderPlatforms() {
    var all = api().services();
    var list = PLATS.concat([['Other', '', '#64748b']]).map(function (p) {
      return { p: p, n: all.filter(function (s) { return matchPlat(s, p[0]); }).length };
    }).filter(function (x) { return x.n > 0; });
    $('bwPlatforms').innerHTML = list.map(function (x) {
      return '<button type="button" class="bw-tile" data-plat="' + esc(x.p[0]) + '">' +
        (x.p[1] ? icon(x.p[1], x.p[2]) : '<span class="bw-ico">✨</span>') +
        '<b>' + esc(x.p[0]) + '</b><small>' + x.n.toLocaleString() + ' services</small></button>';
    }).join('');
  }
  function pool() { var a = api().services(); return a.filter(function (s) { return matchPlat(s, st.plat); }); }
  function renderTypes() {
    var counts = {};
    pool().forEach(function (s) { var t = typeOf(s); counts[t] = (counts[t] || 0) + 1; });
    $('bwPlatName').textContent = '(' + st.plat + ')';
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    $('bwTypes').innerHTML = '<button type="button" class="bw-tile" data-type="*"><b>All services</b><small>' + pool().length + '</small></button>' +
      keys.map(function (k) { return '<button type="button" class="bw-tile" data-type="' + esc(k) + '"><b>' + esc(k) + '</b><small>' + counts[k] + ' services</small></button>'; }).join('');
  }
  function renderServices() {
    var list = pool().filter(function (s) { return st.type === '*' || typeOf(s) === st.type; });
    list.sort(st.sort === 'price' ? function (a, b) { return (a.pricePer1000 || 0) - (b.pricePer1000 || 0); } : function (a, b) { return String(a.name).localeCompare(b.name); });
    $('bwServices').innerHTML = list.length ? list.slice(0, 300).map(function (s) {
      return '<button type="button" class="bw-row" data-id="' + esc(s.id) + '"><span class="bw-row-main"><b>' + esc(s.name) + '</b>' +
        '<small>Min ' + Number(s.min || 0).toLocaleString() + ' · Max ' + Number(s.max || 0).toLocaleString() + '</small></span>' +
        '<span class="bw-price">' + esc(api().money(s.pricePer1000)) + '<small>/1000</small></span></button>';
    }).join('') : '<p class="bw-sub">No services here yet — go back and try another type.</p>';
  }
  function pick(id) {
    var s = api().services().find(function (x) { return String(x.id) === String(id); });
    api().chooseService(id, { focusQty: false });
    $('bwPicked').innerHTML = s ? '<b>' + esc(s.name) + '</b><span>' + esc(api().money(s.pricePer1000)) + ' per 1000</span>' : '';
    go(4);
    setTimeout(function () { try { $('boostLink').focus({ preventScroll: true }); } catch (e) {} }, 300);
  }
  function wire() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-plat],[data-type],[data-id],[data-go],[data-sort]');
      if (!t || !t.closest('#bwWizard,#boostForm')) return;
      if (t.dataset.plat) { st.plat = t.dataset.plat; renderTypes(); go(2); }
      else if (t.dataset.type) { st.type = t.dataset.type; renderServices(); go(3); }
      else if (t.dataset.id) pick(t.dataset.id);
      else if (t.dataset.go) go(Number(t.dataset.go));
      else if (t.dataset.sort) {
        st.sort = t.dataset.sort;
        document.querySelectorAll('[data-sort]').forEach(function (b) { b.classList.toggle('on', b === t); });
        renderServices();
      }
    });
    $('bwQuickSearch').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return; e.preventDefault();
      var box = $('boostSearch'); var m = document.querySelector('.bw-manual');
      if (m) m.open = true; go(4); $('bwStep4Head').hidden = true;
      box.value = this.value; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus();
    });
  }
  function start() {
    if (!api()) return;
    renderPlatforms(); wire();
    var deep = /[?&](service|serviceId)=/.test(location.search);
    go(deep ? 4 : 1);
  }
  if (window.__boostApi) start(); else document.addEventListener('boost:ready', start, { once: true });
})();
