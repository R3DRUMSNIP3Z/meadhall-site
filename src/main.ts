// ============================
// Mead Hall main (membership checkout + strict lock)
// ============================
console.log("[MH] Vite module loaded");

// ---------------- Year ----------------
const yearEl = document.getElementById("y");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// ---------------- API base resolution ----------------
function pickApiBase(sources: any): string {
  const meta = (sources.meta || "").trim();
  if (meta) return meta;
  if (sources.env && (sources.env as any).VITE_API_BASE) return (sources.env as any).VITE_API_BASE;
  if (sources.vite && (sources.vite as any).VITE_API_BASE) return (sources.vite as any).VITE_API_BASE;
  return "";
}
const metaContent =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || "";
const API_BASE =
  pickApiBase({
    meta: metaContent,
    env: (window as any).ENV || {},
    vite: (import.meta as any)?.env || {},
  }) || "";

// ---------------- Minimal client-side session ----------------
const LS_KEY = "mh_user";
const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "null");
  } catch {
    return null;
  }
};
const setUser = (u: any) => localStorage.setItem(LS_KEY, JSON.stringify(u));
const getCurrentUserId = () => (getUser()?.id ? String(getUser()?.id) : "");

/** refresh from server (safe user) */
async function loadUserFresh(u: any) {
  const base = API_BASE || location.origin;
  if (!u?.id) return u;
  try {
    const r = await fetch(`${base}/api/users/${u.id}`);
    if (!r.ok) throw new Error(await r.text());
    const fresh = await r.json();
    setUser(fresh);
    return fresh;
  } catch {
    return u;
  }
}

// ---------------- Account UI + MeadHall lock refs ----------------
const navAccount = document.getElementById("nav-account") as HTMLAnchorElement | null;
const navMeadHall = document.getElementById("nav-meadhall") as HTMLAnchorElement | null;

// Hard default: start LOCKED until proven otherwise
if (navMeadHall) {
  navMeadHall.classList.add("locked");
  navMeadHall.setAttribute("aria-disabled", "true");
  navMeadHall.setAttribute("tabindex", "-1");
  if (navMeadHall.hasAttribute("href")) navMeadHall.removeAttribute("href");
}

function refreshAccountUI() {
  const u = getUser();
  if (navAccount)
    navAccount.textContent = u ? (u.name ? `${u.name} (Account)` : "Account") : "Sign In";
}
refreshAccountUI();

/** STRICT membership calculation (server-truth only) */
function computeMember(u: any): boolean {
  if (!u) return false;
  if (u.membershipActive === true) return true;

  const nowSec = Math.floor(Date.now() / 1000);
  if (Array.isArray(u.subscriptions)) {
    return u.subscriptions.some((s: any) => {
      const status = String(s?.status || "").toLowerCase();
      const good = status === "active" || status === "trialing";
      const end = typeof s?.current_period_end === "number" ? s.current_period_end : 0;
      return good && end > nowSec;
    });
  }
  return false;
}

// ---------------- Signup modal helpers ----------------
const modal = document.getElementById("signupModal") as HTMLDivElement | null;
const closeBtn = document.getElementById("closeSignup") as HTMLButtonElement | null;
function openSignup() {
  if (modal) {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }
}
function closeSignup() {
  if (modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }
}
closeBtn?.addEventListener("click", closeSignup);

function goAccount() {
  const u = getUser();
  if (!u) {
    openSignup();
    return;
  }
  location.href = "/account.html";
}
navAccount?.addEventListener("click", (e) => {
  e.preventDefault();
  goAccount();
});

// When locked, clicking Mead Hall opens signup (never navigates)
navMeadHall?.addEventListener("click", (e) => {
  const el = e.currentTarget as HTMLAnchorElement;
  if (el.classList.contains("locked")) {
    e.preventDefault();
    openSignup();
  }
});

// ---------------- Membership checkout ----------------
async function startCheckout(plan: string | null) {
  const base = (API_BASE || location.origin).replace(/\/+$/, ""); // trim trailing slashes
  const u = getUser();
  if (!u) {
    openSignup();
    return;
  }
  if (!plan) {
    alert("Missing plan");
    return;
  }

  // Optional: disable the clicked button while we work
  const active = document.activeElement as HTMLButtonElement | null;
  if (active && active.tagName === "BUTTON") active.disabled = true;

  try {
    const r = await fetch(`${base}/api/stripe/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, userId: u.id }),
    });

    // Try to read JSON; if it fails, fall back to text
    let data: any = null;
    const text = await r.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }

    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || text || `HTTP ${r.status}`;
      throw new Error(msg);
    }

    if (data && data.url) {
      window.location.assign(data.url);
    } else {
      throw new Error("Checkout failed: no URL returned from server.");
    }
  } catch (err: any) {
    console.error("Checkout error:", err);
    alert(`Checkout error: ${err?.message || err || "Unknown error"}`);
  } finally {
    if (active && active.tagName === "BUTTON") active.disabled = false;
  }
}

// ---------------- Wire buttons/handlers ----------------
document.querySelectorAll<HTMLButtonElement>(".plan").forEach((btn) => {
  btn.addEventListener("click", (e) =>
    startCheckout((e.currentTarget as HTMLElement).getAttribute("data-plan"))
  );
});
document.getElementById("btn-member")?.addEventListener("click", () => openSignup());
document.getElementById("btn-read-sample")?.addEventListener("click", (e) => {
  e.preventDefault();
  window.location.href = "/book.html";
});

// ---------------- LocalStorage flags (sub-grace only) ----------------
const SUB_GRACE_KEY = "mh_grace_sub_v1";

function hasGrace(key: string): any | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj?.exp !== "number" || Date.now() >= obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}
function setGraceMinutes(key: string, mins: number, extra?: Record<string, any>) {
  const exp = Date.now() + mins * 60 * 1000;
  localStorage.setItem(key, JSON.stringify({ exp, ...(extra || {}) }));
}
function clearGrace(key: string) {
  localStorage.removeItem(key);
}

function hasSubGrace(): boolean {
  const g = hasGrace(SUB_GRACE_KEY);
  const uid = getCurrentUserId();
  return !!(g && g.userId && uid && g.userId === uid);
}
function setSubGrace(plan?: string) {
  const uid = getCurrentUserId();
  if (!uid) return;
  const SUB_GRACE_MIN = 60;
  setGraceMinutes(SUB_GRACE_KEY, SUB_GRACE_MIN, { plan: plan || null, userId: uid });
}
function clearSubGrace() {
  clearGrace(SUB_GRACE_KEY);
}

// ---------------- Mead Hall lock ----------------
function applyMeadLockUI(locked: boolean) {
  const el = navMeadHall;
  if (!el) return;
  el.classList.toggle("locked", locked);
  el.setAttribute("aria-disabled", String(locked));
  if (locked) {
    el.setAttribute("tabindex", "-1");
    if (el.hasAttribute("href")) el.removeAttribute("href");
  } else {
    el.removeAttribute("tabindex");
    el.setAttribute("href", "/meadhall.html");
  }
}

async function enforceNavLock() {
  let u = getUser();
  if (u?.id) u = await loadUserFresh(u);
  const serverMember = computeMember(u);
  const unlocked = serverMember || hasSubGrace();
  applyMeadLockUI(!unlocked);

  if (serverMember && hasSubGrace()) clearSubGrace();

  console.log("[MH] Lock:", { serverMember, subGrace: hasSubGrace() });
}

// Stamp grace on Stripe success (sub only)
(function detectStripeSuccess() {
  const hash = location.hash || "";
  const qs = new URLSearchParams(location.search);

  const subSucceeded =
    hash === "#success" ||
    (!hash && (qs.get("success") === "true" || qs.get("redirect_status") === "succeeded"));

  if (subSucceeded) {
    const plan = qs.get("plan") || qs.get("price") || undefined;
    setSubGrace(plan);
    history.replaceState(null, "", location.pathname);
  }
})();

// Keep lock fresh
window.addEventListener("load", enforceNavLock);
window.addEventListener("pageshow", enforceNavLock);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") enforceNavLock();
});
window.addEventListener("storage", (e) => {
  if ([SUB_GRACE_KEY, LS_KEY].includes(e.key || "")) enforceNavLock();
});

enforceNavLock();






















