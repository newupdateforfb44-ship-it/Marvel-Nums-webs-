/**
 * public/js/money.js — one place that decides how money is shown
 * ─────────────────────────────────────────────────────────────────────────────
 * The King Social Hub ledger is denominated in naira. That is an accounting decision, not a
 * customer-facing one:
 *
 *   • Nigeria      → everything is shown and charged in naira (₦)
 *   • Everywhere   → everything is shown and charged in US dollars ($)
 *
 * That covers the whole catalogue — number purchases (Server 1 and Server 2),
 * logs, tools, balances and totals — so a customer never sees two currencies
 * mixed on one screen.
 *
 * The formatter is SYNCHRONOUS on purpose: it is called from inside template
 * strings all over script.js. The rate is cached in localStorage so the very
 * first paint is already correct, refreshed in the background, and every
 * refresh fires `kls:currency` so open screens can redraw.
 */
(function (global) {
  'use strict';

  var RATE_KEY = 'kls_usd_per_ngn';
  var RATE_AT_KEY = 'kls_usd_per_ngn_at';
  var FALLBACK_USD_PER_NGN = 1 / 1550; // only until the live rate lands

  var state = {
    country: read('kls_country') || '',
    currency: 'NGN',
    usdPerNgn: Number(read(RATE_KEY)) || FALLBACK_USD_PER_NGN,
    live: false
  };

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  function resolveCurrency() {
    state.currency = state.country && state.country.toUpperCase() !== 'NG' ? 'USD' : 'NGN';
    return state.currency;
  }
  resolveCurrency();

  /** Amount (naira, from the ledger) → the number the customer actually sees. */
  function value(ngn) {
    var n = Number(ngn || 0);
    return state.currency === 'USD' ? n * state.usdPerNgn : n;
  }

  function group(n, decimals) {
    return Number(n || 0).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /** Whole-unit price, e.g. "₦12,000" / "$7.74". Use for catalogue prices. */
  function price(ngn) {
    if (state.currency === 'USD') {
      var usd = value(ngn);
      // Sub-dollar items still need to read as a real price, not "$0".
      return '$' + group(usd, usd > 0 && usd < 10 ? 2 : 2);
    }
    return '₦' + group(ngn, 0);
  }

  /** Two-decimal amount, e.g. "₦12,000.00" / "$7.74". Use for balances. */
  function amount(ngn) {
    return (state.currency === 'USD' ? '$' : '₦') + group(value(ngn), 2);
  }

  function symbol() { return state.currency === 'USD' ? '$' : '₦'; }
  function isUsd() { return state.currency === 'USD'; }

  function announce() {
    try { global.document.dispatchEvent(new CustomEvent('kls:currency', { detail: { currency: state.currency, usdPerNgn: state.usdPerNgn } })); }
    catch (e) { /* very old browsers */ }
  }

  /** Point the whole UI at a country. Called by the profile gate and settings. */
  function setCountry(code) {
    state.country = String(code || '').toUpperCase();
    write('kls_country', state.country);
    resolveCurrency();
    announce();
    return state.currency;
  }

  /** Refresh the NGN→USD rate. Cheap, cached, and never blocks a render. */
  function refresh(force) {
    var at = Number(read(RATE_AT_KEY)) || 0;
    if (!force && state.live && Date.now() - at < 30 * 60 * 1000) return Promise.resolve(state.usdPerNgn);
    return fetch('/api/intl/rates', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if ((r.headers.get('content-type') || '').indexOf('json') === -1) throw new Error('rates unavailable');
        return r.json();
      })
      .then(function (d) {
        var rates = d.rates || d;
        // /api/intl/rates is quoted with NGN as the base, so rates.USD is
        // already "US dollars per naira" — exactly what we need.
        var usdPerNgn = rates && Number(rates.USD);
        if (!usdPerNgn || !isFinite(usdPerNgn)) throw new Error('no USD rate');
        state.usdPerNgn = usdPerNgn;
        state.live = true;
        write(RATE_KEY, String(state.usdPerNgn));
        write(RATE_AT_KEY, String(Date.now()));
        announce();
        return state.usdPerNgn;
      })
      .catch(function () { return state.usdPerNgn; });
  }

  /** Keep in step with the profile gate saving a new country. */
  try {
    global.document.addEventListener('kls:profile-updated', function (e) {
      if (e && e.detail && e.detail.country) setCountry(e.detail.country);
    });
  } catch (e) { /* ignore */ }

  global.KLSMoney = {
    state: state, price: price, amount: amount, value: value,
    symbol: symbol, isUsd: isUsd, setCountry: setCountry, refresh: refresh,
    currency: function () { return state.currency; }
  };

  /**
   * First-visit country detection.
   *
   * Until a visitor saves a country on their profile there is nothing in
   * localStorage, and the old behaviour was to assume Nigeria — so customers in
   * the US, UK, Ghana, etc. were shown naira prices. /api/public/geo answers
   * from the CDN country header (or an IP lookup) so the very first paint after
   * detection is already in dollars for everyone outside Nigeria.
   */
  function detectCountry() {
    if (state.country) return Promise.resolve(state.country); // already known
    return fetch('/api/public/geo', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var code = String((d && d.country) || '').toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) return state.country;
        setCountry(code);
        if (state.currency === 'USD') refresh();
        return code;
      })
      .catch(function () { return state.country; });
  }

  global.KLSMoney.detectCountry = detectCountry;

  // Only non-Nigerian customers need the FX rate at all.
  if (state.currency === 'USD') refresh();
  detectCountry();
})(window);
