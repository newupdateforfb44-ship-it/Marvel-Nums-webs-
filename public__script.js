(function(){try{if(window.__kslBackLoader)return;window.__kslBackLoader=true;var s=document.createElement('script');s.src='/js/back-button.js?v=1';s.defer=true;document.head.appendChild(s);}catch(e){}})();
// ── CONFIG ─────────────────────────────────────────────────────
const API = '';
let WA_NUMBER = '2349065518402'; // overwritten on load by applySiteLinks() from admin-configured value
const DEFAULT_AVATAR_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231c1c2a'/%3E%3Ctext x='50' y='65' font-size='50' text-anchor='middle' fill='%232f7bf6'%3E%F0%9F%91%A4%3C/text%3E%3C/svg%3E";
let token = localStorage.getItem('ksl_token');
let currentUser = JSON.parse(localStorage.getItem('ksl_user') || 'null');
let allMarketLogs = [];
let currentPage = null;
// If the browser restores a page from its back/forward cache (bfcache) — e.g. tapping the
// browser's back button — the DOM snapshot can briefly show stale data (old balance, old name)
// before scripts re-run. Force a clean reload so what's on screen is always current.
window.addEventListener('pageshow', function(e){ if (e.persisted) window.location.reload(); });
// ── URL ROUTING ────────────────────────────────────────────────
// Maps internal page names to real URL paths, e.g. showPage('market') -> /marketplace.
// The chat page is split into two routes even though 'chat' remains the internal page name;
// the actual group-vs-DM view is chosen via switchChatMode() before/after routing.
const PAGE_TO_PATH = {
  home: '/', market: '/marketplace', market2: '/marketplace2', market3: '/marketplace3', tools: '/tools', deposit: '/deposit', wallet: '/wallet',
  purchases: '/purchases', transactions: '/transactions', support: '/support',
  settings: '/settings', login: '/login', register: '/register', terms: '/terms',
  games: '/games', groups: '/groups', dm: '/messages', referrals: '/referrals',
  notifications: '/notifications', numberhistory: '/number-history', orderstatus: '/order-status',
  // Standalone pages that ship their own HTML file. These MUST be listed here, otherwise
  // pageForPath() returns null, the router falls back to 'home', #page-home does not exist
  // in that file and every .page div stays hidden -> completely blank page.
  boost: '/boost', boost1: '/boost1', boost2: '/boost2', 'boost-services': '/boost-services', 'boost-history': '/boost-history'
};
const PATH_TO_PAGE = Object.fromEntries(Object.entries(PAGE_TO_PATH).map(([k,v]) => [v,k]));
// '/marketplace' etc. are absolute site paths per Marvel Nums's domain convention
// (e.g. https://klslogs.com/marketplace).
function pathForPage(p) { return PAGE_TO_PATH[p] || '/'; }
function pageForPath(path) {
  if (path === '/' || path === '') return token ? 'home' : 'welcome';
  return PATH_TO_PAGE[path] || null;
}
// Pulls the admin-configured WhatsApp Group/Channel/Contact links (see the admin panel's "Site
// Links" tab) and applies them to every anchor tagged data-link="group/channel/contact" across
// the whole site, plus WA_NUMBER used by JS-rendered content (chat/support prompts etc.). Runs
// once per page load — these rarely change, so no need to re-fetch on every navigation.
async function applySiteLinks() {
  try {
    const links = await req('/api/public/site-links', 'GET', null, false, false, true);
    if (links.whatsappNumber) WA_NUMBER = links.whatsappNumber;
    const adminPhone = links.adminPhone || WA_NUMBER;
    if (links.telegramCommunityLink || links.whatsappGroupLink) document.querySelectorAll('a[data-link="group"]').forEach(a => a.href = links.telegramCommunityLink || links.whatsappGroupLink);
    if (links.telegramChannelLink || links.whatsappChannelLink) document.querySelectorAll('a[data-link="channel"]').forEach(a => a.href = links.telegramChannelLink || links.whatsappChannelLink);
    document.querySelectorAll('a[data-link="contact"]').forEach(a => { a.href = `https://wa.me/${WA_NUMBER}`; });
    document.querySelectorAll('a[data-link="adminphone"]').forEach(a => { a.href = `https://wa.me/${adminPhone}`; });
    // Terms & Conditions page uses its own admin-set number (Admin → Site Links); blank = the Home page number
    const termsNum = links.termsNumber || WA_NUMBER;
    const textLink = document.getElementById('termsWaTextLink');
    if (textLink) { textLink.href = `https://wa.me/${termsNum}`; textLink.textContent = `wa.me/${termsNum}`; }
    document.querySelectorAll('.ksl-admin-phone-text').forEach(el => el.textContent = `+${adminPhone}`);
    document.querySelectorAll('.ksl-wa-number-text').forEach(el => el.textContent = `+${WA_NUMBER}`);
    // Telegram support (admin-editable in Admin → Site Links). Defaults to t.me/klslogs.
    TG_LINK = links.telegramLink || (links.telegramUsername ? `https://t.me/${links.telegramUsername}` : TG_LINK);
    TG_USERNAME = (links.telegramUsername || TG_LINK.split('/').pop() || 'klslogs').replace(/^@/, '');
    WA_CHAT_LINK = links.whatsappChatLink || `https://wa.me/${WA_NUMBER}`;
    SUPPORT_HOURS = links.supportHours || SUPPORT_HOURS;
    document.querySelectorAll('a[data-link="telegram"]').forEach(a => { a.href = TG_LINK; });
    document.querySelectorAll('.ksl-telegram-text').forEach(el => el.textContent = `@${TG_USERNAME}`);
    document.querySelectorAll('.ksl-support-hours').forEach(el => el.textContent = SUPPORT_HOURS);
  } catch (e) { /* site links didn't load — pages fall back to their default WA_NUMBER/TG_LINK */ }
}
let TG_LINK = 'https://t.me/klslogs';
let TG_USERNAME = 'klslogs';
let WA_CHAT_LINK = '';
let SUPPORT_HOURS = '9:00 AM \u2013 11:00 PM (WAT), every day';

// NOTE: a floating bottom-left Telegram/WhatsApp "support dock" used to be mounted here on every
// page. It duplicated the Support button (bottom-right) and, on mobile, sat directly on top of
// the bottom nav's Home tab — removed. Telegram/WhatsApp/Community links are still available via
// the Support button (bottom-right) and the Support page.
// First-touch referral attribution: if this visit has ?ref=CODE, remember it so whichever
// signup method the visitor eventually uses (email/password or Google, now or days from now)
// still credits the right referrer. Never overwrites a code already stored from an earlier visit.
function captureReferralCode() {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref && !localStorage.getItem('ksl_ref')) {
    localStorage.setItem('ksl_ref', ref.trim().toUpperCase().slice(0, 20));
  }
  prefillReferralField();
}
// Fills the visible "Referral Code" field on the register form from whatever's stored — called
// both on page load and every time the register page is shown, so it's populated whether the
// visitor lands directly on /register?ref=CODE or arrives at the homepage first and clicks through.
function prefillReferralField() {
  const field = document.getElementById('regRefCode');
  if (!field) return;
  const stored = localStorage.getItem('ksl_ref');
  if (stored && !field.value) field.value = stored;
}
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const wasOpen = item.classList.contains('open');
  // Accordion behavior — closing any open one before opening the clicked one, so only one
  // answer is visible at a time (keeps the section compact instead of growing indefinitely).
  document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}
document.addEventListener('DOMContentLoaded', () => {
  captureReferralCode();
  applySiteLinks();
  updateNav();
  initTheme();
  // Standalone pages (e.g. /boost1) ship their own .page div. If the path is not in the router
  // map we must NOT fall back to 'home' (that sent logged-in users to /dashboard). Keep the page.
  const _mapped = pageForPath(window.location.pathname);
  const _standalone = !_mapped && window.location.pathname !== '/' && !document.getElementById('page-home') && document.querySelector('.page');
  const initialPage = _standalone ? (_standalone.id || '').replace(/^page-/, '') || 'home' : (_mapped || (token ? 'home' : 'login'));
  if (_standalone) { _standalone.classList.add('active'); }
  // A returning logged-in user landing on '/' used to see this SPA's old marketing/home
  // section — send them straight to the real dashboard instead.
  if (token && initialPage === 'home' && !_standalone) { window.location.replace('/dashboard'); return; }
  if (!_standalone) showPage(initialPage, { replace: true });
  handleGoogleRedirectResult();
  trackVisit();
  loadAds();
  updateCommunityFab();
  loadWelcomeContent();
  const td = document.getElementById('termsDate');
  if (td) td.textContent = new Date().toLocaleDateString('en-NG',{day:'numeric',month:'long',year:'numeric'});
  if (token) {

    setInterval(silentBalancePoll, 15000); // fallback polling every 15s (tighter net)
    startBalanceSSE();                     // real-time push via SSE (instant on VA deposit)
  }
});
// ── Real-time balance via Server-Sent Events ──────────────────────────────────
// Connects once when the user logs in. Server pushes a 'balance' event the moment
// a Virtual Account deposit is credited — no refresh, no polling delay.
let _sseSource = null;
function startBalanceSSE() {
  if (!token || _sseSource) return;
  // Shared dedupe for deposit toasts — a single deposit can trigger up to three independent
  // signals within milliseconds of each other: the SSE 'balance' event, the SSE 'va_deposit'
  // event, and the 15s fallback poller. Without this, the user sees the same deposit toasted
  // 2-3 times. This collapses same-amount signals arriving within 8s into a single toast, while
  // still letting a genuinely new/later deposit (or the poller acting as a real SSE-down fallback)
  // toast normally.
  window._lastDepositToastAmt = null;
  window._lastDepositToastAt = 0;
  window.maybeToastDeposit = function(amount) {
    if (!amount || amount <= 0) return;
    const now = Date.now();
    if (window._lastDepositToastAmt === amount && (now - window._lastDepositToastAt) < 8000) return;
    window._lastDepositToastAmt = amount;
    window._lastDepositToastAt = now;
    showToast(`${P2(amount)} deposited — wallet credited!`, 'ok');
  };
  try {
    _sseSource = new EventSource('/api/user/events');
    _sseSource.addEventListener('balance', (e) => {
      try {
        const data = JSON.parse(e.data);
        const newBal = data.balance;
        if (typeof newBal !== 'number') return;
        const prev = currentUser?.balance || 0;
        if (newBal === prev) return;
        // Update stored user
        if (currentUser) { currentUser.balance = newBal; localStorage.setItem('ksl_user', JSON.stringify(currentUser)); }
        // Update all balance displays
        ['navBalance','depositBal','dbBal','vaWalletBal','plWalletBal'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = fmt(newBal);
        });
        // Toast only when balance went UP (VA deposit came in) — deduped against 'va_deposit' and poller
        if (newBal > prev && data.source === 'virtual_account') {
          // Use server-provided creditAmount if available (more accurate than diff)
          const added = data.creditAmount || (newBal - prev);
          maybeToastDeposit(added);
          // Show confirm banner
          const bannerWrap = document.querySelector('.va-confirm-banner');
          if (bannerWrap) {
            const subEl = bannerWrap.querySelector('.va-confirm-sub');
            if (subEl) subEl.textContent = `${P2(added)} credited to your Marvel Nums wallet automatically.`;
            bannerWrap.style.display = 'flex';
            setTimeout(() => { if (bannerWrap) bannerWrap.style.display = 'none'; }, 12000);
          }
          if (typeof stopVAPoller === 'function') stopVAPoller();
          setTimeout(() => { if (typeof startVAPoller === 'function') startVAPoller(); }, 2000);
        }
      } catch {}
    });
    // va_deposit event — server pushes this the moment a VA payment is confirmed.
    // Gives instant banner + toast independently of the balance event (toast deduped against it).
    _sseSource.addEventListener('va_deposit', (e) => {
      try {
        const data = JSON.parse(e.data);
        const { creditAmount, balance, flwRef } = data;
        // Remember this deposit so the fallback poller (which runs independently, including after
        // a fresh page load) never re-detects it as a "new" unnotified deposit later.
        if (flwRef) {
          _vaLastFlwRef = flwRef;
          try { localStorage.setItem('ksl_last_va_flwref', flwRef); } catch {}
        }
        // Update balances
        if (currentUser && balance) {
          currentUser.balance = balance;
          localStorage.setItem('ksl_user', JSON.stringify(currentUser));
        }
        if (balance) {
          ['navBalance','depositBal','dbBal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = fmt(balance);
          });
        }
        // Show VA confirmation banner (once per deposit via SSE)
        const bannerWrap = document.querySelector('.va-confirm-banner');
        if (bannerWrap && creditAmount) {
          const subEl = bannerWrap.querySelector('.va-confirm-sub');
          if (subEl) subEl.textContent = `${P2(creditAmount)} credited to your Marvel Nums wallet automatically.`;
          bannerWrap.style.display = 'flex';
          setTimeout(() => { if (bannerWrap) bannerWrap.style.display = 'none'; }, 12000);
        }
        if (creditAmount) maybeToastDeposit(creditAmount);
        // Stop the fallback poller — SSE already delivered the event
        if (typeof stopVAPoller === 'function') stopVAPoller();
        // Restart to watch for next payment
        setTimeout(() => { if (typeof startVAPoller === 'function') startVAPoller(); }, 2000);
      } catch {}
    });
    _sseSource.onerror = () => {
      // SSE disconnected — reconnect after 10s (handles server restarts)
      _sseSource?.close(); _sseSource = null;
      setTimeout(() => { if (token) startBalanceSSE(); }, 10000);
    };
  } catch {}
}
// Live stats + category showcase on the pre-login welcome page — real numbers, not copy.
// Safe to call even if the welcome page isn't currently shown (elements just won't exist yet
// on other pages, guarded below) and safe to call whether or not the user is logged in.
async function loadWelcomeContent() {
  const statsEl = document.getElementById('welcomeStats');
  if (statsEl) {
    try {
      const stats = await req('/api/public/stats', 'GET', null, false);
      const setIf = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = Number(val||0).toLocaleString('en-NG'); };
      setIf('wsUsers', stats.totalUsers);
      setIf('wsLogs', stats.activeLogs);
      setIf('wsTools', stats.activeTools);
      setIf('wsCats', stats.categoryCount);
      setIf('wsDelivered', stats.deliveredCount);
    } catch { /* stats strip just keeps its em-dash placeholders if this fails */ }
  }
  loadLiveStats();
  const grid = document.getElementById('welcomeCatGrid');
  if (grid) {
    try {
      const cats = await req('/api/categories', 'GET', null, false, false, true); // silent — decorative, fails gracefully
      grid.innerHTML = cats.slice(0, 12).map(c =>
        `<div class="wc-item" onclick="showPage('register')"><div class="wc-icon">${catIconHtml(c.name)}</div><div class="wc-name">${esc(c.name)}</div></div>`
      ).join('');
    } catch { grid.innerHTML = ''; }
  }
}
// Floating Support button — always visible, whether logged in or out.
function updateCommunityFab() {
  const fab = document.getElementById('supportFab');
  if (!fab) return;
  fab.style.display = 'flex';
}
function toggleSupportFab() {
  document.getElementById('supportFab')?.classList.toggle('open');
}
document.addEventListener('click', e => {
  const fab = document.getElementById('supportFab');
  if (fab && fab.classList.contains('open') && !e.target.closest('#supportFab')) fab.classList.remove('open');
});
// Browser back/forward button support
window.addEventListener('popstate', () => {
  const p = pageForPath(window.location.pathname) || (token ? 'home' : 'login');
  showPage(p, { fromPopstate: true });
});
// ── VISITOR COUNTER (permanent) ───────────────────────────────
function getVisitorId() {
  let id = localStorage.getItem('ksl_visitor_id');
  if (!id) {
    id = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    localStorage.setItem('ksl_visitor_id', id);
  }
  return id;
}
async function trackVisit() {
  try {
    const data = await req('/api/visit', 'POST', { visitorId: getVisitorId() }, false, false, true);
    updateVisitorDisplay(data.visitors);
  } catch { refreshVisitorDisplay(); }
}
async function refreshVisitorDisplay() {
  try {
    const data = await req('/api/visit', 'GET', null, false, false, true);
    updateVisitorDisplay(data.visitors);
  } catch {}
}
// A visitor count is a COUNT, not money. It used to go through fmt(), which is
// the currency formatter, so the homepage showed "$0.95" instead of "1,204".
function fmtCount(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  try { return v.toLocaleString(undefined); } catch { return String(v); }
}
function updateVisitorDisplay(visitors) {
  const t = document.getElementById('footerVisitCount');
  const h = document.getElementById('homeStatVisitors');
  const text = fmtCount(visitors);
  if (t) t.textContent = text;
  if (h) h.textContent = text;
  const y = document.getElementById('footerYear');
  if (y) y.textContent = new Date().getFullYear();
}

// ── ADS (admin-controlled banner) ─────────────────────────────
let siteAds = [];
const AD_PAGES = ['home', 'market', 'tools'];
async function loadAds() {
  try {
    siteAds = await req('/api/ads');
  } catch { siteAds = []; }
  renderAdForCurrentPage();
}
function renderAdForCurrentPage() {
  const banner = document.getElementById('adBanner');
  if (!banner) return;
  const active = document.querySelector('.page.active');
  const pageName = active ? active.id.replace('page-', '') : '';
  const dismissed = JSON.parse(sessionStorage.getItem('ksl_ads_dismissed') || '[]');
  const visibleAds = siteAds.filter(a => !dismissed.includes(a._id));
  if (!AD_PAGES.includes(pageName) || !visibleAds.length) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  const ad = visibleAds[0];
  banner.style.display = 'block';
  banner.innerHTML = `<a class="ad-banner-inner" href="${esc(ad.link)}" target="_blank" rel="noopener">
    <span class="ad-banner-label">Ad</span>
    ${ad.imageUrl ? `<img src="${esc(ad.imageUrl)}" alt="${esc(ad.title||'Advertisement')}"/>` : ''}
    ${ad.title ? `<div class="ad-banner-title">${esc(ad.title)}</div>` : ''}
  </a>
  <button class="ad-banner-close" onclick="dismissAd(event,'${ad._id}')"><svg class="icon i-x" aria-hidden="true"><use href="#i-x"/></svg></button>`;
  banner.style.position = 'relative';
}
function dismissAd(e, id) {
  e.preventDefault(); e.stopPropagation();
  const dismissed = JSON.parse(sessionStorage.getItem('ksl_ads_dismissed') || '[]');
  if (!dismissed.includes(id)) dismissed.push(id);
  sessionStorage.setItem('ksl_ads_dismissed', JSON.stringify(dismissed));
  renderAdForCurrentPage();
}
// ── GROUP CHAT ──────────────────────────────────────────────────
let activeGroupId = null;
let chatPollTimer = null;
let lastMessageTime = null;
async function initChat() {
  const list = document.getElementById('chatGroupItems');
  list.innerHTML = '<div class="spin" style="margin:20px auto"></div>';
  try {
    const groups = await req('/api/chat/groups','GET',null,true);
    if (!groups.length) { list.innerHTML = '<div class="chat-empty" style="padding:16px">No groups yet. Check back soon!</div>'; return; }
    list.innerHTML = groups.map(g => `
      <div class="chat-group-item" id="grpItem_${g._id}" onclick="openChatGroup('${g._id}','${esc(g.name)}','${esc(g.description||'')}')">
        <div class="cgi-icon"><svg class="icon i-message-circle" aria-hidden="true"><use href="#i-message-circle"/></svg></div>
        <div class="cgi-info"><div class="cgi-name">${esc(g.name)}</div><div class="cgi-desc">${esc(g.description||'Tap to join the conversation')}</div></div>
      </div>`).join('');
    // Auto-open first group if none active
    if (!activeGroupId && groups[0]) openChatGroup(groups[0]._id, groups[0].name, groups[0].description||'');
  } catch (e) { list.innerHTML = `<div class="chat-empty" style="color:var(--red)">${e.message}</div>`; }
}
async function openChatGroup(id, name, desc) {
  stopChatPolling();
  activeGroupId = id;
  lastMessageTime = null;
  document.querySelectorAll('.chat-group-item').forEach(el => el.classList.remove('active'));
  document.getElementById('grpItem_' + id)?.classList.add('active');
  document.getElementById('chatHeader').querySelector('.chat-header-name').textContent = name;
  document.getElementById('chatHeaderSub').textContent = desc || '';
  document.getElementById('chatInputRow').style.display = 'flex';
  document.getElementById('groupChatLayout')?.classList.add('mchat-open'); // mobile: swap list -> conversation view
  const box = document.getElementById('chatMessages');
  box.innerHTML = '<div class="spin" style="margin:20px auto"></div>';
  try {
    const messages = await req(`/api/chat/groups/${id}/messages`,'GET',null,true);
    renderChatMessages(messages, true);
    startChatPolling();
  } catch (e) { box.innerHTML = `<div class="chat-empty" style="color:var(--red)">${e.message}</div>`; }
}
// Renders a sender avatar. A real <img> is used ONLY when that user actually uploaded a
// profile picture; otherwise we show their initial in a coloured circle — no stock/placeholder
// avatars, per requirement.
function chatAvatarHtml(name, picture) {
  const label = esc(name || 'User');
  if (picture) return `<img class="chat-msg-avatar" src="${esc(picture)}" alt="${label}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'chat-msg-avatar chat-msg-avatar-ph',textContent:'${(label[0]||'U').toUpperCase()}'}))"/>`;
  return `<span class="chat-msg-avatar chat-msg-avatar-ph" aria-hidden="true">${esc((label[0]||'U').toUpperCase())}</span>`;
}
function renderChatMessages(messages, replace) {
  const box = document.getElementById('chatMessages');
  if (replace) box.innerHTML = '';
  if (replace && !messages.length) { box.innerHTML = '<div class="chat-empty">No messages yet — say hello!</div>'; return; }
  messages.forEach(m => {
    const senderId = m.userId?._id || m.userId;
    const mine = senderId === currentUser?.id;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (mine ? 'mine' : 'theirs');
    const mediaHtml = renderChatAttachment(m);
    const dmBtn = mine ? '' : `<button class="chat-dm-btn" title="Send a direct message" onclick="startDM('${senderId}')"><svg class="icon i-mail" aria-hidden="true"><use href="#i-mail"/></svg></button>`;
    const avatar = mine ? '' : chatAvatarHtml(m.userName, m.senderPicture);
    div.innerHTML = `
      <div class="chat-msg-author">${avatar}${mine ? 'You' : esc(m.userName)} ${dmBtn}</div>
      ${m.text ? `<div class="chat-msg-bubble">${esc(m.text)}</div>` : ''}
      ${mediaHtml}
      <div class="chat-msg-time">${new Date(m.createdAt).toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'})}</div>`;
    box.appendChild(div);
    lastMessageTime = m.createdAt;
  });
  box.scrollTop = box.scrollHeight;
}
function renderChatAttachment(m) {
  if (!m.attachmentUrl) return '';
  const url = esc(m.attachmentUrl);
  if (m.attachmentType === 'image') {
    return `<div class="chat-msg-media" onclick="openMediaViewer('image','${url}')"><img src="${url}" alt="attachment" loading="lazy"/></div>`;
  }
  if (m.attachmentType === 'video') {
    return `<div class="chat-msg-media" onclick="openMediaViewer('video','${url}')"><video src="${url}" muted></video></div>`;
  }
  if (m.attachmentType === 'audio') {
    return `<div class="chat-msg-voice"><audio controls src="${url}" preload="metadata"></audio></div>`;
  }
  return `<a class="chat-msg-file" href="${url}" target="_blank" download="${esc(m.attachmentName||'')}"><svg class="icon i-paperclip" aria-hidden="true"><use href="#i-paperclip"/></svg> ${esc(m.attachmentName||'Download file')}</a>`;
}
// ── FULLSCREEN MEDIA VIEWER ─────────────────────────────────────
function openMediaViewer(type, url) {
  const overlay = document.getElementById('mediaViewerOverlay');
  const content = document.getElementById('mediaViewerContent');
  content.innerHTML = type === 'video'
    ? `<video src="${url}" controls autoplay></video>`
    : `<img src="${url}" alt="attachment"/>`;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMediaViewer() {
  document.getElementById('mediaViewerOverlay').classList.remove('open');
  document.getElementById('mediaViewerContent').innerHTML = '';
  document.body.style.overflow = '';
}
function startChatPolling() {
  chatPollTimer = setInterval(async () => {
    if (!activeGroupId) return;
    try {
      const url = `/api/chat/groups/${activeGroupId}/messages` + (lastMessageTime ? `?after=${encodeURIComponent(lastMessageTime)}` : '');
      const messages = await req(url,'GET',null,true);
      if (messages.length) renderChatMessages(messages, false);
    } catch {}
  }, 4000);
}
function stopChatPolling() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  activeGroupId = null;
}
// ── CHAT ATTACHMENTS ─────────────────────────────────────────────
let pendingChatFile = null;
function handleChatFileSelect() {
  const input = document.getElementById('chatFileInput');
  const file = input.files[0];
  if (!file) return;
  if (file.size > 50*1024*1024) { showToast('File too large — max 50MB','err'); input.value=''; return; }
  pendingChatFile = file;
  const preview = document.getElementById('chatAttachPreview');
  preview.style.display = 'block';
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => {
      preview.innerHTML = `<div class="chat-attach-preview-inner"><img src="${e.target.result}"/><span>${esc(file.name)}</span><button class="chat-attach-remove" onclick="clearChatAttachment()"><svg class="icon i-x" aria-hidden="true"><use href="#i-x"/></svg></button></div>`;
    };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML = `<div class="chat-attach-preview-inner"><span><svg class="icon i-paperclip" aria-hidden="true"><use href="#i-paperclip"/></svg> ${esc(file.name)}</span><button class="chat-attach-remove" onclick="clearChatAttachment()"><svg class="icon i-x" aria-hidden="true"><use href="#i-x"/></svg></button></div>`;
  }
}
function clearChatAttachment() {
  pendingChatFile = null;
  document.getElementById('chatFileInput').value = '';
  const preview = document.getElementById('chatAttachPreview');
  preview.style.display = 'none';
  preview.innerHTML = '';
}
// ── VOICE NOTES (group chat + DM) ──────────────────────────────
// Tap mic to start recording, tap again to stop & send, or tap cancel to discard. Reuses the
// same attachment upload pipeline as image/video/file attachments — a voice note is just an
// audio file under the hood.
let _voiceRecorder = null;
let _voiceChunks = [];
let _voiceTarget = null; // 'group' | 'dm'
let _voiceStartTime = null;
let _voiceTimerInterval = null;
// Picks a container the browser can actually record. iOS Safari has no webm support and only
// produces audio/mp4, so probing in order matters — hardcoding webm produced silent/empty files.
function pickVoiceMime() {
  if (!window.MediaRecorder) return null;
  const candidates = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/mpeg','audio/ogg;codecs=opus','audio/ogg'];
  for (const type of candidates) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch {}
  }
  return ''; // let the browser choose its own default
}
function voiceExtFor(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}
async function toggleVoiceRecord(target) {
  if (_voiceRecorder && _voiceRecorder.state === 'recording') { stopVoiceRecord(); return; }
  // Nothing to send a voice note to yet — tell the user instead of silently recording.
  if (target === 'group' && !activeGroupId) { showToast('Open a group first, then record a voice note','err'); return; }
  if (target === 'dm' && !activeConvoId) { showToast('Open a conversation first, then record a voice note','err'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast('Voice notes need microphone access, which this browser doesn\'t support', 'err'); return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    showToast(e && e.name === 'NotAllowedError' ? 'Microphone blocked — allow access in your browser settings' : 'No microphone found', 'err');
    return;
  }
  try {
    _voiceTarget = target;
    _voiceChunks = [];
    const mimeType = pickVoiceMime();
    _voiceRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    _voiceRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) _voiceChunks.push(e.data); };
    _voiceRecorder.onerror = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(_voiceTimerInterval);
      hideVoiceRecordUI(target);
      showToast('Recording failed — please try again', 'err');
    };
    _voiceRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(_voiceTimerInterval);
      const duration = _voiceStartTime ? Date.now() - _voiceStartTime : 0;
      if (!_voiceChunks.length) return; // cancelled — nothing to send
      if (duration < 500) { _voiceChunks = []; showToast('Hold on a bit longer — that was too short', 'err'); return; }
      const type = _voiceRecorder?.mimeType || _voiceChunks[0]?.type || 'audio/webm';
      const blob = new Blob(_voiceChunks, { type });
      _voiceChunks = [];
      if (!blob.size) { showToast('Nothing was recorded — please try again', 'err'); return; }
      const file = new File([blob], `voice_${Date.now()}.${voiceExtFor(type)}`, { type });
      if (_voiceTarget === 'group') { pendingChatFile = file; sendChatMessage(); }
      else { pendingDmFile = file; sendDmMessage(); }
    };
    // Timeslice keeps data flowing so a long note isn't lost if the tab is backgrounded.
    _voiceRecorder.start(1000);
    _voiceStartTime = Date.now();
    showVoiceRecordUI(target);
    _voiceTimerInterval = setInterval(() => updateVoiceTimer(target), 200);
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    showToast('Could not start recording on this device', 'err');
  }
}
function stopVoiceRecord() {
  const target = _voiceTarget;
  if (_voiceRecorder && _voiceRecorder.state !== 'inactive') {
    try { _voiceRecorder.requestData?.(); } catch {}
    _voiceRecorder.stop();
  }
  clearInterval(_voiceTimerInterval);
  hideVoiceRecordUI(target);
}
function cancelVoiceRecord(target) {
  if (_voiceRecorder && _voiceRecorder.state === 'recording') { _voiceChunks = []; _voiceRecorder.stop(); }
  clearInterval(_voiceTimerInterval);
  hideVoiceRecordUI(target);
}
function showVoiceRecordUI(target) {
  const row = document.getElementById(target === 'group' ? 'chatInputRow' : 'dmInputRow');
  const indicator = document.getElementById(target === 'group' ? 'chatVoiceIndicator' : 'dmVoiceIndicator');
  if (row) row.style.display = 'none';
  if (indicator) indicator.style.display = 'flex';
}
function hideVoiceRecordUI(target) {
  const row = document.getElementById(target === 'group' ? 'chatInputRow' : 'dmInputRow');
  const indicator = document.getElementById(target === 'group' ? 'chatVoiceIndicator' : 'dmVoiceIndicator');
  if (row) row.style.display = 'flex';
  if (indicator) indicator.style.display = 'none';
}
function updateVoiceTimer(target) {
  const el = document.getElementById(target === 'group' ? 'chatVoiceTimer' : 'dmVoiceTimer');
  if (!el || !_voiceStartTime) return;
  const secs = Math.floor((Date.now() - _voiceStartTime) / 1000);
  el.textContent = `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`;
}
async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text && !pendingChatFile) return;
  if (!activeGroupId) return;
  const fileToSend = pendingChatFile;
  input.value = '';
  clearChatAttachment();
  try {
    let msg;
    if (fileToSend) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('attachment', fileToSend);
      const res = await fetch(`/api/chat/groups/${activeGroupId}/messages`, { method:'POST', headers:{'Authorization':'Bearer '+token}, body: fd });
      msg = await res.json();
      if (!res.ok) throw new Error(msg.error||'Failed to send');
    } else {
      msg = await req(`/api/chat/groups/${activeGroupId}/messages`,'POST',{text},true);
    }
    renderChatMessages([msg], false);
  } catch (e) { showToast(e.message,'err'); input.value = text; }
}
// ── DIRECT MESSAGES ───────────────────────────────────────────
let activeConvoId = null;
let dmPollTimer = null;
let dmListPollTimer = null;
let lastDmTime = null;
// Groups (/groups) and Direct Messages (/messages) are now separate FULL PAGES, so asking for
// the other mode is a real navigation instead of toggling two halves of one screen.
function switchChatMode(mode) {
  const isDm = mode === 'dm';
  const target = isDm ? '/messages' : '/groups';
  const layout = document.getElementById(isDm ? 'dmChatLayout' : 'groupChatLayout');
  if (!layout) { window.location.href = target; return; }
  if (isDm) { loadDmConversations(); startDmListPolling(); }
}
// Boots the standalone Direct Messages page, opening a conversation straight away when we
// arrived here from a group chat's "message user" button (/messages?convo=<id>).
function initDmPage() {
  loadDmConversations().then(() => {
    const wanted = new URLSearchParams(window.location.search).get('convo');
    if (wanted) {
      const item = document.getElementById('convoItem_' + wanted);
      const name = item?.querySelector('.cgi-name')?.textContent.trim() || '';
      openDmConversation(wanted, name);
    }
  });
  startDmListPolling();
}
// Unread pill next to the "Direct Messages" link on the Groups page.
async function refreshDmUnreadBadge() {
  const badge = document.getElementById('dmUnreadBadge');
  if (!badge) return;
  try {
    const convos = await req('/api/dm/conversations','GET',null,true);
    const total = (convos || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    if (total > 0) { badge.style.display = 'inline-block'; badge.textContent = total; }
    else badge.style.display = 'none';
  } catch { badge.style.display = 'none'; }
}
// Entry point used elsewhere (e.g. group chat member list, purchase history) to start/open a DM
async function startDM(userId) {
  try {
    const convo = await req('/api/dm/start','POST',{ userId },true);
    if (!document.getElementById('dmChatLayout')) { window.location.href = '/messages?convo=' + encodeURIComponent(convo._id); return; }
    await loadDmConversations();
    openDmConversation(convo._id, convo.otherUserName || '');
  } catch (e) { showToast(e.message,'err'); }
}
async function loadDmConversations() {
  const list = document.getElementById('dmConvoItems');
  try {
    const convos = await req('/api/dm/conversations','GET',null,true);
    const totalUnread = convos.reduce((s,c)=>s+(c.unreadCount||0),0);
    const badge = document.getElementById('dmUnreadBadge');
    if (badge) {
      if (totalUnread > 0) { badge.style.display='inline-block'; badge.textContent = totalUnread; }
      else badge.style.display = 'none';
    }
    if (!convos.length) { list.innerHTML = '<div class="chat-empty" style="padding:16px">No conversations yet. Message someone from Group Chat\'s member list.</div>'; return; }
    list.innerHTML = convos.map(c => `
      <div class="chat-group-item" id="convoItem_${c._id}" onclick="openDmConversation('${c._id}','${esc(c.otherUserName).replace(/'/g,"\\'")}')">
        <div class="cgi-icon">${c.otherUserPicture ? `<img class="cgi-avatar" src="${esc(c.otherUserPicture)}" alt="${esc(c.otherUserName)}" loading="lazy"/>` : `<svg class="icon i-user" aria-hidden="true"><use href="#i-user"/></svg>`}</div>
        <div class="cgi-info">
          <div class="cgi-name">${esc(c.otherUserName)} ${c.unreadCount?`<span class="badge b-red" style="font-size:10px">${c.unreadCount}</span>`:''}</div>
          <div class="cgi-desc">${esc(c.lastMessageText || 'No messages yet')}</div>
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = `<div class="chat-empty" style="color:var(--red)">${e.message}</div>`; }
}
async function openDmConversation(id, name) {
  stopDmPolling();
  activeConvoId = id;
  lastDmTime = null;
  document.querySelectorAll('#dmConvoItems .chat-group-item').forEach(el => el.classList.remove('active'));
  document.getElementById('convoItem_' + id)?.classList.add('active');
  document.getElementById('dmHeader').querySelector('.chat-header-name').textContent = name;
  document.getElementById('dmInputRow').style.display = 'flex';
  document.getElementById('dmChatLayout')?.classList.add('mchat-open'); // mobile: swap list -> conversation view
  const box = document.getElementById('dmMessages');
  box.innerHTML = '<div class="spin" style="margin:20px auto"></div>';
  try {
    const messages = await req(`/api/dm/conversations/${id}/messages`,'GET',null,true);
    renderDmMessages(messages, true);
    req(`/api/dm/conversations/${id}/read`,'POST',{},true).catch(()=>{});
    startDmPolling();
  } catch (e) { box.innerHTML = `<div class="chat-empty" style="color:var(--red)">${e.message}</div>`; }
}
// Mobile back button — returns from a full-page conversation view to the list (group or DM).
// Desktop ignores this class entirely (both panes are always visible there).
function chatBackToList(mode) {
  if (mode === 'group') {
    document.getElementById('groupChatLayout')?.classList.remove('mchat-open');
    stopChatPolling();
  } else {
    document.getElementById('dmChatLayout')?.classList.remove('mchat-open');
    stopDmPolling();
  }
}
function renderDmMessages(messages, replace) {
  const box = document.getElementById('dmMessages');
  if (replace) box.innerHTML = '';
  if (replace && !messages.length) { box.innerHTML = '<div class="chat-empty">No messages yet — say hello!</div>'; return; }
  messages.forEach(m => {
    const mine = m.senderId === currentUser?.id || m.senderId?._id === currentUser?.id;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (mine ? 'mine' : 'theirs');
    const mediaHtml = renderChatAttachment(m);
    const avatar = mine ? '' : chatAvatarHtml(m.senderName, m.senderPicture);
    div.innerHTML = `
      <div class="chat-msg-author">${avatar}${mine ? 'You' : esc(m.senderName)}</div>
      ${m.text ? `<div class="chat-msg-bubble">${esc(m.text)}</div>` : ''}
      ${mediaHtml}
      <div class="chat-msg-time">${new Date(m.createdAt).toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'})}</div>`;
    box.appendChild(div);
    lastDmTime = m.createdAt;
  });
  box.scrollTop = box.scrollHeight;
}
function startDmPolling() {
  dmPollTimer = setInterval(async () => {
    if (!activeConvoId) return;
    try {
      const url = `/api/dm/conversations/${activeConvoId}/messages` + (lastDmTime ? `?after=${encodeURIComponent(lastDmTime)}` : '');
      const messages = await req(url,'GET',null,true);
      if (messages.length) { renderDmMessages(messages, false); req(`/api/dm/conversations/${activeConvoId}/read`,'POST',{},true).catch(()=>{}); }
    } catch {}
  }, 4000);
}
function stopDmPolling() {
  if (dmPollTimer) { clearInterval(dmPollTimer); dmPollTimer = null; }
  activeConvoId = null;
}
function startDmListPolling() {
  dmListPollTimer = setInterval(() => loadDmConversations(), 10000);
}
function stopDmListPolling() {
  if (dmListPollTimer) { clearInterval(dmListPollTimer); dmListPollTimer = null; }
}
let pendingDmFile = null;
async function sendDmMessage() {
  const input = document.getElementById('dmInput');
  const text = input.value.trim();
  if (!text && !pendingDmFile) return;
  if (!activeConvoId) return;
  const fileToSend = pendingDmFile;
  input.value = '';
  clearDmAttachment();
  try {
    let msg;
    if (fileToSend) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('attachment', fileToSend);
      const res = await fetch(`/api/dm/conversations/${activeConvoId}/messages`, { method:'POST', headers:{'Authorization':'Bearer '+token}, body: fd });
      msg = await res.json();
      if (!res.ok) throw new Error(msg.error||'Failed to send');
    } else {
      msg = await req(`/api/dm/conversations/${activeConvoId}/messages`,'POST',{text},true);
    }
    renderDmMessages([msg], false);
    loadDmConversations();
  } catch (e) { showToast(e.message,'err'); input.value = text; }
}
function clearDmAttachment() {
  pendingDmFile = null;
  const preview = document.getElementById('dmAttachPreview');
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
}
// ── GAMES: setup, leaderboard, modal control ──────────────────
let selectedGameMode = 'bot';
let currentGameKey = null;
let currentLeaderboardGame = 'space-shooter';
const GAME_META = {
 'space-shooter': { title: 'Void Interceptor', icon: '', hint: 'Move mouse / drag finger to steer · Click / tap to fire · Auto-fire also on' },
 'turbo-run': { title: 'Turbo Run', icon: '', hint: 'Move mouse / drag finger left-right to steer · Click / tap to boost nitro' },
 'base-defense': { title: 'Base Defense', icon: '', hint: 'Click / tap a lane to place or upgrade a turret · Survive every wave' }
};
async function initGames() {
  try {
    const data = await req('/api/games/my-id','GET',null,true);
    document.getElementById('myGameId').textContent = data.gameId || '—';
  } catch {}
  switchLeaderboard('space-shooter', document.querySelector('.lb-game-tab'));
}
function copyMyGameId() {
  const text = document.getElementById('myGameId').textContent;
  if (!text || text === '—') return;
 navigator.clipboard?.writeText(text).then(()=>showToast('Game ID copied! Share it in Group Chat ','ok'));
}
function switchLeaderboard(gameKey, btn) {
  currentLeaderboardGame = gameKey;
  document.querySelectorAll('.lb-game-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadLeaderboard();
}
async function loadLeaderboard() {
  const box = document.getElementById('leaderboardList');
  if (!box) return;
  box.innerHTML = '<div class="spin" style="margin:20px auto"></div>';
  try {
    const top = await req(`/api/games/leaderboard?game=${currentLeaderboardGame}`,'GET',null,true);
    if (!top.length) { box.innerHTML = '<div class="chat-empty">No scores yet — be the first! <svg class="icon i-rocket" aria-hidden="true"><use href="#i-rocket"/></svg></div>'; return; }
    const medalClass = i => i===0?'gold':i===1?'silver':i===2?'bronze':'';
    box.innerHTML = top.map((row,i) => `
      <div class="lb-row">
        <div class="lb-rank ${medalClass(i)}">${i+1}</div>
        <div>
          <div class="lb-name">${esc(row.name)}</div>
          <div class="lb-gameid">${esc(row.gameId||'')}</div>
        </div>
        <div class="lb-score">${fmtN(row.bestScore)} pts</div>
      </div>`).join('');
  } catch (e) { box.innerHTML = `<div class="chat-empty" style="color:var(--red)">${e.message}</div>`; }
}
function openGame(gameKey) {
  currentGameKey = gameKey;
  const meta = GAME_META[gameKey] || { title: 'Game' };
  document.getElementById('gameModalTitle').textContent = `${meta.icon||''} ${meta.title}`.trim();
  document.getElementById('gameModal').classList.add('open');
  restartGameSetup();
}
function closeGameModal() {
  stopGameLoop();
  document.getElementById('gameModal').classList.remove('open');
}
function restartGameSetup() {
  stopGameLoop();
  document.getElementById('gameSetupScreen').style.display = 'block';
  document.getElementById('gameCanvas').style.display = 'none';
  document.getElementById('gameOverScreen').style.display = 'none';
  document.getElementById('gameControlsHint').style.display = 'none';
  document.getElementById('gameScoreDisplay').textContent = '0';
  selectGameMode('bot');
  selectDifficulty('easy');
}
function selectGameMode(mode) {
  selectedGameMode = mode;
  document.getElementById('modeBot').classList.toggle('active', mode==='bot');
  document.getElementById('modeBattle').classList.toggle('active', mode==='battle');
  document.getElementById('battleIdRow').style.display = mode==='battle' ? 'block' : 'none';
}
let selectedDifficulty = 'easy';
function selectDifficulty(diff) {
  selectedDifficulty = diff;
  document.getElementById('diffEasy').classList.toggle('active', diff==='easy');
  document.getElementById('diffHard').classList.toggle('active', diff==='hard');
  document.getElementById('diffHardest').classList.toggle('active', diff==='hardest');
}
async function startGame() {
  let battleCode = '';
  if (selectedGameMode === 'battle') {
    battleCode = document.getElementById('battleCodeInput').value.trim().toUpperCase();
    if (!battleCode) { showToast('Enter a battle code to challenge someone','err'); return; }
  }
  document.getElementById('gameSetupScreen').style.display = 'none';
  document.getElementById('gameCanvas').style.display = 'block';
  const hint = document.getElementById('gameControlsHint');
  hint.style.display = 'block';
  hint.textContent = (GAME_META[currentGameKey]||{}).hint || '';
  if (currentGameKey === 'space-shooter') startSpaceShooter(battleCode, selectedDifficulty);
  else if (currentGameKey === 'turbo-run') startTurboRun(battleCode, selectedDifficulty);
  else if (currentGameKey === 'base-defense') startBaseDefense(battleCode, selectedDifficulty);
}
async function finishGame(finalScore, battleCode) {
  document.getElementById('gameCanvas').style.display = 'none';
  document.getElementById('gameControlsHint').style.display = 'none';
  document.getElementById('gameOverScreen').style.display = 'block';
  document.getElementById('finalScore').textContent = fmtN(finalScore);
  const resultBox = document.getElementById('battleResultBox');
  resultBox.style.display = 'none';
  try {
    await req('/api/games/score','POST',{game:currentGameKey, mode: battleCode?'battle':'bot', score:finalScore, battleCode},true);
  } catch {}
  if (battleCode) {
    try {
      const rows = await req(`/api/games/battle/${encodeURIComponent(battleCode)}`,'GET',null,true);
      if (rows.length >= 2) {
        const sorted = rows.slice().sort((a,b)=>b.score-a.score);
        const iWon = sorted[0].name === currentUser?.name && sorted[0].score >= finalScore;
        resultBox.style.display = 'block';
        resultBox.innerHTML = `
          <div class="${iWon?'battle-result-win':'battle-result-lose'}">${iWon?'<svg class="icon i-trophy" aria-hidden="true"><use href="#i-trophy"/></svg> You\'re leading this battle!':'<svg class="icon i-gamepad" aria-hidden="true"><use href="#i-gamepad"/></svg> Battle in progress'}</div>
          ${sorted.slice(0,5).map(r=>`<div class="battle-result-row"><span>${esc(r.name)}</span><span>${fmtN(r.score)} pts</span></div>`).join('')}
        `;
      } else {
        resultBox.style.display = 'block';
        resultBox.innerHTML = `<div style="color:var(--t2);font-size:13px">Waiting for your opponent to play battle code <strong style="color:var(--gold)">${esc(battleCode)}</strong>...</div>`;
      }
    } catch {}
  }
  if (currentLeaderboardGame === currentGameKey) loadLeaderboard();
}
// ── THEME (light / dark, defaults to following local time of day) ─────────────────────
// First-time visitors get a theme that matches their actual clock — dark in the evening/night,
// light during the day — instead of just picking once based on OS preference and freezing there.
// Anyone who's manually toggled it keeps their explicit choice; this auto-behavior only applies
// until someone overrides it.
function timeBasedTheme() {
  const hour = new Date().getHours();
  return (hour >= 19 || hour < 7) ? 'dark' : 'light'; // 7pm–7am = dark, 7am–7pm = light
}
function getThemePref() {
  return 'dark'; // Marvel Nums is dark-only (matches the neon artwork + polish styles)
}
function getEffectiveTheme(pref) { return pref === 'light' ? 'light' : 'dark'; }
function applyTheme(pref) {
  const effective = getEffectiveTheme(pref);
  document.documentElement.setAttribute('data-theme', effective);
  const icon = document.getElementById('themeBtnIcon');
  if (icon) {
    // Moon icon when it's currently dark (tap to go light); sun icon when currently light (tap to go dark)
    icon.innerHTML = effective === 'dark'
      ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor"/>'
      : '<circle cx="12" cy="12" r="4.6" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></g>';
  }
  const mBtn = document.getElementById('mThemeToggle');
  if (mBtn) mBtn.innerHTML = effective === 'dark'
    ? '<svg class="icon i-moon" aria-hidden="true"><use href="#i-moon"/></svg>'
    : '<svg class="icon i-zap" aria-hidden="true"><use href="#i-zap"/></svg>'; // sun stand-in — reuses existing icon set
}
function toggleThemeSimple() {
  return; // dark-only: toggle disabled
  const next = getThemePref() === 'light' ? 'dark' : 'light';
  localStorage.setItem('ksl_theme', next); // an explicit manual choice from here on — time-based auto-switching stops applying
  applyTheme(next);
}
function initTheme() {
  applyTheme(getThemePref());
  // Only re-check on a timer if there's no manual override — otherwise a manual choice could get
  // silently flipped back by the clock while someone's still using the site.
  setInterval(() => {
    if (!localStorage.getItem('ksl_theme')) applyTheme(getThemePref());
  }, 10 * 60 * 1000); // every 10 minutes so a day/night boundary is caught promptly
  // The device clock can also jump (travel, timezone change, manual clock edit) — react to that
  // immediately instead of waiting for the next poll.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !localStorage.getItem('ksl_theme')) applyTheme(getThemePref());
  });
}
// ── NOTIFICATIONS ──────────────────────────────────────────────
async function loadNotifications() {
  if (!token) return;
  try {
    const data = await req('/api/user/notifications','GET',null,true);
    const badge = document.getElementById('notifBadge');
    if (data.count > 0) { badge.style.display='flex'; badge.textContent = data.count > 9 ? '9+' : data.count; }
    else { badge.style.display='none'; }
    renderNotifications(data.items || []);
  } catch {}
}
function renderNotifications(items) {
  const list = document.getElementById('notifList');
  if (!items.length) { list.innerHTML = '<div class="notif-empty">No new notifications</div>'; return; }
  list.innerHTML = items.map(n => `
    <div class="notif-item"${n.link ? ` onclick="window.location.href='${encodeURI(String(n.link)).replace(/'/g, '%27')}'" style="cursor:pointer"` : ''}>
      <div class="notif-item-title">${esc(n.title)}</div>
      <div class="notif-item-msg">${esc(n.message)}</div>
      <div class="notif-item-time">${new Date(n.createdAt).toLocaleString('en-NG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
    </div>`).join('');
}
function toggleNotifMenu() {
  const menu = document.getElementById('notifMenu');
  const opening = !menu.classList.contains('open');
  menu.classList.toggle('open');
  if (opening) {
    // mark as seen shortly after opening so the badge clears once they've had a chance to look
    setTimeout(async () => {
      try { await req('/api/user/notifications/mark-seen','POST',{},true); document.getElementById('notifBadge').style.display='none'; } catch {}
    }, 1500);
  }
}
let notifPageItems = [];
async function loadNotificationsPage() {
  const list = document.getElementById('notifPageList');
  list.innerHTML = '<div class="spin" style="margin:30px auto"></div>';
  try {
    const data = await req('/api/user/notifications', 'GET', null, true);
    notifPageItems = data.items || [];
    document.getElementById('notifBadge').style.display = 'none';
    req('/api/user/notifications/mark-seen', 'POST', {}, true).catch(() => {});
    if (!notifPageItems.length) {
      list.innerHTML = '<div class="empty-state"><div class="es-icon"><svg class="icon i-bell" aria-hidden="true"><use href="#i-bell"/></svg></div><div class="es-title">No notifications yet</div></div>';
      return;
    }
    list.innerHTML = `<div class="txn-wrap">${notifPageItems.map((n, i) => `
      <div class="txn-item" onclick="openNotifDetail(${i})">
        <div class="txn-ic ${n.type}">${n.title.match(/^\S+/)?.[0] || '<svg class="icon i-bell" aria-hidden="true"><use href="#i-bell"/></svg>'}</div>
        <div class="txn-info">
          <div class="txn-desc">${esc(n.title.replace(/^\S+\s/, ''))}</div>
          <div class="txn-date">${esc(n.message.slice(0, 60))}${n.message.length > 60 ? '…' : ''}</div>
        </div>
        <div class="txn-right">
          <div class="txn-date">${new Date(n.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</div>
        </div>
      </div>
    `).join('')}</div>`;
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><div class="es-sub" style="color:var(--red)">Failed to load notifications</div></div>`;
  }
}
function openNotifDetail(i) {
  const n = notifPageItems[i];
  if (!n) return;
  document.getElementById('notifDetailTitle').textContent = n.title;
  document.getElementById('notifDetailTime').textContent = new Date(n.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('notifDetailMsg').textContent = n.message;
  document.getElementById('notifDetailModal').classList.add('open');
}
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.notif-wrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('notifMenu')?.classList.remove('open');
});
// ── PAGE ROUTER ────────────────────────────────────────────────
function showPage(p, opts) {
  openFakeLoad(() => showPageReal(p, opts));
}
function showPageReal(p, opts) {
  opts = opts || {};
  // The old embedded #page-home fragment is retired — every logged-in visitor's "Home" now
  // means the real dashboard. This is the single choke point every Home link/button goes
  // through (nav-brand, nav-link, bottom tab, or any other showPage('home') call), so fixing
  // it here fixes "Home" everywhere at once instead of patching each call-site individually.
  if (p === 'home' && token) { window.location.href = '/dashboard'; return; }
  // 'groups' and 'dm' are routed as separate URLs but both render the shared #page-chat markup;
  // switchChatMode() flips which half of that markup is visible.
  const isChatSubPage = (p === 'groups' || p === 'dm');
  const domPage = isChatSubPage ? 'chat' : ((p === 'market2' || p === 'market3') ? 'market' : p);
  const el = document.getElementById('page-' + domPage);
  if (!el) {
    // SAFETY NET: never blank the screen. Standalone HTML files only contain their own
    // .page div; if the requested page does not exist in this document we keep whatever
    // page this file ships with visible instead of hiding everything.
    const fallback = document.querySelector('.page');
    if (fallback) fallback.classList.add('active');
    console.warn('[router] no #page-' + domPage + ' in this document — keeping current page visible');
    return;
  }
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  // Pages that require a logged-in account to view (browsing listings requires login/signup)
  const requiresAuth = ['home','market','market2','market3','tools','deposit','wallet','purchases','transactions','settings','chat','games','groups','dm','referrals','notifications','numberhistory'];
  if (requiresAuth.includes(p) && !token) {
    showToast('Please login or create an account to browse Marvel Nums','err');
    const welcomeEl = document.getElementById('page-welcome');
    if (welcomeEl) welcomeEl.classList.add('active');
    if (!opts.fromPopstate) updateUrl('welcome', opts.replace);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  startPageLoadBar();
  // Leaving chat page — stop polling for new messages
  if (currentPage === 'chat' && domPage !== 'chat') stopChatPolling();
  if (currentPage === 'deposit' && domPage !== 'deposit') stopDepositPolling();
  currentPage = domPage;
  el.classList.add('active');
  closeDropdowns();
  if (p === 'register') prefillReferralField();
  closeMobile();
  updateBottomTabbar(domPage);
  if (!opts.fromPopstate) updateUrl(p, opts.replace);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadAds();
  const pageLoaders = {
    home:         initHome,
    market:       () => loadMarket('all'),
    market2:      () => window.initMarket2?.(),
    market3:      () => window.initMarket3?.(),
    tools:        loadTools,
    deposit:      loadDeposit,
    wallet:       () => (window.KLSWallet ? window.KLSWallet.load() : null),
    purchases:    loadPurchases,
    transactions: loadTxns,
    notifications: loadNotificationsPage,
    referrals:    loadReferrals,
    chat:         initChat,
    groups:       () => { switchChatMode('group'); return initChat(); },
    dm:           () => switchChatMode('dm'),
    games:        initGames,
    settings:     initSettings,
  };
  const loader = pageLoaders[p];
  // Await the page's own loader (if it returns a promise) so the bar finishes exactly when the
  // new page's content is actually ready — falls back to a short fixed delay for pages with no
  // loader (e.g. static pages like Terms) so the bar never gets stuck mid-way.
  return Promise.resolve(loader ? loader() : null)
    .catch(() => {})
    .finally(finishPageLoadBar);
}
// ── PAGE LOAD BAR ──────────────────────────────────────────────
let pageLoadBarTimer = null;
function startPageLoadBar() {
  const bar = document.getElementById('pageLoadBar');
  if (!bar) return;
  clearTimeout(pageLoadBarTimer);
  bar.classList.remove('done', 'hide');
  // Force reflow so re-triggering the animation works even on rapid successive navigations
  void bar.offsetWidth;
  bar.classList.add('loading');
  // Safety net: never let the bar hang indefinitely if a page loader errors silently
  pageLoadBarTimer = setTimeout(finishPageLoadBar, 4000);
}
function finishPageLoadBar() {
  const bar = document.getElementById('pageLoadBar');
  if (!bar) return;
  clearTimeout(pageLoadBarTimer);
  bar.classList.remove('loading');
  bar.classList.add('done');
  setTimeout(() => bar.classList.add('hide'), 180);
  setTimeout(() => bar.classList.remove('done', 'hide'), 400);
}
// Pushes (or replaces) the browser URL to match the given internal page name, without reloading the page.
function updateUrl(p, replace) {
  const path = pathForPage(p);
  if (window.location.pathname === path) return;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ page: p }, '', path);
}
function updateBottomTabbar(p) {
  // Matches the new 5-item nav shared with /dashboard: Home, Marketplace, Wallet, Chat, Profile.
  const map = {
    home:'btHome', market:'btMarket', tools:'btMarket', wallet:'btWallet', deposit:'btWallet',
    chat:'btChat', groups:'btChat', dm:'btChat',
    settings:'btProfile', purchases:'btProfile', transactions:'btProfile', referrals:'btProfile', notifications:'btProfile',
  };
  document.querySelectorAll('.bt-item').forEach(el => el.classList.remove('active'));
  const id = map[p];
  if (id) document.getElementById(id)?.classList.add('active');
}
// ── NAV ────────────────────────────────────────────────────────
function updateNav() {
  updateCommunityFab();
  const guest = document.getElementById('navGuest');
  const user  = document.getElementById('navUser');
  const avatarWrap = document.getElementById('navAvatarWrap');
  const notifWrap = document.getElementById('notifWrap');
  const mAuth = document.getElementById('mobileAuth');
  const mUser = document.getElementById('mobileUser');
  // Some standalone pages (e.g. game.html) use a stripped-down navbar without these elements —
  // bail out gracefully instead of throwing, since there's nothing meaningful to update there.
  if (!guest || !user) return;
  const hamburgerBtn = document.getElementById('hamburger');
  const bottomTabbar = document.getElementById('bottomTabbar');
  if (token && currentUser) {
    guest.style.display='none'; user.style.display='flex';
    if (hamburgerBtn) hamburgerBtn.style.display='';
    if (bottomTabbar) bottomTabbar.style.display='';
    document.body.classList.remove('logged-out');
    if (avatarWrap) avatarWrap.style.display='block';
    if (notifWrap) notifWrap.style.display='block';
    if (mAuth) mAuth.style.display='none';
    if (mUser) mUser.style.display='block';
    const navBalance = document.getElementById('navBalance');
    const navInitial = document.getElementById('navInitial');
    const dropName = document.getElementById('dropName');
    const dropEmail = document.getElementById('dropEmail');
    if (navBalance) navBalance.textContent = fmt(currentUser.balance||0);
    if (navInitial) navInitial.textContent = (currentUser.name||'U')[0].toUpperCase();
    if (dropName) dropName.textContent   = currentUser.name;
    if (dropEmail) dropEmail.textContent  = currentUser.email;
    const navImg = document.getElementById('navAvatarImg');
    const navInit = document.getElementById('navInitial');
    const dropImg = document.getElementById('dropAvatarImg');
    if (currentUser.profilePicture) {
      if (navImg) { navImg.src = currentUser.profilePicture; navImg.style.display='block'; }
      if (navInit) navInit.style.display='none';
      if (dropImg) { dropImg.src = currentUser.profilePicture; dropImg.style.display='block'; }
    } else {
      if (navImg) navImg.style.display='none';
      if (navInit) navInit.style.display='block';
      if (dropImg) dropImg.style.display='none';
    }
    loadNotifications();
  } else {
    guest.style.display='flex'; user.style.display='none';
    if (hamburgerBtn) hamburgerBtn.style.display='none';
    if (bottomTabbar) bottomTabbar.style.display='none';
    document.body.classList.add('logged-out');
    if (avatarWrap) avatarWrap.style.display='none';
    if (notifWrap) notifWrap.style.display='none';
    if (mAuth) mAuth.style.display='block';
    if (mUser) mUser.style.display='none';
  }
}
function toggleUserMenu() { document.getElementById('navDropdown').classList.toggle('open'); }
function closeDropdowns() { document.getElementById('navDropdown')?.classList.remove('open'); }
document.addEventListener('click', e => { if (!e.target.closest('.nav-avatar-wrap')) closeDropdowns(); });
let mobileOpen=false;
let scrollLockY = 0;
function lockBodyScroll() {
  scrollLockY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollLockY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
}
function unlockBodyScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, scrollLockY);
}
function toggleMobile() {
  mobileOpen=!mobileOpen;
  document.getElementById('mobileMenu')?.classList.toggle('open', mobileOpen);
  document.getElementById('drawerBackdrop')?.classList.toggle('open', mobileOpen);
  if (mobileOpen) lockBodyScroll(); else unlockBodyScroll();
  const icon=document.getElementById('btMenuIcon');
 if (icon) icon.textContent = mobileOpen ? '' : '';
  document.getElementById('btMenu')?.classList.toggle('active', mobileOpen);
}
function closeMobile() {
  mobileOpen=false;
  document.getElementById('mobileMenu')?.classList.remove('open');
  document.getElementById('drawerBackdrop')?.classList.remove('open');
  unlockBodyScroll();
  const icon=document.getElementById('btMenuIcon');
 if (icon) icon.textContent = '';
  document.getElementById('btMenu')?.classList.remove('active');
}
// Safety net: any tap on a link/button inside the mobile menu closes it immediately,
// even if that element's own onclick forgot to call closeMobile().
document.addEventListener('click', e => {
  const menu=document.getElementById('mobileMenu');
  if (menu && menu.classList.contains('open') && e.target.closest('#mobileMenu a, #mobileMenu button:not(.drawer-close)')) {
    closeMobile();
  }
});
// ── AUTH ───────────────────────────────────────────────────────
async function register() {
  const name=v('regName'),email=v('regEmail'),pass=v('regPass'),confirm=v('regConfirm');
  const fb=document.getElementById('regFeedback'), btn=document.getElementById('regBtn');
  const agreedTerms=document.getElementById('regTerms')?.checked;
  if (!name||!email||!pass||!confirm) return setFb(fb,'All fields are required','err');
  if (pass!==confirm) return setFb(fb,'Passwords do not match','err');
  if (pass.length<6)  return setFb(fb,'Password must be at least 6 characters','err');
  if (!agreedTerms) return setFb(fb,'You must agree to the Terms & Conditions to create an account','err');
  btn.disabled=true; btn.textContent='Creating account...'; setFb(fb,'','');
  try {
    const refCode = document.getElementById('regRefCode')?.value.trim() || undefined;
    // International phone + country come from the searchable pickers (js/country-select.js)
    const phoneApi = document.getElementById('regPhoneWrap')?.klsCountry;
    const countryApi = document.getElementById('regCountry')?.klsCountry;
    const phoneVal = phoneApi ? phoneApi.value() : null;
    const phone = phoneVal && phoneVal.national ? phoneVal.national : undefined;
    const phoneCountry = phoneVal && phoneVal.country ? phoneVal.country : undefined;
    const country = (countryApi && countryApi.value().country) || phoneCountry;
    const language = (window.KLSi18n && window.KLSi18n.current) || 'en';
    if (phone && phoneVal && !phoneVal.valid) { btn.disabled=false; btn.textContent='Create My Account'; return setFb(fb,'Please enter a valid phone number for the selected country','err'); }
    const data = await req('/api/auth/register','POST',{name,email,password:pass,refCode,phone,phoneCountry,country,language});
    localStorage.removeItem('ksl_ref');
    saveSession(data); setFb(fb,' Account created! Redirecting...','ok');
 showToast(' Account created! You\'ve agreed to our Terms & Conditions.','ok');
    setTimeout(()=>{
      afterAuthSuccess();
    },900);
  } catch(e) { setFb(fb,e.message,'err'); btn.disabled=false; btn.textContent='Create Account'; }
}
async function login() {
  const email=v('loginEmail'),pass=v('loginPass');
  const fb=document.getElementById('loginFeedback'),btn=document.getElementById('loginBtn');
  if (!email||!pass) return setFb(fb,'Enter email and password','err');
  btn.disabled=true; btn.textContent='Logging in…'; setFb(fb,'','');
  try {
    const data = await req('/api/auth/login','POST',{email,password:pass});
    saveSession(data); setFb(fb,' Logged in!','ok');
    setTimeout(()=>{ afterAuthSuccess(); },600);
  } catch(e) {
    setFb(fb, e.restricted ? e.message : e.message, 'err');
    btn.disabled=false; btn.textContent='Login to Account';
  }
}
function logout() {
  // Tell the server to retire this device's session row so it stops showing up in
  // Settings → Devices. Fire-and-forget: a failure here must never block signing out.
  try { req('/api/auth/logout','POST',null,true,false,true).catch(()=>{}); } catch {}
  localStorage.removeItem('ksl_token'); localStorage.removeItem('ksl_user');
  token=null; currentUser=null; updateNav(); showPage('welcome'); showToast('Logged out');
}
function saveSession(data) {
  token=data.token; currentUser=data.user;
  localStorage.setItem('ksl_token',token); localStorage.setItem('ksl_user',JSON.stringify(currentUser));
  updateNav();
}
// ── GOOGLE SIGN-IN — REDIRECT FLOW ─────────────────────────────
// Uses a full-page redirect to Google's own consent screen (via the server's /auth/google route)
// instead of the old popup + postMessage relay. The popup approach left a blank stranded tab in
// many mobile in-app browsers because the popup couldn't message its result back to the opener.
function startGoogleRegister() {
  const agreed = document.getElementById('regTerms')?.checked;
  if (!agreed) {
    showToast('Please tick "I agree to the Terms & Conditions" first','err');
    return;
  }
  const refCode = document.getElementById('regRefCode')?.value.trim() || localStorage.getItem('ksl_ref');
  window.location.href = '/auth/google?agreedTerms=1' + (refCode ? `&ref=${encodeURIComponent(refCode)}` : '');
}
// Runs once on every page load — picks up the one-time login code (or error) that
// /auth/google/callback attaches to the URL after the user finishes on Google's side.
async function handleGoogleRedirectResult() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('googleLoginCode');
  const errorReason = params.get('googleLoginError');
  const errorMsg = params.get('googleLoginMsg');
  if (!code && !errorReason) return;
  // Strip these query params from the URL immediately so refreshing/sharing the link can't replay them
  const cleanUrl = window.location.pathname;
  history.replaceState({ page: pageForPath(window.location.pathname) }, '', cleanUrl);
  if (errorReason) {
    if (errorReason === 'terms') {
      showToast('Please tick "I agree to the Terms & Conditions" below, then try Google Sign-In again','err');
      showPage('register');
    } else if (errorReason === 'restricted') {
 showToast(' ' + (errorMsg || 'Your account has been restricted.'), 'err');
    } else {
      showToast(' ' + (errorMsg || 'Google sign-in failed'), 'err');
    }
    return;
  }
  try {
    const data = await req('/api/auth/google/exchange','POST',{ code });
    localStorage.removeItem('ksl_ref');
    saveSession(data);
    if (data.isNewUser) {
 showToast(' Account created with Google! You\'ve agreed to our Terms & Conditions.','ok');
      setTimeout(()=>{ afterAuthSuccess(); },900);
    } else {
      showToast(' Signed in with Google!','ok');
      afterAuthSuccess();
    }
  } catch (e) {
    showToast(' ' + e.message, 'err');
  }
}
async function changePassword() {
  const oldP=v('oldPass'),newP=v('newPass'),conP=v('confirmPass');
  const fb=document.getElementById('settingsFeedback');
  if (!oldP||!newP||!conP) return setFb(fb,'Fill all fields','err');
  if (newP!==conP) return setFb(fb,'New passwords do not match','err');
  try {
    const d=await req('/api/auth/reset-password','POST',{oldPassword:oldP,newPassword:newP},true);
    setFb(fb,' '+d.message,'ok');
    ['oldPass','newPass','confirmPass'].forEach(id=>document.getElementById(id).value='');
  } catch(e) { setFb(fb,e.message,'err'); }
}
// ── SETTINGS PAGE ─────────────────────────────────────────────
function initSettings() {
  if (!currentUser) return;
  document.getElementById('settingsName').value = currentUser.name || '';
  document.getElementById('settingsEmail').value = currentUser.email || '';
  document.getElementById('settingsAvatarPreview').src = currentUser.profilePicture || DEFAULT_AVATAR_SVG;
  const isGoogle = currentUser.authProvider === 'google';
  document.getElementById('passwordCard').style.display = isGoogle ? 'none' : 'block';
  document.getElementById('setPasswordCard').style.display = isGoogle ? 'block' : 'none';
  // Phone field
  const phoneEl = document.getElementById('settingsPhone');
  if (phoneEl) phoneEl.value = currentUser.contactPhone || '';
}
async function updateProfile() {
  const name=v('settingsName'), email=v('settingsEmail');
  const fb=document.getElementById('profileFeedback');
  if (!name || !email) return setFb(fb,'Name and email are required','err');
  try {
    const d = await req('/api/user/profile','PUT',{name,email},true);
    currentUser = d.user;
    localStorage.setItem('ksl_user', JSON.stringify(currentUser));
    updateNav();
    setFb(fb,' '+d.message,'ok');
  } catch(e) { setFb(fb,e.message,'err'); }
}
async function uploadProfilePic() {
  const input = document.getElementById('profilePicInput');
  const file = input.files[0];
  const fb = document.getElementById('picFeedback');
  if (!file) return;
  if (file.size > 5*1024*1024) { setFb(fb,'File too large — max 5MB','err'); return; }
  const fd = new FormData();
  fd.append('picture', file);
  setFb(fb,'Uploading...','');
  try {
    const res = await fetch('/api/user/profile-picture', { method:'POST', headers:{'Authorization':'Bearer '+token}, body: fd });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error||'Upload failed');
    currentUser.profilePicture = d.profilePicture;
    localStorage.setItem('ksl_user', JSON.stringify(currentUser));
    document.getElementById('settingsAvatarPreview').src = d.profilePicture;
    updateNav();
    setFb(fb,' '+d.message,'ok');
  } catch(e) { setFb(fb,e.message,'err'); }
  input.value = '';
}
async function setPassword() {
  const newP=v('setNewPass'), conP=v('setConfirmPass');
  const fb=document.getElementById('setPasswordFeedback');
  if (!newP||!conP) return setFb(fb,'Fill all fields','err');
  if (newP!==conP) return setFb(fb,'Passwords do not match','err');
  if (newP.length<6) return setFb(fb,'Minimum 6 characters','err');
  try {
    const d = await req('/api/auth/set-password','POST',{newPassword:newP},true);
    setFb(fb,d.message,'ok');
    ['setNewPass','setConfirmPass'].forEach(id=>document.getElementById(id).value='');
  } catch(e) { setFb(fb,e.message,'err'); }
}
// ── API KEY MANAGEMENT ────────────────────────────────────────
// ── API DOCS PAGE ────────────────────────────────────────────
// ── HOME ───────────────────────────────────────────────────────
async function initHome() {
  try {
    const [logs,tools,stats] = await Promise.all([req('/api/logs?type=log','GET',null,true),req('/api/logs?type=tool','GET',null,true),req('/api/public/stats','GET',null,false).catch(()=>null)]);
    document.getElementById('homeStatLogs').textContent = (logs.length+tools.length)||'—';
    if (stats) document.getElementById('homeStatUsers').textContent = Number(stats.totalUsers||0).toLocaleString('en-NG');
    document.getElementById('homeGrid').innerHTML = logs.slice(0,4).length ? logs.slice(0,4).map(renderCard).join('') : '<div class="no-items">No listings yet</div>';
    document.getElementById('homeToolsGrid').innerHTML = tools.slice(0,4).length ? tools.slice(0,4).map(renderCard).join('') : '<div class="no-items">No tools yet</div>';
    renderHomeCategories(logs);
  } catch(e) { document.getElementById('homeGrid').innerHTML='<div class="no-items">Failed to load — check your connection.<br/><button class="btn-secondary" style="margin-top:10px" onclick="initHome()"><svg class="icon i-refresh" aria-hidden="true"><use href="#i-refresh"/></svg> Retry</button></div>'; }
  loadTopBuyers();
  loadActiveNow();
  loadLiveStats();
  loadHomeBadgesPreview();
}
// Builds the homepage's category tiles plus one section per category (Login, Server, WhatsApp,
// whatever the admin has created). Purely presentational — it reuses the /api/logs data already
// fetched above, so no extra requests and no API changes.
// Friendly category URL builder — /logs/whatsapp instead of /marketplace?category=WhatsApp.
// Purely a link format; the pages still filter with the same API data.
function logsCatUrl(name) {
  const slug = String(name || '').toLowerCase().trim()
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? '/logs/' + slug : '/logs';
}
function renderHomeCategories(logs) {
  const tiles = document.getElementById('homeCatTiles');
  const sections = document.getElementById('homeCategorySections');
  const byCat = {};
  (logs || []).forEach(l => { if (l.category) (byCat[l.category] = byCat[l.category] || []).push(l); });
  const names = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);
  if (tiles) {
    tiles.innerHTML = names.length
      ? names.map(n => `<a class="cat-tile" href="${logsCatUrl(n)}">${typeof catIconHtml === 'function' ? catIconHtml(n) : ''} <span>${esc(n)}</span><span class="cat-tile-count">${byCat[n].length}</span></a>`).join('')
      : '<div class="no-items">Categories coming soon</div>';
  }
  if (sections) {
    sections.innerHTML = names.slice(0, 6).map(n => `
      <section class="latest-section">
        <div class="section-wrap">
          <div class="sec-row">
            <div>
              <div class="sec-label">${esc(n)}</div>
              <h2 class="sec-h2">${esc(n)} logs</h2>
            </div>
            <button class="sec-more" onclick="window.location.href='${logsCatUrl(n)}'">View All <svg class="icon i-arrow-right" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>
          </div>
          <div class="cards-grid">${byCat[n].slice(0, 4).map(renderCard).join('')}</div>
        </div>
      </section>`).join('');
  }
}
// Compact badges showcase on Home — shows all enabled badges, dimmed if not yet earned by this user
async function loadHomeBadgesPreview() {
  const el = document.getElementById('homeBadgesPreview');
  if (!el) return;
  try {
    const [mine, all] = await Promise.all([
      req('/api/badges/mine', 'GET', null, true).catch(() => []),
      req('/api/badges', 'GET', null, true)
    ]);
    const earnedIds = new Set(mine.map(b => b._id));
    if (!all.length) { el.innerHTML = '<p style="color:var(--t2);font-size:.9rem">Badges coming soon.</p>'; return; }
    el.innerHTML = all.slice(0, 8).map(b => {
      const earned = earnedIds.has(b._id);
      return `<div title="${esc(b.description || '')}" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 14px;border-radius:var(--r12);border:1px solid var(--border);background:${earned ? 'var(--card2)' : 'var(--bg3)'};opacity:${earned ? '1' : '.4'};min-width:80px">
        <span style="font-size:26px">${esc(b.icon)}</span>
        <span style="font-size:11px;font-weight:700;text-align:center;color:${earned ? 'var(--t1)' : 'var(--t2)'}">${esc(b.name)}</span>
      </div>`;
    }).join('');
  } catch (e) { el.innerHTML = ''; }
}
// Users active in the last 24 hours — shown on Home (avatars strip) and used to fill the
// "Active Now" stat in the hero. Names are masked the same way as Top Buyers for privacy.
async function loadActiveNow() {
  const strip = document.getElementById('activeNowStrip');
  const statEl = document.getElementById('homeStatActiveNow');
  try {
    const data = await req('/api/active-users', 'GET', null, true, false, true); // silent — decorative, fails gracefully
    if (statEl) statEl.textContent = data.count;
    if (!strip) return;
    if (!data.count) { strip.style.display = 'none'; return; }
    strip.style.display = 'block';
    document.getElementById('activeNowCount').textContent = data.count;
    const shown = data.users.slice(0, 12);
    const avatarsHtml = shown.map(u => {
      const initial = esc((u.name || '?')[0].toUpperCase());
      return u.profilePicture
        ? `<img src="${esc(u.profilePicture)}" class="an-avatar" title="${esc(maskName(u.name))}" onerror="this.outerHTML='<div class=&quot;an-avatar-fallback&quot;>${initial}</div>'"/>`
        : `<div class="an-avatar-fallback" title="${esc(maskName(u.name))}">${initial}</div>`;
    }).join('');
    const extra = data.count - shown.length;
    document.getElementById('activeNowAvatars').innerHTML = avatarsHtml + (extra > 0 ? `<div class="an-more">+${extra}</div>` : '');
  } catch (e) {
    if (strip) strip.style.display = 'none';
  }
}
// ── LIVE ACTIVITY (rolling last 24 hours) ───────────────────────────────
// Public social proof: how many purchases and deposits happened recently.
// Renders into the home page strip and the logged-out welcome strip (ids suffixed with W).
function lsCompact(n) {
  n = Number(n || 0);
  if (n >= 1000000) return '₦' + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
  if (n >= 1000) return '₦' + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'K';
  return '₦' + n.toLocaleString('en-NG');
}
function lsAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm ago';
}
async function loadLiveStats() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  try {
    const d = await req('/api/public/live-stats', 'GET', null, false, false, true); // silent — decorative
    const hrs = Number(d.windowHours || 24);
    document.querySelectorAll('.ls-title').forEach(el => { el.textContent = 'Activity in the last ' + hrs + ' hours'; });
    ['', 'W'].forEach(sfx => {
      set('lsPurchases' + sfx, Number(d.purchases.count || 0).toLocaleString('en-NG'));
      set('lsPurchaseVol' + sfx, lsCompact(d.purchases.volume));
      set('lsDeposits' + sfx, Number(d.deposits.count || 0).toLocaleString('en-NG'));
      set('lsDepositVol' + sfx, lsCompact(d.deposits.volume));
      const feed = document.getElementById('lsFeed' + sfx);
      if (!feed) return;
      if (!d.feed || !d.feed.length) {
        feed.innerHTML = '<div class="ls-row" style="justify-content:center;color:var(--t2)">No activity in the last 24 hours — be the first today.</div>';
        return;
      }
      feed.innerHTML = d.feed.map(f => `<div class="ls-row">
        <span class="ls-tag ${f.type === 'deposit' ? 'dep' : 'buy'}">${f.type === 'deposit' ? 'DEPOSIT' : 'PURCHASE'}</span>
        <span><b>${esc(f.name)}</b> ${f.type === 'deposit' ? 'funded' : 'spent'} ${esc(lsCompact(f.amount))}</span>
        <span class="ls-when">${esc(lsAgo(f.at))}</span>
      </div>`).join('');
    });
  } catch (e) { /* strip keeps its placeholders */ }
}
setInterval(() => { if (document.getElementById('lsFeed') || document.getElementById('lsFeedW')) loadLiveStats(); }, 60000);
async function loadTopBuyers() {
  const box = document.getElementById('topBuyersList');
  if (!box) return;
  try {
    const top = await req('/api/top-buyers','GET',null,true,false,true); // silent — decorative, fails gracefully
    if (!top.length) { box.innerHTML = '<div class="no-items">No purchases yet — be our first top buyer! <svg class="icon i-trophy" aria-hidden="true"><use href="#i-trophy"/></svg></div>'; return; }
    const medalClass = i => i===0?'gold':i===1?'silver':i===2?'bronze':'';
    box.innerHTML = top.map((b,i) => {
      const avatar = b.profilePicture
        ? `<img src="${esc(b.profilePicture)}" class="tb-avatar" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="tb-avatar tb-avatar-fallback" style="display:none">${esc((b.name||'?')[0].toUpperCase())}</div>`
        : `<div class="tb-avatar tb-avatar-fallback">${esc((b.name||'?')[0].toUpperCase())}</div>`;
      return `
      <div class="tb-card">
        <div class="lb-rank ${medalClass(i)}">${i+1}</div>
        ${avatar}
        <div class="tb-info">
          <div class="tb-name">${esc(maskName(b.name))}</div>
          <div class="tb-count">${b.purchaseCount} purchase${b.purchaseCount===1?'':'s'}</div>
        </div>
        <div class="tb-spent">${P(b.totalSpent)}</div>
      </div>`;
    }).join('');
  } catch { box.innerHTML = '<div class="no-items">Failed to load</div>'; }
}
function maskName(name) {
  if (!name) return 'Anonymous';
  const parts = name.trim().split(' ');
  return parts.map(p => p.length > 2 ? p[0] + '***' + p[p.length-1] : p).join(' ');
}
// ── MARKET ─────────────────────────────────────────────────────
const CATEGORY_ICONS = {
 'Facebook':'at-sign','Instagram':'image','Twitter':'message-circle','TikTok':'music','Snapchat':'ghost','Pinterest':'pin',
 'WhatsApp':'message-circle','Telegram':'rocket','Discord':'message-circle','Slack':'message-circle',
 'Gmail':'mail','Yahoo Mail':'mail','Outlook':'mail',
 'LinkedIn':'users','GitHub':'link','Reddit':'message-circle',
 'Spotify':'music','Apple Music':'music','Netflix':'disc','Disney+':'disc',
 'PayPal':'wallet','Stripe':'credit-card','Square':'credit-card',
 'VPN':'shield','Proxy Accounts':'globe','Google Voice (Old)':'phone','Google Voice (New)':'phone',
 'Apple iCloud':'cloud','TextPlus':'message-circle','Telegram Bot':'bot','Crypto Wallets':'key',
 'General':'folder','Other':'flag'
};
function catIconHtml(name) {
  const id = CATEGORY_ICONS[name] || 'flag';
  return `<svg class="icon i-${id}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
}
let marketCategoriesLoaded=false;
async function loadMarketCategories() {
  const menu=document.getElementById('catDropdownMenu');
  if (!menu) return;
  try {
    const cats = await req('/api/categories','GET',null,false); // always fetch fresh — never silent, so errors surface
    if (!Array.isArray(cats)) throw new Error('Bad response');
    menu.innerHTML = `<button class="cat-opt active" data-cat="all" onclick="filterMarket('all',this)"><svg class="icon i-folder-open" aria-hidden="true"><use href="#i-folder-open"/></svg> All Categories</button>` +
      cats.map(c => `<button class="cat-opt" data-cat="${esc(c.name)}" onclick="filterMarket('${esc(c.name).replace(/'/g,"\\'")}',this)">${catIconHtml(c.name)} ${esc(c.name)}</button>`).join('');
    marketCategoriesLoaded=true;
  } catch (e) {
    console.warn('Categories failed to load:', e.message);
    // Keep the "All Categories" default that's already in the HTML — graceful fallback
  }
}
function showMarket1Maintenance(msg) {
  document.querySelector('.mkt-toolbar')?.remove();
  document.getElementById('mktChips')?.remove();
  document.getElementById('mktResultCount')?.remove();
  const grid = document.getElementById('marketGrid');
  if (grid) {
    grid.innerHTML = '<div class="no-items" style="grid-column:1/-1;padding:50px 20px"><div style="font-size:40px">🛠️</div>' +
      '<h3 style="margin:10px 0">Under maintenance</h3><p>' + esc(msg || 'This marketplace is under maintenance. Please check back shortly.') + '</p></div>';
  }
}

async function loadMarket(catFilter) {
  const grid = document.getElementById('marketGrid');
  if (!grid) return false;
  grid.innerHTML = skeletons(6);
  if (!marketCategoriesLoaded) loadMarketCategories();
  try {
    const s = await req('/api/market/status', 'GET', null, false).catch(() => null);
    if (s && s.market1Enabled === false) {
      showMarket1Maintenance(s.maintenanceMessage);
      return false;
    }
    allMarketLogs = await req('/api/logs?type=log','GET',null,true);
    const filtered = catFilter==='all' ? allMarketLogs : allMarketLogs.filter(l=>l.category===catFilter);
    grid.innerHTML = filtered.length ? filtered.map(renderCard).join('') : '<div class="no-items">No listings in this category</div>';
    return true;
  } catch (e) {
    if (e.maintenance) {
      showMarket1Maintenance(e.message);
      return false;
    }
    grid.innerHTML = `<div class="no-items">Failed to load — check your connection.<br/><button class="btn-secondary" style="margin-top:10px" onclick="loadMarket('${catFilter}')"><svg class="icon i-refresh" aria-hidden="true"><use href="#i-refresh"/></svg> Retry</button></div>`;
    return false;
  }
}
function toggleCatDropdown() {
  document.getElementById('catDropdownMenu')?.classList.toggle('open');
  document.getElementById('catDropdownBtn')?.classList.toggle('open');
}
function closeCatDropdown() {
  document.getElementById('catDropdownMenu')?.classList.remove('open');
  document.getElementById('catDropdownBtn')?.classList.remove('open');
}
document.addEventListener('click', e => {
  const wrap = document.querySelector('.cat-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) closeCatDropdown();
});
function filterMarket(cat,btn) {
  document.querySelectorAll('.cat-opt').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('catDropdownLabel').textContent = btn.textContent;
  closeCatDropdown();
  loadMarket(cat);
}
// ── TOOLS ──────────────────────────────────────────────────────
async function loadTools() {
  const grid=document.getElementById('toolsGrid');
  grid.innerHTML=skeletons(4);
  try {
    const tools=await req('/api/logs?type=tool','GET',null,true);
    grid.innerHTML=tools.length?tools.map(renderCard).join(''):'<div class="no-items">No tools available yet</div>';
  } catch { grid.innerHTML=`<div class="no-items">Failed to load tools — check your connection.<br/><button class="btn-secondary" style="margin-top:10px" onclick="loadTools()"><svg class="icon i-refresh" aria-hidden="true"><use href="#i-refresh"/></svg> Retry</button></div>`; }
}
// ── CARD RENDER ────────────────────────────────────────────────
// "Notify Me" on a sold-out card/modal — one tap, then the button flips to a confirmed state.
async function notifyRestock(logId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }
  try {
    await req(`/api/logs/${logId}/notify-restock`, 'POST', {}, true);
 if (btn) { btn.textContent = ' We\'ll notify you'; btn.classList.add('notify-confirmed'); }
    showToast('You\'ll be notified when this is restocked', 'ok');
  } catch (e) {
 if (btn) { btn.disabled = false; btn.textContent = ' Notify Me'; }
    showToast(e.message || 'Failed to save', 'err');
  }
}
function renderCard(item) {
  const isTool=item.type==='tool';
  const isFolder=item.listingType==='folder';
  const soldOut = !!item.soldOut; // computed server-side for both folder and stock-counter listings
  const avg=avgRating(item.reviews);
  const remaining = isFolder
    ? `<div class="prod-qty" style="color:${item.soldOut?'var(--red)':'var(--green,#2ecc71)'}">${item.soldOut?'Sold Out':`${item.availableCount} available`}</div>`
    : isTool
    ? (item.toolQty>0 ? `<div class="prod-qty"><svg class="icon i-hash" aria-hidden="true"><use href="#i-hash"/></svg> ${Math.max(0,item.toolQty-(item.soldCount||0))} left</div>` : '<div class="prod-qty"><svg class="icon i-refresh" aria-hidden="true"><use href="#i-refresh"/></svg> Unlimited</div>')
    : (item.maxPurchases>0 ? `<div class="prod-qty" style="color:${soldOut?'var(--red)':'inherit'}">${soldOut?'Sold Out':`${Math.max(0,item.maxPurchases-(item.soldCount||0))} of ${item.maxPurchases} left`}</div>` : '');
  const imgHtml = item.picture
    ? `<div class="prod-img"><img src="${item.picture}" alt="${esc(item.title)}" loading="lazy" onerror="this.parentElement.outerHTML='<div class=\\'prod-img-ph\\'>${isTool?"<svg class='icon i-wrench' aria-hidden='true'><use href='#i-wrench'/></svg>":(isFolder?"<svg class='icon i-folder' aria-hidden='true'><use href='#i-folder'/></svg>":"<svg class='icon i-package' aria-hidden='true'><use href='#i-package'/></svg>")}</div>'"/></div>`
    : `<div class="prod-img-ph">${isTool?'<svg class="icon i-wrench" aria-hidden="true"><use href="#i-wrench"/></svg>':(isFolder?'<svg class="icon i-folder" aria-hidden="true"><use href="#i-folder"/></svg>':'<svg class="icon i-package" aria-hidden="true"><use href="#i-package"/></svg>')}</div>`;
  const priceHtml = isFolder
    ? (item.priceFrom!=null ? `${P(item.priceFrom)}<span style="font-size:11px;font-weight:400"> from</span>` : `<span style="color:var(--red)">Sold Out</span>`)
    : (soldOut ? `<span style="color:var(--red)">Sold Out</span>` : `${P(item.price)}`);
  // Once fully sold out (folder with zero sub-accounts left, or a stock-counter listing that hit
  // its cap), the card stays in the marketplace but swaps the Buy button for a disabled state plus
  // a small WhatsApp button so the customer can ask admin to restock instead of just bouncing.
  const restockMsg = encodeURIComponent(`Hi! "${item.title}" is showing Sold Out — can you restock it?`);
  const restockBtn = soldOut
    ? `<a href="https://wa.me/${WA_NUMBER}?text=${restockMsg}" target="_blank" class="prod-restock-btn" onclick="event.stopPropagation()"><svg class="icon i-message-circle" aria-hidden="true"><use href="#i-message-circle"/></svg> Contact Admin to Restock</a>
       <button type="button" class="prod-notify-btn" onclick="event.stopPropagation();notifyRestock('${item._id}',this)"><svg class="icon i-bell" aria-hidden="true"><use href="#i-bell"/></svg> Notify Me</button>`
    : '';
  return `<div class="prod-card-wrap">
    <div class="prod-card">
      <div class="prod-badge ${isTool?'tool-badge':''}">${isTool?'<svg class="icon i-wrench" aria-hidden="true"><use href="#i-wrench"/></svg> Tool':(isFolder?'<svg class="icon i-folder" aria-hidden="true"><use href="#i-folder"/></svg> '+item.category:item.category)}</div>
      ${imgHtml}
      <div class="prod-body">
        <div class="prod-cat ${isTool?'tool-cat':''}">${isTool?'Digital Tool':item.category}</div>
        <div class="prod-title">${esc(item.title)}</div>
        <div class="prod-desc">${esc(item.description)}</div>
        <div class="prod-footer">
          <div class="prod-price">${priceHtml}</div>
          <div class="prod-meta">
            ${(!isTool && avg)?`<div class="prod-rating"><svg class="icon i-star" aria-hidden="true"><use href="#i-star"/></svg> ${avg.toFixed(1)} (${(item.reviews||[]).length})</div>`:''}
            <div class="prod-sold">${item.soldCount||0} sold</div>
            ${remaining}
          </div>
        </div>
        <button class="prod-select-btn" ${soldOut?'disabled style="opacity:.5;cursor:not-allowed"':''} onclick="openModal('${item._id}')">${soldOut?'<svg class="icon i-x-circle" aria-hidden="true"><use href="#i-x-circle"/></svg> Sold Out':'<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy Now'}</button>
        ${restockBtn}
      </div>
    </div>
  </div>`;
}
function expandReview(logId, revIdx) {
  const item = modalCache[logId];
  if (!item || !item.reviews || !item.reviews[revIdx]) return;
  const r = item.reviews[revIdx];
  let contentHtml = '';
  if (r.reviewType === 'image' && r.content) {
    contentHtml = `<img src="${esc(r.content)}" alt="Review" style="max-width:100%;max-height:400px;border-radius:8px" onerror="this.parentElement.textContent='Image failed to load'"/>`;
  } else if (r.reviewType === 'video' && r.content) {
    contentHtml = `<video src="${esc(r.content)}" controls style="max-width:100%;max-height:400px;border-radius:8px"></video>`;
  } else if (r.reviewType === 'link' && r.content) {
    contentHtml = `<a href="${esc(r.content)}" target="_blank" rel="noopener" class="review-link-btn"><svg class="icon i-link" aria-hidden="true"><use href="#i-link"/></svg> Open Link</a><input type="text" value="${esc(r.content)}" readonly style="width:100%;padding:8px;margin-top:8px;border:1px solid var(--bd);border-radius:4px" onclick="this.select();document.execCommand('copy')"/><span style="font-size:12px;color:var(--t2)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Click to copy link</span>`;
  } else {
    contentHtml = `<div style="padding:12px;background:var(--bg2);border-radius:6px;max-height:300px;overflow-y:auto">${esc(r.content)}</div>`;
  }
  const modal = document.createElement('div');
  modal.className = 'review-expand-modal';
  modal.innerHTML = `
    <div class="rem-overlay" onclick="this.parentElement.remove()"></div>
    <div class="rem-box">
      <button class="rem-close" onclick="this.parentElement.parentElement.remove()"><svg class="icon i-x" aria-hidden="true"><use href="#i-x"/></svg></button>
      <div class="rem-header">
        <div><svg class="icon i-user" aria-hidden="true"><use href="#i-user"/></svg> ${esc(r.userName)}</div>
        <div>${renderStars(r.rating)}</div>
      </div>
      <div class="rem-date">${new Date(r.createdAt).toLocaleDateString('en-NG')}</div>
      <div class="rem-content">
        ${contentHtml}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
// ── MODAL ──────────────────────────────────────────────────────
let modalCache={};
async function openModal(id) {
  const overlay=document.getElementById('itemModal');
  const body=document.getElementById('modalBody');
  overlay.classList.add('open');
  body.innerHTML=`<div style="padding:50px;text-align:center"><div class="spin" style="margin:0 auto"></div></div>`;
  try {
    const item=modalCache[id]||await req(`/api/logs/${id}`,'GET',null,true);
    modalCache[id]=item;
    const isTool=item.type==='tool';
    const isFolder=item.listingType==='folder';
    if (isFolder) return renderFolderModal(item, body);
    const avg=avgRating(item.reviews);
    const soldOut = isTool
      ? (item.toolQty>0 && item.soldCount>=item.toolQty)
      : (item.maxPurchases>0 && item.soldCount>=item.maxPurchases);
    const qtyLine = isTool
      ? `<div class="m-qty">${item.toolQty>0?`<svg class="icon i-hash" aria-hidden="true"><use href="#i-hash"/></svg> ${Math.max(0,item.toolQty-(item.soldCount||0))} remaining`:'<svg class="icon i-refresh" aria-hidden="true"><use href="#i-refresh"/></svg> Unlimited uses'}</div>`
      : `<div class="m-qty" style="color:var(--red)">${item.maxPurchases>0?`<svg class="icon i-hash" aria-hidden="true"><use href="#i-hash"/></svg> ${Math.max(0,item.maxPurchases-(item.soldCount||0))} of ${item.maxPurchases} available`:''}</div>`;
    const imgHtml=item.picture?`<img class="m-img" src="${item.picture}" alt="${esc(item.title)}" onerror="this.style.display='none'"/>`:'' ;
    let actionHtml;
    if (!token) {
      actionHtml=`<button class="m-buy-btn" onclick="closeModal();showPage('login')"><svg class="icon i-lock" aria-hidden="true"><use href="#i-lock"/></svg> Login to Buy</button>`;
    } else if (soldOut) {
      const restockMsg = encodeURIComponent(`Hi! "${item.title}" is showing Sold Out — can you restock it?`);
      actionHtml=`<button class="m-buy-btn" disabled style="opacity:.5;cursor:not-allowed"><svg class="icon i-x-circle" aria-hidden="true"><use href="#i-x-circle"/></svg> Sold Out</button>
        <a href="https://wa.me/${WA_NUMBER}?text=${restockMsg}" target="_blank" class="prod-restock-btn" style="margin-top:10px"><svg class="icon i-message-circle" aria-hidden="true"><use href="#i-message-circle"/></svg> Contact Admin to Restock</a>
        <button type="button" class="prod-notify-btn" style="margin-top:8px;width:100%" onclick="notifyRestock('${id}',this)"><svg class="icon i-bell" aria-hidden="true"><use href="#i-bell"/></svg> Notify Me When Back in Stock</button>`;
    } else {
      actionHtml=`<button class="m-buy-btn" id="mbuyBtn" onclick="buyItem('${id}')">
 Buy Now — ${P(item.price)}
      </button>
      <div class="m-bal-note">Your balance: ${P2(currentUser?.balance||0)}
        ${(currentUser?.balance||0)<item.price?` — <a href="#" onclick="closeModal();showPage('deposit')" style="color:var(--gold)">Deposit funds</a>`:''}
      </div>`;
    }
    const reviews = isTool ? '' : buildReviewsHtml(item);
    const adminReviewHtml = (isTool || item.listingType === 'folder') ? '' : buildAdminReviewHtml(item.adminReview);
    body.innerHTML=`${imgHtml}<div class="m-body">
      <div class="m-cat ${isTool?'tool':''}">${isTool?'<svg class="icon i-wrench" aria-hidden="true"><use href="#i-wrench"/></svg> Digital Tool':item.category}</div>
      <div class="m-title">${esc(item.title)}</div>
      <div class="m-desc">${esc(item.description)}</div>
      <div class="m-price">${P(item.price)}</div>
      <div class="m-meta-row">
        <div class="m-sold"><svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> ${item.soldCount||0} sold</div>
        ${(!isTool && avg)?`<div class="m-rating"><svg class="icon i-star" aria-hidden="true"><use href="#i-star"/></svg> ${avg.toFixed(1)} (${(item.reviews||[]).length})</div>`:''}
        ${qtyLine}
      </div>
      ${buildTutorialButtonHtml(item.tutorial)}
      ${actionHtml}
      ${adminReviewHtml}
      ${reviews}
    </div>`;
  } catch(e) {
    body.innerHTML=`<div style="padding:32px;color:var(--red);text-align:center">${e.message}</div>`;
  }
}
function buildReviewsHtml(item) {
  const list=(item.reviews||[]).slice().reverse().slice(0,5);
  return `<div class="m-reviews"><h4><svg class="icon i-star" aria-hidden="true"><use href="#i-star"/></svg> Reviews (${(item.reviews||[]).length})</h4>
    ${list.length?list.map(r=>{
      let contentHtml = '';
      if (r.reviewType === 'image' && r.content) {
        contentHtml = `<div class="ri-content ri-image"><img src="${esc(r.content)}" alt="Review" style="max-width:100%;max-height:200px;border-radius:6px" onerror="this.style.display='none'"/></div>`;
      } else if (r.reviewType === 'video' && r.content) {
        contentHtml = `<div class="ri-content ri-video"><video src="${esc(r.content)}" controls style="max-width:100%;max-height:200px;border-radius:6px"></video></div>`;
      } else if (r.reviewType === 'link' && r.content) {
        contentHtml = `<div class="ri-content ri-link"><a href="${esc(r.content)}" target="_blank" rel="noopener"><svg class="icon i-link" aria-hidden="true"><use href="#i-link"/></svg> ${esc(r.content)}</a></div>`;
      } else if (r.content) {
        contentHtml = `<div class="ri-comment">${esc(r.content)}</div>`;
      }
      return `
      <div class="review-item">
        <div class="ri-header"><div class="ri-name"><svg class="icon i-user" aria-hidden="true"><use href="#i-user"/></svg> ${esc(r.userName)}</div><div class="ri-stars">${renderStars(r.rating)}</div></div>
        <div class="ri-date">${new Date(r.createdAt).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</div>
        ${contentHtml}
      </div>`;
    }).join('')
    :'<div class="no-reviews">No reviews yet — be the first buyer!</div>'}
  </div>`;
}
function closeModal(e) {
  if (e && e.target!==document.getElementById('itemModal')) return;
  document.getElementById('itemModal').classList.remove('open');
}
// ── BUY ────────────────────────────────────────────────────────
async function buySubAccount(logId, subId, price) {
  if (!token) { closeModal(); showPage('login'); return; }
  if ((currentUser.balance||0) < price) {
    showToast('Insufficient balance! Deposit funds first.','err');
    document.getElementById('itemModal').classList.remove('open');
    showPage('deposit'); return;
  }
  if (!await kslConfirm(`Are you ready to make this purchase? ${P(price)} will be deducted from your wallet.`)) return;
  const btn=document.getElementById('subBuyBtnBottom');
  if (btn) { btn.disabled=true; btn.textContent='Processing...'; }
  try {
    const data=await req(`/api/logs/buy/${logId}`,'POST',{ subAccountId: subId },true);
    currentUser.balance=data.newBalance;
    localStorage.setItem('ksl_user',JSON.stringify(currentUser));
    updateNav(); delete modalCache[logId]; allMarketLogs=[];
    const detailBlock=`<div class="detail-box">
        <div class="detail-box-lbl"><svg class="icon i-lock" aria-hidden="true"><use href="#i-lock"/></svg> Your Account Details</div>
        <pre id="logDetailsPre_${subId}">${esc(data.logDetails)}</pre>
        <button class="trb-copy" onclick="copyText('logDetailsPre_${subId}',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy</button>
      </div>`;
    document.getElementById('modalBody').innerHTML = `<div class="m-body">
      <div class="m-title"><svg class="icon i-check-circle" aria-hidden="true"><use href="#i-check-circle"/></svg> ${esc(data.logTitle)}</div>
      <div style="color:var(--t2);font-size:13px;margin-bottom:10px">Purchased ${new Date(data.purchasedAt).toLocaleString('en-NG')}</div>
      ${detailBlock}
      <button class="m-buy-btn" onclick="closeModal();showPage('purchases')"><svg class="icon i-package" aria-hidden="true"><use href="#i-package"/></svg> View My Purchases</button>
    </div>`;
    showToast('Purchase successful!','ok');
  } catch(e) {
 if (btn) { btn.disabled=false; btn.textContent=` Buy Now — ${P(price)}`; }
    showToast(e.message,'err');
  }
}
let _selectedSubAccounts = new Map(); // subId -> { itemId, subId, price } — all currently checked rows in the open folder modal
function renderFolderModal(item, body) {
  const avatarHtml = item.picture
    ? `<img class="m-avatar" src="${item.picture}" alt="${esc(item.title)}" onerror="this.outerHTML='<div class=\\'m-avatar m-avatar-ph\\'><svg class=\\'icon i-folder\\' aria-hidden=\\'true\\'><use href=\\'#i-folder\\'/></svg></div>'"/>`
    : `<div class="m-avatar m-avatar-ph"><svg class="icon i-folder" aria-hidden="true"><use href="#i-folder"/></svg></div>`;
  _selectedSubAccounts = new Map();
  const availableSubs = (item.subAccounts||[]).filter(sa => !sa.sold);
  const rows = (item.subAccounts||[]).map(sa => {
    const hasReview = sa.adminReview && sa.adminReview.reviewType && sa.adminReview.reviewType !== 'none' && sa.adminReview.content;
    const hasTutorial = sa.tutorial && sa.tutorial.tutorialType && sa.tutorial.tutorialType !== 'none';
    // Rows previously showed sa.label as-is, which is sometimes the real account number itself
    // (admins are told they can type "the number itself" as the label). Showing that pre-purchase
    // exposes the account. Where a link/text review exists, show that instead — it's the whole
    // point of a review shown before buying, and it never leaks the actual account credentials.
    const displayLabel = (hasReview && (sa.adminReview.reviewType === 'link' || sa.adminReview.reviewType === 'text'))
 ? (sa.adminReview.reviewType === 'link' ? ' ' + sa.adminReview.content : sa.adminReview.content)
      : sa.label;
    // Copy + eye icons only appear together, and only when this account actually has a review —
    // if there's nothing to view, there's nothing worth copying either.
    let reviewBtn = '';
    if (hasReview) {
      const regId = registerReview(sa.adminReview);
      const copyBtn = `<button type="button" class="sa-row-icon-btn" title="Copy review" onclick="event.stopPropagation();copyRaw('${esc(sa.adminReview.content).replace(/'/g,"\\'")}',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg></button>`;
      const eyeBtn = `<button type="button" class="sa-row-icon-btn" title="View review" onclick="event.stopPropagation();openReviewViewer(${regId})"><svg class="icon i-eye" aria-hidden="true"><use href="#i-eye"/></svg></button>`;
      reviewBtn = copyBtn + eyeBtn;
    }
    const tutorialBtn = hasTutorial
      ? (() => { const regId = _tutorialRegistryNextId++; _tutorialRegistry[regId] = sa.tutorial;
          return `<button type="button" class="sa-row-icon-btn" title="View tutorial" onclick="event.stopPropagation();openTutorialViewer(${regId})"><svg class="icon i-book-open" aria-hidden="true"><use href="#i-book-open"/></svg></button>`; })()
      : '';
    if (sa.sold) {
      return `<div class="sa-row sa-row-sold">
        <div class="sa-row-main"><span class="sa-row-label">${esc(displayLabel)}</span><span class="sa-row-sold-tag"><svg class="icon i-x-circle" aria-hidden="true"><use href="#i-x-circle"/></svg> Sold</span></div>
      </div>`;
    }
    if (!token) {
      return `<div class="sa-row" onclick="closeModal();showPage('login')">
        <div class="sa-row-main"><span class="sa-row-label">${esc(displayLabel)}</span><span class="sa-row-price">${P(sa.price)}</span></div>
        <div class="sa-row-icons">${reviewBtn}${tutorialBtn}</div>
      </div>`;
    }
    return `<div class="sa-row" id="saRow_${sa._id}" onclick="toggleSubAccount('${item._id}','${sa._id}',${sa.price})">
      <input type="checkbox" name="saSelect" class="sa-row-radio" onclick="event.stopPropagation();toggleSubAccount('${item._id}','${sa._id}',${sa.price})"/>
      <div class="sa-row-main"><span class="sa-row-label">${esc(displayLabel)}</span><span class="sa-row-price">${P(sa.price)}</span></div>
      <div class="sa-row-icons">${reviewBtn}${tutorialBtn}</div>
    </div>`;
  }).join('');
  const allPrices = (item.subAccounts||[]).map(sa => sa.price).filter(p => p > 0);
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 0;
  const priceLabel = minPrice === maxPrice ? `${P(minPrice)}` : `From ${P(minPrice)}`;
  const restockMsg = encodeURIComponent(`Hi! "${item.title}" is showing Sold Out — can you restock it?`);
  const buyBtnHtml = !token
    ? `<button class="m-buy-btn btn-full" onclick="closeModal();showPage('login')"><svg class="icon i-lock" aria-hidden="true"><use href="#i-lock"/></svg> Login to Buy</button>`
    : availableSubs.length
      ? `<div id="subQtyBar" class="sa-qty-bar" style="display:none;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;margin-bottom:8px;border-radius:10px;background:var(--bg4);font-size:13.5px">
           <span id="subQtyCount">0 selected</span><span id="subQtyTotal" style="font-weight:700"></span>
         </div>
         <button class="m-buy-btn btn-full" id="subBuyBtnBottom" onclick="buySelectedSubAccounts()" disabled style="opacity:.5"><svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Select accounts to buy</button>`
      : `<button class="m-buy-btn btn-full" disabled style="opacity:.5"><svg class="icon i-x-circle" aria-hidden="true"><use href="#i-x-circle"/></svg> All Sold Out</button>
         <a href="https://wa.me/${WA_NUMBER}?text=${restockMsg}" target="_blank" class="prod-restock-btn" style="margin-top:10px"><svg class="icon i-message-circle" aria-hidden="true"><use href="#i-message-circle"/></svg> Contact Admin to Restock</a>
         <button type="button" class="prod-notify-btn" style="margin-top:8px;width:100%" onclick="notifyRestock('${item._id}',this)"><svg class="icon i-bell" aria-hidden="true"><use href="#i-bell"/></svg> Notify Me When Back in Stock</button>`;
  body.innerHTML = `<div class="m-body">
    <div class="m-avatar-title-row">
      ${avatarHtml}
      <div class="m-avatar-title-text">
        <div class="m-cat ${item.type==='tool'?'tool':''}" style="margin-bottom:2px"><svg class="icon i-folder" aria-hidden="true"><use href="#i-folder"/></svg> ${item.category}</div>
        <div class="m-title" style="margin:0">${esc(item.title)}</div>
      </div>
      ${buildTutorialButtonHtml(item.tutorial, true)}
    </div>
    <div class="m-desc">${esc(item.description)}</div>
    <div class="m-price-badge-row">
      <div class="m-price-badge">${priceLabel}</div>
      <div class="m-admin-badge"><svg class="icon i-crown" aria-hidden="true"><use href="#i-crown"/></svg> Admin <span class="m-verified"><svg class="icon i-check" aria-hidden="true"><use href="#i-check"/></svg></span></div>
    </div>
    <div class="m-divider"></div>
    <div class="m-meta-row"><div class="m-sold">${item.soldOut?'<svg class="icon i-x-circle" aria-hidden="true"><use href="#i-x-circle"/></svg> Sold Out':`<svg class="icon i-check-circle" aria-hidden="true"><use href="#i-check-circle"/></svg> Available: ${item.availableCount}`}</div></div>
    <div class="sa-row-list">${rows || '<div class="no-items">No sub-accounts available</div>'}</div>
    ${buyBtnHtml}
  </div>`;
}
function toggleSubAccount(itemId, subId, price) {
  const row = document.getElementById(`saRow_${subId}`);
  const checkbox = row ? row.querySelector('.sa-row-radio') : null;
  if (_selectedSubAccounts.has(subId)) {
    _selectedSubAccounts.delete(subId);
    if (row) row.classList.remove('sa-row-selected');
    if (checkbox) checkbox.checked = false;
  } else {
    _selectedSubAccounts.set(subId, { itemId, subId, price });
    if (row) row.classList.add('sa-row-selected');
    if (checkbox) checkbox.checked = true;
  }
  updateSubQtyBar();
}
function updateSubQtyBar() {
  const bar = document.getElementById('subQtyBar');
  const countEl = document.getElementById('subQtyCount');
  const totalEl = document.getElementById('subQtyTotal');
  const btn = document.getElementById('subBuyBtnBottom');
  const n = _selectedSubAccounts.size;
  let total = 0;
  for (const { price } of _selectedSubAccounts.values()) total += price;
  if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = `${n} selected`;
  if (totalEl) totalEl.textContent = n > 0 ? `${P(total)}` : '';
  if (btn) {
    if (n > 0) {
      btn.disabled = false; btn.style.opacity = '1';
      btn.innerHTML = `<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Buy ${n} Account${n>1?'s':''} — ${P(total)}`;
    } else {
      btn.disabled = true; btn.style.opacity = '.5';
      btn.innerHTML = `<svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Select accounts to buy`;
    }
  }
}
async function buySelectedSubAccounts() {
  if (!_selectedSubAccounts.size) return showToast('Select at least one account first', 'err');
  const items = [..._selectedSubAccounts.values()];
  const itemId = items[0].itemId;
  const total = items.reduce((s, i) => s + i.price, 0);
  if ((currentUser.balance||0) < total) {
    showToast('Insufficient balance! Deposit funds first.','err');
    document.getElementById('itemModal').classList.remove('open');
    showPage('deposit'); return;
  }
  if (!await kslConfirm(`Buy ${items.length} account${items.length>1?'s':''} for ${P(total)} total? This will be deducted from your wallet.`)) return;
  const btn = document.getElementById('subBuyBtnBottom');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
  try {
    const data = await req(`/api/logs/buy-multi/${itemId}`, 'POST', { subAccountIds: items.map(i => i.subId) }, true);
    currentUser.balance = data.newBalance;
    localStorage.setItem('ksl_user', JSON.stringify(currentUser));
    updateNav(); delete modalCache[itemId]; allMarketLogs = [];
    const detailBlocks = data.items.map((it, idx) => `<div class="detail-box" style="margin-bottom:12px">
        <div class="detail-box-lbl"><svg class="icon i-lock" aria-hidden="true"><use href="#i-lock"/></svg> ${esc(it.logTitle)}</div>
        <pre id="logDetailsPre_multi_${idx}">${esc(it.logDetails)}</pre>
        <button class="trb-copy" onclick="copyText('logDetailsPre_multi_${idx}',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy</button>
      </div>`).join('');
    document.getElementById('modalBody').innerHTML = `<div class="m-body">
      <div class="m-title"><svg class="icon i-check-circle" aria-hidden="true"><use href="#i-check-circle"/></svg> ${data.items.length} Accounts Purchased</div>
      <div style="color:var(--t2);font-size:13px;margin-bottom:10px">Total paid: ${P(data.total)}</div>
      ${detailBlocks}
      <button class="m-buy-btn" onclick="closeModal();showPage('purchases')"><svg class="icon i-package" aria-hidden="true"><use href="#i-package"/></svg> View My Purchases</button>
    </div>`;
    showToast('Purchase successful!','ok');
  } catch(e) {
    if (btn) { updateSubQtyBar(); }
    showToast(e.message,'err');
  }
}
async function buyItem(id) {
  if (!token) { closeModal(); showPage('login'); return; }
  const item=modalCache[id];
  if (!item) return;
  if ((currentUser.balance||0)<item.price) {
    showToast('Insufficient balance! Deposit funds first.','err');
    document.getElementById('itemModal').classList.remove('open');
    showPage('deposit'); return;
  }
  if (!await kslConfirm(`Are you ready to make this purchase? ${P(item.price)} will be deducted from your wallet.`)) return;
  const btn=document.getElementById('mbuyBtn');
  if (btn) { btn.disabled=true; btn.textContent='Processing...'; }
  try {
    const data=await req(`/api/logs/buy/${id}`,'POST',{},true);
    currentUser.balance=data.newBalance;
    localStorage.setItem('ksl_user',JSON.stringify(currentUser));
    updateNav(); delete modalCache[id]; allMarketLogs=[];
    const isTool=data.logType==='tool';
    const isFileDelivery = isTool && data.deliveryType==='file';
    const detailBlock=isTool
      ? (isFileDelivery
          ? `<div class="tool-reveal-box">
               <div class="trb-label"><svg class="icon i-folder" aria-hidden="true"><use href="#i-folder"/></svg> Your File</div>
               <a href="${esc(data.deliverableFile)}" download="${esc(data.deliverableFileName||'')}" class="trb-open"><svg class="icon i-arrow-down" aria-hidden="true"><use href="#i-arrow-down"/></svg> Download ${esc(data.deliverableFileName||'File')}</a>
             </div>`
          : `<div class="tool-reveal-box">
               <div class="trb-label"><svg class="icon i-wrench" aria-hidden="true"><use href="#i-wrench"/></svg> Your Tool Link</div>
               <div class="trb-link-wrap">
                 <input class="trb-input" type="text" value="${esc(data.toolLink)}" readonly id="toolLinkInput_${id}"/>
                 <button class="trb-copy" onclick="copyText('toolLinkInput_${id}',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy</button>
               </div>
               <a href="${esc(data.toolLink)}" target="_blank" class="trb-open"><svg class="icon i-rocket" aria-hidden="true"><use href="#i-rocket"/></svg> Open Tool</a>
             </div>`)
      : `<div class="detail-box">
           <div class="detail-box-lbl"><svg class="icon i-lock" aria-hidden="true"><use href="#i-lock"/></svg> Your Account Details</div>
           <pre id="logDetailsPre_${id}">${esc(data.logDetails)}</pre>
           <button class="copy-details-btn" onclick="copyText('logDetailsPre_${id}',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy Details</button>
         </div>`;
    const purchasedDate = data.purchasedAt ? new Date(data.purchasedAt).toLocaleString('en-NG',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    const receiptRow = data.purchaseId
      ? `<div class="purchase-id-row" style="justify-content:center;margin-top:10px">
           <span class="pid-tag"><svg class="icon i-receipt" aria-hidden="true"><use href="#i-receipt"/></svg> ${esc(data.purchaseId)}</span>
           ${purchasedDate?`<span><svg class="icon i-calendar" aria-hidden="true"><use href="#i-calendar"/></svg> ${esc(purchasedDate)}</span>`:''}
         </div>`
      : '';
    document.getElementById('modalBody').innerHTML=`<div class="m-body"><div class="success-wrap">
      <div class="success-icon"><svg class="icon i-sparkles" aria-hidden="true"><use href="#i-sparkles"/></svg></div>
      <h3>Purchase Successful!</h3>
      <p>New balance: <strong style="color:var(--gold)">${P2(data.newBalance)}</strong></p>
      ${detailBlock}
      ${receiptRow}
      <button class="btn-primary btn-full" onclick="closeModal();showPage('purchases')" style="margin-top:12px"><svg class="icon i-package" aria-hidden="true"><use href="#i-package"/></svg> View All Purchases</button>
      <a href="https://wa.me/${WA_NUMBER}" target="_blank" class="wa-support-link"><svg class="icon i-message-circle" aria-hidden="true"><use href="#i-message-circle"/></svg> Need help? WhatsApp us</a>
    </div></div>`;
 showToast('Purchase successful! ','ok');
  } catch(e) {
    showToast(e.message,'err');
 if (btn) { btn.disabled=false; btn.textContent=` Buy Now — ${P(item.price)}`; }
  }
}
// (Deposit logic — including refreshBalance() — lives further down, see "DEPOSIT — FLUTTERWAVE BANK TRANSFER" section)
// ── PURCHASES ──────────────────────────────────────────────────
async function loadPurchases() {
  const el=document.getElementById('purchasesList');
  el.innerHTML=`<div class="empty-state"><div class="spin" style="margin:0 auto 12px"></div></div>`;
  try {
    const list=await req('/api/user/purchases','GET',null,true);
    if (!list.length) {
      el.innerHTML=`<div class="empty-state"><div class="es-icon"><svg class="icon i-package" aria-hidden="true"><use href="#i-package"/></svg></div><div class="es-title">No purchases yet</div><div class="es-sub">Visit the marketplace!</div></div>`;
      return;
    }
    el.innerHTML=list.slice().reverse().map((p,i)=>buildPurchaseCard(p,i)).join('');
  } catch(e) { el.innerHTML=`<div class="empty-state"><div class="es-sub" style="color:var(--red)">${e.message}</div></div>`; }
}
function buildPurchaseCard(p,idx) {
  const isTool=p.logType==='tool';
  const isFileDelivery = isTool && p.deliveryType==='file';
  const dateStr=new Date(p.purchasedAt).toLocaleString('en-NG',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const purchaseId=p._id||'';
  const detailContent=isTool
    ? (isFileDelivery
        ? `<div class="tool-reveal-box">
             <div class="trb-label"><svg class="icon i-folder" aria-hidden="true"><use href="#i-folder"/></svg> Your File</div>
             <a href="${esc(p.deliverableFile||'#')}" download="${esc(p.deliverableFileName||'')}" class="trb-open"><svg class="icon i-arrow-down" aria-hidden="true"><use href="#i-arrow-down"/></svg> Download ${esc(p.deliverableFileName||'File')}</a>
           </div>`
        : `<div class="tool-reveal-box">
             <div class="trb-label"><svg class="icon i-wrench" aria-hidden="true"><use href="#i-wrench"/></svg> Tool Link</div>
             <div class="trb-link-wrap">
               <input class="trb-input" type="text" value="${esc(p.toolLink||'')}" readonly id="pcTool_${idx}"/>
               <button class="trb-copy" onclick="copyText('pcTool_${idx}',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy</button>
             </div>
             <a href="${esc(p.toolLink||'#')}" target="_blank" class="trb-open"><svg class="icon i-rocket" aria-hidden="true"><use href="#i-rocket"/></svg> Open Tool</a>
           </div>`)
    : `<div class="pc-details-wrap">
         <pre id="pcLog_${idx}" class="pc-details">${esc(p.logDetails||'No details available')}</pre>
         <button class="copy-details-btn" onclick="copyText('pcLog_${idx}',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy Details</button>
       </div>`;
  const copyHistoryBtn=`<button class="copy-history-btn" onclick="copyHistory(${idx},this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy Full Receipt</button>`;
  const reviewSection=p.logId?`
    <div class="review-prompt" id="revPrompt_${idx}">
      <p>Rate your purchase:</p>
      <div class="star-row" id="stars_${idx}" data-rating="0">
        ${[1,2,3,4,5].map(n=>`<button class="star-btn" onclick="setStar(${idx},${n})" data-val="${n}"><svg class="icon i-star" aria-hidden="true"><use href="#i-star"/></svg></button>`).join('')}
      </div>
      <div style="margin-top:10px">
        <label style="display:block;font-size:13px;color:var(--t2);margin-bottom:6px">Review Type — pick one:</label>
        <select id="revType_${idx}" onchange="toggleBuyerReviewFields(${idx})" style="width:100%;padding:8px;border:1px solid var(--bd);border-radius:4px;font-size:13px">
          <option value="text"><svg class="icon i-edit" aria-hidden="true"><use href="#i-edit"/></svg> Text Comment</option>
          <option value="image"><svg class="icon i-image" aria-hidden="true"><use href="#i-image"/></svg> Picture Upload</option>
          <option value="video"><svg class="icon i-video" aria-hidden="true"><use href="#i-video"/></svg> Video Upload</option>
          <option value="link"><svg class="icon i-link" aria-hidden="true"><use href="#i-link"/></svg> Link (proof or reference)</option>
        </select>
      </div>
      <textarea class="review-ta" id="revContent_${idx}" placeholder="Enter your review..." rows="2" style="margin-top:8px"></textarea>
      <input type="text" id="revLink_${idx}" placeholder="https://..." style="display:none;width:100%;padding:8px;margin-top:8px;border:1px solid var(--bd);border-radius:4px;font-size:13px"/>
      <input type="file" id="revFile_${idx}" accept="image/*" style="display:none;margin-top:8px;font-size:13px"/>
      <button class="btn-primary" style="font-size:13px;padding:8px 18px;margin-top:8px" onclick="submitReview('${p.logId}',${idx})">Submit Review</button>
      <input type="hidden" id="activeSubId_${idx}" value=""/>
      <div id="revFb_${idx}" class="form-feedback"></div>
    </div>`:'';
  return `<div class="purchase-card" id="pcCard_${idx}">
    <div class="pc-header">
      <div class="pc-title">${esc(p.logTitle)}</div>
      <div class="pc-price">${P(p.pricePaid)}</div>
    </div>
    <div class="pc-meta">
      <div class="pc-date"><svg class="icon i-calendar" aria-hidden="true"><use href="#i-calendar"/></svg> ${dateStr}</div>
      <div class="pc-type ${isTool?'tool':''}">${isTool?'<svg class="icon i-wrench" aria-hidden="true"><use href="#i-wrench"/></svg> Tool':'<svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Log'}</div>
    </div>
    <div class="purchase-id-row"><span class="pid-tag"><svg class="icon i-receipt" aria-hidden="true"><use href="#i-receipt"/></svg> ID: ${esc(purchaseId)}</span></div>
    ${detailContent}
    <div class="pc-actions">
      ${copyHistoryBtn}
      <a href="https://wa.me/${WA_NUMBER}" target="_blank" class="pc-wa-btn"><svg class="icon i-message-circle" aria-hidden="true"><use href="#i-message-circle"/></svg> Support</a>
    </div>
    ${reviewSection}
  </div>`;
}
function copyHistory(idx,btn) {
  const card=document.getElementById(`pcCard_${idx}`);
  const title=card.querySelector('.pc-title')?.textContent||'';
  const price=card.querySelector('.pc-price')?.textContent||'';
  const date=card.querySelector('.pc-date')?.textContent||'';
  const type=card.querySelector('.pc-type')?.textContent||'';
  const pid=card.querySelector('.pid-tag')?.textContent||'';
  const detailEl=card.querySelector('.pc-details')||card.querySelector('.trb-input');
  const details=detailEl?.textContent||detailEl?.value||'';
  const text=`═══════════════════════════
Marvel Nums
PURCHASE RECEIPT
═══════════════════════════
${pid.replace(' ','')}
Item:    ${title}
Price:   ${price}
Type:    ${type}
Date: ${date.replace(' ','')}
───────────────────────────
Details:
${details}
═══════════════════════════
Support: wa.me/${WA_NUMBER}`;
 copyRaw(text,btn,' Copy Full Receipt');
}
function setStar(idx,val) {
  document.querySelectorAll(`#stars_${idx} .star-btn`).forEach(b=>{
    b.style.opacity=parseInt(b.dataset.val)<=val?'1':'0.3';
  });
  document.getElementById(`stars_${idx}`).dataset.rating=val;
}
// Shows only the one input relevant to the selected review type — text, link, picture, or video (pick one per review)
function toggleBuyerReviewFields(idx) {
  const type=document.getElementById(`revType_${idx}`).value;
  const ta=document.getElementById(`revContent_${idx}`);
  const linkInput=document.getElementById(`revLink_${idx}`);
  const fileInput=document.getElementById(`revFile_${idx}`);
  ta.style.display = type==='text' ? 'block' : 'none';
  linkInput.style.display = type==='link' ? 'block' : 'none';
  fileInput.style.display = (type==='image'||type==='video') ? 'block' : 'none';
  if (fileInput) fileInput.accept = type==='video' ? 'video/*' : 'image/*';
}
async function submitReview(logId,idx) {
  const rating=parseInt(document.getElementById(`stars_${idx}`).dataset.rating||0);
  const reviewType=document.getElementById(`revType_${idx}`).value; // text, image, video, or link — one per review
  const fb=document.getElementById(`revFb_${idx}`);
  if (!rating) return setFb(fb,'Please select a star rating','err');
  const fd=new FormData();
  fd.append('rating',rating);
  fd.append('reviewType',reviewType);
  const subId=gv('activeSubId_'+idx);
  if (subId) fd.append('subAccountId',subId);
  if (reviewType==='text') {
    const content=document.getElementById(`revContent_${idx}`).value.trim();
    if (!content) return setFb(fb,'Please enter your review text','err');
    fd.append('content',content);
  } else if (reviewType==='link') {
    const content=document.getElementById(`revLink_${idx}`).value.trim();
    if (!content) return setFb(fb,'Please enter a link','err');
    fd.append('content',content);
  } else if (reviewType==='image'||reviewType==='video') {
    const file=document.getElementById(`revFile_${idx}`).files[0];
    if (!file) return setFb(fb,`Please choose a ${reviewType} file to upload`,'err');
    fd.append('reviewFile',file);
  }
  try {
    const d=await reqForm(`/api/logs/${logId}/review`,fd);
    setFb(fb,' '+d.message,'ok');
    document.getElementById(`revPrompt_${idx}`).innerHTML=`<div style="color:var(--green);font-size:13px;padding:10px 0"><svg class="icon i-check-circle" aria-hidden="true"><use href="#i-check-circle"/></svg> Review submitted — thank you!</div>`;
  } catch(e) { setFb(fb,e.message,'err'); }
}
// ── TRANSACTIONS ───────────────────────────────────────────────
let txnCurrentFilter = 'all';
async function loadTxns() {
  const el=document.getElementById('txnsList');
  el.innerHTML=`<div class="empty-state"><div class="spin" style="margin:0 auto 12px"></div></div>`;
  try {
    const list=await req('/api/user/transactions','GET',null,true);
    window._txnList=list;
    renderTxnList();
  } catch(e) { el.innerHTML=`<div class="empty-state"><div class="es-sub" style="color:var(--red)">${e.message}</div></div>`; }
}
function setTxnFilter(filter) {
  txnCurrentFilter = filter;
  document.querySelectorAll('.txn-seg-opt').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  const idx = ['all','deposit','purchase','other'].indexOf(filter);
  const thumb = document.getElementById('txnSegThumb');
  if (thumb) thumb.style.transform = `translateX(${idx * 100}%)`;
  renderTxnList();
}
function renderTxnList() {
  const el=document.getElementById('txnsList');
  const list = window._txnList || [];
  const filtered = txnCurrentFilter === 'all' ? list
    : txnCurrentFilter === 'other' ? list.filter(t => t.type !== 'deposit' && t.type !== 'purchase')
    : list.filter(t => t.type === txnCurrentFilter);
  if (!filtered.length) {
    el.innerHTML=`<div class="empty-state"><div class="es-icon"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg></div><div class="es-title">No transactions here yet</div></div>`;
    return;
  }
 const txnIconIds={deposit:'wallet',purchase:'cart',admin_credit:'gift',referral_commission:'users',refund:'refresh'};
  const txnIcon = (type) => { const id = txnIconIds[type] || 'banknote'; return `<svg class="icon i-${id}" aria-hidden="true"><use href="#i-${id}"/></svg>`; };
  const exportBtn=`<div style="text-align:right;margin-bottom:12px">
    <button class="copy-history-btn" onclick="exportAllTxns(this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy All Transactions</button>
  </div>`;
  el.innerHTML=exportBtn+`<div class="txn-wrap">${filtered.map((t)=>{
    const i = list.indexOf(t);
    return `
      <div class="txn-item" onclick="openTxnModal(${i})">
        <div class="txn-ic ${t.type}">${txnIcon(t.type)}</div>
        <div class="txn-info">
          <div class="txn-desc">${esc(t.description||t.type)}</div>
          <div class="txn-date">${new Date(t.createdAt).toLocaleString('en-NG',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <div class="txn-right">
          <div class="txn-amt ${t.type==='purchase'?'db':'cr'}">${t.type==='purchase'?'-':'+'}${P(t.amount)}</div>
          <button class="txn-copy-btn" onclick="event.stopPropagation();copyTxn(${i},this)" title="Copy"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg></button>
        </div>
      </div>`;
  }).join('')}</div>`;
}
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const wasOpen = item.classList.contains('open');
  document.querySelectorAll('#welcomeFaqList .faq-item.open').forEach(i => i.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}
function copyTxn(i,btn) {
  const t=window._txnList[i];
  const text=`Marvel Nums Transaction\n─────────────────\nType:   ${t.type}\nAmount: ${t.type==='purchase'?'-':'+'}${P(t.amount)}\nDesc:   ${t.description||t.type}\nDate:   ${new Date(t.createdAt).toLocaleString('en-NG')}\nStatus: ${t.status}`;
 copyRaw(text,btn,'');
}
function exportAllTxns(btn) {
  if (!window._txnList?.length) return;
  const header=`Marvel Nums\nTRANSACTION HISTORY EXPORT\nGenerated: ${new Date().toLocaleString('en-NG')}\n${'═'.repeat(50)}\n`;
  const rows=window._txnList.map((t,i)=>`${i+1}. ${new Date(t.createdAt).toLocaleString('en-NG')} | ${t.type.padEnd(14)} | ${t.type==='purchase'?'-':'+'}${P(t.amount)} | ${t.description||''}`).join('\n');
 copyRaw(header+rows,btn,' Copy All Transactions');
}
// ── Transaction receipt modal (click a row styled receipt download/share as image) ──
let txnReceiptDataUrl = null;
function openTxnModal(i) {
  const t = window._txnList?.[i];
  if (!t) return;
  drawTxnReceipt(t);
  document.getElementById('txnModal').classList.add('open');
}
function closeTxnModal() {
  document.getElementById('txnModal').classList.remove('open');
}
function drawTxnReceipt(t) {
  const wrap = document.getElementById('txnReceiptCanvasWrap');
  const W = 340, H = 560;
  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2; // 2x for crisp export
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const bg = isDark ? '#131320' : '#ffffff';
  const cardBorder = isDark ? '#2e2e42' : '#e2e2ec';
  const textMain = isDark ? '#eeeef5' : '#15151f';
  const textMuted = isDark ? '#8888a8' : '#55556e';
  const dividerColor = isDark ? '#2a2a3d' : '#eaeaf2';
  const isCredit = t.type !== 'purchase';
  const status = (t.status || 'success').toLowerCase();
  const isFailed = status === 'failed' || status === 'error';
  const isPending = status === 'pending';
  const statusColor = isFailed ? '#ff4757' : isPending ? '#ffa726' : '#00c853';
  // ── Card body with a scalloped ("torn receipt") bottom edge, classic paper-receipt look ──
  const scallopR = 7, scallopY = H - 46;
  const drawCardPath = () => {
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.arcTo(0, 0, 16, 0, 16);
    ctx.lineTo(W - 16, 0);
    ctx.arcTo(W, 0, W, 16, 16);
    ctx.lineTo(W, scallopY);
    for (let x = W; x > 0; x -= scallopR * 2) ctx.arc(x - scallopR, scallopY, scallopR, 0, Math.PI, false);
    ctx.lineTo(0, scallopY);
    ctx.closePath();
  };
  drawCardPath();
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = cardBorder; ctx.lineWidth = 1; ctx.stroke();
  // Brand header
  ctx.textAlign = 'center';
  ctx.fillStyle = textMuted; ctx.font = '700 12px "Plus Jakarta Sans", sans-serif';
 ctx.fillText(' Marvel Nums · KingBadBoi Log Sale', W / 2, 30);
  // Status icon circle (check / clock / cross, OPay-style)
  const iconCy = 80;
  ctx.beginPath(); ctx.arc(W / 2, iconCy, 30, 0, Math.PI * 2);
  ctx.fillStyle = statusColor + '22'; ctx.fill();
  ctx.beginPath(); ctx.arc(W / 2, iconCy, 30, 0, Math.PI * 2);
  ctx.strokeStyle = statusColor; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = statusColor; ctx.font = '700 28px sans-serif';
  ctx.textBaseline = 'middle';
 ctx.fillText(isFailed ? '' : isPending ? '⏱' : '', W / 2, iconCy + 2);
  ctx.textBaseline = 'alphabetic';
  // Status label + big amount, OPay-style: status first, amount large right under it
  ctx.fillStyle = statusColor; ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(isFailed ? 'Transaction Failed' : isPending ? 'Transaction Pending' : 'Transaction Successful', W / 2, 132);
  ctx.fillStyle = textMain; ctx.font = '800 32px Sora, sans-serif';
  ctx.fillText(`${isCredit ? '+' : '-'}${P(t.amount)}`, W / 2, 172);
  ctx.fillStyle = textMuted; ctx.font = '500 11.5px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(new Date(t.createdAt).toLocaleString('en-NG', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }), W / 2, 192);
  // Dashed divider (classic receipt perforation look)
  ctx.strokeStyle = dividerColor; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(24, 216); ctx.lineTo(W - 24, 216); ctx.stroke();
  ctx.setLineDash([]);
  // Detail rows — OPay-style side-by-side: label left (muted), value right-aligned (bold)
  const rows = [
    ['Transaction Type', (t.type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
    ['Description', t.description || '—'],
    ['Reference', (t._id || '').toString().slice(-12).toUpperCase()],
    ['Status', status.charAt(0).toUpperCase() + status.slice(1)]
  ];
  let y = 246;
  rows.forEach(([label, value]) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = textMuted; ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, 24, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = textMain; ctx.font = '600 12.5px "Plus Jakarta Sans", sans-serif';
    const wrapped = wrapCanvasText(ctx, String(value), 170);
    wrapped.forEach((line, li) => ctx.fillText(line, W - 24, y + li * 16));
    y += Math.max(28, wrapped.length * 16 + 12);
  });
  // Second dashed divider before footer
  ctx.strokeStyle = dividerColor; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(24, y + 6); ctx.lineTo(W - 24, y + 6); ctx.stroke();
  ctx.setLineDash([]);
  // Footer
  ctx.textAlign = 'center'; ctx.fillStyle = textMuted; ctx.font = '500 10px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('This is a system-generated receipt · No signature required', W / 2, y + 28);
  wrap.innerHTML = '';
  wrap.appendChild(canvas);
  txnReceiptDataUrl = canvas.toDataURL('image/png');
}
function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3); // cap at 3 lines so the layout never overflows
}
function downloadTxnReceipt() {
  if (!txnReceiptDataUrl) return;
  const a = document.createElement('a');
  a.href = txnReceiptDataUrl;
  a.download = `Marvel Nums-receipt-${Date.now()}.png`;
  a.click();
}
async function shareTxnReceipt() {
  if (!txnReceiptDataUrl) return;
  try {
    const res = await fetch(txnReceiptDataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'ksl-receipt.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Marvel Nums Receipt' });
    } else {
      downloadTxnReceipt();
      showToast('Sharing not supported on this device — downloaded instead');
    }
  } catch (e) { downloadTxnReceipt(); }
}
// ── AI SUPPORT WIDGET (floating button, available on every page) ──────
const AI_CHAT_QUICK_TOPICS = [
 { icon: 'wallet', label: 'Deposit', question: 'How do I deposit money?' },
 { icon: 'cart', label: 'Buy', question: 'How do I buy something?' },
 { icon: 'refresh', label: 'Refund', question: 'How do refunds work?' },
 { icon: 'users', label: 'Referral', question: 'How does the referral program work?' },
 { icon: 'plug', label: 'API', question: 'How do I use the API?' },
 { icon: 'smartphone', label: 'Numbers', question: 'Is Buy Numbers working yet?' }
];
function renderAiChatQuickTopics() {
  const wrap = document.getElementById('aiChatQuickTopics');
  if (!wrap || wrap.dataset.rendered) return;
  wrap.dataset.rendered = '1';
  wrap.innerHTML = AI_CHAT_QUICK_TOPICS.map((t, i) =>
    `<button type="button" onclick="sendAiChatQuickTopic(${i})" style="padding:6px 12px;border-radius:20px;background:var(--bg4);border:1px solid var(--border2);color:var(--t2);font-size:12px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px"><svg class="icon i-${t.icon}" aria-hidden="true"><use href="#i-${t.icon}"/></svg> ${t.label}</button>`
  ).join('');
}
function sendAiChatQuickTopic(i) {
  const topic = AI_CHAT_QUICK_TOPICS[i];
  if (!topic) return;
  document.getElementById('aiChatFabInput').value = topic.question;
  sendAiChatFab();
}
function toggleAiChatFab() {
  const overlay = document.getElementById('aiChatOverlay');
  const opening = !overlay.classList.contains('open');
  overlay.classList.toggle('open');
  renderAiChatQuickTopics();
  if (opening && !overlay.dataset.greeted) {
    overlay.dataset.greeted = '1';
    appendAiChatFabBubble("Hi! I'm the Marvel Nums Assistant. Ask me about deposits, purchases, refunds, referrals, the API, or anything else basic — I'll do my best to help. Or tap a topic below to get started.", 'bot');
  }
}
function appendAiChatFabBubble(text, who, isTyping) {
  const log = document.getElementById('aiChatFabLog');
  if (!log) return;
  const bubble = document.createElement('div');
  bubble.style.cssText = who === 'user'
    ? 'align-self:flex-end;background:var(--gold);color:#fff;padding:9px 13px;border-radius:14px 14px 2px 14px;max-width:85%;font-size:13.5px'
    : 'align-self:flex-start;background:var(--bg4);color:var(--t1);padding:9px 13px;border-radius:14px 14px 14px 2px;max-width:85%;font-size:13.5px';
  if (isTyping) {
    bubble.innerHTML = '<span class="ai-typing-dots"><span></span><span></span><span></span></span>';
  } else {
    bubble.textContent = text;
  }
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
  return bubble;
}
async function sendAiChatFab() {
  const input = document.getElementById('aiChatFabInput');
  const message = input.value.trim();
  if (!message) return;
  if (!localStorage.getItem('ksl_token')) {
    appendAiChatFabBubble(message, 'user');
    input.value = '';
    appendAiChatFabBubble('Please log in first so I can help with your account — tap here to log in.', 'bot');
    return;
  }
  appendAiChatFabBubble(message, 'user');
  input.value = '';
  const typingBubble = appendAiChatFabBubble(null, 'bot', true);
  try {
    const data = await req('/api/support/ai-chat', 'POST', { message }, true);
    typingBubble.textContent = data.reply;
  } catch (e) {
    typingBubble.textContent = "Sorry, I couldn't get a reply — please try WhatsApp support instead.";
  }
}
// ── SUPPORT ────────────────────────────────────────────────────
async function submitSupport() {
  const name=v('suppName'),email=v('suppEmail'),subject=v('suppSubject'),msg=v('suppMsg');
  const fb=document.getElementById('suppFeedback');
  if (!name||!email||!msg) return setFb(fb,'Name, email and message are required','err');
  try {
    const d=await req('/api/support','POST',{name,email,subject,message:msg,userId:currentUser?._id});
    setFb(fb,' '+d.message,'ok');
    ['suppName','suppEmail','suppSubject','suppMsg'].forEach(id=>document.getElementById(id).value='');
  } catch(e) { setFb(fb,e.message,'err'); }
}
// ── COPY UTILITIES ─────────────────────────────────────────────
function copyText(elId,btn) {
  const el=document.getElementById(elId);
  if (!el) return;
  const text=el.tagName==='INPUT'||el.tagName==='TEXTAREA'?el.value:el.textContent;
 copyRaw(text,btn,btn?.textContent||'');
}
function copyRaw(text,btn,origLabel) {
  const orig=btn?btn.textContent:origLabel;
  navigator.clipboard.writeText(text).then(()=>{
 if (btn) { btn.textContent=' Copied!'; setTimeout(()=>btn.textContent=orig,2000); }
  }).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
 if (btn) { btn.textContent=' Copied!'; setTimeout(()=>btn.textContent=orig,2000); }
  });
}
// ── API ─────────────────────────────────────────────────────────
// Retries only cover network-level failures (dropped connection, DNS blip, or the server not
// responding in time — e.g. right after a host cold-start) — never a real HTTP error response,
// since retrying a 400/401/404 would just get the same rejection again. This alone should clear
// up most of the intermittent "failed to load" reports: a single flaky request now quietly
// recovers instead of surfacing an error to the user.
async function fetchWithRetry(url, opts, retries = 3, timeoutMs = 25000) {
  // On slow connections (3G/2G Android), extend the timeout significantly.
  // navigator.connection is available on Android Chrome but not on iOS Safari.
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effectiveType = conn?.effectiveType || '4g';
 // Slow connection give each request more time before giving up
  if ((effectiveType === '2g' || effectiveType === 'slow-2g') && timeoutMs < 60000) timeoutMs = 60000;
  else if (effectiveType === '3g' && timeoutMs < 40000) timeoutMs = 40000;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (networkErr) {
      clearTimeout(timeoutId);
      if (attempt >= retries) throw networkErr;
      // Longer wait between retries on slow connections
      const baseDelay = effectiveType === '3g' ? 1500 : 800;
      await new Promise(r => setTimeout(r, baseDelay * (attempt + 1)));
    }
  }
}
// Fire-and-forget diagnostic report for a real failed request — never awaited, never lets a
// logging failure affect the actual user-facing error. Includes navigator.connection data where
// available (Chrome/Android exposes this; Safari/iOS doesn't) since that's the single most useful
// signal for telling "genuinely slow/unstable connection" apart from "a specific device/browser
// issue" — the two look identical from a single screenshot but very different in this data.
const _errReportSeen = new Map(); // key -> last sent timestamp
function reportClientError(message, url, status, contentType) {
  try {
    // If the device itself is offline, the report can't reach the server either — and every
    // queued request would fire one, flooding the log with duplicate "Failed to fetch" noise
    // that describes the user's connection, not a bug in the app. Skip it entirely.
    if (navigator.onLine === false) return;
    // Throttle: the same failure on the same URL is only reported once a minute, so one dead
    // connection with several polling requests doesn't produce a wall of identical entries.
    const key = `${url}|${message}`;
    const now = Date.now();
    if (now - (_errReportSeen.get(key) || 0) < 60000) return;
    _errReportSeen.set(key, now);
    if (_errReportSeen.size > 50) _errReportSeen.clear();

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    fetch('/api/client-error-log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message, url, status: status ?? null, contentType: contentType || null,
        connectionType: conn ? conn.effectiveType : null, downlinkMbps: conn ? conn.downlink : null,
        userAgent: navigator.userAgent
      })
    }).catch(() => {});
  } catch (e) { /* never let diagnostics break anything */ }
}
async function req(url,method='GET',body=null,auth=false,_isRetry=false,silent=false) {
  const _klsStarted = Date.now();
  console.log(`[Marvel Nums] → ${method} ${url}`);
  const headers={'Content-Type':'application/json'};
  if (auth&&token) headers['Authorization']=`Bearer ${token}`;
  const opts={method,headers,cache:'no-store'};
  if (body&&method!=='GET') opts.body=JSON.stringify(body);
  let res;
  try {
    res = await fetchWithRetry(url, opts);
  } catch (networkErr) {
    const offline = navigator.onLine === false;
    if (!silent && !offline) reportClientError(`req() network failure: ${networkErr.name} — ${networkErr.message}`, url, null, null);
    throw new Error(
      offline ? "You're offline — reconnect to the internet and try again"
        : networkErr.name === 'AbortError' ? 'Server is taking too long to respond — please try again'
          : 'Connection problem — check your internet and try again'
    );
  }
  console.log(`[Marvel Nums] ← ${method} ${url} ${res.status} ${Date.now()-_klsStarted}ms`);
  const contentType = res.headers.get('content-type') || '';
  let parseFailed = false;
  const data=await res.json().catch(() => { parseFailed = true; return {error:'Invalid server response'}; });
  if (parseFailed) {
    // Reached the server and got a 200 with the right Content-Type, but the body still didn't
    // parse as JSON — on a weak connection this is almost always the connection dropping partway
    // through downloading the response body, not a proxy substituting content (a substituted page
    // would normally show up as the wrong status or Content-Type, which this isn't). Worth one
    // retry of the whole request before giving up, since that's exactly the kind of transient
    // failure a retry recovers from — not just reporting it and leaving the user stuck.
    if (!_isRetry) return req(url, method, body, auth, true, silent);
    if (!silent) reportClientError('req(): response body did not parse as JSON after a retry (likely a dropped/incomplete connection, not a proxy)', url, res.status, contentType);
    throw new Error('Connection problem — check your internet and try again');
  }
  if (!res.ok) {
    if (data.restricted && token) {
      // Server says this authenticated account is restricted — force logout so they're not stuck browsing with a dead session
      localStorage.removeItem('ksl_token'); localStorage.removeItem('ksl_user');
      token=null; currentUser=null; updateNav();
      showPage('login');
 showToast(' Your account has been restricted. Contact support.','err');
    }
    const err = new Error(data.error||'Something went wrong');
    Object.assign(err, data); // carries through any extra flags the server sends (restricted, requiresTerms, etc.)
    throw err;
  }
  return data;
}
// Like req(), but for multipart/form-data submissions (file uploads) — always authenticated, no Content-Type header
// so the browser can set the correct multipart boundary itself.
async function reqForm(url,formData) {
  const headers={};
  if (token) headers['Authorization']=`Bearer ${token}`;
  let res;
  try {
    res = await fetchWithRetry(url, { method:'POST', headers, body: formData }, 1, 60000); // fewer retries, longer timeout — don't re-submit a big upload 3x, but don't cut off a legitimately slow one either
  } catch (networkErr) {
    throw new Error(networkErr.name === 'AbortError' ? 'Upload is taking too long — please try again' : 'Connection problem — check your internet and try again');
  }
  const data=await res.json().catch(()=>({error:'Invalid server response'}));
  if (!res.ok) {
    if (data.restricted && token) {
      localStorage.removeItem('ksl_token'); localStorage.removeItem('ksl_user');
      token=null; currentUser=null; updateNav();
      showPage('login');
 showToast(' Your account has been restricted. Contact support.','err');
    }
    const err = new Error(data.error||'Something went wrong');
    Object.assign(err, data);
    throw err;
  }
  return data;
}
function v(id) { return (document.getElementById(id)?.value||'').trim(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// ── CURRENCY ───────────────────────────────────────────────────────────────
// P()  = catalogue price (numbers, logs, tools, servers)
// P2() = balance / ledger amount with decimals
// Naira for Nigeria, US dollars for every other country. See js/money.js.
function P(n)  { return window.KLSMoney ? window.KLSMoney.price(n)  : fmtN(n); }
function P2(n) { return window.KLSMoney ? window.KLSMoney.amount(n) : fmt(n); }
function CUR() { return window.KLSMoney ? window.KLSMoney.currency() : 'NGN'; }
function fmt(n) { return window.KLSMoney ? window.KLSMoney.amount(n) : '₦' + Number(n||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtN(n){ return window.KLSMoney ? window.KLSMoney.price(n) : '₦' + Number(n||0).toLocaleString('en-NG'); }
// Naira-only figures (Nigeria bank-transfer fees, VA top-ups) keep these:
function fmtNGN(n) { return Number(n||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtNGNn(n){ return Number(n||0).toLocaleString('en-NG'); }
function setFb(el,msg,type){ if(!el)return; el.textContent=msg; el.className='form-feedback '+type; }
function skeletons(n){ return Array(n).fill('<div class="skeleton-card"></div>').join(''); }
// Renders the admin-authored "official" review (shown before purchase) with correct handling per media type
function buildAdminReviewHtml(ar) {
  if (!ar || !ar.reviewType || ar.reviewType === 'none' || !ar.content) {
    return `<div class="admin-review-box"><div class="admin-review-label"><svg class="icon i-star" aria-hidden="true"><use href="#i-star"/></svg> REVIEW</div><div class="admin-review-unavailable">Unavailable</div></div>`;
  }
  const ratingHtml = ar.rating ? `<span style="margin-left:8px">${renderStars(ar.rating)}</span>` : '';
  let body = '';
  if (ar.reviewType === 'image') {
    body = `<img src="${esc(ar.content)}" alt="Review" onerror="this.parentElement.textContent='Image failed to load'"/>`;
  } else if (ar.reviewType === 'video') {
    body = `<video src="${esc(ar.content)}" controls playsinline></video>`;
  } else if (ar.reviewType === 'link') {
    body = `<a href="${esc(ar.content)}" target="_blank" rel="noopener" class="review-link-btn"><svg class="icon i-link" aria-hidden="true"><use href="#i-link"/></svg> Open Link</a>
      <input type="text" value="${esc(ar.content)}" readonly style="width:100%;padding:8px;margin-top:8px;border:1px solid var(--bd);border-radius:4px" onclick="this.select();document.execCommand('copy')"/>
      <div style="font-size:12px;color:var(--t2);margin-top:4px"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Tap to copy link</div>`;
  } else {
    body = `<div>${esc(ar.content)}</div>`;
  }
  return `<div class="admin-review-box"><div class="admin-review-label"><svg class="icon i-star" aria-hidden="true"><use href="#i-star"/></svg> REVIEW${ratingHtml}</div><div class="admin-review-body">${body}</div></div>`;
}
function avgRating(r){ if(!r?.length)return 0; return r.reduce((s,x)=>s+x.rating,0)/r.length; }
function renderStars(n){ const f=Math.round(n); const filled='<svg class="icon i-star star-filled" aria-hidden="true"><use href="#i-star"/></svg>'; const empty='<svg class="icon i-star star-empty" aria-hidden="true"><use href="#i-star"/></svg>'; return filled.repeat(f)+empty.repeat(Math.max(0,5-f)); }
// Dedicated review viewer (separate page/overlay) — tapping the  eye icon on a sub-account row
// opens this instead of showing the review inline, so the buying list stays compact. Images/videos
// display directly; links open externally with a copy button; text reviews show with a copy button.
let _reviewRegistry = {};
let _reviewRegistryNextId = 0;
function registerReview(ar) {
  const regId = _reviewRegistryNextId++;
  _reviewRegistry[regId] = ar;
  return regId;
}
function openReviewViewer(regId) {
  const ar = _reviewRegistry[regId];
  if (!ar) return;
  const body = document.getElementById('reviewViewerBody');
  const ratingHtml = ar.rating ? `<div style="margin-bottom:10px">${renderStars(ar.rating)}</div>` : '';
  let content = '';
  if (ar.reviewType === 'image') {
    content = `<img src="${esc(ar.content)}" alt="Review" style="width:100%;border-radius:8px" onerror="this.parentElement.textContent='Image failed to load'"/>`;
  } else if (ar.reviewType === 'video') {
    content = `<video src="${esc(ar.content)}" controls playsinline style="width:100%;border-radius:8px"></video>`;
  } else if (ar.reviewType === 'link') {
    content = `<a href="${esc(ar.content)}" target="_blank" rel="noopener" class="review-link-btn"><svg class="icon i-link" aria-hidden="true"><use href="#i-link"/></svg> Open Link</a>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input type="text" id="reviewLinkInput" value="${esc(ar.content)}" readonly style="flex:1;padding:8px;border:1px solid var(--bd);border-radius:6px"/>
        <button class="copy-details-btn" onclick="copyText('reviewLinkInput',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy</button>
      </div>`;
  } else {
    content = `<div id="reviewTextContent" style="white-space:pre-wrap;line-height:1.5">${esc(ar.content)}</div>
      <button class="copy-details-btn" style="margin-top:10px" onclick="copyText('reviewTextContent',this)"><svg class="icon i-clipboard" aria-hidden="true"><use href="#i-clipboard"/></svg> Copy</button>`;
  }
  body.innerHTML = ratingHtml + content;
  document.getElementById('reviewViewerOv').classList.add('open');
}
function closeReviewViewer() {
  document.getElementById('reviewViewerOv')?.classList.remove('open');
}
// Renders the " Tutorial" button on a listing's product page. Disabled/greyed-out ("Tutorial
// Unavailable") if admin never set one up for this listing — never silently hidden, so buyers
// always know a tutorial could exist and just wasn't provided, rather than assuming there is none.
// Tutorial data is stashed in _tutorialRegistry (keyed by an incrementing id) rather than inlined
// into the onclick attribute, since image/video URLs could contain characters that break HTML attrs.
let _tutorialRegistry = {};
let _tutorialRegistryNextId = 0;
let _tutorialData = null; // holds the currently-open listing's tutorial while the viewer modal is open
function buildTutorialButtonHtml(tutorial, compact) {
  if (!tutorial || !tutorial.tutorialType || tutorial.tutorialType === 'none') {
    return compact
      ? `<button class="tutorial-btn tutorial-btn-unavailable tutorial-btn-compact" disabled><svg class="icon i-book-open" aria-hidden="true"><use href="#i-book-open"/></svg></button>`
      : `<button class="tutorial-btn tutorial-btn-unavailable" disabled><svg class="icon i-book-open" aria-hidden="true"><use href="#i-book-open"/></svg> Tutorial Unavailable</button>`;
  }
  const regId = _tutorialRegistryNextId++;
  _tutorialRegistry[regId] = tutorial;
  return compact
    ? `<button class="tutorial-btn tutorial-btn-compact" onclick="openTutorialViewer(${regId})" title="View login tutorial"><svg class="icon i-book-open" aria-hidden="true"><use href="#i-book-open"/></svg> Tutorial</button>`
    : `<button class="tutorial-btn" onclick="openTutorialViewer(${regId})"><svg class="icon i-book-open" aria-hidden="true"><use href="#i-book-open"/></svg> View Login Tutorial</button>`;
}
function openTutorialViewer(regId) {
  _tutorialData = _tutorialRegistry[regId];
  if (!_tutorialData) return;
  _tutorialImgIndex = 0;
  const ov = document.getElementById('tutorialViewerOv');
  if (!ov) { console.error('Tutorial viewer markup missing'); return; }
  renderTutorialViewer();
  ov.classList.add('open');
}
function closeTutorialViewer() {
  document.getElementById('tutorialViewerOv')?.classList.remove('open');
  _tutorialData = null;
}
let _tutorialImgIndex = 0;
function renderTutorialViewer() {
  const body = document.getElementById('tutorialViewerBody');
  if (!body || !_tutorialData) return;
  const t = _tutorialData;
  if (t.tutorialType === 'video' && t.videoUrl) {
    body.innerHTML = `<video src="${esc(t.videoUrl)}" controls playsinline style="width:100%;max-height:70vh;border-radius:8px"></video>`;
  } else if (t.tutorialType === 'link' && t.linkUrl) {
    body.innerHTML = `<div style="text-align:center;padding:24px 12px">
      <p style="color:var(--t2);margin-bottom:16px">This tutorial is hosted externally.</p>
      <a href="${esc(t.linkUrl)}" target="_blank" rel="noopener" class="review-link-btn"><svg class="icon i-link" aria-hidden="true"><use href="#i-link"/></svg> Open Tutorial Link</a>
    </div>`;
  } else if (t.tutorialType === 'images' && t.images?.length) {
    const total = t.images.length;
    _tutorialImgIndex = Math.max(0, Math.min(_tutorialImgIndex, total - 1));
    body.innerHTML = `
      <div style="text-align:center">
        <img src="${esc(t.images[_tutorialImgIndex])}" alt="Tutorial step ${_tutorialImgIndex+1}" style="max-width:100%;max-height:60vh;border-radius:8px" onerror="this.style.display='none'"/>
        <div style="margin-top:10px;font-size:13px;color:var(--t2)">Step ${_tutorialImgIndex+1} of ${total}</div>
        <div style="display:flex;justify-content:center;gap:10px;margin-top:12px">
          <button class="tutorial-nav-btn" onclick="tutorialImgStep(-1)" ${_tutorialImgIndex===0?'disabled':''}><svg class="icon i-arrow-left" aria-hidden="true"><use href="#i-arrow-left"/></svg> Prev</button>
          <button class="tutorial-nav-btn" onclick="tutorialImgStep(1)" ${_tutorialImgIndex===total-1?'disabled':''}>Next <svg class="icon i-arrow-right" aria-hidden="true"><use href="#i-arrow-right"/></svg></button>
        </div>
      </div>`;
  } else {
    body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--t2)">Tutorial content unavailable.</div>`;
  }
}
function tutorialImgStep(dir) {
  _tutorialImgIndex += dir;
  renderTutorialViewer();
}
let toastT;
function showToast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`toast show ${type}`;
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),3200);
}
// ── DEPOSIT — FLUTTERWAVE BANK TRANSFER ─────────────────────
let depositPollTimer = null;
let currentPaymentLinkTxRef = null;
let depositFragmentLoaded = false;
// No live polling loop currently runs on the Deposit page (status is checked on-demand /
// on redirect-back instead), but showPage() always calls stopDepositPolling() when navigating
// away from Deposit, so this must exist as a safe no-op / cleanup regardless. Without this
// function defined, showPage() would throw and silently abort navigation, leaving the page
// stuck showing Deposit no matter which other tab was clicked.
function startDepositPolling(fn, intervalMs = 5000) {
  stopDepositPolling();
  if (typeof fn === 'function') depositPollTimer = setInterval(fn, intervalMs);
}
function stopDepositPolling() {
  if (depositPollTimer) { clearInterval(depositPollTimer); depositPollTimer = null; }
}
// deposit.html holds the deposit page's markup and is fetched once, on first visit, then cached
// in the DOM for the rest of the session (no re-fetch on subsequent visits to /deposit).
// ── DEPOSIT FRAGMENT FUNCTIONS ────────────────────────────────────
// These functions were previously in deposit.html's inline <script> which never
// executed (innerHTML doesn't run scripts). Moved here so they're always defined.
function _depShowScreen(id) {
  ['depScreen0','depScreen1','depScreen2'].forEach(sid => {
    const el = document.getElementById(sid);
    if (!el) return;
    if (sid === id) {
      el.style.display = 'block';
      el.classList.add('dep-screen-active');
    } else {
      el.style.display = 'none';
      el.classList.remove('dep-screen-active');
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function depGoHome() { _depShowScreen('depScreen0'); }
function depGoVA() {
  _depShowScreen('depScreen1');
  loadVAInDeposit();
}
function depGoPL() {
  _depShowScreen('depScreen2');
  const amtStep  = document.getElementById('depPlAmountStep');
  const confStep = document.getElementById('depPlConfirmStep');
  if (amtStep)  amtStep.style.display  = 'block';
  if (confStep) confStep.style.display = 'none';
}
function switchDepMethod(method) {
  if (method === 'va') depGoVAWithPoller();
  else { stopVAPoller(); depGoPL(); }
}
// ── VIRTUAL ACCOUNT GATEWAY PICKER (Flutterwave / Paystack) ─────────────────────────────
// Shown only when the admin has both gateways switched on; otherwise the one that is on is used.
let selectedVAGateway = '';
let _vaPendingRetries = 0;
function vaGatewaysAvailable() {
  const g = window.KLS_VA_GATEWAYS;
  if (!g) return ['flutterwave'];
  return ['flutterwave', 'paystack'].filter(k => g[k]);
}
function renderVAGatewayChooser() {
  const avail = vaGatewaysAvailable();
  if (!avail.includes(selectedVAGateway)) selectedVAGateway = avail[0] || 'flutterwave';
  const box = document.getElementById('vaGatewayChooser');
  if (!box) return;
  if (avail.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = 'block';
  box.innerHTML = '<div style="font-size:.78rem;font-weight:700;color:var(--t2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Bank account provider</div>' +
    '<div style="display:flex;gap:10px">' + avail.map(g =>
      `<button type="button" onclick="pickVAGateway('${g}')" style="flex:1;padding:12px 10px;border-radius:10px;cursor:pointer;font:inherit;font-weight:700;` +
      `border:2px solid ${g === selectedVAGateway ? 'var(--accent)' : 'var(--border2, rgba(255,255,255,.15))'};` +
      `background:${g === selectedVAGateway ? 'rgba(7,136,232,.14)' : 'transparent'};color:var(--t1)">${GATEWAY_NAMES[g]}</button>`
    ).join('') + '</div>';
}
function pickVAGateway(g) {
  selectedVAGateway = g;
  _vaPendingRetries = 0;
  if (typeof stopVAPoller === 'function') stopVAPoller();
  loadVAInDeposit();
}
async function loadVAInDeposit() {
  renderVAGatewayChooser();
  const states = ['vaLoadingState','vaAccountCard','vaGenerateCard','vaDisabledCard'];
  states.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const loadEl = document.getElementById('vaLoadingState');
  if (loadEl) loadEl.style.display = 'block';
  try {
    const token = localStorage.getItem('ksl_token');
    const res = await fetch('/api/user/virtual-account?gateway=' + encodeURIComponent(selectedVAGateway || 'flutterwave'), { headers: { Authorization: 'Bearer ' + token } });
    const va  = await res.json();
    console.log('[Marvel Nums] virtual-account response', res.status, va);
    if (loadEl) loadEl.style.display = 'none';
    if (!res.ok) throw new Error(va.error || ('Server returned ' + res.status));
    if (va.available === false && va.reason === 'country') {
      // Nigeria-only rail: send the customer straight back to the methods that
      // do work for them instead of showing an account they can never fund.
      window.KLS_VA_ALLOWED = false;
      const card = document.getElementById('depChooseVA');
      if (card) card.style.display = 'none';
      if (typeof showToast === 'function') showToast(va.message || 'Virtual accounts are available in Nigeria only.', 'info');
      if (typeof depGoHome === 'function') depGoHome();
      return;
    }
    // Only the admin switch being explicitly OFF may show the maintenance card.
    // Previously any response missing this field (an error payload, a timeout,
    // an old cached body) was treated as "disabled", which is why some people
    // saw "Temporarily Unavailable" while others did not.
    if (va.globalEnabled === false) {
      console.warn('[Marvel Nums] Virtual accounts are globally disabled by admin');
      const disabledEl = document.getElementById('vaDisabledCard');
      if (disabledEl) disabledEl.style.display = 'block';
      return;
    }
    if (!va.enabled || !va.accountNumber) {
      const genEl = document.getElementById('vaGenerateCard');
      if (genEl) genEl.style.display = 'block';
      if (va.pending) {
        const pfb = document.getElementById('vaGenerateFeedback');
        if (pfb) { pfb.textContent = 'Your account is being set up — this takes a few seconds…'; pfb.style.color = 'var(--t2)'; }
        if (_vaPendingRetries++ < 6) setTimeout(() => { if (document.getElementById('vaGenerateCard')?.style.display !== 'none') loadVAInDeposit(); }, 5000);
      }
      // Show new-user prompt banner inside the generate card
      const isNewUser = !currentUser?.createdAt || (Date.now() - new Date(currentUser.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000);
      const existingBanner = document.getElementById('vaNewUserBanner');
      if (genEl && isNewUser && !existingBanner) {
        const banner = document.createElement('div');
        banner.id = 'vaNewUserBanner';
        banner.className = 'va-newuser-banner';
        banner.innerHTML = `
          <div class="va-newuser-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
              <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5Z"/>
              <path d="M9 21V12h6v9"/>
            </svg>
          </div>
          <div>
            <div class="va-newuser-title">Welcome! Set up your virtual bank account</div>
            <div class="va-newuser-sub">
              Generate your free permanent Nigerian bank account below. Transfer money to it anytime and your Marvel Nums wallet is credited automatically — no approval, no screenshots needed.
            </div>
          </div>`;
        genEl.insertBefore(banner, genEl.firstChild);
      }
      return;
    }
    // Populate account details
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    // Account name format: "Marvel Nums {Username}" — clearly shows the bank name + Marvel Nums branding
    const displayAccName = va.accountName || ('Marvel Nums ' + (currentUser?.name || 'User'));
    const displayBank = va.bankName || 'Wema Bank';
    set('vaDisplayAccNum', va.accountNumber);
    set('vaDisplayBank',   displayBank);
    set('vaDisplayName',   displayAccName);
    set('vaHowBankName',   displayBank);
    set('vaHowAccNum',     va.accountNumber);
    set('vaHowAccName',    displayAccName);
    // Show bank name prominently as subtitle
    const bankSubEl = document.getElementById('vaDisplayBankSub');
    if (bankSubEl) bankSubEl.textContent = `Bank: ${displayBank}`;
    // Show wallet balance on VA screen
    const vaBalEl = document.getElementById('vaWalletBal');
    if (vaBalEl && currentUser) vaBalEl.textContent = fmt(currentUser.balance || 0);
    const cardEl = document.getElementById('vaAccountCard');
    if (cardEl) cardEl.style.display = 'block';
    // Start the live poller now that the account card is visible
    if (typeof startVAPoller === 'function') startVAPoller();
  } catch (e) {
    console.error('[Marvel Nums] loadVAInDeposit failed:', e);
    if (loadEl) loadEl.style.display = 'none';
    const genEl = document.getElementById('vaGenerateCard');
    if (genEl) genEl.style.display = 'block';
    const fb = document.getElementById('vaGenerateFeedback');
    if (fb) { fb.textContent = 'Could not load account info — tap Generate to try again.'; fb.style.color = 'var(--red)'; }
  }
}
async function generateVirtualAccount() {
  const btn = document.getElementById('vaGenerateBtn');
  const fb  = document.getElementById('vaGenerateFeedback');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  if (fb)  fb.textContent = '';
  try {
    const token = localStorage.getItem('ksl_token');
    const res = await fetch('/api/user/virtual-account/create', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gateway: selectedVAGateway || 'flutterwave' })
    });
    const data = await res.json();
    console.log('[Marvel Nums] virtual-account/create response', res.status, data);
    if (!res.ok) throw new Error(data.error || 'Failed to create virtual account');
    if (fb) { fb.textContent = 'Account generated! Loading details…'; fb.style.color = 'var(--green)'; }
    setTimeout(() => loadVAInDeposit(), 800);
  } catch (e) {
    if (fb)  { fb.textContent = e.message; fb.style.color = 'var(--red)'; }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate My Virtual Account — Free'; }
  }
}
function copyVAField(valueElId, btnId) {
  const val = document.getElementById(valueElId)?.textContent?.trim();
  if (!val || val === '—') return;
  navigator.clipboard?.writeText(val).then(() => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.textContent = 'Copied';
      btn.classList.add('copied');
 setTimeout(() => { btn.textContent = ' Copy'; btn.classList.remove('copied'); }, 2000);
    }
    if (typeof showToast === 'function') showToast('Copied!', 'ok');
  }).catch(() => {});
}
function toggleVAHow() {
  const steps = document.getElementById('vaHowSteps');
  const btn   = document.getElementById('vaHowToggle');
  if (!steps || !btn) return;
  const open = steps.style.display !== 'none';
  steps.style.display = open ? 'none' : 'block';
  btn.textContent = open ? 'Show ▾' : 'Hide ▴';
}
// ── VIRTUAL ACCOUNT AUTO-CONFIRMATION POLLER ──────────────────────────────────
// Runs every 6 seconds while the user has their VA card open.
// Primary confirmation path is the Flutterwave webhook + SSE push — this is a
// belt-and-suspenders fallback that polls the server for any new VA deposits that
// may have arrived while the SSE connection was down or before it connected.
let _vaPoller        = null;
let _vaLastBalance   = null;   // track balance so we only toast on real changes
let _vaPollCount     = 0;
let _vaPollerBaselineSet = false; // FIX: skip first tick notification to avoid re-notifying on page revisit
const VA_POLL_MS     = 6000;   // poll every 6 seconds
const VA_POLL_MAX    = 300;    // stop after 30 minutes (300 × 6s) to avoid zombie pollers
function startVAPoller() {
  stopVAPoller();
  _vaLastBalance = currentUser?.balance ?? null;
  _vaPollCount   = 0;
  _vaPollerBaselineSet = false; // reset so first tick just snapshots balance without notifying
  _vaPoller = setInterval(_vaPollTick, VA_POLL_MS);
  console.log('[VA-poller] started, baseline balance:', _vaLastBalance);
}
function stopVAPoller() {
  if (_vaPoller) { clearInterval(_vaPoller); _vaPoller = null; }
}
let _vaLastFlwRef   = localStorage.getItem('ksl_last_va_flwref') || null; // track last credited flwRef — persisted so a page reload/app reopen doesn't forget and re-notify for the same deposit
let _vaLastNotifRef = _vaLastFlwRef; // dedupe toast/banner — only notify once per flwRef
async function _vaPollTick() {
  _vaPollCount++;
  if (_vaPollCount > VA_POLL_MAX) { stopVAPoller(); return; }
  try {
    // Use the dedicated VA status endpoint — returns balance + latest deposit info
    const data = await req('/api/user/virtual-account/latest-deposit', 'GET', null, true);
    const newBal = Number(data.balance);
    if (typeof newBal !== 'number' || isNaN(newBal)) return;

    // FIX: On the very first tick after (re)starting the poller, just snapshot
    // the current balance + latest flwRef without showing any notification.
    // This prevents re-notifying for an old deposit when the user navigates back
    // to the deposit page minutes after a successful top-up.
    if (!_vaPollerBaselineSet) {
      _vaPollerBaselineSet = true;
      _vaLastBalance = newBal;
      // Also lock in the last known flwRef so we don't re-toast it
      const depSnap = data.latestDeposit;
      if (depSnap?.flwRef && !_vaLastFlwRef) {
        _vaLastFlwRef = depSnap.flwRef;
        _vaLastNotifRef = depSnap.flwRef;
        try { localStorage.setItem('ksl_last_va_flwref', _vaLastFlwRef); } catch {}
      }
      console.log('[VA-poller] baseline snapshot — bal:', newBal, 'flwRef:', _vaLastFlwRef);
      return; // skip notification for this tick
    }

    // Check if there's a new successful VA deposit we haven't seen yet
    const dep = data.latestDeposit;
    // reconCredit means server just credited something during this poll request
    const serverRecon = data.reconCredit && data.reconCredit.flwRef !== _vaLastFlwRef;
    const isNew = dep
      && dep.status === 'success'
      && dep.flwRef
      && dep.flwRef !== _vaLastFlwRef
      && (_vaLastBalance === null || newBal >= _vaLastBalance); // >= to catch even same-amount top-ups
    if (isNew || serverRecon || (_vaLastBalance !== null && newBal > _vaLastBalance)) {
      const added = dep?.creditAmount || (newBal > (_vaLastBalance || 0) ? newBal - (_vaLastBalance || 0) : 0);
      if (added > 0 || serverRecon) {
        const displayAdded = added || dep?.creditAmount || 0;
        // Update every balance display on the page
        if (currentUser) {
          currentUser.balance = newBal;
          localStorage.setItem('ksl_user', JSON.stringify(currentUser));
        }
        ['navBalance','depositBal','dbBal'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = fmt(newBal);
        });
        // Show confirmation banner on the VA card
        const bannerWrap2 = document.querySelector('.va-confirm-banner');
        if (bannerWrap2) {
          const subEl2 = bannerWrap2.querySelector('.va-confirm-sub');
          if (subEl2) subEl2.textContent = `${P2(displayAdded)} credited to your Marvel Nums wallet automatically.`;
          bannerWrap2.style.display = 'flex';
          setTimeout(() => { if (bannerWrap2) bannerWrap2.style.display = 'none'; }, 12000);
        }
        // Dedupe against SSE/other pollers via the shared 8s-window helper, AND still track
        // flwRef so we never re-notify for the exact same confirmed deposit on a later poll.
        const thisRef = data.reconCredit?.flwRef || dep?.flwRef || null;
        if (displayAdded > 0 && thisRef !== _vaLastNotifRef) {
          _vaLastNotifRef = thisRef;
          if (typeof maybeToastDeposit === 'function') maybeToastDeposit(displayAdded);
          // Update confirm banner with exact amount
          const confirmBanner = document.getElementById('vaConfirmBanner');
          if (confirmBanner) {
            const subEl = confirmBanner.closest ? confirmBanner.closest('.va-confirm-banner')?.querySelector('.va-confirm-sub') : null;
            if (subEl) subEl.textContent = `${P2(displayAdded)} credited to your Marvel Nums wallet automatically.`;
          }
        }
 console.log(`[VA-poller] Balance ₦${_vaLastBalance} ₦${newBal} (+₦${displayAdded})`);
        if (dep?.flwRef) _vaLastFlwRef = dep.flwRef;
        if (data.reconCredit?.flwRef) _vaLastFlwRef = data.reconCredit.flwRef;
        if (_vaLastFlwRef) { try { localStorage.setItem('ksl_last_va_flwref', _vaLastFlwRef); } catch {} }
        stopVAPoller();
        startVAPoller(); // restart fresh to watch for next payment
      }
    }
    _vaLastBalance = newBal;
  } catch (e) {
    // network blip — keep polling silently
    console.warn('[VA-poller] poll error:', e.message);
  }
}
// Call this when user navigates to VA tab/card
function depGoVAWithPoller() {
  depGoVA();
  startVAPoller();
}
// Stop VA poller when user leaves the VA section
function depGoHomeWithPoller() {
  stopVAPoller();
  depGoHome();
}
function updatePLFeePreview() {
  const val     = parseFloat(document.getElementById('depPlAmountInput')?.value || 0);
  const preview = document.getElementById('plFeePreview');
  if (!preview) return;
  // Outside Nigeria the amount typed is already US dollars: the naira credit is
  // worked out server-side at the live rate, so no naira maths belongs here.
  if (window.KLS_PAY_CURRENCY === 'USD') {
    if (!val || val < 1) { preview.style.display = 'none'; return; }
    preview.style.display = 'block';
    preview.innerHTML = `You'll be charged <b>$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> — your wallet is credited with the naira equivalent at today's rate.`;
    return;
  }
  if (!val || val < 100) { preview.style.display = 'none'; return; }
  // Fee tiers must match server.js calcDepositFee():
 // ₦100–₦499 ₦10 | ₦500–₦999 ₦20 | ₦1,000–₦9,999 ₦50 | ₦10,000+ ₦100
  const fee = val >= 10000 ? 100 : val >= 1000 ? 50 : val >= 500 ? 20 : 10;
  preview.style.display = 'block';
  preview.innerHTML = `Wallet credit: <b>₦${val.toLocaleString()}</b> + ₦${fee} flat fee = you'll be charged <b>₦${(val + fee).toLocaleString()}</b>`;
}
async function loadDepositFragment() {
  if (depositFragmentLoaded) return true;
  const container = document.getElementById('page-deposit');
  if (!container) return false;
  try {
    const res = await fetch('/deposit.html');
    if (!res.ok) throw new Error('Failed to load deposit page');
    container.innerHTML = await res.text();
    depositFragmentLoaded = true;
    // NOTE: innerHTML does NOT execute <script> tags — all deposit functions live in script.js
    // Just initialise the screen state here
    depGoHome();
    return true;
  } catch (e) {
    container.innerHTML = '<div class="page-hero"><h1>Deposit</h1><p>Could not load this page. Please refresh and try again.</p></div>';
    return false;
  }
}
// ── REFERRALS ──────────────────────────────────────────────
let referralsFragmentLoaded = false;
let latestReferralLink = '';
async function loadReferralsFragment() {
  if (referralsFragmentLoaded) return true;
  const container = document.getElementById('page-referrals');
  if (!container) return false;
  try {
    const res = await fetch('/referrals-fragment.html');
    if (!res.ok) throw new Error('Failed to load referrals page');
    container.innerHTML = await res.text();
    referralsFragmentLoaded = true;
    return true;
  } catch (e) {
    container.innerHTML = '<div class="page-hero"><h1>Referrals</h1><p>Could not load this page. Please refresh and try again.</p></div>';
    return false;
  }
}
async function loadReferrals() {
  const ok = await loadReferralsFragment();
  if (!ok) return;
  const linkEl = document.getElementById('refLinkDisplay');
  const countEl = document.getElementById('refReferredCount');
  const totalEl = document.getElementById('refTotalEarned');
  const listEl = document.getElementById('refEarningsList');
  try {
    const data = await req('/api/referrals/summary', 'GET', null, true);
    latestReferralLink = data.referralLink;
    if (linkEl) linkEl.textContent = data.referralLink;
    if (countEl) countEl.textContent = data.referredCount;
    if (totalEl) totalEl.textContent = P(data.totalEarned);
    if (listEl) {
      if (!data.recentEarnings.length) {
        listEl.innerHTML = '<p style="color:var(--muted);font-size:.9rem">No commissions yet — share your link to start earning.</p>';
      } else {
        listEl.innerHTML = data.recentEarnings.map(e => `
          <div class="dcb-row" style="border-bottom:1px solid var(--border2);padding:10px 0">
            <span>${esc(e.itemLabel || 'Purchase')}<br><span style="color:var(--muted);font-size:.8rem">${new Date(e.createdAt).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</span></span>
            <b style="color:var(--green)">+${P(e.commission)}</b>
          </div>
        `).join('');
      }
    }
  } catch (e) {
    if (linkEl) linkEl.textContent = 'Could not load your referral link — please refresh.';
  }
  loadMyBadges();
}
async function loadMyBadges() {
  const el = document.getElementById('refBadgesList');
  if (!el) return;
  try {
    const [mine, all] = await Promise.all([
      req('/api/badges/mine', 'GET', null, true),
      req('/api/badges', 'GET', null, true)
    ]);
    const earnedIds = new Set(mine.map(b => b._id));
    if (!all.length) { el.innerHTML = '<p style="color:var(--t2);font-size:.9rem">No badges available yet.</p>'; return; }
    el.innerHTML = all.map(b => {
      const earned = earnedIds.has(b._id);
      return `<div title="${esc(b.description || '')}" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 14px;border-radius:var(--r12);border:1px solid var(--border);background:${earned ? 'var(--card2)' : 'var(--bg3)'};opacity:${earned ? '1' : '.4'};min-width:80px">
        <span style="font-size:26px">${esc(b.icon)}</span>
        <span style="font-size:11px;font-weight:700;text-align:center;color:${earned ? 'var(--t1)' : 'var(--t2)'}">${esc(b.name)}</span>
      </div>`;
    }).join('');
  } catch (e) { el.innerHTML = '<p style="color:var(--t2);font-size:.9rem">Could not load badges.</p>'; }
}
function copyReferralLink() {
  if (!latestReferralLink) return;
  navigator.clipboard?.writeText(latestReferralLink).then(() => showToast('Referral link copied')).catch(() => {});
}

// ── COUNTRY-BASED DEPOSIT RULES ───────────────────────────────────────────────
// Nigeria gets the virtual account + payment link and pays in naira. Every
// other country sees the payment link only, charged in US dollars.
async function applyCountryDepositRules() {
  try {
    // Signed-in users are resolved from their profile (and their IP as a
    // fallback) on the SERVER. We deliberately do not send a local hint for
    // them: a stale localStorage value was letting existing non-Nigerian
    // accounts keep the virtual-account card. Only logged-out visitors send a
    // hint, and even then the server prefers its own IP/CDN lookup.
    let hint = '';
    if (!currentUser) { try { hint = localStorage.getItem('kls_country') || ''; } catch (e) { hint = ''; } }
    const cfg = await req('/api/payments/config' + (hint ? '?country=' + encodeURIComponent(hint) : ''), 'GET', null, true, false, true);
    const allowed = cfg.methods || ['banktransfer', 'paymentlink'];
    const cards = {
      banktransfer: document.getElementById('depChooseVA'),
      paymentlink:  document.getElementById('depChoosePL'),
    };
    window.KLS_VA_ALLOWED = allowed.includes('banktransfer');
    window.KLS_COUNTRY = cfg.country || cfg.code || '';
    Object.keys(cards).forEach(m => {
      if (cards[m]) cards[m].style.display = allowed.includes(m) ? '' : 'none';
    });
    // Belt and braces: if the rail is not allowed, the card cannot be opened
    // even if some other code path un-hides it.
    if (!window.KLS_VA_ALLOWED && cards.banktransfer) {
      cards.banktransfer.onclick = null;
      cards.banktransfer.onkeydown = null;
    }
    // Tell non-Nigerian customers, once and clearly, what currency they are charged in.
    const host = document.getElementById('depChoosePL')?.parentElement;
    let note = document.getElementById('depCountryNote');
    if (cfg.payCurrency === 'USD' && host) {
      if (!note) {
        note = document.createElement('div');
        note.id = 'depCountryNote';
        note.className = 'how-warning-box';
        host.insertBefore(note, host.firstChild);
      }
      note.textContent = `You're depositing from ${cfg.countryName || 'your country'} — payments are charged in US dollars ($) `
        + 'securely through the payment link (card, Apple Pay and your local bank rails). '
        + 'Virtual accounts are available in Nigeria only.';
    } else if (note) {
      note.remove();
    }
    window.KLS_PAY_CURRENCY = cfg.payCurrency || 'NGN';
    applyDepositCurrencyUI();
    return cfg;
  } catch (e) {
    return null;
  }
}
async function loadDeposit() {
  const ok = await loadDepositFragment();
  if (!ok) return;
  // Always land on the method-chooser screen first
  depGoHome();
  // Update balance + wallet id
  const balEl = document.getElementById('depositBal');
  if (balEl) balEl.textContent = fmt(currentUser?.balance || 0);
  const idEl = document.getElementById('wcGameId');
  if (idEl) idEl.textContent = currentUser?.gameId ? `•••• ${currentUser.gameId.slice(-4).toUpperCase()}` : '•••• ••••';
  resetDepositFlow();
  const rcEl = document.getElementById('depResultCard');
  if (rcEl) rcEl.style.display = 'none';
  checkPaymentMethodSettings();
  applyCountryDepositRules();
  checkPaymentLinkRedirect();
  loadDepositTutorials();
  loadDepositSummary();
  // Do NOT call loadVAInDeposit() here — it runs when user taps the VA card (depGoVA)
}
async function loadDepositSummary() {
  const el = document.getElementById('depositTotalLifetime');
  if (!el) return;
  try {
    const data = await req('/api/user/deposit-summary', 'GET', null, true);
    el.textContent = fmt(data.totalDeposited || 0);
  } catch (e) { /* non-critical stat, fail silently */ }
}
// Admin-controlled manual on/off switch for the deposit method — separate from the automatic
// Flutterwave-reachability check. If admin has disabled deposits, the button is disabled and a
// note with the admin's message (if any) is shown.
async function checkPaymentMethodSettings() {
  try {
    const data = await req('/api/deposit/payment-methods', 'GET', null, true);
    // ── Virtual Account card ──────────────────────────────────────────────────
    const vaCard  = document.getElementById('depChooseVA');
    const vaBadge = document.getElementById('vaBadge');
    const vaOff   = (data.virtualaccount && data.virtualaccount.enabled === false) || window.KLS_VA_ALLOWED === false;
    if (window.KLS_VA_ALLOWED === false && vaCard) { vaCard.style.display = 'none'; }
    if (vaCard) {
      if (vaOff) {
        vaCard.classList.add('dep-disabled');
        vaCard.onclick = null; vaCard.onkeydown = null;
 if (vaBadge) { vaBadge.textContent = ' Unavailable'; vaBadge.className = 'dmc-badge dmc-badge-red'; }
      } else {
        vaCard.classList.remove('dep-disabled');
        vaCard.onclick = function() { depGoVAWithPoller(); };
        vaCard.onkeydown = function(e) { if (e.key==='Enter'||e.key===' ') depGoVA(); };
 if (vaBadge) { vaBadge.textContent = ' Instant'; vaBadge.className = 'dmc-badge dmc-badge-green'; }
      }
    }
    // ── Payment Link card ────────────────────────────────────────────────────
    const plCard  = document.getElementById('depChoosePL');
    const plNote  = document.getElementById('depPlUnavailableNote');
    const plBtn   = document.getElementById('depPlGenerateBtn');
    window.KLS_GATEWAYS = data.gateways || null;
    window.KLS_VA_GATEWAYS = data.vaGateways || null;
    renderVAGatewayChooser();
    const gwList = data.gateways ? ['flutterwave', 'paystack'].filter(g => data.gateways[g] && data.gateways[g].available) : null;
    const noGateway = !!gwList && gwList.length === 0;
    renderGatewayChooser(data.gateways, data.defaultGateway);
    const plOff   = (data.paymentlink && data.paymentlink.enabled === false) || noGateway;
    if (plCard) {
      if (plOff) {
        plCard.classList.add('dep-disabled');
        plCard.onclick = null; plCard.onkeydown = null;
        if (plBtn) plBtn.disabled = true;
        if (plNote) {
 plNote.textContent = ' ' + ((data.paymentlink && data.paymentlink.disabledMessage) || (noGateway && data.gateways && (data.gateways.flutterwave.disabledMessage || data.gateways.paystack.disabledMessage)) || 'Payment Link is temporarily unavailable — please use Bank Transfer instead.');
          plNote.style.display = 'block';
        }
      } else {
        plCard.classList.remove('dep-disabled');
        plCard.onclick = function() { depGoPL(); };
        plCard.onkeydown = function(e) { if (e.key==='Enter'||e.key===' ') depGoPL(); };
        if (plBtn) plBtn.disabled = false;
        if (plNote) plNote.style.display = 'none';
      }
    }
  } catch (e) { /* silent — server enforces on its own */ }
}
// Fetches admin-uploaded tutorial video/pictures (if any) and renders them into the "How it
// works" section. Silently does nothing if admin hasn't uploaded anything yet.
async function loadDepositTutorials() {
  try {
    const data = await req('/api/deposit-tutorials', 'GET', null, true);
    renderDepositTutorial('Paymentlink', data.paymentlink);
    // Also render VA tutorial if admin uploaded one (key 'virtualaccount' or 'va')
    renderDepositTutorial('VA', data.virtualaccount || data.va);
  } catch (e) { /* tutorials are optional — fail silently */ }
}
// Renders the deposit page's tutorial using the exact same step-by-step viewer (Prev/Next,
// "Step X of Y") that marketplace listings use for their login tutorials — see
// buildTutorialButtonHtml()/openTutorialViewer() above. A video-only tutorial opens the same
// viewer with its video; a caption-only tutorial (no media) just shows the text, since there's
// nothing to page through.
function renderDepositTutorial(key, tut) {
  const box = document.getElementById(`depTut${key}Box`);
  const content = document.getElementById(`depTut${key}Content`);
  if (!box || !content) return;
  if (!tut || (!tut.videoUrl && !(tut.imageUrls || []).length && !tut.caption)) {
    box.style.display = 'none';
    return;
  }
  let html = '';
  if ((tut.imageUrls || []).length || tut.videoUrl) {
    const tutorialShape = (tut.imageUrls || []).length
      ? { tutorialType: 'images', images: tut.imageUrls }
      : { tutorialType: 'video', videoUrl: tut.videoUrl };
    const regId = _tutorialRegistryNextId++;
    _tutorialRegistry[regId] = tutorialShape;
    html += `<button type="button" class="tutorial-btn" onclick="openTutorialViewer(${regId})"><svg class="icon i-book-open" aria-hidden="true"><use href="#i-book-open"/></svg> View Step-by-Step Tutorial</button>`;
  }
  if (tut.caption) html += `<p style="color:var(--muted);font-size:.9rem;margin-top:10px">${esc(tut.caption)}</p>`;
  content.innerHTML = html;
  box.style.display = 'block';
}
// After Flutterwave redirects back from the hosted checkout page, the server has already
// verified + credited the deposit — this just reads the ?deposit= flag to show the right toast
// and refresh the balance. The server sends the browser back to /deposit (not home), so this
// always runs on the Deposit page itself.
function checkPaymentLinkRedirect() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('deposit');
  const txRef  = params.get('txRef');
  if (!result) return;
  // Clean URL immediately so refresh doesn't re-trigger
  params.delete('deposit'); params.delete('txRef');
  const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.replaceState({}, '', newUrl);
  if (result === 'success') {
    refreshBalance();
 showToast(' Deposit successful — wallet credited!', 'ok');
    showDepositResultCard('success');
  } else if (result === 'pending' && txRef) {
    // Bank transfer not yet settled — show pending UI and poll
    showDepositResultCard('pending');
    startPaymentLinkPendingPoller(txRef);
  } else if (result === 'cancelled') {
    showToast('Payment was cancelled.', 'err');
    showDepositResultCard('cancelled');
  } else if (result === 'failed') {
    showToast('Payment could not be confirmed. Contact support if you were charged.', 'err');
    showDepositResultCard('failed');
  }
}
function showDepositResultCard(state) {
  const card = document.getElementById('depResultCard');
  if (!card) return;
 const iconIds = { success:'check-circle', pending:'refresh', cancelled:'x-circle', failed:'alert-triangle' };
  const iconHtml = (s) => { const id = iconIds[s] || 'clipboard'; return `<svg class="icon i-${id}" aria-hidden="true" style="width:2.5rem;height:2.5rem"><use href="#i-${id}"/></svg>`; };
  const titles  = { success:'Payment Confirmed!', pending:'Payment Pending…', cancelled:'Payment Cancelled', failed:'Payment Failed' };
  const msgs    = {
    success: 'Your wallet has been credited. You can now buy items on the marketplace.',
    pending: 'Your bank transfer is being processed. This can take a few minutes. Stay on this page and we\'ll confirm automatically.',
    cancelled: 'You cancelled the payment. No funds were charged.',
    failed: 'Payment could not be confirmed. If you were charged, please contact support with your transaction reference.'
  };
  const colors  = { success:'var(--green,#22c55e)', pending:'var(--gold,#f59e0b)', cancelled:'var(--muted,#64748b)', failed:'var(--red,#ef4444)' };
  card.style.display = 'block';
  card.innerHTML = `
    <div style="text-align:center;padding:24px 16px">
      <div style="margin-bottom:10px;color:${colors[state]}">${iconHtml(state)}</div>
      <h3 style="margin:0 0 8px;color:${colors[state]}">${titles[state]}</h3>
      <p style="color:var(--t2);font-size:.9rem;margin:0 0 16px;line-height:1.5">${msgs[state]}</p>
      ${state==='pending' ? `
        <div id="depPendingSpinner" style="margin:0 auto 12px;width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--gold,#f59e0b);border-radius:50%;animation:spin 0.8s linear infinite"></div>
        <p id="depPendingStatus" style="color:var(--t2);font-size:.82rem;margin:0 0 12px">Checking your payment every 5 seconds…</p>
        <button class="btn-secondary" onclick="manualCheckPending()" style="margin-bottom:8px"><svg class="icon i-refresh" aria-hidden="true"><use href="#i-refresh"/></svg> Check Now</button>
      ` : ''}
      ${state==='success' ? `<button class="btn-primary" onclick="showPage('market')"><svg class="icon i-cart" aria-hidden="true"><use href="#i-cart"/></svg> Shop Marketplace</button>` : ''}
      ${state==='failed'  ? `<a href="https://wa.me/${WA_NUMBER}" target="_blank" class="btn-secondary" style="display:inline-block;text-decoration:none"><svg class="icon i-message-circle" aria-hidden="true"><use href="#i-message-circle"/></svg> Contact Support</a>` : ''}
    </div>`;
}
let _pendingPoller = null;
let _pendingTxRef  = null;
let _pendingChecks = 0;
function startPaymentLinkPendingPoller(txRef) {
  stopPaymentLinkPendingPoller();
  _pendingTxRef  = txRef;
  _pendingChecks = 0;
  _pendingPoller = setInterval(pollPendingPayment, 5000);
  pollPendingPayment(); // immediate first check
}
function stopPaymentLinkPendingPoller() {
  if (_pendingPoller) { clearInterval(_pendingPoller); _pendingPoller = null; }
}
async function pollPendingPayment() {
  if (!_pendingTxRef || !token) return;
  _pendingChecks++;
  const statusEl = document.getElementById('depPendingStatus');
  if (statusEl) statusEl.textContent = `Checking… (attempt ${_pendingChecks})`;
  try {
    const data = await req(`/api/deposit/paymentlink/status/${encodeURIComponent(_pendingTxRef)}`, 'GET', null, true);
    if (data.status === 'success') {
      stopPaymentLinkPendingPoller();
      refreshBalance();
 showToast(' Payment confirmed — wallet credited!', 'ok');
      showDepositResultCard('success');
    } else if (data.status === 'failed') {
      stopPaymentLinkPendingPoller();
      showDepositResultCard('failed');
    }
    // Still pending — keep polling (up to 24 attempts = 2 minutes)
    if (_pendingChecks >= 24) {
      stopPaymentLinkPendingPoller();
      if (statusEl) statusEl.textContent = 'Still processing — contact support if funds were deducted.';
    }
  } catch { /* network hiccup — keep polling */ }
}
async function manualCheckPending() {
  if (!_pendingTxRef) return;
  const statusEl = document.getElementById('depPendingStatus');
  if (statusEl) statusEl.textContent = 'Checking now…';
  await pollPendingPayment();
}
// ── PHONE NUMBER PROMPT (COMPULSORY) ─────────────────────────────────────────────────────
// Shown on EVERY login/register if the user hasn't added a phone number yet.
// The modal has NO skip/dismiss option — user MUST enter a valid Nigerian number before
// they can use the site. Once saved in MongoDB it never shows again, including after redeploys.
function checkPhonePrompt() {
  if (!currentUser) return;
  // Already has phone on their account — never show
  if (currentUser.contactPhone) return;
  // Block the site immediately — no delay, no way to dismiss
  showPhoneModal();
}
// Single entry point after any successful login/register/Google sign-in.
// The real post-login destination is the /dashboard page, not the old SPA
// home section — but the compulsory phone prompt (if needed) must still be
// satisfied first, so submitPhonePrompt() does the redirect once it's done.
function afterAuthSuccess() {
  if (currentUser && !currentUser.contactPhone) { showPhoneModal(); return; }
  window.location.href = '/dashboard';
}
function showPhoneModal() {
  const existing = document.getElementById('phonePromptModal');
  if (existing) return; // already showing
  const el = document.createElement('div');
  el.id = 'phonePromptModal';
  // Full-page block — pointer-events block everything behind it
  el.style.cssText = [
    'position:fixed;inset:0;z-index:99999',
    'display:flex;align-items:center;justify-content:center;padding:16px',
    'background:rgba(5,5,15,0.92);backdrop-filter:blur(10px)',
    'pointer-events:all'
  ].join(';');
  el.innerHTML = `
    <div style="background:var(--card,#131320);border:1px solid var(--border,#252535);border-radius:18px;max-width:400px;width:100%;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.6)">
      <!-- Top gradient header -->
      <div style="background:linear-gradient(135deg,#0788e8 0%,#7c3aed 100%);padding:28px 24px 22px;text-align:center;color:#fff">
        <div style="font-size:3rem;margin-bottom:10px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.3))"><svg class="icon i-smartphone" aria-hidden="true"><use href="#i-smartphone"/></svg></div>
        <h3 style="margin:0 0 6px;font-size:1.2rem;font-weight:800;letter-spacing:-.02em">Phone Number Required</h3>
        <p style="margin:0;font-size:.85rem;opacity:.9;line-height:1.5">To protect your account and help us reach you about orders — a valid Nigerian number is required before you can use Marvel Nums.</p>
      </div>
      <!-- Body -->
      <div style="padding:22px 22px 24px">
        <label style="display:block;font-size:.78rem;font-weight:700;color:var(--t2,#8888a8);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Your WhatsApp / Phone Number</label>
        <div style="display:flex;gap:8px;align-items:stretch;margin-bottom:6px">
          <div style="background:var(--card2,#1a1a2b);border:1.5px solid var(--border2,#2e2e42);border-radius:9px;padding:0 14px;font-weight:800;font-size:.95rem;display:flex;align-items:center;white-space:nowrap;color:var(--t1,#eeeef5);flex-shrink:0">
            🇳🇬 +234
          </div>
          <input type="tel" id="phonePromptInput"
            placeholder="8012345678"
            maxlength="11"
            style="flex:1;padding:12px 14px;border:1.5px solid var(--border2,#2e2e42);border-radius:9px;font-size:1rem;font-family:inherit;background:var(--card2,#1a1a2b);color:var(--t1,#eeeef5);outline:none;transition:border-color .2s"
            oninput="this.value=this.value.replace(/[^0-9]/g,'');if(this.value.length>1&&this.value[0]==='0')this.value=this.value.slice(1)"
            onkeydown="if(event.key==='Enter')submitPhonePrompt()"
            onfocus="this.style.borderColor='#0788e8'"
            onblur="this.style.borderColor='var(--border2,#2e2e42)'"
          />
        </div>
        <p style="font-size:.75rem;color:var(--t2,#8888a8);margin:0 0 14px;line-height:1.4">
          Enter 10 digits after +234, e.g. <b>8012345678</b> for 08012345678
        </p>
        <div id="phonePromptFb" style="font-size:.83rem;min-height:20px;margin-bottom:12px;color:#ff4757;font-weight:600"></div>
        <button id="phonePromptSubmitBtn" onclick="submitPhonePrompt()"
          style="width:100%;padding:14px;border:none;border-radius:11px;background:linear-gradient(135deg,#0788e8,#7c3aed);color:#fff;font-size:1rem;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:-.01em;transition:opacity .2s;box-shadow:0 4px 18px rgba(7,136,232,.35)">
 Save &amp; Continue
        </button>
        <!-- Rules -->
        <div style="margin-top:14px;padding:12px 14px;background:var(--bg3,#14141f);border-radius:9px;border:1px solid var(--border,#252535)">
          <p style="margin:0;font-size:.76rem;color:var(--t2,#8888a8);line-height:1.7">
            <svg class="icon i-lock" aria-hidden="true"><use href="#i-lock"/></svg> <b style="color:var(--t1,#eeeef5)">Why we need this:</b> Order confirmations, account security &amp; WhatsApp support.<br>
            <svg class="icon i-check-circle" aria-hidden="true"><use href="#i-check-circle"/></svg> Stored securely in our database — survives server changes &amp; redeploys.<br>
  You can update it anytime in Settings.
          </p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  // Prevent background scrolling/interaction
  document.body.style.overflow = 'hidden';
  setTimeout(()=>{ const inp=document.getElementById('phonePromptInput'); if(inp) inp.focus(); }, 150);
}
async function submitPhonePrompt() {
  const inp = document.getElementById('phonePromptInput');
  const fb  = document.getElementById('phonePromptFb');
  const btn = document.getElementById('phonePromptSubmitBtn');
  if (!inp) return;
  const raw = inp.value.trim().replace(/\s+/g,'');
 if (!raw) { if(fb) fb.textContent = ' Enter your phone number'; return; }
  // Accept 10 digits starting with 7, 8, or 9 (after stripping leading 0 if user typed it)
  const digits = raw.startsWith('0') ? raw.slice(1) : raw;
  if (!/^[789]\d{9}$/.test(digits)) {
 if(fb) fb.textContent = ' Enter a valid 10-digit number, e.g. 8012345678';
    return;
  }
  const phone = '+234' + digits;
  if(fb) fb.textContent = '';
  if(btn) { btn.disabled=true; btn.textContent='Saving…'; }
  try {
    const data = await req('/api/user/phone', 'POST', { phone }, true);
    currentUser = data.user;
    localStorage.setItem('ksl_user', JSON.stringify(currentUser));
    // Remove modal and restore scroll
    document.getElementById('phonePromptModal')?.remove();
    document.body.style.overflow = '';
    showToast('Phone number saved — welcome to Marvel Nums!', 'ok');
    window.location.href = '/dashboard';
  } catch(e) {
 if(fb) fb.textContent = ' ' + (e.message || 'Failed — try again');
 if(btn) { btn.disabled=false; btn.textContent=' Save & Continue'; }
  }
}
// dismissPhoneModal is intentionally removed — phone is now compulsory
// ── SETTINGS PHONE NUMBER SECTION ────────────────────────────────────────────
async function updatePhone() {
  const inp = document.getElementById('settingsPhone');
  const fb  = document.getElementById('phoneFeedback');
  if (!inp) return;
  const raw = inp.value.trim().replace(/\s+/g,'');
  if (!raw) return setFb(fb, 'Enter your phone number', 'err');
  const digits = raw.replace(/^\+234/,'').replace(/^0/,'');
  if (!/^[789]\d{9}$/.test(digits)) return setFb(fb, 'Enter a valid Nigerian number (e.g. +2348012345678 or 08012345678)', 'err');
  const phone = '+234' + digits;
  try {
    const data = await req('/api/user/phone', 'PUT', { phone }, true);
    currentUser = data.user;
    localStorage.setItem('ksl_user', JSON.stringify(currentUser));
 setFb(fb, ' Phone number updated', 'ok');
    updateNav();
  } catch(e) { setFb(fb, e.message, 'err'); }
}
// ══════════════════════ FAKE PAGE-TRANSITION OVERLAY ══════════════════════
// Brief simulated "loading" screen shown on every page switch (via showPage()). Purely cosmetic —
// the real content/API calls for the destination page still run for real right after it clears;
// nothing here fakes data, it just adds a beat of perceived loading before the page appears.
const DBFL_MESSAGES = ['Loading…', 'Almost there…'];
let dbflBusy = false;
// The overlay now STAYS on screen until the next page has really loaded (its own data requests
// finished), then fades away. A minimum time avoids a flash, and a long safety cap makes sure a
// broken request can never trap the visitor behind the loader.
function openFakeLoad(then) {
  const overlay = document.getElementById('dbfl-overlay');
  const textEl = document.getElementById('dbfl-text');
  if (!overlay || !textEl || dbflBusy) { then(); return; } // avoid stacking overlays on rapid clicks
  dbflBusy = true;
  overlay.classList.add('show');
  let i = 0;
  textEl.textContent = DBFL_MESSAGES[0];
  const msgTimer = setInterval(() => {
    i = (i + 1) % DBFL_MESSAGES.length;
    textEl.textContent = DBFL_MESSAGES[i];
  }, 700);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(msgTimer);
    clearTimeout(safety);
    overlay.classList.remove('show');
    dbflBusy = false;
  };
  const safety = setTimeout(finish, 20000);
  const started = Date.now();
  setTimeout(() => {
    let result = null;
    try { result = then(); } catch (e) { console.error(e); }
    // wait for the new page's loader, then let the page paint before the overlay lifts
    Promise.resolve(result).catch(() => {}).then(() => {
      const wait = Math.max(0, 450 - (Date.now() - started));
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(finish)), wait);
    });
  }, 250);
}
// ── METHOD 2: Payment Link (Flutterwave hosted checkout — Bank Transfer / Card / OPay) ─────
// Deposit fees are calculated and charged entirely server-side (see server.js calcDepositFee)
// and are never shown to the user anywhere in this flow.
// Our deposit page only offers Bank Transfer — Flutterwave's own hosted checkout page still
// shows Card/USSD/etc. as switchable tabs there, this just controls what opens first.
const selectedPlMethod = 'banktransfer';
// ── PAYMENT GATEWAY PICKER (Flutterwave / Paystack) ──────────────────────────────────────
// The admin switches each gateway on/off. This shows the customer only what is currently on:
// two on -> a picker, one on -> used silently, none on -> Payment Link greys out.
let selectedGateway = '';
const GATEWAY_NAMES = { flutterwave: 'Flutterwave', paystack: 'Paystack' };
function gatewayName() { return GATEWAY_NAMES[selectedGateway] || 'our secure payment partner'; }
function renderGatewayChooser(gateways, defaultGateway) {
  const box = document.getElementById('depGatewayChooser');
  const avail = ['flutterwave', 'paystack'].filter(g => gateways && gateways[g] && gateways[g].available);
  if (!avail.includes(selectedGateway)) selectedGateway = avail.includes(defaultGateway) ? defaultGateway : (avail[0] || '');
  if (!box) return;
  if (avail.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = 'block';
  box.innerHTML = '<div class="dep-amt-label" style="margin-bottom:8px">Pay with</div>' +
    '<div style="display:flex;gap:10px">' + avail.map(g =>
      `<button type="button" data-gw="${g}" onclick="pickGateway('${g}')" style="flex:1;padding:12px 10px;border-radius:10px;cursor:pointer;font:inherit;font-weight:700;` +
      `border:2px solid ${g === selectedGateway ? 'var(--accent)' : 'var(--border2, rgba(255,255,255,.15))'};` +
      `background:${g === selectedGateway ? 'rgba(7,136,232,.14)' : 'transparent'};color:var(--t1)">${GATEWAY_NAMES[g]}</button>`
    ).join('') + '</div>';
}
function pickGateway(g) {
  selectedGateway = g;
  renderGatewayChooser(window.KLS_GATEWAYS, g);
}
// ── DEPOSIT CURRENCY UI ────────────────────────────────────────────────────
// The wallet ledger is naira, but only customers in Nigeria are charged in
// naira. Everyone else pays in US dollars, so the whole payment-link amount
// screen — label, symbol, placeholder, presets, minimum and helper copy —
// has to speak dollars too. Called whenever the payment config resolves.
const DEP_QUICK_NGN = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
const DEP_QUICK_USD = [1, 2, 5, 10, 20, 50, 100, 200, 500];

function applyDepositCurrencyUI() {
  const usd    = window.KLS_PAY_CURRENCY === 'USD';
  const label  = document.getElementById('depAmtLabel');
  const sym    = document.getElementById('depAmtSym');
  const input  = document.getElementById('depPlAmountInput');
  const chips  = document.getElementById('depQuickAmounts');
  const note   = document.getElementById('depPlHeroNote');

  if (label) label.textContent = usd ? 'Amount to charge your card ($)' : 'Amount to credit your wallet (\u20a6)';
  if (sym)   sym.textContent   = usd ? '$' : '\u20a6';
  if (note)  note.textContent  = usd
    ? 'Enter the amount in US dollars. Your wallet is credited with the naira equivalent at today\u2019s exchange rate.'
    : 'Enter the amount to credit your wallet. A small processing fee covers payment processing costs.';
  if (input) {
    input.placeholder = usd ? 'e.g. 10' : 'e.g. 1000';
    input.min  = usd ? '1' : '100';
    input.step = usd ? '0.01' : '1';
  }
  if (chips) {
    const values = usd ? DEP_QUICK_USD : DEP_QUICK_NGN;
    chips.innerHTML = values.map(v =>
      `<button type="button" onclick="setDepQuickAmount(${v})">` +
      (usd ? '$' + v.toLocaleString('en-US') : '\u20a6' + v.toLocaleString('en-US')) +
      '</button>'
    ).join('');
  }
  syncDepQuickAmount();
  updatePLFeePreview();
}

// Quick-amount chips — just fill the input, same validation path as manual typing runs through.
function setDepQuickAmount(amount) {
  const input = document.getElementById('depPlAmountInput');
  if (input) input.value = amount;
  syncDepQuickAmount();
}
function syncDepQuickAmount() {
  const val = parseFloat(document.getElementById('depPlAmountInput')?.value);
  document.querySelectorAll('#depQuickAmounts button').forEach(btn => {
    const chipVal = parseFloat(btn.textContent.replace(/[₦$,]/g, ''));
    btn.classList.toggle('active', chipVal === val);
  });
}
// Step 1 -> Step 2: validate the amount, then show the confirm screen. The fee is calculated
// server-side and charged silently — it is never shown to the user, on this screen or anywhere
// else in the deposit flow.
function startPaymentLinkCheckout() {
  const amountInput = document.getElementById('depPlAmountInput');
  const fb = document.getElementById('depPlFeedback');
  const amount = parseFloat(amountInput?.value);
  const usd = window.KLS_PAY_CURRENCY === 'USD';
  if (usd) {
    // Outside Nigeria the amount typed IS the dollar amount charged; the naira
    // credit is worked out by the server at the live rate, minus the same fee.
    if (!amount || amount < 1) return setFb(fb, 'Enter a valid amount (minimum $1)', 'err');
    document.getElementById('depPlConfirmMethod').textContent = ' ' + gatewayName() + ' (International Card)';
    const feeElU = document.getElementById('depPlConfirmFee');
    const chargeElU = document.getElementById('depPlConfirmCharge');
    if (feeElU) feeElU.textContent = 'Included';
    // `amount` is already in dollars here — never run it back through the
    // naira formatter, that would convert an already-converted number.
    if (chargeElU) chargeElU.textContent = '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('depPlConfirmCredit').textContent = 'Naira equivalent at today\u2019s rate';
    document.getElementById('depPlAmountStep').style.display = 'none';
    document.getElementById('depPlConfirmStep').style.display = 'block';
    setFb(fb, '', '');
    return;
  }
  if (!amount || amount < 100) return setFb(fb, 'Enter a valid amount (minimum ₦100)', 'err');
  // Calculate fee (same tiers as server)
  let fee = 0;
  if (amount >= 100 && amount <= 999) fee = 10;
  else if (amount >= 1000 && amount <= 9999) fee = 50;
  else if (amount >= 10000) fee = 100;
  const charged = amount + fee;
 document.getElementById('depPlConfirmMethod').textContent = ' ' + gatewayName() + (selectedGateway === 'paystack' ? ' (Card / Bank / USSD)' : ' (Bank / Card / OPay)');
  const feeEl = document.getElementById('depPlConfirmFee');
  const chargeEl = document.getElementById('depPlConfirmCharge');
  if (feeEl) feeEl.textContent = '₦' + fmtNGNn(fee);
  if (chargeEl) chargeEl.textContent = '₦' + fmtNGNn(charged);
  document.getElementById('depPlConfirmCredit').textContent = '₦' + fmtNGNn(amount);
  document.getElementById('depPlAmountStep').style.display = 'none';
  document.getElementById('depPlConfirmStep').style.display = 'block';
  setFb(fb, '', '');
}
function cancelPaymentLinkCheckout() {
  document.getElementById('depPlConfirmStep').style.display = 'none';
  document.getElementById('depPlAmountStep').style.display = 'block';
}
async function createPaymentLink() {
  const amountInput = document.getElementById('depPlAmountInput');
  const fb = document.getElementById('depPlFeedback');
  const btn = document.getElementById('depPlConfirmBtn');
  const amount = parseFloat(amountInput.value);
  const minAmt = window.KLS_PAY_CURRENCY === 'USD' ? 1 : 100;
  if (!amount || amount < minAmt) {
    return setFb(fb, window.KLS_PAY_CURRENCY === 'USD' ? 'Enter a valid amount (minimum $1)' : 'Enter a valid amount (minimum ₦100)', 'err');
  }
  btn.disabled = true; btn.textContent = 'Preparing payment...'; setFb(fb, '', '');
  try {
    const data = await req('/api/deposit/paymentlink/create', 'POST', { amount, method: selectedPlMethod, gateway: selectedGateway || undefined }, true);
    currentPaymentLinkTxRef = data.txRef;
    // Send the user to the gateway's hosted page — they'll be redirected back to THIS deposit
    // page after paying (server sends them to /deposit, not home).
    window.location.href = data.link;
  } catch (e) {
 setFb(fb, ' ' + e.message, 'err');
 btn.disabled = false; btn.textContent = ' Confirm & Pay';
  }
}
function resetDepositFlow() {
  stopDepositPolling();
  const amountInput = document.getElementById('depPlAmountInput');
  if (amountInput) amountInput.value = '';
  document.querySelectorAll('#depQuickAmounts button').forEach(b => b.classList.remove('active'));
  const amountStep = document.getElementById('depPlAmountStep');
  if (amountStep) amountStep.style.display = 'block';
  const confirmStep = document.getElementById('depPlConfirmStep');
  if (confirmStep) confirmStep.style.display = 'none';
  const fb = document.getElementById('depPlFeedback');
  if (fb) setFb(fb, '', '');
  const resultCard = document.getElementById('depResultCard');
  if (resultCard) resultCard.style.display = 'none';
  const btn = document.getElementById('depPlGenerateBtn');
 if (btn) { btn.disabled = false; btn.textContent = ' Continue to Payment'; }
  const confirmBtn = document.getElementById('depPlConfirmBtn');
 if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = ' Confirm & Pay'; }
}
async function refreshBalance() {
  try {
    const me = await req('/api/user/me', 'GET', null, true);
    currentUser.balance = me.balance;
    localStorage.setItem('ksl_user', JSON.stringify(currentUser));
    // Update ALL balance display elements across all screens
    ['depositBal','dbBal','navBalance','vaWalletBal','plWalletBal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt(me.balance);
    });
    showToast('Balance refreshed');
  } catch {}
}
// Runs quietly in the background for logged-in users — updates the balance the moment admin
// credits funds (or anything else changes it) without the user needing to tap Refresh themselves.
// Only speaks up with a toast when the balance actually went UP, since that's the one case worth
// interrupting someone for; every other tick is silent.
async function silentBalancePoll() {
  if (!token || !currentUser) return;
  try {
    const me = await req('/api/user/me', 'GET', null, true, false, true); // silent=true — runs every 20s in the background; a transient miss isn't worth logging
    const before = currentUser.balance || 0;
    if (me.balance !== before) {
      currentUser.balance = me.balance;
      localStorage.setItem('ksl_user', JSON.stringify(currentUser));
      const navEl = document.getElementById('navBalance');
      if (navEl) navEl.textContent = fmt(me.balance);
      ['depositBal','dbBal','vaWalletBal','plWalletBal'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = fmt(me.balance);
      });
      const dbEl = document.getElementById('dbBal');
      if (dbEl) dbEl.textContent = fmt(me.balance);
      if (me.balance > before) maybeToastDeposit(me.balance - before);
    }
  } catch (e) { /* silent — this is a background convenience, not a critical action */ }
}


// ══════════════════════════════════════════════════════════════════════════════
// FORGOT / RESET PASSWORD (login page only)
// Two steps in one box: request a 6-digit code by email, then use that code to
// set a new password. We deliberately never say whether an email is registered.
// ══════════════════════════════════════════════════════════════════════════════
function openForgotPassword() {
  const box = document.getElementById('forgotBox');
  if (!box) return;
  box.style.display = 'block';
  document.getElementById('forgotStep1').style.display = 'block';
  document.getElementById('forgotStep2').style.display = 'none';
  setForgotFeedback('');
  const typed = (document.getElementById('loginEmail') || {}).value || '';
  const fEmail = document.getElementById('forgotEmail');
  if (fEmail && typed && !fEmail.value) fEmail.value = typed;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (fEmail) fEmail.focus();
}
function closeForgotPassword() {
  const box = document.getElementById('forgotBox');
  if (box) box.style.display = 'none';
  setForgotFeedback('');
}
function setForgotFeedback(msg, kind) {
  const el = document.getElementById('forgotFeedback');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'form-feedback' + (msg ? (kind === 'error' ? ' error' : ' success') : '');
  el.style.display = msg ? 'block' : 'none';
}
async function sendResetCode(isResend) {
  const emailEl = document.getElementById('forgotEmail');
  const email = (emailEl?.value || '').trim();
  if (!email || !email.includes('@')) return setForgotFeedback('Enter a valid email address', 'error');
  const btn = document.getElementById(isResend ? 'resetBtn' : 'forgotBtn');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const r = await req('/api/auth/forgot-password', 'POST', { email });
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
    const tgt = document.getElementById('forgotTargetEmail');
    if (tgt) tgt.textContent = email;
    setForgotFeedback(r.message || 'Reset code sent. Check your inbox — and your spam folder.', 'success');
    const codeEl = document.getElementById('resetCode');
    if (codeEl) codeEl.focus();
  } catch (e) {
    setForgotFeedback(e.message || 'Could not send the reset code', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
async function submitNewPassword() {
  const email = (document.getElementById('forgotEmail')?.value || '').trim();
  const code  = (document.getElementById('resetCode')?.value || '').trim();
  const pass  = document.getElementById('resetPass')?.value || '';
  const pass2 = document.getElementById('resetPass2')?.value || '';
  if (code.length !== 6) return setForgotFeedback('Enter the 6-digit code from the email', 'error');
  if (pass.length < 6)   return setForgotFeedback('Password must be at least 6 characters', 'error');
  if (pass !== pass2)    return setForgotFeedback('The two passwords do not match', 'error');
  const btn = document.getElementById('resetBtn');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const r = await req('/api/auth/reset-password-with-code', 'POST', { email, code, newPassword: pass });
    setForgotFeedback(r.message || 'Password updated. You can log in now.', 'success');
    showToast('Password updated — please log in');
    setTimeout(() => {
      closeForgotPassword();
      const le = document.getElementById('loginEmail'); if (le) le.value = email;
      const lp = document.getElementById('loginPass');  if (lp) { lp.value = ''; lp.focus(); }
    }, 1200);
  } catch (e) {
    setForgotFeedback(e.message || 'Could not reset your password', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DEVICES & ACCOUNT INFO (Settings page)
// Shows when the account was created and every device currently signed in, with
// the 24-hour rule: a brand-new device can't sign out devices older than itself.
// ══════════════════════════════════════════════════════════════════════════════
function timeAgo(d) {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const dd = Math.floor(h / 24);
  return `${dd} day${dd > 1 ? 's' : ''} ago`;
}
function prettyDate(d) {
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}
async function loadSecurityPanel() {
  const wrap = document.getElementById('devicesList');
  if (!wrap || !token) return;
  wrap.innerHTML = '<p class="mgid-hint">Loading your devices…</p>';
  try {
    const s = await req('/api/user/security', 'GET', null, true);
    const created = document.getElementById('accountCreatedAt');
    if (created && s.accountCreatedAt) {
      created.innerHTML = `📅 ${prettyDate(s.accountCreatedAt)} <span class="mgid-hint">(${timeAgo(s.accountCreatedAt)})</span>`;
    }
    const note = document.getElementById('devicesRuleNote');
    if (note) {
      note.textContent = s.canEndOlderSessions
        ? `You can sign out any other device from here.`
        : `This device signed in recently, so for your security it can only sign out devices that logged in after it. Full access in about ${s.hoursUntilCanEndOlder} hour(s).`;
    }
    const others = s.sessions.filter(x => !x.current).length;
    const allBtn = document.getElementById('revokeOthersBtn');
    if (allBtn) allBtn.style.display = others ? 'inline-flex' : 'none';

    wrap.innerHTML = s.sessions.map(x => `
      <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="min-width:0">
          <div style="font-weight:700">${esc(x.device)} ${x.current ? '<span style="font-size:.7rem;padding:2px 8px;border-radius:999px;background:#dcfce7;color:#166534;margin-left:6px">This device</span>' : ''}</div>
          <div class="mgid-hint" style="margin-top:2px">
            ${esc(x.ip || 'Unknown IP')} · active ${timeAgo(x.lastSeenAt)} · signed in ${prettyDate(x.createdAt)}
          </div>
        </div>
        ${x.current ? '' : `<button class="btn-secondary" style="white-space:nowrap" onclick="revokeSession('${x.id}')">Sign out</button>`}
      </div>`).join('') || '<p class="mgid-hint">No active devices found.</p>';
  } catch (e) {
    wrap.innerHTML = `<p class="mgid-hint">${esc(e.message || 'Could not load your devices')}</p>`;
  }
}
async function revokeSession(id) {
  if (!await kslConfirm('Sign this device out of your account?')) return;
  try {
    const r = await req(`/api/user/security/sessions/${id}/revoke`, 'POST', null, true);
    showToast(r.message || 'Device signed out');
  } catch (e) { showToast(e.message || 'Could not sign that device out'); }
  loadSecurityPanel();
}
async function revokeOtherSessions() {
  if (!await kslConfirm('Sign out every other device on your account?')) return;
  try {
    const r = await req('/api/user/security/sessions/revoke-others', 'POST', null, true);
    showToast(r.message || 'Other devices signed out');
  } catch (e) { showToast(e.message || 'Could not sign the other devices out'); }
  loadSecurityPanel();
}


/* ─── Marvel Nums presence heartbeat ────────────────────────────────────────────────
 * Pings the server every 60 s while a page is open so that anyone reading the
 * site counts as "online" in the admin panel — including accounts created
 * before activity tracking existed, which otherwise never showed up there.
 */
(function klsHeartbeat() {
  const ping = async () => {
    const t = localStorage.getItem('ksl_token');
    if (!t || document.hidden) return;
    try {
      const r = await fetch('/api/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
      console.log('[Marvel Nums] heartbeat', r.status);
    } catch (e) { console.warn('[Marvel Nums] heartbeat failed', e.message); }
  };
  ping();
  setInterval(ping, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
})();
