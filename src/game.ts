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
};

type ShopItem = {
  id: string;
  name: string;
  stat: "power" | "defense" | "speed";
  boost: number;
  cost: number;
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

const apiBase =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim() ||
  "";

const LS_KEY = "mh_user";

function getUserId(): string | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      return obj?.id || obj?._id || obj?.user?.id || null;
    }
  } catch {
    /* ignore */
  }
  const qs = new URLSearchParams(location.search).get("user");
  return qs || null;
}

const userId = getUserId();
if (!userId) {
  alert("Missing user. Make sure you're logged in.");
}

const $ = (id: string) => document.getElementById(id)!;
const logBox = $("log");

function log(msg: string, cls?: string) {
  const p = document.createElement("div");
  if (cls) p.className = cls;
  p.textContent = msg;
  logBox.prepend(p);
}

const state: { me: Me | null; shop: ShopItem[] } = { me: null, shop: [] };

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(apiBase + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId || "",
      ...(opts.headers || {})
    }
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(text || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

function render() {
  const m = state.me;
  if (!m) return;
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
}

function renderShop() {
  const box = $("shop");
  box.innerHTML = "";
  state.shop.forEach((item) => {
    const row = document.createElement("div");
    row.className = "shop-item";
    row.innerHTML = `
      <div>${item.name} <span class="muted">(+${item.boost} ${item.stat})</span></div>
      <div>${item.cost}g <button data-id="${item.id}">Buy</button></div>
    `;
    box.appendChild(row);
  });

  // Event delegation (no {once:true})
  box.onclick = async (ev) => {
    const target = (ev.target as HTMLElement)?.closest("button") as
      | HTMLButtonElement
      | null;
    if (!target) return;
    const id = target.getAttribute("data-id");
    if (!id) return;
    try {
      const res = await api<{ me: Me; item: ShopItem }>("/api/game/shop/buy", {
        method: "POST",
        body: JSON.stringify({ itemId: id })
      });
      state.me = res.me;
      log(`Bought ${res.item.name} (+${res.item.boost} ${res.item.stat})`, "ok");
      render();
    } catch (err: any) {
      log("Shop error: " + err.message, "bad");
    }
  };
}

async function loadAll() {
  const meRes = await api<ApiMe>("/api/game/me");
  state.me = meRes.me;
  const shopRes = await api<ApiShop>("/api/game/shop");
  state.shop = shopRes.items;
  render();
  renderShop();
}

// Buttons
$("trainPower").onclick = () => train("power");
$("trainDefense").onclick = () => train("defense");
$("trainSpeed").onclick = () => train("speed");
$("tickNow").onclick = async () => {
  const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
  state.me = r.me;
  render();
  log("Idle tick processed");
};
$("fightRandom").onclick = async () => {
  try {
    const r = await api<FightResult>("/api/pvp/fight", {
      method: "POST",
      body: JSON.stringify({ mode: "random" })
    });
    state.me = r.me;
    render();
    const verdict = r.result.win ? "Victory!" : "Defeat.";
    log(
      `${verdict} You ${r.result.win ? "won" : "lost"} vs ${r.result.opponent.name}.  ΔGold ${r.result.deltaGold}, ΔXP ${r.result.deltaXP}`
    );
  } catch (err: any) {
    log("Fight error: " + err.message, "bad");
  }
};

const cooldowns: Record<"power" | "defense" | "speed", number> = {
  power: 0,
  defense: 0,
  speed: 0
};

async function train(stat: "power" | "defense" | "speed") {
  const now = Date.now();
  if (now < cooldowns[stat]) return;
  cooldowns[stat] = now + 3000;
  try {
    const r = await api<ApiMe>("/api/game/train", {
      method: "POST",
      body: JSON.stringify({ stat })
    });
    state.me = r.me;
    render();
    log(`Trained ${stat} (+1)`, "ok");
  } catch (err: any) {
    log("Train error: " + err.message, "bad");
  }
}

// Passive idle tick every 10s
setInterval(async () => {
  try {
    const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
    state.me = r.me;
    render();
  } catch {
    /* ignore */
  }
}, 10000);

loadAll().catch((e: any) => log(e.message, "bad"));
