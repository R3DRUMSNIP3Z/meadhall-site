// --- Turn-based Battle: Dreadheim Forest Entrance ---
// NOTE: Include global-game-setup.ts BEFORE this file on the page.

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
  state: "intro"|"player"|"enemy"|"end";
  turn: "player"|"enemy";
  log: string[];
};

// Map + sprites
const bgUrl = "/guildbook/maps/dreadheimforestentrancebattle.png";



// ---- HERO + BOAR ANIMATION FRAME URLS ----
function buildHeroFrameUrls(): string[] {
  const gender = localStorage.getItem("va_gender") === "female" ? "shieldmaiden" : "warrior";
  const prefix = gender === "shieldmaiden" ? "sm_" : "war_";
  const base   = `/guildbook/avatars/${gender}`;
  return Array.from({ length: 9 }, (_, i) =>
    `${base}/${prefix}${String(i).padStart(3, "0")}.png`
  );
}

// animated attack loop for diseased boar
const BOAR_FRAME_URLS = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/enemies/diseasedboar/atk_${String(i).padStart(3, "0")}.png`
);

// this will be mutated when gender changes
let HERO_FRAME_URLS = buildHeroFrameUrls();

const OVERWORLD_URL = "/dreadheimmap.html";
const LOBBY_URL = "/game.html";

// ===== Canvas & background render =====
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
function fit() {
  const dpr = Math.max(1, (window as any).devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px"; canvas.style.height = h + "px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
fit(); window.addEventListener("resize", fit);

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.crossOrigin = "anonymous";
    i.onload = () => res(i); i.onerror = () => rej(new Error("Missing "+src));
    i.src = src;
  });
}

let bg: HTMLImageElement|null = null;

// animated frames
let playerFrames: HTMLImageElement[] = [];
let enemyFrames: HTMLImageElement[]  = [];
let playerFrameIndex = 0;
let enemyFrameIndex  = 0;
const FRAME_MS = 100;
let frameTimer = 0;

// ===== Simple HUD helpers =====
const el = <T extends HTMLElement>(id: string)=>document.getElementById(id) as T;
const pHP = el<HTMLSpanElement>("pHP"), pHPMax = el<HTMLSpanElement>("pHPMax");
const pRage = el<HTMLSpanElement>("pRage");
const pHPBar = el<HTMLDivElement>("pHPBar"), pRageBar = el<HTMLDivElement>("pRageBar");
const eHP = el<HTMLSpanElement>("eHP"), eHPMax = el<HTMLSpanElement>("eHPMax");
const eHPBar = el<HTMLDivElement>("eHPBar");
const logBox = el<HTMLDivElement>("log");
const overlay = el<HTMLDivElement>("overlay");

// ===== Units =====
const player: Unit = {
  name:"You", hp: 180, hpMax: 180,
  atk: 28, def: 10, spd: 12,
  rage: 0, rageMax: 100,
  buffs:{}, debuffs:{}, alive:true
};

const enemy: Unit = {
  name:"Diseased Boar", hp: 150, hpMax: 150,
  atk: 22, def: 8, spd: 10,
  rage: 0, rageMax: 100,
  buffs:{}, debuffs:{}, alive:true
};

// ===== Skills =====
const skills = {
  basic: { name:"Drengr Strike",  cost:0,  cd:0,  desc:"+10 Rage builder",  use: () => hit(player, enemy, 1.0, {addRage:10}) },
  aoe:   { name:"Storm of Blades",cost:30, cd:2,  desc:"AOE (single for now)", use: () => hit(player, enemy, 1.2) },
  buff:  { name:"Odin’s Blessing",cost:20, cd:3,  desc:"+ATK +DEF 3 turns",   use: () => addBuff(player,"bless",3) },
  debuff:{ name:"Hel’s Curse",     cost:20, cd:3,  desc:"Enemy -DEF -SPD 3t",  use: () => addDebuff(enemy,"curse",3) },
};
const cooldowns: Record<keyof typeof skills, number> = { basic:0, aoe:0, buff:0, debuff:0 };
const unlocked: Record<keyof typeof skills, boolean> = { basic:true, aoe:false, buff:false, debuff:false };

// --- Impact + camera shake + lunge state ---
let shakeMs = 0;
let shakeMag = 8;
let impactMs = 0;                 // timer for lunge (ms)
let impactWho: "player"|"enemy"|null = null;

const SPRITE = { pW: 180, pH: 180, eW: 180, eH: 180 };

function startImpact(who: "player" | "enemy") {
  impactWho = who;
  impactMs = 320;   // longer to clearly reach target and return
  shakeMs = 160;
}
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }

// === SFX helpers ===
function playBoarHurt(): void {
  const el = document.getElementById("boarHurt") as HTMLAudioElement | null;
  if (!el) return;
  el.currentTime = 0;   // restart if already playing
  el.volume = 0.85;
  el.play().catch(() => {}); // ignore autoplay promise errors
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

// ===== Battle Core =====
const battle: Battle = { state:"intro", turn:"player", log:[] };

function log(s: string){ battle.log.push(s); renderLog(); }
function renderLog(){
  logBox.innerHTML = battle.log.slice(-5).map(x=>`<div>${x}</div>`).join("");
}

function clamp(n:number,min:number,max:number){ return Math.max(min, Math.min(max, n)); }
function rand(a:number,b:number){ return a + Math.random()*(b-a); }

function effAtk(u:Unit){ let a = u.atk; if (u.buffs.bless) a *= 1.20; return a; }
function effDef(u:Unit){ let d = u.def; if (u.buffs.bless) d *= 1.20; if (u.debuffs.curse) d *= 0.80; return d; }
function effSpd(u:Unit){ let s = u.spd; if (u.debuffs.curse) s *= 0.80; return s; }

function decideTurnOrder() {
  const p = effSpd(player);
  const e = effSpd(enemy);
  battle.turn  = p >= e ? "player" : "enemy";
  battle.state = battle.turn;
  log(battle.turn === "player" ? "You seize the initiative!" : `${enemy.name} strikes first!`);
  if (battle.turn === "enemy") setTimeout(enemyAct, 650);
}

function damage(from:Unit,to:Unit,scale=1.0){
  const base = effAtk(from)*scale - effDef(to)*0.6;
  const jitter = rand(0.9,1.1);
  return Math.max(1, Math.round(base*jitter));
}

function addBuff(u:Unit, name:keyof Unit["buffs"], turns:number){
  u.buffs[name as string] = turns;
  log(`${u.name} gains ${name.toUpperCase()} for ${turns} turns!`);
}
function addDebuff(u:Unit, name:keyof Unit["debuffs"], turns:number){
  u.debuffs[name as string] = turns;
  log(`${u.name} suffers ${name.toUpperCase()} for ${turns} turns!`);
}

function tickAuras(u:Unit){
  for (const k of Object.keys(u.buffs)) {
    u.buffs[k]--;
    if (u.buffs[k] <= 0) { delete u.buffs[k]; log(`${u.name}'s ${k} fades.`); }
  }
  for (const k of Object.keys(u.debuffs)) {
    u.debuffs[k]--;
    if (u.debuffs[k] <= 0) { delete u.debuffs[k]; log(`${u.name}'s ${k} wears off.`); }
  }
}

function hit(from: Unit, to: Unit, scale = 1.0, opts: { addRage?: number } = {}) {
  const dmg = damage(from, to, scale);
  to.hp = clamp(to.hp - dmg, 0, to.hpMax);

  // === Play hurt sounds based on who was hit ===
  if (to === enemy) {
    // Boar is the target
    playBoarHurt();
  } else if (to === player) {
    // Player is the target — choose male/female
    const gender = localStorage.getItem("va_gender");
    if (gender === "female") playFemaleHurt();
    else playMaleHurt();
  }

  if (opts.addRage) from.rage = clamp(from.rage + opts.addRage, 0, from.rageMax);
  from.rage = clamp(from.rage + 5, 0, from.rageMax);

  enemy.alive = enemy.hp > 0;
  player.alive = player.hp > 0;

  log(`${from.name} hits ${to.name} for ${dmg}.`);
  startImpact(from === player ? "player" : "enemy");
}

function decCooldowns(){
  (Object.keys(cooldowns) as (keyof typeof cooldowns)[]).forEach(k=>{
    if (cooldowns[k] > 0) cooldowns[k]--;
  });
}

function canUse(key: keyof typeof skills){
  if (!unlocked[key]) return {ok:false, why:"locked"};
  if (cooldowns[key] > 0) return {ok:false, why:"cd"};
  if (player.rage < skills[key].cost) return {ok:false, why:"rage"};
  return {ok:true, why:""};
}

function useSkill(key: keyof typeof skills){
  const chk = canUse(key);
  if (!chk.ok) return;
  const s = skills[key];
  player.rage -= s.cost;
  if (s.cd) cooldowns[key] = s.cd;
  s.use();
  updateHUD();
  checkEndOrEnemyTurn();
}

function checkEndOrEnemyTurn(){
  if (!enemy.alive){ endBattle(true); return; }
  battle.turn = "enemy"; battle.state = "enemy";
  setTimeout(enemyAct, 650);
}

function enemyAct(){
  hit(enemy, player, 1.0);
  updateHUD();
  if (!player.alive){ endBattle(false); return; }
  tickAuras(player); tickAuras(enemy);
  decCooldowns();
  battle.turn = "player"; battle.state = "player";
}

function endBattle(playerWon: boolean) {
  battle.state = "end";
  overlay.classList.add("show");
  overlay.textContent = playerWon ? "VICTORY" : "DEFEAT";

  // --- Play end-of-battle sound
  try {
    if (playerWon) (window as any).playVictory?.();
    else (window as any).playDefeat?.();
  } catch {}

  // Disable further skill input
  try { skillEls.forEach(d => d.style.pointerEvents = "none"); } catch {}

  if (playerWon) {
    try { localStorage.setItem("va_bf_boar_defeated", "1"); } catch {}
  }

  // --- Add a "Leave Battle" button for BOTH outcomes
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
    const target = playerWon ? OVERWORLD_URL : LOBBY_URL; // win -> forest map, fail -> game.html
    window.location.href = target;
  });

  document.body.appendChild(btn);
}



// ===== UI wiring =====
const skillEls = Array.from(document.querySelectorAll<HTMLDivElement>("#skillbar .skill"));

// Map each skill to its icon (served from /public/guildbook/skillicons)
const SKILL_ICON: Record<keyof typeof skills, string> = {
  basic:  "/guildbook/skillicons/drengrstrike.png",   // Drengr Strike
  aoe:    "/guildbook/skillicons/whirlwinddance.png", // Storm of Blades
  buff:   "/guildbook/skillicons/odinsblessing.png",  // Odin’s Blessing
  debuff: "/guildbook/skillicons/helsgrasp.png",      // Hel’s Curse
};

// Inject icons once so the buttons show images
function ensureSkillIcons() {
  skillEls.forEach(div => {
    if (div.querySelector("img.icon")) return; // already injected
    const key = div.dataset.skill as keyof typeof skills;
    if (!key) return;
    const img = document.createElement("img");
    img.className = "icon";
    img.alt = skills[key]?.name || key;
    img.src = SKILL_ICON[key] || "";
    img.loading = "lazy";
    img.onerror = () => { img.style.display = "none"; }; // hide if missing
    div.insertBefore(img, div.firstChild);
  });
}
ensureSkillIcons();

// Click handlers
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

    // subtle dim while on cooldown
    if (cooldowns[key] > 0) {
      div.style.opacity = "0.7";
      div.title = `${skills[key].name} — CD ${cooldowns[key]} turn(s)`;
    } else {
      div.style.opacity = "1";
      div.title = skills[key].name + (skills[key].cost ? ` — Rage ${skills[key].cost}` : "");
    }
  });
}

// ===== HUD =====
function updateHUD(){
  pHP.textContent = String(player.hp);
  pHPMax.textContent = String(player.hpMax);
  pRage.textContent = String(player.rage);
  pHPBar.style.width = `${(player.hp/player.hpMax)*100}%`;
  pRageBar.style.width = `${(player.rage/player.rageMax)*100}%`;
  eHP.textContent = String(enemy.hp);
  eHPMax.textContent = String(enemy.hpMax);
  eHPBar.style.width = `${(enemy.hp/enemy.hpMax)*100}%`;
}

// ===== Loop & Render =====
let lastTs = 0;
function getDtMs(ts: number) {
  if (!lastTs) { lastTs = ts; return 0; }
  const dt = ts - lastTs; lastTs = ts; return dt;
}

function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // camera shake
  let sx = 0, sy = 0;
  if (shakeMs > 0) {
    const t = shakeMs / 160;
    const m = shakeMag * t;
    sx = (Math.random()*2-1) * m;
    sy = (Math.random()*2-1) * m;
  }
  ctx.save();
  ctx.translate(sx, sy);

  // sit just above the skillbar (~110px tall) so feet touch the stones
  const skillbarReserve = 110;
  const groundY = Math.round(window.innerHeight - skillbarReserve);

  const { pW, pH, eW, eH } = SPRITE;
  const pBaseX = 120,                      pBaseY = groundY - pH - 30;
  const eBaseX = window.innerWidth - eW - 120, eBaseY = groundY - eH;

  // meeting point (move slightly closer together)
  const meetX = pBaseX + (eBaseX - pBaseX - pW) * 0.70;

  // lunge triangle 0..1..0
  function triangle(t:number){ return t < 0.5 ? (t/0.5) : (1 - (t-0.5)/0.5); }

  let pX = pBaseX, pY = pBaseY;
  let eX = eBaseX, eY = eBaseY;

  if (impactMs > 0 && impactWho) {
    const t = 1 - (impactMs / 320);
    const f = easeOutCubic(triangle(t));
    const pLunge = (meetX - pBaseX) * f;
    const eLunge = (eBaseX - (meetX + 0)) * f; // positive

    if (impactWho === "player") {
      pX = pBaseX + pLunge;              // player runs in
      eX = eBaseX + (-eLunge * 0.25);    // enemy tiny push
    } else {
      eX = eBaseX - eLunge;              // enemy runs in (toward left)
      pX = pBaseX - (pLunge * 0.25);     // player tiny push
    }
  }

  // draw player (animated)
  const pImg = playerFrames.length
    ? playerFrames[playerFrameIndex % playerFrames.length]
    : null;
  if (pImg) ctx.drawImage(pImg, pX, pY, pW, pH);
  else { ctx.fillStyle="#111"; ctx.fillRect(pX, pY, pW, pH); }

  // draw enemy boar (animated, facing left)
  const eImg = enemyFrames.length
    ? enemyFrames[enemyFrameIndex % enemyFrames.length]
    : null;
  if (eImg) {
    ctx.save();
    ctx.translate(eX + eW/2, eY + eH/2);
    ctx.scale(-1, 1);
    ctx.drawImage(eImg, -eW/2, -eH/2, eW, eH);
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

  // advance animation frames
  frameTimer += dt;
  if (frameTimer >= FRAME_MS) {
    frameTimer -= FRAME_MS;
    if (playerFrames.length) playerFrameIndex = (playerFrameIndex + 1) % playerFrames.length;
    if (enemyFrames.length)  enemyFrameIndex  = (enemyFrameIndex  + 1) % enemyFrames.length;
  }

  render();
  requestAnimationFrame(gameLoop);
}

// ===== Live hero sprite updates when gender changes =====
window.addEventListener("va-gender-changed", () => {
  try {
    HERO_FRAME_URLS = buildHeroFrameUrls();
    Promise.all(HERO_FRAME_URLS.map(loadImage))
      .then(frames => {
        playerFrames = frames;
        playerFrameIndex = 0;
      })
      .catch(() => {});
  } catch {}
});

// ===== Boot =====
Promise.all([
  loadImage(bgUrl),
  ...HERO_FRAME_URLS.map(loadImage),
  ...BOAR_FRAME_URLS.map(loadImage),
])
  .then((imgs) => {
    let idx = 0;
    bg = imgs[idx++];

    const heroCount = HERO_FRAME_URLS.length;
    playerFrames = imgs.slice(idx, idx + heroCount);
    idx += heroCount;

    const boarCount = BOAR_FRAME_URLS.length;
    enemyFrames = imgs.slice(idx, idx + boarCount);

    requestAnimationFrame(gameLoop);
  })
  .catch(()=>{ requestAnimationFrame(gameLoop); });

log("A hostile presence emerges from the forest...");
updateHUD();
paintSkillBar();
decideTurnOrder();





