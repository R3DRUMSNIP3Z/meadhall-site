// ===============================================
// Valhalla Ascending — Class Pick Screen (FULL)
// ===============================================

type ClassId = "warrior" | "shieldmaiden" | "rune-mage" | "berserker" | "hunter";

type ClassSpec = {
  id: ClassId;
  name: string;
  role: string;
  desc: string;
  tags: string[];
  stats: {
    power: number;
    defense: number;
    speed: number;
    control: number;
    difficulty: number;
  };
  frames: string[];
};

const CLASS_KEY = "va_class";
const CLASS_NAME_KEY = "va_class_name";

function getUserIdFromQuery(): string | null {
  try {
    const p = new URLSearchParams(location.search);
    return p.get("user");
  } catch {
    return null;
  }
}

/* ====================================
   Frame Builders (9 frames each)
   ==================================== */

// Warrior (war_000 → war_008)
const warriorFrames = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/warrior/war_${i.toString().padStart(3, "0")}.png`
);

// Shieldmaiden (sm_000 → sm_008)
const shieldFrames = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/shieldmaiden/sm_${i.toString().padStart(3, "0")}.png`
);

// Rune-Mage (rm_000 → rm_008)
const runeFrames = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/rune-mage/rm_${i.toString().padStart(3, "0")}.png`
);

// Berserker (b_000 → b_008)
const berserkerFrames = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/berserker/b_${i.toString().padStart(3, "0")}.png`
);

// Hunter (h_000 → h_008)
const hunterFrames = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/hunter/h_${i.toString().padStart(3, "0")}.png`
);

/* ====================================
   Class Definitions
   ==================================== */

const classes: ClassSpec[] = [
  {
    id: "warrior",
    name: "Warrior",
    role: "Frontline Tank / Bruiser",
    desc: "Warriors stand at the front lines with steel and stubborn will.",
    tags: ["Melee", "Tank", "Physical"],
    frames: warriorFrames,
    stats: { power: 70, defense: 85, speed: 55, control: 40, difficulty: 40 },
  },
  {
    id: "shieldmaiden",
    name: "Shieldmaiden",
    role: "Defender / Support",
    desc: "Shieldmaidens guard allies while striking with shield and blade.",
    tags: ["Melee", "Defender", "Support"],
    frames: shieldFrames,
    stats: { power: 65, defense: 80, speed: 60, control: 55, difficulty: 50 },
  },
  {
    id: "rune-mage",
    name: "Rune-Mage",
    role: "Burst Caster",
    desc: "Rune-Mages unleash devastating magic from afar.",
    tags: ["Magic", "Ranged", "Burst"],
    frames: runeFrames,
    stats: { power: 90, defense: 35, speed: 65, control: 75, difficulty: 80 },
  },
  {
    id: "berserker",
    name: "Berserker",
    role: "Melee Frenzy",
    desc: "Berserkers thrive in chaos, growing stronger as battle rages.",
    tags: ["Melee", "Frenzy", "Burst"],
    frames: berserkerFrames,
    stats: { power: 95, defense: 55, speed: 70, control: 35, difficulty: 65 },
  },
  {
    id: "hunter",
    name: "Hunter",
    role: "Ranged Assassin",
    desc: "Hunters eliminate threats with precision and agility.",
    tags: ["Ranged", "Agile", "Stealth"],
    frames: hunterFrames,
    stats: { power: 80, defense: 45, speed: 85, control: 60, difficulty: 55 },
  },
];

/* ====================================
   DOM
   ==================================== */

const grid = document.getElementById("classGrid")!;
const previewCanvas = document.getElementById("previewCanvas") as HTMLCanvasElement;
const ctx = previewCanvas.getContext("2d")!;

const nameEl = document.getElementById("className")!;
const roleEl = document.getElementById("classRole")!;
const descEl = document.getElementById("classDesc")!;
const statsEl = {
  power: document.getElementById("statPower")!,
  defense: document.getElementById("statDefense")!,
  speed: document.getElementById("statSpeed")!,
  control: document.getElementById("statControl")!,
  difficulty: document.getElementById("statDifficulty")!,
};

let animIndex = 0;
let animTimer: number | null = null;
let currentFrames: string[] = [];

/* ====================================
   Animation Function
   ==================================== */

function playAnimation(frames: string[]) {
  currentFrames = frames;
  animIndex = 0;

  if (animTimer) cancelAnimationFrame(animTimer);

  const img = new Image();
  let frameImages: HTMLImageElement[] = [];
  let loadedCount = 0;

  // Preload frames
  frames.forEach((src, i) => {
    const f = new Image();
    f.src = src;
    f.onload = () => {
      loadedCount++;
      if (loadedCount === frames.length) startLoop();
    };
    frameImages[i] = f;
  });

  function startLoop() {
    function loop() {
      ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

      const frame = frameImages[animIndex];
      if (frame) {
        const scale = 0.9;
        const w = frame.width * scale;
        const h = frame.height * scale;
        const x = (previewCanvas.width - w) / 2;
        const y = (previewCanvas.height - h) / 2;
        ctx.drawImage(frame, x, y, w, h);
      }

      animIndex = (animIndex + 1) % frameImages.length;
      animTimer = requestAnimationFrame(loop);
    }
    loop();
  }
}

/* ====================================
   Render Preview
   ==================================== */

function renderPreview(c: ClassSpec) {
  // Update text
  nameEl.textContent = c.name;
  roleEl.textContent = c.role;
  descEl.textContent = c.desc;

  statsEl.power.style.width = c.stats.power + "%";
  statsEl.defense.style.width = c.stats.defense + "%";
  statsEl.speed.style.width = c.stats.speed + "%";
  statsEl.control.style.width = c.stats.control + "%";
  statsEl.difficulty.style.width = c.stats.difficulty + "%";

  // Play animation
  playAnimation(c.frames);
}

/* ====================================
   Build Class Grid Buttons
   ==================================== */

function buildClassButtons() {
  grid.innerHTML = "";

  classes.forEach((c) => {
    const btn = document.createElement("div");
    btn.className = "class-card";
    btn.dataset.id = c.id;
    btn.textContent = c.name;
    grid.appendChild(btn);
  });
}

buildClassButtons();

/* ====================================
   Click Handler
   ==================================== */

grid.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (!target) return;

  const card = target.closest(".class-card") as HTMLElement | null;
  if (!card) return;

  const id = card.dataset.id as ClassId;
  const c = classes.find((x) => x.id === id);
  if (!c) return;

  // highlight active
  Array.from(grid.children).forEach((el) =>
    (el as HTMLElement).classList.remove("active")
  );
  card.classList.add("active");

  renderPreview(c);
});

/* ====================================
   Select Class Button
   ==================================== */

const selectBtn = document.getElementById("selectClassBtn")!;
selectBtn.addEventListener("click", () => {
  const active = grid.querySelector(".active") as HTMLElement | null;
  if (!active) return;

  const id = active.dataset.id as ClassId;
  const c = classes.find((x) => x.id === id);
  if (!c) return;

  localStorage.setItem(CLASS_KEY, c.id);
  localStorage.setItem(CLASS_NAME_KEY, c.name);

  location.href = "/game.html";
});





