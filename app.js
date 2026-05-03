// ═══════════════════════════════════════
// SpendWise — Main App
// ═══════════════════════════════════════

import { auth, db, googleProvider } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, setDoc, getDoc, getDocs,
  addDoc, deleteDoc, updateDoc, onSnapshot,
  query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── STATE ──────────────────────────────
let currentUser = null;
let expenses = [];
let wallet = { bank: 0, cash: 0 };
let budget = { monthly: 0, categories: {} };
let unsubExpenses = null;
let unsubWallet = null;
let unsubBudget = null;
let currentPeriod = 'month';

// ── CATEGORY EMOJI MAP ─────────────────
const CAT_EMOJI = {
  Food: '🍔', Transport: '🚗', Shopping: '🛍️', Health: '💊',
  Entertainment: '🎬', Bills: '💡', Education: '📚', Travel: '✈️',
  Groceries: '🛒', Other: '📦'
};
const CAT_COLORS = [
  '#f97316','#60a5fa','#a78bfa','#34d399','#fbbf24',
  '#f87171','#22d3ee','#818cf8','#a3e635','#94a3b8'
];

// ── TOAST ──────────────────────────────
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.classList.add('hidden'), 200);
  }, duration);
}

// ── FORMAT CURRENCY ────────────────────
function fmt(n) {
  const num = parseFloat(n) || 0;
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ── DATE UTILS ────────────────────────
function todayISO() { return new Date().toISOString().split('T')[0]; }

function getStartOf(period) {
  const now = new Date();
  if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0,0,0,0);
    return d;
  } else if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    return new Date(now.getFullYear(), 0, 1);
  }
}

function filterByPeriod(list, period) {
  const start = getStartOf(period);
  return list.filter(e => new Date(e.date) >= start);
}

// ── SYNC INDICATOR ────────────────────
function setSyncStatus(status) {
  const dot = document.getElementById('sync-indicator');
  dot.className = 'sync-dot ' + status;
  dot.title = status === 'online' ? 'Synced' : status === 'offline' ? 'Offline – data saved locally' : 'Syncing…';
}

window.addEventListener('online', () => setSyncStatus('online'));
window.addEventListener('offline', () => setSyncStatus('offline'));
if (!navigator.onLine) setSyncStatus('offline');

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

// Tab switching
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-form').classList.add('active');
    document.getElementById('auth-error').textContent = '';
  });
});

function authError(msg) {
  document.getElementById('auth-error').textContent = msg;
}

// Sign up
document.getElementById('signup-btn').addEventListener('click', async () => {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pw = document.getElementById('signup-password').value;
  if (!name || !email || !pw) return authError('All fields required.');
  if (pw.length < 6) return authError('Password must be 6+ characters.');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await updateProfile(cred.user, { displayName: name });
  } catch (e) {
    authError(e.message.replace('Firebase: ', ''));
  }
});

// Sign in
document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-password').value;
  if (!email || !pw) return authError('Enter email and password.');
  try {
    await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) {
    authError(e.message.replace('Firebase: ', ''));
  }
});

// Google auth
async function googleAuth() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    authError(e.message.replace('Firebase: ', ''));
  }
}
document.getElementById('google-login-btn').addEventListener('click', googleAuth);
document.getElementById('google-signup-btn').addEventListener('click', googleAuth);

// Sign out
document.getElementById('signout-btn').addEventListener('click', async () => {
  if (!confirm('Sign out?')) return;
  cleanup();
  await signOut(auth);
});

// Clear data
document.getElementById('clear-data-btn').addEventListener('click', async () => {
  if (!confirm('Delete all your data? This cannot be undone.')) return;
  const batch = writeBatch(db);
  expenses.forEach(e => batch.delete(doc(db, `users/${currentUser.uid}/expenses`, e.id)));
  batch.set(doc(db, `users/${currentUser.uid}/wallet`, 'main'), { bank: 0, cash: 0 });
  batch.set(doc(db, `users/${currentUser.uid}/budget`, 'main'), { monthly: 0, categories: {} });
  await batch.commit();
  showToast('All data cleared.');
});

// Auth state
onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('user-display-name').textContent = user.displayName || user.email;
    startListeners();
  } else {
    currentUser = null;
    cleanup();
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
  }
});

function cleanup() {
  if (unsubExpenses) unsubExpenses();
  if (unsubWallet) unsubWallet();
  if (unsubBudget) unsubBudget();
  expenses = [];
  wallet = { bank: 0, cash: 0 };
  budget = { monthly: 0, categories: {} };
}

// ─────────────────────────────────────────────
// FIRESTORE LISTENERS (real-time + offline)
// ─────────────────────────────────────────────

function startListeners() {
  const uid = currentUser.uid;

  // Expenses
  const expQ = query(collection(db, `users/${uid}/expenses`), orderBy('date', 'desc'));
  unsubExpenses = onSnapshot(expQ, snap => {
    expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHome();
    renderAnalytics();
    renderWallet();
    renderBudgetBreakdown();
  });

  // Wallet
  unsubWallet = onSnapshot(doc(db, `users/${uid}/wallet`, 'main'), snap => {
    if (snap.exists()) {
      wallet = snap.data();
    } else {
      wallet = { bank: 0, cash: 0 };
    }
    renderWalletCards();
    renderHome();
  });

  // Budget
  unsubBudget = onSnapshot(doc(db, `users/${uid}/budget`, 'main'), snap => {
    if (snap.exists()) {
      budget = snap.data();
    } else {
      budget = { monthly: 0, categories: {} };
    }
    document.getElementById('monthly-budget-input').value = budget.monthly || '';
    renderBudgetCatList();
    renderBudgetBreakdown();
    renderHome();
  });
}

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────

let currentPage = 'home';

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.page));
});

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  currentPage = page;
  if (page === 'add') {
    document.getElementById('f-date').value = todayISO();
    document.getElementById('f-amount').focus();
  }
  if (page === 'analytics') renderAnalytics();
  if (page === 'wallet') renderWallet();
  if (page === 'budget') renderBudgetBreakdown();
}

// ─────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────

function renderHome() {
  const total = (wallet.bank || 0) + (wallet.cash || 0);
  document.getElementById('total-balance').textContent = fmt(total);
  document.getElementById('bank-balance-home').textContent = fmt(wallet.bank);
  document.getElementById('cash-balance-home').textContent = fmt(wallet.cash);

  // Budget strip
  const monthExp = filterByPeriod(expenses, 'month');
  const totalSpent = monthExp.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const monthlyBudget = budget.monthly || 0;
  const strip = document.getElementById('budget-strip');
  if (monthlyBudget > 0) {
    const pct = Math.min((totalSpent / monthlyBudget) * 100, 100);
    const fill = document.getElementById('budget-bar-fill');
    fill.style.width = pct + '%';
    fill.classList.remove('warn', 'over');
    if (pct >= 100) fill.classList.add('over');
    else if (pct >= 80) fill.classList.add('warn');
    document.getElementById('budget-strip-text').textContent = fmt(totalSpent) + ' / ' + fmt(monthlyBudget);
    strip.style.display = 'block';
  } else {
    strip.style.display = 'none';
  }

  // Dues
  const dues = expenses.filter(e => e.splitName && !e.splitResolved && parseFloat(e.splitAmount) > 0);
  const totalDue = dues.reduce((s, e) => s + parseFloat(e.splitAmount || 0), 0);
  const duesRow = document.getElementById('dues-row');
  if (dues.length > 0) {
    duesRow.classList.remove('hidden');
    document.getElementById('dues-text').textContent = `${dues.length} pending split${dues.length > 1 ? 's' : ''} · ${fmt(totalDue)} owed to you`;
  } else {
    duesRow.classList.add('hidden');
  }

  // Recent list
  renderTxList(document.getElementById('recent-list'), expenses.slice(0, 8));
}

document.getElementById('dues-row').addEventListener('click', () => navigate('wallet'));
document.getElementById('view-all-btn').addEventListener('click', openAllTx);
document.getElementById('edit-wallet-btn').addEventListener('click', () => navigate('wallet'));

// ─────────────────────────────────────────────
// TRANSACTION LIST RENDERER
// ─────────────────────────────────────────────

function renderTxList(container, list) {
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><span>No spends yet</span><p>Tap + to add your first expense</p></div>`;
    return;
  }
  container.innerHTML = list.map(e => {
    const catKey = (e.category || 'Other').toLowerCase().replace(/\s/g, '');
    return `
    <div class="tx-item" data-id="${e.id}">
      <div class="tx-icon cat-${catKey}">${CAT_EMOJI[e.category] || '📦'}</div>
      <div class="tx-body">
        <div class="tx-title">${e.note || e.category}</div>
        <div class="tx-meta">${e.date}${e.splitName ? ` · Split with ${e.splitName}` : ''}</div>
        ${e.splitName && !e.splitResolved ? `<span class="tx-split-badge">₹${e.splitAmount} owed</span>` : ''}
      </div>
      <div class="tx-right">
        <div class="tx-amount">-${fmt(e.amount)}</div>
        <div class="tx-mode">${e.mode}</div>
        <button class="tx-delete-btn" data-id="${e.id}">Delete</button>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.tx-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('Delete this expense?')) return;
      const exp = expenses.find(e => e.id === id);
      if (exp) {
        // Restore balance
        const delta = parseFloat(exp.amount) || 0;
        const newWallet = { ...wallet };
        if (exp.mode === 'Cash') newWallet.cash = (newWallet.cash || 0) + delta;
        else newWallet.bank = (newWallet.bank || 0) + delta;
        await saveWallet(newWallet);
      }
      await deleteDoc(doc(db, `users/${currentUser.uid}/expenses`, id));
      showToast('Expense deleted');
    });
  });
}

// All TX modal
function openAllTx() {
  document.getElementById('all-tx-modal').classList.remove('hidden');
  renderTxList(document.getElementById('all-tx-list'), expenses);
}
document.getElementById('all-tx-backdrop').addEventListener('click', () => document.getElementById('all-tx-modal').classList.add('hidden'));
document.getElementById('close-all-tx').addEventListener('click', () => document.getElementById('all-tx-modal').classList.add('hidden'));

// ─────────────────────────────────────────────
// ADD SPEND
// ─────────────────────────────────────────────

document.getElementById('f-date').value = todayISO();

document.getElementById('f-split-toggle').addEventListener('change', function() {
  document.getElementById('split-fields').classList.toggle('hidden', !this.checked);
});

document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-area').classList.toggle('hidden');
});

document.getElementById('upload-img-btn').addEventListener('click', () => {
  document.getElementById('screenshot-file').click();
});

document.getElementById('screenshot-file').addEventListener('change', async function() {
  if (!this.files.length) return;
  showToast('Processing screenshot…');
  // Load Tesseract dynamically
  if (!window.Tesseract) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    document.head.appendChild(s);
    await new Promise(r => s.onload = r);
  }
  const result = await window.Tesseract.recognize(this.files[0], 'eng');
  document.getElementById('sms-input').value = result.data.text;
  parseAndFill(result.data.text);
});

document.getElementById('parse-sms-btn').addEventListener('click', () => {
  parseAndFill(document.getElementById('sms-input').value);
});

function parseAndFill(text) {
  if (!text) return;
  // Amount patterns: Rs.450, INR 450, ₹450, Rs 450, debited 450
  const amtMatch = text.match(/(?:rs\.?|inr|₹|debited|paid|amount)[:\s]*([0-9,]+(?:\.[0-9]{1,2})?)/i)
    || text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs|inr|₹|debited|credited)/i);
  if (amtMatch) {
    document.getElementById('f-amount').value = amtMatch[1].replace(/,/g, '');
  }

  // Date patterns
  const dateMatch = text.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);
  if (dateMatch) {
    const parts = dateMatch[1].split(/[-\/]/);
    if (parts.length === 3) {
      let [d, m, y] = parts;
      if (y.length === 2) y = '20' + y;
      if (parseInt(d) > 12) { // dd/mm/yyyy
        document.getElementById('f-date').value = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      } else {
        document.getElementById('f-date').value = `${y}-${d.padStart(2,'0')}-${m.padStart(2,'0')}`;
      }
    }
  }

  // Mode
  if (/upi|gpay|phonepe|paytm|bhim/i.test(text)) document.getElementById('f-mode').value = 'UPI';
  else if (/cash/i.test(text)) document.getElementById('f-mode').value = 'Cash';
  else if (/card|debit|credit/i.test(text)) document.getElementById('f-mode').value = 'Card';
  else if (/net\s*banking|neft|imps/i.test(text)) document.getElementById('f-mode').value = 'NetBanking';

  // Note from merchant
  const merchant = text.match(/(?:to|at|for|paid to|trf to)\s+([A-Za-z][A-Za-z0-9\s]{2,20}?)(?:\s+on|\s+for|\s*$|\n)/i);
  if (merchant) document.getElementById('f-note').value = merchant[1].trim();

  document.getElementById('import-area').classList.add('hidden');
  showToast('Form filled from text!');
}

// UPI pay button
document.getElementById('upi-pay-btn').addEventListener('click', async () => {
  const amount = parseFloat(document.getElementById('f-amount').value);
  if (!amount || amount <= 0) return showToast('Enter amount first');
  const note = document.getElementById('f-note').value || document.getElementById('f-category').value;
  // Save spend first
  await doSaveSpend();
  // Build UPI deeplink
  const upiUrl = `upi://pay?am=${amount}&tn=${encodeURIComponent(note)}&cu=INR`;
  window.location.href = upiUrl;
  setTimeout(() => showToast('If UPI app didn\'t open, open it manually'), 1500);
});

// Save spend form
document.getElementById('spend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await doSaveSpend();
});

async function doSaveSpend() {
  const amount = parseFloat(document.getElementById('f-amount').value);
  const category = document.getElementById('f-category').value;
  const mode = document.getElementById('f-mode').value;
  const date = document.getElementById('f-date').value;
  const note = document.getElementById('f-note').value.trim();
  const splitOn = document.getElementById('f-split-toggle').checked;
  const splitName = splitOn ? document.getElementById('f-split-name').value.trim() : '';
  const splitAmount = splitOn ? parseFloat(document.getElementById('f-split-amount').value) || 0 : 0;

  if (!amount || amount <= 0) return showToast('Enter a valid amount');
  if (!date) return showToast('Pick a date');

  setSyncStatus('syncing');
  const spend = { amount, category, mode, date, note, splitName, splitAmount, splitResolved: false, createdAt: serverTimestamp() };

  try {
    await addDoc(collection(db, `users/${currentUser.uid}/expenses`), spend);

    // Auto deduct wallet
    const newWallet = { ...wallet };
    if (mode === 'Cash') newWallet.cash = Math.max(0, (newWallet.cash || 0) - amount);
    else newWallet.bank = Math.max(0, (newWallet.bank || 0) - amount);
    await saveWallet(newWallet);

    setSyncStatus('online');
    showToast('Spend saved ✓');

    // Reset form
    document.getElementById('spend-form').reset();
    document.getElementById('f-date').value = todayISO();
    document.getElementById('split-fields').classList.add('hidden');
    document.getElementById('import-area').classList.add('hidden');
    navigate('home');
  } catch (e) {
    setSyncStatus('offline');
    showToast('Saved offline – will sync when online');
  }
}

// ─────────────────────────────────────────────
// WALLET
// ─────────────────────────────────────────────

async function saveWallet(w) {
  wallet = w;
  await setDoc(doc(db, `users/${currentUser.uid}/wallet`, 'main'), w);
  renderWalletCards();
  renderHome();
}

function renderWalletCards() {
  document.getElementById('bank-amount-display').textContent = fmt(wallet.bank);
  document.getElementById('cash-amount-display').textContent = fmt(wallet.cash);
}

// Wallet action buttons
document.querySelectorAll('.btn-wallet-action').forEach(btn => {
  btn.addEventListener('click', () => openWalletModal(btn.dataset.type, btn.dataset.op));
});

let modalCtx = { type: 'bank', op: 'add' };

function openWalletModal(type, op) {
  modalCtx = { type, op };
  const isBank = type === 'bank';
  document.getElementById('wallet-modal-title').textContent = op === 'add'
    ? `Add to ${isBank ? 'Bank' : 'Cash'}`
    : `Set ${isBank ? 'Bank' : 'Cash'} Balance`;
  document.getElementById('wallet-modal-label').textContent = op === 'add' ? 'Amount to add (₹)' : 'New balance (₹)';
  document.getElementById('wallet-modal-input').value = '';
  document.getElementById('wallet-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('wallet-modal-input').focus(), 100);
}

document.getElementById('wallet-modal-save').addEventListener('click', async () => {
  const val = parseFloat(document.getElementById('wallet-modal-input').value);
  if (isNaN(val) || val < 0) return showToast('Enter a valid amount');
  const newWallet = { ...wallet };
  const key = modalCtx.type;
  newWallet[key] = modalCtx.op === 'add' ? (newWallet[key] || 0) + val : val;
  await saveWallet(newWallet);
  closeWalletModal();
  showToast('Wallet updated ✓');
});

document.getElementById('wallet-modal-cancel').addEventListener('click', closeWalletModal);
document.getElementById('wallet-modal-backdrop').addEventListener('click', closeWalletModal);
function closeWalletModal() { document.getElementById('wallet-modal').classList.add('hidden'); }

// Render dues
function renderWallet() {
  renderWalletCards();
  const dues = expenses.filter(e => e.splitName && !e.splitResolved && parseFloat(e.splitAmount) > 0);
  const duesList = document.getElementById('dues-list');
  if (!dues.length) {
    duesList.innerHTML = '<div class="empty-state"><span>No pending dues</span></div>';
  } else {
    duesList.innerHTML = dues.map(e => `
      <div class="due-item" style="flex-direction:column;align-items:flex-start">
        <div style="display:flex;justify-content:space-between;width:100%">
          <span class="due-name">${e.splitName}</span>
          <span class="due-amount">${fmt(e.splitAmount)}</span>
        </div>
        <div class="due-meta" style="font-size:12px;color:var(--text-2);margin:4px 0">${e.note || e.category} · ${e.date}</div>
        <div class="due-actions">
          <button class="due-resolve-btn" data-id="${e.id}">Mark Paid</button>
          <button class="due-wa-btn" data-name="${e.splitName}" data-amt="${e.splitAmount}">WhatsApp Remind</button>
        </div>
      </div>`).join('');

    duesList.querySelectorAll('.due-resolve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateDoc(doc(db, `users/${currentUser.uid}/expenses`, btn.dataset.id), { splitResolved: true });
        showToast('Marked as paid ✓');
      });
    });
    duesList.querySelectorAll('.due-wa-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = encodeURIComponent(`Hey ${btn.dataset.name}, just a reminder that you owe me ₹${btn.dataset.amt}. Please settle when convenient 🙏`);
        window.open(`https://wa.me/?text=${msg}`, '_blank');
      });
    });
  }

  // Ledger: last 20 expenses
  renderTxList(document.getElementById('ledger-list'), expenses.slice(0, 20));
}

// ─────────────────────────────────────────────
// BUDGET
// ─────────────────────────────────────────────

async function saveBudget(b) {
  budget = b;
  await setDoc(doc(db, `users/${currentUser.uid}/budget`, 'main'), b);
}

document.getElementById('save-budget-btn').addEventListener('click', async () => {
  const val = parseFloat(document.getElementById('monthly-budget-input').value);
  if (!val || val < 0) return showToast('Enter a valid budget');
  await saveBudget({ ...budget, monthly: val });
  showToast('Budget saved ✓');
  renderHome();
  renderBudgetBreakdown();
});

document.getElementById('add-cat-budget-btn').addEventListener('click', () => {
  const cats = Object.keys(CAT_EMOJI);
  const div = document.createElement('div');
  div.className = 'cat-budget-item';
  div.innerHTML = `
    <select class="cb-cat">${cats.map(c => `<option>${c}</option>`).join('')}</select>
    <input type="number" class="cb-amt" placeholder="Limit ₹" inputmode="decimal" style="flex:1"/>
    <button class="cat-budget-remove">×</button>`;
  div.querySelector('.cat-budget-remove').addEventListener('click', () => div.remove());
  div.querySelector('.cb-amt').addEventListener('change', saveCatBudgets);
  div.querySelector('.cb-cat').addEventListener('change', saveCatBudgets);
  document.getElementById('cat-budget-list').appendChild(div);
});

async function saveCatBudgets() {
  const cats = {};
  document.querySelectorAll('.cat-budget-item').forEach(item => {
    const cat = item.querySelector('.cb-cat').value;
    const amt = parseFloat(item.querySelector('.cb-amt').value);
    if (cat && amt > 0) cats[cat] = amt;
  });
  await saveBudget({ ...budget, categories: cats });
}

function renderBudgetCatList() {
  const list = document.getElementById('cat-budget-list');
  list.innerHTML = '';
  const cats = Object.keys(CAT_EMOJI);
  Object.entries(budget.categories || {}).forEach(([cat, limit]) => {
    const div = document.createElement('div');
    div.className = 'cat-budget-item';
    div.innerHTML = `
      <select class="cb-cat">${cats.map(c => `<option${c===cat?' selected':''}>${c}</option>`).join('')}</select>
      <input type="number" class="cb-amt" placeholder="Limit ₹" value="${limit}" inputmode="decimal" style="flex:1"/>
      <button class="cat-budget-remove">×</button>`;
    div.querySelector('.cat-budget-remove').addEventListener('click', () => { div.remove(); saveCatBudgets(); });
    div.querySelector('.cb-amt').addEventListener('change', saveCatBudgets);
    div.querySelector('.cb-cat').addEventListener('change', saveCatBudgets);
    list.appendChild(div);
  });
}

function renderBudgetBreakdown() {
  const monthExp = filterByPeriod(expenses, 'month');
  const byCategory = {};
  monthExp.forEach(e => {
    byCategory[e.category] = (byCategory[e.category] || 0) + parseFloat(e.amount || 0);
  });

  const totalSpent = Object.values(byCategory).reduce((s, v) => s + v, 0);
  const monthlyBudget = budget.monthly || 0;

  const container = document.getElementById('budget-breakdown');
  if (!Object.keys(byCategory).length) {
    container.innerHTML = '<div class="empty-state"><span>No spends this month</span></div>';
    return;
  }

  let html = '';
  if (monthlyBudget > 0) {
    const pct = Math.min((totalSpent / monthlyBudget) * 100, 100);
    html += `
    <div class="budget-cat-item">
      <div class="budget-cat-header">
        <span class="budget-cat-name">Overall</span>
        <span class="budget-cat-val">${fmt(totalSpent)} / ${fmt(monthlyBudget)}</span>
      </div>
      <div class="budget-cat-bar"><div class="budget-cat-fill${pct >= 100 ? ' over' : pct >= 80 ? ' warn' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }

  Object.entries(byCategory).forEach(([cat, spent]) => {
    const limit = (budget.categories || {})[cat];
    const hasLimit = limit && limit > 0;
    const pct = hasLimit ? Math.min((spent / limit) * 100, 100) : 0;
    html += `
    <div class="budget-cat-item">
      <div class="budget-cat-header">
        <span class="budget-cat-name">${CAT_EMOJI[cat] || '📦'} ${cat}</span>
        <span class="budget-cat-val">${fmt(spent)}${hasLimit ? ' / ' + fmt(limit) : ''}</span>
      </div>
      ${hasLimit ? `<div class="budget-cat-bar"><div class="budget-cat-fill${pct >= 100 ? ' over' : pct >= 80 ? ' warn' : ''}" style="width:${pct}%"></div></div>` : ''}
    </div>`;
  });

  container.innerHTML = html;
}

// ─────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────

let pieChart = null;
let barChart = null;

document.querySelectorAll('.period-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    renderAnalytics();
  });
});

async function renderAnalytics() {
  if (currentPage !== 'analytics' && document.getElementById('page-analytics').classList.contains('active') === false) return;

  if (!window.Chart) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js';
    document.head.appendChild(s);
    await new Promise(r => s.onload = r);
  }

  const filtered = filterByPeriod(expenses, currentPeriod);
  const totalSpent = filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const days = Math.max(1, Math.ceil((new Date() - getStartOf(currentPeriod)) / 86400000));

  document.getElementById('stat-total').textContent = fmt(totalSpent);
  document.getElementById('stat-avg').textContent = fmt(totalSpent / days);
  document.getElementById('stat-count').textContent = filtered.length;

  // By category
  const byCategory = {};
  filtered.forEach(e => {
    byCategory[e.category] = (byCategory[e.category] || 0) + parseFloat(e.amount || 0);
  });
  const catLabels = Object.keys(byCategory);
  const catVals = Object.values(byCategory);
  const colors = catLabels.map((_, i) => CAT_COLORS[i % CAT_COLORS.length]);

  if (pieChart) pieChart.destroy();
  const pieCtx = document.getElementById('pie-chart').getContext('2d');
  pieChart = new Chart(pieCtx, {
    type: 'doughnut',
    data: { labels: catLabels, datasets: [{ data: catVals, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: false,
      cutout: '65%',
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${fmt(ctx.parsed)} (${Math.round(ctx.parsed/totalSpent*100||0)}%)` }
      }}
    }
  });

  // Legend
  document.getElementById('pie-legend').innerHTML = catLabels.map((c, i) =>
    `<div class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span>${c}</div>`
  ).join('');

  // Daily bar chart
  const dailyMap = {};
  filtered.forEach(e => {
    dailyMap[e.date] = (dailyMap[e.date] || 0) + parseFloat(e.amount || 0);
  });
  const sortedDates = Object.keys(dailyMap).sort();
  const barLabels = sortedDates.map(d => {
    const [, m, day] = d.split('-');
    return `${day}/${m}`;
  });

  if (barChart) barChart.destroy();
  const barCtx = document.getElementById('bar-chart').getContext('2d');
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: barLabels,
      datasets: [{
        data: sortedDates.map(d => dailyMap[d]),
        backgroundColor: 'rgba(110,231,183,0.35)',
        borderColor: '#6ee7b7',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#606060', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#606060', font: { size: 10 }, callback: v => '₹' + v } }
      }
    }
  });
}

// ─────────────────────────────────────────────
// SERVICE WORKER REGISTRATION
// ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
