/**
 * public/js/global-pay.js — international deposit layer
 * ─────────────────────────────────────────────────────────────────────────────
 * • Detects the visitor's country and local currency
 * • Shows deposit methods that actually work in that country
 * • Quotes every amount in the local currency (NGN is the ledger currency)
 *
 * Depends on: /api/intl/*
 */
(function (global) {
  'use strict';

  var state = {
    country: null,
    currency: 'NGN',
    methods: [],
    rates: null,
    intent: null,
    poller: null
  };

  function token() { try { return localStorage.getItem('ksl_token'); } catch (e) { return null; } }

  function api(path, method, body) {
    var headers = { 'Content-Type': 'application/json' };
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    headers.Accept = 'application/json';
    return fetch(path, { method: method || 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        // Guard against an HTML error page arriving where JSON was expected —
        // parsing that produces "Unexpected token <", which tells a customer
        // nothing. Fail with something a human can act on instead.
        if ((r.headers.get('content-type') || '').indexOf('json') === -1) {
          throw new Error(r.status === 404
            ? 'Payments are not fully set up on the server yet (' + path + ').'
            : 'The payment service is unreachable right now. Please try again in a moment.');
        }
        return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Request failed'); return d; });
      });
  }

  function savedCountry() { try { return localStorage.getItem('kls_country'); } catch (e) { return null; } }
  function saveCountry(c) { try { localStorage.setItem('kls_country', c); } catch (e) { /* ignore */ } }

  /** Resolve the visitor's market once per page load. */
  function init() {
    var c = savedCountry();
    var p = c ? Promise.resolve({ country: c }) : api('/api/intl/detect');
    return p.then(function (d) {
      state.country = d.country || 'NG';
      saveCountry(state.country);
      return api('/api/intl/methods?country=' + encodeURIComponent(state.country));
    }).then(function (m) {
      state.currency = m.currency;
      state.methods = m.methods;
      state.minimum = m.minimumDeposit;
      document.dispatchEvent(new CustomEvent('kls:market', { detail: state }));
      return state;
    }).catch(function () {
      state.country = 'NG'; state.currency = 'NGN'; state.methods = ['banktransfer', 'paymentlink'];
      return state;
    });
  }

  function setCountry(code) {
    saveCountry(code);
    return init();
  }

  /** Format an NGN figure in the visitor's local currency (display only). */
  function localise(ngnAmount) {
    if (!state.rates) return null;
    var rate = state.rates[state.currency];
    if (!rate) return null;
    var value = ngnAmount * rate;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency, maximumFractionDigits: value < 100 ? 2 : 0 }).format(value);
    } catch (e) { return value.toFixed(2) + ' ' + state.currency; }
  }

  function loadRates() {
    return api('/api/intl/rates').then(function (d) { state.rates = d.rates; return d.rates; });
  }

  /** Server-side quote — always used before charging anyone. */
  function quote(ngnAmount, currency) {
    return api('/api/intl/quote', 'POST', { ngnAmount: ngnAmount, currency: currency || state.currency });
  }

  global.KLSPay = {
    state: state,
    init: init,
    setCountry: setCountry,
    loadRates: loadRates,
    localise: localise,
    quote: quote,
    supports: function (method) { return state.methods.indexOf(method) > -1; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init().then(loadRates); });
  else init().then(loadRates);
})(window);
