// /src/auth.ts
// Verified signup (email code) + real Sign In modal.
// Keeps your existing main.ts logic; we intercept where needed (capture phase).

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

/* ---------- utils ---------- */
const getUser = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; } };
const setUser = (u: any) => localStorage.setItem(LS_KEY, JSON.stringify(u));
const fullUrl = (p: string) => (/^https?:\/\//i.test(p) ? p : `${API_BASE}${p}`);

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
signinForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (signinMsg) signinMsg.textContent = "Signing in…";
  const fd = new FormData(signinForm);
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  try {
    const r = await fetch(fullUrl("/api/auth/login"), {
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
  } catch (err:any) {
    if (signinMsg) signinMsg.textContent = err?.message || "Sign in failed.";
  }
});

/* ---------- VERIFIED SIGNUP ---------- */
let lastEmailForCode: string | null = null;
let pendingSignup: { name: string; email: string; password: string } | null = null;
let resendCooldown = 0;
let resendTimer: number | null = null;

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

  if (signupMsg) signupMsg.textContent = "Preparing email verification…";
  const fd = new FormData(signupForm!);
  const name = String(fd.get("name") || "").trim();
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");

  if (!name || !email || !password) {
    if (signupMsg) signupMsg.textContent = "Please fill all fields.";
    return;
  }

  try {
    const r = await fetch(fullUrl("/api/auth/request-code"), {
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
    pendingSignup = { name, email, password };
    if (signupMsg) signupMsg.textContent = "We sent you a code.";
    openModal(verifyModal);
    startResendCooldown(60);
    if ((data as any)?.code && verifyMsg) verifyMsg.textContent = `DEV CODE: ${(data as any).code}`;
  } catch (err:any) {
    if (signupMsg) signupMsg.textContent = err?.message || "Failed to send code.";
  }
}, { capture: true });

resendBtn?.addEventListener("click", async () => {
  if (!lastEmailForCode || resendCooldown > 0) return;
  try {
    const r = await fetch(fullUrl("/api/auth/request-code"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: lastEmailForCode }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (verifyMsg) verifyMsg.textContent = (data as any)?.error || "Resend failed.";
      return;
    }
    if (verifyMsg) verifyMsg.textContent = "Code resent.";
    startResendCooldown(60);
    if ((data as any)?.code && verifyMsg) verifyMsg.textContent += ` DEV CODE: ${(data as any).code}`;
  } catch (err:any) {
    if (verifyMsg) verifyMsg.textContent = err?.message || "Resend failed.";
  }
});

verifyForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(verifyForm);
  const code = String(fd.get("code") || "").trim();
  if (!lastEmailForCode || !pendingSignup) {
    if (verifyMsg) verifyMsg.textContent = "No signup in progress.";
    return;
  }
  if (!code) {
    if (verifyMsg) verifyMsg.textContent = "Enter the 6-digit code.";
    return;
  }
  try {
    // confirm
    const c = await fetch(fullUrl("/api/auth/confirm"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: lastEmailForCode, code }),
    });
    const cres = await c.json().catch(() => ({}));
    if (!c.ok) {
      if (verifyMsg) verifyMsg.textContent = (cres as any)?.error || "Invalid code.";
      return;
    }

    // create account
    const create = await fetch(fullUrl("/api/users"), {
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
  } catch (err:any) {
    if (verifyMsg) verifyMsg.textContent = err?.message || "Verification failed.";
  }
});

/* initial */
setNavAccountName();
