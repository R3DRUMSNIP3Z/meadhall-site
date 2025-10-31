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
  power: number;     // base
  defense: number;
  speed: number;
  points?: number;
  gender?: Gender;
  slots?: Partial<Record<Slot, string>>;
  gearPower?: number; // server-computed; also safe to display
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
  imageUrl?: string; // defaults to /guildbook/items/<id>.png on backend / item endpoint
};

type ApiMe  = { me: Me };
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

/* ---------- image resolver (frontend assets) ---------- */
function resolveImg(u?: string): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;           // already absolute
  if (u.startsWith("/guildbook/")) return `${location.origin}${u}`; // served by Vercel/public
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

/* ---------- tiny DOM helpers ---------- */
const $ = (id: string) => document.getElementById(id)!;
const logBox = $("log");
function log(msg: string, cls?: string) {
  const p = document.createElement("div");
  if (cls) p.className = cls;
  p.textContent = msg;
  logBox.prepend(p);
}

/* ---------- client state ---------- */
const state: { me: Me | null; shop: ShopItem[] } = { me: null, shop: [] };

/* ---------- item cache + lookup ---------- */
const itemCache = new Map<string, ShopItem>();

async function getItem(id: string): Promise<ShopItem | undefined> {
  if (!id) return;
  if (itemCache.has(id)) return itemCache.get(id)!;

  // try from loaded shop first
  const fromShop = state.shop.find(i => i.id === id);
  if (fromShop) {
    itemCache.set(id, fromShop);
    return fromShop;
  }

  // fallback to backend metadata
  try {
    const info = await api<ShopItem>("/api/game/item/" + encodeURIComponent(id));
    itemCache.set(id, info);
    return info;
  } catch {
    return undefined;
  }
}

/* ---------- rarity frames + slot renderer ---------- */
const rarityFrame: Record<string,string> = {
  normal:    "/guildbook/frames/normal-frame.svg",
  epic:      "/guildbook/frames/epic-frame.svg",
  legendary: "/guildbook/frames/legendary-frame.svg",
};

function renderSlot(
  slotKey: string,
  item?: { rarity?: string; imageUrl?: string; name?: string }
) {
  const el = document.querySelector(`.slot[data-slot="${slotKey}"]`) as HTMLElement | null;
  if (!el) return;

  el.innerHTML = ""; // clear content

  if (!item) {
    el.textContent = slotKey.charAt(0).toUpperCase() + slotKey.slice(1);
    return;
  }

  const img = document.createElement("img");
  img.className = "slot-img";
  img.src = resolveImg(item.imageUrl);
  img.alt = item.name || slotKey;
  el.appendChild(img);

  const r = (item.rarity || "").toLowerCase();
  const frameUrl = rarityFrame[r];
  if (frameUrl) {
    const overlay = document.createElement("img");
    overlay.className = "rarity-frame";
    overlay.alt = "";
    overlay.src = resolveImg(frameUrl);
    el.appendChild(overlay);
  }
}

/* ---------- unlock rules ---------- */
const SLOT_UNLOCK: Record<Slot, number> = {
  helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
  ring: 18, wings: 22, pet: 24, sylph: 28
};
const PVP_UNLOCK = 25;

/* ---------- fetch wrapper ---------- */
async function api<T=any>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(apiBase + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId || "",
      ...(opts.headers || {})
    }
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

/* ---------- compute helpers ---------- */
function totalPower(m: Me): number {
  const gear = m.gearPower ?? 0;
  return Math.max(0, m.power) + gear;
}

/* ---------- renderer ---------- */
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
  ( $("xpBar") as HTMLSpanElement ).style.width =
    Math.min(100, Math.floor((m.xp / need) * 100)) + "%";

  // Avatar
  ( $("avatar") as HTMLImageElement ).src =
    m.gender === "male" ? resolveImg("/guildbook/boy.png") : resolveImg("/guildbook/girl.png");

  // Equip grid (lock visuals + rarity frames)
  document.querySelectorAll<HTMLDivElement>(".slot").forEach(async (div) => {
    const slot = div.dataset.slot as Slot;
    const needed = SLOT_UNLOCK[slot];
    const eqId = m.slots?.[slot];

    // lock state first
    div.classList.toggle("locked", m.level < needed);
    if (m.level < needed) {
      div.innerHTML = `${capitalize(slot)} (Lv ${needed})`;
      return;
    }

    // no item equipped
    if (!eqId) {
      renderSlot(slot, undefined);
      return;
    }

    // fetch + render with overlay
    const it = await getItem(eqId);
    renderSlot(
      slot,
      it ? { rarity: it.rarity, imageUrl: it.imageUrl, name: it.name } : undefined
    );
  });

  // Big POWER
  $("powerTotal").textContent = `POWER ${totalPower(m)}`;

  // PvP lock
  ( $("fightRandom") as HTMLButtonElement ).disabled = m.level < PVP_UNLOCK;
}

function renderShop() {
  const box = $("shop");
  box.innerHTML = "";

  state.shop.forEach((item) => {
    const req  = item.levelReq ? ` <span class="muted">(Lv ${item.levelReq}+)</span>` : "";
    const slot = item.slot ? ` <span class="muted">[${capitalize(item.slot)}]</span>` : "";
    const r = (item.rarity || "normal").toLowerCase();

    const frameUrl =
      (rarityFrame as any)[r] || rarityFrame.normal || "/guildbook/frames/normal.svg";

    const line = document.createElement("div");
    line.className = "shop-item";
    line.innerHTML = `
      <div class="shop-left">
        <span class="shop-thumb">
          <img class="shop-img" src="${item.imageUrl || ""}" alt="${item.name}" loading="lazy">
          <img class="shop-frame" src="${frameUrl}" alt="" onerror="this.style.display='none'">
        </span>
        <div class="shop-text">
          <div class="shop-title">${item.name}${slot}${req}</div>
          <div class="shop-sub muted">+${item.boost} ${item.stat}</div>
        </div>
      </div>
      <div class="shop-right">
        <div class="shop-price">${item.cost}g</div>
        <button data-id="${item.id}">Buy</button>
      </div>
    `;
    box.appendChild(line);
  });

  box.onclick = async (ev) => {
    const btn = (ev.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!btn) return;
    const id = btn.getAttribute("data-id")!;
    try {
      const res = await api<{ me: Me; item: ShopItem }>("/api/game/shop/buy", {
        method: "POST",
        body: JSON.stringify({ itemId: id }),
      });
      state.me = res.me;
      log(`Bought ${res.item.name} (+${res.item.boost} ${res.item.stat})`, "ok");
      render();
    } catch (err: any) {
      log("Shop error: " + err.message, "bad");
    }
  };
}



/* ---------- boot ---------- */
async function loadAll() {
  const meRes = await api<ApiMe>("/api/game/me");
  state.me = meRes.me;

  // gender pick first time
  if (!state.me.gender) {
    $("genderPick").style.display = "block";
    $("pickFemale").onclick = () => setGender("female");
    $("pickMale").onclick   = () => setGender("male");
  }

  const shopRes = await api<ApiShop>("/api/game/shop");
  state.shop = shopRes.items;

  render(); renderShop();
}

async function setGender(g: Gender) {
  try {
    const res = await api<ApiMe>("/api/game/gender", { method:"POST", body: JSON.stringify({ gender: g })});
    state.me = res.me;
    $("genderPick").style.display = "none";
    render();
  } catch (e:any) { log(e.message, "bad"); }
}

/* ---------- buttons ---------- */
$("trainPower").onclick   = () => train("power");
$("trainDefense").onclick = () => train("defense");
$("trainSpeed").onclick   = () => train("speed");
$("tickNow").onclick = async () => {
  const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
  state.me = r.me; render(); log("Idle tick processed");
};
$("fightRandom").onclick = async () => {
  try {
    const r = await api<FightResult>("/api/pvp/fight", { method: "POST", body: JSON.stringify({ mode: "random" })});
    state.me = r.me; render();
    const verdict = r.result.win ? "Victory!" : "Defeat.";
    log(`${verdict} You ${r.result.win ? "won" : "lost"} vs ${r.result.opponent.name}.  ΔGold ${r.result.deltaGold}, ΔXP ${r.result.deltaXP}`);
  } catch (err:any){ log("Fight error: " + err.message, "bad"); }
};

const cooldowns: Record<"power"|"defense"|"speed", number> = { power:0, defense:0, speed:0 };
async function train(stat: "power"|"defense"|"speed") {
  const now = Date.now();
  if (now < cooldowns[stat]) return;
  cooldowns[stat] = now + 3000;
  try {
    const r = await api<ApiMe>("/api/game/train", { method:"POST", body: JSON.stringify({ stat })});
    state.me = r.me; render(); log(`Trained ${stat} (+1)`, "ok");
  } catch(err:any){ log("Train error: " + err.message, "bad"); }
}

/* passive idle tick every 10s */
setInterval(async () => {
  try {
    const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
    state.me = r.me; render();
  } catch {}
}, 10000);

/* ---------- misc ---------- */
function capitalize(s: string){ return s.charAt(0).toUpperCase() + s.slice(1); }

/* start */
loadAll().catch(e => log(e.message, "bad"));

/* ======================================================================= */
/* ---- Dev console helpers (window.dev) --------------------------------- */
/* ======================================================================= */
(() => {
  const DEV_KEY = localStorage.getItem("DEV_KEY") || "valhalla-dev";

  // prefer existing userId; if missing, attempt to resolve lazily on call
  const initialUid = userId;

  async function call<T=any>(path: string, body?: any): Promise<T> {
    const activeUser = initialUid || getUserId();
    if (!activeUser) throw new Error("No user (log in first).");
    const r = await fetch(apiBase + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": activeUser,
        "x-dev-key": DEV_KEY
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  const dev = {
    me:        () => call("/api/dev/me"),
    level:     (n: number) => call("/api/dev/level", { level: n }),
    gold:      (nOrOpts: number | { add?: number; set?: number }) =>
                 typeof nOrOpts === "number" ? call("/api/dev/gold", { add: nOrOpts })
                                             : call("/api/dev/gold", nOrOpts),
    xp:        (add: number) => call("/api/dev/xp", { add }),
    item:      (id: string) => call("/api/dev/item", { itemId: id }),
    slots:     (slots: Record<string,string>) => call("/api/dev/slots", { slots }),
    drengr:    () => call("/api/dev/drengr"),
    reset:     () => call("/api/dev/reset"),
    setKey:    (k: string) => { localStorage.setItem("DEV_KEY", k); (dev as any)._key=k; return "DEV_KEY set"; },
    _key:      DEV_KEY
  };

  (window as any).dev = dev;
  // eslint-disable-next-line no-console
  console.log(
    "%cwindow.dev ready → dev.me(), dev.level(25), dev.gold(9999), dev.item('drengr-helm'), dev.drengr()",
    "color:#39ff14"
  );
})();

/* ======================================================================= */
/* NOTE: Add CSS to your stylesheet so overlays align:                     */
/*
.slot{position:relative;width:96px;height:96px;border:1px solid #3b3325;border-radius:12px;background:#0f1215;display:grid;place-items:center;color:#cbb17a;font-family:"Cinzel",serif;overflow:hidden}
.slot.locked{opacity:.5;filter:grayscale(1)}
.slot-img{max-width:88%;max-height:88%;object-fit:contain;pointer-events:none}
.rarity-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none}

.shop-left{display:flex;gap:10px;align-items:center;min-width:0}
.shop-img{width:44px;height:44px;border-radius:8px;object-fit:cover;box-shadow:0 0 0 1px rgba(212,169,77,.25);flex:0 0 44px}
.shop-text{display:flex;flex-direction:column}
.shop-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.shop-right{display:flex;align-items:center;gap:10px}
.shop-price{width:60px;text-align:right}
*/




