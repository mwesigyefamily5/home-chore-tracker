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

// Fixed-price chores use their listed price. Extra Gifts uses an amount
// entered each time the chore is added.
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

const EXTRA_GIFTS_INDEX = chores.length - 1;
const kids = ['Brody', 'Mia', 'Bradley'];
const $ = id => document.getElementById(id);
const money = amount => 'UGX ' + Number(amount || 0).toLocaleString('en-UG');

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function status(message) {
  $('syncStatus').textContent = message;
}

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validChore(record) {
  if (
    !record ||
    !kids.includes(record.child) ||
    !isValidDate(record.date) ||
    !Number.isInteger(record.chore) ||
    record.chore < 0 ||
    record.chore >= chores.length ||
    typeof record.done !== 'boolean'
  ) {
    return false;
  }

  // Flexible-price Extra Gifts records must store a positive whole UGX amount.
  if (record.chore === EXTRA_GIFTS_INDEX) {
    return Number.isSafeInteger(record.amount) && record.amount > 0;
  }

  return true;
}

function validWithdrawal(record) {
  return Boolean(
    record &&
    record.type === 'withdrawal' &&
    kids.includes(record.child) &&
    isValidDate(record.date) &&
    Number.isSafeInteger(record.amount) &&
    record.amount > 0
  );
}

function validRecord(record) {
  return Boolean(
    record &&
    typeof record.id === 'string' &&
    (record.type === 'withdrawal'
      ? validWithdrawal(record)
      : validChore(record))
  );
}

function choreAmount(record) {
  return record.chore === EXTRA_GIFTS_INDEX
    ? record.amount
    : chores[record.chore][1];
}

function choreRecords() {
  return records.filter(record =>
    record.type !== 'withdrawal' && validChore(record)
  );
}

function withdrawalRecords() {
  return records.filter(validWithdrawal);
}

function recordRef(record) {
  return doc(db, 'families', auth.currentUser.uid, 'records', record.id);
}

async function save(record) {
  if (!ready || !auth.currentUser) return false;

  status('Saving…');

  try {
    await setDoc(recordRef(record), record);
    status('✓ Saved for everyone');
    return true;
  } catch (error) {
    status('Save failed — try again');
    alert('Could not save: ' + error.message);
    return false;
  }
}

async function remove(record) {
  if (!ready || !auth.currentUser) return;

  status('Saving…');

  try {
    await deleteDoc(recordRef(record));
    status('✓ Saved for everyone');
  } catch (error) {
    status('Delete failed');
    alert('Could not remove: ' + error.message);
  }
}

// Lifetime earnings are based on completed chores. Withdrawals reduce
// the available balance but never reduce lifetime earnings.
function moneySummary(child) {
  const earned = choreRecords()
    .filter(record => record.child === child && record.done)
    .reduce((sum, record) => sum + choreAmount(record), 0);

  const withdrawn = withdrawalRecords()
    .filter(record => record.child === child)
    .reduce((sum, record) => sum + record.amount, 0);

  return {
    earned,
    withdrawn,
    balance: earned - withdrawn
  };
}

// Family sign-in
$('loginForm').onsubmit = async event => {
  event.preventDefault();
  $('loginError').textContent = 'Signing in…';

  try {
    await signInWithEmailAndPassword(
      auth,
      $('email').value.trim(),
      $('password').value
    );

    $('password').value = '';
    $('loginError').textContent = '';
  } catch (error) {
    console.error('Sign-in failed:', error);
    $('loginError').textContent =
      'Could not sign in. Check your email and password.';
  }
};

$('signout').onclick = () => signOut(auth);

// Listen for shared family records in Firestore.
onAuthStateChanged(auth, user => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  records = [];
  ready = false;

  $('loginPanel').hidden = Boolean(user);
  $('app').hidden = !user;

  if (!user) return;

  status('Loading shared records…');

  unsubscribe = onSnapshot(
    collection(db, 'families', user.uid, 'records'),
    snapshot => {
      records = snapshot.docs
        .map(document => ({ ...document.data(), id: document.id }))
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
      console.error('Firestore sync error:', error);
    }
  );
});

// Child and date controls
$('child').innerHTML = kids
  .map(child => `<option value="${child}">${child}</option>`)
  .join('');

$('date').value = localDate();

$('today').onclick = () => {
  $('date').value = localDate();
  render();
};

$('child').onchange = render;
$('date').onchange = render;

function currentChores() {
  return choreRecords().filter(record =>
    record.child === $('child').value &&
    record.date === $('date').value
  );
}

function selectedMonth() {
  return $('date').value.slice(0, 7);
}

// Main dashboard
function render() {
  const child = $('child').value;
  const dailyRecords = currentChores();
  const currentMonth = selectedMonth();

  $('dayTotal').textContent = money(
    dailyRecords.reduce(
      (sum, record) => sum + (record.done ? choreAmount(record) : 0),
      0
    )
  );

  $('monthTotal').textContent = money(
    choreRecords()
      .filter(record =>
        record.child === child &&
        record.date.startsWith(currentMonth) &&
        record.done
      )
      .reduce((sum, record) => sum + choreAmount(record), 0)
  );

  $('completed').textContent =
    dailyRecords.filter(record => record.done).length +
    ' / ' + dailyRecords.length;

  const summary = moneySummary(child);

  $('lifetimeEarned').textContent = money(summary.earned);
  $('totalWithdrawn').textContent = money(summary.withdrawn);
  $('availableBalance').textContent = money(summary.balance);

  // Today's chore list
  const entries = $('entries');
  entries.replaceChildren();

  if (!dailyRecords.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      '🌟 No chores added yet. Tap “Add chores” to get started!';

    entries.append(empty);
  }

  dailyRecords.forEach(record => {
    const row = document.createElement('div');
    row.className = 'entry' + (record.done ? ' done' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = record.done;
    checkbox.setAttribute('aria-label', 'Mark chore completed');

    checkbox.onchange = () =>
      save({ ...record, done: checkbox.checked });

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = chores[record.chore][0];

    const detail = document.createElement('small');
    detail.textContent = record.done
      ? 'Completed ✓'
      : 'Not completed yet';

    name.append(detail);

    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = money(choreAmount(record));

    const deleteButton = document.createElement('button');
    deleteButton.className = 'remove';
    deleteButton.textContent = '✕';
    deleteButton.title = 'Remove chore';
    deleteButton.setAttribute(
      'aria-label',
      'Remove ' + chores[record.chore][0]
    );

    deleteButton.onclick = () => remove(record);

    row.append(checkbox, name, amount, deleteButton);
    entries.append(row);
  });

  // Monthly leaderboard
  const totals = kids.map(childName => ({
    child: childName,
    total: choreRecords()
      .filter(record =>
        record.child === childName &&
        record.date.startsWith(currentMonth) &&
        record.done
      )
      .reduce((sum, record) => sum + choreAmount(record), 0)
  }));

  const max = Math.max(1, ...totals.map(item => item.total));

  $('monthLabel').textContent = new Date(
    currentMonth + '-01T12:00:00'
  ).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric'
  });

  const board = $('leaderboard');
  board.replaceChildren();

  totals.forEach(item => {
    const row = document.createElement('div');
    row.className = 'leader';

    const label = document.createElement('b');
    label.textContent = item.child;

    const track = document.createElement('div');
    track.className = 'track';

    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = (item.total / max * 100) + '%';

    track.append(fill);

    const value = document.createElement('strong');
    value.textContent = money(item.total);

    row.append(label, track, value);
    board.append(row);
  });

  renderWithdrawalHistory(child);
}

// Withdrawal history
function renderWithdrawalHistory(child) {
  const history = $('withdrawalHistory');
  history.replaceChildren();

  const childWithdrawals = withdrawalRecords()
    .filter(record => record.child === child)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!childWithdrawals.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No withdrawals yet.';

    history.append(empty);
    return;
  }

  childWithdrawals.forEach(record => {
    const row = document.createElement('div');
    row.className = 'entry';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = 'Withdrawal';

    const date = document.createElement('small');
    date.textContent = record.date;

    name.append(date);

    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = '− ' + money(record.amount);

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
  amount.textContent =
    price === null ? 'Flexible amount' : money(price);

  row.append(label, amount);
  $('prices').append(row);
});

// Build the add-chores picker.
// Extra Gifts reveals an amount field when selected.
$('add').onclick = () => {
  if (!ready) return;

  const box = $('choices');
  box.replaceChildren();

  chores.forEach(([name, price], index) => {
    const row = document.createElement('div');
    row.className = 'choice';

    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '12px';
    label.style.flex = '1';
    label.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(index);
    checkbox.id = 'chore-choice-' + index;

    const choreName = document.createElement('span');
    choreName.textContent = name;

    const priceText = document.createElement('small');
    priceText.textContent =
      price === null ? 'Choose amount' : money(price);

    label.append(checkbox, choreName, priceText);
    row.append(label);

    if (index === EXTRA_GIFTS_INDEX) {
      const amountInput = document.createElement('input');
      amountInput.type = 'number';
      amountInput.min = '1';
      amountInput.step = '1';
      amountInput.inputMode = 'numeric';
      amountInput.placeholder = 'UGX amount';
      amountInput.setAttribute(
        'aria-label',
        'Extra Gifts amount in UGX'
      );

      amountInput.style.width = '125px';
      amountInput.style.maxWidth = '40%';
      amountInput.style.padding = '8px';
      amountInput.style.border = '1px solid #d8deed';
      amountInput.style.borderRadius = '8px';
      amountInput.disabled = true;

      checkbox.addEventListener('change', () => {
        amountInput.disabled = !checkbox.checked;

        if (!checkbox.checked) {
          amountInput.value = '';
        }

        if (checkbox.checked) {
          amountInput.focus();
        }
      });

      row.append(amountInput);
    }

    box.append(row);
  });

  $('picker').showModal();
};

// Save selected chores. The same chore can be added again.
$('saveChoices').onclick = async event => {
  event.preventDefault();

  if (busy || !ready) return;

  const chosen = [
    ...$('choices').querySelectorAll(
      'input[type="checkbox"]:checked'
    )
  ].map(checkbox => {
    const chore = Number(checkbox.value);

    if (chore !== EXTRA_GIFTS_INDEX) {
      return { chore };
    }

    const amountInput = checkbox
      .closest('.choice')
      .querySelector('input[type="number"]');

    return {
      chore,
      amount: Number(amountInput.value)
    };
  });

  if (!chosen.length) return;

  const invalidGift = chosen.find(item =>
    item.chore === EXTRA_GIFTS_INDEX &&
    (!Number.isSafeInteger(item.amount) || item.amount <= 0)
  );

  if (invalidGift) {
    alert('Enter a positive whole UGX amount for Extra Gifts.');
    return;
  }

  busy = true;
  $('saveChoices').disabled = true;

  const child = $('child').value;
  const date = $('date').value;

  try {
    const results = await Promise.all(chosen.map(item => {
      const record = {
        id: crypto.randomUUID(),
        child,
        date,
        chore: item.chore,
        done: false
      };

      if (item.chore === EXTRA_GIFTS_INDEX) {
        record.amount = item.amount;
      }

      return save(record);
    }));

    if (results.every(Boolean)) {
      $('picker').close();
    }
  } finally {
    busy = false;
    $('saveChoices').disabled = false;
  }
};

// Make a withdrawal.
// Lifetime earned remains unchanged; available balance falls.
$('withdrawalForm').onsubmit = async event => {
  event.preventDefault();

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

  if (!confirm('Withdraw ' + money(amount) + ' from ' + child + '?')) {
    return;
  }

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

// Export all chore and withdrawal records as a backup.
$('export').onclick = () => {
  const blob = new Blob(
    [JSON.stringify({ version: 1, records }, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'chore-tracker-backup.json';
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Import a backup without changing the existing record format.
$('import').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (
      data.version !== 1 ||
      !Array.isArray(data.records) ||
      !data.records.every(record =>
        record.type === 'withdrawal'
          ? validWithdrawal(record)
          : validChore(record)
      )
    ) {
      throw new Error('Invalid backup file.');
    }

    if (
      confirm(
        'Import these entries into the shared family database?'
      )
    ) {
      for (const record of data.records) {
        await save({
          ...record,
          id: record.id || crypto.randomUUID()
        });
      }

      alert('Backup imported.');
    }
  } catch (error) {
    alert('Import failed: ' + error.message);
  }

  event.target.value = '';
};

// Initial display. Shared data refreshes it after Firebase loads.
render();
