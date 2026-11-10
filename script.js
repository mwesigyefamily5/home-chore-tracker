
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

import {
  initializeFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';

const chores = [
  ['Washing utensils (cups, plates etc.)', 1500],
  ['Sweeping the house', 2000],
  ['Clearing the table', 1000],
  ['Sweeping the compound', 3000],
  ['Arranging shoes in the rack', 1000],
  ['Organizing the room', 2500],
  ['Mopping the house', 2000],
  ['Washing the car', 5000],
  ['Polishing shoes', 1000],
  ['Washing socks or light clothes', 2500],
  ['Preparing breakfast', 2000],
  ['Serving meals (visitors or parents)', 1000],
  ['Washing shoes', 2000],
  ['Ironing clothes', 2000],
  ['Cleaning toilet or bathroom', 1500],
['Extra Gifts', null]
];

const kids = ['Brody', 'Mia', 'Bradley'];
const EXTRA_GIFTS_INDEX = chores.length - 1;

const chorePay = record =>
  chores[record.chore][1] === null
    ? record.amount
    : chores[record.chore][1];
const $ = id => document.getElementById(id);
const money = n => 'UGX ' + n.toLocaleString('en-UG');

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

let records = [];
let unsubscribe = null;
let ready = false;
let busy = false;

const status = message => {
  $('syncStatus').textContent = message;
};

const validChore = r =>
  kids.includes(r.child) &&
  /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
  Number.isInteger(r.chore) &&
  r.chore >= 0 &&
  r.chore < chores.length &&
  typeof r.done === 'boolean';

const validWithdrawal = r =>
  r.type === 'withdrawal' &&
  kids.includes(r.child) &&
  /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
  Number.isSafeInteger(r.amount) &&
  r.amount > 0;

const validRecord = r =>
  typeof r.id === 'string' &&
  (r.type === 'withdrawal'
    ? validWithdrawal(r)
    : validChore(r));

const choreRecords = () =>
  records.filter(r => r.type !== 'withdrawal' && validChore(r));

const withdrawalRecords = () =>
  records.filter(r => validWithdrawal(r));

const ref = r =>
  doc(db, 'families', auth.currentUser.uid, 'records', r.id);

async function save(r) {
  if (!ready || !auth.currentUser) return false;

  status('Saving…');

  try {
    await setDoc(ref(r), r);
    status('✓ Saved for everyone');
    return true;
  } catch (e) {
    status('Save failed — try again');
    alert('Could not save: ' + e.message);
    return false;
  }
}

async function remove(r) {
  if (!ready || !auth.currentUser) return;

  status('Saving…');

  try {
    await deleteDoc(ref(r));
    status('✓ Saved for everyone');
  } catch (e) {
    status('Delete failed');
    alert('Could not remove: ' + e.message);
  }
}

// Calculate lifetime earnings, withdrawals and balance
function moneySummary(child) {
  const earned = choreRecords()
    .filter(r => r.child === child && r.done)
    .reduce((sum, r) => sum + chores[r.chore][1], 0);

  const withdrawn = withdrawalRecords()
    .filter(r => r.child === child)
    .reduce((sum, r) => sum + r.amount, 0);

  return {
    earned,
    withdrawn,
    balance: earned - withdrawn
  };
}

// Sign in
$('loginForm').onsubmit = async e => {
  e.preventDefault();
  $('loginError').textContent = 'Signing in…';

  try {
    await signInWithEmailAndPassword(
      auth,
      $('email').value.trim(),
      $('password').value
    );

    $('password').value = '';
    $('loginError').textContent = '';
  } catch {
    $('loginError').textContent =
      'Could not sign in. Check your email and password.';
  }
};

$('signout').onclick = () => signOut(auth);

// Listen to Firestore
onAuthStateChanged(auth, user => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  records = [];
  ready = false;

  $('loginPanel').hidden = !!user;
  $('app').hidden = !user;

  if (!user) return;

  status('Loading shared records…');

  unsubscribe = onSnapshot(
    collection(db, 'families', user.uid, 'records'),
    snapshot => {
      records = snapshot.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(validRecord);

      ready = true;

      status(
        snapshot.metadata.hasPendingWrites
          ? 'Saving…'
          : '✓ Synced for everyone'
      );

      render();
    },
    error => {
      ready = false;
      status('Sync error: ' + error.message);
    }
  );
});

// Child selector
$('child').innerHTML = kids
  .map(k => `<option>${k}</option>`)
  .join('');

$('date').value = localDate();

$('today').onclick = () => {
  $('date').value = localDate();
  render();
};

$('child').onchange = render;
$('date').onchange = render;

const current = () =>
  choreRecords().filter(
    r => r.child === $('child').value &&
         r.date === $('date').value
  );

const month = () => $('date').value.slice(0, 7);

// Main display
function render() {
  const child = $('child').value;
  const list = current();

  $('dayTotal').textContent = money(
    list.reduce(
      (sum, r) => sum + (r.done ? chores[r.chore][1] : 0),
      0
    )
  );

  $('monthTotal').textContent = money(
    choreRecords()
      .filter(
        r => r.child === child &&
             r.date.startsWith(month()) &&
             r.done
      )
      .reduce((sum, r) => sum + chores[r.chore][1], 0)
  );

  $('completed').textContent =
    list.filter(r => r.done).length + ' / ' + list.length;

  // Lifetime money summary
  const summary = moneySummary(child);

  $('lifetimeEarned').textContent = money(summary.earned);
  $('totalWithdrawn').textContent = money(summary.withdrawn);
  $('availableBalance').textContent = money(summary.balance);

  // Today's chores
  const entries = $('entries');
  entries.replaceChildren();

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      '🌟 No chores added yet. Tap “Add chores” to get started!';
    entries.append(empty);
  }

  list.forEach(r => {
    const row = document.createElement('div');
    row.className = 'entry' + (r.done ? ' done' : '');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = r.done;
    check.setAttribute('aria-label', 'Mark chore completed');
    check.onchange = () => save({ ...r, done: check.checked });

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = chores[r.chore][0];

    const small = document.createElement('small');
    small.textContent = r.done ? 'Completed ✓' : 'Not completed yet';
    name.append(small);

    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = money(chores[r.chore][1]);

    const del = document.createElement('button');
    del.className = 'remove';
    del.textContent = '✕';
    del.title = 'Remove chore';
    del.onclick = () => remove(r);

    row.append(check, name, amount, del);
    entries.append(row);
  });

  // Monthly leaderboard
  const totals = kids.map(childName => ({
    child: childName,
    total: choreRecords()
      .filter(
        r => r.child === childName &&
             r.date.startsWith(month()) &&
             r.done
      )
      .reduce((sum, r) => sum + chores[r.chore][1], 0)
  }));

  const max = Math.max(1, ...totals.map(t => t.total));

  $('monthLabel').textContent = new Date(
    month() + '-01T12:00:00'
  ).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric'
  });

  const board = $('leaderboard');
  board.replaceChildren();

  totals.forEach(t => {
    const row = document.createElement('div');
    row.className = 'leader';

    const label = document.createElement('b');
    label.textContent = t.child;

    const track = document.createElement('div');
    track.className = 'track';

    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = (t.total / max * 100) + '%';
    track.append(fill);

    const value = document.createElement('strong');
    value.textContent = money(t.total);

    row.append(label, track, value);
    board.append(row);
  });

  renderWithdrawalHistory(child);
}

// Withdrawal history
function renderWithdrawalHistory(child) {
  const history = $('withdrawalHistory');
  history.replaceChildren();

  const list = withdrawalRecords()
    .filter(r => r.child === child)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No withdrawals yet.';
    history.append(empty);
    return;
  }

  list.forEach(r => {
    const row = document.createElement('div');
    row.className = 'entry';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = 'Withdrawal';

    const date = document.createElement('small');
    date.textContent = r.date;
    name.append(date);

    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = '− ' + money(r.amount);

    row.append(name, amount);
    history.append(row);
  });
}

// Chore price list
chores.forEach(([name, price]) => {
  const row = document.createElement('div');
  row.className = 'price';

  const label = document.createElement('span');
  label.textContent = name;

  const amount = document.createElement('b');
  amount.textContent = money(price);

  row.append(label, amount);
  $('prices').append(row);
});

// Add chores
$('add').onclick = () => {
  if (!ready) return;

  const box = $('choices');
  box.replaceChildren();

  chores.forEach(([name, price], i) => {
    const label = document.createElement('label');
    label.className = 'choice';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = i;

    const text = document.createElement('span');
    text.textContent = name;

    const amount = document.createElement('small');
    amount.textContent = money(price);

    label.append(input, text, amount);
    box.append(label);
  });

  $('picker').showModal();
};

$('saveChoices').onclick = async e => {
  e.preventDefault();

  if (busy || !ready) return;

  const selected = [
    ...$('choices').querySelectorAll('input:checked')
  ].map(input => Number(input.value));

  if (!selected.length) return;

  busy = true;
  $('saveChoices').disabled = true;

  const child = $('child').value;
  const date = $('date').value;

  try {
    const results = await Promise.all(
      selected.map(chore =>
        save({
          id: crypto.randomUUID(),
          child,
          date,
          chore,
          done: false
        })
      )
    );

    if (results.every(Boolean)) {
      $('picker').close();
    }
  } finally {
    busy = false;
    $('saveChoices').disabled = false;
  }
};

// Make a withdrawal
$('withdrawalForm').onsubmit = async e => {
  e.preventDefault();

  if (!ready || busy) return;

  const child = $('child').value;
  const amount = Number($('withdrawalAmount').value);
  const summary = moneySummary(child);

  $('withdrawalMessage').textContent = '';

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    $('withdrawalMessage').textContent =
      'Please enter a valid whole amount.';
    return;
  }

  if (amount > summary.balance) {
    $('withdrawalMessage').textContent =
      'Not enough money available. Balance: ' +
      money(summary.balance);
    return;
  }

  if (!confirm(
    'Withdraw ' + money(amount) + ' from ' + child + '?'
  )) return;

  busy = true;

  const button = $('withdrawalForm').querySelector('button');
  button.disabled = true;

  const withdrawal = {
    id: crypto.randomUUID(),
    type: 'withdrawal',
    child,
    date: localDate(),
    amount
  };

  try {
    const success = await save(withdrawal);

    if (success) {
      $('withdrawalAmount').value = '';
      $('withdrawalMessage').textContent =
        '✓ Withdrawal recorded successfully!';
    }
  } finally {
    busy = false;
    button.disabled = false;
  }
};

// Export backup
$('export').onclick = () => {
  const blob = new Blob(
    [JSON.stringify({ version: 1, records }, null, 2)],
    { type: 'application/json' }
  );

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'chore-tracker-backup.json';
  a.click();

  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Import backup
$('import').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (
      data.version !== 1 ||
      !Array.isArray(data.records) ||
      !data.records.every(r =>
        r.type === 'withdrawal'
          ? validWithdrawal(r)
          : validChore(r)
      )
    ) {
      throw Error('Invalid backup');
    }

    if (confirm('Import these entries into the shared family database?')) {
      for (const r of data.records) {
        await save({
          ...r,
          id: r.id || crypto.randomUUID()
        });
      }

      alert('Backup imported.');
    }
  } catch (err) {
    alert('Import failed: ' + err.message);
  }

  e.target.value = '';
};

render();
