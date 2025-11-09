// --- Dreadheim • Forest Entrance (platformer basics) ---
const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// ====== CONFIG ======
const WALKWAY_TOP_RATIO = 0.86; // % of screen height where the walkway top sits (tweak!)
const SPEED = 4;                 // horizontal speed (px/frame)
const GRAVITY = 0.8;             // downward accel
const JUMP_VELOCITY = -16;       // jump strength (negative = up)
const PLAYER_W = 96;
const PLAYER_H = 96;

// ====== DPR / Resize ======
function fitCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener("resize", () => {
  fitCanvas();
  // Re-clamp to ground when resizing
  groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);
  if (player.y > groundY - PLAYER_H) {
    player.y = groundY - PLAYER_H;
    player.vy = 0;
    player.onGround = true;
  }
});

// ====== ASSETS ======
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Missing asset: " + src));
    img.src = src;
  });
}
const BG_URL = "/guildbook/maps/dreadheimforest.png";
const PLAYER_URL = "/guildbook/avatars/dreadheim-warrior.png";

let bg: HTMLImageElement | null = null;
let playerImg: HTMLImageElement | null = null;

// ====== WORLD / PLAYER ======
let groundY = Math.round(window.innerHeight * WALKWAY_TOP_RATIO);

const player = {
  x: Math.max(0, Math.min(window.innerWidth - PLAYER_W, window.innerWidth / 2 - PLAYER_W / 2)),
  y: groundY - PLAYER_H,
  w: PLAYER_W,
  h: PLAYER_H,
  vx: 0,
  vy: 0,
  onGround: true,
};

// ====== INPUT ======
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.key);

  // Jump on press (only if grounded)
  if ((e.key === " " || e.key === "w" || e.key === "W" || e.key === "ArrowUp") && player.onGround) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key));

// ====== UPDATE / PHYSICS ======
function step() {
  // Horizontal intent
  let vx = 0;
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) vx -= SPEED;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) vx += SPEED;
  player.vx = vx;

  // Apply horizontal
  player.x += player.vx;

  // Clamp within screen
  const maxX = window.innerWidth - player.w;
  if (player.x < 0) player.x = 0;
  if (player.x > maxX) player.x = maxX;

  // Gravity
  player.vy += GRAVITY;
  player.y += player.vy;

  // Ground collision
  const floor = groundY - player.h;
  if (player.y >= floor) {
    player.y = floor;
    player.vy = 0;
    player.onGround = true;
  }
}

// ====== RENDER ======
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);
  if (playerImg) ctx.drawImage(playerImg, player.x, player.y, player.w, player.h);

  // // DEBUG: draw ground line (uncomment to fine-tune ratio)
  // ctx.strokeStyle = "rgba(255,255,0,.6)";
  // ctx.beginPath();
  // ctx.moveTo(0, groundY);
  // ctx.lineTo(window.innerWidth, groundY);
  // ctx.stroke();
}

function loop() {
  step();
  render();
  requestAnimationFrame(loop);
}

// ====== BOOT ======
Promise.all([loadImage(BG_URL), loadImage(PLAYER_URL)])
  .then(([bgImg, pImg]) => {
    bg = bgImg;
    playerImg = pImg;
    loop();
  })
  .catch((err) => {
    console.warn(err.message);
    loop(); // still run; we’ll draw whatever loaded
  });


