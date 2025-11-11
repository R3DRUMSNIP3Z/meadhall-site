// --- Dreadheim • House Interior (free 4-direction movement + NPC + exit) ---
// Requires /src/global-game-setup.ts to be loaded BEFORE this script.

type DialogueLine =
  | { type: "line"; text: string }
  | { type: "choice"; prompt: string; choices: { text: string; next?: string }[] };

type DialogueTree = Record<string, DialogueLine[]>;

declare global {
  interface Window {
    VAQ?: any;
    getHeroSprite?: () => string;
  }
}

const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;

// ===== ASSETS =====
const ASSETS = {
  bg: "/guildbook/props/dreadheimhouseinside.png",
  npc: "/guildbook/npcs/dreadheim-wizard.png",
  hero: (() => {
    const pick = window.getHeroSprite as undefined | (() => string);
    if (typeof pick === "function") return pick();
    const g = localStorage.getItem("va_gender");
    return g === "female"
      ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
      : "/guildbook/avatars/dreadheim-warrior.png";
  })(),
};

// Travel
const EXIT_URL = "/dreadheimperimeters.html";

// ===== WORLD CONFIG =====
// Only the floor is walkable: allow a thin vertical band near the floor
const WALK_BAND_PX = 48; // how much vertical movement above the floor

const WALKWAY_TOP_RATIO = 0.86;
const SPEED = 4;
const HERO_W = 96, HERO_H = 96;

// NPC (center-back between pillars, slightly farther back toward wall)
const NPC_W = 144, NPC_H = 252;
const NPC_X_RATIO = 0.5;
const NPC_BACK_OFFSET_RATIO = 0.06; // push up/back by ~6% of viewport height
const TALK_DISTANCE = 110;

// ===== DPR & RESIZE =====
function fitCanvas(): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener("resize", fitCanvas);

// ===== LOAD HELPER =====
function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Missing asset: " + src));
    img.src = src;
  });
}

let bg: HTMLImageElement | null = null;
let npcImg: HTMLImageElement | null = null;
let heroImg: HTMLImageElement | null = null;

// ===== WORLD STATE =====
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const hero = {
  x: Math.round(window.innerWidth * 0.2),
  y: groundY - HERO_H,
  w: HERO_W, h: HERO_H,
};

const npc = { x: 0, y: 0, w: NPC_W, h: NPC_H };

function layoutHouse(): void {
  const vw = window.innerWidth, vh = window.innerHeight;
  groundY = Math.round(vh * WALKWAY_TOP_RATIO);
  npc.x = Math.round(vw * NPC_X_RATIO) - Math.floor(npc.w / 2);
  npc.y = Math.round(groundY - npc.h - vh * NPC_BACK_OFFSET_RATIO);
}
function refreshBounds(): void { layoutHouse(); }
window.addEventListener("resize", refreshBounds);

// ===== INPUT =====
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key));
window.addEventListener("keyup", (e) => keys.delete(e.key));

// ===== FADE + WARP =====
let transitioning = false;
function fadeTo(seconds = 0.25, after?: () => void): void {
  const f = document.createElement("div");
  f.style.position = "fixed";
  f.style.inset = "0";
  f.style.background = "black";
  f.style.opacity = "0";
  f.style.transition = `opacity ${seconds}s ease`;
  f.style.zIndex = "999999";
  document.body.appendChild(f);
  requestAnimationFrame(() => (f.style.opacity = "1"));
  window.setTimeout(() => { if (after) after(); }, seconds * 1000);
}
function warpTo(url: string): void {
  if (transitioning) return;
  transitioning = true;
  fadeTo(0.25, () => (window.location.href = url));
}

// ===== PLAYER NAME HELPER =====
function getPlayerName(): string {
  try {
    const n = localStorage.getItem("va_name");
    if (n) return n;
    const raw = localStorage.getItem("mh_user");
    if (raw) {
      const o = JSON.parse(raw);
      return o?.name || o?.user?.name || "traveler";
    }
  } catch {}
  return "traveler";
}

// ===== SIMPLE DIALOGUE UI (click-to-advance) =====
class Dialogue {
  private overlay: HTMLDivElement | null;
  private box: HTMLDivElement | null;
  private lines: DialogueLine[];
  private ptr: number;
  private onDone?: () => void;
  private title: string;

  constructor(lines: DialogueLine[], onDone?: () => void, title = "Old Seer") {
    this.overlay = null;
    this.box = null;
    this.lines = lines || [];
    this.ptr = 0;
    this.onDone = onDone;
    this.title = title;
  }

  open(): void {
    if (this.overlay) return;
    const ov = document.createElement("div");
    ov.style.position = "fixed";
    ov.style.inset = "0";
    ov.style.background = "rgba(0,0,0,.55)";
    ov.style.backdropFilter = "blur(2px)";
    ov.style.display = "flex";
    ov.style.alignItems = "flex-end";
    ov.style.justifyContent = "center";
    ov.style.padding = "24px";
    ov.style.zIndex = "999998";

    const box = document.createElement("div");
    box.style.maxWidth = "900px";
    box.style.width = "100%";
    box.style.background = "rgba(10,12,15,.9)";
    box.style.border = "1px solid rgba(212,169,77,.35)";
    box.style.borderRadius = "14px";
    box.style.padding = "16px 18px";
    box.style.color = "#e8d9ae";
    box.style.fontFamily = "Cinzel, serif";
    box.style.boxShadow = "0 12px 40px rgba(0,0,0,.45)";

    const head = document.createElement("div");
    head.textContent = this.title;
    head.style.fontWeight = "900";
    head.style.letterSpacing = ".02em";
    head.style.marginBottom = "6px";

    const content = document.createElement("div");
    content.id = "dlg-content";
    content.style.minHeight = "64px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "10px";
    actions.style.justifyContent = "flex-end";
    actions.style.marginTop = "10px";

    box.appendChild(head);
    box.appendChild(content);
    box.appendChild(actions);
    ov.appendChild(box);
    document.body.appendChild(ov);

    this.overlay = ov;
    this.box = box;
    this.renderCurrent();
  }

  private renderCurrent(): void {
    if (!this.overlay || !this.box) return;
    const content = this.box.querySelector("#dlg-content") as HTMLDivElement;
    const actions = this.box.querySelector("div:last-child") as HTMLDivElement;

    content.innerHTML = "";
    actions.innerHTML = "";

    const node = this.lines[this.ptr];

    // Nothing left → close
    if (!node) {
      this.close();
      return;
    }

    if (node.type === "choice") {
      const p = document.createElement("div");
      p.textContent = node.prompt;
      p.style.marginBottom = "6px";
      content.appendChild(p);

      node.choices.forEach((c) => {
        const b = document.createElement("button");
        b.textContent = c.text;
        b.style.padding = "8px 14px";
        b.style.borderRadius = "10px";
        b.style.border = "1px solid rgba(212,169,77,.35)";
        b.style.background = "linear-gradient(180deg,#191c20,#0e1114)";
        b.style.color = "#d4a94d";
        b.addEventListener("click", () => {
          if (c.next) this.jumpTo(c.next);
          else this.next();
        });
        actions.appendChild(b);
      });
      return;
    }

    // Normal line
    const t = document.createElement("div");
    t.textContent = node.text;
    content.appendChild(t);

    const nextBtn = document.createElement("button");
    nextBtn.textContent = this.ptr < this.lines.length - 1 ? "Continue" : "Finish";
    nextBtn.style.padding = "8px 14px";
    nextBtn.style.borderRadius = "10px";
    nextBtn.style.border = "1px solid rgba(212,169,77,.35)";
    nextBtn.style.background = "linear-gradient(180deg,#191c20,#0e1114)";
    nextBtn.style.color = "#d4a94d";
    nextBtn.addEventListener("click", () => this.next());
    actions.appendChild(nextBtn);
  }

  private next(): void {
    this.ptr++;
    if (this.ptr >= this.lines.length) {
      this.close();
      return;
    }
    this.renderCurrent();
  }

  private jumpTo(anchor: string): void {
    // simple anchor = "id:index" (optional), else advance
    const parts = anchor.split(":");
    if (parts.length === 2) {
      const idx = parseInt(parts[1], 10);
      if (!isNaN(idx)) {
        this.ptr = Math.max(0, Math.min(this.lines.length - 1, idx));
        this.renderCurrent();
        return;
      }
    }
    this.next();
  }

  private close(): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    this.box = null;
    if (this.onDone) this.onDone();
  }
}

// ===== CLICK INTERACTIONS (open dialogue) =====
canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

  if (x >= npc.x && x <= npc.x + npc.w && y >= npc.y && y <= npc.y + npc.h) {
    startWizardDialogue();
  }
});

// ===== DIALOGUE CONTENT (catalog + fallback) =====
let catalog: DialogueTree | null = null;
const QUESTS_CATALOG_PATH = "/guildbook/catalogquests.json";

function loadCatalog(): void {
  // No top-level await; fire and forget, assign when ready
  fetch(QUESTS_CATALOG_PATH)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j) => (catalog = j as DialogueTree))
    .catch(() => (catalog = null));
}
loadCatalog();

function wizardLines(): DialogueLine[] {
  // Try catalog first
  const player = getPlayerName();
  const key = "dreadheim_wizard_intro"; // recommended node id in your JSON
  if (catalog && catalog[key] && Array.isArray(catalog[key])) {
    // Allow {{name}} token replacement
    return (catalog[key] as DialogueLine[]).map((ln) => {
      if (ln.type === "line") {
        return { type: "line", text: String(ln.text || "").replace(/\{\{name\}\}/g, player) };
      }
      if (ln.type === "choice") {
        return {
          type: "choice",
          prompt: String(ln.prompt || "").replace(/\{\{name\}\}/g, player),
          choices: (ln.choices || []).map((c) => ({
            text: String(c.text || "").replace(/\{\{name\}\}/g, player),
            next: c.next,
          })),
        };
      }
      return ln;
    });
  }

  // Fallback script
  return [
    { type: "line", text: `Old Seer: "Ah... greetings, ${player}. I see you've been marked a Dreadheimer."` },
    { type: "line", text: `Old Seer: "*tsk tsk tsk* ... a grim fate. Why one would choose it baffles even me."` },
    { type: "line", text: `Old Seer: "Still, the winds whisper of your weakness. You look pale from travel."` },
    { type: "line", text: `Old Seer: "Very well. I will help you—because you look pathetic enough to need it."` },
    { type: "line", text: `Old Seer: "Go now, to the Dreadheim Outskirts. Seek the witch called Skarthra the Pale."` },
    { type: "line", text: `Old Seer: "She may grant you a path—if she doesn't turn you to ash first."` },
  ];
}

// ===== INTERACTIVE WIZARD FLOW =====
let wizardLocked = false; // debounce

function startWizardDialogue(): void {
  if (wizardLocked) return;
  wizardLocked = true;

  const dlg = new Dialogue(wizardLines(), () => {
    try {
      const VAQ = window.VAQ;
      // Complete current quest
      VAQ?.complete?.("q_find_dreadheim_wizard");

      // Start next quest (create/activate if needed)
      if (typeof VAQ?.startNext === "function") {
        VAQ.startNext("q_find_dreadheim_wizard", {
          id: "q_find_dreadheim_witch",
          title: "Find Skarthra the Pale",
          desc: "Travel to the Dreadheim Outskirts and seek the witch named Skarthra the Pale.",
          status: "active",
          progress: 0,
        });
      } else {
        // Manual add/activate if your global helper doesn't exist
        const read = (VAQ?.readQuests || (() => {
          try { return JSON.parse(localStorage.getItem("va_quests") || "[]"); } catch { return []; }
        })) as () => any[];

        const write = (VAQ?.writeQuests || ((l: any[]) => {
          try { localStorage.setItem("va_quests", JSON.stringify(l)); } catch {}
          window.dispatchEvent(new CustomEvent("va-quest-updated"));
        })) as (l: any[]) => void;

        const list = read();
        const byId: Record<string, any> = Object.fromEntries(list.map((q) => [q.id, q]));
        if (!byId["q_find_dreadheim_witch"]) {
          list.push({
            id: "q_find_dreadheim_witch",
            title: "Find Skarthra the Pale",
            desc: "Travel to the Dreadheim Outskirts and seek the witch named Skarthra the Pale.",
            status: "active",
            progress: 0,
          });
        } else {
          byId["q_find_dreadheim_witch"].status = "active";
        }
        write(list);
      }

      VAQ?.renderHUD?.();
    } catch (err) {
      console.warn("Quest system not found:", err);
    }

    // A little send-off bubble (non-blocking)
    showBubble([
      'Old Seer: "Your mark is sealed. Now go—before the witch grows impatient."',
    ], 3800);

    window.setTimeout(() => { wizardLocked = false; }, 600);
  }, "Old Seer");
  dlg.open();
}

// Small bottom hint
function showExitHint(): void {
  const h = document.createElement("div");
  h.style.position = "fixed";
  h.style.left = "50%";
  h.style.bottom = "8px";
  h.style.transform = "translateX(-50%)";
  h.style.color = "#fff";
  h.style.opacity = ".85";
  h.style.font = "12px ui-sans-serif,system-ui";
  h.style.background = "rgba(0,0,0,.45)";
  h.style.padding = "6px 10px";
  h.style.borderRadius = "8px";
  h.style.border = "1px solid rgba(255,255,255,.15)";
  h.style.backdropFilter = "blur(4px)";
  h.style.pointerEvents = "none";
  h.style.zIndex = "9999";
  h.textContent = "Walk ↓ to leave the house • Press E near the wizard to talk";
  document.body.appendChild(h);
  window.setTimeout(() => h.remove(), 4500);
}

// Quick one-off bubble (used after finish)
function showBubble(lines: string[], ms: number): void {
  const dlg = document.createElement("div");
  dlg.style.position = "fixed";
  dlg.style.left = "50%";
  dlg.style.bottom = "10%";
  dlg.style.transform = "translateX(-50%)";
  dlg.style.maxWidth = "70ch";
  dlg.style.padding = "12px 16px";
  dlg.style.background = "rgba(0,0,0,.6)";
  dlg.style.border = "1px solid rgba(255,255,255,.15)";
  dlg.style.borderRadius = "12px";
  dlg.style.color = "#fff";
  dlg.style.font = "14px/1.4 ui-sans-serif,system-ui";
  dlg.style.backdropFilter = "blur(4px)";
  dlg.style.cursor = "pointer";
  dlg.style.zIndex = "999997";
  dlg.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  dlg.title = "Click to close";
  dlg.addEventListener("click", () => dlg.remove());
  document.body.appendChild(dlg);
  if (ms > 0) window.setTimeout(() => dlg.remove(), ms);
}

// ===== STEP (MOVEMENT) =====
function step(): void {
  let dx = 0, dy = 0;
  const left  = keys.has("ArrowLeft")  || keys.has("a") || keys.has("A");
  const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
  const up    = keys.has("ArrowUp")    || keys.has("w") || keys.has("W");
  const down  = keys.has("ArrowDown")  || keys.has("s") || keys.has("S");

  if (left)  dx -= 1;
  if (right) dx += 1;
  if (up)    dy -= 1;
  if (down)  dy += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx = (dx / len) * SPEED;
    dy = (dy / len) * SPEED;
  }

  hero.x += dx;
  hero.y += dy;

  // Bounds
  const leftBound = 0;
  const rightBound = window.innerWidth - hero.w;
  const floorTop = groundY - hero.h;
  const ceiling = Math.max(0, floorTop - WALK_BAND_PX);

  if (hero.x < leftBound)  hero.x = leftBound;
  if (hero.x > rightBound) hero.x = rightBound;
  if (hero.y < ceiling)    hero.y = ceiling;
  if (hero.y > floorTop)   hero.y = floorTop;

  // --- Bottom-edge walk-out: if pushing down at the floor, exit ---
  if (down && hero.y >= floorTop - 0.5) {
    warpTo(EXIT_URL);
    return;
  }

  // E near NPC → interactive dialogue
  const heroCenterX = hero.x + hero.w / 2;
  const npcCenterX  = npc.x + npc.w / 2;
  const dxCenter = Math.abs(heroCenterX - npcCenterX);
  const touchingNPC =
    dxCenter < TALK_DISTANCE &&
    Math.abs((hero.y + hero.h) - (npc.y + npc.h)) < 80;

  if (touchingNPC && (keys.has("e") || keys.has("E"))) {
    startWizardDialogue();
  }
}

// ===== RENDER =====
function render(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // simple depth: draw whichever "feet" are lower last
  const heroFeet = hero.y + hero.h;
  const npcFeet  = npc.y + npc.h;
  if (heroFeet < npcFeet) {
    if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
    if (npcImg)  ctx.drawImage(npcImg,  npc.x,  npc.y,  npc.w,  npc.h);
  } else {
    if (npcImg)  ctx.drawImage(npcImg,  npc.x,  npc.y,  npc.w,  npc.h);
    if (heroImg) ctx.drawImage(heroImg, hero.x, hero.y, hero.w, hero.h);
  }

  if (!heroImg) { ctx.fillStyle = "#333"; ctx.fillRect(hero.x, hero.y, hero.w, hero.h); }
}

// ===== LOOP =====
function loop(): void { step(); render(); requestAnimationFrame(loop); }

// Live hero sprite updates
window.addEventListener("va-gender-changed", () => {
  try {
    const pick = window.getHeroSprite as undefined | (() => string);
    const next = (typeof pick === "function")
      ? pick()
      : (localStorage.getItem("va_gender") === "female"
          ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
          : "/guildbook/avatars/dreadheim-warrior.png");
    const img = new Image();
    img.onload = () => { heroImg = img; };
    img.src = next;
  } catch {}
});

// ===== BOOT =====
Promise.all([load(ASSETS.bg), load(ASSETS.npc), load(ASSETS.hero)])
  .then(([b, n, h]) => {
    bg = b; npcImg = n; heroImg = h;
    refreshBounds();
    showExitHint();
    loop();
  })
  .catch(() => { refreshBounds(); loop(); });




