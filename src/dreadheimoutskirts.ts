// /src/dreadheimoutskirts.ts
// Dreadheim • Outskirts + Witch Hut Interior (single page, mode-switching)
// Requires /src/global-game-setup.ts (for VAQ + class-aware hero anim helpers).

const canvas = document.getElementById("map") as HTMLCanvasElement | null;
if (!canvas) throw new Error("#map canvas not found");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D context not available");

/* =========================================================
   MODES
   ========================================================= */

type MapMode = "outside" | "inside";
let mapMode: MapMode = "outside";

// when we come back from inside and want to spawn in front of the door
let pendingSpawnAtDoor = false;

/* =========================================================
   CLASS-AWARE HERO ANIM URLS (same system as Perimeters)
   ========================================================= */

const HERO_IDLE_URLS: string[] =
  (window as any).getHeroAnimUrls?.("idle") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/sm_${i.toString().padStart(3, "0")}.png`
  );

const HERO_WALK_LEFT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("walkLeft") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/leftwalk_${i
      .toString()
      .padStart(3, "0")}.png`
  );

const HERO_WALK_RIGHT_URLS: string[] =
  (window as any).getHeroAnimUrls?.("walkRight") ??
  Array.from({ length: 9 }, (_, i) =>
    `/guildbook/avatars/shieldmaiden/rightwalk_${i
      .toString()
      .padStart(3, "0")}.png`
  );

/* =========================================================
   WITCH ANIMATION (idle_000–idle_008.png)
   ========================================================= */

const WITCH_IDLE_URLS: string[] = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/npcs/dreadheim-witch/idle_${i.toString().padStart(3, "0")}.png`
);

let witchFrames: HTMLImageElement[] = [];
let witchFrameIndex = 0;
let witchFrameTime = 0;
const WITCH_FRAME_MS = 140; // slower = creepier

/* =========================================================
   ASSETS
   ========================================================= */

const ASSETS = {
  ground: "/guildbook/maps/witchy-ground.png",
  hut: "/guildbook/props/witch-hut.png",
  inside: "/guildbook/props/insidewitchhut.png", // interior image
};

/* =========================================================
   EXITS / WARP (ONLY OUTSIDE)
   ========================================================= */

const LEFT_EXIT_URL = "/dreadheimperimeters.html";
const EXIT_MARGIN = 4;

let isWarping = false;

function fadeTo(seconds: number, after?: () => void) {
  const f = document.createElement("div");
  Object.assign(f.style, {
    position: "fixed",
    inset: "0",
    background: "#000",
    opacity: "0",
    pointerEvents: "none",
    transition: `opacity ${seconds}s ease-out`,
    zIndex: "9999",
  } as CSSStyleDeclaration);
  document.body.appendChild(f);
  requestAnimationFrame(() => {
    f.style.opacity = "1";
  });
  setTimeout(() => {
    after && after();
  }, seconds * 1000 + 50);
}

function warpTo(url: string) {
  if (isWarping) return;
  isWarping = true;
  fadeTo(0.35, () => {
    window.location.href = url;
  });
}

/* =========================================================
   HERO + MOVEMENT + ANIMATION (class-aware)
   ========================================================= */

const HERO_W = 150;
const HERO_H = 150;
const HERO_SPEED = 2.8;

let heroX = 100;
let heroY = 100;
let heroFacing: 1 | -1 = 1;

const keys: Record<string, boolean> = {};

window.addEventListener("keydown", (ev) => {
  keys[ev.key] = true;
});

window.addEventListener("keyup", (ev) => {
  keys[ev.key] = false;
});

let heroIdleFrames: HTMLImageElement[] = [];
let heroWalkLeftFrames: HTMLImageElement[] = [];
let heroWalkRightFrames: HTMLImageElement[] = [];
let heroFallbackImg: HTMLImageElement | null = null;

type HeroAction = "idle" | "walk";

let heroAction: HeroAction = "idle";
let heroFrameIndex = 0;
let heroFrameTimeMs = 0;
const HERO_FRAME_DURATION_MS = 100;

function getCurrentHeroFrame(): HTMLImageElement | null {
  let frames: HTMLImageElement[] = [];
  if (heroAction === "walk") {
    frames = heroFacing === -1 ? heroWalkLeftFrames : heroWalkRightFrames;
  } else {
    frames = heroIdleFrames;
  }
  if (!frames.length) return heroFallbackImg;
  return frames[heroFrameIndex % frames.length] || frames[0] || heroFallbackImg;
}

// 🧍 Draw hero WITHOUT extra mirroring – we already have left/right sheets
function drawHero(frame: HTMLImageElement) {
  ctx!.drawImage(frame, heroX, heroY, HERO_W, HERO_H);
}

/* =========================================================
   RESIZE
   ========================================================= */

function resizeCanvas() {
  canvas!.width = window.innerWidth;
  canvas!.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* =========================================================
   GROUND + HUT + DOOR RECT + INSIDE BG + WITCH NPC
   ========================================================= */

let groundImg: HTMLImageElement | null = null;
let groundPattern: CanvasPattern | null = null;

let hutImg: HTMLImageElement | null = null;
let insideImg: HTMLImageElement | null = null;

const HUT_SCALE = 0.55;

// full hut rect (for drawing & depth)
const hutRectFull = { x: 0, y: 0, w: 0, h: 0 };

// clickable door rect (inside the hut)
const doorRect = { x: 0, y: 0, w: 0, h: 0 };

// witch rect (inside mode only)
const witchRect = { x: 0, y: 0, w: 0, h: 0 };

/* =========================================================
   MODE HELPERS
   ========================================================= */

function enterInterior(cw: number, ch: number) {
  mapMode = "inside";

  // put hero near bottom-center of the room
  heroX = (cw - HERO_W) / 2;
  heroY = ch - HERO_H - 30;
}

function exitInterior() {
  // switch back to outside; spawn near door on next frame
  mapMode = "outside";
  pendingSpawnAtDoor = true;
}

/* =========================================================
   QUEST DIALOGUE HELPER (WITCH)
   ========================================================= */

function openQuestDialogue(questId: string) {
  const w = window as any;

  try {
    const getQuest =
      (w.getQuestFromCatalog as undefined | ((id: string) => any)) || null;
    const runDialogue =
      (w.runCatalogDialogue as
        | undefined
        | ((q: any, after?: () => void) => void)) || null;

    if (typeof getQuest === "function" && typeof runDialogue === "function") {
      const quest = getQuest(questId);
      if (quest) {
        // Open the JSON-driven dialogue. Any quest vars / completion
        // should be handled by the catalog actions in catalogquests.json.
        runDialogue(quest, () => {
          // optional: anything you want to run *after* dialogue closes
        });
        return;
      }
    }
  } catch (err) {
    console.error("Error opening quest dialogue:", err);
  }

  // Fallback if something isn’t wired up
  alert(
    "Witch clicked, but the quest dialogue catalog isn't ready on this page."
  );
}

/* =========================================================
   CLICK HANDLER (DOOR OUTSIDE, WITCH INSIDE)
   ========================================================= */

const WITCH_HIT_MARGIN = 40; // expand clickable area around witch

canvas!.addEventListener("click", (ev) => {
  const rect = canvas!.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;

  if (mapMode === "outside") {
    // click door to go inside
    if (
      mx >= doorRect.x &&
      mx <= doorRect.x + doorRect.w &&
      my >= doorRect.y &&
      my <= doorRect.y + doorRect.h
    ) {
      enterInterior(canvas!.width, canvas!.height);
    }
  } else {
    // INSIDE: click the witch to talk / start quest (with bigger hitbox)
    if (
      mx >= witchRect.x - WITCH_HIT_MARGIN &&
      mx <= witchRect.x + witchRect.w + WITCH_HIT_MARGIN &&
      my >= witchRect.y - WITCH_HIT_MARGIN &&
      my <= witchRect.y + witchRect.h + WITCH_HIT_MARGIN
    ) {
      openQuestDialogue("q_find_dreadheim_witch");
    }
  }
});

/* =========================================================
   MAIN LOOP
   ========================================================= */

let started = false;
let lastTs = 0;

function step(ts: number) {
  if (!groundPattern || !insideImg || heroIdleFrames.length === 0) {
    requestAnimationFrame(step);
    return;
  }

  const dt = lastTs ? ts - lastTs : 16;
  lastTs = ts;

  const cw = canvas!.width;
  const ch = canvas!.height;

  /* ---------- compute hut + door when OUTSIDE ---------- */
  if (mapMode === "outside" && hutImg) {
    const rawW = hutImg.width;
    const rawH = hutImg.height;
    const drawW = rawW * HUT_SCALE;
    const drawH = rawH * HUT_SCALE;

    hutRectFull.x = (cw - drawW) / 2;
    hutRectFull.y = (ch - drawH) / 2 + 40;
    hutRectFull.w = drawW;
    hutRectFull.h = drawH;

    // --- compute door rect inside hut ---
    const DOOR_WIDTH_RATIO = 0.18;
    const DOOR_HEIGHT_RATIO = 0.45;
    const DOOR_CENTER_X_RATIO = 0.5;
    const DOOR_TOP_RATIO = 0.55;

    const doorW = drawW * DOOR_WIDTH_RATIO;
    const doorH = drawH * DOOR_HEIGHT_RATIO;
    const doorCenterX = hutRectFull.x + drawW * DOOR_CENTER_X_RATIO;

    doorRect.x = doorCenterX - doorW / 2;
    doorRect.y = hutRectFull.y + drawH * DOOR_TOP_RATIO;
    doorRect.w = doorW;
    doorRect.h = doorH;

    // if we just came back from inside, spawn in front of door
    if (pendingSpawnAtDoor) {
      heroX = doorRect.x + doorRect.w / 2 - HERO_W / 2;
      heroY = hutRectFull.y + hutRectFull.h - HERO_H + 10;
      pendingSpawnAtDoor = false;
    }
  }

  /* ---------- movement (same logic for both modes) ---------- */
  let dx = 0;
  let dy = 0;

  if (keys["ArrowLeft"] || keys["a"] || keys["A"]) dx -= 1;
  if (keys["ArrowRight"] || keys["d"] || keys["D"]) dx += 1;
  if (keys["ArrowUp"] || keys["w"] || keys["W"]) dy -= 1;
  if (keys["ArrowDown"] || keys["s"] || keys["S"]) dy += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy) || 1;
    const stepX = (dx / len) * HERO_SPEED;
    const stepY = (dy / len) * HERO_SPEED;

    heroX += stepX;
    heroY += stepY;

    if (stepX < 0) heroFacing = -1;
    if (stepX > 0) heroFacing = 1;

    heroAction = "walk";
  } else {
    heroAction = "idle";
  }

  // clamp inside screen
  if (heroX < 0) heroX = 0;
  if (heroX + HERO_W > cw) heroX = cw - HERO_W;
  if (heroY < 0) heroY = 0;
  if (heroY + HERO_H > ch) heroY = ch - HERO_H;

  // exits:
  if (mapMode === "outside") {
    // OUTSIDE: left edge goes back to perimeters
    if (heroX <= EXIT_MARGIN) {
      warpTo(LEFT_EXIT_URL);
      return;
    }
  } else {
    // INSIDE: walking down to bottom leaves the hut
    if (heroY + HERO_H >= ch - 5) {
      exitInterior();
      // next frame will recompute hut + door and spawn hero there
      requestAnimationFrame(step);
      return;
    }
  }

  // update hero animation frames
  heroFrameTimeMs += dt;
  while (heroFrameTimeMs >= HERO_FRAME_DURATION_MS) {
    heroFrameTimeMs -= HERO_FRAME_DURATION_MS;
    heroFrameIndex++;
  }

  // update witch animation (inside only)
  if (mapMode === "inside" && witchFrames.length) {
    witchFrameTime += dt;
    while (witchFrameTime >= WITCH_FRAME_MS) {
      witchFrameTime -= WITCH_FRAME_MS;
      witchFrameIndex = (witchFrameIndex + 1) % witchFrames.length;
    }
  }

  /* ---------- draw ---------- */

  ctx!.clearRect(0, 0, cw, ch);
  ctx!.imageSmoothingEnabled = false;

  const frame = getCurrentHeroFrame();

  if (mapMode === "outside") {
    // === OUTSIDE: tile ground + draw hut with depth ===
    ctx!.fillStyle = groundPattern!;
    ctx!.fillRect(0, 0, cw, ch);

    if (hutImg && hutRectFull.w > 0 && hutRectFull.h > 0 && frame) {
      const heroFeetY = heroY + HERO_H;
      const hutMidY = hutRectFull.y + hutRectFull.h * 0.5;

      if (heroFeetY < hutMidY) {
        // hero "behind" hut → hero, then hut
        drawHero(frame);
        ctx!.drawImage(
          hutImg,
          hutRectFull.x,
          hutRectFull.y,
          hutRectFull.w,
          hutRectFull.h
        );
      } else {
        // hero in front → hut, then hero
        ctx!.drawImage(
          hutImg,
          hutRectFull.x,
          hutRectFull.y,
          hutRectFull.w,
          hutRectFull.h
        );
        drawHero(frame);
      }
    } else if (frame) {
      // fallback if hut missing
      ctx!.fillStyle = groundPattern!;
      ctx!.fillRect(0, 0, cw, ch);
      drawHero(frame);
    }
  } else {
    // === INSIDE: draw interior BG full-screen ===
    ctx!.drawImage(insideImg!, 0, 0, cw, ch);

    let witchFrame: HTMLImageElement | null =
      witchFrames.length > 0 ? witchFrames[witchFrameIndex % witchFrames.length] : null;

    // compute witch rect (scaled to room size)
    if (witchFrame) {
      const rawW = witchFrame.width;
      const rawH = witchFrame.height;

      const desiredH = ch * 0.5; // height scaling
      const scale = desiredH / rawH;

      witchRect.w = rawW * scale;
      witchRect.h = desiredH;
      witchRect.x = cw - witchRect.w - 120; // near right wall
      witchRect.y = ch - witchRect.h - 40; // stand slightly above bottom
    }

    if (frame && witchFrame && witchRect.w > 0 && witchRect.h > 0) {
      const heroFeetY = heroY + HERO_H;
      const witchFeetY = witchRect.y + witchRect.h;

      if (heroFeetY < witchFeetY) {
        // hero "behind" witch
        drawHero(frame);
        ctx!.drawImage(
          witchFrame,
          witchRect.x,
          witchRect.y,
          witchRect.w,
          witchRect.h
        );
      } else {
        // hero in front of witch
        ctx!.drawImage(
          witchFrame,
          witchRect.x,
          witchRect.y,
          witchRect.w,
          witchRect.h
        );
        drawHero(frame);
      }
    } else if (frame) {
      drawHero(frame);
    }
  }

  requestAnimationFrame(step);
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
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

    const imgs = await Promise.all(urls.map(loadImage));

    let idx = 0;
    groundImg = imgs[idx++];
    hutImg = imgs[idx++];
    insideImg = imgs[idx++];

    groundPattern = ctx!.createPattern(groundImg!, "repeat");

    const idleCount = HERO_IDLE_URLS.length;
    const walkLeftCount = HERO_WALK_LEFT_URLS.length;
    const walkRightCount = HERO_WALK_RIGHT_URLS.length;
    const witchCount = WITCH_IDLE_URLS.length;

    heroIdleFrames = imgs.slice(idx, idx + idleCount);
    idx += idleCount;

    heroWalkLeftFrames = imgs.slice(idx, idx + walkLeftCount);
    idx += walkLeftCount;

    heroWalkRightFrames = imgs.slice(idx, idx + walkRightCount);
    idx += walkRightCount;

    witchFrames = imgs.slice(idx, idx + witchCount);
    idx += witchCount;

    heroFallbackImg =
      heroIdleFrames[0] ||
      heroWalkLeftFrames[0] ||
      heroWalkRightFrames[0] ||
      null;

    // Start hero in bottom-left corner (outside)
    const MARGIN_X = 40;
    const MARGIN_Y = 40;
    heroX = MARGIN_X;
    heroY = canvas!.height - HERO_H - MARGIN_Y;

    requestAnimationFrame(step);
  } catch (err) {
    console.error("Failed to load Dreadheim Outskirts assets:", err);
  }
}

init();

export {};


















