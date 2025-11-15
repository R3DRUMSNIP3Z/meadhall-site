// =========================================
// Valhalla Ascending — Class Pick (frames)
// =========================================

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
  tags: string[];
  frames: string[];
  stats: ClassStats;
};

const CLASS_KEY = "va_class";
const CLASS_NAME_KEY = "va_class_name";

/* -------- helpers -------- */

function getUserIdFromQuery(): string | null {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("user");
  } catch {
    return null;
  }
}

/* -------- frame lists (9 each) -------- */

const warriorFrames: string[] = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/warrior/war_${i.toString().padStart(3, "0")}.png`
);

const shieldFrames: string[] = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/shieldmaiden/sm_${i.toString().padStart(3, "0")}.png`
);

const runeFrames: string[] = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/rune-mage/rm_${i.toString().padStart(3, "0")}.png`
);

const berserkerFrames: string[] = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/berserker/b_${i.toString().padStart(3, "0")}.png`
);

const hunterFrames: string[] = Array.from({ length: 9 }, (_, i) =>
  `/guildbook/avatars/hunter/h_${i.toString().padStart(3, "0")}.png`
);

/* -------- class data -------- */

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
    desc: "Rune-Mages harness ancient runes to unleash devastating magic.",
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

/* -------- DOM refs -------- */

const tabsEl = document.getElementById("classTabs") as HTMLDivElement | null;
const previewImg = document.getElementById("previewPortrait") as HTMLImageElement | null;
const nameEl = document.getElementById("pvName") as HTMLElement | null;
const roleEl = document.getElementById("pvRole") as HTMLElement | null;
const descEl = document.getElementById("pvDesc") as HTMLElement | null;
const tagsEl = document.getElementById("pvTags") as HTMLDivElement | null;
const statsWrap = document.getElementById("pvStats") as HTMLDivElement | null;
const btnSelect = document.getElementById("btnSelect") as HTMLButtonElement | null;

/* -------- animation state -------- */

let currentClass: ClassSpec | null = null;
let animFrames: string[] = [];
let animIndex = 0;
const FRAME_MS = 120;
let animTimer: number | undefined;

/* -------- UI builders -------- */

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

function startAnimation(frames: string[]) {
  animFrames = frames;
  animIndex = 0;

  if (previewImg && frames.length) {
    previewImg.src = frames[0];
  }

  if (animTimer !== undefined) {
    window.clearInterval(animTimer);
  }

  if (!previewImg || frames.length <= 1) return;

  animTimer = window.setInterval(() => {
    if (!previewImg || !animFrames.length) return;
    animIndex = (animIndex + 1) % animFrames.length;
    previewImg.src = animFrames[animIndex];
  }, FRAME_MS);
}

function renderStats(stats: ClassStats) {
  if (!statsWrap) return;
  statsWrap.innerHTML = "";

  const entries: Array<[keyof ClassStats, number]> = Object.entries(stats) as any;

  for (const [key, value] of entries) {
    const label = key.toUpperCase();
    const row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML = `
      <div class="stat-label">
        ${label}
        <span class="bar-value">${value}</span>
      </div>
      <div class="bar-wrap">
        <div class="bar" style="width:${value}%;"></div>
      </div>
    `;
    statsWrap.appendChild(row);
  }
}

function renderTags(tags: string[]) {
  if (!tagsEl) return;
  tagsEl.innerHTML = "";
  for (const t of tags) {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = t;
    tagsEl.appendChild(span);
  }
}

/* -------- render preview -------- */

function renderPreview(c: ClassSpec) {
  currentClass = c;

  // highlight tab
  if (tabsEl) {
    Array.from(tabsEl.children).forEach((el) => {
      (el as HTMLElement).classList.toggle(
        "active",
        (el as HTMLElement).dataset.id === c.id
      );
    });
  }

  if (nameEl) nameEl.textContent = c.name;
  if (roleEl) roleEl.textContent = c.role;
  if (descEl) descEl.textContent = c.desc;

  renderTags(c.tags);
  renderStats(c.stats);
  startAnimation(c.frames);
}

/* -------- events -------- */

tabsEl?.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement | null;
  if (!t) return;
  const tab = t.closest(".class-tab") as HTMLElement | null;
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

/* -------- init -------- */

function init() {
  buildTabs();
  const def = classes.find((c) => c.id === "shieldmaiden") ?? classes[0];
  renderPreview(def);
}

document.addEventListener("DOMContentLoaded", init);






