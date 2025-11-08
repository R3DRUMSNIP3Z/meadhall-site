// ===============================
// Mead Hall — src/profile.ts
// ===============================
console.log("profile.ts loaded");

/* ---------- API base ---------- */
function pickApiBase(sources: any): string {
  const meta = (sources.meta || "").trim();
  if (meta) return meta;
  if (sources.env?.VITE_API_BASE) return sources.env.VITE_API_BASE;
  if (sources.vite?.VITE_API_BASE) return sources.vite.VITE_API_BASE;
  return "";
}
const META =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content || "";
const API_BASE =
  pickApiBase({ meta: META, env: (window as any).ENV || {}, vite: (import.meta as any)?.env || {} }) || "";

/* ---------- URL helpers ---------- */
// Only rewrite backend-served uploads to the backend host; leave CDNs (e.g., Cloudinary) as-is.
function fullUrl(p?: string | null): string {
  if (!p) return "";
  const str = String(p);
  if (/^https?:\/\//i.test(str)) return str;
  // For backend uploads, pin to backend origin
  if (str.startsWith("/uploads/") || str.startsWith("uploads/")) {
    const base = (API_BASE || "").replace(/\/+$/, "");
    const path = str.replace(/^\/+/, "");
    return `${base}/${path}`;
  }
  // Site-relative assets (logos, css, etc.) should stay as-is
  return str;
}
const cacheBust = (u?: string | null) =>
  !u ? "" : u.includes("?") ? `${u}&t=${Date.now()}` : `${u}?t=${Date.now()}`;

/* ---------- Session helpers ---------- */
const LS_KEY = "mh_user";
function getLocalUser<T = any>(): T | null {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
}
function setLocalUser(u: any) { localStorage.setItem(LS_KEY, JSON.stringify(u)); }

/* ---------- DOM ---------- */
const pfpWrap = document.getElementById("pfp"); // wrapper that gets frame class
const avatarImg =
  (document.getElementById("avatarImg") as HTMLImageElement | null) ||
  (document.getElementById("avatar") as HTMLImageElement | null) ||
  (document.getElementById("viewAvatar") as HTMLImageElement | null);

const nameEl    = document.getElementById("name") as HTMLElement | null;
const emailEl   = document.getElementById("email") as HTMLElement | null;
const bioEl     = document.getElementById("bio") as HTMLElement | null;
const interests = document.getElementById("interests") as HTMLElement | null;
const helloEl   = document.getElementById("hello") as HTMLElement | null;

const storiesEl = document.getElementById("stories") as HTMLElement | null;
const galleryGrid = document.getElementById("galleryGrid") as HTMLDivElement | null;

const logoutBtn = document.getElementById("logout") as HTMLButtonElement | null;

/* ---------- small utils ---------- */
function qsId(): string | null {
  const p = new URLSearchParams(location.search);
  return p.get("id");
}
function setText(el: HTMLElement | null, text?: string) {
  if (el) el.textContent = text || "";
}
function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- membership frame ---------- */
function applyFrame(u: any) {
  if (!pfpWrap) return;
  const tier = String(u?.membership || "").toLowerCase();
  pfpWrap.classList.remove("pfp--reader", "pfp--premium", "pfp--annual");
  if (tier === "premium") pfpWrap.classList.add("pfp--premium");
  else if (tier === "annual") pfpWrap.classList.add("pfp--annual");
  else if (tier === "reader") pfpWrap.classList.add("pfp--reader");
}

/* ---------- avatar ---------- */
function setAvatar(url?: string | null) {
  const src = url && url.trim() ? cacheBust(fullUrl(url)) : "/logo/logo-512.png";
  if (avatarImg) {
    avatarImg.src = src;
    avatarImg.onerror = () => { avatarImg.src = "/logo/logo-512.png"; };
  }
}

/* ---------- load user (fresh from backend, keep membership) ---------- */
async function loadUserFresh(local: any) {
  if (!API_BASE || !local?.id) return local;
  try {
    const r = await fetch(`${API_BASE}/api/users/${local.id}`);
    if (!r.ok) throw new Error(await r.text());
    const fresh = await r.json();
    if (!fresh.membership && local.membership) fresh.membership = local.membership;
    setLocalUser(fresh);
    return fresh;
  } catch {
    return local;
  }
}

/* ---------- Stories ---------- */
async function loadStories(uid: string) {
  if (!storiesEl) return;
  storiesEl.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const rs = await fetch(`${API_BASE}/api/users/${uid}/stories`);
    if (!rs.ok) throw new Error(await rs.text());
    const list: Array<{ id: string; title: string; text: string; createdAt?: number; updatedAt?: number; }> = await rs.json();

    if (!Array.isArray(list) || list.length === 0) {
      storiesEl.innerHTML = `<p class="muted">No stories yet.</p>`;
      return;
    }

    storiesEl.innerHTML = "";
    for (const s of list) {
      const when = s.createdAt ? new Date(s.createdAt).toLocaleString() : "";
      const upd  = s.updatedAt ? ` • Updated ${new Date(s.updatedAt).toLocaleString()}` : "";
      const div = document.createElement("div");
      div.className = "story";
      div.innerHTML =
        `<strong>${escapeHtml(s.title || "Untitled")}</strong>` +
        `<div class="muted" style="font-size:12px">${when}${upd}</div>` +
        `<p style="white-space:pre-wrap;margin:.4em 0 0">${escapeHtml(s.text || "")}</p>`;
      storiesEl.appendChild(div);
    }
  } catch {
    storiesEl.innerHTML = `<p class="muted">Could not load stories.</p>`;
  }
}

/* ---------- Gallery ---------- */
type Photo = { id?: string; url?: string; path?: string; createdAt?: number | string };
function normalizePhotos(raw: any): Photo[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}
const toImgUrl = (p?: string) => (/^https?:\/\//i.test(p || "") ? (p as string) : fullUrl(p || ""));

// NOTE: backend requires x-user-id — this fixes the 401 you saw.
async function fetchGallery(uid: string): Promise<Photo[]> {
  const urls = [
    `${API_BASE}/api/users/${uid}/gallery`,
    `${API_BASE}/api/gallery?user=${encodeURIComponent(uid)}`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "x-user-id": uid } });
      if (!r.ok) continue;
      const data = await r.json();
      return normalizePhotos(data);
    } catch { /* try next */ }
  }
  return [];
}

async function loadGallery(uid: string) {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const photos = await fetchGallery(uid);
    if (!photos.length) {
      galleryGrid.innerHTML = `<div class="muted">No photos yet.</div>`;
      return;
    }
    galleryGrid.innerHTML = "";
    for (const p of photos) {
      const url = cacheBust(toImgUrl(p.url || p.path || ""));
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "Gallery photo";
      img.src = url;
      img.onerror = () => { img.style.opacity = "0.35"; img.title = "Failed to load"; };
      galleryGrid.appendChild(img);
    }
  } catch {
    galleryGrid.innerHTML = `<div class="muted">Failed to load photos.</div>`;
  }
}

/* ---------- Render & init ---------- */
async function loadProfile() {
  let u = getLocalUser<any>();
  const qs = qsId();
  if (qs) u = { ...(u || {}), id: qs }; // viewing another user in future if needed
  if (!u?.id) {
    if (helloEl) helloEl.textContent = "You're not signed in.";
    location.href = "/account.html";
    return;
  }

  u = await loadUserFresh(u);

  // Header text + fields
  if (helloEl) helloEl.textContent = `Welcome, ${u.name || "skald"}${u.id ? ` (ID: ${u.id})` : ""}.`;
  setText(nameEl, u.name || "");
  setText(emailEl, u.email || "");
  setText(bioEl, u.bio || "");
  setText(interests, u.interests || "");
  setAvatar(u.avatarUrl);
  applyFrame(u);

  await loadStories(u.id);
  await loadGallery(u.id);
}

/* ---------- Logout ---------- */
logoutBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem(LS_KEY);
  location.href = "/";
});

/* ---------- Go ---------- */
loadProfile();












