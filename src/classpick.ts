// ==============================================
// Valhalla Ascending — Class Pick (image frames)
// Animates separate PNGs like the chibi preview
// ==============================================

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
  frames: string[];   // list of frame URLs (first one also used as icon/preview)
  stats: ClassStats;
};

const CLASS_KEY = "va_class";
const CLASS_NAME_KEY = "va_class_name";

/* ---------------- Helpers ---------------- */

function getUserIdFromQuery(): string | null {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("user");
  } catch {
    return null;
  }
}

// Build Shieldmaiden frame list sm_000.png ... sm_008.png
const shieldFrames: string[] = Array.from({ length: 9 }, (_, i) => {
  const n = i.toString().padStart(3, "0"); // 000, 001, ...
  return `/guildbook/avatars/shieldmaiden/sm_${n}.png`;
});

/* --------------- Class data --------------- */

const classes: ClassSpec[] = [
  {
    id: "warrior",
    name: "Warrior",
    role: "Frontline Tank / Bruiser",
    desc: "Warriors hold the line with steel and stubborn will.",
    frames: ["/logo/logo-512.png"], // TODO: replace with warrior frames
    stats: { power: 70, defense: 85, speed: 55, control: 40, difficulty: 40 },
  },
  {
    id: "shieldmaiden",
    name: "Shieldmaiden",
    role: "Defender / Support",
    desc: "Shieldmaidens fight with blade and board, guarding allies.",
    frames: shieldFrames,
    stats: { power: 65, defense: 80, speed: 60, control: 55, difficulty: 50 },
  },
  {
    id: "rune-mage",
    name: "Rune-Mage",
    role: "Burst Caster",
    desc: "Rune-Mages wield ancient magic to devastate foes.",
    frames: ["/logo/logo-512.png"],
    stats: { power: 90, defense: 35, speed: 65, control: 75, difficulty: 80 },
  },
  {
    id: "berserker",
    name: "Berserker",
    role: "Melee Frenzy",
    desc: "Berserkers unleash unstoppable rage in battle.",
    frames: ["/logo/logo-512.png"],
    stats: { power: 95, defense: 55, speed: 70, control: 35, difficulty: 65 },
  },
  {
    id: "hunter",
    name: "Hunter",
    role: "Ranged Assassin",
    desc: "Hunters strike from afar with deadly precision.",
    frames: ["/logo/logo-512.png"],
    stats: { power: 80, defense: 45, speed: 85, control: 60, difficulty: 55 },
  },
];

/* ---------------- DOM refs ---------------- */

const tabsEl = document.getElementById("classTabs") as HTMLDivElement | null;
const previewImg = document.getElementById("previewPortrait") as HTMLImageElement | null;
const pvName = document.getElementById("pvName") as HTMLElement | null;
const pvRole = document.getElementById("pvRole") as HTMLElement | null;
const pvDesc = document.getElementById("pvDesc") as HTMLElement | null;
const pvStats = document.getElementById("pvStats") as HTMLDivElement | null;
const btnSelect = document.getElementById("btnSelect") as HTMLButtonElement | null;

/* ------------- Animation state ------------ */

let currentClass: ClassSpec | null = null;
let currentFrames: string[] = [];
let frameIndex = 0;

const FRAME_MS = 120;
let animTimer: number | undefined;

/* ----------------- UI build ---------------- */

function buildTabs() {
  if (!tabsEl) return;
  tabsEl.innerHTML = "";

  for (const c of classes) {
    const tab = document.createElement("div");
    tab.className = "class-tab";
    tab.textContent = c.name;
    tab.dataset.id = c.id;
    tabsEl.appendChild(tab);
  }
}

/* ------------- Animation control ---------- */

function startAnimation(frames: string[]) {
  currentFrames = frames;
  frameIndex = 0;

  if (previewImg && frames.length) {
    previewImg.src = frames[0];
  }

  if (animTimer !== undefined) {
    window.clearInterval(animTimer);
  }

  if (!previewImg || frames.length <= 1) return;

  animTimer = window.setInterval(() => {
    if (!previewImg || !currentFrames.length) return;
    frameIndex = (frameIndex + 1) % currentFrames.length;
    previewImg.src = currentFrames[frameIndex];
  }, FRAME_MS);
}

/* ------------ Preview rendering ----------- */

function renderPreview(c: ClassSpec) {
  currentClass = c;

  // tabs highlight
  if (tabsEl) {
    Array.from(tabsEl.children).forEach((el) =>
      (el as HTMLElement).classList.toggle(
        "active",
        (el as HTMLElement).dataset.id === c.id
      )
    );
  }

  if (pvName) pvName.textContent = c.name;
  if (pvRole) pvRole.textContent = c.role;
  if (pvDesc) pvDesc.textContent = c.desc;

  if (pvStats) {
    pvStats.innerHTML = "";
    const entries: Array<[string, number]> = Object.entries(c.stats) as any;

    for (const [key, value] of entries) {
      const label = key.toUpperCase();
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `
        <div class="stat-label">${label}<span class="bar-value">${value}</span></div>
        <div class="bar-wrap"><div class="bar" style="width:${value}%;"></div></div>
      `;
      pvStats.appendChild(row);
    }
  }

  startAnimation(c.frames);
}

/* ----------------- Events ----------------- */

tabsEl?.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  const tab = target.closest(".class-tab") as HTMLElement | null;
  if (!tab) return;

  const id = tab.dataset.id as ClassId | undefined;
  if (!id) return;

  const c = classes.find((x) => x.id === id);
  if (!c) return;

  renderPreview(c);
});

btnSelect?.addEventListener("click", () => {
  if (!currentClass) {
    alert("Choose a class first!");
    return;
  }

  try {
    localStorage.setItem(CLASS_KEY, currentClass.id);
    localStorage.setItem(CLASS_NAME_KEY, currentClass.name);
  } catch (err) {
    console.warn("Could not save class selection:", err);
  }

  const uid = getUserIdFromQuery();
  const qs = uid ? `?user=${encodeURIComponent(uid)}` : "";
  window.location.href = `/game.html${qs}`;
});

/* ----------------- Init ------------------- */

function init() {
  buildTabs();
  // default to Shieldmaiden if available
  const def = classes.find((c) => c.id === "shieldmaiden") ?? classes[0];
  renderPreview(def);
}

document.addEventListener("DOMContentLoaded", init);




