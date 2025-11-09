// --- Dreadheim • Forest Entrance (Vite TS) ---
// Canvas + DPR-safe sizing
const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

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
window.addEventListener("resize", fitCanvas);

// Utility: load image with promise + error guard
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Missing asset: " + src));
    img.src = src;
  });
}

// Static asset paths (served from /public)
const BG_URL = "/guildbook/maps/dreadheimforest.png";
const PLAYER_URL = "/guildbook/avatars/dreadheim-warrior.png";

// Player state
const player = {
  x: window.innerWidth / 2 - 16,
  y: window.innerHeight - 120,
  w: 64,
  h: 64,
  speed: 3,
};

let bg: HTMLImageElement | null = null;
let playerImg: HTMLImageElement | null = null;

// Input (arrows + WASD)
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key));
window.addEventListener("keyup", (e) => keys.delete(e.key));

function step() {
  // Horizontal
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) player.x -= player.speed;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) player.x += player.speed;
  // Vertical
  if (keys.has("ArrowUp") || keys.has("w") || keys.has("W")) player.y -= player.speed;
  if (keys.has("ArrowDown") || keys.has("s") || keys.has("S")) player.y += player.speed;

  // Clamp to screen
  const maxX = window.innerWidth - player.w;
  const maxY = window.innerHeight - player.h;
  if (player.x < 0) player.x = 0;
  if (player.y < 0) player.y = 0;
  if (player.x > maxX) player.x = maxX;
  if (player.y > maxY) player.y = maxY;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);
  if (playerImg) ctx.drawImage(playerImg, player.x, player.y, player.w, player.h);
}

function loop() {
  step();
  render();
  requestAnimationFrame(loop);
}

// Load assets, then start loop (even if one is missing)
Promise.all([loadImage(BG_URL), loadImage(PLAYER_URL)])
  .then(([bgImg, pImg]) => {
    bg = bgImg;
    playerImg = pImg;
    loop();
  })
  .catch((err) => {
    console.warn(err.message);
    // Try to keep going with whatever loaded
    Promise.allSettled([loadImage(BG_URL), loadImage(PLAYER_URL)]).then((res) => {
      if (res[0].status === "fulfilled") bg = res[0].value;
      if (res[1].status === "fulfilled") playerImg = res[1].value;
      loop();
    });
  });

// Optional: cache-bust during dev (uncomment if Vercel cache gets sticky)
// const bust = "?v=" + Date.now();
// BG_URL += bust; PLAYER_URL += bust;


