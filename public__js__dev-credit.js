/* Site credits and owner contact strip */
(function () {
  'use strict';
  if (window.__klsDevCredit) return;
  window.__klsDevCredit = true;
  var OWNER_WHATSAPP = 'https://wa.me/2348128358120';
  function mount() {
    if (document.querySelector('.kls-devbar')) return;
    var bar = document.createElement('div');
    bar.className = 'kls-devbar';
    bar.innerHTML =
      '<div class="kls-devbar-inner">' +
        '<div class="kls-devbar-main">' +
          '<span class="kls-devbar-dot" aria-hidden="true"></span>' +
          '<span class="kls-devbar-txt">Designed and engineered by developer <strong>Marvel</strong></span>' +
        '</div>' +
        '<div class="kls-devbar-buy">' +
          'Want to buy this website? <a href="' + OWNER_WHATSAPP + '" target="_blank" rel="noopener noreferrer" class="kls-devbar-cta">Contact the admin / owner on WhatsApp: +234 812 835 8120</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
