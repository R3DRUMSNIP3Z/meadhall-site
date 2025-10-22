// src/profile.ts
console.log("profile.ts loaded");

/* ---------- API base (meta > window.ENV > import.meta.env) ---------- */
function pickApiBase(sources: any): string {
  const meta = (sources.meta || "").trim();
  if (meta) return meta;
  if (sources.env?.VITE_API_BASE) return sources.env.VITE_API_BASE;
  if (sources.vite?.VITE_API_BASE) return sources.vite.VITE_API_BASE;
  return "";
}
const META =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content ||
  "";
const API_BASE =
  pickApiBase({
    meta: META,
    env: (window as any).ENV || {},
    vite: (import.meta as any)?.env || {},
  }) || "";

/* ---------- URL helpers ---------- */
// Make relative paths absolute to the backend (e.g., "/uploads/…")
function fullUrl(p?: string | null): string {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  const base = (API_BASE || "").replace(/\/+$/, "");
  const path = String(p).replace(/^\/+/, "");
  return `${base}/${path}`;
}
const cacheBust = (u?: string | null) =>
  !u ? "" : u.includes("?") ? `${u}&t=${Date.now()}` : `${u}?t=${Date.now()}`;

/* ---------- Session helpers ---------- */
const LS_KEY = "mh_user";
const getLocalUser = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "null");
  } catch {
    return null;
  }
};

/* ---------- DOM ---------- */
// avatarImg is what profile.html uses; keep other ids as fallbacks
const avatarEl =
  (document.getElementById("avatar") as HTMLImageElement | null) ||
  (document.getElementById("viewAvatar") as HTMLImageElement | null) ||
  (document.getElementById("avatarImg") as HTMLImageElement | null);

const nameEl = document.getElementById("name") as HTMLElement | null;
const emailEl = document.getElementById("email") as HTMLElement | null;
const roleEl = document.getElementById("role") as HTMLElement | null;
const storiesEl = document.getElementById("stories") as HTMLElement | null;
const galleryGrid = document.getElementById("galleryGrid") as HTMLDivElement | null;
const logoutBtn = document.getElementById("logout") as HTMLButtonElement | null;

/* ---------- Misc utils ---------- */
function qsId(): string | null {
  const p = new URLSearchParams(location.search);
  return p.get("id");
}
function setText(el: HTMLElement | null, text: string) {
  if (el) el.textContent = text;
}
function setAvatar(url?: string | null) {
  const src = url && url.trim()
    ? cacheBust(fullUrl(url))
    : "/logo/avatar-placeholder.svg";
  if (avatarEl) {
    avatarEl.src = src;
    avatarEl.onerror = () => {
      avatarEl.src = "/logo/avatar-placeholder.svg";
    };
  }
}
function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------- Stories ---------- */
async function loadStories(uid: string) {
  if (!storiesEl) return;
  storiesEl.innerHTML = `<p class="muted">Loading stories…</p>`;
  try {
    const rs = await fetch(`${API_BASE || location.origin}/api/users/${uid}/stories`);
    if (!rs.ok) throw new Error(await rs.text());
    const list: Array<{
      id: string;
      title: string;
      text: string;
      createdAt: number;
      updatedAt?: number;
    }> = await rs.json();

    if (!Array.isArray(list) || list.length === 0) {
      storiesEl.innerHTML = `<p class="muted">No stories yet.</p>`;
      return;
    }

    storiesEl.innerHTML = "";
    for (const s of list) {
      const div = document.createElement("div");
      div.className = "story";
      const when = s.createdAt ? new Date(s.createdAt).toLocaleString() : "";
      const upd = s.updatedAt ? ` • Updated ${new Date(s.updatedAt).toLocaleString()}` : "";
      div.innerHTML =
        `<strong>${escapeHtml(s.title)}</strong>` +
        `<div class="muted" style="font-size:12px">${when}${upd}</div>` +
        `<p style="white-space:pre-wrap;margin:.4em 0 0">${escapeHtml(s.text)}</p>`;
      storiesEl.appendChild(div);
    }
  } catch {
    storiesEl.innerHTML = `<p class="muted">Could not load stories.</p>`;
  }
}

/* ---------- Gallery ---------- */
type Photo = { id: string; url: string; createdAt?: number | string };

function normalizePhotos(raw: any): Photo[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}
function toImgUrl(p?: string) {
  return /^https?:\/\//i.test(p || "") ? (p as string) : fullUrl(p || "");
}

async function fetchGallery(uid: string): Promise<Photo[]> {
  const endpoints = [
    `${API_BASE}/api/users/${uid}/gallery`,
    `${API_BASE}/api/gallery?user=${encodeURIComponent(uid)}`,
  ];
  for (const u of endpoints) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const data = await r.json();
      return normalizePhotos(data);
    } catch {
      // try next endpoint
    }
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
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "Gallery photo";
      img.src = cacheBust(toImgUrl(p.url));
      img.onerror = () => {
        img.style.opacity = "0.35";
        img.title = "Failed to load";
      };
      galleryGrid.appendChild(img);
    }
  } catch {
    galleryGrid.innerHTML = `<div class="muted">Failed to load photos.</div>`;
  }
}

/* ---------- Load profile (user + stories + gallery) ---------- */
async function loadProfile() {
  const local = getLocalUser();
  const id = qsId() || local?.id;
  if (!id) {
    console.warn("No user id found; redirecting to account.");
    location.href = "/account.html";
    return;
  }

  // Try API, fall back to local
  let apiUser: any = null;
  try {
    const r = await fetch(`${API_BASE || location.origin}/api/users/${id}`);
    if (r.ok) apiUser = await r.json();
  } catch (e) {
    console.warn("Fetch user failed, using local session.", e);
  }

  const user = apiUser || local;
  if (!user) {
    alert("User not found.");
    location.href = "/account.html";
    return;
  }

  setText(nameEl, user.name || "Your Name");
  setText(emailEl, user.email || "you@example.com");
  setText(roleEl, user.role || "Guild Member");
  setAvatar(user.avatarUrl || local?.avatarUrl);

  await loadStories(id);
  await loadGallery(id);
}

/* ---------- Logout ---------- */
logoutBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem(LS_KEY);
  location.href = "/";
});

/* ---------- Go ---------- */
loadProfile();












