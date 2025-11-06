/* ===============================
   Valhalla Ascending — src/game.ts
   (Unified Arena + Shop logic)
   =============================== */

type Gender = "female" | "male";
type Slot =
  | "weapon"
  | "helm" | "shoulders" | "chest" | "gloves" | "boots"
  | "ring" | "wings" | "pet" | "sylph";



type Me = {
  id?: string;
  name?: string;
  level: number;
  xp: number;
  gold: number;
  power: number;     // UI label "Strength"
  defense: number;
  speed: number;
  points?: number;
  gender?: Gender;
  slots?: Partial<Record<Slot, string>>;
  gearPower?: number;
  battleRating?: number;
  // optional diamond balance names (support both)
  brisingr?: number;
  diamonds?: number;
};

type ShopItem = {
  id: string;
  name: string;
  stat: "power" | "defense" | "speed";
  boost: number;
  cost: number;              // gold or diamond fallback
  costDiamonds?: number;     // preferred key for diamond shop
  costDiamond?: number;      // alt spelling safety
  slot?: Slot;
  levelReq?: number;
  rarity?: "normal" | "epic" | "legendary";
  imageUrl?: string;
  set?: "drengr" | "skjaldmey";
};

type ApiMe   = { me: Me };
type ApiShop = { items: ShopItem[] };
type FightResult = {
  me: Me;
  result: {
    win: boolean;
    opponent: { id: string; name: string; level: number };
    deltaGold: number;
    deltaXP: number;
  };
};

/* ---------- config ---------- */
const apiBase =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim() || "";

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
  // allow URL override for testing: ?user=<id>
  return new URLSearchParams(location.search).get("user");
}
const userId = getUserId();

/* ---------- DOM helpers ---------- */
function safeEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
function log(msg: string, cls?: string) {
  const logBox = safeEl<HTMLDivElement>("log");
  if (!logBox) return;
  const p = document.createElement("div");
  if (cls) p.className = cls;
  p.textContent = msg;
  logBox.prepend(p);
}

/* ---------- tooltip (used by shop; harmless on arena) ---------- */
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
  const pad = 12, w = tipEl.offsetWidth || 260, h = tipEl.offsetHeight || 120;
  tipEl.style.left = Math.min(innerWidth - w - pad, x + 16) + "px";
  tipEl.style.top  = Math.min(innerHeight - h - pad, y + 16) + "px";
}
function tipMove(ev: MouseEvent) {
  if (!tipEl || tipEl.style.display === "none") return;
  tipShow(ev.clientX, ev.clientY, tipEl.innerHTML);
}
function tipHide() { if (tipEl) tipEl.style.display = "none"; }
addEventListener("scroll", tipHide);
addEventListener("resize", tipHide);

/* ---------- misc ---------- */
function resolveImg(u?: string): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return u;
  return u;
}
function stripHtml(s: string) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

/* ---------- global state ---------- */
const state = {
  me: null as Me | null,

  // shop page state (only populated on shop page)
  goldItems: [] as ShopItem[],
  brisingrItems: [] as ShopItem[],
  activeTab: "all" as "all" | Slot | "brisingr",
};

const itemCache = new Map<string, ShopItem>();

// rarity frames (add diamond)
const rarityFrame: Record<string, string> = {
  normal: "/guildbook/frames/normal-frame.svg",
  epic: "/guildbook/frames/epic-frame.svg",
  legendary: "/guildbook/frames/legendary-frame.svg",
  diamond: "/guildbook/frames/diamond-frame.svg", // ensure this file exists
};

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
    let t = "";
    try { t = await r.text(); } catch {}
    throw new Error(stripHtml(t) || r.statusText);
  }
  return r.json() as Promise<T>;
}

/* ---------- server item lookup (for equipped slots) ---------- */
async function getItem(id: string): Promise<ShopItem | undefined> {
  if (!id) return;
  if (itemCache.has(id)) return itemCache.get(id)!;
  try {
    const info = await api<ShopItem>("/api/game/item/" + encodeURIComponent(id));
    itemCache.set(id, info);
    return info;
  } catch { return undefined; }
}

/* ---------- unlocks ---------- */
const SLOT_UNLOCK: Record<Slot, number> = {
  helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
  ring: 18, wings: 22, pet: 24, sylph: 28, weapon: 1,
};
const PVP_UNLOCK = 25;

/* ---------- BR ---------- */
function clientBattleRating(m: Me): number {
  if (typeof m.battleRating === "number") return m.battleRating;
  return Math.max(0, m.power) + Math.max(0, m.defense) + Math.max(0, m.speed);
}

/* =========================================================
   ARENA: render character + stats + slots
   ========================================================= */
async function renderArena() {
  const m = state.me;
  if (!m) return;

  // Basics
  safeSetText("heroName", m.name || "Unknown");
  safeSetText("level", String(m.level));
  safeSetText("gold", String(m.gold));

  // Stats
  safeSetText("strength", String(m.power));
  safeSetText("defense", String(m.defense));
  safeSetText("speed", String(m.speed));
  safeSetText("points", String(m.points ?? 0));

  // XP bar
  const need = m.level * 100;
  safeSetText("xpVal", `${m.xp} / ${need}`);
  const xpBar = safeEl<HTMLSpanElement>("xpBar");
  if (xpBar) xpBar.style.width = Math.min(100, Math.floor((m.xp / need) * 100)) + "%";

  // Avatar
 // const avatar = safeEl<HTMLImageElement>("avatar");
  //if (avatar) {
    //avatar.src = m.gender === "male"
      //? resolveImg("/guildbook/boy.png")
      //: resolveImg("/guildbook/girl.png");
  //}

  // Equipment slots grid
  const slotBoxes = Array.from(document.querySelectorAll<HTMLDivElement>(".slot"));
  for (const box of slotBoxes) {
    const slot = box.dataset.slot as Slot;
    const needed = SLOT_UNLOCK[slot];
    const eqId = m.slots?.[slot];

    // label (sticky)
    const label = (box.getAttribute("data-name") || slot || "").toUpperCase();
    box.setAttribute("data-name", label);

    if (m.level < needed) {
      box.setAttribute("data-locked", "true");
      box.setAttribute("data-req", `Lv ${needed}`);
      box.innerHTML = '<span class="slot-box" aria-hidden="true"></span>';
      continue;
    } else {
      box.removeAttribute("data-locked");
      box.removeAttribute("data-req");
    }

    box.innerHTML = '<span class="slot-box" aria-hidden="true"></span>'; // spacer always
    if (!eqId) continue;

    const it = await getItem(eqId);
    if (!it) continue;

    // icon
    const img = document.createElement("img");
    img.className = "slot-img";
    img.src = resolveImg(it.imageUrl);
    img.alt = it.name || slot;
    box.appendChild(img);

    // frame
    const rarity = (it.rarity || "normal").toLowerCase();
    const frameUrl = resolveImg(rarityFrame[rarity] || rarityFrame.normal);
    const frame = document.createElement("img");
    frame.className = "rarity-frame";
    frame.src = frameUrl;
    frame.alt = "";
    box.appendChild(frame);
  }

  // BR
  safeSetText("battleRating", `BATTLE RATING ${clientBattleRating(m)}`);

  // PvP gating
  const fightBtn = safeEl<HTMLButtonElement>("fightRandom");
  if (fightBtn) fightBtn.disabled = m.level < PVP_UNLOCK;

  // Allocate buttons (enable if has points)
  const hasPts = (m.points ?? 0) > 0;
  allocButtonsEnabled(hasPts);

  // Update avatar appearance based on equipped set
  updateAvatar(m);
}


function safeSetText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ---- helper: check if a full set is equipped (all 10 slots)
function hasFullSet(me: Me, setId: "drengr" | "skjaldmey") {
  const need: Slot[] = ["weapon","helm","shoulders","chest","gloves","boots","ring","wings","pet","sylph"];
  const slots = me.slots || {};
  return need.every(s => (slots[s] || "").startsWith(setId + "-"));
}

// ---- Avatar — gender + full-set-aware (no hyphens in filenames)
function updateAvatar(m: Me) {
  const avatar = document.getElementById("avatar") as HTMLImageElement | null;
  if (!avatar) return;

  const drengrFull = hasFullSet(m, "drengr");
  const skjaldFull = hasFullSet(m, "skjaldmey");

  let newSrc = "";
  if (m.gender === "male") {
    newSrc = drengrFull ? "/guildbook/boydrengr.png" : "/guildbook/boy.png";
  } else {
    newSrc = skjaldFull ? "/guildbook/girlskjaldmey.png" : "/guildbook/girl.png";
  }

  avatar.style.opacity = "0";
  setTimeout(() => {
    avatar.src = newSrc;
    avatar.onload = () => (avatar.style.opacity = "1");
    avatar.onerror = () => (avatar.style.opacity = "1");
  }, 120);
}


/* ---------- Allocation UI ---------- */
let allocInput: HTMLInputElement | null = null;
let btnAllocPow: HTMLButtonElement | null = null;
let btnAllocDef: HTMLButtonElement | null = null;
let btnAllocSpd: HTMLButtonElement | null = null;

function ensureAllocUI() {
  const trainSpeedBtn = safeEl<HTMLButtonElement>("trainSpeed");
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
    await renderArena();
    log(`Allocated ${amt} → ${stat}`, "ok");
  } catch (err: any) { log("Allocate error: " + err.message, "bad"); }
}

/* ---------- RENAME ---------- */
function hookRename() {
  const btn = safeEl<HTMLButtonElement>("renameBtn");
  if (!btn) return;
  btn.onclick = async () => {
    const current = state.me?.name || "";
    const name = prompt("Enter your hero name:", current || "");
    if (!name) return;
    try {
      const r = await api<ApiMe>("/api/game/rename", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      state.me = r.me;
      await renderArena();
    } catch (e: any) {
      log("Rename error: " + e.message, "bad");
    }
  };
}

/* =========================================================
   SHOP: tabs + render + buys (only if shop DOM is present)
   ========================================================= */

// Shop DOM handles (null on arena page)
const shopBox = document.getElementById("shop");
const goldEl  = document.getElementById("gold");
const brWrap  = document.getElementById("brBalance");
const brIcon  = document.getElementById("brIcon") as HTMLImageElement | null;
const brCount = document.getElementById("brCount");

// accénted filename fallback
brIcon?.addEventListener("error", () => { (brIcon as HTMLImageElement).src = "/guildbook/Currency/Brisingr.png"; });

function onShopPage(): boolean {
  // We consider it a shop page if #shop container exists
  return !!shopBox;
}

function genderMismatch(me: Me, item: ShopItem): boolean {
  if (item.set === "drengr")   return me.gender === "female";
  if (item.set === "skjaldmey") return me.gender === "male";
  return false;
}
function genderLabelFor(setId?: string): string {
  if (!setId) return "";
  if (setId === "drengr") return " (Male-only)";
  if (setId === "skjaldmey") return " (Female-only)";
  return "";
}

function currentItems(): ShopItem[] {
  if (state.activeTab === "brisingr") return state.brisingrItems;
  if (state.activeTab === "all")      return state.goldItems;
  return state.goldItems.filter(i => i.slot === state.activeTab);
}

function tooltipHTML(item: ShopItem) {
  const rarity = (item.rarity || "normal");
  const stat = `+${item.boost} ${item.stat}`;
  const setTag = item.set ? ` <span style="opacity:.8">[${item.set}]</span>` : "";
  const slot = item.slot ? item.slot : "unknown";
  return `
    <div style="font-weight:900;margin-bottom:6px">${item.name}${setTag} <span style="opacity:.8">(${rarity})</span></div>
    <div style="display:flex;justify-content:space-between"><span>Slot</span><span style="opacity:.85">${String(slot).toUpperCase()}</span></div>
    <div style="display:flex;justify-content:space-between"><span>Stats</span><span style="opacity:.85">${stat}</span></div>
  `;
}

function renderShop() {
  if (!onShopPage()) return;

  const me = state.me!;
  const items = currentItems();
  const equipped = new Set(Object.values(me?.slots || {}));

  (shopBox as HTMLElement).innerHTML = "";

  // show diamond balance only on Brísingr tab
  const onBr = state.activeTab === "brisingr";
  brWrap && brWrap.classList.toggle("show", onBr);

  for (const item of items) {
    if (equipped.has(item.id)) continue;

    const locked = !!(item.levelReq && me.level < item.levelReq);
    const gMismatch = genderMismatch(me, item);
    const disabled = locked || gMismatch;
    const reason = gMismatch ? "Gender-locked" : (locked ? "Locked" : "Buy");

    const rarity = (item.rarity || "normal").toLowerCase();
    // For diamond tab, we still use a regular frame file but add an animation class.
    const frameUrl = resolveImg(rarityFrame[rarity] || rarityFrame.normal);

    const line = document.createElement("div");
    line.className = "shop-item";
    line.innerHTML = `
      <div class="shop-left">
        <span class="shop-thumb">
          <img class="shop-img" src="${item.imageUrl || ""}" alt="${item.name}">
          <img class="shop-frame ${onBr ? "shop-frame--diamond" : ""}" src="${frameUrl}" alt="">
        </span>
        <div>
          <div class="shop-title">
            ${item.name}
            ${item.slot ? ` <span style="opacity:.8">[${String(item.slot).toUpperCase()}]</span>` : ""}
            ${item.levelReq ? ` <span style="opacity:.8">(Lv ${item.levelReq}+)</span>` : ""}
            ${genderLabelFor(item.set)}
          </div>
          <div class="shop-sub">+${item.boost} ${item.stat}</div>
        </div>
      </div>
      <div class="shop-right">
        <div class="shop-price">
          ${
            onBr
              ? `<img class="br-icon" src="/guildbook/Currency/Br%C3%ADsingr.png" onerror="this.src='/guildbook/Currency/Brisingr.png'"><span>${item.costDiamonds ?? item.costDiamond ?? item.cost ?? 0}</span>`
              : `<img class="gold-icon" src="/guildbook/Currency/gold-coin.png" alt="g" onerror="this.style.display='none'"><span>${item.cost}g</span>`
          }
        </div>
        <button data-id="${item.id}" ${disabled ? "disabled" : ""}>${reason}</button>
      </div>
    `;

    line.addEventListener("mouseenter", (ev)=> tipShow(ev.clientX, ev.clientY, tooltipHTML(item)));
    line.addEventListener("mousemove",  (ev)=> tipMove(ev));
    line.addEventListener("mouseleave", tipHide);

    (shopBox as HTMLElement).appendChild(line);
  }
}

function hookShopTabs() {
  if (!onShopPage()) return;
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-btn"));
  if (!tabs.length) return;
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(b => b.setAttribute("aria-selected", "false"));
      btn.setAttribute("aria-selected", "true");
      state.activeTab = (btn.dataset.tab as any) || "all";
      renderShop();
    });
  });
}

async function refreshShopLists() {
  try {
    const meRes = await api<ApiMe>("/api/game/me"); state.me = meRes.me;
    const shopRes = await api<ApiShop>("/api/game/shop"); state.goldItems = shopRes.items || [];
    try {
      // brísingr shop is optional
      const r = await api<ApiShop>("/api/game/brisingr-shop");
      state.brisingrItems = r.items || [];
    } catch {
      state.brisingrItems = [];
    }
  } catch {}
  renderShop();
}

/* delegated click handler — works for both tabs */
function hookShopBuy() {
  if (!onShopPage() || !shopBox) return;
  shopBox.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    btn.disabled = true;

    try {
      if (state.activeTab === "brisingr") {
        const res = await api<ApiMe>("/api/game/brisingr/buy", {
          method: "POST",
          body: JSON.stringify({ itemId: id }),
        });
        state.me = res.me || state.me;
        updateBalancesUI();  // update diamond header
        await refreshShopLists();
      } else {
        const res = await api<ApiMe>("/api/game/shop/buy", {
          method: "POST",
          body: JSON.stringify({ itemId: id }),
        });
        state.me = res.me;
        updateBalancesUI();
        await refreshShopLists();
      }
    } catch (e:any) {
      alert(String(e?.message || e));
    } finally {
      btn.disabled = false;
    }
  }, { passive: true });
}

function updateBalancesUI() {
  if (!onShopPage()) return;
  const m = state.me!;
  if (goldEl) goldEl.textContent = String(m.gold ?? 0);
  const br = (m.brisingr ?? m.diamonds ?? 0) as number;
  if (brCount) brCount.textContent = String(br);
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */

async function boot() {
  if (!userId) {
    log("No user found. Open profile/login first or add ?user=<id> to the URL.", "bad");
    return;
  }

  // Get me
  const meRes = await api<ApiMe>("/api/game/me");
  state.me = meRes.me;

  // Gender prompt (arena page)
  const genderPick = safeEl("genderPick");
  if (genderPick && !state.me.gender) {
    genderPick.style.display = "block";
    safeEl<HTMLButtonElement>("pickFemale")?.addEventListener("click", () => setGender("female"));
    safeEl<HTMLButtonElement>("pickMale")?.addEventListener("click", () => setGender("male"));
  }

  // Arena-only bindings (bind if present)
  ensureAllocUI();
  hookRename();

  const btnTrainPow = safeEl<HTMLButtonElement>("trainPower");
  const btnTrainDef = safeEl<HTMLButtonElement>("trainDefense");
  const btnTrainSpd = safeEl<HTMLButtonElement>("trainSpeed");
  const btnTick     = safeEl<HTMLButtonElement>("tickNow");
  const btnFight    = safeEl<HTMLButtonElement>("fightRandom");

  btnTrainPow && (btnTrainPow.onclick = () => train("power"));
  btnTrainDef && (btnTrainDef.onclick = () => train("defense"));
  btnTrainSpd && (btnTrainSpd.onclick = () => train("speed"));
  btnTick     && (btnTick.onclick = async () => {
    try {
      const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
      state.me = r.me; await renderArena(); log("Idle tick processed");
    } catch (e:any) { log("Tick error: " + e.message, "bad"); }
  });
  btnFight && (btnFight.onclick = async () => {
    try {
      const r = await api<FightResult>("/api/pvp/fight", {
        method: "POST",
        body: JSON.stringify({ mode: "random" })
      });
      state.me = r.me; await renderArena();
      log(`${r.result.win ? "Victory!" : "Defeat."} vs ${r.result.opponent.name} ΔGold ${r.result.deltaGold}, ΔXP ${r.result.deltaXP}`);
    } catch (err: any) { log("Fight error: " + err.message, "bad"); }
  });

  // Shop page bootstrap (only if shop DOM exists)
  if (onShopPage()) {
    // balances
    updateBalancesUI();

    // load both lists
    try {
      const shopRes = await api<ApiShop>("/api/game/shop");
      state.goldItems = shopRes.items || [];
    } catch { state.goldItems = []; }

    try {
      const br = await api<ApiShop>("/api/game/brisingr-shop");
      state.brisingrItems = br.items || [];
    } catch { state.brisingrItems = []; }

    // tabs + buy
    hookShopTabs();
    hookShopBuy();
    renderShop();
  }

  // Initial arena render (safe if arena DOM exists)
  await renderArena();

  // Passive idle tick every 10s (arena stats keep moving, works on both pages)
  setInterval(async () => {
    try {
      const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
      state.me = r.me;
      updateBalancesUI();
      await renderArena();
      if (onShopPage()) renderShop(); // keep locks & equipped hiding fresh
    } catch {}
  }, 10000);
}

async function setGender(g: Gender) {
  try {
    const res = await api<ApiMe>("/api/game/gender", { method: "POST", body: JSON.stringify({ gender: g }) });
    state.me = res.me;
    const genderPick = safeEl("genderPick"); if (genderPick) genderPick.style.display = "none";
    await renderArena();
    if (onShopPage()) renderShop(); // refresh gender locks
  } catch (e: any) { log(e.message, "bad"); }
}

/* ---------- training ---------- */
const cooldowns: Record<"power"|"defense"|"speed", number> = { power: 0, defense: 0, speed: 0 };
async function train(stat: "power"|"defense"|"speed") {
  const now = Date.now();
  if (now < cooldowns[stat]) return;
  cooldowns[stat] = now + 3000;
  try {
    const r = await api<ApiMe>("/api/game/train", { method: "POST", body: JSON.stringify({ stat }) });
    state.me = r.me; await renderArena(); log(`Trained ${stat} (+1)`, "ok");
  } catch (err: any) { log("Train error: " + err.message, "bad"); }
}

/* ---------- start ---------- */
boot().catch(e => log(e.message, "bad"));

/* =========================================================
   Dev console helpers (expanded)
   ========================================================= */
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
    // --- Basic info ---
    me: () => call("/api/dev/me"),
    reset: () => call("/api/dev/reset"),
    setKey: (k: string) => { localStorage.setItem("DEV_KEY", k); (dev as any)._key = k; return "✅ DEV_KEY set"; },
    _key: DEV_KEY,

    // --- Core Stats ---
    level: (n: number) => call("/api/dev/level", { level: n }),
    gold: (nOrOpts: number | { add?: number; set?: number }) =>
      typeof nOrOpts === "number"
        ? call("/api/dev/gold", { add: nOrOpts })
        : call("/api/dev/gold", nOrOpts),
    xp: (add: number) => call("/api/dev/xp", { add }),
    points: (add: number) => call("/api/dev/points", { add }),

    // --- Brísingr (diamonds) ---
    brisingr: (nOrOpts: number | { add?: number; set?: number }) =>
      typeof nOrOpts === "number"
        ? call("/api/dev/brisingr", { add: nOrOpts })
        : call("/api/dev/brisingr", nOrOpts),

    // --- Inventory / Items ---
    item: (id: string) => call("/api/dev/item", { itemId: id }),
    slots: (slots: Record<string, string>) => call("/api/dev/slots", { slots }),
    equipSet: (setId: string) => call("/api/dev/equip-set", { setId }),
    drengr: () => call("/api/dev/drengr"),

    // --- Quick combos ---
    maxOut: async () => {
      await dev.level(30);
      await dev.gold({ set: 9999 });
      await dev.points(300);
      await dev.brisingr({ set: 9999 });
      return dev.me();
    },
    rich: () => dev.gold({ add: 10000 }),
    bless: () => dev.points(100),
    ascend: () => dev.level(50),

    // --- Quick equip shortcuts ---
    helm: (id = "drengr-helm") => dev.item(id),
    chest: (id = "drengr-chest") => dev.item(id),
    weapon: (id = "drengr-weapon") => dev.item(id),
  };

  (window as any).dev = dev;

  console.log("%cwindow.dev ready!", "color:#39ff14");
  console.log(`
🛠️ Dev Console Commands:
- dev.me() → see your stats
- dev.level(25), dev.gold(1000), dev.points(50)
- dev.brisingr(500) → add 500 Brísingr
- dev.item("drengr-helm") → instantly equip
- dev.equipSet("skjaldmey") → full set
- dev.maxOut() → god mode
- dev.reset() → wipe state
  `);
})();



















