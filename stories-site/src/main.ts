// ============================
// Mead Hall main (lock, checkout, contest) + email-code signup & login
// ============================

console.log("[MH] Vite module loaded");

// ---------- Year ----------
const y = document.getElementById("y");
if (y) y.textContent = String(new Date().getFullYear());

// ---------- API base ----------
function pickApiBase(src: any): string {
  const m = (src.meta || "").trim();
  if (m) return m;
  if (src.env?.VITE_API_BASE) return src.env.VITE_API_BASE;
  if ((src.vite as any)?.VITE_API_BASE) return (src.vite as any).VITE_API_BASE;
  return "";
}
const metaContent =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || "";
const API_BASE =
  pickApiBase({ meta: metaContent, env: (window as any).ENV || {}, vite: (import.meta as any)?.env || {} }) ||
  location.origin;

// ---------- mini “session” ----------
const LS_KEY = "mh_user";
const getUser = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
};
const setUser = (u: any) => localStorage.setItem(LS_KEY, JSON.stringify(u));
const getCurrentUserId = () => (getUser()?.id ? String(getUser()?.id) : "");

// server-safe refresh
async function loadUserFresh(u: any) {
  if (!u?.id) return u;
  try {
    const r = await fetch(`${API_BASE}/api/users/${u.id}`);
    if (!r.ok) throw new Error(await r.text());
    const fresh = await r.json();
    setUser(fresh);
    return fresh;
  } catch { return u; }
}

// ---------- nav + lock ----------
const navAccount = document.getElementById("nav-account") as HTMLAnchorElement | null;
const navMeadHall = document.getElementById("nav-meadhall") as HTMLAnchorElement | null;

if (navMeadHall) {
  navMeadHall.classList.add("locked");
  navMeadHall.setAttribute("aria-disabled", "true");
  navMeadHall.setAttribute("tabindex", "-1");
  navMeadHall.removeAttribute("href");
}

function refreshAccountUI() {
  const u = getUser();
  if (navAccount) navAccount.textContent = u ? (u.name ? `${u.name} (Account)` : "Account") : "Sign In";
}
refreshAccountUI();

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

function applyMeadLockUI(locked: boolean) {
  if (!navMeadHall) return;
  navMeadHall.classList.toggle("locked", locked);
  navMeadHall.setAttribute("aria-disabled", String(locked));
  if (locked) {
    navMeadHall.setAttribute("tabindex", "-1");
    navMeadHall.removeAttribute("href");
  } else {
    navMeadHall.removeAttribute("tabindex");
    navMeadHall.setAttribute("href", "/meadhall.html");
  }
}

// ---------- grace flags (sub only unlocks) ----------
const SUB_GRACE_KEY = "mh_grace_sub_v1";          // { exp, plan?, userId }
const CONTEST_GRACE_KEY = "mh_grace_contest_v1";  // { exp, entryId?, userId? }
const SUB_GRACE_MIN = 60;
const CONTEST_GRACE_MIN = 30;

function hasGrace(key: string): any | null {
  try {
    const raw = localStorage.getItem(key); if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj?.exp !== "number" || Date.now() >= obj.exp) return null;
    return obj;
  } catch { return null; }
}
function setGraceMinutes(key: string, mins: number, extra?: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify({ exp: Date.now() + mins * 60_000, ...(extra || {}) }));
}
function clearGrace(key: string) { localStorage.removeItem(key); }

function hasSubGrace(): boolean {
  const g = hasGrace(SUB_GRACE_KEY);
  const uid = getCurrentUserId();
  return !!(g && g.userId && uid && g.userId === uid);
}
function setSubGrace(plan?: string) {
  const uid = getCurrentUserId();
  if (!uid) return;
  setGraceMinutes(SUB_GRACE_KEY, SUB_GRACE_MIN, { plan: plan || null, userId: uid });
}
function clearSubGrace() { clearGrace(SUB_GRACE_KEY); }
function setContestGrace(entryId?: string) {
  const uid = getCurrentUserId();
  setGraceMinutes(CONTEST_GRACE_KEY, CONTEST_GRACE_MIN, { entryId: entryId || null, userId: uid || null });
}

async function enforceNavLock() {
  let u = getUser();
  if (u?.id) u = await loadUserFresh(u);
  const serverMember = computeMember(u);
  const unlocked = serverMember || hasSubGrace();
  applyMeadLockUI(!unlocked);
  if (serverMember && hasSubGrace()) clearSubGrace();
  console.log("[MH] Lock:", { serverMember, subGrace: hasSubGrace(), contestFlag: !!hasGrace(CONTEST_GRACE_KEY) });
}

// ---------- modal refs ----------
const modal = document.getElementById("signupModal") as HTMLDivElement | null;
const closeBtn = document.getElementById("closeSignup") as HTMLButtonElement | null;
const signupForm = document.getElementById("signupForm") as HTMLFormElement | null;
const signupMsg = document.getElementById("signupMsg") as HTMLParagraphElement | null;

function openSignup() { if (modal) { modal.style.display = "flex"; modal.setAttribute("aria-hidden","false"); } }
function closeSignup() { if (modal) { modal.style.display = "none"; modal.setAttribute("aria-hidden","true"); } }
closeBtn?.addEventListener("click", closeSignup);

navAccount?.addEventListener("click", (e)=>{ e.preventDefault(); const u = getUser(); if (u) location.href="/account.html"; else openSignup(); });
navMeadHall?.addEventListener("click", (e) => {
  if (navMeadHall?.classList.contains("locked")) { e.preventDefault(); openSignup(); }
});

// ---------- add tiny “code” field + sign-in link (no HTML edits needed) ----------
let mode: "signup"|"verify"|"login" = "signup";
let resendCooldown = 0;
let codeInput: HTMLInputElement | null = null;
let resendBtn: HTMLButtonElement | null = null;
let signInLink: HTMLButtonElement | null = null;

// locate existing inputs
const nameEl   = signupForm?.querySelector('input[name="name"]') as HTMLInputElement | null;
const emailEl  = signupForm?.querySelector('input[name="email"]') as HTMLInputElement | null;
const passEl   = signupForm?.querySelector('input[name="password"]') as HTMLInputElement | null;
const submitBtn = signupForm?.querySelector('button[type="submit"]') as HTMLButtonElement | null;

function ensureExtras() {
  if (!signupForm) return;

  // Code field (hidden until verifying)
  if (!codeInput) {
    const wrap = document.createElement("label");
    wrap.style.display = "none";
    wrap.style.margin = "10px 0 6px";
    wrap.innerHTML = `Code
      <input class="input" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code" />`;
    codeInput = wrap.querySelector("input")!;
    codeInput.maxLength = 6;
    codeInput.pattern = "\\d{6}";
    (signupForm as HTMLElement).insertBefore(wrap, signupForm.querySelector(".cta-row"));
    (codeInput as any)._wrap = wrap;
  }

  // resend button
  if (!resendBtn) {
    resendBtn = document.createElement("button");
    resendBtn.type = "button";
    resendBtn.className = "btn btn-ghost";
    resendBtn.textContent = "Resend code";
    resendBtn.style.marginLeft = "10px";
    resendBtn.addEventListener("click", requestCode);
    signupForm.querySelector(".cta-row")?.appendChild(resendBtn);
    resendBtn.style.display = "none";
  }

  // “Already have an account? Sign in”
  if (!signInLink) {
    const p = document.createElement("p");
    p.style.marginTop = "8px";
    p.innerHTML = `Already have an account? `;
    signInLink = document.createElement("button");
    signInLink.type = "button";
    signInLink.className = "btn btn-ghost";
    signInLink.textContent = "Sign in";
    signInLink.addEventListener("click", enterLoginMode);
    p.appendChild(signInLink);
    signupForm.parentElement?.appendChild(p);
  }
}

function setMsg(t: string) { if (signupMsg) signupMsg.textContent = t; }
function disableForm(dis: boolean) {
  [nameEl, emailEl, passEl, codeInput, submitBtn, resendBtn].forEach(el => { if (el) (el as any).disabled = dis; });
}

// modes
function enterSignupMode() {
  mode = "signup";
  ensureExtras();
  if (nameEl) { nameEl.disabled = false; (nameEl.parentElement as HTMLElement).style.display = ""; }
  if (emailEl) { emailEl.disabled = false; (emailEl.parentElement as HTMLElement).style.display = ""; }
  if (passEl)  { passEl.disabled  = false; (passEl.parentElement  as HTMLElement).style.display = ""; }
  if (codeInput) { ((codeInput as any)._wrap as HTMLElement).style.display = "none"; codeInput.value = ""; }
  if (resendBtn) resendBtn.style.display = "none";
  if (submitBtn) submitBtn.textContent = "Create Account";
  setMsg("");
}

function enterVerifyMode() {
  mode = "verify";
  ensureExtras();
  if (nameEl)  nameEl.disabled = true;
  if (emailEl) emailEl.disabled = false;
  if (passEl)  passEl.disabled = false;
  if (codeInput) ((codeInput as any)._wrap as HTMLElement).style.display = "";
  if (resendBtn) resendBtn.style.display = "";
  if (submitBtn) submitBtn.textContent = "Verify & Create";
}

function enterLoginMode() {
  mode = "login";
  ensureExtras();
  if (nameEl) { nameEl.disabled = true; (nameEl.parentElement as HTMLElement).style.display = "none"; }
  if (emailEl) { emailEl.disabled = false; (emailEl.parentElement as HTMLElement).style.display = ""; }
  if (passEl)  { passEl.disabled  = false; (passEl.parentElement  as HTMLElement).style.display = ""; }
  if (codeInput) { ((codeInput as any)._wrap as HTMLElement).style.display = "none"; codeInput.value = ""; }
  if (resendBtn) resendBtn.style.display = "none";
  if (submitBtn) submitBtn.textContent = "Sign In";
  setMsg("");
}

enterSignupMode(); // initial

// ---------- email code flow ----------
async function requestCode() {
  if (!emailEl) return;
  const email = (emailEl.value || "").trim().toLowerCase();
  if (!email) { setMsg("Enter your email first."); return; }
  if (resendCooldown > Date.now()) {
    const secs = Math.ceil((resendCooldown - Date.now())/1000);
    setMsg(`Please wait ${secs}s before requesting another code.`);
    return;
  }
  try {
    disableForm(true);
    setMsg("Sending code…");
    const r = await fetch(`${API_BASE}/api/auth/request-code`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email })
    });
    const d = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error((d as any)?.error || "Could not send code");
    setMsg("Check your email for the 6-digit code.");
    resendCooldown = Date.now() + 60_000;
    enterVerifyMode();
  } catch (e:any) {
    console.error(e);
    setMsg(e?.message || "Could not send code.");
  } finally {
    disableForm(false);
  }
}

async function confirmCodeAndSignup() {
  if (!nameEl || !emailEl || !passEl || !codeInput) return;
  const name = (nameEl.value || "").trim();
  const email = (emailEl.value || "").trim().toLowerCase();
  const password = passEl.value || "";
  const code = (codeInput.value || "").trim();

  if (!name || !email || !password || !code) { setMsg("Fill name, email, password, and code."); return; }

  try {
    disableForm(true);
    setMsg("Verifying code…");
    // 1) verify code
    const v = await fetch(`${API_BASE}/api/auth/confirm`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email, code })
    });
    const vj = await v.json().catch(()=> ({}));
    if (!v.ok) throw new Error((vj as any)?.error || "Invalid/expired code");

    // 2) create account
    setMsg("Creating your account…");
    const r = await fetch(`${API_BASE}/api/users`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ name, email, password })
    });
    const user = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error((user as any)?.error || await r.text());

    // persist, keep lock (no sub yet)
    setUser(user);
    clearSubGrace(); // no unlock from signup
    refreshAccountUI();
    await enforceNavLock();
    setMsg("Account created. You can now pick a plan.");
    setTimeout(closeSignup, 800);
  } catch (e:any) {
    console.error(e);
    setMsg(e?.message || "Signup failed.");
  } finally {
    disableForm(false);
  }
}

async function login() {
  if (!emailEl || !passEl) return;
  const email = (emailEl.value || "").trim().toLowerCase();
  const password = passEl.value || "";
  if (!email || !password) { setMsg("Enter email and password."); return; }
  try {
    disableForm(true);
    setMsg("Signing in…");
    const r = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email, password })
    });
    const user = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error((user as any)?.error || await r.text());
    setUser(user);
    refreshAccountUI();
    await enforceNavLock();
    setMsg("Welcome back.");
    setTimeout(() => { closeSignup(); location.href="/account.html"; }, 400);
  } catch (e:any) {
    console.error(e);
    setMsg(e?.message || "Sign-in failed.");
  } finally {
    disableForm(false);
  }
}

// hijack the existing submit button to run the correct step
signupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (mode === "login") return login();
  if (mode === "signup") return requestCode();
  if (mode === "verify") return confirmCodeAndSignup();
});

// ---------- Membership checkout ----------
async function startCheckout(plan: string | null) {
  const u = getUser();
  if (!u) { openSignup(); return; }
  if (!plan) { alert("Missing plan"); return; }
  try {
    const r = await fetch(`${API_BASE}/api/stripe/checkout`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ plan, userId: u.id })
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    if (d.url) location.href = d.url; else alert("Checkout failed");
  } catch (err) {
    console.error(err);
    alert("Checkout error");
  }
}

document.querySelectorAll<HTMLButtonElement>(".plan").forEach(btn=>{
  btn.addEventListener("click", (e)=> startCheckout((e.currentTarget as HTMLElement).getAttribute("data-plan")));
});

// ---------- Contest upload -> $1 pay ----------
async function submitContestUploadThenPay_Form() {
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
    if (msg) msg.textContent = "Uploading…";
    const fd = new FormData();
    fd.append("name", nameInput.value);
    fd.append("userId", u.id || "");
    fd.append("pdf", file);
    const up = await fetch(`${API_BASE}/api/contest/upload`, { method: "POST", body: fd });
    if (!up.ok) throw new Error(await up.text());
    const { entryId } = await up.json();

    if (msg) msg.textContent = "Starting checkout…";
    const pay = await fetch(`${API_BASE}/api/contest/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId })
    });
    if (!pay.ok) throw new Error(await pay.text());
    const d = await pay.json();
    if (d.url) location.href = d.url; else throw new Error("No checkout URL returned");
  } catch (err: any) {
    console.error(err);
    if (msg) msg.textContent = "Error: " + (err?.message || "Upload/checkout failed");
    alert("Contest error: " + (err?.message || "Upload/checkout failed"));
  }
}

document.getElementById("contestForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  submitContestUploadThenPay_Form();
});

// REPLACE the old "Read a Sample" handler with THIS:
const sampleBtn = document.getElementById("btn-read-sample") as HTMLButtonElement | null;

if (sampleBtn) {
  sampleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    // Open the interactive sample pointing directly at the TEXT file
    // (served by your backend at http://localhost:5050/uploads/…)
    window.location.href = "/book.html?file=/uploads/samplebook/samplestorythorvald.rtf";
    // If you prefer a new tab:
    // window.open("/book.html?file=/uploads/samplebook/samplestorythorvald.txt", "_blank");
  });
}



// ---------- Stripe return handling (sub unlock only) ----------
(function detectStripeSuccess() {
  const hash = location.hash || "";
  const qs = new URLSearchParams(location.search);
  const subSucceeded =
    hash === "#success" ||
    (!hash && (qs.get("success") === "true" || qs.get("redirect_status") === "succeeded"));
  const contestSucceeded = hash === "#contest-success";

  if (subSucceeded) {
    const plan = qs.get("plan") || qs.get("price") || undefined;
    setSubGrace(plan);
    history.replaceState(null, "", location.pathname);
  } else if (contestSucceeded) {
    const entryId = qs.get("entryId") || undefined;
    setContestGrace(entryId);
    history.replaceState(null, "", location.pathname);
  }
})();

// ---------- keep lock fresh ----------
window.addEventListener("load", enforceNavLock);
window.addEventListener("pageshow", enforceNavLock);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") enforceNavLock();
});
window.addEventListener("storage", (e) => {
  if ([SUB_GRACE_KEY, CONTEST_GRACE_KEY, LS_KEY].includes(e.key || "")) enforceNavLock();
});

// initial
enforceNavLock();






















