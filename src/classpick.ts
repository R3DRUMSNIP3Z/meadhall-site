// ===============================
// Valhalla Ascending — Class Pick
// ===============================

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
  icon: string;
  role: string;
  flavor: string;
  tags: string[];
  portrait: string; // can be a single image OR a 9-frame spritesheet
  stats: ClassStats;
  desc: string;
};

const CLASS_KEY = "va_class";
const CLASS_NAME_KEY = "va_class_name";

/* ---------------------------------
   Helpers
---------------------------------- */
function getUserIdFromQuery(): string | null {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("user");
  } catch {
    return null;
  }
}

/* ---------------------------------
   Class data
   (point these to your real images)
---------------------------------- */
const classes: ClassSpec[] = [
  {
    id: "warrior",
    name: "Warrior",
    icon: "W",
    role: "Frontline Tank / Bruiser",
    flavor: "Heavy armor, shield, and steady damage.",
    tags: ["Melee", "Tank", "Physical"],
    // TODO: replace with your warrior sheet / art
    portrait: "/guildbook/avatars/class-warrior.png",
    stats: { power: 70, defense: 85, speed: 55, control: 40, difficulty: 40 },
    desc: "Warriors hold the line with steel and stubborn will. They excel at soaking damage, protecting allies, and punishing foes who dare draw near.",
  },
  {
    id: "shieldmaiden",
    name: "Shieldmaiden",
    icon: "S",
    role: "Off-Tank / Support",
    flavor: "Defensive stance with team buffs.",
    tags: ["Melee", "Support", "Defender"],
    // ⬇️ use your 9-frame 256x256 sheet here
    portrait: "/guildbook/avatars/shieldmaiden-spritesheet.png",
    stats: { power: 65, defense: 80, speed: 60, control: 55, difficulty: 50 },
    desc: "Shieldmaidens fight at the front with blade and board, granting protection and boons to allies while counterstriking enemies who overextend.",
  },
  {
    id: "rune-mage",
    name: "Rune-Mage",
    icon: "R",
    role: "Burst Caster",
    flavor: "High damage, low defense.",
    tags: ["Magic", "Burst", "Ranged"],
    portrait: "/guildbook/avatars/class-runemage.png",
    stats: { power: 90, defense: 35, speed: 65, control: 75, difficulty: 80 },
    desc: "Rune-Mages etch the air with ancient sigils, unleashing storms of fire and ice. Fragile up close, but terrifying when left unchecked.",
  },
  {
    id: "berserker",
    name: "Berserker",
    icon: "B",
    role: "All-In Bruiser",
    flavor: "Big crits, risky playstyle.",
    tags: ["Melee", "Burst", "Frenzy"],
    portrait: "/guildbook/avatars/class-berserker.png",
    stats: { power: 95, defense: 55, speed: 70, control: 35, difficulty: 65 },
    desc: "Berserkers thrive on chaos, diving into the heart of battle with reckless abandon. The longer they fight, the harder they are to stop.",
  },
  {
    id: "hunter",
    name: "Hunter",
    icon: "H",
    role: "Ranged DPS / Kiter",
    flavor: "Bows, traps, and mobility.",
    tags: ["Ranged", "Kite", "Physical"],
    portrait: "/guildbook/avatars/class-hunter.png",
    stats: { power: 80, defense: 45, speed: 85, control: 60, difficulty: 55 },
    desc: "Hunters dance along the edge of danger, using bows, traps, and animal cunning to whittle enemies down from a safe distance.",
  },
];

/* ---------------------------------
   DOM refs
---------------------------------- */
const classList = document.getElementById("classList") as HTMLDivElement | null;

const previewName = document.getElementById("previewClassName") as HTMLElement | null;
const previewTags = document.getElementById("previewTags") as HTMLDivElement | null;
const previewDesc = document.getElementById("previewDesc") as HTMLElement | null;
const previewStats = document.getElementById("previewStats") as HTMLDivElement | null;

const previewPortraitImg =
  document.getElementById("previewPortrait") as HTMLImageElement | null;

// Optional canvas (for animated spritesheet preview)
const previewCanvas =
  document.getElementById("previewCanvas") as HTMLCanvasElement | null;
const previewCtx = previewCanvas ? previewCanvas.getContext("2d") : null;

const confirmBtn = document.getElementById("confirmBtn") as HTMLButtonElement | null;

let selectedId: ClassId | null = null;

/* ---------------------------------
   Optional sprite-sheet animation
   Uses 9 frames, 3x3, 256x256 each.
   If no canvas present, we just skip this
   and use <img> as a static preview.
---------------------------------- */
const FRAME_W = 256;
const FRAME_H = 256;
const FRAMES = 9;
const COLUMNS = 3;

let animSheet: HTMLImageElement | null = null;
let animFrame = 0;
let animAccum = 0;
let animLastTime = 0;
let animRunning = false;

function loadSheet(url: string): HTMLImageElement {
  const img = new Image();
  img.src = url;
  img.crossOrigin = "anonymous";
  return img;
}

function startPreviewAnimation(url: string): void {
  if (!previewCanvas || !previewCtx) return;

  animSheet = loadSheet(url);
  animFrame = 0;
  animAccum = 0;
  animLastTime = performance.now();
  if (!animRunning) {
    animRunning = true;
    requestAnimationFrame(stepAnim);
  }
}

function stepAnim(timestamp: number): void {
  if (!previewCanvas || !previewCtx || !animSheet) {
    animRunning = false;
    return;
  }

  const dt = (timestamp - animLastTime) / 1000;
  animLastTime = timestamp;

  animAccum += dt;
  // animation speed: adjust this to taste
  const FRAME_TIME = 0.12;
  while (animAccum >= FRAME_TIME) {
    animAccum -= FRAME_TIME;
    animFrame = (animFrame + 1) % FRAMES;
  }

  // Clear canvas
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

  const col = animFrame % COLUMNS;
  const row = Math.floor(animFrame / COLUMNS);

  // Center hero in preview canvas
  const destW = FRAME_W;
  const destH = FRAME_H;
  const dx = (previewCanvas.width - destW) / 2;
  const dy = (previewCanvas.height - destH) / 2;

  previewCtx.drawImage(
    animSheet,
    col * FRAME_W,
    row * FRAME_H,
    FRAME_W,
    FRAME_H,
    dx,
    dy,
    destW,
    destH
  );

  requestAnimationFrame(stepAnim);
}

/* ---------------------------------
   Build class cards
---------------------------------- */
function buildClassCards(): void {
  if (!classList) return;
  classList.innerHTML = "";

  for (const cls of classes) {
    const card = document.createElement("article");
    card.className = "class-card";
    card.dataset.id = cls.id;

    card.innerHTML = `
      <div class="class-icon">${cls.icon}</div>
      <div class="class-main">
        <div class="class-name">${cls.name}</div>
        <div class="class-role">${cls.role}</div>
        <div class="class-flavor">${cls.flavor}</div>
      </div>
    `;

    card.addEventListener("click", () => selectClass(cls.id));
    classList.appendChild(card);
  }
}

/* ---------------------------------
   Select + preview a class
---------------------------------- */
function selectClass(id: ClassId): void {
  selectedId = id;
  if (!classList) return;

  // Highlight selected card
  const cards = Array.from(classList.querySelectorAll<HTMLElement>(".class-card"));
  for (const card of cards) {
    const isSelected = card.dataset.id === id;
    card.classList.toggle("is-selected", isSelected);
  }

  const cls = classes.find((c) => c.id === id);
  if (!cls) return;

  // Text info
  if (previewName) previewName.textContent = cls.name;

  if (previewTags) {
    previewTags.innerHTML = "";
    for (const t of cls.tags) {
      const span = document.createElement("span");
      span.className = "tag-pill";
      span.textContent = t;
      previewTags.appendChild(span);
    }
  }

  if (previewDesc) {
    previewDesc.textContent = cls.desc;
  }

  // Stats
  if (previewStats) {
    previewStats.innerHTML = "";
    const { power, defense, speed, control, difficulty } = cls.stats;
    const entries: Array<[string, number]> = [
      ["Power", power],
      ["Defense", defense],
      ["Speed", speed],
      ["Control", control],
      ["Difficulty", difficulty],
    ];

    for (const [label, value] of entries) {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `
        <div class="stat-label">${label}</div>
        <div class="stat-bar-wrap">
          <div class="stat-bar-fill" style="width:${value}%;"></div>
        </div>
        <div class="stat-value">${value}</div>
      `;
      previewStats.appendChild(row);
    }
  }

  // Image / animated preview
  if (previewCanvas && previewCtx) {
    // Canvas exists → animate sprite sheet
    startPreviewAnimation(cls.portrait);
  } else if (previewPortraitImg) {
    // Fallback: just show the image
    previewPortraitImg.style.opacity = "1";
    previewPortraitImg.src = cls.portrait;
  }

  if (confirmBtn) confirmBtn.disabled = false;
}

/* ---------------------------------
   Save choice + go to game
---------------------------------- */
function saveAndEnter(): void {
  if (!selectedId) return;

  const cls = classes.find((c) => c.id === selectedId) || null;

  try {
    localStorage.setItem(CLASS_KEY, selectedId);
    if (cls) {
      localStorage.setItem(CLASS_NAME_KEY, cls.name);
    }
  } catch (err) {
    console.warn("Could not save class to localStorage:", err);
  }

  const userId = getUserIdFromQuery();
  const qs = userId ? `?user=${encodeURIComponent(userId)}` : "";
  window.location.href = `/game.html${qs}`;
}

/* ---------------------------------
   Restore previous selection
---------------------------------- */
function restorePreviousSelection(): void {
  try {
    const prev = localStorage.getItem(CLASS_KEY) as ClassId | null;
    if (!prev) return;
    if (!classes.some((c) => c.id === prev)) return;
    selectClass(prev);
  } catch {
    // ignore
  }
}

/* ---------------------------------
   Init
---------------------------------- */
function initClassPick(): void {
  buildClassCards();
  restorePreviousSelection();

  if (confirmBtn) {
    confirmBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      saveAndEnter();
    });
  }
}

document.addEventListener("DOMContentLoaded", initClassPick);

