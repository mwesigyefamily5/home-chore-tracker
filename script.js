
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
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
  ['Cleaning toilet or bathroom', 1500]
];

const kids = ['Brody', 'Mia', 'Bradley'];
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

const valid = r =>
  typeof r.id === 'string' &&
  kids.includes(r.child) &&
  /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
  Number.isInteger(r.chore) &&
  r.chore >= 0 &&
  r.chore < chores.length &&
  typeof r.done === 'boolean';

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

  status('Loading shared chores…');

  unsubscribe = onSnapshot(
    collection(db, 'families', user.uid, 'records'),
    snapshot => {
      records = snapshot.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(valid);

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
  records.filter(
    r => r.child === $('child').value &&
         r.date === $('date').value
  );

const month = () => $('date').value.slice(0, 7);

function render() {
  const list = current();

  $('dayTotal').textContent = money(
    list.reduce(
      (sum, r) => sum + (r.done ? chores[r.chore][1] : 0),
      0
    )
  );

  $('monthTotal').textContent = money(
    records
      .filter(
        r => r.child === $('child').value &&
             r.date.startsWith(month()) &&
             r.done
      )
      .reduce((sum, r) => sum + chores[r.chore][1], 0)
  );

  $('completed').textContent =
    list.filter(r => r.done).length + ' / ' + list.length;

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

  const totals = kids.map(child => ({
    child,
    total: records
      .filter(
        r => r.child === child &&
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
}

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

    // No duplicate check: the same chore can be selected again.
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

$('import').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (
      data.version !== 1 ||
      !Array.isArray(data.records) ||
      !data.records.every(r =>
        kids.includes(r.child) &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
        Number.isInteger(r.chore) &&
        r.chore >= 0 &&
        r.chore < chores.length &&
        typeof r.done === 'boolean'
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
