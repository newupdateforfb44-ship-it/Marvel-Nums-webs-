/**
 * public/js/wallet.js — Wallet view + profile (phone/country) gate
 * ─────────────────────────────────────────────────────────────────────────────
 * Two features live here because they share the same country/currency state:
 *
 *  1. WALLET  — one screen showing the instantly-credited balance plus a clear
 *               split between money that is CONFIRMED and money that is still
 *               PENDING confirmation from Flutterwave / the blockchain.
 *
 *  2. PROFILE GATE — every account must carry a phone number and a country
 *               before it can use the site. Google sign-ups never provide one,
 *               so the modal appears for them too. It is shown once; after the
 *               details are saved it never appears again.
 *
 * The country a user picks decides how they pay:
 *   Nigeria  → virtual account + payment link, priced in ₦
 *   Elsewhere→ payment link only, priced in US dollars
 */
(function (global) {
  'use strict';

  var state = { status: null, countries: null, wallet: null };

  function tok() { try { return localStorage.getItem('ksl_token'); } catch (e) { return null; } }

  function api(path, method, body) {
    var headers = { 'Content-Type': 'application/json' };
    var t = tok();
    if (t) headers.Authorization = 'Bearer ' + t;
    headers.Accept = 'application/json';
    return fetch(path, { method: method || 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        var ct = r.headers.get('content-type') || '';
        // A route that answers with HTML is a server routing problem, not valid
        // data. Saying so beats letting `{}` flow on and explode later with an
        // unreadable "undefined is not an object".
        if (ct.indexOf('json') === -1) {
          return r.text().then(function () {
            throw new Error(r.status === 404
              ? 'This feature is not available on the server yet (' + path + ').'
              : 'The server returned a web page instead of data for ' + path + '. Please reload.');
          });
        }
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || ('Request failed (' + r.status + ')'));
          return d;
        });
      });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n, cur) {
    var v = Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (cur === 'USD' ? '$' : '₦') + v;
  }
  function when(d) {
    try { return new Date(d).toLocaleString(); } catch (e) { return ''; }
  }
  function retranslate(el) {
    try { if (global.KLSi18n && el) global.KLSi18n.translate(el); } catch (e) { /* optional */ }
  }
  function toast(msg, kind) {
    if (typeof global.showToast === 'function') global.showToast(msg, kind || 'ok');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WALLET
  // ══════════════════════════════════════════════════════════════════════════

  function row(item, cur, rate) {
    var display = cur === 'USD' && rate ? money(item.amountNgn * rate, 'USD') : money(item.amountNgn, 'NGN');
    var cls = item.status === 'success' ? 'ok' : item.status === 'pending' ? 'pending' : 'bad';
    var label = item.status === 'success' ? 'Confirmed' : item.status === 'pending' ? 'Pending' : 'Failed';
    return '' +
      '<div class="wal-row">' +
        '<div class="wal-row-main">' +
          '<span class="wal-method">' + esc(item.method) + '</span>' +
          '<span class="wal-ref">' + esc(item.reference || '—') + '</span>' +
        '</div>' +
        '<div class="wal-row-side">' +
          '<span class="wal-amt">' + display + '</span>' +
          '<span class="wal-pill ' + cls + '">' + label + '</span>' +
          '<span class="wal-time">' + esc(when(item.createdAt)) + '</span>' +
        '</div>' +
      '</div>';
  }

  function render(w) {
    var host = document.getElementById('page-wallet');
    if (!host) return;
    // Never assume the payload is complete — a missing block should degrade to
    // a zero, not take the whole wallet screen down.
    w = w || {};
    var bal = w.balance || { ngn: 0, display: null };
    var totals = w.totals || { confirmedNgn: 0, pendingNgn: 0 };
    var cur = w.payCurrency || 'NGN';
    var rate = cur === 'USD' && bal.display && bal.ngn ? bal.display / bal.ngn : null;
    var pendingCount = (w.pending || []).length;

    host.innerHTML = '' +
      '<div class="wal-wrap">' +
        '<div class="wal-hero">' +
          '<span class="wal-hero-label">Available Balance</span>' +
          '<span class="wal-hero-amt">' +
            (cur === 'USD' && bal.display != null ? money(bal.display, 'USD') : money(bal.ngn, 'NGN')) +
          '</span>' +
          (cur === 'USD' && bal.display != null
            ? '<span class="wal-hero-sub">You pay in US dollars — wallet value ' + money(bal.ngn, 'NGN') + '</span>'
            : '<span class="wal-hero-sub">Credited instantly the moment a deposit is confirmed</span>') +
          '<div class="wal-hero-actions">' +
            '<button class="btn-primary" onclick="showPage(\'deposit\')">Deposit</button>' +
            '<button class="btn-secondary" onclick="KLSWallet.load()">Refresh</button>' +
          '</div>' +
        '</div>' +

        '<div class="wal-cards">' +
          '<div class="wal-card confirmed">' +
            '<span class="wal-card-label">Confirmed deposits</span>' +
            '<span class="wal-card-amt">' + money(cur === 'USD' && totals.confirmedDisplay != null ? totals.confirmedDisplay : totals.confirmedNgn, cur) + '</span>' +
            '<span class="wal-card-note">Already in your balance</span>' +
          '</div>' +
          '<div class="wal-card pending">' +
            '<span class="wal-card-label">Pending confirmation</span>' +
            '<span class="wal-card-amt">' + money(cur === 'USD' && totals.pendingDisplay != null ? totals.pendingDisplay : totals.pendingNgn, cur) + '</span>' +
            '<span class="wal-card-note">' + pendingCount + ' awaiting provider confirmation</span>' +
          '</div>' +
        '</div>' +

        (pendingCount
          ? '<div class="wal-section"><h3>Pending</h3>' + w.pending.map(function (i) { return row(i, cur, rate); }).join('') + '</div>'
          : '') +

        '<div class="wal-section"><h3>Confirmed</h3>' +
          ((w.confirmed || []).length
            ? w.confirmed.map(function (i) { return row(i, cur, rate); }).join('')
            : '<p class="wal-empty">No confirmed deposits yet.</p>') +
        '</div>' +

        ((w.failed || []).length
          ? '<div class="wal-section"><h3>Failed / expired</h3>' + w.failed.map(function (i) { return row(i, cur, rate); }).join('') + '</div>'
          : '') +
      '</div>';
    retranslate(host);
  }

  function load() {
    var host = document.getElementById('page-wallet');
    if (!host) return Promise.resolve();
    if (!tok()) { host.innerHTML = '<p class="wal-empty">Please log in to view your wallet.</p>'; return Promise.resolve(); }
    if (!state.wallet) host.innerHTML = '<div class="spin" style="margin:60px auto"></div>';
    return api('/api/user/wallet').then(function (w) {
      state.wallet = w;
      render(w);
    }).catch(function (e) {
      host.innerHTML =
        '<div class="wal-wrap"><div class="wal-section wal-error">' +
          '<h3>Wallet unavailable</h3>' +
          '<p class="wal-empty">' + esc(e.message) + '</p>' +
          '<button class="btn-secondary" onclick="KLSWallet.load()">Try again</button>' +
        '</div></div>';
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROFILE GATE
  // ══════════════════════════════════════════════════════════════════════════

  function countryOptions(selected) {
    return (state.countries || []).map(function (c) {
      return '<option value="' + c.code + '"' + (c.code === selected ? ' selected' : '') + '>' +
        c.flag + '  ' + esc(c.name) + ' (' + c.dialCode + ')</option>';
    }).join('');
  }

  function methodsBlurb(code) {
    if (code === 'NG') return 'Nigeria: virtual account and payment link — priced in naira (₦).';
    if (!code) return '';
    var c = (state.countries || []).filter(function (x) { return x.code === code; })[0];
    return (c ? c.name : 'Your country') + ': payment link only — charged in US dollars ($).';
  }

  function closeGate() {
    var m = document.getElementById('klsProfileGate');
    if (m) m.remove();
    document.body.classList.remove('kls-gate-open');
  }

  function openGate(status) {
    if (document.getElementById('klsProfileGate')) return;
    var preset = status.country || (function () { try { return localStorage.getItem('kls_country') || ''; } catch (e) { return ''; } })();
    var wrap = document.createElement('div');
    wrap.id = 'klsProfileGate';
    wrap.className = 'kls-gate';
    wrap.innerHTML = '' +
      '<div class="kls-gate-box" role="dialog" aria-modal="true" aria-labelledby="klsGateTitle">' +
        '<h2 id="klsGateTitle">Update your phone number</h2>' +
        '<p class="kls-gate-lead">Before you continue, add your phone number and select your country. ' +
          'Your country decides which payment methods and currency you use on King Social Hub.</p>' +
        '<label class="kls-gate-label" for="klsGateCountry">Country</label>' +
        '<select id="klsGateCountry" class="kls-gate-input">' + countryOptions(preset) + '</select>' +
        '<label class="kls-gate-label" for="klsGatePhone">Phone Number</label>' +
        '<div class="kls-gate-phone">' +
          '<span id="klsGateDial">+234</span>' +
          '<input id="klsGatePhone" class="kls-gate-input" type="tel" inputmode="tel" placeholder="8012345678" autocomplete="tel"/>' +
        '</div>' +
        '<p class="kls-gate-methods" id="klsGateMethods"></p>' +
        '<p class="kls-gate-err" id="klsGateErr"></p>' +
        '<button class="btn-primary btn-full" id="klsGateSave">Save and continue</button>' +
      '</div>';
    document.body.appendChild(wrap);
    document.body.classList.add('kls-gate-open');

    var sel = wrap.querySelector('#klsGateCountry');
    var dial = wrap.querySelector('#klsGateDial');
    var methods = wrap.querySelector('#klsGateMethods');
    var err = wrap.querySelector('#klsGateErr');
    var phone = wrap.querySelector('#klsGatePhone');
    var save = wrap.querySelector('#klsGateSave');

    function syncCountry() {
      var c = (state.countries || []).filter(function (x) { return x.code === sel.value; })[0];
      dial.textContent = c ? c.dialCode : '';
      methods.textContent = methodsBlurb(sel.value);
    }
    sel.addEventListener('change', syncCountry);
    syncCountry();
    if (status.phone) phone.value = status.phone;

    save.addEventListener('click', function () {
      err.textContent = '';
      save.disabled = true;
      save.textContent = 'Saving…';
      api('/api/user/profile/phone', 'PUT', { country: sel.value, phone: phone.value })
        .then(function (d) {
          try { localStorage.setItem('kls_country', d.country); } catch (e) { /* ignore */ }
          state.status = { needsProfile: false, phone: d.phone, country: d.country, methods: d.methods, payCurrency: d.payCurrency };
          if (global.currentUser) {
            global.currentUser.contactPhone = d.phone;
            global.currentUser.country = d.country;
            try { localStorage.setItem('ksl_user', JSON.stringify(global.currentUser)); } catch (e) { /* ignore */ }
          }
          closeGate();
          toast('Phone number saved — ' + methodsBlurb(d.country), 'ok');
          document.dispatchEvent(new CustomEvent('kls:profile-updated', { detail: state.status }));
        })
        .catch(function (e) {
          err.textContent = e.message;
          save.disabled = false;
          save.textContent = 'Save and continue';
        });
    });
    retranslate(wrap);
  }

  /** Called on every page load; shows the gate only while details are missing. */
  function checkProfile() {
    if (!tok()) return Promise.resolve(null);
    return api('/api/user/profile-status')
      .then(function (status) {
        state.status = status;
        try { if (status.country) localStorage.setItem('kls_country', status.country); } catch (e) { /* ignore */ }
        if (!status.needsProfile) return status;
        return (state.countries ? Promise.resolve(state.countries) : api('/api/countries').then(function (list) { state.countries = list; return list; }))
          .then(function () { openGate(status); return status; });
      })
      .catch(function () { return null; });
  }

  global.KLSWallet = {
    load: load,
    checkProfile: checkProfile,
    get status() { return state.status; },
    openProfileGate: function () {
      var s = state.status || { needsProfile: true, phone: '', country: '' };
      (state.countries ? Promise.resolve() : api('/api/countries').then(function (l) { state.countries = l; }))
        .then(function () { openGate(s); });
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { checkProfile(); });
  else checkProfile();
})(window);
