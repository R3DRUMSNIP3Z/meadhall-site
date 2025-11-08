// /src/account.ts  — DROP-IN REPLACEMENT with Gallery support (Cloudinary-safe + CORB-safe image URLs)
console.log("account.ts loaded");

/* ---------- Types ---------- */
type SafeUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  interests?: string;
};

type Story = {
  id: string;         // or _id; normalized via storyId()
  _id?: string;
  title: string;
  text: string;
  createdAt: number | string;
  updatedAt?: number | string;
};

type Photo = {
  id: string;            // server id or derived from url
  url: string;           // absolute or relative (Cloudinary or /uploads)
  createdAt?: number | string;
};

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

/* ---------- helpers ---------- */
const LS_KEY = "mh_user";
const BIND_KEY = "__mhStoriesBound"; // singleton guard

function getUserFromLS(): SafeUser | null {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
}
function setUserToLS(u: SafeUser) { localStorage.setItem(LS_KEY, JSON.stringify(u)); }
function normalizeId(raw: any): string { return String(raw ?? "").replace(/\s+/g, "_").trim(); }

// Build an absolute URL from a possibly-relative path
function fullUrl(p?: string) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  const base = (API_BASE || "").replace(/\/+$/, "");
  const path = String(p).replace(/^\/+/, "");
  return `${base}/${path}`;
}

// Force URL to use the backend origin for *relative/backend* assets,
// but DO NOT rewrite absolute third-party hosts (e.g., Cloudinary).
function forceBackendHost(u: string) {
  // If it's already an absolute URL to a different host (Cloudinary, etc), keep it.
  if (/^https?:\/\//i.test(u)) {
    try {
      const backend = new URL(API_BASE || window.location.origin);
      const urlObj = new URL(u);
      if (urlObj.host !== backend.host) return u;
    } catch { /* ignore */ }
  }
  // Otherwise, resolve relative against backend and pin to backend host.
  const abs = fullUrl(u);
  try {
    const backend = new URL(API_BASE || window.location.origin);
    const out = new URL(abs);
    out.protocol = backend.protocol;
    out.host = backend.host;
    return out.toString();
  } catch {
    return abs;
  }
}

function cacheBust(u: string) {
  if (!u) return u;
  const t = `t=${Date.now()}`;
  return u.includes("?") ? `${u}&${t}` : `${u}?${t}`;
}

function fmt(ts?: number | string) {
  if (!ts && ts !== 0) return "";
  const d = new Date(typeof ts === "number" ? ts : String(ts));
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}
function storyId(s: Story) { return s.id || (s as any)._id || ""; }

/* ---------- elements ---------- */
const helloEl      = document.getElementById("hello") as HTMLElement | null;

const avatarImg    = document.getElementById("avatarImg") as HTMLImageElement | null;
const avatarFile   = document.getElementById("avatarFile") as HTMLInputElement | null;
const uploadBtn    = document.getElementById("uploadBtn") as HTMLButtonElement | null;

const nameEl       = document.getElementById("name") as HTMLInputElement | null;
const emailEl      = document.getElementById("email") as HTMLInputElement | null;
const bioEl        = document.getElementById("bio") as HTMLTextAreaElement | null;
const interestsEl  = document.getElementById("interests") as HTMLInputElement | null;

const saveBtn      = document.getElementById("saveProfile") as HTMLButtonElement | null;
const profileMsg   = document.getElementById("profileMsg") as HTMLElement | null;

const storyTitleEl = document.getElementById("storyTitle") as HTMLInputElement | null;
const storyTextEl  = document.getElementById("storyText") as HTMLTextAreaElement | null;
const addStoryBtn  = document.getElementById("addStory") as HTMLButtonElement | null;
const storiesEl    = document.getElementById("stories") as HTMLDivElement | null;

const logoutLink   = document.getElementById("logout") as HTMLAnchorElement | null;

// Gallery elements
const galleryFiles = document.getElementById("galleryFiles") as HTMLInputElement | null;
const uploadPhotosBtn = document.getElementById("uploadPhotos") as HTMLButtonElement | null;
const galleryMsg   = document.getElementById("galleryMsg") as HTMLElement | null;
const galleryGrid  = document.getElementById("galleryGrid") as HTMLDivElement | null;

/* ---------- init ---------- */
let currentUser = getUserFromLS();
if (!currentUser?.id) {
  alert("Please sign up or log in first.");
  location.href = "/";
} else {
  currentUser.id = normalizeId(currentUser.id);
  setUserToLS(currentUser);
}

if (helloEl && currentUser) {
  helloEl.textContent = `Welcome, ${currentUser.name}. Edit your profile and share your stories.`;
}

/* ---------- loaders ---------- */
async function loadUser() {
  try {
    const r = await fetch(`${API_BASE}/api/users/${currentUser!.id}`);
    if (!r.ok) return;
    const u: SafeUser = await r.json();
    if (avatarImg) {
      const src = u.avatarUrl
        ? cacheBust(forceBackendHost(u.avatarUrl))
        : "/images/odin-hero.jpg";
      avatarImg.src = src;
      avatarImg.onerror = () => { avatarImg.src = "/images/odin-hero.jpg"; };
    }
    if (nameEl) nameEl.value = u.name || "";
    if (emailEl) emailEl.value = u.email || "";
    if (bioEl) bioEl.value = u.bio || "";
    if (interestsEl) interestsEl.value = u.interests || "";
    setUserToLS({ ...currentUser!, ...u });
  } catch (err) {
    console.error("loadUser error", err);
  }
}

async function fetchStories(): Promise<Story[]> {
  const r = await fetch(`${API_BASE}/api/users/${currentUser!.id}/stories`);
  if (!r.ok) throw new Error(await r.text());
  const list: Story[] = await r.json();
  return Array.isArray(list) ? list : [];
}

/* ---------- GALLERY: fetch / upload / delete ---------- */

function normalizePhotoArray(raw: any): Photo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p: any, i: number) => {
    if (typeof p === "string") return { id: String(i), url: p };
    const id = p.id || p._id || String(i);
    const url = p.url || p.path || p.src || "";
    return { id: String(id), url };
  }).filter(p => p.url);
}

async function fetchGallery(): Promise<Photo[]> {
  const endpoints = [
    `${API_BASE}/api/users/${currentUser!.id}/gallery`,
    `${API_BASE}/api/gallery?user=${encodeURIComponent(currentUser!.id)}`
  ];
  for (const u of endpoints) {
    try {
      const r = await fetch(u, {
  headers: { "x-user-id": currentUser!.id } // ADD
});
      if (!r.ok) continue;
      const data = await r.json();
      const list = Array.isArray(data?.items) ? data.items : data;
      const photos = normalizePhotoArray(list);
      return photos;
    } catch {}
  }
  return [];
}

async function uploadPhotos(files: FileList): Promise<Photo[]> {
  const fd = new FormData();
  // Only one field name needed; backend accepts "photos" or "photo[]"
  Array.from(files).forEach((f) => fd.append("photos", f));

  const endpoints = [
    `${API_BASE}/api/account/gallery`,
    `${API_BASE}/api/users/${currentUser!.id}/gallery`,
  ];

  for (const u of endpoints) {
    try {
      const r = await fetch(u, {
        method: "POST",
        body: fd,
        headers: { "x-user-id": currentUser!.id }, // server also accepts param/query/body
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((payload && (payload.error || payload.message)) || `HTTP ${r.status}`);

      const items = Array.isArray(payload?.items) ? payload.items
                  : Array.isArray(payload) ? payload
                  : payload?.photo ? [payload.photo]
                  : payload?.url ? [payload]
                  : [];
      const photos = normalizePhotoArray(items);
      if (photos.length) return photos;
    } catch {
      // try next endpoint
    }
  }
  throw new Error("Upload failed (no working endpoint)");
}

async function deletePhotoOnServer(photoId: string): Promise<void> {
  const urls = [
    `${API_BASE}/api/users/${currentUser!.id}/gallery/${encodeURIComponent(photoId)}`,
    `${API_BASE}/api/gallery/${encodeURIComponent(photoId)}`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
  method: "DELETE",
  headers: { "x-user-id": currentUser!.id } // ADD
});
      if (r.ok || r.status === 204) return;
    } catch {}
  }
  throw new Error("Delete failed (no matching endpoint)");
}

/* ---------- gallery UI ---------- */

function clearGalleryUI() {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = "";
}

function renderGallery(photos: Photo[]) {
  if (!galleryGrid) return;

  clearGalleryUI();
  if (!photos.length) {
    galleryGrid.innerHTML = `<div class="muted">No photos yet.</div>`;
    return;
  }

  for (const p of photos) {
    const wrap = document.createElement("div");
    wrap.style.position = "relative";

    const img = document.createElement("img");
    // Force backend only for relative/backend assets; Cloudinary stays untouched.
    img.src = cacheBust(forceBackendHost(p.url));
    img.alt = "gallery photo";
    img.style.width = "100%";
    img.style.aspectRatio = "1 / 1";
    img.style.objectFit = "cover";
    img.style.borderRadius = "10px";
    img.style.border = "1px solid rgba(200,169,107,.2)";
    img.onerror = () => { img.style.opacity = "0.4"; };

    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Remove photo";
    del.style.position = "absolute";
    del.style.top = "6px";
    del.style.right = "6px";
    del.style.width = "26px";
    del.style.height = "26px";
    del.style.borderRadius = "8px";
    del.style.border = "1px solid rgba(200,169,107,.5)";
    del.style.background = "rgba(0,0,0,.55)";
    del.style.color = "white";
    del.style.cursor = "pointer";
    del.addEventListener("click", async () => {
      if (!confirm("Remove this photo from your gallery?")) return;
      try {
        await deletePhotoOnServer(p.id);
      } catch {
        try { await deletePhotoOnServer(encodeURIComponent(p.id || p.url)); } catch {}
      }
      await loadGallery();
    });

    wrap.appendChild(img);
    wrap.appendChild(del);
    galleryGrid.appendChild(wrap);
  }
}

async function loadGallery() {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const items = await fetchGallery();
    renderGallery(items);
  } catch {
    galleryGrid.innerHTML = `<div class="muted">Failed to load gallery.</div>`;
  }
}

/* ---------- stories UI ---------- */

function clearStoriesUI() {
  if (!storiesEl) return;
  storiesEl.innerHTML = "";
}

function renderStories(list: Story[]) {
  if (!storiesEl) return;
  clearStoriesUI();
  if (!list.length) {
    storiesEl.innerHTML = `<div class="muted">No stories yet.</div>`;
    return;
  }

  const seen = new Set<string>();
  for (const s of list) {
    const id = storyId(s);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    storiesEl.appendChild(renderStoryCard(s));
  }
}

async function loadStories() {
  if (!storiesEl) return;
  storiesEl.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const list = await fetchStories();
    renderStories(list);
  } catch (err) {
    console.error("loadStories error", err);
    storiesEl.textContent = "Failed to load stories.";
  }
}

/* ---------- Story actions (Create / Update / Delete) ---------- */

async function createStory(title: string, text: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/users/${currentUser!.id}/stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, text }),
  });
  if (!r.ok) throw new Error(await r.text());
  await loadStories();
}

async function updateStoryOnServer(storyIdStr: string, patch: Partial<Pick<Story, "title" | "text">>): Promise<void> {
  const urls = [
    `${API_BASE}/api/users/${currentUser!.id}/stories/${storyIdStr}`,
    `${API_BASE}/api/stories/${storyIdStr}`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (r.ok) return;
    } catch {}
  }
  throw new Error("Update failed (no matching endpoint)");
}

async function deleteStoryOnServer(storyIdStr: string): Promise<void> {
  const urls = [
    `${API_BASE}/api/users/${currentUser!.id}/stories/${storyIdStr}`,
    `${API_BASE}/api/stories/${storyIdStr}`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: "DELETE" });
      if (r.ok || r.status === 204) return;
    } catch {}
  }
  throw new Error("Delete failed (no matching endpoint)");
}

/* ---------- Render one story with Edit/Delete ---------- */
function renderStoryCard(s: Story): HTMLDivElement {
  const id = storyId(s);
  const div = document.createElement("div");
  div.className = "story";
  div.dataset.id = id;

  const titleEl = document.createElement("strong");
  titleEl.style.fontSize = "18px";
  titleEl.textContent = s.title || "Untitled";

  const metaEl = document.createElement("div");
  metaEl.className = "muted";
  metaEl.style.fontSize = "12px";
  metaEl.textContent = [s.createdAt ? `Created ${fmt(s.createdAt)}` : "", s.updatedAt ? `Updated ${fmt(s.updatedAt)}` : ""]
    .filter(Boolean)
    .join(" • ");

  const textEl = document.createElement("p");
  textEl.style.whiteSpace = "pre-wrap";
  textEl.style.margin = ".4em 0 0";
  textEl.textContent = s.text || "";

  const actions = document.createElement("div");
  actions.className = "cta-row";
  actions.style.justifyContent = "flex-end";
  actions.style.marginTop = "8px";

  const editBtn = document.createElement("button");
  editBtn.className = "btn btn-ghost";
  editBtn.textContent = "Edit";

  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-ghost";
  delBtn.textContent = "Delete";

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  const editWrap = document.createElement("div");
  editWrap.style.display = "none";

  const editTitle = document.createElement("input");
  editTitle.className = "input";
  editTitle.placeholder = "Title";

  const editText = document.createElement("textarea");
  editText.className = "input";
  editText.rows = 5;
  editText.placeholder = "Your tale…";

  const editBtns = document.createElement("div");
  editBtns.className = "cta-row";
  editBtns.style.justifyContent = "flex-end";
  editBtns.style.marginTop = "8px";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-viking";
  saveBtn.textContent = "Save";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-ghost";
  cancelBtn.textContent = "Cancel";

  editBtns.appendChild(saveBtn);
  editBtns.appendChild(cancelBtn);
  editWrap.appendChild(editTitle);
  editWrap.appendChild(editText);
  editWrap.appendChild(editBtns);

  div.appendChild(titleEl);
  div.appendChild(metaEl);
  div.appendChild(textEl);
  div.appendChild(actions);
  div.appendChild(editWrap);

  function enterEdit() {
    editTitle.value = s.title || "";
    editText.value = s.text || "";
    titleEl.style.display = "none";
    textEl.style.display = "none";
    actions.style.display = "none";
    editWrap.style.display = "block";
  }
  function exitEdit() {
    editWrap.style.display = "none";
    titleEl.style.display = "";
    textEl.style.display = "";
    actions.style.display = "";
  }

  editBtn.addEventListener("click", enterEdit);
  cancelBtn.addEventListener("click", exitEdit);

  saveBtn.addEventListener("click", async () => {
    const newTitle = (editTitle.value || "").trim();
    const newText  = editText.value || "";

    try {
      await updateStoryOnServer(id, { title: newTitle, text: newText });
      await loadStories();
    } catch (err) {
      console.error(err);
      alert("Failed to save story.");
    }
  });

  delBtn.addEventListener("click", async () => {
    if (!confirm("Delete this story?")) return;
    try {
      await deleteStoryOnServer(id);
      await loadStories();
    } catch (err) {
      console.error(err);
      alert("Failed to delete story.");
    }
  });

  return div;
}

/* ---------- actions ---------- */
if (!(window as any)[BIND_KEY]) {
  (window as any)[BIND_KEY] = true;

  // Avatar upload
  uploadBtn?.addEventListener("click", async () => {
    if (!avatarFile?.files?.[0]) return alert("Choose a file first.");
    const fd = new FormData();
    fd.append("avatar", avatarFile.files[0]);

    try {
      const up = await fetch(`${API_BASE}/api/account/avatar`, { method: "POST", body: fd });
      const payload = await up.json().catch(() => ({} as any));
      if (!up.ok || !payload?.url) {
        const msg = (payload as any)?.error || "Upload failed";
        return alert(msg);
      }

      const rawUrl = payload.url as string; // "/uploads/1699...-pic.png"
      const absolute = forceBackendHost(rawUrl);

      const put = await fetch(`${API_BASE}/api/users/${currentUser!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: rawUrl }),
      });
      if (!put.ok) {
        const e = await put.text();
        console.warn("Avatar uploaded but failed to persist on server:", e);
      }

      if (avatarImg) avatarImg.src = cacheBust(absolute);
      setUserToLS({ ...currentUser!, avatarUrl: rawUrl });
    } catch (err) {
      console.error("avatar upload error", err);
      alert("Upload failed");
    }
  });

  // Save profile
  saveBtn?.addEventListener("click", async () => {
    if (profileMsg) profileMsg.textContent = "Saving...";
    const body = {
      name: nameEl?.value || "",
      bio: bioEl?.value || "",
      interests: interestsEl?.value || "",
    };
    try {
      const r = await fetch(`${API_BASE}/api/users/${currentUser!.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const u = await r.json().catch(() => ({}));
      if (!r.ok) { if (profileMsg) profileMsg.textContent = (u as any)?.error || "Save failed"; return; }
      setUserToLS({ ...currentUser!, ...(u as SafeUser) });
      if (profileMsg) profileMsg.textContent = "Profile saved.";
    } catch (err) {
      console.error("save profile error", err);
      if (profileMsg) profileMsg.textContent = "Save failed.";
    }
  });

  // Add story
  addStoryBtn?.addEventListener("click", async () => {
    const title = storyTitleEl?.value?.trim();
    const text  = storyTextEl?.value?.trim();
    if (!title || !text) return alert("Please fill both title and story.");

    try {
      await createStory(title, text);
      if (storyTitleEl) storyTitleEl.value = "";
      if (storyTextEl)  storyTextEl.value = "";
    } catch (err) {
      console.error("addStory error", err);
      alert("Add story failed");
    }
  });

  // Logout
  logoutLink?.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem(LS_KEY);
    location.href = "/";
  });

  // Gallery: upload photos
  uploadPhotosBtn?.addEventListener("click", async () => {
    if (!galleryFiles?.files || galleryFiles.files.length === 0) {
      alert("Choose one or more images first.");
      return;
    }
    try {
      if (galleryMsg) galleryMsg.textContent = "Uploading…";
      await uploadPhotos(galleryFiles.files);
      if (galleryFiles) galleryFiles.value = "";
      await loadGallery();
      if (galleryMsg) galleryMsg.textContent = "Upload complete.";
      setTimeout(() => { if (galleryMsg) galleryMsg.textContent = ""; }, 1500);
    } catch (e: any) {
      console.error(e);
      if (galleryMsg) galleryMsg.textContent = e?.message || "Upload failed.";
    }
  });
}

/* ---------- go ---------- */
loadUser();
loadStories();
loadGallery();














