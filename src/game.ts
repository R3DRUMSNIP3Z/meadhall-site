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
  power: number;
  defense: number;
  speed: number;
  points?: number;
  gender?: Gender;
  slots?: Partial<Record<Slot, string>>;
  gearPower?: number;
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
};

type ApiMe = { me: Me };
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
const tipEl = document.getElementById("vaTooltip") as HTMLDivElement;
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
function tipHide() {
  if (tipEl) tipEl.style.display = "none";
}
window.addEventListener("scroll", tipHide);
window.addEventListener("resize", tipHide);

function sellPriceOf(item?: ShopItem): number {
  if (!item) return 0;
  // @ts-ignore
  if (typeof (item as any).sellPrice === "number") return Math.max(0, Math.floor((item as any).sellPrice));
  return Math.max(0, Math.floor(item.cost * 0.5));
}

function tooltipHTML(item: ShopItem, slotKey: string) {
  const rarity = (item.rarity || "normal");
  const stat = `+${item.boost} ${item.stat}`;
  const sell = sellPriceOf(item);
  return `
    <div class="tt-title">${item.name} <span class="muted">(${rarity})</span></div>
    <div class="tt-row"><span>Slot</span><span class="muted">${capitalize(slotKey)}</span></div>
    <div class="tt-row"><span>Stats</span><span class="muted">${stat}</span></div>
    <div class="tt-row"><span>Sell</span><span class="muted">${sell}g</span></div>
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
  if (fromShop) {
    itemCache.set(id, fromShop);
    return fromShop;
  }
  try {
    const info = await api<ShopItem>("/api/game/item/" + encodeURIComponent(id));
    itemCache.set(id, info);
    return info;
  } catch {
    return undefined;
  }
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
  el.onmouseenter = null;
  el.onmousemove = null;
  el.onmouseleave = null;

  if (!item) {
    el.textContent = capitalize(slotKey);
    return;
  }

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
  el.appendChild(overlay);

  el.onmouseenter = (ev) => tipShow(ev.clientX, ev.clientY, tooltipHTML(item, slotKey));
  el.onmousemove = (ev) => tipMove(ev);
  el.onmouseleave = tipHide;
}

/* ---------- unlock rules ---------- */
const SLOT_UNLOCK: Record<Slot, number> = {
  helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
  ring: 18, wings: 22, pet: 24, sylph: 28
};
const PVP_UNLOCK = 25;

/* ---------- fetch wrapper ---------- */
async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(apiBase + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId || "",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

/* ---------- compute ---------- */
function totalPower(m: Me): number {
  const gear = m.gearPower ?? 0;
  return Math.max(0, m.power) + gear;
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

  ($("avatar") as HTMLImageElement).src =
    m.gender === "male" ? resolveImg("/guildbook/boy.png") : resolveImg("/guildbook/girl.png");

  document.querySelectorAll<HTMLDivElement>(".slot").forEach(async (div) => {
    const slot = div.dataset.slot as Slot;
    const needed = SLOT_UNLOCK[slot];
    const eqId = m.slots?.[slot];

    if (m.level < needed) {
      div.innerHTML = `${capitalize(slot)} (Lv ${needed})`;
      div.onmouseenter = (ev) => tipShow(ev.clientX, ev.clientY,
        `<div class="tt-title">${capitalize(slot)}</div>
         <div class="muted">Unlocks at level ${needed}</div>`);
      div.onmousemove = (ev) => tipMove(ev);
      div.onmouseleave = tipHide;
      return;
    }

    if (!eqId) {
      renderSlot(slot, undefined);
      return;
    }

    const it = await getItem(eqId);
    renderSlot(slot, it);
  });

  $("powerTotal").textContent = `POWER ${totalPower(m)}`;
  ($("fightRandom") as HTMLButtonElement).disabled = m.level < PVP_UNLOCK;
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

    const locked = !!(item.levelReq && me.level < item.levelReq);
    const req = item.levelReq ? ` <span class="muted">(Lv ${item.levelReq}+)</span>` : "";
    const slot = item.slot ? ` <span class="muted">[${capitalize(item.slot)}]</span>` : "";
    const rarity = (item.rarity || "normal").toLowerCase();
    const frameUrl = rarityFrame[rarity] || rarityFrame.normal;

    const line = document.createElement("div");
    line.className = "shop-item";
    line.innerHTML = `
      <div class="shop-left">
        <span class="shop-thumb">
          <img class="shop-img" src="${resolveImg(item.imageUrl)}" alt="${item.name}" loading="lazy">
          <img class="shop-frame" src="${resolveImg(frameUrl)}" alt="" onerror="this.style.display='none'">
        </span>
        <div class="shop-text">
          <div class="shop-title">${item.name}${slot}${req}</div>
          <div class="shop-sub muted">+${item.boost} ${item.stat}</div>
        </div>
      </div>
      <div class="shop-right">
        <div class="shop-price">${item.cost}g</div>
        <button data-id="${item.id}" ${locked ? "disabled" : ""}>
          ${locked ? "Locked" : "Buy"}
        </button>
      </div>
    `;

    line.onmouseenter = (ev) =>
      tipShow(ev.clientX, ev.clientY, tooltipHTML(item, item.slot || "unknown"));
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
    } catch (err: any) {
      log("Shop error: " + err.message, "bad");
    }
  };
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

  render();
  renderShop();
}

async function setGender(g: Gender) {
  try {
    const res = await api<ApiMe>("/api/game/gender", { method: "POST", body: JSON.stringify({ gender: g }) });
    state.me = res.me;
    $("genderPick").style.display = "none";
    render();
  } catch (e: any) { log(e.message, "bad"); }
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
    log(`${r.result.win ? "Victory!" : "Defeat."} vs ${r.result.opponent.name} ΔGold ${r.result.deltaGold}, ΔXP ${r.result.deltaXP}`);
  } catch (err: any) { log("Fight error: " + err.message, "bad"); }
};

const cooldowns: Record<"power"|"defense"|"speed", number> = { power: 0, defense: 0, speed: 0 };
async function train(stat: "power"|"defense"|"speed") {
  const now = Date.now();
  if (now < cooldowns[stat]) return;
  cooldowns[stat] = now + 3000;
  try {
    const r = await api<ApiMe>("/api/game/train", { method: "POST", body: JSON.stringify({ stat }) });
    state.me = r.me; render(); log(`Trained ${stat} (+1)`, "ok");
  } catch (err: any) { log("Train error: " + err.message, "bad"); }
}

/* passive idle tick every 10s */
setInterval(async () => {
  try {
    const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
    state.me = r.me; render();
  } catch {}
}, 10000);

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* start */
loadAll().catch(e => log(e.message, "bad"));

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
    gold: (n: number) => call("/api/dev/gold", { add: n }),
    xp: (add: number) => call("/api/dev/xp", { add }),
    item: (id: string) => call("/api/dev/item", { itemId: id }),
    slots: (slots: Record<string, string>) => call("/api/dev/slots", { slots }),
    drengr: () => call("/api/dev/drengr"),
    reset: () => call("/api/dev/reset"),
    setKey: (k: string) => { localStorage.setItem("DEV_KEY", k); (dev as any)._key = k; return "DEV_KEY set"; },
    _key: DEV_KEY,
  };

  (window as any).dev = dev;
  console.log("%cwindow.dev ready → dev.me(), dev.level(25), dev.gold(9999), dev.item('drengr-helm'), dev.drengr()", "color:#39ff14");
})();






