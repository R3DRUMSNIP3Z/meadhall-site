// ===============================
// Valhalla Ascending — Inventory
// 5x5 stacks (25), stack size 99
// ===============================
type InvItem = { id: string; name: string; icon: string; qty: number };

function getUserId(): string {
  try {
    const raw = localStorage.getItem("mh_user");
    if (raw) {
      const o = JSON.parse(raw);
      return o?.id || o?._id || o?.user?.id || "guest";
    }
  } catch {}
  return "guest";
}

const UID = getUserId();
const KEY = `va_inventory__${UID}`;
const CAPACITY = 25;
const STACK_MAX = 99;

function load(): InvItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function save(items: InvItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

function toast(msg: string) {
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed",
    left: "50%",
    bottom: "24px",
    transform: "translateX(-50%)",
    background: "rgba(20,20,20,.92)",
    color: "#e6d5a9",
    border: "1px solid #9b834d",
    padding: "8px 12px",
    borderRadius: "10px",
    zIndex: "100000",
    boxShadow: "0 6px 24px rgba(0,0,0,.45)",
    fontFamily: "Cinzel, serif",
  } as CSSStyleDeclaration);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

function ensureUI() {
  // bag button
  if (!document.getElementById("vaBagBtn")) {
    const btn = document.createElement("button");
    btn.id = "vaBagBtn";
    btn.title = "Inventory";
    btn.innerHTML =
      `<img src="/guildbook/ui/inventorybag.png" alt="Bag" style="width:54px;height:54px;object-fit:contain;display:block">` +
      `<span id="vaBagBadge" style="position:absolute;right:-6px;bottom:-4px;background:#7a1d1d;color:#f3d7a4;border:1px solid rgba(255,255,255,.18);border-radius:999px;font-size:12px;padding:2px 6px;min-width:20px;text-align:center;display:none">0</span>`;
    Object.assign(btn.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      background: "transparent",
      border: "0",
      padding: "0",
      cursor: "pointer",
      zIndex: "99999",
    } as CSSStyleDeclaration);
    document.body.appendChild(btn);
    btn.addEventListener("click", toggle);
  }

  // modal
  if (!document.getElementById("vaInvOverlay")) {
    const ov = document.createElement("div");
    ov.id = "vaInvOverlay";
    ov.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:100000;";
    ov.innerHTML = `
      <div id="vaInvModal" role="dialog" aria-modal="true" style="
        width:min(640px,94vw);background:#12161a;border:1px solid #3b3325;border-radius:16px;
        color:#d4a94d;padding:14px;box-shadow:0 14px 48px rgba(0,0,0,.6);font-family:Cinzel, serif;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
          <div style="font-weight:900">Inventory</div>
          <button id="vaInvClose" style="background:#1b2228;border:1px solid #3b3325;border-radius:10px;color:#d4a94d;padding:6px 10px;cursor:pointer">✖</button>
        </div>
        <div id="vaInvGrid" style="
          display:grid;grid-template-columns:repeat(5,96px);grid-auto-rows:96px;gap:10px;justify-content:center;">
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => {
      if (e.target === ov) close();
    });
    document.getElementById("vaInvClose")!.addEventListener("click", close);
  }
}

function setBadge(items: InvItem[]) {
  const badge = document.getElementById("vaBagBadge") as HTMLSpanElement | null;
  if (!badge) return;
  const total = items.reduce((s, it) => s + it.qty, 0);
  if (total > 0) {
    badge.style.display = "inline-block";
    badge.textContent = String(total);
  } else {
    badge.style.display = "none";
  }
}

/* ========= generic overlay for showing an image ========= */
function openImageOverlay(url: string, alt = "Image") {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.7);
    display:flex; align-items:center; justify-content:center;
    z-index: 100001; /* above inventory */
  `;
  overlay.innerHTML = `
    <div style="position:relative">
      <img src="${url}" alt="${alt}" style="max-width:92vw; max-height:92vh; object-fit:contain; border-radius:10px;">
      <button id="imgClose" style="
        position:absolute; top:10px; right:10px; border:none;
        background:rgba(0,0,0,.6); color:#fff; font:18px;
        padding:6px 10px; border-radius:8px; cursor:pointer;">×</button>
    </div>
  `;
  overlay.querySelector<HTMLButtonElement>("#imgClose")!.onclick = () =>
    overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

/* ========= per-item click behavior ========= */
function handleItemClick(it: InvItem, _index: number) {
  if (it.id === "wizardscroll") {
    openImageOverlay(
      "/guildbook/loot/unsheathedscroll.png",
      "Quest Scroll"
    );
    return;
  }

  toast(`${it.name} ×${it.qty}`);
}

function renderGrid(items: InvItem[]) {
  const grid = document.getElementById("vaInvGrid");
  if (!grid) return;
  grid.innerHTML = "";

  // copy then pad to capacity with empties
  const slots: (InvItem | null)[] = items.slice(0, CAPACITY);
  while (slots.length < CAPACITY) slots.push(null);

  slots.forEach((it, index) => {
    const cell = document.createElement("div");
    cell.style.cssText =
      "position:relative;border:1px solid #3b3325;border-radius:12px;background:#0f1215;overflow:hidden";
    if (it) {
      cell.innerHTML = `
        <img src="${it.icon}" alt="${it.name}" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:64px;height:64px;object-fit:contain;filter:drop-shadow(0 0 6px rgba(212,169,77,.35))">
        <div style="position:absolute;right:6px;bottom:4px;background:rgba(0,0,0,.55);color:#e6d5a9;border:1px solid rgba(255,255,255,.18);border-radius:7px;padding:0 6px;font-size:12px">${it.qty}</div>
        <div title="${it.name}" style="position:absolute;left:0;right:0;bottom:0;height:18px;font-size:11px;line-height:18px;text-align:center;color:#997e38;background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.45));border-top:1px solid rgba(200,169,107,.22)">${it.name}</div>
      `;
      cell.style.cursor = "pointer";
      cell.addEventListener("click", (ev) => {
        ev.stopPropagation();
        handleItemClick(it, index);
      });
    } else {
      cell.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6d5a35;opacity:.4;font-size:12px">Empty</div>`;
    }
    grid.appendChild(cell);
  });
}

function open() {
  const items = load();
  setBadge(items);
  renderGrid(items);
  (document.getElementById("vaInvOverlay") as HTMLDivElement).style.display =
    "flex";
}
function close() {
  (document.getElementById("vaInvOverlay") as HTMLDivElement).style.display =
    "none";
}
function toggle() {
  const ov = document.getElementById("vaInvOverlay") as HTMLDivElement;
  if (!ov || ov.style.display === "none" || ov.style.display === "") open();
  else close();
}

// --- Stacking logic (returns leftover if bag full) ---
function add(id: string, name: string, icon: string, qty: number): number {
  if (qty <= 0) return 0;
  const items = load();

  // 1) fill existing stacks
  for (const it of items) {
    if (it.id === id && it.qty < STACK_MAX) {
      const can = Math.min(STACK_MAX - it.qty, qty);
      it.qty += can;
      qty -= can;
      if (qty <= 0) break;
    }
  }
  // 2) create new stacks while space & qty
  while (qty > 0 && items.length < CAPACITY) {
    const take = Math.min(STACK_MAX, qty);
    items.push({ id, name, icon, qty: take });
    qty -= take;
  }

  save(items);
  setBadge(items);
  renderGrid(items); // harmless if modal closed
  if (qty > 0) toast("Bag is full — some items dropped!");
  else toast(`${name} added to bag`);
  return qty; // leftover (0 if fully added)
}

function removeAt(index: number, amount: number) {
  const items = load();
  const it = items[index];
  if (!it) return;
  it.qty -= amount;
  if (it.qty <= 0) items.splice(index, 1);
  save(items);
  setBadge(items);
  renderGrid(items);
}

/* ========= NEW: helpers for potions / crafting ========= */

// total quantity of a given item id
function count(id: string): number {
  const items = load();
  let total = 0;
  for (const it of items) {
    if (it.id === id) total += it.qty;
  }
  return total;
}

// convenience check
function has(id: string, qty = 1): boolean {
  return count(id) >= qty;
}

// consume a quantity across stacks; returns leftover (0 if fully removed)
function consume(id: string, qty: number): number {
  if (qty <= 0) return 0;
  const items = load();
  let remaining = qty;

  // walk from the END so newest stacks are removed last or first, as you prefer
  for (let i = items.length - 1; i >= 0 && remaining > 0; i--) {
    const it = items[i];
    if (it.id !== id) continue;

    const take = Math.min(it.qty, remaining);
    it.qty -= take;
    remaining -= take;

    if (it.qty <= 0) {
      items.splice(i, 1);
    }
  }

  save(items);
  setBadge(items);
  renderGrid(items);
  return remaining;
}

export const Inventory = {
  init() {
    ensureUI();
    setBadge(load());
  },
  add,
  removeAt,
  // full list of items
  get() {
    return load();
  },
  // NEW helpers used by cauldron / crafting
  count,
  has,
  consume,
  open,
  close,
  toggle,
  CAPACITY,
  STACK_MAX,
};

