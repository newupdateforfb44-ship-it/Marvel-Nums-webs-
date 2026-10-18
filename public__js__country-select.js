/**
 * public/js/country-select.js — searchable international phone / country picker
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   <div data-country-phone data-name="phone"></div>       → dial-code + number
 *   <div data-country-select data-name="country"></div>    → country only
 *
 * Or programmatically:
 *   const picker = KLSCountry.mountPhone(el, { value: '+2348012345678' });
 *   picker.value()   →  { country: 'NG', dialCode: '+234', phone: '+2348012345678', valid: true }
 *
 * The country list is fetched once from /api/intl/countries and cached in
 * sessionStorage, so the picker opens instantly on every later page.
 */
(function (global) {
  'use strict';

  var CACHE_KEY = 'kls_countries_v2'; // v2: v1 caches poisoned by the HTML-instead-of-JSON bug
  var loaded = null;

  function fetchCountries() {
    if (loaded) return loaded;
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (cached && cached.length) {
      loaded = Promise.resolve(cached);
      return loaded;
    }
    // Two sources, tried in order. Anything that is not a usable JSON array of
    // countries (an HTML error page, an empty body, a single-country payload)
    // falls through to the next source instead of silently becoming a
    // Nigeria-only list.
    function pull(url) {
      return fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) {
          var ct = r.headers.get('content-type') || '';
          if (!r.ok || ct.indexOf('json') === -1) throw new Error('non-JSON response from ' + url);
          return r.json();
        })
        .then(function (d) {
          var list = Array.isArray(d) ? d : (d.countries || []);
          if (!Array.isArray(list) || list.length < 20) throw new Error('country list from ' + url + ' looks truncated');
          return list;
        });
    }

    loaded = pull('/api/intl/countries')
      .catch(function () { return pull('/api/countries'); })
      .then(function (list) {
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (e) { /* quota */ }
        return list;
      })
      .catch(function (e) {
        console.warn('[country-select] worldwide list unavailable, using minimal fallback:', e.message);
        loaded = null; // let the next caller retry rather than caching the fallback forever
        return [{ code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬', currency: 'NGN', methods: [] }];
      });
    return loaded;
  }

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function filter(list, term) {
    var q = normalize(term).replace('+', '');
    if (!q) return list;
    var starts = [], has = [];
    list.forEach(function (c) {
      var n = normalize(c.name);
      if (n.indexOf(q) === 0 || normalize(c.code) === q || c.dialCode.replace('+', '').indexOf(q) === 0) starts.push(c);
      else if (n.indexOf(q) > -1) has.push(c);
    });
    return starts.concat(has);
  }

  function buildDropdown(onPick) {
    var dd = document.createElement('div');
    dd.className = 'kls-cs-menu';
    dd.innerHTML =
      '<div class="kls-cs-search"><input type="text" placeholder="Search country" autocomplete="off" aria-label="Search country"/></div>' +
      '<div class="kls-cs-list" role="listbox"></div>';
    var input = dd.querySelector('input');
    var list = dd.querySelector('.kls-cs-list');
    var all = [];
    var active = -1;

    function render(items) {
      list.innerHTML = items.slice(0, 250).map(function (c, i) {
        return '<button type="button" class="kls-cs-item" role="option" data-code="' + c.code + '" data-i="' + i + '">' +
          '<span class="kls-cs-flag">' + c.flag + '</span>' +
          '<span class="kls-cs-name">' + c.name + '</span>' +
          '<span class="kls-cs-dial">' + c.dialCode + '</span></button>';
      }).join('') || '<div class="kls-cs-empty">No country found</div>';
      active = -1;
    }
    fetchCountries().then(function (l) { all = l; render(all); });

    input.addEventListener('input', function () { render(filter(all, input.value)); });
    input.addEventListener('keydown', function (e) {
      var items = list.querySelectorAll('.kls-cs-item');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach(function (it) { it.classList.remove('active'); });
        if (items[active]) { items[active].classList.add('active'); items[active].scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var pick = items[active] || items[0];
        if (pick) pick.click();
      }
    });
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('.kls-cs-item');
      if (!btn) return;
      var c = all.filter(function (x) { return x.code === btn.getAttribute('data-code'); })[0];
      if (c) onPick(c);
    });
    dd.focusSearch = function () { setTimeout(function () { input.focus(); input.select(); }, 20); };
    return dd;
  }

  function mount(host, opts, phoneMode) {
    opts = opts || {};
    host.classList.add('kls-cs');
    host.innerHTML =
      '<div class="kls-cs-control">' +
        '<button type="button" class="kls-cs-trigger">' +
          '<span class="kls-cs-flag">🌍</span>' +
          (phoneMode ? '<span class="kls-cs-dial">+—</span>' : '<span class="kls-cs-name">Select country</span>') +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
        (phoneMode ? '<input type="tel" class="kls-cs-number" inputmode="tel" placeholder="Phone number" autocomplete="tel-national"/>' : '') +
      '</div>';

    var trigger = host.querySelector('.kls-cs-trigger');
    var numberInput = host.querySelector('.kls-cs-number');
    var selected = null;

    var menu = buildDropdown(function (c) { setCountry(c); close(); if (numberInput) numberInput.focus(); });
    host.appendChild(menu);

    function setCountry(c) {
      selected = c;
      host.querySelector('.kls-cs-flag').textContent = c.flag;
      var label = host.querySelector(phoneMode ? '.kls-cs-dial' : '.kls-cs-name');
      if (label) label.textContent = phoneMode ? c.dialCode : c.name;
      host.dataset.country = c.code;
      host.dataset.currency = c.currency;
      if (opts.onChange) opts.onChange(api.value());
      host.dispatchEvent(new CustomEvent('country:change', { bubbles: true, detail: api.value() }));
    }
    function open() { host.classList.add('open'); menu.focusSearch(); }
    function close() { host.classList.remove('open'); }

    trigger.addEventListener('click', function (e) { e.stopPropagation(); host.classList.contains('open') ? close() : open(); });
    document.addEventListener('click', function (e) { if (!host.contains(e.target)) close(); });
    if (numberInput) numberInput.addEventListener('input', function () { if (opts.onChange) opts.onChange(api.value()); });

    var api = {
      value: function () {
        var digits = numberInput ? numberInput.value.replace(/\D/g, '').replace(/^0+/, '') : '';
        var full = selected && digits ? selected.dialCode + digits : '';
        return {
          country: selected ? selected.code : '',
          currency: selected ? selected.currency : '',
          dialCode: selected ? selected.dialCode : '',
          national: digits,
          phone: full,
          valid: Boolean(selected) && (!phoneMode || (digits.length >= 5 && digits.length <= 14))
        };
      },
      setCountryCode: function (code) {
        return fetchCountries().then(function (all) {
          var c = all.filter(function (x) { return x.code === String(code).toUpperCase(); })[0];
          if (c) setCountry(c);
          return c;
        });
      },
      setPhone: function (e164) {
        return fetchCountries().then(function (all) {
          var p = String(e164 || '');
          if (!p.indexOf('+') === 0) return null;
          var match = all.slice().sort(function (a, b) { return b.dialCode.length - a.dialCode.length; })
            .filter(function (c) { return p.indexOf(c.dialCode) === 0; })[0];
          if (match) { setCountry(match); if (numberInput) numberInput.value = p.slice(match.dialCode.length); }
          return match;
        });
      },
      element: host
    };

    // Initial value: explicit → saved → IP detection → Nigeria
    if (opts.value) api.setPhone(opts.value);
    else if (opts.country) api.setCountryCode(opts.country);
    else {
      var saved = null;
      try { saved = localStorage.getItem('kls_country'); } catch (e) { /* ignore */ }
      if (saved) api.setCountryCode(saved);
      else fetch('/api/intl/detect').then(function (r) { return r.json(); })
        .then(function (d) { api.setCountryCode(d.country || 'NG'); })
        .catch(function () { api.setCountryCode('NG'); });
    }

    host.klsCountry = api;
    return api;
  }

  function autoMount(root) {
    (root || document).querySelectorAll('[data-country-phone]:not(.kls-cs)').forEach(function (el) {
      mount(el, { value: el.getAttribute('data-value') || '', country: el.getAttribute('data-country') || '' }, true);
    });
    (root || document).querySelectorAll('[data-country-select]:not(.kls-cs)').forEach(function (el) {
      mount(el, { country: el.getAttribute('data-country') || '' }, false);
    });
  }

  global.KLSCountry = {
    load: fetchCountries,
    mountPhone: function (el, opts) { return mount(el, opts, true); },
    mountCountry: function (el, opts) { return mount(el, opts, false); },
    autoMount: autoMount,
    filter: filter
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { autoMount(); });
  else autoMount();
})(window);
