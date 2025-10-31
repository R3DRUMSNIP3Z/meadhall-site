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

const apiBase =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim() || "";

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

const $ = (id: string) => document.getElementById(id)!;
const logBox = $("log");
function log(msg: string, cls?: string) {
  const p = document.createElement("div");
  if (cls) p.className = cls;
  p.textContent = msg;
  logBox.prepend(p);
}

const state: { me: Me | null; shop: ShopItem[] } = { me: null, shop: [] };

// Unlock rules
const SLOT_UNLOCK: Record<Slot, number> = {
  helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
  ring: 18, wings: 22, pet: 24, sylph: 28
};
const PVP_UNLOCK = 25;

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

function totalPower(m: Me): number {
  const gear = m.gearPower ?? 0;
  return Math.max(0, m.power) + gear;
}

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
    m.gender === "male" ? "/guildbook/boy.png" : "/guildbook/girl.png";

  // Equip grid
  document.querySelectorAll<HTMLDivElement>(".slot").forEach(div => {
    const slot = div.dataset.slot as Slot;
    const needed = SLOT_UNLOCK[slot];
    div.classList.toggle("locked", m.level < needed);
    const eqId = m.slots?.[slot];
    div.textContent = m.level < needed
      ? `${capitalize(slot)} (Lv ${needed})`
      : (eqId ? `${capitalize(slot)} ✓` : capitalize(slot));
  });

  // Big POWER
  $("powerTotal").textContent = `POWER ${totalPower(m)}`;

  // PvP lock
  ( $("fightRandom") as HTMLButtonElement ).disabled = m.level < PVP_UNLOCK;
}

function renderShop() {
  const box = $("shop");
  box.innerHTML = "";
  state.shop.forEach(item => {
    const req  = item.levelReq ? ` <span class="muted">(Lv ${item.levelReq}+)</span>` : "";
    const slot = item.slot ? ` <span class="muted">[${capitalize(item.slot)}]</span>` : "";
    const line = document.createElement("div");
    line.className = "shop-item";
    line.innerHTML = `
      <div>${item.name}${slot}${req} <span class="muted">(+${item.boost} ${item.stat})</span></div>
      <div>${item.cost}g <button data-id="${item.id}">Buy</button></div>
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

// Buttons
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

// Passive idle tick every 10s
setInterval(async () => {
  try {
    const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
    state.me = r.me; render();
  } catch {}
}, 10000);

function capitalize(s: string){ return s.charAt(0).toUpperCase() + s.slice(1); }

loadAll().catch(e => log(e.message, "bad"));

