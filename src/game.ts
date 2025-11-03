// ===============================
// Valhalla Ascending — src/game.ts
// (unspent points fixed + DEV console for /api/dev/* + server rename + wider slots + Profile btn)
// ===============================

type Gender = "female" | "male";
type Slot =
  | "helm" | "shoulders" | "chest" | "gloves" | "boots"
  | "ring" | "wings" | "pet" | "sylph";

type Me = {
  id?: string;
  name?: string;
  level: number;
  xp: number;
  gold: number;
  power: number;     // server uses 'power' (UI shows "Strength")
  defense: number;
  speed: number;
  points?: number;
  gender?: Gender;
  slots?: Partial<Record<Slot, string>>;
  gearPower?: number;
  setBonus?: { power?: number; defense?: number; speed?: number };
  // NEW: one-time rename per account (server-enforced)
  renameUsed?: boolean;
};

type ShopItem = {
  id: string;
  set?: "drengr" | "skjaldmey" | string;
  slot?: Slot;
  name: string;
  rarity?: "normal" | "rare" | "epic" | "legendary";
  stat?: "power" | "defense" | "speed";
  boost?: number;
  cost: number;
  levelReq?: number;
  imageUrl?: string;
  description?: string;
};

// --------- helpers ----------
const apiBase =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || "";

function uid(): string {
  const k = "va_uid";
  let v = localStorage.getItem(k);
  if (!v) {
    v = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(k, v);
  }
  return v;
}
const USER_ID = uid();

// DEV key helper (for /api/dev/*)
function getDevKey(): string {
  const META = (document.querySelector('meta[name="dev-key"]') as HTMLMetaElement)?.content?.trim();
  if (META) {
    localStorage.setItem("va_dev_key", META);
    return META;
  }
  const saved = localStorage.getItem("va_dev_key");
  if (saved) return saved;
  const typed = prompt("Enter DEV KEY for /api/dev:", "")?.trim() || "";
  if (typed) localStorage.setItem("va_dev_key", typed);
  return typed;
}

// simple fetch with headers
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(apiBase + path, {
    ...init,
    headers: {
      "x-user-id": USER_ID,
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
  return r.json() as Promise<T>;
}

// --------- DOM refs ----------
const elHeroName = document.getElementById("heroName") as HTMLElement;
const elRenameBtn = document.getElementById("renameBtn") as HTMLButtonElement;
const elLevel = document.getElementById("level") as HTMLElement;
const elGold = document.getElementById("gold") as HTMLElement;
const elXPVal = document.getElementById("xpVal") as HTMLElement;
const elXPBar = document.getElementById("xpBar") as HTMLSpanElement;
const elStrength = document.getElementById("strength") as HTMLElement;
const elDefense = document.getElementById("defense") as HTMLElement;
const elSpeed = document.getElementById("speed") as HTMLElement;
const elPoints = document.getElementById("points") as HTMLElement;
const elBR = document.getElementById("battleRating") as HTMLElement;

const elGenderPick = document.getElementById("genderPick") as HTMLElement;
const btnFemale = document.getElementById("pickFemale") as HTMLButtonElement;
const btnMale = document.getElementById("pickMale") as HTMLButtonElement;

const btnTrainStr = document.getElementById("trainPower") as HTMLButtonElement;
const btnTrainDef = document.getElementById("trainDefense") as HTMLButtonElement;
const btnTrainSpd = document.getElementById("trainSpeed") as HTMLButtonElement;

const btnFight = document.getElementById("fightRandom") as HTMLButtonElement;
const btnTick = document.getElementById("tickNow") as HTMLButtonElement;

const elShop = document.getElementById("shop") as HTMLElement;
const elLog = document.getElementById("log") as HTMLElement;
const elAvatar = document.getElementById("avatar") as HTMLImageElement;

// === Tooltip helpers ===
const tipEl = document.getElementById("vaTooltip") as HTMLElement | null;

function tipShow(html: string): void {
  if (!tipEl) return;
  tipEl.innerHTML = html;
  tipEl.style.display = "block";
}
function tipMove(e: MouseEvent): void {
  if (!tipEl) return;
  const pad = 14;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const vw = window.innerWidth, vh = window.innerHeight;
  const r = tipEl.getBoundingClientRect();
  if (x + r.width  > vw) x = e.clientX - r.width  - pad;
  if (y + r.height > vh) y = e.clientY - r.height - pad;
  tipEl.style.left = x + "px";
  tipEl.style.top  = y + "px";
}
function tipHide(): void {
  if (!tipEl) return;
  tipEl.style.display = "none";
  tipEl.innerHTML = "";
}
function buildItemTip(it: ShopItem): string {
  const statLabel = it.stat === "power" ? "Strength" : (it.stat || "—");
  const setName = (it.set || "").toUpperCase();
  const slotName = (it.slot || "").toUpperCase();
  return `
    <div class="tt-title">${it.name}</div>
    <div class="tt-row"><span class="muted">Set</span><span>${setName || "—"}</span></div>
    <div class="tt-row"><span class="muted">Slot</span><span>${slotName || "—"}</span></div>
    <div class="tt-row"><span class="muted">${statLabel}</span><span>+${it.boost ?? 0}</span></div>
    ${it.levelReq ? `<div class="tt-row"><span class="muted">Req</span><span>Lv ${it.levelReq}</span></div>` : ""}
    <div class="tt-row"><span class="muted">Rarity</span><span>${(it.rarity || "normal").toUpperCase()}</span></div>
    <div style="margin-top:6px; opacity:.85">${it.description || ""}</div>
  `;
}

// gear slots
const slotEls: Record<Slot, HTMLElement> = {
  helm: document.querySelector('.slot[data-slot="helm"]') as HTMLElement,
  shoulders: document.querySelector('.slot[data-slot="shoulders"]') as HTMLElement,
  chest: document.querySelector('.slot[data-slot="chest"]') as HTMLElement,
  gloves: document.querySelector('.slot[data-slot="gloves"]') as HTMLElement,
  boots: document.querySelector('.slot[data-slot="boots"]') as HTMLElement,
  ring: document.querySelector('.slot[data-slot="ring"]') as HTMLElement,
  wings: document.querySelector('.slot[data-slot="wings"]') as HTMLElement,
  pet: document.querySelector('.slot[data-slot="pet"]') as HTMLElement,
  sylph: document.querySelector('.slot[data-slot="sylph"]') as HTMLElement,
};

// ------- state -------
let me: Me | null = null;
let shop: ShopItem[] = [];

// ------- UI helpers -------
function setText(n: HTMLElement | null, v: string | number) {
  if (n) n.textContent = String(v);
}
function addLog(line: string, cls?: "ok" | "bad") {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = line;
  elLog.appendChild(div);
  elLog.scrollTop = elLog.scrollHeight;
}
function computeBR(m: Me): number {
  const s = Math.max(0, Math.floor(m.power || 0));
  const d = Math.max(0, Math.floor(m.defense || 0));
  const sp = Math.max(0, Math.floor(m.speed || 0));
  return s + d + sp;
}
function updateTrainButtons() {
  const hasPts = (me?.points ?? 0) > 0;
  btnTrainStr.disabled = !hasPts;
  btnTrainDef.disabled = !hasPts;
  btnTrainSpd.disabled = !hasPts;
  elPoints?.classList.toggle("no-points", !hasPts);
}

// ------- UI refresh -------
function refreshUI() {
  if (!me) return;

  setText(elHeroName, me.name || "Skald");

  const need = (me.level || 1) * 100;
  const have = Math.max(0, me.xp || 0);
  setText(elXPVal, `${have} / ${need}`);
  elXPBar.style.width = Math.min(100, (have / need) * 100) + "%";

  setText(elLevel, me.level || 1);
  setText(elGold, Math.max(0, me.gold || 0));

  // Stats
  setText(elStrength, Math.max(0, me.power || 0));
  setText(elDefense, Math.max(0, me.defense || 0));
  setText(elSpeed, Math.max(0, me.speed || 0));
  setText(elPoints, Math.max(0, me.points || 0));

  updateTrainButtons();

  // BR
  const br = computeBR(me);
  setText(elBR, `BATTLE RATING ${br}`);

  // Avatar by gender
  if (me.gender === "female") elAvatar.src = "/guildbook/girl.png";
  else if (me.gender === "male") elAvatar.src = "/guildbook/boy.png";

  // Gender picker visible until chosen
  elGenderPick.style.display = me.gender ? "none" : "block";

  // PvP lock
  btnFight.disabled = (me.level || 1) < 25;

  // Equip slots
  Object.entries(slotEls).forEach(([slotKey, el]) => {
    const slot = slotKey as Slot;
    const equipped = me!.slots?.[slot];
    el.innerHTML = ""; // clear
    el.classList.remove("locked");

    // lock by level
    const unlock: Record<Slot, number> = {
      helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
      ring: 18, wings: 22, pet: 24, sylph: 28
    };
    const needLvl = unlock[slot];
    if ((me!.level || 1) < needLvl) {
      el.classList.add("locked");
      el.textContent = slot[0].toUpperCase() + slot.slice(1);
      return;
    }

    if (!equipped) {
      el.textContent = slot[0].toUpperCase() + slot.slice(1);
      return;
    }

    // find item for its image
    const it = shop.find(s => s.id === equipped);
    const img = document.createElement("img");
    img.className = "slot-img";
    img.alt = it?.name || equipped;
    img.src = it?.imageUrl || `/guildbook/items/${equipped}.png`;
    el.appendChild(img);

    const frame = document.createElement("img");
    frame.className = "rarity-frame";
    frame.alt = "";
    frame.src = `/guildbook/frames/${(it?.rarity || "normal")}-frame.svg`;
    el.appendChild(frame);
  });

  // ensure rename button follows server rule
  if (elRenameBtn) elRenameBtn.disabled = !!me.renameUsed;
}

// ------- load / actions -------
async function loadMe() {
  const data = await api<{ me: Me }>("/api/game/me");
  // preserve your visual local override if present
  const override = localStorage.getItem("va_name_override");
  if (override) data.me.name = override;
  me = data.me;
  // server-enforced rename lock wins
  if (elRenameBtn) elRenameBtn.disabled = !!me.renameUsed;
  refreshUI();
}

async function tickNow() {
  const data = await api<{ me: Me }>("/api/game/tick", { method: "POST" });
  const override = localStorage.getItem("va_name_override");
  if (override) data.me.name = override;
  me = data.me;
  refreshUI();
}

async function train(statUi: "power" | "defense" | "speed") {
  const data = await api<{ me: Me }>("/api/game/train", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stat: statUi }),
  });
  const override = localStorage.getItem("va_name_override");
  if (override) data.me.name = override;
  me = data.me;
  addLog(`Trained ${statUi === "power" ? "Strength" : statUi}. +1`, "ok");
  refreshUI();
}

async function loadShop() {
  const data = await api<{ items: ShopItem[] }>("/api/game/shop");
  shop = data.items || [];
  renderShop();
}

function renderShop() {
  elShop.innerHTML = "";
  if (!shop.length) {
    elShop.textContent = "No items available.";
    return;
  }

  for (const it of shop) {
    const row = document.createElement("div");
    row.className = "shop-item";

    // LEFT: thumb (image + overlay frame) + text
    const left = document.createElement("div");
    left.className = "shop-left";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "shop-thumb";

    const img = document.createElement("img");
    img.className = "shop-img";
    img.alt = it.name;
    img.src = it.imageUrl || `/guildbook/items/${it.id}.png`;

    const frame = document.createElement("img");
    frame.className = "shop-frame";
    frame.alt = "";
    frame.src = `/guildbook/frames/${(it.rarity || "normal")}-frame.svg`;

    thumbWrap.appendChild(img);
    thumbWrap.appendChild(frame);

    const text = document.createElement("div");
    text.className = "shop-text";

    const ttl = document.createElement("div");
    ttl.className = "shop-title";
    ttl.textContent = it.name;

    const sub = document.createElement("div");
    sub.className = "muted";
    const statLabel = it.stat === "power" ? "Strength" : (it.stat || "—");
    const setTxt  = (it.set || "").toUpperCase();
    const slotTxt = (it.slot || "").toUpperCase();
    sub.textContent = `${setTxt} • ${slotTxt} • ${statLabel}${it.boost ? ` +${it.boost}` : ""}`;

    text.appendChild(ttl);
    text.appendChild(sub);

    left.appendChild(thumbWrap);
    left.appendChild(text);

    // RIGHT: price + buy
    const right = document.createElement("div");
    right.className = "shop-right";

    const price = document.createElement("div");
    price.className = "shop-price";
    price.textContent = `${it.cost}g`;

    const btn = document.createElement("button");
    btn.textContent = "Buy";
    btn.addEventListener("click", () => buyItem(it.id));

    right.appendChild(price);
    right.appendChild(btn);

    // Tooltip
    const tipHTML = buildItemTip(it);
    row.addEventListener("mouseenter", () => tipShow(tipHTML));
    row.addEventListener("mousemove", tipMove);
    row.addEventListener("mouseleave", tipHide);

    row.appendChild(left);
    row.appendChild(right);
    elShop.appendChild(row);
  }
}

async function buyItem(itemId: string) {
  try {
    const data = await api<{ me: Me; item: ShopItem }>("/api/game/shop/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const override = localStorage.getItem("va_name_override");
    if (override) data.me.name = override;
    me = data.me;
    addLog(`Purchased ${data.item.name}.`, "ok");
    refreshUI();
  } catch (err: any) {
    addLog(`Buy failed: ${err.message || err}`, "bad");
  }
}

async function fightRandom() {
  try {
    const data = await api<{
      me: Me;
      result: {
        win: boolean;
        opponent: { id: string; name?: string; level: number };
        deltaGold: number; deltaXP: number;
      };
    }>("/api/pvp/fight", { method: "POST" });
    const override = localStorage.getItem("va_name_override");
    if (override) data.me.name = override;
    me = data.me;
    addLog(
      `PvP ${data.result.win ? "WIN" : "LOSS"} vs ${data.result.opponent.name || "foe"} (Lv ${data.result.opponent.level}) — ${data.result.deltaGold}g, ${data.result.deltaXP}xp`,
      data.result.win ? "ok" : "bad"
    );
    refreshUI();
  } catch (err: any) {
    addLog(`Fight failed: ${err.message || err}`, "bad");
  }
}

async function pickGender(g: Gender) {
  try {
    const data = await api<{ me: Me }>("/api/game/gender", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: g }),
    });
    const override = localStorage.getItem("va_name_override");
    if (override) data.me.name = override;
    me = data.me;
    await loadShop(); // refresh items with gender filter
    refreshUI();
  } catch (err: any) {
    addLog(`Gender set failed: ${err.message || err}`, "bad");
  }
}



// NEW: server-enforced rename
async function handleRename() {
  if (me?.renameUsed) {
    addLog("You already renamed your hero once.", "bad");
    return;
  }
  const current = (me?.name || "Skald").trim();
  const next = prompt("Choose your hero name (one-time):", current)?.trim();
  if (!next || next === current) return;

  try {
    const resp = await api<{ me: Me }>("/api/game/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    me = resp.me;
    // keep your local visual override in sync (optional)
    localStorage.setItem("va_name_override", me.name || next);
    addLog(`Name set to ${me.name}`, "ok");
    if (elRenameBtn) elRenameBtn.disabled = !!me.renameUsed;
    refreshUI();
  } catch (err: any) {
    addLog(`Rename failed: ${err?.message || err}`, "bad");
  }
}

// ------- DEV CONSOLE -------
let devOpen = false;
let devWrap: HTMLDivElement | null = null;
let devInput: HTMLInputElement | null = null;

function ensureDevConsole() {
  if (devWrap) return;
  devWrap = document.createElement("div");
  devWrap.id = "vaDevConsole";
  Object.assign(devWrap.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: "9999",
    background: "rgba(15,15,18,.92)",
    border: "1px solid #3b3b44",
    padding: "8px",
    borderRadius: "10px",
    boxShadow: "0 6px 24px rgba(0,0,0,.5)",
    display: "none",
    minWidth: "280px",
  } as CSSStyleDeclaration);

  const lab = document.createElement("div");
  lab.textContent = "Dev Console (Shift+D)";
  lab.style.fontSize = "12px";
  lab.style.opacity = "0.75";
  lab.style.marginBottom = "6px";

  devInput = document.createElement("input");
  devInput.type = "text";
  devInput.placeholder = 'e.g., gold add 1000 | item skjaldmey-helm';
  Object.assign(devInput.style, {
    width: "100%",
    padding: "8px 10px",
    background: "#0e0e12",
    border: "1px solid #2a2a32",
    color: "#e8e8f0",
    borderRadius: "8px",
  } as CSSStyleDeclaration);
  devInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const txt = (devInput!.value || "").trim();
      devInput!.value = "";
      if (txt) handleDevCommand(txt);
    } else if (e.key === "Escape") {
      toggleDevConsole(false);
    }
  });

  devWrap.appendChild(lab);
  devWrap.appendChild(devInput);
  document.body.appendChild(devWrap);
}

function toggleDevConsole(force?: boolean) {
  ensureDevConsole();
  devOpen = force ?? !devOpen;
  if (!devWrap) return;
  devWrap.style.display = devOpen ? "block" : "none";
  if (devOpen) devInput?.focus();
}

window.addEventListener("keydown", (e) => {
  if (e.shiftKey && (e.key === "D" || e.key === "d")) {
    e.preventDefault();
    toggleDevConsole();
  }
});

// unified POST helper to /api/dev/*
async function devPost<T>(path: string, body?: any): Promise<T> {
  const devKey = getDevKey();
  return api<T>(`/api/dev${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-dev-key": devKey || "",   // backend requireDev() checks this
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function handleDevCommand(raw: string) {
  const parts = raw.split(/\s+/);
  const main = (parts.shift() || "").toLowerCase();

  try {
    switch (main) {
      case "me": {
        const devKey = getDevKey();
        const r = await api<{ me: Me; devKeyOk: boolean; catalogPath: string }>("/api/dev/me", {
          headers: { "x-dev-key": devKey || "" }
        });
        me = r.me;
        addLog(`(DEV) me — ok (catalog: ${r.catalogPath})`, "ok");
        refreshUI();
        break;
      }

      case "gold": {
        // gold add 1000   OR   gold set 50000
        const mode = (parts.shift() || "").toLowerCase(); // "add" | "set"
        const amt = Number(parts.shift() || 0);
        if (!["add", "set"].includes(mode) || !Number.isFinite(amt)) {
          throw new Error("Usage: gold add|set <number>");
        }
        const payload = mode === "set" ? { set: Math.floor(amt) } : { add: Math.floor(amt) };
        const r = await devPost<{ me: Me }>("/gold", payload);
        me = r.me;
        addLog(`(DEV) gold ${mode} ${amt} — ok`, "ok");
        refreshUI();
        break;
      }

      case "points": {
        // points add 10
        const sub = (parts.shift() || "").toLowerCase();
        const amt = Number(parts.shift() || 0);
        if (sub !== "add" || !Number.isFinite(amt)) {
          throw new Error("Usage: points add <number>");
        }
        const r = await devPost<{ me: Me }>("/points", { add: Math.floor(amt) });
        me = r.me;
        addLog(`(DEV) points +${amt}`, "ok");
        refreshUI();
        break;
      }

      case "xp": {
        // xp add 500
        const sub = (parts.shift() || "").toLowerCase();
        const amt = Number(parts.shift() || 0);
        if (sub !== "add" || !Number.isFinite(amt)) {
          throw new Error("Usage: xp add <number>");
        }
        const r = await devPost<{ me: Me }>("/xp", { add: Math.floor(amt) });
        me = r.me;
        addLog(`(DEV) xp +${amt}`, "ok");
        refreshUI();
        break;
      }

      case "level": {
        // level 25
        const lv = Number(parts.shift() || 0);
        if (!Number.isFinite(lv) || lv < 1) {
          throw new Error("Usage: level <number>=1+");
        }
        const r = await devPost<{ me: Me }>("/level", { level: Math.floor(lv) });
        me = r.me;
        addLog(`(DEV) level -> ${lv}`, "ok");
        refreshUI();
        break;
      }

      case "item": {
        // item <itemId>
        const itemId = parts.shift();
        if (!itemId) throw new Error("Usage: item <itemId>");
        const r = await devPost<{ me: Me; item: ShopItem }>("/item", { itemId });
        me = r.me;
        addLog(`(DEV) item ${itemId} granted & auto-equipped if slot set`, "ok");
        await loadShop();
        refreshUI();
        break;
      }

      case "slots": {
        // slots {"helm":"skjaldmey-helm","chest":"skjaldmey-chest"}
        const json = parts.join(" ");
        let slots: Partial<Record<Slot, string>> | null = null;
        try { slots = JSON.parse(json); } catch {}
        if (!slots || typeof slots !== "object") {
          throw new Error('Usage: slots {"helm":"id","chest":"id",...}');
        }
        const r = await devPost<{ me: Me }>("/slots", { slots });
        me = r.me;
        addLog(`(DEV) slots patched`, "ok");
        refreshUI();
        break;
      }

      case "equip-set": {
        // equip-set skjaldmey
        const setId = parts.shift();
        if (!setId) throw new Error("Usage: equip-set <setId>");
        const r = await devPost<{ me: Me; equipped: string[] }>("/equip-set", { setId });
        me = r.me;
        addLog(`(DEV) set equipped: ${r.equipped.join(", ")}`, "ok");
        await loadShop();
        refreshUI();
        break;
      }

      case "drengr": {
        const r = await devPost<{ me: Me; equipped: string[] }>("/drengr");
        me = r.me;
        addLog(`(DEV) drengr set equipped: ${r.equipped.join(", ")}`, "ok");
        await loadShop();
        refreshUI();
        break;
      }

      case "reset": {
        await devPost<{ ok: boolean }>("/reset");
        addLog("(DEV) account reset.", "ok");
        await loadMe();
        await loadShop();
        break;
      }

      case "help":
      default: {
        addLog("(DEV) Commands:", "ok");
        addLog("  me", "ok");
        addLog("  gold add <n> | gold set <n>", "ok");
        addLog("  points add <n>", "ok");
        addLog("  xp add <n>", "ok");
        addLog("  level <n>", "ok");
        addLog("  item <itemId>", "ok");
        addLog('  slots {\"helm\":\"id\",\"chest\":\"id\"}', "ok");
        addLog("  equip-set <setId>", "ok");
        addLog("  drengr", "ok");
        addLog("  reset", "ok");
      }
    }
  } catch (err: any) {
    addLog(`(DEV) ${main || "cmd"} failed: ${err?.message || err}`, "bad");
  }
}

// ------- events -------
btnTrainStr.addEventListener("click", () => { addCooldown(btnTrainStr); train("power"); });   // Strength
btnTrainDef.addEventListener("click", () => { addCooldown(btnTrainDef); train("defense"); });
btnTrainSpd.addEventListener("click", () => { addCooldown(btnTrainSpd); train("speed"); });
btnTick.addEventListener("click", tickNow);
btnFight.addEventListener("click", fightRandom);

btnFemale.addEventListener("click", () => pickGender("female"));
btnMale.addEventListener("click", () => pickGender("male"));

elRenameBtn.addEventListener("click", handleRename);


// tiny cooldown (visual only) for train buttons
function addCooldown(btn: HTMLButtonElement, ms = 1200) {
  btn.disabled = true;
  setTimeout(() => (btn.disabled = false), ms);
}

// --- small helpers: profile button + width override CSS ---
function injectProfileButton(href = "/profile.html") {
  if (document.getElementById("vaProfileBtn")) return;
  const b = document.createElement("button");
  b.id = "vaProfileBtn";
  b.textContent = "← Profile";
  Object.assign(b.style, {
    position: "fixed",
    top: "12px",
    left: "12px",
    zIndex: "9998",
    background: "#1b2228",
    color: "#d4a94d",
    border: "1px solid #3b3325",
    borderRadius: "10px",
    padding: "6px 10px",
    cursor: "pointer",
  } as CSSStyleDeclaration);
  b.addEventListener("click", () => { window.location.href = href; });
  document.body.appendChild(b);
}

function injectWiderSlotCSS() {
  if (document.getElementById("vaSlotWiderCSS")) return;
  const style = document.createElement("style");
  style.id = "vaSlotWiderCSS";
  style.textContent = `
    /* Wider equipment boxes without increasing height */
    .equip-grid { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
    .slot { width: 140px; height: 96px; }
    .slot-img { max-width: 92%; max-height: 82%; }
  `;
  document.head.appendChild(style);
}

// ------- boot -------
(async function start() {
  ensureDevConsole(); // Shift+D
  injectWiderSlotCSS(); // wider boxes (not taller)
  injectProfileButton("/profile.html"); // change path if yours differs

  await loadMe();
  await loadShop();
  // passive refresh
  setInterval(loadMe, 3000);
})();










