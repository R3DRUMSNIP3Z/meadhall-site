// /src/friendprofile.ts

type SafeUser = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  bio?: string;
  interests?: string;
  createdAt?: number; // epoch ms if present
};

type Story = {
  id?: string;
  title?: string;
  text?: string;
  excerpt?: string;
  imageUrl?: string;   // may be relative
  createdAt?: number;
};

/* ------------------ helpers ------------------ */

function pickApiBase(): string {
  const m = (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim();
  // @ts-ignore vite env support if present
  return m || (import.meta?.env?.VITE_API_BASE ?? "");
}

function qs(k: string): string | null {
  const v = new URLSearchParams(location.search).get(k);
  return v && v.trim() ? v.trim() : null;
}
function fmt(ts?: number): string {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}
function el<K extends keyof HTMLElementTagNameMap>(t: K, cls?: string, txt?: string) {
  const n = document.createElement(t);
  if (cls) (n as HTMLElement).className = cls;
  if (txt != null) n.textContent = txt;
  return n as HTMLElementTagNameMap[K];
}
function esc(s: any) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;", '"':"&quot;","'":"&#39;" }[c]!));
}
function nl2br(s: string) {
  return esc(s).replace(/\n/g, "<br>");
}

/** Convert relative paths like "/uploads/..." to absolute <API_BASE>/uploads/... */
function makeFullUrl(API: string, p?: string | null): string | null {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  const base = API.replace(/\/+$/, "");
  const path = String(p).replace(/^\/+/, "");
  return `${base}/${path}`;
}
/** Append cache-buster so new avatars show up immediately */
function bust(u: string | null): string | null {
  return u ? `${u}${u.includes("?") ? "&" : "?"}t=${Date.now()}` : u;
}

/* ------------------ DOM refs (match your HTML) ------------------ */
const avatarImg  = document.getElementById("avatar") as HTMLImageElement;
const nameH1     = document.getElementById("username") as HTMLElement;
const emailSmall = document.getElementById("useremail") as HTMLElement;

const introCard    = document.getElementById("introCard") as HTMLElement;
const joinedRow    = document.getElementById("joinedRow") as HTMLElement;
const interestsRow = document.getElementById("interestsRow") as HTMLElement;
const bioRow       = document.getElementById("bioRow") as HTMLElement;

const sagaList     = document.getElementById("sagaList") as HTMLElement;
const companionsEl = document.getElementById("companionsList") as HTMLElement;
const galleryGrid  = document.getElementById("galleryGrid") as HTMLElement;

// Tabs
const tabLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.tabs a[data-tab]'));
const sections: Record<string, HTMLElement> = {
  stories: document.getElementById("tab-stories") as HTMLElement,
  companions: document.getElementById("tab-companions") as HTMLElement,
  gallery: document.getElementById("tab-gallery") as HTMLElement,
};

function showTab(tab: "stories"|"companions"|"gallery"){
  tabLinks.forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  Object.entries(sections).forEach(([k, el]) => el.classList.toggle("active", k === tab));
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}${location.search ? "" : ""}`);
}

tabLinks.forEach(a=>{
  a.addEventListener("click", (e)=>{
    e.preventDefault();
    const target = (e.currentTarget as HTMLAnchorElement).dataset.tab as "stories"|"companions"|"gallery";
    showTab(target);
  });
});

/* ------------------ Data loaders ------------------ */
async function loadUser(API: string, userId: string): Promise<SafeUser> {
  const res = await fetch(`${API}/api/users/${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`User not found (HTTP ${res.status})`);
  return await res.json();
}

async function loadStories(API: string, userId: string): Promise<Story[]> {
  const r = await fetch(`${API}/api/users/${encodeURIComponent(userId)}/stories`);
  const raw: any = await r.json();
  const list: Story[] = Array.isArray(raw) ? (raw as Story[]) : ((raw?.items ?? []) as Story[]);
  // ensure image URLs are absolute
  return list.map((s: Story) => ({
    ...s,
    imageUrl: s?.imageUrl ? makeFullUrl(API, s.imageUrl) ?? s.imageUrl : undefined
  }));
}

async function loadCompanions(API: string, userId: string) {
  companionsEl.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const r = await fetch(`${API}/api/users/${encodeURIComponent(userId)}/companions`);
    if (!r.ok) throw new Error(String(r.status));
    const list: SafeUser[] = await r.json();

    companionsEl.innerHTML = "";
    if (!Array.isArray(list) || list.length === 0) {
      companionsEl.innerHTML = `<div class="muted">No companions listed.</div>`;
      return;
    }
    for (const u of list) {
      const row = document.createElement("div");
      row.className = "comp-item";
      const avatar = bust(makeFullUrl(API, u.avatarUrl)) || "/logo/logo-512.png";
      row.innerHTML = `
        <div class="comp-meta">
          <img src="${esc(avatar)}" alt="" onerror="this.src='/logo/logo-512.png'">
          <div>
            <div class="comp-name">${esc(u.name || u.id)}</div>
            <div class="muted" style="font-size:12px">${esc(u.email || u.id)}</div>
          </div>
        </div>
        <div class="comp-actions">
          <a class="btn ghost" href="/friendprofile.html?user=${encodeURIComponent(u.id)}">View</a>
        </div>
      `;
      companionsEl.appendChild(row);
    }
  } catch {
    companionsEl.innerHTML = `<div class="muted">Companions unavailable (add <code>/api/users/:id/companions</code> on the backend to enable).</div>`;
  }
}

/* ------------------ Modal for stories ------------------ */
let modalRoot: HTMLDivElement | null = null;
function ensureModal() {
  if (modalRoot) return modalRoot;
  modalRoot = document.createElement("div");
  modalRoot.id = "storyModal";
  modalRoot.style.position = "fixed";
  modalRoot.style.inset = "0";
  modalRoot.style.background = "rgba(0,0,0,.55)";
  modalRoot.style.display = "none";
  modalRoot.style.alignItems = "center";
  modalRoot.style.justifyContent = "center";
  modalRoot.style.zIndex = "9999";

  const card = document.createElement("div");
  card.style.width = "min(860px, 92vw)";
  card.style.maxHeight = "82vh";
  card.style.overflow = "auto";
  card.style.background = "linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.15)), #151515d0";
  card.style.border = "1px solid #3b3325";
  card.style.borderRadius = "14px";
  card.style.padding = "16px 18px 18px";
  card.style.position = "relative";
  card.style.color = "var(--ink)";
  card.style.boxShadow = "0 14px 40px rgba(0,0,0,.6)";

  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.style.position = "absolute";
  close.style.top = "8px";
  close.style.right = "12px";
  close.style.border = "1px solid #3b3325";
  close.style.background = "rgba(0,0,0,.35)";
  close.style.color = "var(--ink)";
  close.style.fontSize = "20px";
  close.style.lineHeight = "1";
  close.style.borderRadius = "10px";
  close.style.padding = "6px 10px";
  close.style.cursor = "pointer";

  const title = document.createElement("h3");
  title.id = "storyModalTitle";
  title.style.margin = "0 0 6px 0";
  title.style.fontFamily = "Cinzel, serif";
  title.style.color = "var(--accent)";

  const meta = document.createElement("div");
  meta.id = "storyModalMeta";
  meta.style.fontSize = "12px";
  meta.style.color = "var(--muted)";
  meta.style.marginBottom = "10px";

  const img = document.createElement("img");
  img.id = "storyModalImage";
  img.style.maxWidth = "100%";
  img.style.borderRadius = "10px";
  img.style.border = "1px solid var(--line)";
  img.style.margin = "8px 0 10px 0";
  img.style.display = "none"; // hidden by default
  img.onerror = () => { img.style.display = "none"; };

  const body = document.createElement("div");
  body.id = "storyModalBody";
  body.style.whiteSpace = "pre-wrap";
  body.style.lineHeight = "1.5";
  body.style.color = "#e3decd";

  card.append(close, title, meta, img, body);
  modalRoot.appendChild(card);
  document.body.appendChild(modalRoot);

  const hide = () => {
    modalRoot!.style.display = "none";
    document.body.style.overflow = ""; // re-enable scroll
  };

  close.addEventListener("click", hide);
  modalRoot.addEventListener("click", (e) => { if (e.target === modalRoot) hide(); });
  document.addEventListener("keydown", (e) => { if (modalRoot!.style.display !== "none" && e.key === "Escape") hide(); });

  return modalRoot;
}

function openStoryModal(story: Story) {
  const root = ensureModal();
  const title = root.querySelector<HTMLHeadingElement>("#storyModalTitle")!;
  const meta  = root.querySelector<HTMLDivElement>("#storyModalMeta")!;
  const body  = root.querySelector<HTMLDivElement>("#storyModalBody")!;
  const img   = root.querySelector<HTMLImageElement>("#storyModalImage")!;

  title.textContent = story.title || "(untitled)";
  meta.textContent  = story.createdAt ? fmt(story.createdAt) : "";
  body.innerHTML    = nl2br(story.text || story.excerpt || "—");

  if (story.imageUrl) {
    img.src = story.imageUrl;
    img.alt = story.title || "story image";
    img.style.display = "";
  } else {
    img.style.display = "none";
  }

  root.style.display = "flex";
  document.body.style.overflow = "hidden"; // prevent background scroll
}

/* ------------------ Renderers ------------------ */
function renderStories(stories: Story[]) {
  sagaList.innerHTML = "";
  if (!stories.length) {
    sagaList.appendChild(el("div","saga","No sagas told yet."));
    return;
  }
  // newest first
  stories.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

  for (const s of stories) {
    const wrap = el("article","saga");
    const top  = el("div","top");
    const h3   = el("h3","", s.title || "(untitled)");
    const when = el("time","", fmt(s.createdAt));
    top.append(h3, when);
    wrap.append(top);

    const snippet = s.excerpt || (s.text ? s.text.slice(0, 200) + (s.text.length > 200 ? "…" : "") : "");
    if (snippet) wrap.append(el("div","excerpt", snippet));

    // OPEN INLINE (modal) — not a new page
    const btn = document.createElement("button");
    btn.textContent = "Read this saga";
    btn.style.fontSize = "13px";
    btn.style.textDecoration = "underline";
    btn.style.background = "transparent";
    btn.style.border = "none";
    btn.style.color = "var(--accent)";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => openStoryModal(s));
    wrap.append(btn);

    sagaList.append(wrap);
  }
}

function renderGalleryFromStories(stories: Story[]) {
  galleryGrid.innerHTML = "";
  const imgs = stories
    .filter((s: Story) => !!s.imageUrl)
    .map((s: Story) => ({ src: s.imageUrl!, alt: s.title || "story image" }));

  if (!imgs.length) {
    galleryGrid.innerHTML = `<div class="muted">No images yet.</div>`;
    return;
  }
  for (const im of imgs) {
    const img = new Image();
    img.src = im.src;
    img.alt = im.alt;
    img.referrerPolicy = "no-referrer";
    img.onerror = () => { img.remove(); };
    galleryGrid.appendChild(img);
  }
}

/* ------------------ MAIN ------------------ */
async function main(){
  const API = pickApiBase();
  const userId = qs("user");
  if (!userId) {
    sagaList.innerHTML = `<div class="saga">Missing query. Open like <code>friendprofile.html?user=&lt;id&gt;</code>.</div>`;
    return;
  }
  if (!API) {
    sagaList.innerHTML = `<div class="saga">Missing API base. Add &lt;meta name="api-base" content="http://localhost:5050"&gt;.</div>`;
    return;
  }

  try {
    // Profile
    const user = await loadUser(API, userId);

    // Avatar — absolute URL + cache-bust, with fallback.
    const av = bust(makeFullUrl(API, user.avatarUrl)) || "/logo/logo-512.png";
    avatarImg.src = av;
    avatarImg.alt = user.name ? `${user.name} avatar` : "avatar";
    avatarImg.onerror = () => { avatarImg.src = "/logo/logo-512.png"; };

    nameH1.textContent = `Saga of ${user.name || "Wanderer"}`;
    emailSmall.textContent = user.email || "";

    let anyIntro = false;
    if (user.createdAt) { joinedRow.textContent = `Joined the Hall on ${new Date(user.createdAt).toLocaleDateString()}`; anyIntro = true; }
    if (user.interests) { interestsRow.textContent = `Interests: ${user.interests}`; anyIntro = true; }
    if (user.bio)       { bioRow.textContent = user.bio; anyIntro = true; }
    introCard.style.display = anyIntro ? "" : "none";

    // Stories + Gallery
    const stories = await loadStories(API, userId);
    renderStories(stories);
    renderGalleryFromStories(stories);

    // Tabs boot
    const hash = (location.hash || "#stories").replace("#","") as "stories"|"companions"|"gallery";
    showTab(hash);

    // Lazy load companions only when that tab is opened
    let companionsLoaded = false;
    const ensureCompanions = async ()=> {
      if (!companionsLoaded) {
        companionsLoaded = true;
        await loadCompanions(API, userId);
      }
    };
    if (hash === "companions") ensureCompanions();
    tabLinks.forEach(a=>{
      a.addEventListener("click", ()=>{
        if (a.dataset.tab === "companions") ensureCompanions();
      });
    });

  } catch (e:any) {
    sagaList.innerHTML = `<div class="saga">Error: ${esc(e?.message || "Failed to load profile")}</div>`;
  }
}

main();















