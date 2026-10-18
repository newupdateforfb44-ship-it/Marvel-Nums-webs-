(function(){try{if(window.__kslBackLoader)return;window.__kslBackLoader=true;var s=document.createElement('script');s.src='/js/back-button.js?v=1';s.defer=true;document.head.appendChild(s);}catch(e){}})();
/* Keeps the login token fresh so users never get stuck on "Invalid token".
 * - Always sends the newest saved token (pages cache it in variables at load time).
 * - Saves refreshed tokens the server sends back (X-Refresh-Token).
 * - If the session really ended, clears it and sends the user to log in once. */
(function () {
  if (window.__authKeeper) return; window.__authKeeper = true;
  var KEY = 'ksl_token', origFetch = window.fetch.bind(window), redirecting = false;
  function current() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  window.fetch = function (input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var sameOrigin = url.indexOf('http') !== 0 || url.indexOf(location.origin) === 0;
    var isAdmin = /\/api\/(admin|subadmin)/.test(url);
    if (sameOrigin && !isAdmin && init.headers) {
      var tok = current();
      try {
        if (init.headers instanceof Headers) {
          if (/^Bearer /.test(init.headers.get('Authorization') || '') && tok) init.headers.set('Authorization', 'Bearer ' + tok);
        } else if (init.headers.Authorization && /^Bearer /.test(init.headers.Authorization) && tok) {
          init.headers = Object.assign({}, init.headers, { Authorization: 'Bearer ' + tok });
        }
      } catch (e) {}
    }
    return origFetch(input, init).then(function (res) {
      if (!sameOrigin || isAdmin) return res;
      var fresh = res.headers.get('X-Refresh-Token');
      if (fresh) { try { localStorage.setItem(KEY, fresh); } catch (e) {} }
      if (res.status === 401 && current()) {
        res.clone().json().then(function (d) {
          if (d && d.sessionEnded && !redirecting && !/\/login/.test(location.pathname)) {
            redirecting = true;
            try { localStorage.removeItem(KEY); localStorage.removeItem('ksl_user'); } catch (e) {}
            alert('Your session ended — please log in again.');
            location.href = '/login';
          }
        }).catch(function () {});
      }
      return res;
    });
  };
})();
