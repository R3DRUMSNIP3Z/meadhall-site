// /src/global-game-setup.ts
// Runs on every game page that includes it

import { Inventory } from "./inventory";

// Make Inventory accessible to plain <script> pages
(window as any).Inventory = Inventory;

/* =========================================================
   GENDER + GLOBAL SPRITES
   ========================================================= */
if (!localStorage.getItem("va_gender")) {
  localStorage.setItem("va_gender", "male");
}
// reflect gender on <body> for optional CSS theming
document.body?.setAttribute("data-gender", localStorage.getItem("va_gender") || "male");

// Universal hero sprite (used by arena/game.ts and maps if needed)
(window as any).getHeroSprite = function (): string {
  const g = localStorage.getItem("va_gender");
  return g === "female"
    ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
    : "/guildbook/avatars/dreadheim-warrior.png";
};

// --- Global, gender-aware skill icon resolver (used by all battles)
function currentSkillIconMap() {
  const g = localStorage.getItem("va_gender") || "male";
  const maleIcons: Record<string, string> = {
    basic:  "/guildbook/skillicons/drengrstrike.png",
    aoe:    "/guildbook/skillicons/whirlwinddance.png",
    buff:   "/guildbook/skillicons/odinsblessing.png",
    debuff: "/guildbook/skillicons/helsgrasp.png",
  };
  const femaleIcons: Record<string, string> = {
    basic:  "/guildbook/skillicons/valkyrieslash.png",
    aoe:    "/guildbook/skillicons/ragnarokshowl.png",
    buff:   "/guildbook/skillicons/aegisoffreyja.png",
    debuff: "/guildbook/skillicons/cursebreaker.png",
  };
  return g === "female" ? femaleIcons : maleIcons;
}

(window as any).getSkillIcon = function (key: string): string {
  const map = currentSkillIconMap();
  return map[key] || "";
};

// Inject skill icons into any page that has #skillbar .skill
function ensureSkillIconsOnPage() {
  const skillEls = Array.from(document.querySelectorAll<HTMLDivElement>("#skillbar .skill"));
  if (!skillEls.length) return;
  const map = currentSkillIconMap();

  skillEls.forEach(div => {
    const key = (div.dataset.skill || "").toLowerCase();
    if (!key) return;

    let img = div.querySelector<HTMLImageElement>("img.icon");
    const want = map[key] || "";

    if (!img) {
      img = document.createElement("img");
      img.className = "icon";
      img.alt = key;
      img.loading = "lazy";
      img.onerror = () => (img!.style.display = "none");
      // Insert before text label if present
      const label = div.querySelector(":scope > .name");
      if (label) div.insertBefore(img, label);
      else div.prepend(img);
    }

    if (img.src !== location.origin + want && img.src !== want) {
      img.style.display = ""; // ensure visible if it was hidden by onerror
      img.src = want;
    }
  });
}

// Re-run icon injection when gender changes
window.addEventListener("va-gender-changed", (ev: any) => {
  const g = (ev?.detail as string) || localStorage.getItem("va_gender") || "male";
  document.body?.setAttribute("data-gender", g);
  ensureSkillIconsOnPage();
});

// Also try once on load (in case battle pages loaded first)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureSkillIconsOnPage, { once: true });
} else {
  ensureSkillIconsOnPage();
}

/* =========================================================
   BAG BUTTON + BADGE (minimal styles)
   ========================================================= */
(function injectStyles() {
  if (document.getElementById("vaGlobalStyle")) return;
  const css = `
  #vaBagBtn {
    position: fixed; right: 16px; top: 16px; z-index: 100000;
    width: 56px; height: 56px; border-radius: 14px;
    display: grid; place-items: center;
    border: 1px solid rgba(200,169,107,.35);
    background: linear-gradient(180deg, #171a1f, #0e1013);
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    cursor: pointer;
  }
  #vaBagBtn img { width: 34px; height: 34px; object-fit: contain; }
  #vaBagBadge {
    position: absolute; right: -6px; top: -6px;
    min-width: 20px; height: 20px; border-radius: 999px;
    padding: 0 6px;
    background: #b02a2a; color: #fff; font: 12px/20px ui-sans-serif,system-ui;
    text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,.35); display: none;
  }`;
  const s = document.createElement("style");
  s.id = "vaGlobalStyle";
  s.textContent = css;
  document.head.appendChild(s);
})();

function ensureBagButton() {
  if (document.getElementById("vaBagBtn")) return;
  const btn = document.createElement("button");
  btn.id = "vaBagBtn";
  btn.title = "Inventory";
  btn.innerHTML = `
    <img src="/guildbook/ui/inventorybag.png" alt="Bag" onerror="this.style.display='none'">
    <span id="vaBagBadge"></span>
  `;
  document.body.appendChild(btn);

  btn.addEventListener("click", () => {
    try { Inventory.toggle(); } catch {}
    clearUnseenBadge(); // also clear on click
  });
}
ensureBagButton();

/* =========================================================
   BADGE STORAGE (per-user)
   ========================================================= */
const UID_KEY = "mh_user";
function currentUserId(): string {
  try {
    const raw = localStorage.getItem(UID_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      return obj?.id || obj?._id || obj?.user?.id || "guest";
    }
  } catch {}
  return "guest";
}

function unseenKey() { return `va_bag_unseen__${currentUserId()}`; }
function getUnseen(): number {
  return Math.max(0, parseInt(localStorage.getItem(unseenKey()) || "0", 10) || 0);
}
function setUnseen(n: number) {
  const v = Math.max(0, Math.floor(n));
  localStorage.setItem(unseenKey(), String(v));
  renderBadge();
}

function renderBadge() {
  const badge = document.getElementById("vaBagBadge") as HTMLElement | null;
  if (!badge) return;
  const n = getUnseen();
  if (n > 0) {
    badge.textContent = String(n);
    badge.style.display = "inline-block";
  } else {
    badge.textContent = "";
    badge.style.display = "none";
  }
}
function clearUnseenBadge() { setUnseen(0); }

window.addEventListener("pageshow", renderBadge);
window.addEventListener("focus", renderBadge);
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderBadge(); });

/* =========================================================
   INVENTORY INIT
   ========================================================= */
try { Inventory.init(); } catch { /* already inited is fine */ }

/* =========================================================
   SHARED MAP/BAG UTILITIES
   ========================================================= */

// 1) Fix stack number layering (qty bubbles should sit on top)
function fixQtyLayers() {
  document
    .querySelectorAll(
      ".inv-name .inv-qty, .va-name .inv-qty, .inv-name .stack, .va-name .stack, .inv-name .va-qty, .va-name .va-qty, .va-stack, .item-qty"
    )
    .forEach((el) => {
      const bubble = el as HTMLElement;
      const cell = bubble.closest(".inv-cell, .va-item") as HTMLElement | null;
      if (cell) cell.appendChild(bubble);
    });

  document.querySelectorAll(".inv-qty, .va-qty, .item-qty, .va-stack, .stack").forEach((el) => {
    const b = el as HTMLElement;
    b.classList.add("inv-qty");
    Object.assign(b.style, {
      position: "absolute",
      top: "6px",
      right: "6px",
      left: "auto",
      bottom: "auto",
      zIndex: "999",
    } as CSSStyleDeclaration);
  });
}

// 2) Mouse-only inventory: disable keyboard focus inside the bag
function disableInventoryKeyboard() {
  const root =
    (document.querySelector("#inventory, .inventory, .inventory-panel, #bag, .bag-panel") as HTMLElement | null)
    || null;
  if (!root) return;

  const focusables = root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  focusables.forEach((el) => {
    el.setAttribute("tabindex", "-1");
    el.setAttribute("aria-disabled", "true");
  });

  if (root.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur?.();
  }
}

// 3) After-open hook: fix layers, observe changes, clear badge, and disable keyboard
function afterInventoryOpen() {
  setTimeout(() => {
    fixQtyLayers();
    disableInventoryKeyboard();

    const root =
      document.querySelector("#inventory, .inventory, .inventory-panel, #bag, .bag-panel") || document.body;
    try {
      const mo = new MutationObserver(() => {
        fixQtyLayers();
        disableInventoryKeyboard();
      });
      mo.observe(root, { childList: true, subtree: true });
    } catch {}
  }, 0);

  clearUnseenBadge();
}

// Monkey-patch Inventory methods for global behavior
(() => {
  const invAny = Inventory as any;
  let isOpen = false;

  const wrap = (name: string, onCall?: () => void) => {
    if (typeof invAny?.[name] !== "function") return;
    const orig = invAny[name].bind(Inventory);
    invAny[name] = (...args: any[]) => {
      const r = orig(...args);
      onCall?.();
      return r;
    };
  };

  wrap("open",  () => { isOpen = true;  afterInventoryOpen(); });
  wrap("show",  () => { isOpen = true;  afterInventoryOpen(); });
  wrap("toggle",() => { isOpen = !isOpen; if (isOpen) afterInventoryOpen(); else clearUnseenBadge(); });
  wrap("close", () => { isOpen = false; });

  // When items get added and bag is closed, bump unseen badge counter
  if (typeof invAny?.add === "function") {
    const origAdd = invAny.add.bind(Inventory);
    invAny.add = (...args: any[]) => {
      const r = origAdd(...args);
      if (!isOpen) setUnseen(getUnseen() + 1);
      return r;
    };
  }

  // Also clear the badge if the floating bag button is clicked
  const bagBtn = document.querySelector<HTMLElement>("#vaBagBtn, .bag, .inventory-button");
  if (bagBtn) bagBtn.addEventListener("click", () => setTimeout(afterInventoryOpen, 0));
})();
// --- Reposition bag to bottom-right (battle HUD safe)
(() => {
  const style = document.createElement("style");
  style.textContent = `#vaBagBtn{ top:auto !important; bottom:16px !important; }`;
  document.head.appendChild(style);
})();

(() => {
  const style = document.createElement("style");
  style.textContent = `#log { bottom: 150px !important; }`;
  document.head.appendChild(style);
})();





