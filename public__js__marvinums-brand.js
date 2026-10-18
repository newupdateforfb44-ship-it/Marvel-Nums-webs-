/* MARVEL NUMS background selection and light-touch brand consistency. */
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
    if(document.title) document.title=document.title.replace(/Marvel Nums|Marvel Nums|King Social/gi,'MARVEL NUMS');
    var desc=document.querySelector('meta[name="application-name"]');
    if(desc) desc.setAttribute('content','MARVEL NUMS');
  } catch(e) {}
})();

/* Moving "Marvel Nums" name behind the whole site + appear animation for feature cards. */
(function(){
  'use strict';
  function buildDrift(){
    try{
      if(document.getElementById('mn-drift')||!document.body) return;
      var wrap=document.createElement('div'); wrap.id='mn-drift'; wrap.setAttribute('aria-hidden','true');
      var small=window.innerWidth<700, rows=small?9:11, h=window.innerHeight||800;
      for(var i=0;i<rows;i++){
        var row=document.createElement('div');
        row.className='mn-row'+(i%3===0?' mn-fill':'')+(i%2?' mn-pink':'');
        var size=small?(34+(i%3)*10):(54+(i%3)*16);
        row.style.fontSize=size+'px';
        row.style.top=Math.round((i/rows)*h-size*0.2)+'px';
        row.style.setProperty('--mn-dur',(46+(i*7)%34)+'s');
        row.style.setProperty('--mn-dir',i%2?'reverse':'normal');
        var html='';
        for(var k=0;k<24;k++) html+='<span>Marvel Nums</span>';   // list is longer than 2 screens; it slides by half its width
        row.innerHTML=html; wrap.appendChild(row);
      }
      var spots=small?3:5;
      for(var j=0;j<spots;j++){
        var f=document.createElement('div'); f.className='mn-float'; f.textContent='Marvel Nums';
        f.style.left=(6+(j*83)%80)+'%'; f.style.top=(10+(j*37)%75)+'%';
        f.style.fontSize=(small?20:30)+(j%3)*6+'px';
        f.style.setProperty('--mn-dur',(12+j*3)+'s'); f.style.setProperty('--mn-del',(-j*2.3)+'s');
        f.style.setProperty('--mn-rot',((j%2)?8:-8)+'deg'); wrap.appendChild(f);
      }
      document.body.appendChild(wrap);
    }catch(e){}
  }
  var CARD_SEL='.why-card,.kls-what-card,.rs-item,.kls-step';
  function setupReveal(){
    try{
      if(!('IntersectionObserver' in window)) return;
      var io=new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if(en.isIntersecting){ en.target.classList.add('mn-in'); io.unobserve(en.target); }
        });
      },{threshold:0.12,rootMargin:'0px 0px -6% 0px'});
      function scan(){
        var groups=new Map();
        document.querySelectorAll(CARD_SEL).forEach(function(c){
          if(c.dataset.mnSeen) return; c.dataset.mnSeen='1';
          var p=c.parentElement, idx=groups.get(p)||0; groups.set(p,idx+1);
          c.classList.add('mn-reveal');
          if(idx%3===0) c.classList.add('mn-from-left'); else if(idx%3===2) c.classList.add('mn-from-right');
          c.style.setProperty('--mn-d',Math.min(idx*0.09,0.6)+'s');
          io.observe(c);
        });
      }
      scan();
      // pages are swapped without reloading, so look again after navigation
      ['pushState','popstate'].forEach(function(n){ if(n==='popstate') window.addEventListener(n,function(){setTimeout(scan,300);}); else{ var o=history[n]; history[n]=function(){var r=o.apply(this,arguments); setTimeout(scan,300); return r;}; }});
      // safety net: never leave a card invisible
      setTimeout(function(){ document.querySelectorAll('.mn-reveal:not(.mn-in)').forEach(function(c){ var r=c.getBoundingClientRect(); if(r.top<window.innerHeight&&r.bottom>0) c.classList.add('mn-in'); }); },2500);
    }catch(e){}
  }
  function init(){ buildDrift(); setupReveal(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
