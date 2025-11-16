//* ===============================//
// Valhalla Ascending — src/game.ts//
// (Arena only — shop removed)     //
// ===============================*//

type Slot =
  | "weapon"
  | "helm" | "shoulders" | "chest" | "gloves" | "boots"
  | "ring" | "wings" | "pet" | "sylph";

type ClassId = "warrior" | "shieldmaiden" | "rune-mage" | "berserker" | "hunter";

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
  slots?: Partial<Record<Slot, string>>;
  gearPower?: number;
  battleRating?: number;
  brisingr?: number;
  diamonds?: number;
};

type ApiMe = { me: Me };

/* ---------- config ---------- */
const apiBase =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim() || "";

/* ---------- user id ---------- */
const LS_KEY = "mh_user";
function getUserId(): string | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      return obj?.id || obj?._id || obj?.user?.id || null;
    }
  } catch {}
  return new URLSearchParams(location.search).get("user");
}
const userId = getUserId();

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

/* ---------- API ---------- */
function stripHtml(s: string) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}
async function api<T = any>(path: string, opts: RequestInit = {}) {
  const r = await fetch(apiBase + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId || "",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(stripHtml(await r.text()));
  return r.json() as Promise<T>;
}

/* =========================================================
   CLASS HELPERS
   ========================================================= */
const CLASS_KEY = "va_class";

function getCurrentClass(): ClassId | null {
  return (localStorage.getItem(CLASS_KEY) as ClassId | null) || null;
}

function getClassBaseAvatar(): string {
  const c = getCurrentClass();
  switch (c) {
    case "warrior":      return "/guildbook/avatars/warrior/war_000.png";
    case "shieldmaiden": return "/guildbook/avatars/shieldmaiden/sm_000.png";
    case "rune-mage":    return "/guildbook/avatars/rune-mage/rm_000.png";
    case "berserker":    return "/guildbook/avatars/berserker/b_000.png";
    case "hunter":       return "/guildbook/avatars/hunter/h_000.png";
    default:             return "/guildbook/avatars/warrior/war_000.png";
  }
}

/* =========================================================
   HERO CANVAS ANIMATION
   ========================================================= */
const heroCanvas = document.getElementById("heroCanvas") as HTMLCanvasElement | null;
const heroCtx = heroCanvas ? heroCanvas.getContext("2d") : null;

function makeSeq(base: string, prefix: string, count: number) {
  const arr: string[] = [];
  for (let i = 0; i < count; i++) {
    arr.push(`${base}/${prefix}${String(i).padStart(3, "0")}.png`);
  }
  return arr;
}

const CLASS_ANIMS = {
  warrior:      { idle: makeSeq("/guildbook/avatars/warrior",      "war_", 9) },
  shieldmaiden: { idle: makeSeq("/guildbook/avatars/shieldmaiden", "sm_", 9) },
  "rune-mage":  { idle: makeSeq("/guildbook/avatars/rune-mage",    "rm_", 9) },
  berserker:    { idle: makeSeq("/guildbook/avatars/berserker",    "b_", 9) },
  hunter:       { idle: makeSeq("/guildbook/avatars/hunter",       "h_", 9) },
};

let heroFrames: HTMLImageElement[] = [];
let heroFrameIndex = 0;
let heroLastTime = 0;
const HERO_FPS = 8;

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej();
    img.src = src;
  });
}

async function setupHeroAnim() {
  if (!heroCanvas || !heroCtx) return;

  const cls = getCurrentClass() || "warrior";
  const paths = CLASS_ANIMS[cls].idle;
  try {
    heroFrames = await Promise.all(paths.map(loadImg));
  } catch {}

  heroLastTime = 0;
  heroFrameIndex = 0;
  requestAnimationFrame(heroAnimLoop);
}

function heroAnimLoop(t: number) {
  if (!heroCanvas || !heroCtx || !heroFrames.length) return;
  if (!heroLastTime) heroLastTime = t;

  if (t - heroLastTime > 1000 / HERO_FPS) {
    heroFrameIndex = (heroFrameIndex + 1) % heroFrames.length;
    heroLastTime = t;
  }

  const img = heroFrames[heroFrameIndex];
  heroCtx.clearRect(0, 0, heroCanvas.width, heroCanvas.height);

  const scale = Math.min(heroCanvas.width / img.width, heroCanvas.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (heroCanvas.width - w) / 2;
  const y = heroCanvas.height - h;

  heroCtx.drawImage(img, x, y, w, h);
  requestAnimationFrame(heroAnimLoop);
}

/* =========================================================
   AVATAR & STATS RENDER
   ========================================================= */

function clientBattleRating(m: Me): number {
  return (m.power ?? 0) + (m.defense ?? 0) + (m.speed ?? 0);
}

function updateAvatar() {
  const avatar = document.getElementById("avatar") as HTMLImageElement | null;
  if (!avatar) return;

  const base = getClassBaseAvatar();
  avatar.src = base;
}

/* =========================================================
   ARENA RENDER
   ========================================================= */

async function renderArena() {
  const m = state.me;
  if (!m) return;

  safeSetText("heroName", m.name || "Unknown");
  safeSetText("level", String(m.level));
  safeSetText("gold", String(m.gold));
  safeSetText("strength", String(m.power));
  safeSetText("defense", String(m.defense));
  safeSetText("speed", String(m.speed));
  safeSetText("points", String(m.points ?? 0));

  const need = m.level * 100;
  safeSetText("xpVal", `${m.xp} / ${need}`);

  const xpBar = safeEl<HTMLSpanElement>("xpBar");
  if (xpBar) xpBar.style.width = Math.min(100, (m.xp / need) * 100) + "%";

  safeSetText("battleRating", "BATTLE RATING " + clientBattleRating(m));

  updateAvatar();
}

/* =========================================================
   ALLOCATION
   ========================================================= */

let allocInput: HTMLInputElement | null = null;
let btnPow: HTMLButtonElement | null = null;
let btnDef: HTMLButtonElement | null = null;
let btnSpd: HTMLButtonElement | null = null;

function ensureAllocUI() {
  if (document.getElementById("allocControls")) return;

  const row = safeEl("trainSpeed")?.closest(".row") as HTMLElement | null;
  if (!row) return;

  const wrap = document.createElement("div");
  wrap.id = "allocControls";
  wrap.className = "row";
  wrap.style.marginTop = "6px";
  wrap.innerHTML = `
    <div class="muted">ALLOC<br>PTS</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="allocAmount" type="number" min="1" value="1"
        style="width:60px;padding:6px;border-radius:8px;border:1px solid #3b3325;background:#0b0f12;color:#d4a94d">
      <button id="allocPow">Power</button>
      <button id="allocDef">Defense</button>
      <button id="allocSpd">Speed</button>
    </div>
  `;
  row.after(wrap);

  allocInput = safeEl("allocAmount");
  btnPow = safeEl("allocPow");
  btnDef = safeEl("allocDef");
  btnSpd = safeEl("allocSpd");

  btnPow!.onclick = () => allocate("power");
  btnDef!.onclick = () => allocate("defense");
  btnSpd!.onclick = () => allocate("speed");
}

async function allocate(stat: "power"|"defense"|"speed") {
  if (!allocInput) return;
  const amt = Math.max(1, Number(allocInput.value || "1"));
  try {
    const r = await api<ApiMe>("/api/game/allocate", {
      method: "POST",
      body: JSON.stringify({ stat, amount: amt }),
    });
    state.me = r.me;
    await renderArena();
    log(`Allocated ${amt} to ${stat}`, "ok");
  } catch (e: any) {
    log("Allocate error: " + e.message, "bad");
  }
}

/* =========================================================
   TRAINING
   ========================================================= */

const cooldowns: Record<"power"|"defense"|"speed", number> = { power:0, defense:0, speed:0 };

async function train(stat: "power"|"defense"|"speed") {
  const now = Date.now();
  if (now < cooldowns[stat]) return;

  cooldowns[stat] = now + 3000;
  try {
    const r = await api<ApiMe>("/api/game/train", {
      method: "POST",
      body: JSON.stringify({ stat }),
    });
    state.me = r.me;
    await renderArena();
    log(`Trained ${stat}`, "ok");
  } catch (e: any) {
    log("Train error: " + e.message, "bad");
  }
}

/* =========================================================
   GLOBAL STATE (shop removed)
   ========================================================= */

const state = {
  me: null as Me | null,
};

/* =========================================================
   BOOTSTRAP (no shop calls)
   ========================================================= */

async function boot() {
  if (!userId) return log("No user found.", "bad");

  const meRes = await api<ApiMe>("/api/game/me");
  state.me = meRes.me;

  ensureAllocUI();
  updateAvatar();
  await renderArena();

  // Wiring
  safeEl("trainPower")?.addEventListener("click", () => train("power"));
  safeEl("trainDefense")?.addEventListener("click", () => train("defense"));
  safeEl("trainSpeed")?.addEventListener("click", () => train("speed"));

  // Idle tick every 10s
  setInterval(async () => {
    try {
      const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
      state.me = r.me;
      await renderArena();
    } catch {}
  }, 10000);

  setupHeroAnim();
}

boot().catch(e => log(e.message, "bad"));





