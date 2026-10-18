/* MARVINUMS background selection and light-touch brand consistency. */
(function(){
  function pick(){
    var p=(location.pathname||'/').toLowerCase();
    if(p==='/' || p.endsWith('/index.html') || p==='/login' || p==='/register') return 'mz-bg-hero';
    if(/buy-number|number-history|virtual-account|deposit|wallet|transactions|purchases|referral|settings/.test(p)) return 'mz-bg-phone';
    if(/boost|marketplace|tools|game|groups|giveaway|data-bill/.test(p)) return 'mz-bg-speed';
    return 'mz-bg-social';
  }
  function apply(){
    try{
      var b=document.body; if(!b) return;
      b.classList.remove('mz-bg-hero','mz-bg-phone','mz-bg-speed','mz-bg-social');
      b.classList.add(pick());
    }catch(e){}
  }
  try {
    apply();
    // The main app switches pages without reloading, so re-pick the artwork on every navigation.
    ['pushState','replaceState'].forEach(function(fn){
      var orig=history[fn];
      history[fn]=function(){ var r=orig.apply(this,arguments); setTimeout(apply,0); return r; };
    });
    window.addEventListener('popstate',apply);
    // Keep existing application logic intact; update only document branding.
    if(document.title) document.title=document.title.replace(/King Social Hub|KingSocialHub|King Social/gi,'MARVINUMS');
    var desc=document.querySelector('meta[name="application-name"]');
    if(desc) desc.setAttribute('content','MARVINUMS');
  } catch(e) {}
})();
