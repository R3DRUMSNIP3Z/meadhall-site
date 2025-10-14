// /src/auth.ts — drop-in
// Verified signup (email code) + real Sign In modal, with:
// - email cache so confirm/resend always use SAME email
// - warm-up ping + retrying fetch (12s → 22s) to avoid AbortError
// - single-flight guards + clear logs

const LS_KEY = "mh_user";

/* ---------- API base ---------- */
function pickApiBase(s: any): string {
  const meta = (s.meta || "").trim();
  if (meta) return meta;
  if (s.env?.VITE_API_BASE) return s.env.VITE_API_BASE;
  if (s.vite?.VITE_API_BASE) return s.vite.VITE_API_BASE;
  return "";
}
const metaContent =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || "";
const API_BASE =
  pickApiBase({ meta: metaContent, env: (window as any).ENV || {}, vite: (import.meta as any)?.env || {} }) || "";

const fullUrl = (p: string) => (/^https?:\/\//i.test(p) ? p : `${API_BASE}${p}`);

/* ---------- small fetch helpers ---------- */
function withTimeout(init: RequestInit = {}, ms = 12000) {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), ms);
  const payload: RequestInit = { ...(init || {}), signal: controller.signal };
  return { payload, clear: () => window.clearTimeout(t) };
}

async function jfetch(url: string, init: RequestInit = {}, timeoutMs = 12000) {
  const { payload, clear } = withTimeout(init, timeoutMs);
  console.log("[MH] fetch →", url, payload);
  try {
    const r = await fetch(url, payload);
    console.log("[MH] ←", r.status, r.statusText, url);
    return r;
  } finally {
    clear();
  }
}

// retry wrapper: first try 12s, then 22s with tiny delay
async function jfetchR(url: string, init: RequestInit = {}, timeouts = [12000, 22000]) {
  let lastErr: any = null;
  for (let i = 0; i < timeouts.length; i++) {
    try {
      return await jfetch(url, init, timeouts[i]);
    } catch (e) {
      lastErr = e;
      console.warn(`[MH] fetch attempt ${i + 1} failed:`, (e as any)?.name || e);
      // small backoff between attempts
      await new Promise(res => setTimeout(res, 400 + i * 300));
    }
  }
  throw lastErr;
}

console.log("[MH] API_BASE =", API_BASE);

/* ---------- utils ---------- */
const getUser = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; } };
const setUser = (u: any) => localStorage.setItem(LS_KEY, JSON.stringify(u));

const EMAIL_CACHE_KEY = "mh_last_email";
const rememberEmail = (email: string) =>
  localStorage.setItem(EMAIL_CACHE_KEY, String(email || "").toLowerCase().trim());
const recallEmail = () =>
  (localStorage.getItem(EMAIL_CACHE_KEY) || "").toLowerCase().trim();

function openModal(el: HTMLElement | null){ if (el){ el.style.display = "flex"; el.setAttribute("aria-hidden","false"); } }
function closeModal(el: HTMLElement | null){ if (el){ el.style.display = "none"; el.setAttribute("aria-hidden","true"); } }

function setNavAccountName() {
  const a = document.getElementById("nav-account");
  const u = getUser();
  if (a) a.textContent = u ? (u.name ? `${u.name} (Account)` : "Account") : "Sign In";
}

/* ---------- elements ---------- */
const navAccount  = document.getElementById("nav-account");

const signupModal = document.getElementById("signupModal");
const signupForm  = document.getElementById("signupForm") as HTMLFormElement | null;
const signupMsg   = document.getElementById("signupMsg") as HTMLParagraphElement | null;
const closeSignup = document.getElementById("closeSignup");

const signinModal = document.getElementById("signinModal");
const signinForm  = document.getElementById("signinForm") as HTMLFormElement | null;
const signinMsg   = document.getElementById("signinMsg") as HTMLParagraphElement | null;
const closeSignin = document.getElementById("closeSignin");
const openSignupFromSignin = document.getElementById("openSignupFromSignin");

const verifyModal = document.getElementById("verifyModal");
const verifyForm  = document.getElementById("verifyForm") as HTMLFormElement | null;
const verifyMsg   = document.getElementById("verifyMsg") as HTMLParagraphElement | null;
const resendBtn   = document.getElementById("resendCode");
const closeVerify = document.getElementById("closeVerify");

/* ---------- switchers ---------- */
openSignupFromSignin?.addEventListener("click", () => {
  closeModal(signinModal);
  openModal(signupModal);
  signupForm?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
});
closeSignin?.addEventListener("click", () => closeModal(signinModal));
closeSignup?.addEventListener("click", () => closeModal(signupModal));
closeVerify?.addEventListener("click", () => closeModal(verifyModal));

/* ---------- make "Sign In" open the signin modal ---------- */
navAccount?.addEventListener("click", (e) => {
  const u = getUser();
  if (!u) {
    e.preventDefault();
    e.stopImmediatePropagation(); // prevent main.ts from opening signup
    openModal(signinModal);
    signinForm?.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
  }
}, true); // capture so we win

/* ---------- SIGN IN ---------- */
let signingIn = false; // single-flight
signinForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (signingIn) return;
  signingIn = true;
  if (signinMsg) signinMsg.textContent = "Signing in…";
  const fd = new FormData(signinForm!);
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  try {
    // warm-up ping (reduces cold-start latency)
    await jfetchR(fullUrl("/api/health"), { method: "GET" }, [4000]).catch(() => {});
    const r = await jfetchR(fullUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (signinMsg) signinMsg.textContent = (data as any)?.error || "Could not sign in.";
      return;
    }
    setUser(data);
    setNavAccountName();
    location.reload(); // let main.ts re-evaluate lock etc
  } catch (err: any) {
    console.error("[MH] sign-in error:", err);
    if (signinMsg) {
      signinMsg.textContent =
        err?.name === "AbortError" ? "Request timed out. Please try again." :
        (err?.message || "Sign in failed (network).");
    }
  } finally {
    signingIn = false;
  }
});

/* ---------- VERIFIED SIGNUP ---------- */
let lastEmailForCode: string | null = null;
let pendingSignup: { name: string; email: string; password: string } | null = null;
let resendCooldown = 0;
let resendTimer: number | null = null;
let requestingCode = false;   // single-flight
let confirmingCode = false;   // single-flight
let resending = false;

function startResendCooldown(sec = 60) {
  resendCooldown = sec;
  updateResendButton();
  if (resendTimer) window.clearInterval(resendTimer);
  resendTimer = window.setInterval(() => {
    resendCooldown -= 1;
    updateResendButton();
    if (resendCooldown <= 0 && resendTimer) { window.clearInterval(resendTimer); resendTimer = null; }
  }, 1000);
}
function updateResendButton() {
  if (!resendBtn) return;
  if (resendCooldown > 0) {
    resendBtn.setAttribute("disabled","true");
    resendBtn.textContent = `Resend (${resendCooldown}s)`;
  } else {
    resendBtn.removeAttribute("disabled");
    resendBtn.textContent = "Resend";
  }
}

/* add “Already have an account?” to signup */
(function addSwitchToSignin(){
  if (!signupForm) return;
  if (signupForm.querySelector("[data-switch-injected]")) return;
  const p = document.createElement("p");
  p.dataset.switchInjected = "1";
  p.className = "rune-sub";
  p.style.marginTop = "8px";
  p.innerHTML = `Already have an account?
    <button type="button" id="openSigninFromSignup" class="btn btn-ghost" style="padding:.3rem .6rem">Sign In</button>`;
  signupForm.appendChild(p);
  document.getElementById("openSigninFromSignup")?.addEventListener("click", () => {
    closeModal(signupModal);
    openModal(signinModal);
    signinForm?.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
  });
})();

/* intercept signup submit (capture) -> request code -> verify -> create user */
signupForm?.addEventListener("submit", () => {}, true);
signupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  if (requestingCode) return;
  requestingCode = true;

  if (signupMsg) signupMsg.textContent = "Preparing email verification…";
  const fd = new FormData(signupForm!);
  const name = String(fd.get("name") || "").trim();
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");

  if (!name || !email || !password) {
    if (signupMsg) signupMsg.textContent = "Please fill all fields.";
    requestingCode = false;
    return;
  }

  try {
    // warm-up first to reduce cold-start
    await jfetchR(fullUrl("/api/health"), { method: "GET" }, [4000]).catch(() => {});
    const r = await jfetchR(fullUrl("/api/auth/request-code"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (signupMsg) signupMsg.textContent = (data as any)?.error || "Could not send code.";
      return;
    }
    lastEmailForCode = email;
    rememberEmail(email);                 // 🔑 cache email for confirm/resend
    pendingSignup = { name, email, password };
    if (signupMsg) signupMsg.textContent = "We sent you a code.";
    openModal(verifyModal);
    startResendCooldown(60);
    if ((data as any)?.code && verifyMsg) verifyMsg.textContent = `DEV CODE: ${(data as any).code}`;
  } catch (err: any) {
    console.error("[MH] request-code error:", err);
    if (signupMsg) {
      signupMsg.textContent =
        err?.name === "AbortError" ? "Request timed out. Please try again." :
        (err?.message || "Failed to send code.");
    }
  } finally {
    requestingCode = false;
  }
}, { capture: true });

resendBtn?.addEventListener("click", async () => {
  if (resending || resendCooldown > 0) return;
  resending = true;
  const cached = (lastEmailForCode || recallEmail()); // 🔑 always same email
  if (!cached) { resending = false; return; }
  try {
    const r = await jfetchR(fullUrl("/api/auth/request-code"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: cached }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (verifyMsg) verifyMsg.textContent = (data as any)?.error || "Resend failed.";
      return;
    }
    if (verifyMsg) verifyMsg.textContent = "Code resent.";
    startResendCooldown(60);
    if ((data as any)?.code && verifyMsg) verifyMsg.textContent += ` DEV CODE: ${(data as any).code}`;
  } catch (err: any) {
    console.error("[MH] resend error:", err);
    if (verifyMsg) {
      verifyMsg.textContent =
        err?.name === "AbortError" ? "Resend timed out. Try again." :
        (err?.message || "Resend failed.");
    }
  } finally {
    resending = false;
  }
});

verifyForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (confirmingCode) return;
  confirmingCode = true;

  const fd = new FormData(verifyForm!);
  const code = String(fd.get("code") || "").trim();

  const email = (lastEmailForCode || recallEmail()); // 🔑 same email as request
  if (!email || !pendingSignup) {
    if (verifyMsg) verifyMsg.textContent = "No signup in progress. Please resend the code.";
    confirmingCode = false;
    return;
  }
  if (!code) {
    if (verifyMsg) verifyMsg.textContent = "Enter the 6-digit code.";
    confirmingCode = false;
    return;
  }
  try {
    const c = await jfetchR(fullUrl("/api/auth/confirm"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const cres = await c.json().catch(() => ({}));
    if (!c.ok) {
      if (verifyMsg) verifyMsg.textContent = (cres as any)?.error || "Invalid code.";
      return;
    }

    const create = await jfetchR(fullUrl("/api/users"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pendingSignup),
    });
    const user = await create.json().catch(() => ({}));
    if (!create.ok) {
      if (verifyMsg) verifyMsg.textContent = (user as any)?.error || "Could not create account.";
      return;
    }

    setUser(user);
    setNavAccountName();
    if (signupMsg) signupMsg.textContent = "Account created. Welcome!";
    closeModal(verifyModal);
    closeModal(signupModal);
    location.reload();
  } catch (err: any) {
    console.error("[MH] verify/confirm error:", err);
    if (verifyMsg) {
      verifyMsg.textContent =
        err?.name === "AbortError" ? "Confirmation timed out. Try again." :
        (err?.message || "Verification failed.");
    }
  } finally {
    confirmingCode = false;
  }
});

/* ---------- initial ---------- */
// optional warm-up (non-blocking)
jfetchR(fullUrl("/api/health"), { method: "GET" }, [3000]).catch(() => {});
setNavAccountName();



