// ===============================================
// Valhalla Ascending — Class Pick (Animated Preview)
// Supports 9-frame 3x3 sprite sheet @ 256x256
// ===============================================

type ClassId = "warrior" | "shieldmaiden" | "rune-mage" | "berserker" | "hunter";

type ClassStats = {
  power: number;
  defense: number;
  speed: number;
  control: number;
  difficulty: number;
};

type ClassSpec = {
  id: ClassId;
  name: string;
  role: string;
  desc: string;
  portrait: string; // sprite sheet or static image
  stats: ClassStats;
};

/* -----------------------------
   Helpers
----------------------------- */
function getUserIdFromQuery(): string | null {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("user");
  } catch {
    return null;
  }
}

/* -----------------------------
   Class data
   (update portrait paths as you add art)
----------------------------- */
const classes: ClassSpec[] = [
  {
    id: "warrior",
    name: "Warrior",
    role: "Frontline Tank / Bruiser",
    desc: "Warriors hold the line with steel and stubborn will.",
    // TEMP: use logo so it doesn't 404; replace with real sheet later
    portrait: "/logo/logo-512.png",
    stats: { power: 70, defense: 85, speed: 55, control: 40, difficulty: 40 },
  },
  {
    id: "shieldmaiden",
    name: "Shieldmaiden",
    role: "Defender / Support",
    desc: "Shieldmaidens fight with blade and board, guarding allies.",
    // ⬇️ your 9-frame 256x256 spritesheet
    portrait: "/guildbook/avatars/shieldmaiden-spritesheet.png",
    stats: { power: 65, defense: 80, speed: 60, control: 55, difficulty: 50 },
  },
  {
    id: "rune-mage",
    name: "Rune-Mage",
    role: "Burst Caster",
    desc: "Rune-Mages wield ancient magic to devastate foes.",
    portrait: "/logo/logo-512.png",
    stats: { power: 90, defense: 35, speed: 65, control: 75, difficulty: 80 },
  },
  {
    id: "berserker",
    name: "Berserker",
    role: "Melee Frenzy",
    desc: "Berserkers unleash unstoppable rage in battle.",
    portrait: "/logo/logo-512.png",
    stats: { power: 95, defense: 55, speed: 70, control: 35, difficulty: 65 },
  },
  {
    id: "hunter",
    name: "Hunter",
    role: "Ranged Assassin",
    desc: "Hunters strike from afar with deadly precision.",
    portrait: "/logo/logo-512.png",
    stats: { power: 80, defense: 45, speed: 85, control: 60, difficulty: 55 },
  },
];

/* -----------------------------
   DOM references
----------------------------- */
const grid = document.getElementById("classGrid") as HTMLDivElement | null;
const pvName = document.getElementById("pvName") as HTMLElement | null;
const pvRole = document.getElementById("pvRole") as HTMLElement | null;
const pvDesc = document.getElementById("pvDesc") as HTMLElement | null;
const pvStats = document.getElementById("pvStats") as HTMLDivElement | null;
const btnSelect = document.getElementById("btnSelect") as HTMLButtonElement | null;

const canvas = document.getElementById("previewCanvas") as HTMLCanvasElement | null;
const ctx = canvas ? canvas.getContext("2d") : null;

/* -----------------------------
   Sprite animation state
----------------------------- */
const FRAME_W = 256;
const FRAME_H = 256;
const FRAMES = 9;
const COLS = 3;
const FRAME_TIME = 0.12; // seconds per frame

let selected: ClassSpec | null = null;
let currentImg: HTMLImageElement | null = null;
let imgReady = false;
let frame = 0;
let frameAccum = 0;
let lastTime = 0;

/* -----------------------------
   Build class buttons
----------------------------- */
function renderCards(): void {
  if (!grid) return;
  grid.innerHTML = "";

  for (const c of classes) {
    const card = document.createElement("div");
    card.className = "class-card";
    card.dataset.id = c.id;
    card.textContent = c.name;
    grid.appendChild(card);
  }
}

/* -----------------------------
   Load sprite sheet safely
----------------------------- */
function setSprite(url: string): void {
  if (!canvas || !ctx) return;

  imgReady = false;
  const img = new Image();
  img.src = url;
  img.onload = () => {
    // only mark ready if this is still the active image
    if (currentImg === img) {
      imgReady = true;
    }
  };
  img.onerror = () => {
    imgReady = false;
    console.warn("Failed to load sprite sheet:", url);
  };

  currentImg = img;
}

/* -----------------------------
   Animation loop
----------------------------- */
function loop(time: number): void {
  requestAnimationFrame(loop);
  if (!canvas || !ctx || !selected || !currentImg || !imgReady) return;

  if (!lastTime) lastTime = time;
  const dt = (time - lastTime) / 1000;
  lastTime = time;

  frameAccum += dt;
  while (frameAccum >= FRAME_TIME) {
    frameAccum -= FRAME_TIME;
    frame = (frame + 1) % FRAMES;
  }

  // 3x3 grid slicing
  const col = frame % COLS;
  const row = Math.floor(frame / COLS);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const dx = (canvas.width - FRAME_W) / 2;
  const dy = (canvas.height - FRAME_H) / 2;

  try {
    ctx.drawImage(
      currentImg,
      col * FRAME_W,              // sx
      row * FRAME_H,              // sy
      FRAME_W,
      FRAME_H,
      dx,
      dy,
      FRAME_W,
      FRAME_H
    );
  } catch (err) {
    console.warn("drawImage failed:", err);
  }
}

/* -----------------------------
   Update preview panel
----------------------------- */
function renderPreview(c: ClassSpec): void {
  selected = c;
  setSprite(c.portrait);

  if (pvName) pvName.textContent = c.name;
  if (pvRole) pvRole.textContent = c.role;
  if (pvDesc) pvDesc.textContent = c.desc;

  if (pvStats) {
    pvStats.innerHTML = "";
    const entries: Array<[string, number]> = Object.entries(c.stats) as any;

    for (const [key, val] of entries) {
      const label = key.toUpperCase();
      const row = document.createElement("div");
      row.className = "stat";
      row.innerHTML = `
        ${label}
        <div class="bar-wrap">
          <div class="bar" style="width:${val}%;"></div>
        </div>
      `;
      pvStats.appendChild(row);
    }
  }

  // highlight card
  if (grid) {
    Array.from(grid.children).forEach((el) =>
      (el as HTMLElement).classList.remove("active")
    );
    const active = grid.querySelector<HTMLElement>(`[data-id="${c.id}"]`);
    active?.classList.add("active");
  }
}

/* -----------------------------
   Handle card clicks
----------------------------- */
if (grid) {
  grid.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const card = target.closest(".class-card") as HTMLElement | null;
    if (!card) return;

    const id = card.dataset.id as ClassId | undefined;
    if (!id) return;

    const cls = classes.find((x) => x.id === id);
    if (!cls) return;

    renderPreview(cls);
  });
}

/* -----------------------------
   Select + go to game
----------------------------- */
btnSelect?.addEventListener("click", () => {
  if (!selected) {
    alert("Choose a class first!");
    return;
  }

  try {
    localStorage.setItem("va_class", selected.id);
    localStorage.setItem("va_class_name", selected.name);
  } catch (err) {
    console.warn("Could not save class selection:", err);
  }

  const uid = getUserIdFromQuery();
  const qs = uid ? `?user=${encodeURIComponent(uid)}` : "";
  window.location.href = `/game.html${qs}`;
});

/* -----------------------------
   Init
----------------------------- */
function init(): void {
  renderCards();

  // default preview: Shieldmaiden
  const shield = classes.find((c) => c.id === "shieldmaiden") || classes[0];
  renderPreview(shield);

  // start animation loop
  requestAnimationFrame(loop);
}

document.addEventListener("DOMContentLoaded", init);



