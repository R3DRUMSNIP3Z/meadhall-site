// =======================================================
// Valhalla Ascending — Class Pick Screen
// Fully Animated Sprite Preview (256x256, 9 frames)
// =======================================================

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
  portrait: string;       // sprite sheet (for animated preview)
  stats: ClassStats;
};

// ------------------------
//  Classes
// ------------------------
const classes: ClassSpec[] = [
  {
    id: "warrior",
    name: "Warrior",
    role: "Frontline Tank / Bruiser",
    desc: "Warriors hold the line with steel and stubborn will.",
    portrait: "/guildbook/avatars/class-warrior.png",
    stats: { power: 70, defense: 85, speed: 55, control: 40, difficulty: 40 }
  },

  {
    id: "shieldmaiden",
    name: "Shieldmaiden",
    role: "Defender / Support",
    desc: "Shieldmaidens fight with blade and board, guarding allies.",
    portrait: "/guildbook/avatars/shieldmaiden-spritesheet.png",
    stats: { power: 65, defense: 80, speed: 60, control: 55, difficulty: 50 }
  },

  {
    id: "rune-mage",
    name: "Rune-Mage",
    role: "Burst Caster",
    desc: "Rune-Mages wield ancient magic to devastate foes.",
    portrait: "/guildbook/avatars/class-runemage.png",
    stats: { power: 90, defense: 35, speed: 65, control: 75, difficulty: 80 }
  },

  {
    id: "berserker",
    name: "Berserker",
    role: "Melee Frenzy",
    desc: "Berserkers unleash unstoppable rage in battle.",
    portrait: "/guildbook/avatars/class-berserker.png",
    stats: { power: 95, defense: 55, speed: 70, control: 35, difficulty: 65 }
  },

  {
    id: "hunter",
    name: "Hunter",
    role: "Ranged Assassin",
    desc: "Hunters strike from afar with deadly precision.",
    portrait: "/guildbook/avatars/class-hunter.png",
    stats: { power: 80, defense: 45, speed: 85, control: 60, difficulty: 55 }
  }
];

// ------------------------
// DOM
// ------------------------
const grid = document.getElementById("classGrid")!;
const pvName = document.getElementById("pvName")!;
const pvRole = document.getElementById("pvRole")!;
const pvDesc = document.getElementById("pvDesc")!;
const pvStats = document.getElementById("pvStats")!;
const btnSelect = document.getElementById("btnSelect")!;

const canvas = document.getElementById("previewCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// ------------------------
// Rendering class cards
// ------------------------
function renderCards() {
  grid.innerHTML = "";

  for (const c of classes) {
    const div = document.createElement("div");
    div.className = "class-card";
    div.dataset.id = c.id;
    div.innerHTML = `
      <div class="class-name">${c.name}</div>
    `;
    grid.appendChild(div);
  }
}

// ------------------------
// Animated sprite preview
// ------------------------
let selected: ClassSpec | null = null;

let frame = 0;
let frameTimer = 0;
const FRAME_COUNT = 9;
const FRAME_WIDTH = 256;
const FRAME_HEIGHT = 256;

const sprite = new Image();

function animate(ts: number) {
  requestAnimationFrame(animate);

  if (!selected) return;
  if (!sprite.complete) return;

  frameTimer += ts;

  if (frameTimer > 90) {
    frame = (frame + 1) % FRAME_COUNT;
    frameTimer = 0;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    sprite,
    frame * FRAME_WIDTH, 0,
    FRAME_WIDTH, FRAME_HEIGHT,
    0, 0,
    FRAME_WIDTH, FRAME_HEIGHT
  );
}

requestAnimationFrame(animate);

// ------------------------
// Update right-side panel
// ------------------------
function renderPreview(c: ClassSpec) {
  selected = c;

  sprite.src = c.portrait;

  pvName.textContent = c.name;
  pvRole.textContent = c.role;
  pvDesc.textContent = c.desc;

  // Stats
  pvStats.innerHTML = "";
  for (const [k, v] of Object.entries(c.stats)) {
    const label = k.toUpperCase();
    pvStats.innerHTML += `
      <div class="stat">
        ${label}
        <div class="bar-wrap"><div class="bar" style="width:${v}%;"></div></div>
      </div>
    `;
  }

  // highlight card
  for (const el of grid.children) {
    (el as HTMLElement).classList.remove("active");
  }
  const active = grid.querySelector(`[data-id="${c.id}"]`);
  if (active) active.classList.add("active");
}

grid.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement | null;
  if (!target) return;

  const card = target.closest(".class-card") as HTMLElement | null;
  if (!card) return;

  const id = card.dataset?.id as ClassId;
  if (!id) return;

  const c = classes.find(x => x.id === id);
  if (!c) return;

  renderPreview(c);
});


// ------------------------
// Select button
// ------------------------
btnSelect.addEventListener("click", () => {
  if (!selected) return alert("Choose a class first!");

  localStorage.setItem("va_class", selected.id);
  localStorage.setItem("va_class_name", selected.name);

  const uid = getUserId();
  if (uid) location.href = `/game.html?user=${uid}`;
  else location.href = "/game.html";
});

function getUserId(): string | null {
  try {
    const p = new URLSearchParams(location.search);
    return p.get("user");
  } catch {
    return null;
  }
}

// ------------------------
// Start
// ------------------------
renderCards();
renderPreview(classes[1]); // default Shieldmaiden


