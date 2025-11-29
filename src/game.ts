import { VAHeroRead, VAHeroWrite } from "./global-hero";

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
  health: number;   // current HP (mirrors VAHero)
  points?: number;
  slots?: Partial<Record<Slot, string>>;
  gearPower?: number;
  battleRating?: number;
  brisingr?: number;
  diamonds?: number;
};

type ApiMe = { me: Me };
const HERO_NAME_KEY = "va_hero_name";

function getHeroNameFromLocal(me: Me | null): string {
  try {
    const raw = localStorage.getItem(HERO_NAME_KEY);
    if (raw && raw.trim()) return raw.trim();
  } catch {}
  return (me?.name && me.name.trim()) || "Unknown";
}


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
const CLASS_KEY_BASE = "va_class";
const CLASS_KEY_USER = (() => {
  const uid = userId || "guest";
  return `${CLASS_KEY_BASE}__${uid}`;
})();

function getCurrentClass(): ClassId | null {
  // prefer per-user, then global
  const raw =
    (localStorage.getItem(CLASS_KEY_USER) as ClassId | null) ||
    (localStorage.getItem(CLASS_KEY_BASE) as ClassId | null);
  return (raw as ClassId | null) || null;
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
   YGGDRASIL PATHS (CLASS SKILLS)
   ========================================================= */

type SkillSlotId = "basic" | "aoe" | "buff" | "debuff";

type YggSkill = {
  id: SkillSlotId;
  name: string;
  desc: string;
  icon: string;
  unlockedAtLevel: number;
};

type YggClassBlock = {
  pathName: string;
  skills: YggSkill[];
};

type YggFile = {
  classes: Record<ClassId, YggClassBlock>;
};

const YGG_FILE_PATH = "/guildbook/yggdrasil_paths.json";

let __yggFile: YggFile | null = null;

async function loadYggFile(): Promise<YggFile> {
  if (__yggFile) return __yggFile;
  try {
    const r = await fetch(YGG_FILE_PATH, { cache: "no-store" });
    if (!r.ok) throw new Error(r.statusText);
    const json = (await r.json()) as YggFile;
    __yggFile = json;
    return json;
  } catch (e) {
    console.error("Yggdrasil load failed:", e);
    __yggFile = { classes: {} as any };
    return __yggFile;
  }
}

/* ---------- CLASS SKILL ICONS FOR ALL CLASSES (Lisa) ---------- */

const warriorIcons: Record<string, string> = {
  basic:  "/guildbook/skillicons/drengrstrike.png",
  aoe:    "/guildbook/skillicons/whirlwinddance.png",
  buff:   "/guildbook/skillicons/odinsblessing.png",
  debuff: "/guildbook/skillicons/helsgrasp.png",
};

const shieldmaidenIcons: Record<string, string> = {
  basic:  "/guildbook/skillicons/valkyrieslash.png",
  aoe:    "/guildbook/skillicons/ragnarokshowl.png",
  buff:   "/guildbook/skillicons/aegisoffreyja.png",
  debuff: "/guildbook/skillicons/cursebreaker.png",
};

const runemageIcons: Record<string, string> = {
  basic:  "/guildbook/skillicons/raudrbolt.png",
  aoe:    "/guildbook/skillicons/ginnungagapnova.png",
  buff:   "/guildbook/skillicons/eikthyrnirshield.png",
  debuff: "/guildbook/skillicons/nidhoggrhex.png",
};

const berserkerIcons: Record<string, string> = {
  basic:  "/guildbook/skillicons/feralslash.png",
  aoe:    "/guildbook/skillicons/ragequake.png",
  buff:   "/guildbook/skillicons/ulfhamrtrance.png",
  debuff: "/guildbook/skillicons/bloodhowl.png",
};

const hunterIcons: Record<string, string> = {
  basic:  "/guildbook/skillicons/piercingshot.png",
  aoe:    "/guildbook/skillicons/frostbitevolley.png",
  buff:   "/guildbook/skillicons/skadisfocus.png",
  debuff: "/guildbook/skillicons/wintersgrasp.png",
};

/**
 * Unified icon map per class → per skill slot.
 * This lets every class (warrior, shieldmaiden, rune-mage, berserker, hunter)
 * get the right icon for basic/aoe/buff/debuff, even if the JSON file
 * has placeholder icons.
 */
const CLASS_SKILL_ICONS: Record<ClassId, Record<SkillSlotId, string>> = {
  warrior: {
    basic:  warriorIcons.basic,
    aoe:    warriorIcons.aoe,
    buff:   warriorIcons.buff,
    debuff: warriorIcons.debuff,
  },
  shieldmaiden: {
    basic:  shieldmaidenIcons.basic,
    aoe:    shieldmaidenIcons.aoe,
    buff:   shieldmaidenIcons.buff,
    debuff: shieldmaidenIcons.debuff,
  },
  "rune-mage": {
    basic:  runemageIcons.basic,
    aoe:    runemageIcons.aoe,
    buff:   runemageIcons.buff,
    debuff: runemageIcons.debuff,
  },
  berserker: {
    basic:  berserkerIcons.basic,
    aoe:    berserkerIcons.aoe,
    buff:   berserkerIcons.buff,
    debuff: berserkerIcons.debuff,
  },
  hunter: {
    basic:  hunterIcons.basic,
    aoe:    hunterIcons.aoe,
    buff:   hunterIcons.buff,
    debuff: hunterIcons.debuff,
  },
};

/**
 * Push current VAYggdrasil state into the Yggdrasil modal DOM.
 * Expects cards like:
 *   <div data-ygg-slot="basic"> ... .ygg-name / .ygg-desc / img.ygg-icon ... </div>
 * and an optional #yggPathName label.
 */
function applyYggDomFromState(): void {
  const win: any = window as any;
  const ygg = win.VAYggdrasil as
    | { classId: ClassId; pathName: string; allSkills: YggSkill[]; skills: YggSkill[] }
    | undefined;

  if (!ygg || !Array.isArray(ygg.allSkills)) return;

  const bySlot: Partial<Record<SkillSlotId, YggSkill>> = {};
  for (const sk of ygg.allSkills) {
    if (sk && sk.id) bySlot[sk.id] = sk;
  }

  const pathLabel = document.getElementById("yggPathName");
  if (pathLabel && ygg.pathName) {
    pathLabel.textContent = ygg.pathName.toUpperCase();
  }

  const slots: SkillSlotId[] = ["basic", "buff", "aoe", "debuff"];
  for (const id of slots) {
    const skill = bySlot[id];
    if (!skill) continue;

    const card = document.querySelector<HTMLElement>(`[data-ygg-slot="${id}"]`);
    if (!card) continue;

    const nameEl =
      card.querySelector<HTMLElement>(".ygg-name") ||
      card.querySelector<HTMLElement>(".ygg-title");
    const descEl =
      card.querySelector<HTMLElement>(".ygg-desc") ||
      card.querySelector<HTMLElement>(".ygg-text") ||
      card.querySelector<HTMLElement>(".ygg-body");
    const tagEl = card.querySelector<HTMLElement>(".ygg-tag");
    const iconEl = card.querySelector<HTMLImageElement>("img.ygg-icon");

    if (nameEl) nameEl.textContent = skill.name.toUpperCase();
    if (descEl) descEl.textContent = skill.desc;

    // Optional: if you later add `tag` to YggSkill
    if ((skill as any).tag && tagEl) {
      tagEl.textContent = String((skill as any).tag);
    }

    if (iconEl && skill.icon) {
      iconEl.src = skill.icon;
    }
  }
}

/**
 * Compute which Yggdrasil skills are unlocked for the current hero
 * based on their class + level, and expose them on window.VAYggdrasil
 * so the battle scene / UI can use them. Icons are forced to the
 * per-class ones above so all classes have the right artwork.
 */
async function refreshYggForCurrentHero(): Promise<void> {
  const me = state.me;
  if (!me) return;
  const cls = (getCurrentClass() || "warrior") as ClassId;

  const file = await loadYggFile();
  const block = file.classes?.[cls];
  if (!block) {
    console.warn("No Yggdrasil path found for class:", cls);
    return;
  }

  const allSkills = block.skills || [];
  const classIcons = CLASS_SKILL_ICONS[cls];

  // apply icons per class/slot
  const allWithIcons = allSkills.map((sk) => ({
    ...sk,
    icon: classIcons?.[sk.id] || sk.icon,
  }));

  const unlocked = allWithIcons.filter(
    (sk) => me.level >= (sk.unlockedAtLevel ?? 1)
  );

  (window as any).VAYggdrasil = {
    classId: cls,
    pathName: block.pathName,
    level: me.level,
    skills: unlocked,
    allSkills: allWithIcons,
  };

  // Update any existing modal DOM for this path
  applyYggDomFromState();

  log(
    `Yggdrasil Path: ${block.pathName} — ${unlocked.length} skill(s) unlocked`,
    "ok"
  );
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

/**
 * Sync backend `Me` health with global hero stats (VAHero).
 * - Uses backend health as max HP (stat)
 * - Keeps current HP from global hero (so battle damage persists)
 * - Writes final values back to both VAHero + `me.health`
 */
function syncHeroStatsFromBackend(me: Me) {
  // read whatever we already have stored
  let hero = VAHeroRead();

  // backend "health" we treat as the *max HP stat*
  const backendMax = Number(me.health || 0) || hero.maxHealth || hero.health || 180;
  const maxHealth = backendMax > 0 ? backendMax : 180;

  // current HP: prefer stored value so damage persists
  let curHealth = hero.health;

// If HP is missing or 0 or negative → reset to full
if (!curHealth || curHealth <= 0) {
  curHealth = maxHealth;
}


  if (curHealth > maxHealth) curHealth = maxHealth;
  if (curHealth < 0) curHealth = 0;

  hero = VAHeroWrite({
    maxHealth,
    health: curHealth,
  });

  // keep arena's Me in sync with the *current* HP
  me.health = hero.health;
}

function clientBattleRating(m: Me): number {
  // HP is now globally owned; prefer VAHero
  let hp = m.health ?? 0;
  try {
    hp = VAHeroRead().health;
  } catch {}
  return (m.power ?? 0) + (m.defense ?? 0) + (m.speed ?? 0) + (hp ?? 0);
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

  const heroName = getHeroNameFromLocal(m);
  safeSetText("heroName", heroName);

  // keep state.me.name in sync so Dev tools / backend see it
  m.name = heroName;
  safeSetText("level", String(m.level));
  safeSetText("gold", String(m.gold));
  safeSetText("strength", String(m.power));
  safeSetText("defense", String(m.defense));
  safeSetText("health", String((m as any).health ?? 0));
  safeSetText("speed", String(m.speed));
  safeSetText("points", String(m.points ?? 0));

  const need = m.level * 100;
  safeSetText("xpVal", `${m.xp} / ${need}`);

  const xpBar = safeEl<HTMLSpanElement>("xpBar");
  if (xpBar) xpBar.style.width = Math.min(100, (m.xp / need) * 100) + "%";

  safeSetText("battleRating", "BATTLE RATING " + clientBattleRating(m));

  updateAvatar();

  // also refresh which Yggdrasil skills are unlocked for this hero
  await refreshYggForCurrentHero();
}

/* =========================================================
   ALLOCATION
   ========================================================= */

let allocInput: HTMLInputElement | null = null;
let btnPow: HTMLButtonElement | null = null;
let btnDef: HTMLButtonElement | null = null;
let btnSpd: HTMLButtonElement | null = null;
let btnHp:  HTMLButtonElement | null = null; // 👈


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
      <button id="allocHp">Health</button>
    </div>
  `;
  row.after(wrap);

  allocInput = safeEl("allocAmount");
  btnPow = safeEl("allocPow");
  btnDef = safeEl("allocDef");
  btnSpd = safeEl("allocSpd");
  btnHp  = safeEl("allocHp");

  btnPow!.onclick = () => allocate("power");
  btnDef!.onclick = () => allocate("defense");
  btnSpd!.onclick = () => allocate("speed");
  btnHp!.onclick  = () => allocate("health" as any);
}

async function allocate(stat: "power"|"defense"|"speed"| "health") {
  if (!allocInput) return;
  const amt = Math.max(1, Number(allocInput.value || "1"));
  try {
    const r = await api<ApiMe>("/api/game/allocate", {
      method: "POST",
      body: JSON.stringify({ stat, amount: amt }),
    });
    state.me = r.me;

    // if we invested into health on backend, sync max HP into VAHero
    if (stat === "health") {
      syncHeroStatsFromBackend(state.me);
    }

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
   IDLE TICK (separate so dev can toggle)
   ========================================================= */

let tickTimer: number | undefined;

function startIdleTick() {
  if (tickTimer != null) return;
  tickTimer = window.setInterval(async () => {
    try {
      const r = await api<ApiMe>("/api/game/tick", { method: "POST" });
      state.me = r.me;
      await renderArena();
    } catch {}
  }, 10000);
}

function stopIdleTick() {
  if (tickTimer != null) {
    window.clearInterval(tickTimer);
    tickTimer = undefined;
  }
}

/* =========================================================
   DEV TOOLS (class reset, quest reset, stats, etc.)
   ========================================================= */

(function installDevTools() {
  const DEV_FLAG = true;
  if (!DEV_FLAG) return;

  const uid = userId || "guest";

  const devPanelId = "vaDevPanel";
  if (document.getElementById(devPanelId)) return;

  const panel = document.createElement("div");
  panel.id = devPanelId;
  panel.style.cssText = `
    position:fixed; left:16px; top:16px; z-index:99999;
    padding:6px 8px; border-radius:10px;
    background:rgba(0,0,0,.65); color:#ffeaa0;
    font:11px/1.4 ui-sans-serif,system-ui;
    display:flex; align-items:center; gap:4px;
  `;
  panel.innerHTML = `
    <span style="opacity:.8;">DEV</span>
    <input id="vaDevInput" type="text"
      placeholder="/help"
      style="min-width:180px; padding:4px 6px; border-radius:8px;
             border:1px solid rgba(212,169,77,.55);
             background:#0b0f12; color:#ffeaa0; font-size:11px;">
  `;
  document.body.appendChild(panel);

  const input = panel.querySelector<HTMLInputElement>("#vaDevInput");
  if (!input) return;

  function devSetLocalStat(stat: keyof Me, value: number) {
    if (!state.me) return;
    (state.me as any)[stat] = value;
    renderArena();
    log(`Dev: set ${stat} = ${value}`, "ok");
  }

  function devAddLocalStat(stat: keyof Me, delta: number) {
    if (!state.me) return;
    const cur = (state.me as any)[stat] ?? 0;
    const next = Number(cur) + delta;
    (state.me as any)[stat] = next;
    renderArena();
    log(`Dev: ${stat} ${delta >= 0 ? "+" : ""}${delta} → ${next}`, "ok");
  }

  function devResetClass() {
    const keys = [
      "va_class",
      `va_class__${uid}`,
      "va_class_name",
      `va_class_name__${uid}`,
      "va_hero_name",
      `va_hero_name__${uid}`,
    ];
    keys.forEach(k => localStorage.removeItem(k));
    log("Dev: class reset. Go back to class select to choose again.", "ok");
  }

  function devResetQuests() {
    const bases = ["va_quests", "va_vars", "va_race"];
    for (const base of bases) {
      localStorage.removeItem(base);
      localStorage.removeItem(`${base}__${uid}`);
    }
    try {
      (window as any).VAQ?.writeQuests?.([]);
      (window as any).VAQ?.renderHUD?.();
      window.dispatchEvent(new CustomEvent("va-quest-updated"));
    } catch {}
    log("Dev: quests & vars reset (will re-seed on next page).", "ok");
  }

  // 🔹 NEW: clear inventory helper
  function devResetInventory() {
    try {
      const keys = [
        "va_inventory",
        `va_inventory__${uid}`,
        "va_bag",
        `va_bag__${uid}`,
      ];
      for (const k of keys) localStorage.removeItem(k);

      const Inv = (window as any).Inventory;
      if (Inv?.clear) Inv.clear();
      else if (Inv?.reset) Inv.reset();
      else if (Inv?.setItems) Inv.setItems([]);

      window.dispatchEvent(new CustomEvent("va-inventory-changed"));
      log("Dev: inventory cleared.", "ok");
    } catch (e: any) {
      log("Dev: inventory clear failed: " + (e?.message || e), "bad");
    }
  }

  function devSetClass(id: string) {
    const v = id.toLowerCase();
    const allowed: ClassId[] = ["warrior", "shieldmaiden", "rune-mage", "berserker", "hunter"];
    if (!allowed.includes(v as ClassId)) {
      log("Dev: invalid class. Use warrior/shieldmaiden/rune-mage/berserker/hunter", "bad");
      return;
    }
    localStorage.setItem(`va_class__${uid}`, v);
    localStorage.setItem("va_class", v);
    log(`Dev: class set → ${v}`, "ok");
    updateAvatar();
    setupHeroAnim();
    // also refresh Yggdrasil path for new class
    refreshYggForCurrentHero();
  }

  function devWhere() {
    const path = window.location.pathname + window.location.search;
    const lastKey = `va_last_location__${uid}`;
    const stored = localStorage.getItem(lastKey) || "(none)";
    log(`Dev: here = ${path}`, "ok");
    log(`Dev: last_location (${lastKey}) = ${stored}`, "ok");
  }

  function devHelp() {
    log("Dev cmds:", "ok");
    log("/help", "ok");
    log("/set gold 99999 | /add gold 5000", "ok");
    log("/set level 50 | /set xp 1234 | /set points 50", "ok");
    log("/set power 500 /set defense 500 /set speed 500", "ok");
    log("/class warrior|shieldmaiden|rune-mage|berserker|hunter", "ok");
    log("/reset class  (clear class & hero name)", "ok");
    log("/reset quests (wipe quest chain/vars/race)", "ok");
    log("/reset inv    (empty inventory)", "ok");
    log("/tick off|on (idle backend tick)", "ok");
    log("/where (show path + last_location key)", "ok");
  }

  // --- shared helpers so VADev & text console use same logic ---
  function devSet(statKey: string, value: number) {
    if (!state.me) { log("No hero loaded yet.", "bad"); return; }
    const field = (statKey || "").toLowerCase();
    const map: Record<string, keyof Me> = {
      gold: "gold",
      level: "level",
      xp: "xp",
      points: "points",
      pow: "power",
      power: "power",
      def: "defense",
      defense: "defense",
      spd: "speed",
      speed: "speed",
      hp: "health",
      health: "health",
      bris: "brisingr",
      brisingr: "brisingr",
      dia: "diamonds",
      diamonds: "diamonds",
    };
    const key = map[field];
    if (!key) {
      log("Unknown stat. Use gold, level, xp, points, power, defense, speed, brisingr, diamonds.", "bad");
      return;
    }
    devSetLocalStat(key, value);
  }

  function devAdd(statKey: string, delta: number) {
    if (!state.me) { log("No hero loaded yet.", "bad"); return; }
    const field = (statKey || "").toLowerCase();
    const map: Record<string, keyof Me> = {
      gold: "gold",
      level: "level",
      xp: "xp",
      points: "points",
      pow: "power",
      power: "power",
      def: "defense",
      defense: "defense",
      spd: "speed",
      speed: "speed",
      bris: "brisingr",
      brisingr: "brisingr",
      dia: "diamonds",
      diamonds: "diamonds",
    };
    const key = map[field];
    if (!key) {
      log("Unknown stat. Use gold, level, xp, points, power, defense, speed, brisingr, diamonds.", "bad");
      return;
    }
    devAddLocalStat(key, delta);
  }

  function handleDevCommand(raw: string) {
    const txt = raw.trim();
    if (!txt) return;

    if (!txt.startsWith("/") && !txt.startsWith("dev ")) {
      log("Dev: commands should start with / (e.g. /help)", "bad");
      return;
    }

    const clean = txt.startsWith("/") ? txt.slice(1) : txt.replace(/^dev\s+/i, "");
    const parts = clean.split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();
    const arg1 = parts[1];
    const arg2 = parts[2];

    switch (cmd) {
      case "help":
        devHelp();
        break;

      case "set": {
        const val = Number(arg2);
        if (!arg1 || Number.isNaN(val)) {
          log("Usage: /set gold 99999", "bad");
          break;
        }
        devSet(arg1, val);
        break;
      }

      case "add": {
        const delta = Number(arg2);
        if (!arg1 || Number.isNaN(delta)) {
          log("Usage: /add gold 5000", "bad");
          break;
        }
        devAdd(arg1, delta);
        break;
      }

      case "class":
        if (!arg1) {
          log("Usage: /class warrior|shieldmaiden|rune-mage|berserker|hunter", "bad");
        } else {
          devSetClass(arg1);
        }
        break;

      case "reset": {
        const which = (arg1 || "").toLowerCase();
        if (which === "class") {
          devResetClass();
        } else if (which === "quests") {
          devResetQuests();
        } else if (which === "inv" || which === "inventory") {
          devResetInventory();
        } else {
          log("Usage: /reset class | /reset quests | /reset inv", "bad");
        }
        break;
      }

      case "tick": {
        const mode = (arg1 || "").toLowerCase();
        if (mode === "off") {
          stopIdleTick();
          log("Dev: idle tick stopped.", "ok");
        } else if (mode === "on") {
          startIdleTick();
          log("Dev: idle tick started.", "ok");
        } else {
          log("Usage: /tick off | /tick on", "bad");
        }
        break;
      }

      case "where":
        devWhere();
        break;

      default:
        log(`Dev: unknown cmd "${cmd}". Try /help`, "bad");
        break;
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value;
      input.value = "";
      handleDevCommand(val);
    } else if (e.key === "Escape") {
      input.blur();
    }
  });

  // Quick shortcut to focus dev input: Ctrl+Shift+D
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  // --- Expose VADev in the browser console ---
  const VADev = {
    help: devHelp,
    set: devSet,
    add: devAdd,
    class: devSetClass,
    resetClass: devResetClass,
    resetQuests: devResetQuests,
    resetInventory: devResetInventory,
    tick(mode: "on" | "off") {
      if (mode === "off") {
        stopIdleTick();
        log("Dev: idle tick stopped via VADev.tick().", "ok");
      } else {
        startIdleTick();
        log("Dev: idle tick started via VADev.tick().", "ok");
      }
    },
    where: devWhere,
  };

  (window as any).VADev = VADev;

  try {
    console.log(
      "%cValhalla Ascending DEV console ready.",
      "color:#ffeaa0;font-weight:bold;font-size:12px;"
    );
    console.log("Use %cVADev%c helpers or the on-screen /commands.", "color:#ffeaa0", "color:inherit");
    console.table?.([
      { command: "VADev.help()", desc: "Log dev command list into the in-game log" },
      { command: 'VADev.set("gold", 99999)', desc: "Set a stat directly" },
      { command: 'VADev.add("level", 5)', desc: "Add to a stat" },
      { command: 'VADev.class("shieldmaiden")', desc: "Force class" },
      { command: "VADev.resetClass()", desc: "Clear class + hero name" },
      { command: "VADev.resetQuests()", desc: "Wipe quests/vars/race" },
      { command: "VADev.resetInventory()", desc: "Empty inventory (local + UI)" },
      { command: 'VADev.tick("off")', desc: "Stop idle backend tick" },
      { command: "VADev.where()", desc: "Show current + last location" },
    ]);
  } catch {}

  log("Dev console ready. Press Ctrl+Shift+D or type /help", "ok");
})();


/* =========================================================
   BOOTSTRAP (no shop calls)
   ========================================================= */

async function boot() {
  if (!userId) return log("No user found.", "bad");

  const meRes = await api<ApiMe>("/api/game/me");
  state.me = meRes.me;

  // make sure hero HP in arena reflects shared global HP (from last battle)
  syncHeroStatsFromBackend(state.me);

  ensureAllocUI();
  updateAvatar();
  await renderArena();

  // Wiring
  safeEl("trainPower")?.addEventListener("click", () => train("power"));
  safeEl("trainDefense")?.addEventListener("click", () => train("defense"));
  safeEl("trainSpeed")?.addEventListener("click", () => train("speed"));

  // When the Yggdrasil modal opens, update it with current class skills.
  const yggIds = ["yggBtn", "yggdrasilBtn", "yggdrasilSkillBtn"];
  for (const id of yggIds) {
    const btn = safeEl<HTMLButtonElement>(id);
    if (btn) {
      btn.addEventListener("click", () => {
        // allow any modal code to run first
        setTimeout(() => applyYggDomFromState(), 0);
      });
      break;
    }
  }

  // optional custom event from other scripts
  window.addEventListener("va-ygg-open", () => {
    applyYggDomFromState();
  });

  // Idle tick every 10s (can be toggled via /tick off or VADev.tick("off"))
  startIdleTick();

  setupHeroAnim();
}

boot().catch(e => log(e.message, "bad"));













