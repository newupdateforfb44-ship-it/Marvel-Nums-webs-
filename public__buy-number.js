
function PRICE(n) { return window.KLSMoney ? window.KLSMoney.price(n) : '₦' + Number(n || 0).toLocaleString('en-NG'); }
function AMT(n)   { return window.KLSMoney ? window.KLSMoney.amount(n) : '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// ══════════════════════ BUY NUMBERS PAGE ══════════════════════
// Standalone page logic (loaded after script.js, which provides req(), fmtN(), showToast(), etc.)

// Flip this to false once real stock is ready to go live — until then the page always shows the
// "Under Construction" message, regardless of whatever's in the database.
const NUMBERS_UNDER_CONSTRUCTION = false;

let numOptions = [];       // raw list from /api/numbers/options: [{provider, country, price, available}]
let numPollTimer = null;
let numCurrentOrder = null; // {orderId, phoneNumber, code, expiresAt}

async function initBuyNumberPage() {
  await loadNumOptions();
  await loadNumOrders();
}

async function loadNumOptions() {
  const providerSelect = document.getElementById('numProviderSelect');
  const emptyState = document.getElementById('numEmptyState');
  const pickerForm = document.getElementById('numPickerForm');
  if (NUMBERS_UNDER_CONSTRUCTION) {
    emptyState.style.display = 'block';
    pickerForm.style.display = 'none';
    return;
  }
  try {
    numOptions = await req('/api/numbers/options', 'GET', null, false);
    const providers = [...new Set(numOptions.map(o => o.provider))];
    if (!providers.length) {
      emptyState.style.display = 'block';
      pickerForm.style.display = 'none';
      return;
    }
    emptyState.style.display = 'none';
    pickerForm.style.display = 'block';
    providerSelect.innerHTML = '<option value="">Select a provider…</option>' +
      providers.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  } catch (e) {
    emptyState.style.display = 'block';
    pickerForm.style.display = 'none';
  }
}

function onNumProviderChange() {
  const provider = document.getElementById('numProviderSelect').value;
  const countrySelect = document.getElementById('numCountrySelect');
  const priceBox = document.getElementById('numPriceBox');
  const buyBtn = document.getElementById('numBuyBtn');
  priceBox.style.display = 'none';
  buyBtn.disabled = true;
  if (!provider) {
    countrySelect.innerHTML = '<option value="">Select a provider first</option>';
    countrySelect.disabled = true;
    return;
  }
  const countries = numOptions.filter(o => o.provider === provider);
  countrySelect.innerHTML = '<option value="">Select a country…</option>' +
    countries.map(c => `<option value="${esc(c.country)}">${esc(c.country)}</option>`).join('');
  countrySelect.disabled = false;
}

function onNumCountryChange() {
  const provider = document.getElementById('numProviderSelect').value;
  const country = document.getElementById('numCountrySelect').value;
  const priceBox = document.getElementById('numPriceBox');
  const priceDisplay = document.getElementById('numPriceDisplay');
  const buyBtn = document.getElementById('numBuyBtn');
  const match = numOptions.find(o => o.provider === provider && o.country === country);
  if (!match) { priceBox.style.display = 'none'; buyBtn.disabled = true; return; }
  priceDisplay.textContent = PRICE(match.price);
  priceBox.style.display = 'block';
  buyBtn.disabled = false;
}

async function buyNumber() {
  const provider = document.getElementById('numProviderSelect').value;
  const country = document.getElementById('numCountrySelect').value;
  const fb = document.getElementById('numFeedback');
  const btn = document.getElementById('numBuyBtn');
  if (!provider || !country) return setFb(fb, 'Please select a provider and country', 'err');

  btn.disabled = true; btn.textContent = 'Processing…'; setFb(fb, '', '');
  try {
    const order = await req('/api/numbers/buy', 'POST', { provider, country }, true);
    setFb(fb, '', '');
    showNumWaitStep(order);
    refreshBalance?.();
  } catch (e) {
    if (/insufficient balance/i.test(e.message)) {
      fb.innerHTML = `<svg class="icon i-x-circle" aria-hidden="true"><use href="#i-x-circle"/></svg> ${esc(e.message)} — <a href="/deposit" style="color:var(--gold);text-decoration:underline">fund your wallet</a>`;
      fb.className = 'fb err';
    } else {
 setFb(fb, ' ' + e.message, 'err');
    }
  } finally {
 btn.disabled = false; btn.textContent = ' Buy This Number';
  }
}

function showNumWaitStep(order) {
  numCurrentOrder = order;
  document.getElementById('numPickStep').style.display = 'none';
  document.getElementById('numWaitStep').style.display = 'block';
  document.getElementById('numPhoneDisplay').textContent = order.phoneNumber;
  document.getElementById('numCodeBox').style.display = 'none';
  document.getElementById('numCopyBtn').style.display = 'inline-block';
 document.getElementById('numCopyBtn').textContent = ' Copy Number';
  document.getElementById('numCancelBtn').style.display = 'inline-block';
  const statusNote = document.getElementById('numStatusNote');
  statusNote.textContent = '⏳ Waiting for your code…';
  statusNote.className = 'info-note';
  updateNumExpiryNote(order.expiresAt);
  clearInterval(numPollTimer);
  numPollTimer = setInterval(() => pollNumberStatus(order.orderId), 5000);
  pollNumberStatus(order.orderId);
}

function updateNumExpiryNote(expiresAt) {
  const el = document.getElementById('numExpiryNote');
  if (!el || !expiresAt) return;
  const mins = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000));
  el.textContent = mins > 0 ? `About ${mins} minute${mins === 1 ? '' : 's'} left to receive your code.` : 'Time is up — waiting on final check…';
}

async function pollNumberStatus(orderId) {
  const statusNote = document.getElementById('numStatusNote');
  try {
    const data = await req(`/api/numbers/status/${orderId}`, 'GET', null, true);
    updateNumExpiryNote(data.expiresAt);
    if (data.status === 'delivered') {
      clearInterval(numPollTimer);
      numCurrentOrder.code = data.code;
      document.getElementById('numCodeBox').style.display = 'block';
      document.getElementById('numCodeDisplay').textContent = data.code;
 document.getElementById('numCopyBtn').textContent = ' Copy Code';
      document.getElementById('numCancelBtn').style.display = 'none';
 statusNote.textContent = ' Code received!';
      statusNote.className = 'info-note ok';
      loadNumOrders();
    } else if (data.status === 'expired') {
      clearInterval(numPollTimer);
      document.getElementById('numCancelBtn').style.display = 'none';
      statusNote.textContent = '⏱ This number expired without receiving a code — refunded to your wallet.';
      statusNote.className = 'info-note ok';
      refreshBalance?.();
      loadNumOrders();
    }
  } catch (e) { /* transient poll errors are silent — next tick retries */ }
}

async function cancelNumberOrder() {
  if (!numCurrentOrder) return;
  const statusNote = document.getElementById('numStatusNote');
  const cancelBtn = document.getElementById('numCancelBtn');
  if (!await kslConfirm('Cancel this number and get refunded? You will not be able to receive a code on it afterward.')) return;
  cancelBtn.disabled = true; cancelBtn.textContent = 'Cancelling…';
  try {
    await req(`/api/numbers/cancel/${numCurrentOrder.orderId}`, 'POST', null, true);
    clearInterval(numPollTimer);
 statusNote.textContent = ' Cancelled — refunded to your wallet.';
    statusNote.className = 'info-note ok';
    refreshBalance?.();
    loadNumOrders();
  } catch (e) {
 showToast(' ' + e.message, 'err');
  } finally {
 cancelBtn.disabled = false; cancelBtn.textContent = ' Cancel & Refund';
  }
}

function copyNumberOrCode() {
  if (!numCurrentOrder) return;
  const text = numCurrentOrder.code || numCurrentOrder.phoneNumber;
  navigator.clipboard?.writeText(text).then(() => showToast('Copied')).catch(() => {});
}

function resetNumberFlow() {
  clearInterval(numPollTimer);
  numCurrentOrder = null;
  document.getElementById('numWaitStep').style.display = 'none';
  document.getElementById('numPickStep').style.display = 'block';
  document.getElementById('numProviderSelect').value = '';
  document.getElementById('numCountrySelect').innerHTML = '<option value="">Select a provider first</option>';
  document.getElementById('numCountrySelect').disabled = true;
  document.getElementById('numPriceBox').style.display = 'none';
  document.getElementById('numBuyBtn').disabled = true;
  loadNumOptions();
}

async function loadNumOrders() {
  const list = document.getElementById('numOrdersList');
  try {
    const orders = await req('/api/numbers/my-orders', 'GET', null, true);
    if (!orders.length) { list.innerHTML = '<p style="color:var(--t2);font-size:.9rem">No purchases yet.</p>'; return; }
    list.innerHTML = orders.map(o => `
      <div class="dcb-row" style="border-bottom:1px solid var(--border2);padding:10px 0">
        <span>${esc(o.provider)} — ${esc(o.country)}<br><span style="color:var(--t2);font-size:.8rem">${esc(o.phoneNumber)} · ${new Date(o.createdAt).toLocaleDateString('en-NG',{day:'numeric',month:'short'})}</span></span>
        <b style="color:${o.status === 'delivered' ? 'var(--green)' : o.status === 'expired' ? 'var(--t2)' : 'var(--t2)'}">${o.status === 'delivered' ? o.code : o.status === 'expired' ? 'Expired (refunded)' : 'Pending'}</b>
      </div>
    `).join('');
  } catch (e) { /* leave default message */ }
}
