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

/* ---------- avatar cache helpers ---------- */
//const AVATAR_KEY = "va_avatar_src";
//function saveAvatar(src: string) {
//  try { localStorage.setItem(AVATAR_KEY, src); } catch {}
//}

/* ---------- DOM helpers ---------- */
function safeEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
function safeSetText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
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
// --- Item index built once to avoid per-slot fetch jitter ---
let itemIndex: Record<string, ShopItem> = Object.create(null);
async function preloadItemIndex() {
  try {
    const r = await api<ApiShop>("/api/game/shop");
    const list = r.items || [];
    itemIndex = Object.fromEntries(list.map(it => [it.id, it]));
    for (const it of list) itemCache.set(it.id, it);
  } catch {
    itemIndex = Object.create(null);
  }
}

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

    const it = itemIndex[eqId] || itemCache.get(eqId);
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

  // Card art (NOT silhouettes)
  const baseSrc = m.gender === "female"
    ? "/guildbook/girl.png"
    : "/guildbook/boy.png";

  // Full-set overrides for the card
  let nextSrc = baseSrc;
  if (hasFullSet(m, "drengr")) {
    nextSrc = "/guildbook/boydrengr.png";
  } else if (hasFullSet(m, "skjaldmey")) {
    nextSrc = "/guildbook/girlskjaldmey.png";
  }

  // No-op if already set
  if (avatar.getAttribute("data-src") === nextSrc || avatar.src.endsWith(nextSrc)) return;

  // Swap with a tiny fade; if missing, fall back to base gender art
  avatar.style.opacity = "0";
  setTimeout(() => {
    const done = () => { avatar.style.opacity = "1"; avatar.setAttribute("data-src", nextSrc); };
    avatar.onload = done;
    avatar.onerror = () => { avatar.src = baseSrc; done(); };
    avatar.src = nextSrc;
    try { localStorage.setItem("va_avatar_src", nextSrc); } catch {}
  }, 60);
}




/* === Quest helpers (fallback if arena modal bridge unavailable) === */
const QKEY = "va_quests";

function readQuests(): any[] {
  try { return JSON.parse(localStorage.getItem(QKEY) || "[]"); }
  catch { return []; }
}

let _aqRendering = false;
function renderActiveQuest() {
  if (_aqRendering) return;
  _aqRendering = true;
  try {
    const slot = document.getElementById("activeQuest") as HTMLElement | null;
    if (!slot) return;

    // helpers (no ensure/update calls here!)
    const read = ((window as any).VAQ?.readQuests) || readQuests;
    const quests = read() || [];

    // pick which quest to show:
    // 1) main quest if not completed
    // 2) else travel quest if present and not completed
    let q: any =
      quests.find((x: any) => x.id === "q_main_pick_race" && x.status !== "completed") ||
      quests.find((x: any) => x.id === "q_travel_home" && x.status !== "completed");

    if (!q) { slot.style.display = "none"; return; }

    // show card
    slot.style.display = "flex";

    // fields
    const title = document.getElementById("aqTitle")   as HTMLElement | null;
    const desc  = document.getElementById("aqDesc")    as HTMLElement | null;
    const st    = document.getElementById("aqStatus")  as HTMLElement | null;
    const pv    = document.getElementById("aqProgVal") as HTMLElement | null;
    const pb    = document.getElementById("aqProgBar") as HTMLElement | null;

    if (title) title.textContent = q.title || "—";
    if (desc)  desc.textContent  = q.desc  || "—";

    const statusText = q.status ? (q.status.charAt(0).toUpperCase() + q.status.slice(1)) : "Available";
    if (st) st.textContent = `Status: ${statusText}`;

    const prog = Math.max(0, Math.min(100, Number(q.progress || 0)));
    if (pv) pv.textContent = String(prog);
    if (pb) pb.style.width = prog + "%";

// --- Buttons (reset old handlers) ---

// Helper: replace-with-clone to drop any old handlers
function resetEl(id: string): HTMLElement | null {
  const el = document.getElementById(id);
  if (!el) return null;
  const clone = el.cloneNode(true) as HTMLElement;
  el.replaceWith(clone);
  return document.getElementById(id) as HTMLElement | null;
}

const openBtn    = resetEl('aqOpen')    as HTMLButtonElement | null;
const travelBtn  = resetEl('aqTravel')  as (HTMLAnchorElement | HTMLButtonElement | null);
const abandonBtn = resetEl('aqAbandon') as HTMLButtonElement | null;

// Hide Travel by default; we'll show it for the travel quest only
if (travelBtn) (travelBtn as HTMLElement).style.display = 'none';

if (q.id === "q_main_pick_race") {
  // OPEN → show the race modal
  openBtn?.addEventListener('click', () => {
    const el = document.getElementById('questsOverlay') as HTMLElement | null;
    if (el) el.style.display = 'flex';
  });
} else if (q.id === "q_travel_home") {
  // TRAVEL → go to the correct map for the chosen race
  if (travelBtn) {
    const race = (localStorage.getItem("va_race") || "").toLowerCase();
    const dest =
      race === "dreadheim" ? "/dreadheimmap.html" :
      race === "myriador"  ? "/myriadormap.html"  :
      race === "wildwood"  ? "/wildwoodmap.html"  :
      "/dreadheimmap.html";

    (travelBtn as HTMLElement).style.display = 'inline-block';
    (travelBtn as HTMLElement).textContent = "Travel";

    // If it's an anchor, set href too (nice for right-click)
    if (travelBtn instanceof HTMLAnchorElement) travelBtn.href = dest;

    // Always handle click (works for <a> or <button>)
    travelBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      window.location.href = dest;
    });
  }

  // OPEN → simple details
  if (openBtn) {
    openBtn.textContent = "Details";
    openBtn.onclick = () => alert(q.desc || "Travel to your homeland.");
  }
}

// ABANDON
if (abandonBtn) {
  abandonBtn.replaceWith(abandonBtn.cloneNode(true));
  const freshAbandon = document.getElementById("aqAbandon") as HTMLButtonElement | null;
  freshAbandon?.addEventListener("click", () => {
    const read = ((window as any).VAQ?.readQuests) || readQuests;
    const write = ((window as any).VAQ?.writeQuests as ((l: any[]) => void))
               || ((l: any[]) => localStorage.setItem(QKEY, JSON.stringify(l)));

    const list = read() || [];
    const curr = list.find((x: any) => x.id === q.id);
    if (curr) { curr.status = "available"; curr.progress = 0; }
    write(list);
    window.dispatchEvent(new CustomEvent("va-quest-updated"));
    renderActiveQuest();
  });
}
  } finally {
    _aqRendering = false;
  }
} // ← end of renderActiveQuest()




// Re-render the card whenever the modal script updates quests
window.addEventListener("va-quest-updated", renderActiveQuest);


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
    console.log("[ME on load]", JSON.stringify({
      slots: state.me?.slots, level: state.me?.level, gold: state.me?.gold
    }, null, 2));

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
  try { if (state.me?.gender) localStorage.setItem("va_gender", state.me.gender); } catch {}

  await preloadItemIndex(); // build item index so slots render in one pass

  // Gender prompt (arena page)
  const genderPick = safeEl("genderPick");
  if (genderPick && !state.me.gender) {
    genderPick.style.display = "block";
    safeEl<HTMLButtonElement>("pickFemale")?.addEventListener("click", () => setGender("female"));
    safeEl<HTMLButtonElement>("pickMale")?.addEventListener("click",   () => setGender("male"));
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
    updateBalancesUI();

    try {
      const shopRes = await api<ApiShop>("/api/game/shop");
      state.goldItems = shopRes.items || [];
    } catch { state.goldItems = []; }

    try {
      const br = await api<ApiShop>("/api/game/brisingr-shop");
      state.brisingrItems = br.items || [];
    } catch { state.brisingrItems = []; }

    hookShopTabs();
    hookShopBuy();
    renderShop();
  }

  // Initial arena render
  await renderArena();
  renderActiveQuest();

  // Passive idle tick every 10s
  setInterval(async () => {
    try {
      const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
      state.me = r.me;
      updateBalancesUI();
      await renderArena();
      if (onShopPage()) renderShop();
    } catch {}
  }, 10000);
}

async function setGender(g: Gender) {
  try {
    const res = await api<ApiMe>("/api/game/gender", {
      method: "POST",
      body: JSON.stringify({ gender: g }),
    });
    state.me = res.me;

    // 🔗 keep global pages in sync:
    try {
      localStorage.setItem("va_gender", g);               // <— key used by global-game-setup.ts
      (window as any).dispatchEvent?.(new CustomEvent("va-gender-changed", { detail: g }));
    } catch {}

    const genderPick = safeEl("genderPick");
    if (genderPick) genderPick.style.display = "none";

    await renderArena();
    if (onShopPage()) renderShop();
  } catch (e: any) {
    log(e.message, "bad");
  }
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
  setKey: (k: string) => {
    localStorage.setItem("DEV_KEY", k);
    (dev as any)._key = k;
    return "✅ DEV_KEY set";
  },
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

  // --- Bag / Inventory management ---
  nukeBag: () => {
    const uid = (getUserId && getUserId()) || "guest";
    const prefixes = [
      `va_bag__${uid}`,
      `va_inventory__${uid}`,
      `va_inv__${uid}`,
    ];

    // remove exact known keys
    for (const key of prefixes) {
      try { localStorage.removeItem(key); } catch {}
    }

    // sweep matching
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && prefixes.some(p => k.startsWith(p))) {
        localStorage.removeItem(k);
      }
    }
    return "🧹 Bag inventory cleared.";
  },

  bagList: () => {
    const uid = (getUserId && getUserId()) || "guest";
    const out: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.includes(`__${uid}`) && (k.includes("va_bag") || k.includes("va_inv")))) {
        try { out[k] = JSON.parse(localStorage.getItem(k) || ""); }
        catch { out[k] = localStorage.getItem(k); }
      }
    }
    return out;
  },
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
- dev.nukeBag() → clear bag inventory
- dev.bagList() → inspect stored bag keys
`);
})();




















