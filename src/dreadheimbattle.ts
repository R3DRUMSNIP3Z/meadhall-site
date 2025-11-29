// --- Turn-based Battle: Dreadheim Forest Entrance ---
// NOTE: Include global-game-setup.ts and inventory bootstrap BEFORE this file on the page.

import { VAHeroRead, VAHeroWrite } from "./global-hero";

type Unit = {
  name: string;
  hp: number; hpMax: number;
  atk: number; def: number; spd: number;
  rage: number; rageMax: number;
  buffs: Record<string, number>;
  debuffs: Record<string, number>;
  alive: boolean;
};

type Battle = {
  state: "intro" | "player" | "enemy" | "end";
  turn: "player" | "enemy";
  log: string[];
};

// ---- class id + skill key types ----
type ClassId = "warrior" | "shieldmaiden" | "rune-mage" | "berserker" | "hunter";
type SkillKey = "basic" | "aoe" | "buff" | "debuff";

// =====================================================
//  MAP + SPRITES
// =====================================================
const bgUrl = "/guildbook/maps/dreadheimforestentrancebattle.png";

// ---- HERO ANIM URL RESOLVER (class-aware via getHeroAnimUrls) ----
function resolveHeroAnimUrls(kind: "idle" | "attackRight"): string[] {
  try {
    const pick = (window as any).getHeroAnimUrls as
      | undefined
      | ((kind: string) => string[] | undefined | null);

    if (typeof pick === "function") {
      const arr = pick(kind);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch {}

  // Fallback: gender-based default sprites
  const gender =
    localStorage.getItem("va_gender") === "female" ? "shieldmaiden" : "warrior";

  if (kind === "idle") {
    if (gender === "shieldmaiden") {
      const base = "/guildbook/avatars/shieldmaiden";
      return Array.from({ length: 9 }, (_, i) =>
        `${base}/sm_${String(i).padStart(3, "0")}.png`
      );
    } else {
      const base = "/guildbook/avatars/warrior";
      return Array.from({ length: 9 }, (_, i) =>
        `${base}/war_${String(i).padStart(3, "0")}.png`
      );
    }
  }

  // attackRight fallback
  if (gender === "shieldmaiden") {
    const base = "/guildbook/avatars/shieldmaiden";
    return Array.from({ length: 9 }, (_, i) =>
      `${base}/rightattack_${String(i).padStart(3, "0")}.png`
    );
  } else {
    const base = "/guildbook/avatars/warrior";
    return Array.from({ length: 9 }, (_, i) =>
      `${base}/war_${String(i).padStart(3, "0")}.png`
    );
  }
}

// animated attack loop for diseased boar
const BOAR_FRAME_URLS = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/enemies/diseasedboar/atk_${String(i).padStart(3, "0")}.png`
);

let HERO_IDLE_URLS: string[] = resolveHeroAnimUrls("idle");
let HERO_ATTACK_URLS: string[] = resolveHeroAnimUrls("attackRight");

const OVERWORLD_URL = "/dreadheimmap.html";
const LOBBY_URL = "/game.html";

// =====================================================
//  CANVAS
// =====================================================
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
function fit() {
  const dpr = Math.max(1, (window as any).devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fit();
window.addEventListener("resize", fit);

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.crossOrigin = "anonymous";
    i.onload = () => res(i); i.onerror = () => rej(new Error("Missing " + src));
    i.src = src;
  });
}

let bg: HTMLImageElement | null = null;

// animated frames
type HeroAnimName = "idle" | "attack";

let heroAnim: HeroAnimName = "idle";
let heroIdleFrames: HTMLImageElement[] = [];
let heroAttackFrames: HTMLImageElement[] = [];
let heroFrameIndex = 0;
let heroAnimTimer = 0; // ms remaining for attack anim

let enemyFrames: HTMLImageElement[] = [];
let enemyFrameIndex = 0;

const FRAME_MS = 100;
let frameTimer = 0;

// =====================================================
//  HUD HELPERS
// =====================================================
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pHP = el<HTMLSpanElement>("pHP"), pHPMax = el<HTMLSpanElement>("pHPMax");
const pRage = el<HTMLSpanElement>("pRage");
const pHPBar = el<HTMLDivElement>("pHPBar"), pRageBar = el<HTMLDivElement>("pRageBar");
const eHP = el<HTMLSpanElement>("eHP"), eHPMax = el<HTMLSpanElement>("eHPMax");
const eHPBar = el<HTMLDivElement>("eHPBar");
const logBox = el<HTMLDivElement>("log");
const overlay = el<HTMLDivElement>("overlay");

// === potion panel elements (may be null if HTML not present) ===
const potionSlotNameEl = document.getElementById("potionSlotName") as HTMLSpanElement | null;
const potionSlotIconEl = document.getElementById("potionSlotIcon") as HTMLImageElement | null;
const potionEquipBtn = document.getElementById("potionEquipBtn") as HTMLButtonElement | null;
const potionUseBtn = document.getElementById("potionUseBtn") as HTMLButtonElement | null;

// =====================================================
//  UNITS
// =====================================================
const player: Unit = {
  name: "You",
  // these are just defaults; they get overwritten by initPlayerFromHero()
  hp: 180,
  hpMax: 180,
  atk: 28, def: 10, spd: 12,
  rage: 0, rageMax: 100,
  buffs: {}, debuffs: {}, alive: true
};

const enemy: Unit = {
  name: "Diseased Boar", hp: 150, hpMax: 150,
  atk: 22, def: 8, spd: 10,
  rage: 0, rageMax: 100,
  buffs: {}, debuffs: {}, alive: true
};

// === SHARED HP GLUE (battle <-> global hero) ======================
function initPlayerFromHero() {
  try {
    const hero = VAHeroRead();
    let maxHealth = hero.maxHealth || hero.health || 180;
    if (!maxHealth || maxHealth <= 0) maxHealth = 180;

    let cur = hero.health;
    if (typeof cur !== "number" || cur <= 0) cur = maxHealth;

    if (cur > maxHealth) cur = maxHealth;

    player.hpMax = maxHealth;
    player.hp = cur;
  } catch {
    // if anything explodes, we just keep the defaults
  }
}

function persistPlayerHpToHero() {
  try {
    const prev = VAHeroRead();
    const maxHealth = prev.maxHealth || player.hpMax || prev.health || 180;
    let cur = player.hp;
    if (!Number.isFinite(cur)) cur = maxHealth;
    if (cur > maxHealth) cur = maxHealth;
    if (cur < 0) cur = 0;

    VAHeroWrite({
      ...prev,
      maxHealth,
      health: cur,
    });
  } catch {
    // ignore
  }
}

// =====================================================
//  CLASS-AWARE SKILLS (names + icons)
// =====================================================

// 1) figure out hero class for this battle (from localStorage)
function getCurrentClassForBattle(): ClassId {
  const raw = (localStorage.getItem("va_class") || "").toLowerCase();
  const allowed: ClassId[] = ["warrior", "shieldmaiden", "rune-mage", "berserker", "hunter"];
  if (allowed.includes(raw as ClassId)) return raw as ClassId;
  return "warrior";
}

const HERO_CLASS: ClassId = getCurrentClassForBattle();

// 2) per-class skill definitions (name/desc/icon/cost/cd)
//    Mechanics stay the same (basic = builder, aoe = hit, etc.)
//    but the LABELS + ICONS change by class.
type SkillDef = {
  name: string;
  desc: string;
  icon: string;
  cost: number;
  cd: number;
};

const CLASS_SKILLS: Record<ClassId, Record<SkillKey, SkillDef>> = {
  warrior: {
    basic: {
      name: "Drengr Strike",
      desc: "A solid strike that builds Rage.",
      icon: "/guildbook/skillicons/drengrstrike.png",
      cost: 0,
      cd: 0,
    },
    aoe: {
      name: "Storm of Blades",
      desc: "A raging flurry of steel (single target for now).",
      icon: "/guildbook/skillicons/whirlwinddance.png",
      cost: 30,
      cd: 2,
    },
    buff: {
      name: "Odin’s Blessing",
      desc: "Increases your ATK and DEF for 3 turns.",
      icon: "/guildbook/skillicons/odinsblessing.png",
      cost: 20,
      cd: 3,
    },
    debuff: {
      name: "Hel’s Grasp",
      desc: "Curses the enemy, lowering DEF and SPD for 3 turns.",
      icon: "/guildbook/skillicons/helsgrasp.png",
      cost: 20,
      cd: 3,
    },
  },

  shieldmaiden: {
    basic: {
      name: "Valkyrie Slash",
      desc: "Precise blow that builds Rage.",
      icon: "/guildbook/skillicons/valkyrieslash.png",
      cost: 0,
      cd: 0,
    },
    aoe: {
      name: "Ragnarok’s Howl",
      desc: "An echoing warcry slash (single target for now).",
      icon: "/guildbook/skillicons/ragnarokshowl.png",
      cost: 30,
      cd: 2,
    },
    buff: {
      name: "Aegis of Freyja",
      desc: "Sacred aura boosting ATK and DEF for 3 turns.",
      icon: "/guildbook/skillicons/aegisoffreyja.png",
      cost: 20,
      cd: 3,
    },
    debuff: {
      name: "Cursebreaker",
      desc: "Shatters enemy will, reducing DEF and SPD for 3 turns.",
      icon: "/guildbook/skillicons/cursebreaker.png",
      cost: 20,
      cd: 3,
    },
  },

  "rune-mage": {
    basic: {
      name: "Raudr Bolt",
      desc: "Runic blood-lightning that builds Rage.",
      icon: "/guildbook/skillicons/raudrbolt.png",
      cost: 0,
      cd: 0,
    },
    aoe: {
      name: "Ginnungagap Nova",
      desc: "A voidborn blast (single target for now).",
      icon: "/guildbook/skillicons/ginnungagapnova.png",
      cost: 30,
      cd: 2,
    },
    buff: {
      name: "Eikthyrnir Shield",
      desc: "Mythic stag-ward that bolsters ATK and DEF for 3 turns.",
      icon: "/guildbook/skillicons/eikthyrnirshield.png",
      cost: 20,
      cd: 3,
    },
    debuff: {
      name: "Nidhoggr’s Hex",
      desc: "Draconic rot that lowers enemy DEF and SPD for 3 turns.",
      icon: "/guildbook/skillicons/nidhoggrhex.png",
      cost: 20,
      cd: 3,
    },
  },

  berserker: {
    basic: {
      name: "Feral Slash",
      desc: "Savage cut that builds Rage.",
      icon: "/guildbook/skillicons/feralslash.png",
      cost: 0,
      cd: 0,
    },
    aoe: {
      name: "Ragequake",
      desc: "Earth-rending swing (single target for now).",
      icon: "/guildbook/skillicons/ragequake.png",
      cost: 30,
      cd: 2,
    },
    buff: {
      name: "Ulfhamr Trance",
      desc: "Battle-trance boosting ATK and DEF for 3 turns.",
      icon: "/guildbook/skillicons/ulfhamrtrance.png",
      cost: 20,
      cd: 3,
    },
    debuff: {
      name: "Blood Howl",
      desc: "Terrifying roar that reduces enemy DEF and SPD for 3 turns.",
      icon: "/guildbook/skillicons/bloodhowl.png",
      cost: 20,
      cd: 3,
    },
  },

  hunter: {
    basic: {
      name: "Piercing Shot",
      desc: "Aimed arrow that builds Rage.",
      icon: "/guildbook/skillicons/piercingshot.png",
      cost: 0,
      cd: 0,
    },
    aoe: {
      name: "Frostbite Volley",
      desc: "Volley of chilling arrows (single target for now).",
      icon: "/guildbook/skillicons/frostbitevolley.png",
      cost: 30,
      cd: 2,
    },
    buff: {
      name: "Skadi’s Focus",
      desc: "Icy hunter’s focus boosting ATK and DEF for 3 turns.",
      icon: "/guildbook/skillicons/skadisfocus.png",
      cost: 20,
      cd: 3,
    },
    debuff: {
      name: "Winter’s Grasp",
      desc: "Freezing curse, lowering DEF and SPD for 3 turns.",
      icon: "/guildbook/skillicons/wintersgrasp.png",
      cost: 20,
      cd: 3,
    },
  },
};

// pick the data for THIS hero
const CLASS_SKILL_SET = CLASS_SKILLS[HERO_CLASS];

// =====================================================
//  SKILLS (mechanics using class-aware labels/icons)
// =====================================================
const skills = {
  basic: {
    name: CLASS_SKILL_SET.basic.name,
    cost: CLASS_SKILL_SET.basic.cost,
    cd: CLASS_SKILL_SET.basic.cd,
    desc: CLASS_SKILL_SET.basic.desc,
    use: () => hit(player, enemy, 1.0, { addRage: 10 }),
  },
  aoe: {
    name: CLASS_SKILL_SET.aoe.name,
    cost: CLASS_SKILL_SET.aoe.cost,
    cd: CLASS_SKILL_SET.aoe.cd,
    desc: CLASS_SKILL_SET.aoe.desc,
    use: () => hit(player, enemy, 1.2),
  },
  buff: {
    name: CLASS_SKILL_SET.buff.name,
    cost: CLASS_SKILL_SET.buff.cost,
    cd: CLASS_SKILL_SET.buff.cd,
    desc: CLASS_SKILL_SET.buff.desc,
    use: () => addBuff(player, "bless", 3),
  },
  debuff: {
    name: CLASS_SKILL_SET.debuff.name,
    cost: CLASS_SKILL_SET.debuff.cost,
    cd: CLASS_SKILL_SET.debuff.cd,
    desc: CLASS_SKILL_SET.debuff.desc,
    use: () => addDebuff(enemy, "curse", 3),
  },
};

const cooldowns: Record<keyof typeof skills, number> = {
  basic: 0,
  aoe: 0,
  buff: 0,
  debuff: 0,
};
const unlocked: Record<keyof typeof skills, boolean> = {
  basic: true,
  aoe: false,
  buff: false,
  debuff: false,
};

// =====================================================
//  IMPACT / SHAKE / LUNGE
// =====================================================
let shakeMs = 0;
let shakeMag = 8;
let impactMs = 0;                 // timer for lunge (ms)
let impactWho: "player" | "enemy" | null = null;

const SPRITE = { pW: 180, pH: 180, eW: 180, eH: 180 };

function startImpact(who: "player" | "enemy") {
  impactWho = who;
  impactMs = 320;
  shakeMs = 160;
}
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }

// =====================================================
//  SFX
// =====================================================
function playBoarHurt(): void {
  const el = document.getElementById("boarHurt") as HTMLAudioElement | null;
  if (!el) return;
  el.currentTime = 0;
  el.volume = 0.85;
  el.play().catch(() => {});
}
function playFemaleHurt(): void {
  const el = document.getElementById("femaleHurt") as HTMLAudioElement | null;
  if (!el) return;
  el.currentTime = 0;
  el.volume = 0.9;
  el.play().catch(() => {});
}
function playMaleHurt(): void {
  const el = document.getElementById("maleHurt") as HTMLAudioElement | null;
  if (!el) return;
  el.currentTime = 0;
  el.volume = 0.9;
  el.play().catch(() => {});
}

// =====================================================
//  BATTLE CORE
// =====================================================
const battle: Battle = { state: "intro", turn: "player", log: [] };

function logMsg(s: string) { battle.log.push(s); renderLog(); }
function renderLog() {
  logBox.innerHTML = battle.log.slice(-5).map(x => `<div>${x}</div>`).join("");
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function rand(a: number, b: number) { return a + Math.random() * (b - a); }

function effAtk(u: Unit) { let a = u.atk; if (u.buffs.bless) a *= 1.20; return a; }
function effDef(u: Unit) { let d = u.def; if (u.buffs.bless) d *= 1.20; if (u.debuffs.curse) d *= 0.80; return d; }
function effSpd(u: Unit) { let s = u.spd; if (u.debuffs.curse) s *= 0.80; return s; }

function decideTurnOrder() {
  const p = effSpd(player);
  const e = effSpd(enemy);
  battle.turn = p >= e ? "player" : "enemy";
  battle.state = battle.turn;
  logMsg(battle.turn === "player" ? "You seize the initiative!" : `${enemy.name} strikes first!`);
  if (battle.turn === "enemy") setTimeout(enemyAct, 650);
}

function damage(from: Unit, to: Unit, scale = 1.0) {
  const base = effAtk(from) * scale - effDef(to) * 0.6;
  const jitter = rand(0.9, 1.1);
  return Math.max(1, Math.round(base * jitter));
}

function addBuff(u: Unit, name: keyof Unit["buffs"], turns: number) {
  u.buffs[name as string] = turns;
  logMsg(`${u.name} gains ${name.toString().toUpperCase()} for ${turns} turns!`);
}
function addDebuff(u: Unit, name: keyof Unit["debuffs"], turns: number) {
  u.debuffs[name as string] = turns;
  logMsg(`${u.name} suffers ${name.toString().toUpperCase()} for ${turns} turns!`);
}

function tickAuras(u: Unit) {
  for (const k of Object.keys(u.buffs)) {
    u.buffs[k]--;
    if (u.buffs[k] <= 0) { delete u.buffs[k]; logMsg(`${u.name}'s ${k} fades.`); }
  }
  for (const k of Object.keys(u.debuffs)) {
    u.debuffs[k]--;
    if (u.debuffs[k] <= 0) { delete u.debuffs[k]; logMsg(`${u.name}'s ${k} wears off.`); }
  }
}

// trigger hero attack anim (one full loop then back to idle)
function triggerHeroAttackAnim() {
  heroAnim = "attack";
  heroFrameIndex = 0;
  heroAnimTimer = HERO_ATTACK_URLS.length * FRAME_MS;
}

function hit(from: Unit, to: Unit, scale = 1.0, opts: { addRage?: number } = {}) {
  const dmg = damage(from, to, scale);
  to.hp = clamp(to.hp - dmg, 0, to.hpMax);

  // sounds
  if (to === enemy) {
    playBoarHurt();
  } else if (to === player) {
    const gender = localStorage.getItem("va_gender");
    if (gender === "female") playFemaleHurt();
    else playMaleHurt();
  }

  // hero attack anim when player hits
  if (from === player) {
    triggerHeroAttackAnim();
  }

  if (opts.addRage) from.rage = clamp(from.rage + opts.addRage, 0, from.rageMax);
  from.rage = clamp(from.rage + 5, 0, from.rageMax);

  enemy.alive = enemy.hp > 0;
  player.alive = player.hp > 0;

  logMsg(`${from.name} hits ${to.name} for ${dmg}.`);
  startImpact(from === player ? "player" : "enemy");
}

function decCooldowns() {
  (Object.keys(cooldowns) as (keyof typeof cooldowns)[]).forEach(k => {
    if (cooldowns[k] > 0) cooldowns[k]--;
  });
}

function canUse(key: keyof typeof skills) {
  if (!unlocked[key]) return { ok: false, why: "locked" };
  if (cooldowns[key] > 0) return { ok: false, why: "cd" };
  if (player.rage < skills[key].cost) return { ok: false, why: "rage" };
  return { ok: true, why: "" };
}

function useSkill(key: keyof typeof skills) {
  const chk = canUse(key);
  if (!chk.ok) return;
  const s = skills[key];
  player.rage -= s.cost;
  if (s.cd) cooldowns[key] = s.cd;
  s.use();
  updateHUD();
  checkEndOrEnemyTurn();
}

function checkEndOrEnemyTurn() {
  if (!enemy.alive) { endBattle(true); return; }
  battle.turn = "enemy"; battle.state = "enemy";
  setTimeout(enemyAct, 650);
}

function enemyAct() {
  hit(enemy, player, 1.0);
  updateHUD();
  if (!player.alive) { endBattle(false); return; }
  tickAuras(player); tickAuras(enemy);
  decCooldowns();
  battle.turn = "player"; battle.state = "player";
}

function endBattle(playerWon: boolean) {
  battle.state = "end";
  overlay.classList.add("show");
  overlay.textContent = playerWon ? "VICTORY" : "DEFEAT";

  // 🔥 persist HP back into global hero so next battle/arena uses it
  persistPlayerHpToHero();

  try {
    if (playerWon) (window as any).playVictory?.();
    else (window as any).playDefeat?.();
  } catch {}

  try { skillEls.forEach(d => d.style.pointerEvents = "none"); } catch {}

  if (playerWon) {
    try { localStorage.setItem("va_bf_boar_defeated", "1"); } catch {}
  }

  const btn = document.createElement("button");
  btn.textContent = "Leave Battle";
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "40px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "linear-gradient(180deg,#222,#111)",
    color: "#d4a94d",
    border: "1px solid rgba(212,169,77,.4)",
    borderRadius: "10px",
    padding: "12px 28px",
    fontFamily: "'Cinzel', serif",
    fontSize: "18px",
    cursor: "pointer",
    boxShadow: "0 0 10px rgba(0,0,0,.6)",
    zIndex: "10000"
  } as CSSStyleDeclaration);

  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Leaving...";
    const target = playerWon ? OVERWORLD_URL : LOBBY_URL;
    window.location.href = target;
  });

  document.body.appendChild(btn);
}

// =====================================================
//  UI WIRING (SKILLS)
// =====================================================
const skillEls = Array.from(document.querySelectorAll<HTMLDivElement>("#skillbar .skill"));

// icons now come from CLASS_SKILL_SET too
const SKILL_ICON: Record<keyof typeof skills, string> = {
  basic: CLASS_SKILL_SET.basic.icon,
  aoe:   CLASS_SKILL_SET.aoe.icon,
  buff:  CLASS_SKILL_SET.buff.icon,
  debuff:CLASS_SKILL_SET.debuff.icon,
};

function ensureSkillIcons() {
  skillEls.forEach(div => {
    const key = div.dataset.skill as keyof typeof skills;
    if (!key) return;

    // ensure we have a label element for the name
    let label =
      (div.querySelector(".label") as HTMLElement | null) ||
      (div.querySelector(".name") as HTMLElement | null);

    if (!label) {
      label = document.createElement("div");
      label.className = "label";
      div.appendChild(label);
    }
    label.textContent = skills[key].name;

    // add / update icon
    let img = div.querySelector("img.icon") as HTMLImageElement | null;
    if (!img) {
      img = document.createElement("img");
      img.className = "icon";
      div.insertBefore(img, div.firstChild);
    }
    img.alt = skills[key]?.name || key;
    img.src = SKILL_ICON[key] || "";
    img.loading = "lazy";
    img.onerror = () => { img.style.display = "none"; };
  });
}
ensureSkillIcons();

skillEls.forEach(div => {
  div.addEventListener("click", () => {
    if (battle.state !== "player") return;
    const key = div.dataset.skill as keyof typeof skills;
    useSkill(key);
    paintSkillBar();
  });
});

function paintSkillBar() {
  skillEls.forEach(div => {
    const key = div.dataset.skill as keyof typeof skills;
    div.classList.toggle("locked", !unlocked[key]);
    div.classList.toggle("oncd", cooldowns[key] > 0);

    if (cooldowns[key] > 0) {
      div.style.opacity = "0.7";
      div.title = `${skills[key].name} — CD ${cooldowns[key]} turn(s)`;
    } else {
      div.style.opacity = "1";
      div.title = skills[key].name + (skills[key].cost ? ` — Rage ${skills[key].cost}` : "");
    }

    // keep label synced in case hero class changed between loads
    let label =
      (div.querySelector(".label") as HTMLElement | null) ||
      (div.querySelector(".name") as HTMLElement | null);

    if (!label) {
      label = document.createElement("div");
      label.className = "label";
      div.appendChild(label);
    }
    label.textContent = skills[key].name;
  });
}

// =====================================================
//  HUD
// =====================================================
function updateHUD() {
  pHP.textContent = String(player.hp);
  pHPMax.textContent = String(player.hpMax);
  pRage.textContent = String(player.rage);
  pHPBar.style.width = `${(player.hp / player.hpMax) * 100}%`;
  pRageBar.style.width = `${(player.rage / player.rageMax) * 100}%`;
  eHP.textContent = String(enemy.hp);
  eHPMax.textContent = String(enemy.hpMax);
  eHPBar.style.width = `${(enemy.hp / enemy.hpMax) * 100}%`;
}

// =====================================================
//  POTION / INVENTORY BRIDGE + EQUIPPED POTION UI
// =====================================================
type SimpleInvItem = { id: string; name: string; icon: string; qty: number };

function readInventoryItems(): SimpleInvItem[] {
  try {
    const inv: any = (window as any).Inventory;
    const arr = inv?.get?.();
    if (Array.isArray(arr)) return arr as SimpleInvItem[];
  } catch {}
  return [];
}

function countItem(inv: SimpleInvItem[], id: string): number {
  let sum = 0;
  for (const it of inv) {
    if (it.id === id) sum += Number(it.qty || 0);
  }
  return sum;
}

function isPotionItem(it: SimpleInvItem): boolean {
  const id = (it.id || "").toLowerCase();
  const name = (it.name || "").toLowerCase();
  return id.includes("potion") || name.includes("potion");
}

// heal amount per potion type (extend later as you add more)
function getPotionHealAmount(id: string): number {
  switch (id) {
    case "health_potion": // Minor Health Potion
      return 50;
    default:
      return 0;
  }
}

type EquippedPotion = {
  id: string;
  name: string;
  icon: string;
  heal: number;
};

let equippedPotion: EquippedPotion | null = null;

function updatePotionSlotUI() {
  const inv = readInventoryItems();
  if (!potionSlotNameEl || !potionSlotIconEl || !potionUseBtn) return;

  if (equippedPotion) {
    const count = countItem(inv, equippedPotion.id);
    const baseName = equippedPotion.name;
    potionSlotNameEl.textContent = count > 0
      ? `${baseName} (${count})`
      : `${baseName} (0)`;
    potionSlotIconEl.src = equippedPotion.icon || "/guildbook/props/wizardshouseprops/healthpotion1.gif";
    potionSlotIconEl.style.visibility = "visible";
    potionUseBtn.disabled = count <= 0;
  } else {
    potionSlotNameEl.textContent = "None equipped";
    potionSlotIconEl.style.visibility = "hidden";
    potionUseBtn.disabled = true;
  }
}

let potionEquipOverlay: HTMLDivElement | null = null;

function ensurePotionEquipOverlay(): HTMLDivElement {
  if (potionEquipOverlay) return potionEquipOverlay;
  const ov = document.createElement("div");
  ov.id = "vaPotionEquipOverlay";
  ov.style.cssText = `
    position:fixed; inset:0; z-index:100000;
    background:rgba(0,0,0,.65);
    display:none; align-items:center; justify-content:center;
  `;
  ov.innerHTML = `
    <div style="
      width:min(520px, 94vw);
      max-height:min(70vh, 520px);
      background:#0f1318;
      border-radius:16px;
      border:1px solid rgba(212,169,77,.35);
      box-shadow:0 26px 60px rgba(0,0,0,.7);
      color:#e7d7ab;
      padding:12px;
      display:flex;
      flex-direction:column;
      gap:8px;
      font-family:'Cinzel',serif;
    ">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:900;font-size:16px;">Equip Battle Potion</div>
        <button id="vaPotionEquipClose" style="
          padding:4px 9px;border-radius:9px;border:1px solid rgba(212,169,77,.4);
          background:#12161a;color:#e7d7ab;cursor:pointer;font-size:11px;
        ">✖</button>
      </div>
      <div style="font-size:12px;opacity:.8;">Choose a potion from your bag to place in the battle slot.</div>
      <div id="vaPotionEquipList" style="
        flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;
        padding-right:2px;
      "></div>
    </div>
  `;
  document.body.appendChild(ov);
  potionEquipOverlay = ov;

  (ov.querySelector("#vaPotionEquipClose") as HTMLButtonElement).onclick = () => closePotionEquipOverlay();
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closePotionEquipOverlay();
  });

  return ov;
}

function openPotionEquipOverlay() {
  const ov = ensurePotionEquipOverlay();
  const list = ov.querySelector("#vaPotionEquipList") as HTMLDivElement;
  list.innerHTML = `<div style="font-size:12px;opacity:.75;">Loading potions…</div>`;
  ov.style.display = "flex";

  const items = readInventoryItems();
  const pots = items.filter(isPotionItem).filter(it => it.qty > 0);

  if (!pots.length) {
    list.innerHTML = `<div style="font-size:13px;opacity:.8;">You have no potions in your bag.</div>`;
    return;
  }

  list.innerHTML = "";
  for (const it of pots) {
    const heal = getPotionHealAmount(it.id);
    const card = document.createElement("div");
    card.style.cssText = `
      border-radius:12px;
      border:1px solid rgba(212,169,77,.3);
      background:radial-gradient(circle at top,#181c22,#0a0d10);
      padding:8px 9px;
      display:flex;
      gap:8px;
      align-items:center;
      font-size:12px;
    `;
    card.innerHTML = `
      <img src="${it.icon}" alt="${it.name}" style="width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 1px 4px rgba(0,0,0,.7))">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;font-size:13px;">${it.name}</div>
        <div style="opacity:.85;">Qty: ${it.qty}</div>
        <div style="opacity:.7;font-size:11px;">${heal > 0 ? `Restores ${heal} HP in battle.` : `No battle effect yet.`}</div>
      </div>
    `;
    const btn = document.createElement("button");
    btn.textContent = "Equip";
    btn.style.cssText = `
      padding:5px 9px;border-radius:9px;border:1px solid rgba(212,169,77,.6);
      background:#171c23;color:#f3e3b5;cursor:pointer;font-size:11px;
    `;
    btn.onclick = () => {
      equippedPotion = {
        id: it.id,
        name: it.name,
        icon: it.icon,
        heal,
      };
      logMsg(`Equipped ${it.name} as your battle potion.`);
      updatePotionSlotUI();
      closePotionEquipOverlay();
    };
    card.appendChild(btn);
    list.appendChild(card);
  }
}

function closePotionEquipOverlay() {
  if (potionEquipOverlay) potionEquipOverlay.style.display = "none";
}

function useEquippedPotionInBattle() {
  if (!equippedPotion) {
    logMsg("No potion equipped. Click Equip to choose one from your bag.");
    return;
  }
  if (battle.state !== "player" || battle.turn !== "player") return;
  if (!player.alive) return;

  if (player.hp >= player.hpMax) {
    logMsg("You are already at full health.");
    return;
  }

  const invAny: any = (window as any).Inventory;
  let hasAny = false;
  try {
    if (invAny && typeof invAny.has === "function") {
      hasAny = invAny.has(equippedPotion.id, 1);
    } else {
      const items = readInventoryItems();
      hasAny = countItem(items, equippedPotion.id) > 0;
    }
  } catch {
    const items = readInventoryItems();
    hasAny = countItem(items, equippedPotion.id) > 0;
  }

  if (!hasAny) {
    logMsg(`You have no ${equippedPotion.name} left in your bag.`);
    updatePotionSlotUI();
    return;
  }

  const healAmount = equippedPotion.heal;
  if (healAmount <= 0) {
    logMsg(`${equippedPotion.name} has no effect in battle (yet).`);
    return;
  }

  // consume from inventory
  try {
    if (invAny && typeof invAny.consume === "function") {
      invAny.consume(equippedPotion.id, 1);
    }
  } catch {}

  const healed = Math.min(healAmount, player.hpMax - player.hp);
  player.hp += healed;
  logMsg(`You drink ${equippedPotion.name} and recover ${healed} HP.`);
  updateHUD();
  updatePotionSlotUI();

  // spending your turn → enemy acts
  if (!enemy.alive) {
    endBattle(true);
  } else {
    battle.turn = "enemy";
    battle.state = "enemy";
    setTimeout(enemyAct, 650);
  }
}

function wirePotionUI() {
  updatePotionSlotUI();
  if (potionEquipBtn) {
    potionEquipBtn.onclick = () => openPotionEquipOverlay();
  }
  if (potionUseBtn) {
    potionUseBtn.onclick = () => useEquippedPotionInBattle();
  }
}

// =====================================================
//  LOOP & RENDER
// =====================================================
let lastTs = 0;
function getDtMs(ts: number) {
  if (!lastTs) { lastTs = ts; return 0; }
  const dt = ts - lastTs; lastTs = ts; return dt;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // camera shake
  let sx = 0, sy = 0;
  if (shakeMs > 0) {
    const t = shakeMs / 160;
    const m = shakeMag * t;
    sx = (Math.random() * 2 - 1) * m;
    sy = (Math.random() * 2 - 1) * m;
  }
  ctx.save();
  ctx.translate(sx, sy);

  const skillbarReserve = 110;
  const groundY = Math.round(window.innerHeight - skillbarReserve);

  const { pW, pH, eW, eH } = SPRITE;
  const pBaseX = 120, pBaseY = groundY - pH - 30;
  const eBaseX = window.innerWidth - eW - 120, eBaseY = groundY - eH;

  let pX = pBaseX, pY = pBaseY;
  let eX = eBaseX, eY = eBaseY;

  // === Lunge so they actually TOUCH ===
  if (impactMs > 0 && impactWho) {
    const tNorm = 1 - (impactMs / 320);
    const f = easeOutCubic(tNorm <= 0 ? 0 : tNorm >= 1 ? 1 : tNorm);

    if (impactWho === "player") {
      const targetPX = eBaseX - pW * 0.6;  // overlap ~40%
      pX = pBaseX + (targetPX - pBaseX) * f;
      eX = eBaseX + 20 * f;               // tiny knockback to the right
    } else {
      const targetEX = pBaseX + pW * 0.3; // overlap a bit into hero
      eX = eBaseX - (eBaseX - targetEX) * f;
      pX = pBaseX - 15 * f;               // tiny knockback to the left
    }
  }

  // choose hero frame based on current anim
  const heroFrames = (heroAnim === "attack" && heroAttackFrames.length)
    ? heroAttackFrames
    : heroIdleFrames;

  const pImg = heroFrames.length
    ? heroFrames[heroFrameIndex % heroFrames.length]
    : null;
  if (pImg) ctx.drawImage(pImg, pX, pY, pW, pH);
  else { ctx.fillStyle = "#111"; ctx.fillRect(pX, pY, pW, pH); }

  // animated enemy boar (facing left)
  const eImg = enemyFrames.length
    ? enemyFrames[enemyFrameIndex % enemyFrames.length]
    : null;
  if (eImg) {
    ctx.save();
    ctx.translate(eX + eW / 2, eY + eH / 2);
    ctx.scale(-1, 1);
    ctx.drawImage(eImg, -eW / 2, -eH / 2, eW, eH);
    ctx.restore();
  } else {
    ctx.fillStyle = "rgba(10,10,10,.85)";
    ctx.fillRect(eX, eY, eW, eH);
  }

  ctx.restore();
}

function gameLoop(ts: number) {
  const dt = getDtMs(ts);
  if (shakeMs > 0) shakeMs = Math.max(0, shakeMs - dt);
  if (impactMs > 0) impactMs = Math.max(0, impactMs - dt);
  if (impactMs === 0) impactWho = null;

  // hero attack timer
  if (heroAnim === "attack") {
    heroAnimTimer -= dt;
    if (heroAnimTimer <= 0) {
      heroAnim = "idle";
      heroFrameIndex = 0;
    }
  }

  // advance animation frames
  frameTimer += dt;
  if (frameTimer >= FRAME_MS) {
    frameTimer -= FRAME_MS;
    // hero
    const heroFrames = (heroAnim === "attack" && heroAttackFrames.length)
      ? heroAttackFrames
      : heroIdleFrames;
    if (heroFrames.length) heroFrameIndex = (heroFrameIndex + 1) % heroFrames.length;
    // enemy
    if (enemyFrames.length) enemyFrameIndex = (enemyFrameIndex + 1) % enemyFrames.length;
  }

  render();
  requestAnimationFrame(gameLoop);
}

// =====================================================
//  HERO ANIM RELOAD ON CHARACTER CHANGE
// =====================================================
function refreshHeroAnimSets() {
  try {
    HERO_IDLE_URLS = resolveHeroAnimUrls("idle");
    HERO_ATTACK_URLS = resolveHeroAnimUrls("attackRight");
    Promise.all([
      ...HERO_IDLE_URLS.map(loadImage),
      ...HERO_ATTACK_URLS.map(loadImage),
    ])
      .then(frames => {
        const idleCount = HERO_IDLE_URLS.length;
        heroIdleFrames = frames.slice(0, idleCount);
        heroAttackFrames = frames.slice(idleCount);
        heroAnim = "idle";
        heroFrameIndex = 0;
      })
      .catch(() => {});
  } catch {}
}

// support both generic and older gender-only events
window.addEventListener("va-hero-changed", refreshHeroAnimSets);
window.addEventListener("va-gender-changed", refreshHeroAnimSets);

// =====================================================
//  BOOT
// =====================================================
Promise.all([
  loadImage(bgUrl),
  ...HERO_IDLE_URLS.map(loadImage),
  ...HERO_ATTACK_URLS.map(loadImage),
  ...BOAR_FRAME_URLS.map(loadImage),
])
  .then((imgs) => {
    let idx = 0;
    bg = imgs[idx++];

    const idleCount = HERO_IDLE_URLS.length;
    const attackCount = HERO_ATTACK_URLS.length;

    heroIdleFrames = imgs.slice(idx, idx + idleCount);
    idx += idleCount;

    heroAttackFrames = imgs.slice(idx, idx + attackCount);
    idx += attackCount;

    const boarCount = BOAR_FRAME_URLS.length;
    enemyFrames = imgs.slice(idx, idx + boarCount);

    requestAnimationFrame(gameLoop);
  })
  .catch(() => { requestAnimationFrame(gameLoop); });

// initial state
initPlayerFromHero();
logMsg("A hostile presence emerges from the forest...");
updateHUD();
ensureSkillIcons();  // make sure labels/icons use class data
paintSkillBar();
wirePotionUI();
decideTurnOrder();














