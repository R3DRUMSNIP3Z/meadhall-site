// src/profile.ts
console.log("profile.ts loaded");

// ---- API base (meta > window.ENV > import.meta.env) ----
function pickApiBase(sources: any): string {
  const meta = (sources.meta || "").trim();
  if (meta) return meta;
  if (sources.env && sources.env.VITE_API_BASE) return sources.env.VITE_API_BASE;
  if (sources.vite && sources.vite.VITE_API_BASE) return sources.vite.VITE_API_BASE;
  return "";
}
const META = (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || "";
const API_BASE = pickApiBase({ meta: META, env: (window as any).ENV || {}, vite: (import.meta as any)?.env || {} }) || "";

// ---- Session helpers ----
const LS_KEY = "mh_user";
const getLocalUser = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
};

// ---- DOM ----
const avatarEl  = document.getElementById("avatar") as HTMLImageElement | null
               || document.getElementById("viewAvatar") as HTMLImageElement | null;
const nameEl    = document.getElementById("name") as HTMLElement | null;
const emailEl   = document.getElementById("email") as HTMLElement | null;
const roleEl    = document.getElementById("role") as HTMLElement | null;
const storiesEl = document.getElementById("stories") as HTMLElement | null;
const logoutBtn = document.getElementById("logout") as HTMLButtonElement | null;

// ---- Utilities ----
function qsId(): string | null {
  const p = new URLSearchParams(location.search);
  return p.get("id");
}
function setText(el: HTMLElement | null, text: string) {
  if (el) el.textContent = text;
}
function setAvatar(url?: string | null) {
  const src = url && url.trim() ? url : "/logo/avatar-placeholder.svg";
  if (avatarEl) avatarEl.src = src;
}

// ---- Load user & stories ----
async function loadProfile() {
  const local = getLocalUser();
  const id = qsId() || local?.id;
  if (!id) {
    console.warn("No user id found; redirecting to account.");
    location.href = "/account.html";
    return;
  }

  // Try API
  let apiUser: any = null;
  try {
    const r = await fetch(`${API_BASE || location.origin}/api/users/${id}`);
    if (r.ok) apiUser = await r.json();
  } catch (e) {
    console.warn("Fetch user failed, falling back to local session.", e);
  }

  // Merge: prefer API, fall back to local
  const user = apiUser || local;
  if (!user) {
    alert("User not found.");
    location.href = "/account.html";
    return;
  }

  // Bind header fields
  setText(nameEl, user.name || "Your Name");
  setText(emailEl, user.email || "you@example.com");
  setText(roleEl, user.role || "Guild Member");

  // Avatar (prefer API, else local, else placeholder)
  setAvatar(user.avatarUrl || local?.avatarUrl);

  // Load stories
  if (storiesEl) {
    storiesEl.innerHTML = `<p class="muted">Loading storiesâ€¦</p>`;
    try {
      const rs = await fetch(`${API_BASE || location.origin}/api/users/${id}/stories`);
      if (rs.ok) {
        const list: Array<{id:string; title:string; text:string; createdAt:number}> = await rs.json();
        if (!list.length) {
          storiesEl.innerHTML = `<p class="muted">No stories yet.</p>`;
        } else {
          storiesEl.innerHTML = "";
          for (const s of list) {
            const div = document.createElement("div");
            div.className = "story";
            div.innerHTML =
              `<strong>${escapeHtml(s.title)}</strong>` +
              `<div class="muted" style="font-size:12px">${new Date(s.createdAt).toLocaleString()}</div>` +
              `<p>${escapeHtml(s.text)}</p>`;
            storiesEl.appendChild(div);
          }
        }
      } else {
        storiesEl.innerHTML = `<p class="muted">Could not load stories.</p>`;
      }
    } catch {
      storiesEl.innerHTML = `<p class="muted">Could not load stories.</p>`;
    }
  }
}

// Basic HTML escaping for story text/title
function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---- Logout (optional) ----
logoutBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem(LS_KEY);
  location.href = "/";
});

// ---- Go ----
loadProfile();












