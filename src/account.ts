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
function fullUrl(p?: string) {
  if (!p) return "";
  return /^https?:\/\//i.test(p) ? p : `${API_BASE}${p}`;
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
    if (avatarImg) avatarImg.src = u.avatarUrl ? fullUrl(u.avatarUrl) : "/images/odin-hero.jpg";
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

  // hard de-dupe by id
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
  storiesEl.innerHTML = `<div class="muted">Loadingâ€¦</div>`;
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
  // Reload once to avoid local/prepend collisions
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
    .join(" â€¢ ");

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

  // --- Edit mode
  const editWrap = document.createElement("div");
  editWrap.style.display = "none";

  const editTitle = document.createElement("input");
  editTitle.className = "input";
  editTitle.placeholder = "Title";

  const editText = document.createElement("textarea");
  editText.className = "input";
  editText.rows = 5;
  editText.placeholder = "Your taleâ€¦";

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

  // Compose
  div.appendChild(titleEl);
  div.appendChild(metaEl);
  div.appendChild(textEl);
  div.appendChild(actions);
  div.appendChild(editWrap);

  // --- Handlers
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
      await loadStories(); // reload to avoid any drift/dup
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
// Singleton guard: prevent double-binding if the script is accidentally loaded twice
if (!(window as any)[BIND_KEY]) {
  (window as any)[BIND_KEY] = true;

  uploadBtn?.addEventListener("click", async () => {
    if (!avatarFile?.files?.[0]) return alert("Choose a file first.");
    const fd = new FormData();
    fd.append("file", avatarFile.files[0]); // server expects "file"
    try {
      const r = await fetch(`${API_BASE}/api/users/${currentUser!.id}/avatar`, { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return alert((data as any)?.error || "Upload failed");
      const raw = (data as any).avatarUrl as string;   // e.g. "/uploads/xyz.png" (or full URL)
      const url = fullUrl(raw) || raw;
      if (avatarImg) avatarImg.src = `${url}?t=${Date.now()}`; // cache-bust
      setUserToLS({ ...currentUser!, avatarUrl: raw });
    } catch (err) {
      console.error("avatar upload error", err);
      alert("Upload failed");
    }
  });

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

  addStoryBtn?.addEventListener("click", async () => {
    const title = storyTitleEl?.value?.trim();
    const text  = storyTextEl?.value?.trim();
    if (!title || !text) return alert("Please fill both title and story.");

    try {
      await createStory(title, text);
      if (storyTitleEl) storyTitleEl.value = "";
      if (storyTextEl)  storyTextEl.value = "";
      // loadStories() is called inside createStory
    } catch (err) {
      console.error("addStory error", err);
      alert("Add story failed");
    }
  });

  logoutLink?.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem(LS_KEY);
    location.href = "/";
  });
}

/* ---------- go ---------- */
loadUser();
loadStories();













