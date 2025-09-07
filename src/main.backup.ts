console.log("Vite module loaded");

// Year
const yearEl = document.getElementById("y");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// API base resolution
function pickApiBase(sources: any): string {
  const meta = (sources.meta || "").trim();
  if (meta) return meta;
  if (sources.env && sources.env.VITE_API_BASE) return sources.env.VITE_API_BASE;
  if (sources.vite && sources.vite.VITE_API_BASE) return sources.vite.VITE_API_BASE;
  return "";
}
const metaContent = (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || "";
const API_BASE = pickApiBase({ meta: metaContent, env: (window as any).ENV || {}, vite: (import.meta as any)?.env || {} }) || "";

// Minimal client-side session
const LS_KEY = "mh_user";
const getUser = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; } };
const setUser = (u: any) => localStorage.setItem(LS_KEY, JSON.stringify(u));
const clearUser = () => localStorage.removeItem(LS_KEY);

// Account label
const navAccount = document.getElementById("nav-account") as HTMLAnchorElement | null;
function refreshAccountUI() {
  const u = getUser();
  if (navAccount) navAccount.textContent = u ? (u.name ? `${u.name} (Account)` : "Account") : "Sign In";
}
refreshAccountUI();

// Modal helpers
const modal = document.getElementById("signupModal") as HTMLDivElement | null;
const closeBtn = document.getElementById("closeSignup") as HTMLButtonElement | null;
function openSignup() {
  if (modal) { 
    modal.style.display = "flex"; 
    modal.setAttribute("aria-hidden","false"); 
  }
}
function closeSignup() {
  if (modal) { 
    modal.style.display = "none"; 
    modal.setAttribute("aria-hidden","true"); 
  }
}
closeBtn?.addEventListener("click", closeSignup);
navAccount?.addEventListener("click", (e) => { e.preventDefault(); openSignup(); });

// Actions
async function startCheckout(plan: string | null) {
  const base = API_BASE || location.origin;
  const u = getUser();
  if (!u) { openSignup(); return; }
  if (!plan) { alert("Missing plan"); return; }
  try {
    const r = await fetch(`${base}/api/stripe/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

async function submitContest() {
  const base = API_BASE || location.origin;
  const u = getUser();
  const entry = { title: "Song of the Shieldwall", email: (u?.email || "test@example.com"), genre: "epic", text: "Hail the Allfather." };
  try {
    const r = await fetch(`${base}/api/contest/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry })
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    if (d.url) location.href = d.url;
    else alert("Contest checkout failed");
  } catch (err) {
    console.error(err);
    alert("Contest error");
  }
}

function readSample() {
  const text = "\n* The Mead of Poetry *\nThey say Odin traded an eye for wisdom; we trade a verse for a night by the fire.\n";
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); 
  a.href = url; 
  a.download = "guild-sample.txt"; 
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

// Wire buttons
document.querySelectorAll<HTMLButtonElement>(".plan").forEach(btn => {
  btn.addEventListener("click", (e) => startCheckout((e.currentTarget as HTMLElement).getAttribute("data-plan")));
});
document.getElementById("btn-member")?.addEventListener("click", () => openSignup());
document.getElementById("btn-contest")?.addEventListener("click", (e) => { e.preventDefault(); submitContest(); });
document.getElementById("btn-read-sample")?.addEventListener("click", readSample);

// Signup submit
const signupForm = document.getElementById("signupForm") as HTMLFormElement | null;
const signupMsg = document.getElementById("signupMsg") as HTMLParagraphElement | null;
signupForm?.addEventListener("submit", async (e) => {
  e.preventDefault(); 
  if (signupMsg) signupMsg.textContent = "Creating your account…";
  const fd = new FormData(signupForm!);
  const payload = Object.fromEntries(fd.entries());
  try {
    const r = await fetch(`${API_BASE || location.origin}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(await r.text());
    const user = await r.json();
    setUser(user); 
    refreshAccountUI();
    if (signupMsg) signupMsg.textContent = "Account created. You can now pick a plan.";
    setTimeout(() => closeSignup(), 800);
  } catch (err: any) {
    console.error(err);
    if (signupMsg) signupMsg.textContent = "Signup failed: " + (err?.message || "Unknown error");
  }
});

