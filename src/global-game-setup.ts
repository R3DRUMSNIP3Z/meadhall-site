// /src/global-game-setup.ts
// Runs on every game page that includes it

import { Inventory } from "./inventory";

// ---------- Gender fallback + sprite helper ----------
if (!localStorage.getItem("va_gender")) {
  localStorage.setItem("va_gender", "male");
}
(window as any).getHeroSprite = function (): string {
  const g = localStorage.getItem("va_gender");
  return g === "female"
    ? "/guildbook/avatars/dreadheim-shieldmaiden.png"
    : "/guildbook/avatars/dreadheim-warrior.png";
};

// ---------- Inject minimal styles (bag button + badge) ----------
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
  }
  `;
  const s = document.createElement("style");
  s.id = "vaGlobalStyle";
  s.textContent = css;
  document.head.appendChild(s);
})();

// ---------- Build the floating Bag button once ----------
function ensureBagButton() {
  if (document.getElementById("vaBagBtn")) return;

  const btn = document.createElement("button");
  btn.id = "vaBagBtn";
  btn.title = "Inventory";
  btn.innerHTML = `
    <img src="/guildbook/loot/bag.png" alt="Bag" onerror="this.style.display='none'">
    <span id="vaBagBadge"></span>
  `;
  document.body.appendChild(btn);

  btn.addEventListener("click", () => {
    try { Inventory.toggle(); } catch {}
    clearUnseenBadge();
  });
}
ensureBagButton();

// ---------- Badge storage (persists across pages) ----------
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

// Show correct badge on page load/return
window.addEventListener("pageshow", renderBadge);
window.addEventListener("focus", renderBadge);
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderBadge(); });

// ---------- Inventory init + hooks so badge increments when loot is added ----------
try { Inventory.init(); } catch { /* already inited is fine */ }

// Monkey-patch open/toggle so we know when bag is open and clear the red dot
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

  wrap("open",  () => { isOpen = true;  clearUnseenBadge(); });
  wrap("show",  () => { isOpen = true;  clearUnseenBadge(); });
  wrap("toggle",() => { isOpen = !isOpen; if (isOpen) clearUnseenBadge(); });
  wrap("close", () => { isOpen = false; });

  // Patch add/remove so unseen counter updates when player picks up items and bag is closed
  if (typeof invAny?.add === "function") {
    const origAdd = invAny.add.bind(Inventory);
    invAny.add = (...args: any[]) => {
      const r = origAdd(...args);
      if (!isOpen) setUnseen(getUnseen() + 1);
      return r;
    };
  }
})();

