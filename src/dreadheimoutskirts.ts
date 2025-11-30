// /src/dreadheimoutskirts.ts
// Dreadheim • Outskirts + Witch Interior (single page)
// Uses same class-aware hero animations as Perimeters.

const canvas = document.getElementById("map") as HTMLCanvasElement;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d")!;
if (!ctx) throw new Error("2D context not available");

/* =========================================================
   MODES
   ========================================================= */
type MapMode = "outside" | "inside";
let mapMode: MapMode = "outside";
let pendingSpawnAtDoor = false;

/* =========================================================
   CLASS-AWARE HERO ANIMATIONS (same system as Perimeters)
   ========================================================= */
const HERO_IDLE_URLS =
  (window as any).getHeroAnimUrls?.("idle") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/sm_${i.toString().padStart(3, "0")}.png`
  );

const HERO_WALK_LEFT_URLS =
  (window as any).getHeroAnimUrls?.("walkLeft") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/leftwalk_${i.toString().padStart(
      3,
      "0"
    )}.png`
  );

const HERO_WALK_RIGHT_URLS =
  (window as any).getHeroAnimUrls?.("walkRight") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/rightwalk_${i.toString().padStart(
      3,
      "0"
    )}.png`
  );

/* =========================================================
   WITCH ANIM (idle loop)
   ========================================================= */
const WITCH_IDLE_URLS = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/npcs/dreadheim-witch/idle_${i
    .toString()
    .padStart(3, "0")}.png`
);

/* =========================================================
   ASSETS
   ========================================================= */
const ASSETS = {
  ground: "/guildbook/maps/witchy-ground.png",
  hut: "/guildbook/props/witch-hut.png",
  inside: "/guildbook/props/insidewitchhut.png",
};

/* =========================================================
   EXITS
   ========================================================= */
const LEFT_EXIT_URL = "/dreadheimperimeters.html";
const EXIT_MARGIN = 4;

let isWarping = false;
function fadeTo(s: number, after?: () => void) {
  const f = document.createElement("div");
  Object.assign(f.style, {
    position: "fixed",
    inset: "0",
    background: "#000",
    opacity: "0",
    transition: `opacity ${s}s ease`,
    zIndex: "9999",
  });
  document.body.appendChild(f);
  requestAnimationFrame(() => (f.style.opacity = "1"));
  setTimeout(() => after && after(), s * 1000 + 50);
}
function warpTo(url: string) {
  if (isWarping) return;
  isWarping = true;
  fadeTo(0.25, () => (window.location.href = url));
}

/* =========================================================
   HERO SIZE + MOVEMENT
   ========================================================= */
const HERO_W = 150;
const HERO_H = 150;
const HERO_SPEED = 2.8;

let heroX = 100;
let heroY = 100;
let heroFacing: 1 | -1 = 1;
let heroAction: "idle" | "walk" = "idle";

let heroIdleFrames: HTMLImageElement[] = [];
let heroWalkLeftFrames: HTMLImageElement[] = [];
let heroWalkRightFrames: HTMLImageElement[] = [];
let heroFallback: HTMLImageElement | null = null;
let keys: Record<string, boolean> = {};

window.addEventListener("keydown", (e) => (keys[e.key] = true));
window.addEventListener("keyup", (e) => (keys[e.key] = false));

let heroFrameIndex = 0;
let heroFrameTime = 0;
const HERO_FRAME_MS = 100;

/* =========================================================
   WITCH SIZE + ANIMATION
   ========================================================= */
let witchFrames: HTMLImageElement[] = [];
let witchFrameIndex = 0;
let witchFrameTime = 0;
const WITCH_FRAME_MS = 120;

const WITCH_W = HERO_W; // <<< SAME WIDTH AS HERO
const WITCH_H = HERO_H * 1.15; // <<< Slightly taller witch

const witchRect = { x: 0, y: 0, w: WITCH_W, h: WITCH_H };

/* =========================================================
   RESIZE
   ========================================================= */
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* =========================================================
   LOADED IMAGES
   ========================================================= */
let groundImg: HTMLImageElement | null = null;
let groundPattern: CanvasPattern | null = null;
let hutImg: HTMLImageElement | null = null;
let insideImg: HTMLImageElement | null = null;

let hutRect = { x: 0, y: 0, w: 0, h: 0 };
let doorRect = { x: 0, y: 0, w: 0, h: 0 };

/* =========================================================
   INTERIOR MODE
   ========================================================= */
function enterInterior(cw: number, ch: number) {
  mapMode = "inside";
  heroX = cw / 2 - HERO_W / 2;
  heroY = ch - HERO_H - 40;
}
function exitInterior() {
  mapMode = "outside";
  pendingSpawnAtDoor = true;
}

/* =========================================================
   QUEST HANDLER (witch click)
   ========================================================= */
function openQuest() {
  const w = window as any;
  try {
    const getQuest = w.getQuestFromCatalog;
    const runDialogue = w.runCatalogDialogue;
    if (getQuest && runDialogue) {
      const q = getQuest("q_find_dreadheim_witch");
      if (q) runDialogue(q);
      return;
    }
  } catch {}
  alert("Witch dialogue not connected.");
}

/* =========================================================
   CLICKS (door / witch)
   ========================================================= */
canvas.addEventListener("click", (e) => {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;

  if (mapMode === "outside") {
    if (
      mx >= doorRect.x &&
      mx <= doorRect.x + doorRect.w &&
      my >= doorRect.y &&
      my <= doorRect.y + doorRect.h
    ) {
      enterInterior(canvas.width, canvas.height);
    }
  } else {
    if (
      mx >= witchRect.x &&
      mx <= witchRect.x + witchRect.w &&
      my >= witchRect.y &&
      my <= witchRect.y + witchRect.h
    ) {
      openQuest();
    }
  }
});

/* =========================================================
   ANIMATION PICKERS
   ========================================================= */
function getHeroFrame() {
  let list =
    heroAction === "walk"
      ? heroFacing === -1
        ? heroWalkLeftFrames
        : heroWalkRightFrames
      : heroIdleFrames;

  if (!list.length) return heroFallback;
  return list[heroFrameIndex % list.length];
}
function getWitchFrame() {
  if (!witchFrames.length) return null;
  return witchFrames[witchFrameIndex % witchFrames.length];
}

/* =========================================================
   MAIN LOOP
   ========================================================= */
let started = false;
let lastTs = 0;

function step(ts: number) {
  if (!groundPattern || !heroIdleFrames.length) {
    requestAnimationFrame(step);
    return;
  }

  const dt = lastTs ? ts - lastTs : 16;
  lastTs = ts;

  const cw = canvas.width;
  const ch = canvas.height;

  /* ---------------------------------------------------------
     Hut + Door (outside)
  --------------------------------------------------------- */
  if (mapMode === "outside" && hutImg) {
    const scale = 0.55;
    const dw = hutImg.width * scale;
    const dh = hutImg.height * scale;

    hutRect.x = cw / 2 - dw / 2;
    hutRect.y = ch / 2 - dh / 2 + 40;
    hutRect.w = dw;
    hutRect.h = dh;

    doorRect.w = dw * 0.18;
    doorRect.h = dh * 0.4;
    doorRect.x = hutRect.x + dw * 0.5 - doorRect.w / 2;
    doorRect.y = hutRect.y + dh * 0.56;

    if (pendingSpawnAtDoor) {
      heroX = doorRect.x + doorRect.w / 2 - HERO_W / 2;
      heroY = hutRect.y + hutRect.h - HERO_H + 10;
      pendingSpawnAtDoor = false;
    }
  }

  /* ---------------------------------------------------------
     Movement
  --------------------------------------------------------- */
  let dx = 0,
    dy = 0;
  if (keys["ArrowLeft"] || keys["a"] || keys["A"]) dx -= 1;
  if (keys["ArrowRight"] || keys["d"] || keys["D"]) dx += 1;
  if (keys["ArrowUp"] || keys["w"] || keys["W"]) dy -= 1;
  if (keys["ArrowDown"] || keys["s"] || keys["S"]) dy += 1;

  if (dx !== 0 || dy !== 0) {
    const l = Math.hypot(dx, dy) || 1;
    heroX += (dx / l) * HERO_SPEED;
    heroY += (dy / l) * HERO_SPEED;
    heroFacing = dx < 0 ? -1 : dx > 0 ? 1 : heroFacing;
    heroAction = "walk";
  } else {
    heroAction = "idle";
  }

  /* ---------------------------------------------------------
     Boundaries
  --------------------------------------------------------- */
  if (heroX < 0) heroX = 0;
  if (heroX + HERO_W > cw) heroX = cw - HERO_W;
  if (heroY < 0) heroY = 0;
  if (heroY + HERO_H > ch) heroY = ch - HERO_H;

  /* ---------------------------------------------------------
     Exits
  --------------------------------------------------------- */
  if (mapMode === "outside" && heroX <= EXIT_MARGIN) {
    warpTo(LEFT_EXIT_URL);
    return;
  }
  if (mapMode === "inside" && heroY + HERO_H >= ch - 5) {
    exitInterior();
    return;
  }

  /* ---------------------------------------------------------
     Hero Animation
  --------------------------------------------------------- */
  heroFrameTime += dt;
  if (heroFrameTime >= HERO_FRAME_MS) {
    heroFrameTime = 0;
    heroFrameIndex++;
  }

  /* ---------------------------------------------------------
     Witch Animation
  --------------------------------------------------------- */
  if (mapMode === "inside") {
    witchFrameTime += dt;
    if (witchFrameTime >= WITCH_FRAME_MS) {
      witchFrameTime = 0;
      witchFrameIndex++;
    }

    witchRect.w = WITCH_W;
    witchRect.h = WITCH_H;
    witchRect.x = cw - WITCH_W - 100;
    witchRect.y = ch - WITCH_H - 40;
  }

  /* ---------------------------------------------------------
     DRAW
  --------------------------------------------------------- */
  ctx.clearRect(0, 0, cw, ch);

  const hf = getHeroFrame();
  ctx.imageSmoothingEnabled = false;

  if (mapMode === "outside") {
    ctx.fillStyle = groundPattern!;
    ctx.fillRect(0, 0, cw, ch);

    if (hutImg) {
      const heroFeet = heroY + HERO_H;
      const hutMidY = hutRect.y + hutRect.h * 0.5;

      if (heroFeet < hutMidY) {
        if (hf) drawHero(hf);
        ctx.drawImage(hutImg, hutRect.x, hutRect.y, hutRect.w, hutRect.h);
      } else {
        ctx.drawImage(hutImg, hutRect.x, hutRect.y, hutRect.w, hutRect.h);
        if (hf) drawHero(hf);
      }
    }
  } else {
    ctx.drawImage(insideImg!, 0, 0, cw, ch);

    const wf = getWitchFrame();
    if (wf) {
      const heroFeet = heroY + HERO_H;
      const witchFeet = witchRect.y + witchRect.h;

      if (heroFeet < witchFeet) {
        if (hf) drawHero(hf);
        ctx.drawImage(wf, witchRect.x, witchRect.y, WITCH_W, WITCH_H);
      } else {
        ctx.drawImage(wf, witchRect.x, witchRect.y, WITCH_W, WITCH_H);
        if (hf) drawHero(hf);
      }
    } else {
      if (hf) drawHero(hf);
    }
  }

  requestAnimationFrame(step);
}

/* =========================================================
   DRAW HERO
   ========================================================= */
function drawHero(frame: HTMLImageElement) {
  ctx.save();
  ctx.translate(heroX + HERO_W / 2, heroY);
  if (heroFacing === -1) ctx.scale(-1, 1);
  ctx.drawImage(frame, -HERO_W / 2, 0, HERO_W, HERO_H);
  ctx.restore();
}

/* =========================================================
   LOAD IMAGES
   ========================================================= */
function load(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("missing " + src));
    img.src = src;
  });
}

async function init() {
  if (started) return;
  started = true;

  try {
    const urls = [
      ASSETS.ground,
      ASSETS.hut,
      ASSETS.inside,
      ...HERO_IDLE_URLS,
      ...HERO_WALK_LEFT_URLS,
      ...HERO_WALK_RIGHT_URLS,
      ...WITCH_IDLE_URLS,
    ];

    const imgs = await Promise.all(urls.map(load));
    let i = 0;

    groundImg = imgs[i++];
    hutImg = imgs[i++];
    insideImg = imgs[i++];

    groundPattern = ctx.createPattern(groundImg!, "repeat");

    heroIdleFrames = imgs.slice(i, (i += HERO_IDLE_URLS.length));
    heroWalkLeftFrames = imgs.slice(i, (i += HERO_WALK_LEFT_URLS.length));
    heroWalkRightFrames = imgs.slice(i, (i += HERO_WALK_RIGHT_URLS.length));
    heroFallback = heroIdleFrames[0];

    witchFrames = imgs.slice(i, (i += WITCH_IDLE_URLS.length));

    heroX = 40;
    heroY = canvas.height - HERO_H - 40;

    requestAnimationFrame(step);
  } catch (err) {
    console.error(err);
  }
}

init();
export {};



















