// --- Turn-based Battle: Dreadheim Forest Entrance ---
type Unit = {
  name: string;
  hp: number; hpMax: number;
  atk: number; def: number; spd: number;
  rage: number; rageMax: number;
  buffs: Record<string, number>;   // { buffName: turnsRemaining }
  debuffs: Record<string, number>; // { debuffName: turnsRemaining }
  alive: boolean;
};

type Battle = {
  state: "intro"|"player"|"enemy"|"end";
  turn: "player"|"enemy";
  log: string[];
};

const bgUrl = "/guildbook/maps/dreadheimforestentrancebattle.png";
const playerSpriteUrl = "/guildbook/avatars/dreadheim-warrior.png";

// ===== Canvas & background render =====
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
function fit() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
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
let playerImg: HTMLImageElement|null = null;

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
  name:"Forest Raider", hp: 150, hpMax: 150,
  atk: 22, def: 8, spd: 10,
  rage: 0, rageMax: 100,
  buffs:{}, debuffs:{}, alive:true
};

// ===== Skill data (first is unlocked) =====
const skills = {
  basic: { name:"Drengr Strike",  cost:0,  cd:0,     desc:"+10 Rage builder",  use: () => hit(player, enemy, 1.0, {addRage:10}) },
  aoe:   { name:"Storm of Blades",cost:30, cd:2,     desc:"AOE (single for now)", use: () => hit(player, enemy, 1.2) },
  buff:  { name:"Odin’s Blessing",cost:20, cd:3,     desc:"+ATK +DEF 3 turns",   use: () => addBuff(player,"bless",3) },
  debuff:{ name:"Hel’s Curse",     cost:20, cd:3,     desc:"Enemy -DEF -SPD 3t",  use: () => addDebuff(enemy,"curse",3) },
};
const cooldowns: Record<keyof typeof skills, number> = { basic:0, aoe:0, buff:0, debuff:0 };
const unlocked: Record<keyof typeof skills, boolean> = { basic:true, aoe:false, buff:false, debuff:false }; // unlock later via tree

// ===== Battle Core =====
const battle: Battle = { state:"intro", turn:"player", log:[] };

function log(s: string){ battle.log.push(s); renderLog(); }
function renderLog(){
  logBox.innerHTML = battle.log.slice(-5).map(x=>`<div>${x}</div>`).join("");
}

function clamp(n:number,min:number,max:number){ return Math.max(min, Math.min(max, n)); }
function rand(a:number,b:number){ return a + Math.random()*(b-a); }

function effAtk(u:Unit){
  let a = u.atk;
  if (u.buffs.bless) a *= 1.20;
  return a;
}
function effDef(u:Unit){
  let d = u.def;
  if (u.buffs.bless) d *= 1.20;
  if (u.debuffs.curse) d *= 0.80;
  return d;
}
function effSpd(u:Unit){
  let s = u.spd;
  if (u.debuffs.curse) s *= 0.80;
  return s;
}
// Decide who gets the first turn based on speed
function decideTurnOrder() {
  const p = effSpd(player);
  const e = effSpd(enemy);
  battle.turn  = p >= e ? "player" : "enemy";
  battle.state = battle.turn;
  if (battle.turn === "enemy") {
    // enemy starts if faster
    setTimeout(enemyAct, 650);
  }
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

// Basic single-target hit with optional rage gain
function hit(from:Unit, to:Unit, scale=1.0, opts:{addRage?:number} = {}){
  const dmg = damage(from,to,scale);
  to.hp = clamp(to.hp - dmg, 0, to.hpMax);
  if (opts.addRage) from.rage = clamp(from.rage + opts.addRage, 0, from.rageMax);
  from.rage = clamp(from.rage + 5, 0, from.rageMax); // small rage on use
  enemy.alive = enemy.hp > 0;
  player.alive = player.hp > 0;
  log(`${from.name} hits ${to.name} for ${dmg}.`);
}

// Cooldowns decrement each *your* turn start
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
  // Simple AI: just hit
  hit(enemy, player, 1.0);
  updateHUD();
  if (!player.alive){ endBattle(false); return; }

  // Turn passes to player; start-of-turn upkeep
  tickAuras(player); tickAuras(enemy);
  decCooldowns();
  battle.turn = "player"; battle.state = "player";
}

function endBattle(playerWon:boolean){
  battle.state = "end";
  overlay.classList.add("show");
  overlay.textContent = playerWon ? "VICTORY" : "DEFEAT";
}

// ===== UI wiring (skill bar) =====
const skillEls = Array.from(document.querySelectorAll<HTMLDivElement>("#skillbar .skill"));
skillEls.forEach(div=>{
  div.addEventListener("click", ()=>{
    if (battle.state !== "player") return;
    const key = div.dataset.skill as keyof typeof skills;
    useSkill(key);
    paintSkillBar(); // refresh states
  });
});

function paintSkillBar(){
  skillEls.forEach(div=>{
    const key = div.dataset.skill as keyof typeof skills;
    div.classList.toggle("locked", !unlocked[key]);
    div.classList.toggle("oncd", cooldowns[key] > 0);
    // Could paint cost/rage or cd number if you want
    if (cooldowns[key] > 0) {
      div.style.opacity = "0.7";
      div.title = `${skills[key].name} — CD ${cooldowns[key]} turn(s)`;
    } else {
      div.style.opacity = "1";
      div.title = skills[key].name + (skills[key].cost ? ` — Rage ${skills[key].cost}` : "");
    }
  });
}

// ===== HUD update =====
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

// ===== Render loop (background + simple sprites) =====
function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // Draw player on left, enemy on right (simple silhouettes if sprite missing)
  const groundY = Math.round(window.innerHeight * 0.70);
  const pW=120, pH=120, eW=120, eH=120;

  if (playerImg) ctx.drawImage(playerImg, 80, groundY - pH, pW, pH);
  else { ctx.fillStyle="#111"; ctx.fillRect(80, groundY - pH, pW, pH); }

  
  // === Enemy draw (flipped to face hero) ===
const enemyX = window.innerWidth - eW - 100;
const enemyY = groundY - eH;

if (enemyImg && enemyImg.complete) {
  ctx.save();
  // move origin to enemy center, flip horizontally, then draw
  ctx.translate(enemyX + eW / 2, enemyY + eH / 2);
  ctx.scale(-1, 1);
  ctx.drawImage(enemyImg, -eW / 2, -eH / 2, eW, eH);
  ctx.restore();
} else {
  ctx.fillStyle = "rgba(10,10,10,.85)";
  ctx.fillRect(enemyX, enemyY, eW, eH);
}

  requestAnimationFrame(render);
}

// ===== Boot =====
// Enemy image — Diseased Boar
const enemyImg = new Image();
enemyImg.src = "/guildbook/avatars/enemies/diseasedboar.png";

Promise.all([loadImage(bgUrl), loadImage(playerSpriteUrl)])
  .then(([b, p])=>{ bg=b; playerImg=p; render(); })
  .catch(()=>{ render(); });

log("A hostile presence emerges from the forest...");
updateHUD();
paintSkillBar();
decideTurnOrder();
