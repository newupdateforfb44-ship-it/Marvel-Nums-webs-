(function () {
  const token = localStorage.getItem('ksl_token');
  const log = document.getElementById('liveSupportLog');
  const input = document.getElementById('liveSupportInput');
  const send = document.getElementById('liveSupportSend');
  const statusEl = document.getElementById('liveSupportStatus');
  const closeBtn = document.getElementById('liveSupportClose');
  const imageInput = document.getElementById('liveSupportImage');
  const imageName = document.getElementById('liveSupportImageName');
  const attach = document.getElementById('liveSupportAttach');
  if (!log || !input) return;
  if (!token) { input.disabled = true; if (send) send.disabled = true; statusEl.textContent = 'Log in required'; return; }

  const esc = value => String(value || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  let conversationStatus = 'open';
  let lastAdminId = '';
  let loading = false;

  async function request(path, options) {
    const isForm = options && options.body instanceof FormData;
    const response = await fetch(path, { ...options, headers: { Authorization: 'Bearer ' + token, ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options && options.headers) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Support is unavailable');
    return data;
  }
  function paintStatus(status) {
    conversationStatus = status || 'open';
    const closed = conversationStatus === 'closed';
    statusEl.textContent = closed ? 'Conversation closed' : 'Support online';
    statusEl.classList.toggle('closed', closed);
    input.disabled = closed; if (send) send.disabled = closed; if (attach) attach.disabled = closed;
    closeBtn.hidden = false; closeBtn.textContent = closed ? 'Reopen chat' : 'Close chat';
    input.placeholder = closed ? 'Reopen this chat to send a message' : 'Write a message…';
  }
  function notifyReply(row) {
    if (!row || document.visibilityState === 'visible' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification('King Social Hub Support replied', { body: (row.text || 'Sent an image').slice(0, 120) });
  }
  async function load(initial) {
    if (loading) return; loading = true;
    try {
      const data = await request('/api/support/live');
      const rows = data.messages || [];
      const latestAdmin = [...rows].reverse().find(row => row.sender === 'admin');
      if (!initial && latestAdmin && lastAdminId && String(latestAdmin._id) !== lastAdminId) notifyReply(latestAdmin);
      if (latestAdmin) lastAdminId = String(latestAdmin._id);
      log.innerHTML = rows.length ? rows.map(row => `<div class="live-support-msg ${row.sender}">${row.attachmentUrl ? `<a href="${esc(row.attachmentUrl)}" target="_blank" rel="noopener"><img src="${esc(row.attachmentUrl)}" alt="Support attachment" style="display:block;max-width:240px;width:100%;border-radius:8px;margin-bottom:${row.text?'7px':'0'}"/></a>` : ''}${esc(row.text)}<small style="display:block;opacity:.65;margin-top:4px">${esc(row.senderName || (row.sender === 'admin' ? 'King Social Hub Support' : 'You'))} · ${new Date(row.createdAt).toLocaleString()}</small></div>`).join('') : '<span style="color:var(--t2)">Send your first message. Our support team will reply here.</span>';
      log.scrollTop = log.scrollHeight; paintStatus(data.status);
    } catch (error) { if (window.showToast) showToast(error.message, 'error'); }
    finally { loading = false; }
  }
  window.toggleLiveSupportStatus = async function () {
    const next = conversationStatus === 'closed' ? 'open' : 'closed';
    if (next === 'closed' && !await kslConfirm('Close this support conversation? You can reopen it later.')) return;
    try { await request('/api/support/live/status', { method: 'POST', body: JSON.stringify({ status: next }) }); await load(false); }
    catch (error) { if (window.showToast) showToast(error.message, 'error'); }
  };
  window.sendLiveSupport = async function () {
    const text = input.value.trim(); const file = imageInput?.files?.[0]; if ((!text && !file) || conversationStatus === 'closed') return;
    if (file && file.size > 10 * 1024 * 1024) { if (window.showToast) showToast('Image must be under 10MB', 'error'); return; }
    input.disabled = true; if (send) send.disabled = true;
    const body = new FormData(); body.append('text', text); if (file) body.append('attachment', file);
    try { await request('/api/support/live', { method: 'POST', body }); input.value = ''; if (imageInput) imageInput.value=''; if(imageName) imageName.textContent=''; await load(false); }
    catch (error) { if (window.showToast) showToast(error.message, 'error'); }
    finally { paintStatus(conversationStatus); input.focus(); }
  };
  window.previewLiveSupportImage = function(){ if(imageName) imageName.textContent = imageInput?.files?.[0] ? '📷 '+imageInput.files[0].name : ''; };
  if ('Notification' in window && Notification.permission === 'default') input.addEventListener('focus', () => Notification.requestPermission().catch(() => {}), { once: true });
  load(true); setInterval(() => { if (!document.hidden) load(false); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
})();