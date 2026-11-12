
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const appFirebase = initializeApp(firebaseConfig);
const auth = getAuth(appFirebase);

const db = initializeFirestore(appFirebase, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

const $ = id => document.getElementById(id);

const kids = ["Brody", "Mia", "Bradley"];

const chores = [
  { name: "Washing utensils (cups, plates etc.)", price: 1500 },
  { name: "Sweeping the house", price: 2000 },
  { name: "Clearing the table", price: 1000 },
  { name: "Sweeping the compound", price: 3000 },
  { name: "Arranging shoes in the rack", price: 1000 },
  { name: "Organizing the room", price: 2500 },
  { name: "Mopping the house", price: 2000 },
  { name: "Washing the car", price: 5000 },
  { name: "Polishing shoes", price: 1000 },
  { name: "Washing socks or light clothes", price: 2500 },
  { name: "Preparing breakfast", price: 2000 },
  { name: "Serving meals (visitors or parents)", price: 1000 },
  { name: "Washing shoes", price: 2000 },
  { name: "Ironing clothes", price: 2000 },
  { name: "Cleaning toilet or bathroom", price: 1500 },
  { name: "Extra Gifts", price: 0, custom: true }
];

let records = [];
let unsubscribe = null;
let ready = false;
let busy = false;
let currentUser = null;

function money(amount) {
  return "UGX " + Math.round(amount).toLocaleString("en-UG");
}

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000)
    .toISOString().slice(0, 10);
}

function isValidDate(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(value + "T00:00:00");
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function addMonthsToDate(dateString, months) {
  const [year, month, day] = dateString.split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1);

  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();

  target.setDate(Math.min(day, lastDay));

  return [
    target.getFullYear(),
    String(target.getMonth() + 1).padStart(2, "0"),
    String(target.getDate()).padStart(2, "0")
  ].join("-");
}

function choreAmount(record) {
  if (record.chore === chores.length - 1) {
    return record.customAmount || 0;
  }
  return chores[record.chore]?.price || 0;
}

function validChore(record) {
  return Boolean(
    record &&
    kids.includes(record.child) &&
    isValidDate(record.date) &&
    Number.isInteger(record.chore) &&
    record.chore >= 0 &&
    record.chore < chores.length &&
    typeof record.done === "boolean" &&
    (
      record.chore !== chores.length - 1 ||
      (
        Number.isSafeInteger(record.customAmount) &&
        record.customAmount > 0
      )
    )
  );
}

function validWithdrawal(record) {
  return Boolean(
    record &&
    record.type === "withdrawal" &&
    kids.includes(record.child) &&
    isValidDate(record.date) &&
    Number.isSafeInteger(record.amount) &&
    record.amount > 0
  );
}

function validInvestment(record) {
  return Boolean(
    record &&
    record.type === "investment" &&
    kids.includes(record.child) &&
    typeof record.name === "string" &&
    record.name.trim().length > 0 &&
    isValidDate(record.startDate) &&
    isValidDate(record.maturityDate) &&
    Number.isSafeInteger(record.amount) &&
    record.amount > 0 &&
    Number.isFinite(record.rate) &&
    record.rate >= 0 &&
    record.rate <= 1000 &&
    Number.isInteger(record.months) &&
    record.months >= 1 &&
    record.months <= 120 &&
    ["active", "released"].includes(record.status) &&
    (
      record.status !== "released" ||
      isValidDate(record.releasedAt)
    )
  );
}

function investmentPayout(record) {
  const interest = Math.round(record.amount * record.rate / 100);
  return record.amount + interest;
}

function validRecord(record) {
  return Boolean(
    record &&
    typeof record.id === "string" &&
    record.id.length > 0 &&
    (
      record.type === "withdrawal"
        ? validWithdrawal(record)
        : record.type === "investment"
          ? validInvestment(record)
          : !record.type && validChore(record)
    )
  );
}

function choreRecords() {
  return records.filter(record =>
    !record.type && validChore(record)
  );
}

function withdrawalRecords() {
  return records.filter(validWithdrawal);
}

function moneySummary(child) {
  const earned = choreRecords()
    .filter(record => record.child === child && record.done)
    .reduce((sum, record) => sum + choreAmount(record), 0);

  const withdrawn = withdrawalRecords()
    .filter(record => record.child === child)
    .reduce((sum, record) => sum + record.amount, 0);

  const investments = records.filter(record =>
    record.type === "investment" &&
    record.child === child &&
    validInvestment(record)
  );

  const locked = investments
    .filter(record => record.status === "active")
    .reduce((sum, record) => sum + record.amount, 0);

  const released = investments
    .filter(record => record.status === "released")
    .reduce((sum, record) => sum + investmentPayout(record), 0);

  return {
    earned,
    withdrawn,
    locked,
    released,
    balance: earned - withdrawn - locked + released
  };
}

function selectedDate() {
  return $("date").value || localDate();
}

function selectedChild() {
  return $("child").value;
}

function monthOf(date) {
  return date.slice(0, 7);
}

async function save(record) {
  if (!currentUser) return false;

  try {
    await setDoc(
      doc(db, "families", currentUser.uid, "records", record.id),
      record
    );
    return true;
  } catch (error) {
    console.error(error);
    $("syncStatus").textContent = "Save failed. Check connection.";
    alert("Could not save. Please try again.");
    return false;
  }
}

async function removeRecord(record) {
  if (!currentUser || !ready || busy) return;

  if (!confirm("Are you sure you want to delete this record?")) return;

  busy = true;
  try {
    await deleteDoc(
      doc(db, "families", currentUser.uid, "records", record.id)
    );
  } catch (error) {
    console.error(error);
    alert("Could not delete this record.");
  } finally {
    busy = false;
  }
}

function renderPrices() {
  const list = $("prices");
  list.replaceChildren();

  chores.forEach(chore => {
    const row = document.createElement("div");
    row.className = "price-row";

    const name = document.createElement("span");
    name.textContent = chore.name;

    const price = document.createElement("strong");
    price.textContent = chore.custom ? "Custom amount" : money(chore.price);

    row.append(name, price);
    list.append(row);
  });
}

function renderWithdrawalHistory(child) {
  const history = $("withdrawalHistory");
  history.replaceChildren();

  const items = withdrawalRecords()
    .filter(record => record.child === child)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No withdrawals yet.";
    history.append(empty);
    return;
  }

  items.forEach(record => {
    const row = document.createElement("div");
    row.className = "entry";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = "Withdrawal";

    const date = document.createElement("small");
    date.textContent = record.date;
    name.append(date);

    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = "−" + money(record.amount);

    row.append(name, amount);
    history.append(row);
  });
}

function renderInvestmentHistory(child) {
  const history = $("investmentHistory");
  history.replaceChildren();

  const investments = records
    .filter(record =>
      record.type === "investment" &&
      record.child === child &&
      validInvestment(record)
    )
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  if (!investments.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No investments yet.";
    history.append(empty);
    return;
  }

  investments.forEach(record => {
    const row = document.createElement("div");
    row.className = "entry";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = record.name;

    const details = document.createElement("small");
    details.textContent =
      money(record.amount) +
      " • " + record.rate + "% interest" +
      " • " + record.months + " months" +
      " • Due: " + record.maturityDate;

    name.append(details);

    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = money(investmentPayout(record));

    row.append(name, amount);

    const status = document.createElement("small");

    if (record.status === "released") {
      status.textContent = "✓ Released";
    } else if (record.maturityDate <= localDate()) {
      status.textContent = "Ready to release";
      status.style.color = "#14B8A6";

      const releaseButton = document.createElement("button");
      releaseButton.className = "secondary";
      releaseButton.textContent = "Release money";

      releaseButton.onclick = async () => {
        if (busy || !ready || record.status !== "active") return;
        if (record.maturityDate > localDate()) return;

        if (!confirm(
          "Release " + money(investmentPayout(record)) +
          " to " + child + "'s available balance?"
        )) return;

        busy = true;
        releaseButton.disabled = true;

        try {
          await save({
            ...record,
            status: "released",
            releasedAt: localDate()
          });
        } finally {
          busy = false;
        }
      };

      row.append(releaseButton);
    } else {
      status.textContent = "🔒 Locked until maturity";
    }

    row.append(status);
    history.append(row);
  });
}

function renderChores(child, date) {
  const list = $("entries");
  list.replaceChildren();

  const items = choreRecords()
    .filter(record =>
      record.child === child && record.date === date
    );

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No chores added for this day yet.";
    list.append(empty);
    return;
  }

  items.forEach(record => {
    const row = document.createElement("div");
    row.className = "entry";

    const label = document.createElement("label");
    label.className = "chore-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = record.done;
    checkbox.disabled = !ready || busy;

    checkbox.onchange = async () => {
      if (!ready || busy) return;
      busy = true;
      checkbox.disabled = true;

      try {
        await save({ ...record, done: checkbox.checked });
      } finally {
        busy = false;
      }
    };

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = chores[record.chore].name;

    const price = document.createElement("strong");
    price.className = "amount";
    price.textContent = money(choreAmount(record));

    label.append(checkbox, name);
    row.append(label, price);

    const deleteButton = document.createElement("button");
    deleteButton.className = "link";
    deleteButton.textContent = "Remove";
    deleteButton.onclick = () => removeRecord(record);

    row.append(deleteButton);
    list.append(row);
  });
}

function renderLeaderboard() {
  const board = $("leaderboard");
  board.replaceChildren();

  const month = monthOf(selectedDate());
  $("monthLabel").textContent = "Month: " + month;

  kids.forEach((child, index) => {
    const earned = choreRecords()
      .filter(record =>
        record.child === child &&
        record.done &&
        monthOf(record.date) === month
      )
      .reduce((sum, record) => sum + choreAmount(record), 0);

    const row = document.createElement("div");
    row.className = "leader-row";

    const name = document.createElement("span");
    name.textContent = (index + 1) + ". " + child;

    const amount = document.createElement("strong");
    amount.textContent = money(earned);

    row.append(name, amount);
    board.append(row);
  });
}

function render() {
  if (!$("child") || !$("date")) return;

  const child = selectedChild();
  const date = selectedDate();
  const month = monthOf(date);

  const dayItems = choreRecords().filter(record =>
    record.child === child && record.date === date
  );

  const monthItems = choreRecords().filter(record =>
    record.child === child &&
    record.done &&
    monthOf(record.date) === month
  );

  const dayEarned = dayItems
    .filter(record => record.done)
    .reduce((sum, record) => sum + choreAmount(record), 0);

  const monthEarned = monthItems
    .reduce((sum, record) => sum + choreAmount(record), 0);

  $("dayTotal").textContent = money(dayEarned);
  $("monthTotal").textContent = money(monthEarned);
  $("completed").textContent =
    dayItems.filter(record => record.done).length;

  const summary = moneySummary(child);

  $("lifetimeEarned").textContent = money(summary.earned);
  $("totalWithdrawn").textContent = money(summary.withdrawn);
  $("availableBalance").textContent = money(summary.balance);
  $("lockedTotal").textContent = money(summary.locked);
  $("investmentPayoutTotal").textContent = money(summary.released);

  renderChores(child, date);
  renderWithdrawalHistory(child);
  renderInvestmentHistory(child);
  renderLeaderboard();
  renderPrices();
}

function buildChorePicker() {
  const choices = $("choices");
  choices.replaceChildren();

  chores.forEach((chore, index) => {
    const label = document.createElement("label");
    label.className = "choice";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = index;

    const name = document.createElement("span");
    name.textContent = chore.name;

    const price = document.createElement("strong");
    price.textContent = chore.custom
      ? "Custom"
      : money(chore.price);

    label.append(checkbox, name, price);
    choices.append(label);
  });
}

$("loginForm").onsubmit = async event => {
  event.preventDefault();

  $("loginError").textContent = "";

  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );
  } catch (error) {
    console.error(error);
    $("loginError").textContent =
      "Sign-in failed. Check your email and password.";
  }
};

onAuthStateChanged(auth, user => {
  currentUser = user;
  ready = false;

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  $("loginPanel").hidden = Boolean(user);
  $("app").hidden = !user;

  if (!user) {
    records = [];
    return;
  }

  $("syncStatus").textContent = "Loading shared chores…";

  kids.forEach(child => {
    if (![...$("child").options].some(option => option.value === child)) {
      const option = document.createElement("option");
      option.value = child;
      option.textContent = child;
      $("child").append(option);
    }
  });

  if (!$("date").value) $("date").value = localDate();

  const recordsRef = collection(
    db,
    "families",
    user.uid,
    "records"
  );

  unsubscribe = onSnapshot(recordsRef, snapshot => {
    records = snapshot.docs
      .map(item => item.data())
      .filter(validRecord);

    ready = true;
    $("syncStatus").textContent = "✓ Synced for everyone";
    render();
  }, error => {
    console.error(error);
    $("syncStatus").textContent = "Sync problem. Check connection.";
  });

  render();
});

$("child").onchange = render;
$("date").onchange = render;

$("today").onclick = () => {
  $("date").value = localDate();
  render();
};

$("signout").onclick = async () => {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  await signOut(auth);
};

$("add").onclick = () => {
  if (!ready || busy) return;
  buildChorePicker();
  $("picker").showModal();
};

$("saveChoices").onclick = async event => {
  event.preventDefault();

  if (!ready || busy) return;

  const selected = [
    ...$("choices").querySelectorAll(
      'input[type="checkbox"]:checked'
    )
  ];

  if (!selected.length) {
    $("picker").close();
    return;
  }

  const child = selectedChild();
  const date = selectedDate();

  busy = true;
  $("saveChoices").disabled = true;

  try {
    for (const checkbox of selected) {
      const chore = Number(checkbox.value);
      let customAmount;

      if (chores[chore].custom) {
        const answer = prompt("Enter the Extra Gift amount in UGX:");
        if (answer === null) continue;

        customAmount = Number(answer);

        if (!Number.isSafeInteger(customAmount) || customAmount <= 0) {
          alert("Enter a valid whole-number amount.");
          continue;
        }
      }

      const record = {
        id: crypto.randomUUID(),
        child,
        date,
        chore,
        done: false
      };

      if (customAmount !== undefined) {
        record.customAmount = customAmount;
      }

      await save(record);
    }

    $("picker").close();
  } finally {
    busy = false;
    $("saveChoices").disabled = false;
  }
};

$("withdrawalForm").onsubmit = async event => {
  event.preventDefault();

  if (!ready || busy) return;

  const child = selectedChild();
  const amount = Number($("withdrawalAmount").value);
  const summary = moneySummary(child);
  const message = $("withdrawalMessage");

  message.textContent = "";

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    message.textContent = "Enter a valid whole-number amount.";
    return;
  }

  if (amount > summary.balance) {
    message.textContent =
      "Not enough available money. Balance: " +
      money(summary.balance);
    return;
  }

  if (!confirm("Withdraw " + money(amount) + " from " + child + "'s balance?")) {
    return;
  }

  busy = true;
  const button = $("withdrawalForm").querySelector("button");
  button.disabled = true;

  try {
    const success = await save({
      id: crypto.randomUUID(),
      type: "withdrawal",
      child,
      date: localDate(),
      amount
    });

    if (success) {
      $("withdrawalForm").reset();
      message.textContent = "✓ Withdrawal saved.";
    }
  } finally {
    busy = false;
    button.disabled = false;
  }
};

$("investmentForm").onsubmit = async event => {
  event.preventDefault();

  if (!ready || busy) return;

  const child = selectedChild();
  const name = $("investmentName").value.trim();
  const amount = Number($("investmentAmount").value);
  const months = Number($("investmentMonths").value);
  const rate = Number($("investmentRate").value);
  const summary = moneySummary(child);
  const message = $("investmentMessage");

  message.textContent = "";

  if (
    !name ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 120 ||
    !Number.isFinite(rate) ||
    rate < 0 ||
    rate > 1000
  ) {
    message.textContent = "Please check all your investment details.";
    return;
  }

  if (amount > summary.balance) {
    message.textContent =
      "Not enough available money. Balance: " + money(summary.balance);
    return;
  }

  const startDate = localDate();
  const maturityDate = addMonthsToDate(startDate, months);

  const record = {
    id: crypto.randomUUID(),
    type: "investment",
    child,
    name,
    amount,
    months,
    rate,
    startDate,
    maturityDate,
    status: "active"
  };

  if (!confirm(
    "Lock " + money(amount) +
    " for " + months + " months at " + rate +
    "% interest until " + maturityDate + "?"
  )) return;

  busy = true;
  const button = $("investmentForm").querySelector("button");
  button.disabled = true;

  try {
    const success = await save(record);

    if (success) {
      $("investmentForm").reset();
      message.textContent = "✓ Investment successfully locked!";
    }
  } finally {
    busy = false;
    button.disabled = false;
  }
};

$("export").onclick = () => {
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    records
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "chore-tracker-backup.json";
  link.click();

  URL.revokeObjectURL(url);
};

$("import").onchange = async event => {
  const file = event.target.files[0];
  if (!file || !currentUser || !ready || busy) return;

  try {
    const data = JSON.parse(await file.text());

    if (
      !data ||
      !Array.isArray(data.records) ||
      !data.records.every(validRecord)
    ) {
      throw new Error("Invalid backup file.");
    }

    if (!confirm(
      "Import " + data.records.length +
      " records? Existing records will not be deleted."
    )) {
      event.target.value = "";
      return;
    }

    busy = true;

    for (const record of data.records) {
      await save(record);
    }

    alert("Backup imported successfully.");
  } catch (error) {
    console.error(error);
    alert("Could not import this backup. Check the file.");
  } finally {
    busy = false;
    event.target.value = "";
  }
};

$("date").value = localDate();
render();
