const STORAGE_KEY = "kali-keith-shopping-kitty-v2";
const HOUSEHOLD_ID = "kali-keith-7f4c2a91";
const people = ["Kali", "Keith"];
const monthStarts = [
  ["2026-06", "Jun 2026"],
  ["2026-07", "Jul 2026"],
  ["2026-08", "Aug 2026"],
  ["2026-09", "Sep 2026"],
  ["2026-10", "Oct 2026"],
  ["2026-11", "Nov 2026"],
  ["2026-12", "Dec 2026"],
  ["2027-01", "Jan 2027"],
  ["2027-02", "Feb 2027"],
  ["2027-03", "Mar 2027"],
  ["2027-04", "Apr 2027"],
  ["2027-05", "May 2027"],
];

const defaultState = {
  activeView: "tracker",
  activeMonth: "2026-06",
  deletedEntryIds: [],
  deletedListItemIds: [],
  shoppingList: {
    items: [],
    savedItems: {
      supermarkets: [],
      costco: [],
    },
    savedItemsSyncPending: false,
  },
  months: Object.fromEntries(
    monthStarts.map(([key]) => [
      key,
      {
        contributions: { Kali: "", Keith: key === "2026-06" ? "250" : "" },
        contributionSyncPending: false,
        entries: [],
      },
    ]),
  ),
};

const els = {
  saveState: document.querySelector("#saveState"),
  viewButtons: document.querySelectorAll("[data-view-button]"),
  trackerViews: document.querySelectorAll(".tracker-view"),
  listView: document.querySelector(".list-view"),
  monthSelect: document.querySelector("#monthSelect"),
  kaliContribution: document.querySelector("#kaliContribution"),
  keithContribution: document.querySelector("#keithContribution"),
  paidBy: document.querySelector("#paidBy"),
  amountInput: document.querySelector("#amountInput"),
  noteInput: document.querySelector("#noteInput"),
  addEntryBtn: document.querySelector("#addEntryBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importInput: document.querySelector("#importInput"),
  clearMonthBtn: document.querySelector("#clearMonthBtn"),
  entriesList: document.querySelector("#entriesList"),
  template: document.querySelector("#entryTemplate"),
  listItemTemplate: document.querySelector("#listItemTemplate"),
  listTypeSelect: document.querySelector("#listTypeSelect"),
  listItemInput: document.querySelector("#listItemInput"),
  rememberedItems: document.querySelector("#rememberedItems"),
  addListItemBtn: document.querySelector("#addListItemBtn"),
  supermarketListItems: document.querySelector("#supermarketListItems"),
  costcoListItems: document.querySelector("#costcoListItems"),
  listCount: document.querySelector("#listCount"),
  kittyBalance: document.querySelector("#kittyBalance"),
  balanceLabel: document.querySelector("#balanceLabel"),
  balanceHelp: document.querySelector("#balanceHelp"),
  totalContributions: document.querySelector("#totalContributions"),
  totalShopping: document.querySelector("#totalShopping"),
  overKitty: document.querySelector("#overKitty"),
  settleUp: document.querySelector("#settleUp"),
  kittyPaid: document.querySelector("#kittyPaid"),
  kaliPaid: document.querySelector("#kaliPaid"),
  keithPaid: document.querySelector("#keithPaid"),
};

let state = loadState();
let saveTimer = null;
let syncTimer = null;
let firebase = null;
let activeUnsubscribers = [];
let listUnsubscriber = null;
let isApplyingRemote = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("kali-keith-shopping-kitty-v1");
  if (!saved) return clone(defaultState);

  try {
    const parsed = JSON.parse(saved);
    const merged = clone(defaultState);
    merged.activeView = parsed.activeView || merged.activeView;
    merged.activeMonth = parsed.activeMonth || merged.activeMonth;
    merged.deletedEntryIds = parsed.deletedEntryIds || [];
    merged.deletedListItemIds = parsed.deletedListItemIds || [];
    merged.shoppingList.items = (parsed.shoppingList?.items || []).map((item) => ({
      listType: "supermarkets",
      ...item,
      listType: item.listType || "supermarkets",
      syncPending: Boolean(item.syncPending),
    }));
    merged.shoppingList.savedItems = {
      supermarkets: parsed.shoppingList?.savedItems?.supermarkets || [],
      costco: parsed.shoppingList?.savedItems?.costco || [],
    };
    merged.shoppingList.savedItemsSyncPending = Boolean(parsed.shoppingList?.savedItemsSyncPending);
    for (const [key] of monthStarts) {
      merged.months[key] = {
        ...merged.months[key],
        ...(parsed.months?.[key] || {}),
        contributions: {
          ...merged.months[key].contributions,
          ...(parsed.months?.[key]?.contributions || {}),
        },
        contributionSyncPending: Boolean(parsed.months?.[key]?.contributionSyncPending),
        entries: (parsed.months?.[key]?.entries || merged.months[key].entries).map((entry) => ({
          ...entry,
          syncPending: Boolean(entry.syncPending),
        })),
      };
    }
    return merged;
  } catch {
    return clone(defaultState);
  }
}

function saveLocalNow() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setSaveState(text) {
  els.saveState.textContent = text;
}

function saveState() {
  setSaveState(firebase ? "Saving" : "Saved local");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveLocalNow();
    queueSync();
    updateSyncLabel();
  }, 180);
}

function updateSyncLabel() {
  const month = activeData();
  const pendingEntries = month.entries.some((entry) => entry.syncPending);
  const pendingListItems = state.shoppingList.items.some((item) => item.syncPending);
  if (!firebase) {
    setSaveState("Saved local");
  } else if (
    pendingEntries ||
    pendingListItems ||
    state.shoppingList.savedItemsSyncPending ||
    month.contributionSyncPending ||
    state.deletedEntryIds.length ||
    state.deletedListItemIds.length
  ) {
    setSaveState("Syncing");
  } else {
    setSaveState("Synced");
  }
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value || 0);
}

function parseAmount(input) {
  const text = String(input || "").replace(/\u00a3/g, "").replace(/\s/g, "");
  if (!text) return 0;
  if (!/^[0-9.,+\-*/()]+$/.test(text)) return Number.NaN;
  try {
    const normalized = text.replace(/,/g, "");
    const result = Function(`"use strict"; return (${normalized})`)();
    return Number.isFinite(result) && result >= 0 ? Math.round(result * 100) / 100 : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function activeData() {
  return state.months[state.activeMonth];
}

function totalsFor(monthKey) {
  const month = state.months[monthKey];
  const contributions = people.reduce((sum, person) => sum + parseAmount(month.contributions[person]), 0);
  const spendByPerson = { Kitty: 0, Kali: 0, Keith: 0 };

  for (const entry of month.entries) {
    const amount = Number(entry.amount) || 0;
    spendByPerson[entry.paidBy] = (spendByPerson[entry.paidBy] || 0) + amount;
  }

  const shopping = spendByPerson.Kitty + spendByPerson.Kali + spendByPerson.Keith;
  const extraByPerson = { Kali: spendByPerson.Kali, Keith: spendByPerson.Keith };
  const overKitty = Math.max(0, spendByPerson.Kitty - contributions) + extraByPerson.Kali + extraByPerson.Keith;
  return {
    contributions,
    spendByPerson,
    extraByPerson,
    overKitty,
    shopping,
    balance: Math.max(0, contributions - spendByPerson.Kitty),
  };
}

function yearExtraTotals() {
  return monthStarts.reduce(
    (totals, [monthKey]) => {
      const monthTotals = totalsFor(monthKey);
      totals.Kali += monthTotals.extraByPerson.Kali;
      totals.Keith += monthTotals.extraByPerson.Keith;
      return totals;
    },
    { Kali: 0, Keith: 0 },
  );
}

function renderMonthOptions() {
  els.monthSelect.innerHTML = "";
  for (const [key, label] of monthStarts) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = label;
    els.monthSelect.append(option);
  }
  els.monthSelect.value = state.activeMonth;
}

function renderInputs() {
  const month = activeData();
  if (document.activeElement !== els.kaliContribution) els.kaliContribution.value = month.contributions.Kali || "";
  if (document.activeElement !== els.keithContribution) els.keithContribution.value = month.contributions.Keith || "";
}

function renderSummary() {
  const totals = totalsFor(state.activeMonth);
  const yearExtras = yearExtraTotals();
  const yearDifference = yearExtras.Kali - yearExtras.Keith;
  els.totalContributions.textContent = money(totals.contributions);
  els.totalShopping.textContent = money(totals.shopping);
  els.overKitty.textContent = money(totals.overKitty);
  els.kittyPaid.textContent = money(totals.spendByPerson.Kitty);
  els.kaliPaid.textContent = money(totals.extraByPerson.Kali);
  els.keithPaid.textContent = money(totals.extraByPerson.Keith);
  els.kittyBalance.textContent = money(Math.abs(totals.balance));
  els.kittyBalance.classList.toggle("negative", false);
  els.kittyBalance.classList.toggle("positive", true);
  els.balanceLabel.textContent = "Kitty left";
  els.balanceHelp.textContent =
    totals.balance > 0
      ? "This is what remains from the start-of-month kitty."
      : "The kitty is used up. Add extra shops under Kali or Keith.";

  if (Math.abs(yearDifference) < 0.005) {
    els.settleUp.textContent = "Even";
  } else if (yearDifference > 0) {
    els.settleUp.textContent = `Kali +${money(yearDifference)}`;
  } else {
    els.settleUp.textContent = `Keith +${money(Math.abs(yearDifference))}`;
  }
  updateSyncLabel();
}

function renderEntries() {
  const month = activeData();
  els.entriesList.innerHTML = "";
  if (!month.entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No shopping logged for this month yet.";
    els.entriesList.append(empty);
    return;
  }

  [...month.entries].reverse().forEach((entry) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="amount"]').textContent = money(entry.amount);
    node.querySelector('[data-field="meta"]').textContent = `${entry.paidBy} paid - ${entry.date}`;
    node.querySelector('[data-field="note"]').textContent = entry.note || "Shopping";
    node.querySelector('[data-action="delete"]').addEventListener("click", () => deleteEntry(entry.id));
    els.entriesList.append(node);
  });
}

function renderView() {
  const activeView = state.activeView === "list" ? "list" : "tracker";
  els.viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.viewButton === activeView);
  });
  els.trackerViews.forEach((section) => {
    section.hidden = activeView !== "tracker";
  });
  els.listView.hidden = activeView !== "list";
}

function renderShoppingList() {
  const items = [...state.shoppingList.items].sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
  const openCount = items.filter((item) => !item.done).length;
  els.listCount.textContent = `${openCount} ${openCount === 1 ? "item" : "items"}`;
  els.supermarketListItems.innerHTML = "";
  els.costcoListItems.innerHTML = "";
  renderRememberedItems();

  if (!items.length) {
    els.supermarketListItems.append(emptyListMessage("No supermarket items yet."));
    els.costcoListItems.append(emptyListMessage("No Costco items yet."));
    return;
  }

  const groups = {
    supermarkets: items.filter((item) => (item.listType || "supermarkets") === "supermarkets"),
    costco: items.filter((item) => item.listType === "costco"),
  };

  renderListGroup(els.supermarketListItems, groups.supermarkets, "No supermarket items yet.");
  renderListGroup(els.costcoListItems, groups.costco, "No Costco items yet.");
}

function emptyListMessage(text) {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text;
  return empty;
}

function renderRememberedItems() {
  const listType = els.listTypeSelect.value === "costco" ? "costco" : "supermarkets";
  const remembered = state.shoppingList.savedItems[listType].filter(Boolean);
  const unique = [...new Set(remembered)].sort((a, b) => a.localeCompare(b));
  els.rememberedItems.innerHTML = "";
  for (const item of unique) {
    const option = document.createElement("option");
    option.value = item;
    els.rememberedItems.append(option);
  }
}

function renderListGroup(container, items, emptyText) {
  if (!items.length) {
    container.append(emptyListMessage(emptyText));
    return;
  }

  for (const item of items) {
    const node = els.listItemTemplate.content.firstElementChild.cloneNode(true);
    node.classList.toggle("done", Boolean(item.done));
    const checkbox = node.querySelector('[data-action="toggle"]');
    checkbox.checked = Boolean(item.done);
    node.querySelector('[data-field="text"]').textContent = item.text;
    checkbox.addEventListener("change", () => toggleListItem(item.id, checkbox.checked));
    node.querySelector('[data-action="delete"]').addEventListener("click", () => deleteListItem(item.id));
    container.append(node);
  }
}

function render() {
  renderView();
  renderMonthOptions();
  renderInputs();
  renderSummary();
  renderEntries();
  renderShoppingList();
}

function addListItem() {
  const text = els.listItemInput.value.trim();
  const listType = els.listTypeSelect.value === "costco" ? "costco" : "supermarkets";
  if (!text) {
    els.listItemInput.focus();
    return;
  }

  rememberListItem(text, listType);
  state.shoppingList.items.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    text,
    listType,
    done: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncPending: true,
  });

  els.listItemInput.value = "";
  saveState();
  render();
  els.listItemInput.focus();
}

function toggleListItem(itemId, done) {
  const item = state.shoppingList.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  rememberListItem(item.text, item.listType || "supermarkets");
  item.done = done;
  item.updatedAt = new Date().toISOString();
  item.syncPending = true;
  saveState();
  render();
}

function deleteListItem(itemId) {
  const item = state.shoppingList.items.find((candidate) => candidate.id === itemId);
  if (item) rememberListItem(item.text, item.listType || "supermarkets");
  state.shoppingList.items = state.shoppingList.items.filter((item) => item.id !== itemId);
  if (!state.deletedListItemIds.includes(itemId)) state.deletedListItemIds.push(itemId);
  saveState();
  render();
}

function rememberListItem(text, listType) {
  const clean = text.trim();
  if (!clean) return;
  const type = listType === "costco" ? "costco" : "supermarkets";
  const existing = state.shoppingList.savedItems[type];
  if (existing.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
  existing.push(clean);
  existing.sort((a, b) => a.localeCompare(b));
  state.shoppingList.savedItemsSyncPending = true;
}

function addEntry() {
  const amount = parseAmount(els.amountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    els.amountInput.focus();
    els.amountInput.select();
    return;
  }

  activeData().entries.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    paidBy: els.paidBy.value,
    amount,
    expression: els.amountInput.value.trim(),
    note: els.noteInput.value.trim(),
    date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    createdAt: new Date().toISOString(),
    syncPending: true,
  });

  els.amountInput.value = "";
  els.noteInput.value = "";
  saveState();
  render();
  els.amountInput.focus();
}

function deleteEntry(entryId) {
  activeData().entries = activeData().entries.filter((item) => item.id !== entryId);
  if (!state.deletedEntryIds.includes(entryId)) state.deletedEntryIds.push(entryId);
  saveState();
  render();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shopping-kitty-${state.activeMonth}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
      state = loadState();
      for (const month of Object.values(state.months)) {
        month.contributionSyncPending = true;
        month.entries = month.entries.map((entry) => ({ ...entry, syncPending: true }));
      }
      saveState();
      render();
    } catch {
      setSaveState("Bad file");
      setTimeout(updateSyncLabel, 1400);
    }
  });
  reader.readAsText(file);
}

function clearMonth() {
  const month = activeData();
  if (!month.entries.length && !month.contributions.Kali && !month.contributions.Keith) return;
  const label = monthStarts.find(([key]) => key === state.activeMonth)?.[1] || "this month";
  if (!confirm(`Clear ${label}? This removes contributions and shopping for this month.`)) return;
  for (const entry of month.entries) {
    if (!state.deletedEntryIds.includes(entry.id)) state.deletedEntryIds.push(entry.id);
  }
  month.contributions = { Kali: "", Keith: "" };
  month.contributionSyncPending = true;
  month.entries = [];
  saveState();
  render();
}

function queueSync() {
  if (isApplyingRemote || !firebase) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushPendingSync, 450);
}

async function pushPendingSync() {
  if (!firebase) return;
  const { db, api } = firebase;
  const householdRef = api.doc(db, "households", HOUSEHOLD_ID);

  try {
    if (state.shoppingList.savedItemsSyncPending) {
      await api.setDoc(
        api.doc(householdRef, "shoppingListMeta", "catalog"),
        {
          savedItems: state.shoppingList.savedItems,
          updatedAt: api.serverTimestamp(),
        },
        { merge: true },
      );
      state.shoppingList.savedItemsSyncPending = false;
    }

    for (const item of state.shoppingList.items.filter((candidate) => candidate.syncPending)) {
      const { syncPending, ...remoteItem } = item;
      await api.setDoc(api.doc(householdRef, "shoppingList", "items", "items", item.id), {
        ...remoteItem,
        updatedAt: api.serverTimestamp(),
      });
      item.syncPending = false;
    }

    for (const itemId of [...state.deletedListItemIds]) {
      await api.deleteDoc(api.doc(householdRef, "shoppingList", "items", "items", itemId)).catch(() => {});
      state.deletedListItemIds = state.deletedListItemIds.filter((id) => id !== itemId);
    }

    for (const [monthKey, month] of Object.entries(state.months)) {
      if (month.contributionSyncPending) {
        await api.setDoc(
          api.doc(householdRef, "months", monthKey),
          { contributions: month.contributions, updatedAt: api.serverTimestamp() },
          { merge: true },
        );
        month.contributionSyncPending = false;
      }

      for (const entry of month.entries.filter((item) => item.syncPending)) {
        const { syncPending, ...remoteEntry } = entry;
        await api.setDoc(api.doc(householdRef, "months", monthKey, "entries", entry.id), {
          ...remoteEntry,
          monthKey,
          updatedAt: api.serverTimestamp(),
        });
        entry.syncPending = false;
      }
    }

    for (const entryId of [...state.deletedEntryIds]) {
      for (const [monthKey] of monthStarts) {
        await api.deleteDoc(api.doc(householdRef, "months", monthKey, "entries", entryId)).catch(() => {});
      }
      state.deletedEntryIds = state.deletedEntryIds.filter((id) => id !== entryId);
    }

    saveLocalNow();
    render();
  } catch {
    setSaveState("Saved local");
  }
}

function subscribeToShoppingList() {
  if (!firebase) return;
  if (listUnsubscriber) listUnsubscriber();

  const { db, api } = firebase;
  const householdRef = api.doc(db, "households", HOUSEHOLD_ID);
  const listRef = api.collection(householdRef, "shoppingList", "items", "items");
  const catalogRef = api.doc(householdRef, "shoppingListMeta", "catalog");

  api.onSnapshot(catalogRef, (snapshot) => {
    if (!snapshot.exists() || state.shoppingList.savedItemsSyncPending) return;
    const data = snapshot.data();
    if (!data.savedItems) return;
    isApplyingRemote = true;
    state.shoppingList.savedItems = {
      supermarkets: data.savedItems.supermarkets || [],
      costco: data.savedItems.costco || [],
    };
    saveLocalNow();
    render();
    isApplyingRemote = false;
  });

  listUnsubscriber = api.onSnapshot(api.query(listRef, api.orderBy("createdAt", "asc")), (snapshot) => {
    const remoteItems = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      listType: "supermarkets",
      ...docSnap.data(),
      listType: docSnap.data().listType || "supermarkets",
      syncPending: false,
    }));
    const localPending = state.shoppingList.items.filter((item) => item.syncPending);
    const deleted = new Set(state.deletedListItemIds);
    isApplyingRemote = true;
    state.shoppingList.items = [
      ...remoteItems.filter((item) => !deleted.has(item.id)),
      ...localPending.filter((item) => !remoteItems.some((remote) => remote.id === item.id)),
    ];
    saveLocalNow();
    render();
    isApplyingRemote = false;
  });
}

function subscribeToActiveMonth() {
  if (!firebase) return;
  activeUnsubscribers.forEach((unsubscribe) => unsubscribe());
  activeUnsubscribers = [];

  const { db, api } = firebase;
  const householdRef = api.doc(db, "households", HOUSEHOLD_ID);
  const monthRef = api.doc(householdRef, "months", state.activeMonth);
  const entriesRef = api.collection(monthRef, "entries");

  activeUnsubscribers.push(
    api.onSnapshot(monthRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      const month = activeData();
      if (!month.contributionSyncPending && data.contributions) {
        isApplyingRemote = true;
        month.contributions = { ...month.contributions, ...data.contributions };
        saveLocalNow();
        render();
        isApplyingRemote = false;
      }
    }),
  );

  activeUnsubscribers.push(
    api.onSnapshot(api.query(entriesRef, api.orderBy("createdAt", "asc")), (snapshot) => {
      const month = activeData();
      const remoteEntries = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
        syncPending: false,
      }));
      const localPending = month.entries.filter((entry) => entry.syncPending);
      const deleted = new Set(state.deletedEntryIds);
      isApplyingRemote = true;
      month.entries = [
        ...remoteEntries.filter((entry) => !deleted.has(entry.id)),
        ...localPending.filter((entry) => !remoteEntries.some((remote) => remote.id === entry.id)),
      ].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      saveLocalNow();
      render();
      isApplyingRemote = false;
    }),
  );
}

async function initFirebaseSync() {
  const config = window.shoppingKittyFirebaseConfig;
  if (!config?.projectId) {
    setSaveState("Saved local");
    return;
  }

  try {
    const [appModule, firestoreModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"),
    ]);
    const app = appModule.initializeApp(config);
    const db = firestoreModule.getFirestore(app);
    await firestoreModule.enableIndexedDbPersistence(db).catch(() => {});
    firebase = { db, api: firestoreModule };
    setSaveState("Syncing");
    subscribeToShoppingList();
    subscribeToActiveMonth();
    queueSync();
  } catch {
    setSaveState("Saved local");
  }
}

els.monthSelect.addEventListener("change", () => {
  state.activeMonth = els.monthSelect.value;
  saveState();
  render();
  subscribeToActiveMonth();
});

els.viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeView = button.dataset.viewButton === "list" ? "list" : "tracker";
    saveState();
    render();
  });
});

els.kaliContribution.addEventListener("input", () => {
  activeData().contributions.Kali = els.kaliContribution.value;
  activeData().contributionSyncPending = true;
  saveState();
  renderSummary();
});

els.keithContribution.addEventListener("input", () => {
  activeData().contributions.Keith = els.keithContribution.value;
  activeData().contributionSyncPending = true;
  saveState();
  renderSummary();
});

els.addEntryBtn.addEventListener("click", addEntry);
els.addListItemBtn.addEventListener("click", addListItem);
els.listTypeSelect.addEventListener("change", renderRememberedItems);
els.amountInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addEntry();
});
els.noteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addEntry();
});
els.listItemInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addListItem();
});
els.exportBtn.addEventListener("click", exportBackup);
els.importInput.addEventListener("change", (event) => importBackup(event.target.files[0]));
els.clearMonthBtn.addEventListener("click", clearMonth);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

render();
initFirebaseSync();
