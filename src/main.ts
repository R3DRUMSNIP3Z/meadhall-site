// ============================
// Mead Hall main (Skald smooth-scroll + contest flow + strict lock w/ user-scoped sub-grace)
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
const metaContent = (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || "";
const API_BASE =
  pickApiBase({ meta: metaContent, env: (window as any).ENV || {}, vite: (import.meta as any)?.env || {} }) || "";

// ---------------- Minimal client-side session ----------------
const LS_KEY = "mh_user";
const getUser = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
  catch { return null; }
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
  } catch { return u; }
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
  if (navAccount) navAccount.textContent = u ? (u.name ? `${u.name} (Account)` : "Account") : "Sign In";
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
function openSignup(){ if (modal) { modal.style.display = "flex"; modal.setAttribute("aria-hidden","false"); } }
function closeSignup(){ if (modal) { modal.style.display = "none"; modal.setAttribute("aria-hidden","true"); } }
closeBtn?.addEventListener("click", closeSignup);

function goAccount() {
  const u = getUser();
  if (!u) { openSignup(); return; }
  location.href = "/account.html";
}
navAccount?.addEventListener("click", (e)=>{ e.preventDefault(); goAccount(); });

// When locked, clicking Mead Hall opens signup (never navigates)
navMeadHall?.addEventListener("click", (e) => {
  const el = e.currentTarget as HTMLAnchorElement;
  if (el.classList.contains("locked")) { e.preventDefault(); openSignup(); }
});

// ---------------- Membership checkout ----------------
async function startCheckout(plan: string | null) {
  const base = API_BASE || location.origin;
  const u = getUser();
  if (!u) { openSignup(); return; }
  if (!plan) { alert("Missing plan"); return; }
  try {
    const r = await fetch(`${base}/api/stripe/checkout`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ plan, userId: u.id })
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    if (d.url) location.href = d.url;
    else alert("Checkout failed");
  } catch (err) {
    console.error(err);
    alert("Checkout error");
  }
}

// ---------------- Skald Contest: upload PDF -> pay $1 ----------------
async function submitContestUploadThenPay_Form() {
  const base = API_BASE || location.origin;
  const u = getUser();
  const nameInput = document.getElementById("contestName") as HTMLInputElement | null;
  const fileInput = document.getElementById("contestPdf") as HTMLInputElement | null;
  const msg = document.getElementById("contestMsg");

  if (!u) { openSignup(); return; }
  if (!nameInput?.value) { alert("Please enter your name."); return; }
  const file = fileInput?.files?.[0];
  if (!file) { alert("Please choose a PDF file."); return; }
  if (file.type !== "application/pdf") { alert("File must be a PDF."); return; }
  if (file.size > 10 * 1024 * 1024) { alert("PDF is larger than 10 MB."); return; }

  try {
    if (msg) msg.textContent = "Uploadingâ€¦";
    const fd = new FormData();
    fd.append("name", nameInput.value);
    fd.append("userId", u.id || "");
    fd.append("pdf", file);

    // 1) Upload entry -> entryId
    const up = await fetch(`${base}/api/contest/upload`, { method: "POST", body: fd });
    if (!up.ok) throw new Error(await up.text());
    const { entryId } = await up.json();

    // 2) Start $1 checkout with entryId
    if (msg) msg.textContent = "Starting checkoutâ€¦";
    const pay = await fetch(`${base}/api/contest/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId })
    });
    if (!pay.ok) throw new Error(await pay.text());
    const d = await pay.json();
    if (d.url) location.href = d.url;
    else throw new Error("No checkout URL returned");
  } catch (err: any) {
    console.error(err);
    if (msg) msg.textContent = "Error: " + (err?.message || "Upload/checkout failed");
    alert("Contest error: " + (err?.message || "Upload/checkout failed"));
  }
}

// Fallback: prompt for name, file picker, upload -> pay
async function submitContestUploadThenPay_Fallback() {
  const base = API_BASE || location.origin;
  const u = getUser();
  if (!u) { openSignup(); return; }

  const name = prompt("Your name for the Skald entry:");
  if (!name) return;

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "application/pdf";
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Please choose a PDF."); return; }
    if (file.size > 10 * 1024 * 1024) { alert("PDF is larger than 10 MB."); return; }

    try {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("userId", u.id || "");
      fd.append("pdf", file);

      const up = await fetch(`${base}/api/contest/upload`, { method: "POST", body: fd });
      if (!up.ok) throw new Error(await up.text());
      const { entryId } = await up.json();

      const pay = await fetch(`${base}/api/contest/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId })
      });
      if (!pay.ok) throw new Error(await pay.text());
      const d = await pay.json();
      if (d.url) location.href = d.url;
      else throw new Error("No checkout URL returned");
    } catch (e: any) {
      console.error(e);
      alert("Contest error: " + (e?.message || "Upload/checkout failed"));
    }
  };
  picker.click();
}

// ---------------- Optional sample download ----------------
function readSample() {
  const text = "\n* The Mead of Poetry *\nThey say Odin traded an eye for wisdom; we trade a verse for a night by the fire.\n";
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "guild-sample.txt"; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 800);
}

// ---------------- Wire buttons/handlers ----------------
document.querySelectorAll<HTMLButtonElement>(".plan").forEach(btn=>{
  btn.addEventListener("click", (e)=> startCheckout((e.currentTarget as HTMLElement).getAttribute("data-plan")));
});
document.getElementById("btn-member")?.addEventListener("click", ()=> openSignup());
document.getElementById("btn-read-sample")?.addEventListener("click", readSample);

document.getElementById("contestForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  submitContestUploadThenPay_Form();
});

document.getElementById("btn-contest")?.addEventListener("click", (e)=>{
  const form = document.getElementById("contestForm") as HTMLFormElement | null;
  if (form) { e.preventDefault(); form.requestSubmit(); return; }
  e.preventDefault();
  submitContestUploadThenPay_Fallback();
});

// ---------------- Signup submit ----------------
const signupForm = document.getElementById("signupForm") as HTMLFormElement | null;
const signupMsg = document.getElementById("signupMsg") as HTMLParagraphElement | null;
signupForm?.addEventListener("submit", async (e)=>{
  e.preventDefault(); if (signupMsg) signupMsg.textContent = "Creating your accountâ€¦";
  const fd = new FormData(signupForm!);
  const payload = Object.fromEntries(fd.entries());
  try {
    const r = await fetch(`${API_BASE || location.origin}/api/users`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(await r.text());
    const user = await r.json();
    setUser(user);

    // NEW: clear any stray grace from earlier sessions so signup stays LOCKED
    clearSubGrace();
    clearGrace(CONTEST_GRACE_KEY);

    refreshAccountUI();
    await enforceNavLock();
    if (signupMsg) signupMsg.textContent = "Account created. You can now pick a plan.";
    setTimeout(()=> closeSignup(), 800);
  } catch (err: any) {
    console.error(err);
    if (signupMsg) signupMsg.textContent = "Signup failed: " + (err?.message || "Unknown error");
  }
});

// ===============================
// Separate localStorage flags
// ===============================
const SUB_GRACE_KEY = "mh_grace_sub_v1";          // { exp:number, plan?:string, userId:string }
const CONTEST_GRACE_KEY = "mh_grace_contest_v1";  // { exp:number, entryId?:string, userId?:string }
// (Legacy key intentionally NOT used anymore for unlocking)

// durations
const SUB_GRACE_MIN = 60;
const CONTEST_GRACE_MIN = 30;

// helpers
function hasGrace(key: string): any | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj?.exp !== "number" || Date.now() >= obj.exp) return null;
    return obj;
  } catch { return null; }
}
function setGraceMinutes(key: string, mins: number, extra?: Record<string, any>) {
  const exp = Date.now() + mins * 60 * 1000;
  localStorage.setItem(key, JSON.stringify({ exp, ...(extra || {}) }));
}
function clearGrace(key: string) { localStorage.removeItem(key); }

// user-scoped subscription grace
function hasSubGrace(): boolean {
  const g = hasGrace(SUB_GRACE_KEY);
  const uid = getCurrentUserId();
  return !!(g && g.userId && uid && g.userId === uid);
}
function setSubGrace(plan?: string) {
  const uid = getCurrentUserId();
  if (!uid) return; // must be logged in when starting checkout
  setGraceMinutes(SUB_GRACE_KEY, SUB_GRACE_MIN, { plan: plan || null, userId: uid });
}
function clearSubGrace() { clearGrace(SUB_GRACE_KEY); }

// contest flag (does NOT unlock meadhall)
function setContestGrace(entryId?: string) {
  const uid = getCurrentUserId();
  setGraceMinutes(CONTEST_GRACE_KEY, CONTEST_GRACE_MIN, { entryId: entryId || null, userId: uid || null });
}

// ===============================
// Mead Hall lock (server-verified + SUB-ONLY grace)
// ===============================
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
  const unlocked = serverMember || hasSubGrace(); // contest flag ignored for lock
  applyMeadLockUI(!unlocked);

  if (serverMember && hasSubGrace()) clearSubGrace();

  console.log("[MH] Lock:", { serverMember, subGrace: hasSubGrace(), contestFlag: !!hasGrace(CONTEST_GRACE_KEY) });
}

// Detect Stripe success for BOTH flows, but only sub success affects lock
(function detectStripeSuccess() {
  const hash = location.hash || "";
  const qs = new URLSearchParams(location.search);

  // STRICT: exact hash match
  const subSucceeded =
    hash === "#success" ||
    (!hash && (qs.get("success") === "true" || qs.get("redirect_status") === "succeeded"));
  const contestSucceeded = hash === "#contest-success";

  if (subSucceeded) {
    const plan = qs.get("plan") || qs.get("price") || undefined;
    setSubGrace(plan); // user-scoped
    history.replaceState(null, "", location.pathname);
  } else if (contestSucceeded) {
    const entryId = qs.get("entryId") || undefined;
    setContestGrace(entryId); // does NOT unlock
    history.replaceState(null, "", location.pathname);
  }
})();

// Apply lock on load/restore/visibility + keep tabs in sync
window.addEventListener("load", enforceNavLock);
window.addEventListener("pageshow", enforceNavLock);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") enforceNavLock();
});
window.addEventListener("storage", (e) => {
  if ([SUB_GRACE_KEY, CONTEST_GRACE_KEY, LS_KEY].includes(e.key || "")) enforceNavLock();
});

// Initial run
enforceNavLock();






















