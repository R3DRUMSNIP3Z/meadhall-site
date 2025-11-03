/* =============================== */
/* Valhalla Ascending — src/game.ts */
/* =============================== */

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

  // base stats
  power: number;
  defense: number;
  speed: number;

  // progression
  points?: number;
  gender?: Gender;

  // equipment
  slots?: Partial<Record<Slot, string>>;

  // derived (returned by backend)
  gearPower?: number;
  totalPower?: number;
  totalDefense?: number;
  totalSpeed?: number;
  battleRating?: number;

  renameUsed?: boolean;
};

type ShopItem = {
  id: string;
  name: string;
  stat: "power" | "defense" | "speed";
  boost: number;
  cost: number;
  slot?: Slot;
  levelReq?: number;
  rarity?: "normal" | "epic" | "legendary";
  imageUrl?: string;
  set?: "drengr" | "skjaldmey" | string;
};

type ApiMe = { me: Me };
type ApiShop = { items: ShopItem[] };
type FightResult = {
  me: Me;
  result: {
    win: boolean;
    opponent: { id: string; name: string; level: number };
    deltaGold?: number;
    deltaXP?: number;
  };
};

/* ---------- config ---------- */
const apiBase =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim() || "";

/* ---------- image resolver ---------- */
function resolveImg(u?: string): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return u;
  return u;
}

/* ---------- user id helpers ---------- */
const LS_KEY = "mh_user";
function getUserId(): string | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      return obj?.id || obj?._id || obj?.user?.id || null;
    }
  } catch {}
  const qs = new URLSearchParams(location.search).get("user");
  return qs || null;
}
const userId = getUserId();
if (!userId) alert("Missing user. Make sure you're logged in.");

/* ---------- DOM helpers ---------- */
const $ = (id: string) => document.getElementById(id)!;
const logBox = $("log");
function log(msg: string, cls?: string) {
  const p = document.createElement("div");
  if (cls) p.className = cls;
  p.textContent = msg;
  logBox.prepend(p);
}

/* ---------- tooltip helpers ---------- */
let tipEl = document.getElementById("vaTooltip") as HTMLDivElement | null;
if (!tipEl) {
  tipEl = document.createElement("div");
  tipEl.id = "vaTooltip";
  tipEl.style.cssText =
    "position:fixed;display:none;z-index:9999;min-width:220px;max-width:320px;padding:10px;border-radius:10px;border:1px solid rgba(212,169,77,.35);background:#101317;color:#d4a94d;box-shadow:0 8px 30px rgba(0,0,0,.45);font-family:Cinzel,serif;font-size:.95rem";
  document.body.appendChild(tipEl);
}
function tipShow(x: number, y: number, html: string) {
  if (!tipEl) return;
  tipEl.innerHTML = html;
  tipEl.style.display = "block";
  const pad = 12;
  const w = tipEl.offsetWidth || 260;
  const h = tipEl.offsetHeight || 120;
  const nx = Math.min(window.innerWidth - w - pad, x + 16);
  const ny = Math.min(window.innerHeight - h - pad, y + 16);
  tipEl.style.left = nx + "px";
  tipEl.style.top = ny + "px";
}
function tipMove(ev: MouseEvent) {
  if (!tipEl || tipEl.style.display === "none") return;
  tipShow(ev.clientX, ev.clientY, tipEl.innerHTML);
}
function tipHide() { if (tipEl) tipEl.style.display = "none"; }
window.addEventListener("scroll", tipHide);
window.addEventListener("resize", tipHide);

/* ---------- money/tooltip helpers ---------- */
function sellPriceOf(item?: ShopItem): number {
  if (!item) return 0;
  // @ts-ignore optional field from server
  if (typeof (item as any).sellPrice === "number") return Math.max(0, Math.floor((item as any).sellPrice));
  return Math.max(0, Math.floor(item.cost * 0.5));
}
function tooltipHTML(item: ShopItem, slotKey: string) {
  const rarity = (item.rarity || "normal");
  const stat = `+${item.boost} ${item.stat}`;
  const sell = sellPriceOf(item);
  const setTag = item.set ? `<div class="tt-row"><span>Set</span><span class="muted" style="opacity:.85">${capitalize(item.set)}</span></div>` : "";
  return `
    <div class="tt-title" style="font-weight:900;margin-bottom:6px">${item.name} <span class="muted" style="opacity:.8">(${rarity})</span></div>
    <div class="tt-row" style="display:flex;justify-content:space-between"><span>Slot</span><span class="muted" style="opacity:.85">${capitalize(slotKey)}</span></div>
    ${setTag}
    <div class="tt-row" style="display:flex;justify-content:space-between"><span>Stats</span><span class="muted" style="opacity:.85">${stat}</span></div>
    <div class="tt-row" style="display:flex;justify-content:space-between"><span>Sell</span><span class="muted" style="opacity:.85">${sell}g</span></div>
  `;
}

/* ---------- client state ---------- */
const state: { me: Me | null; shop: ShopItem[] } = { me: null, shop: [] };

/* ---------- item cache + lookup ---------- */
const itemCache = new Map<string, ShopItem>();
async function getItem(id: string): Promise<ShopItem | undefined> {
  if (!id) return;
  if (itemCache.has(id)) return itemCache.get(id)!;
  const fromShop = state.shop.find(i => i.id === id);
  if (fromShop) { itemCache.set(id, fromShop); return fromShop; }
  try {
    const info = await api<ShopItem>("/api/game/item/" + encodeURIComponent(id));
    itemCache.set(id, info);
    return info;
  } catch { return undefined; }
}

/* ---------- rarity frames ---------- */
const rarityFrame: Record<string, string> = {
  normal: "/guildbook/frames/normal-frame.svg",
  epic: "/guildbook/frames/epic-frame.svg",
  legendary: "/guildbook/frames/legendary-frame.svg",
};

/* ---------- slot renderer ---------- */
function renderSlot(slotKey: string, item?: ShopItem) {
  const el = document.querySelector(`.slot[data-slot="${slotKey}"]`) as HTMLElement | null;
  if (!el) return;
  el.innerHTML = "";
  el.onmouseenter = null; el.onmousemove = null; el.onmouseleave = null;

  if (!item) { el.textContent = capitalize(slotKey); return; }

  const img = document.createElement("img");
  img.className = "slot-img";
  img.src = resolveImg(item.imageUrl);
  img.alt = item.name || slotKey;
  el.appendChild(img);

  const r = (item.rarity || "normal").toLowerCase();
  const frameUrl = rarityFrame[r] || rarityFrame.normal;
  const overlay = document.createElement("img");
  overlay.className = "rarity-frame";
  overlay.src = resolveImg(frameUrl);
  overlay.alt = "";
  el.appendChild(overlay);

  el.onmouseenter = (ev) => tipShow(ev.clientX, ev.clientY, tooltipHTML(item, slotKey));
  el.onmousemove = (ev) => tipMove(ev);
  el.onmouseleave = tipHide;
}

/* ---------- unlock rules (for labels) ---------- */
const SLOT_UNLOCK: Record<Slot, number> = {
  helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
  ring: 18, wings: 22, pet: 24, sylph: 28
};
const PVP_UNLOCK = 25;

/* ---------- fetch wrapper ---------- */
async function api<T = any>(path: string, opts: RequestInit = {}) {
  const r = await fetch(apiBase + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId || "",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    let msg = "";
    try { msg = await r.text(); } catch {}
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

/* ---------- compute helpers ---------- */
function battleRatingOf(m: Me): number {
  // use backend totals when present; otherwise fallback to base + gearPower
  const tp = (m.totalPower ?? (m.power + (m.gearPower ?? 0)));
  const td = (m.totalDefense ?? m.defense);
  const ts = (m.totalSpeed ?? m.speed);
  return Math.max(0, tp + td + ts);
}

/* ---------- render ---------- */
function render() {
  const m = state.me!;
  $("heroName").textContent = m.name || "Unknown";
  $("level").textContent = String(m.level);
  $("gold").textContent = String(m.gold);
  $("power").textContent = String(m.power);
  $("defense").textContent = String(m.defense);
  $("speed").textContent = String(m.speed);
  $("points").textContent = String(m.points ?? 0);

  const need = m.level * 100;
  $("xpVal").textContent = `${m.xp} / ${need}`;
  ($("xpBar") as HTMLSpanElement).style.width = Math.min(100, Math.floor((m.xp / need) * 100)) + "%";

  // avatar by gender
  ($("avatar") as HTMLImageElement).src =
    m.gender === "male" ? resolveImg("/guildbook/boy.png") : resolveImg("/guildbook/girl.png");

  // slots
  document.querySelectorAll<HTMLDivElement>(".slot").forEach(async (div) => {
    const slot = div.dataset.slot as Slot;
    const needed = SLOT_UNLOCK[slot];
    const eqId = m.slots?.[slot];

    // lock label
    if (m.level < needed) {
      div.innerHTML = `${capitalize(slot)} (Lv ${needed})`;
      div.onmouseenter = (ev) =>
        tipShow(ev.clientX, ev.clientY,
          `<div class="tt-title" style="font-weight:900;margin-bottom:6px">${capitalize(slot)}</div>
           <div class="muted" style="opacity:.85">Unlocks at level ${needed}</div>`);
      div.onmousemove = (ev) => tipMove(ev);
      div.onmouseleave = tipHide;
      return;
    }

    if (!eqId) { renderSlot(slot, undefined); return; }

    const it = await getItem(eqId);
    renderSlot(slot, it);
  });

  // Battle Rating (now totals)
  const br = m.battleRating ?? battleRatingOf(m);
  $("battleRating").textContent = `BATTLE RATING ${br}`;

  // PvP enablement
  ($("fightRandom") as HTMLButtonElement).disabled = m.level < PVP_UNLOCK;

  // Allocation buttons by points
  const hasPts = (m.points ?? 0) > 0;
  allocButtonsEnabled(hasPts);

  // rename button visibility (allow 1 time)
  const renameBtn = $("renameBtn") as HTMLButtonElement;
  renameBtn.disabled = !!m.renameUsed;
}

/* ---------- SHOP ---------- */
function renderShop() {
  const box = $("shop");
  box.innerHTML = "";
  if (!state.me) return;

  const me = state.me;
  const equippedIds = new Set(Object.values(me.slots || {}));

  state.shop.forEach((item) => {
    if (equippedIds.has(item.id)) return;

    const lockedByLevel = !!(item.levelReq && me.level < item.levelReq);
    const req = item.levelReq ? ` <span class="muted">(Lv ${item.levelReq}+)</span>` : "";
    const slot = item.slot ? ` <span class="muted">[${capitalize(item.slot)}]</span>` : "";
    const rarity = (item.rarity || "normal").toLowerCase();
    const frameUrl = rarityFrame[rarity] || rarityFrame.normal;

    // gender restriction label
    let genderLabel = "";
    if (item.set === "drengr") genderLabel = " <span class=\"muted\">(Male only)</span>";
    if (item.set === "skjaldmey") genderLabel = " <span class=\"muted\">(Female only)</span>";

    // disable by gender if selected gender doesn't match
    const genderMismatch =
      (item.set === "drengr" && me.gender !== "male") ||
      (item.set === "skjaldmey" && me.gender !== "female");

    const disabled = lockedByLevel || genderMismatch;

    const line = document.createElement("div");
    line.className = "shop-item";
    line.innerHTML = `
      <div class="shop-left">
        <span class="shop-thumb">
          <img class="shop-img" src="${resolveImg(item.imageUrl)}" alt="${item.name}" loading="lazy">
          <img class="shop-frame" src="${resolveImg(frameUrl)}" alt="" onerror="this.style.display='none'">
        </span>
        <div class="shop-text">
          <div class="shop-title">${item.name}${slot}${req}${genderLabel}</div>
          <div class="shop-sub muted">+${item.boost} ${item.stat}</div>
        </div>
      </div>
      <div class="shop-right">
        <div class="shop-price">${item.cost}g</div>
        <button data-id="${item.id}" ${disabled ? "disabled" : ""}>${disabled ? "Locked" : "Buy"}</button>
      </div>
    `;

    line.onmouseenter = (ev) => tipShow(ev.clientX, ev.clientY, tooltipHTML(item, item.slot || "unknown"));
    line.onmousemove = (ev) => tipMove(ev);
    line.onmouseleave = tipHide;

    box.appendChild(line);
  });

  box.onclick = async (ev) => {
    const btn = (ev.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    const id = btn.getAttribute("data-id")!;
    try {
      const res = await api<{ me: Me; item: ShopItem }>("/api/game/shop/buy", {
        method: "POST",
        body: JSON.stringify({ itemId: id }),
      });
      state.me = res.me;
      log(`Bought ${res.item.name} (+${res.item.boost} ${res.item.stat})`, "ok");
      render();
      renderShop();
    } catch (err: any) { log("Shop error: " + cleanErr(err.message), "bad"); }
  };
}

/* ---------- Allocation UI INSIDE TRAINING CARD ---------- */
let allocInput: HTMLInputElement | null = null;
let btnAllocPow: HTMLButtonElement | null = null;
let btnAllocDef: HTMLButtonElement | null = null;
let btnAllocSpd: HTMLButtonElement | null = null;

function ensureAllocUI() {
  const trainSpeedBtn = document.getElementById("trainSpeed") as HTMLButtonElement | null;
  if (!trainSpeedBtn) return;

  const row = trainSpeedBtn.closest(".row") as HTMLElement | null;
  if (!row) return;

  if (document.getElementById("allocControls")) return;

  const wrap = document.createElement("div");
  wrap.id = "allocControls";
  wrap.className = "row";
  wrap.style.marginTop = "6px";
  wrap.innerHTML = `
    <div class="muted">ALLOCATE<br>POINTS</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="allocAmount" type="number" min="1" value="1"
        style="width:70px;padding:6px;border-radius:8px;border:1px solid #3b3325;background:#0e1216;color:#d4a94d">
      <button id="btnAllocPower">+ Power</button>
      <button id="btnAllocDefense">+ Defense</button>
      <button id="btnAllocSpeed">+ Speed</button>
    </div>
  `;
  row.after(wrap);

  allocInput = document.getElementById("allocAmount") as HTMLInputElement;
  btnAllocPow = document.getElementById("btnAllocPower") as HTMLButtonElement;
  btnAllocDef = document.getElementById("btnAllocDefense") as HTMLButtonElement;
  btnAllocSpd = document.getElementById("btnAllocSpeed") as HTMLButtonElement;

  btnAllocPow.onclick = () => allocate("power");
  btnAllocDef.onclick = () => allocate("defense");
  btnAllocSpd.onclick = () => allocate("speed");
}

function allocButtonsEnabled(enabled: boolean) {
  btnAllocPow && (btnAllocPow.disabled = !enabled);
  btnAllocDef && (btnAllocDef.disabled = !enabled);
  btnAllocSpd && (btnAllocSpd.disabled = !enabled);
}

async function allocate(stat: "power"|"defense"|"speed") {
  if (!allocInput) return;
  const amt = Math.max(1, Math.floor(Number(allocInput.value || "1")));
  try {
    const r = await api<ApiMe>("/api/game/allocate", {
      method: "POST",
      body: JSON.stringify({ stat, amount: amt }),
    });
    state.me = r.me;
    render();
    log(`Allocated ${amt} → ${stat}`, "ok");
  } catch (err: any) { log("Allocate error: " + cleanErr(err.message), "bad"); }
}

/* ---------- boot ---------- */
async function loadAll() {
  const meRes = await api<ApiMe>("/api/game/me");
  state.me = meRes.me;

  if (!state.me.gender) {
    $("genderPick").style.display = "block";
    $("pickFemale").onclick = () => setGender("female");
    $("pickMale").onclick = () => setGender("male");
  }

  const shopRes = await api<ApiShop>("/api/game/shop");
  state.shop = shopRes.items;

  ensureAllocUI();
  hookRename();

  render();
  renderShop();
}

async function setGender(g: Gender) {
  try {
    const res = await api<ApiMe>("/api/game/gender", { method: "POST", body: JSON.stringify({ gender: g }) });
    state.me = res.me;
    $("genderPick").style.display = "none";
    render();
    renderShop(); // refresh gender-locked buttons
  } catch (e: any) { log(cleanErr(e.message), "bad"); }
}

/* ---------- rename (one-time) ---------- */
function hookRename() {
  const btn = $("renameBtn") as HTMLButtonElement;
  btn.onclick = async () => {
    const m = state.me!;
    if (m.renameUsed) {
      log("Rename already used.", "bad");
      return;
    }
    const name = prompt("Enter new name (2–20 chars, letters/numbers/space/_/-):", m.name || "");
    if (!name) return;
    try {
      const r = await api<ApiMe>("/api/game/rename", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      state.me = r.me;
      log("Name updated.", "ok");
      render();
    } catch (err: any) { log("Rename error: " + cleanErr(err.message), "bad"); }
  };
}

/* ---------- buttons ---------- */
$("trainPower").onclick = () => train("power");
$("trainDefense").onclick = () => train("defense");
$("trainSpeed").onclick = () => train("speed");
$("tickNow").onclick = async () => {
  const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
  state.me = r.me; render(); log("Idle tick processed");
};
$("fightRandom").onclick = async () => {
  try {
    const r = await api<FightResult>("/api/pvp/fight", { method: "POST", body: JSON.stringify({ mode: "random" }) });
    state.me = r.me; render();
    log(`${r.result.win ? "Victory!" : "Defeat."} vs ${r.result.opponent.name}`, r.result.win ? "ok" : "bad");
  } catch (err: any) { log("Fight error: " + cleanErr(err.message), "bad"); }
};

const cooldowns: Record<"power"|"defense"|"speed", number> = { power: 0, defense: 0, speed: 0 };
async function train(stat: "power"|"defense"|"speed") {
  const now = Date.now();
  if (now < cooldowns[stat]) return;
  cooldowns[stat] = now + 3000;
  try {
    const r = await api<ApiMe>("/api/game/train", { method: "POST", body: JSON.stringify({ stat }) });
    state.me = r.me; render(); log(`Trained ${stat} (+1)`, "ok");
  } catch (err: any) { log("Train error: " + cleanErr(err.message), "bad"); }
}

/* passive idle tick every 10s */
setInterval(async () => {
  try {
    const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
    state.me = r.me; render();
  } catch {}
}, 10000);

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function cleanErr(s: string) {
  // strip HTML bodies when server returns error pages
  if (!s) return s;
  const i = s.indexOf("<!DOCTYPE");
  return i >= 0 ? s.slice(0, i).trim() || "Request failed" : s;
}

/* start */
loadAll().catch(e => log(cleanErr(e.message), "bad"));

/* ---------- Dev console helpers ---------- */
(() => {
  const DEV_KEY = localStorage.getItem("DEV_KEY") || "valhalla-dev";
  const initialUid = userId;

  async function call<T = any>(path: string, body?: any): Promise<T> {
    const activeUser = initialUid || getUserId();
    if (!activeUser) throw new Error("No user (log in first).");
    const r = await fetch(apiBase + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": activeUser,
        "x-dev-key": DEV_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  const dev = {
    me: () => call("/api/dev/me"),
    level: (n: number) => call("/api/dev/level", { level: n }),
    gold: (nOrOpts: number | { add?: number; set?: number }) =>
      typeof nOrOpts === "number" ? call("/api/dev/gold", { add: nOrOpts }) : call("/api/dev/gold", nOrOpts),
    xp: (add: number) => call("/api/dev/xp", { add }),
    points: (add: number) => call("/api/dev/points", { add }),
    item: (id: string) => call("/api/dev/item", { itemId: id }),
    slots: (slots: Record<string, string>) => call("/api/dev/slots", { slots }),
    equipSet: (setId: string) => call("/api/dev/equip-set", { setId }),
    drengr: () => call("/api/dev/drengr"),
    reset: () => call("/api/dev/reset"),
    setKey: (k: string) => { localStorage.setItem("DEV_KEY", k); (dev as any)._key = k; return "DEV_KEY set"; },
    _key: DEV_KEY,
  };

  (window as any).dev = dev;
  // eslint-disable-next-line no-console
  console.log("%cwindow.dev ready → dev.me(), dev.level(25), dev.points(50), dev.item('drengr-helm'), dev.drengr()", "color:#39ff14");
})();














