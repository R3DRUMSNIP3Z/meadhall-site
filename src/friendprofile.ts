// /src/friendprofile.ts — LIGHTBOX + MUG REACTIONS + COMMENTS (clean build)

type SafeUser = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  bio?: string;
  interests?: string;
  createdAt?: number;
};

type Story = {
  id?: string;
  title?: string;
  text?: string;
  excerpt?: string;
  imageUrl?: string;
  createdAt?: number;
};

type Photo = { id: string; url: string; createdAt?: number | string };

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
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function el<K extends keyof HTMLElementTagNameMap>(t: K, cls?: string, txt?: string) {
  const n = document.createElement(t);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n as HTMLElementTagNameMap[K];
}

function esc(s: any) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]!
  );
}

function nl2br(s: string) {
  return esc(s).replace(/\n/g, "<br>");
}

function fullUrl(p?: string | null): string {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  const API = pickApiBase();
  const base = (API || "").replace(/\/+$/, "");
  const path = String(p).replace(/^\/+/, "");
  return `${base}/${path}`;
}

function cacheBust(u?: string | null): string {
  if (!u) return "";
  const bust = `t=${Date.now()}`;
  return u.includes("?") ? `${u}&${bust}` : `${u}?${bust}`;
}

function avatarSrc(p?: string | null): string {
  const src = p && p.trim() ? fullUrl(p) : "/logo/avatar-placeholder.svg";
  return cacheBust(src);
}

/* ------------------ DOM refs ------------------ */
const avatarImg = document.getElementById("avatar") as HTMLImageElement;
const nameH1 = document.getElementById("username") as HTMLElement;
const emailSmall = document.getElementById("useremail") as HTMLElement;

const joinedRow = document.getElementById("joinedRow") as HTMLElement;
const interestsRow = document.getElementById("interestsRow") as HTMLElement;
const bioRow = document.getElementById("bioRow") as HTMLElement;

const sagaList = document.getElementById("sagaList") as HTMLElement;
const companionsEl = document.getElementById("companionsList") as HTMLElement;
const galleryGrid = document.getElementById("galleryGrid") as HTMLElement;

/* ------------------ Tabs ------------------ */
const tabLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.tabs a[data-tab]'));
const sections: Record<string, HTMLElement> = {
  stories: document.getElementById("tab-stories") as HTMLElement,
  companions: document.getElementById("tab-companions") as HTMLElement,
  gallery: document.getElementById("tab-gallery") as HTMLElement,
};

function showTab(tab: "stories" | "companions" | "gallery") {
  tabLinks.forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  Object.entries(sections).forEach(([k, el]) => el.classList.toggle("active", k === tab));
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}${location.search ? "" : ""}`);
}

tabLinks.forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const target = (e.currentTarget as HTMLAnchorElement).dataset.tab as "stories" | "companions" | "gallery";
    showTab(target);
  });
});

/* ------------------ Loaders ------------------ */
async function loadUser(API: string, userId: string): Promise<SafeUser> {
  const res = await fetch(`${API}/api/users/${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`User not found (HTTP ${res.status})`);
  return await res.json();
}

async function loadStories(API: string, userId: string): Promise<Story[]> {
  const r = await fetch(`${API}/api/users/${encodeURIComponent(userId)}/stories`);
  const raw = await r.json();
  const list: Story[] = Array.isArray(raw) ? raw : raw?.items ?? [];
  return list.map((s) => ({ ...s, imageUrl: s.imageUrl ? fullUrl(s.imageUrl) : undefined }));
}

/* ------ GALLERY + LIGHTBOX ------ */
function normalizePhotoArray(raw: any): Photo[] {
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
  if (!Array.isArray(arr)) return [];
  return arr
    .map((p: any, i: number) => {
      if (typeof p === "string") return { id: String(i), url: p };
      const id = p?.id || p?._id || String(i);
      const url = p?.url || p?.path || p?.src || "";
      const createdAt = p?.createdAt;
      return { id: String(id), url, createdAt };
    })
    .filter((p) => !!p.url);
}

// Lightbox
const LB = {
  root: null as HTMLDivElement | null,
  img: null as HTMLImageElement | null,
  prevBtn: null as HTMLButtonElement | null,
  nextBtn: null as HTMLButtonElement | null,
  closeBtn: null as HTMLButtonElement | null,
  counter: null as HTMLSpanElement | null,
  urls: [] as string[],
  index: 0,
  ensureDom() {
    if (this.root) return;
    const div = document.createElement("div");
    div.className = "lightbox";
    div.innerHTML = `
      <button class="lb-close" aria-label="Close">✕</button>
      <button class="lb-prev" aria-label="Previous">‹</button>
      <div class="lb-stage"><img class="lb-img" alt="Photo"/></div>
      <button class="lb-next" aria-label="Next">›</button>
      <div class="lb-meta"><span class="lb-counter">1 / 1</span></div>
    `;
    Object.assign(div.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,.85)",
      display: "none",
      opacity: "0",
      transition: "opacity .18s ease",
      zIndex: "9999",
    });

    const stage = div.querySelector(".lb-stage") as HTMLDivElement;
    Object.assign(stage.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "60px 80px",
    });

    const img = div.querySelector(".lb-img") as HTMLImageElement;
    Object.assign(img.style, {
      maxWidth: "min(92vw,1400px)",
      maxHeight: "86vh",
      borderRadius: "12px",
      boxShadow: "0 10px 40px rgba(0,0,0,.6)",
      objectFit: "contain",
      background: "#111",
    });

    const styleBtn = (btn: HTMLButtonElement, pos: "prev"|"next"|"close") => {
      Object.assign(btn.style, {
        position: "absolute",
        background: "rgba(20,20,20,.5)",
        border: "1px solid rgba(200,169,107,.35)",
        color: "#e9e4d5",
        borderRadius: "999px",
        width: "44px",
        height: "44px",
        cursor: "pointer",
      });
      if (pos === "prev") { btn.style.left = "18px"; btn.style.top = "50%"; btn.style.transform = "translateY(-50%)"; }
      if (pos === "next") { btn.style.right = "18px"; btn.style.top = "50%"; btn.style.transform = "translateY(-50%)"; }
      if (pos === "close") { btn.style.right = "18px"; btn.style.top = "18px"; }
    };

    const prev = div.querySelector(".lb-prev") as HTMLButtonElement;
    const next = div.querySelector(".lb-next") as HTMLButtonElement;
    const close = div.querySelector(".lb-close") as HTMLButtonElement;
    styleBtn(prev, "prev"); styleBtn(next, "next"); styleBtn(close, "close");

    const meta = div.querySelector(".lb-meta") as HTMLDivElement;
    Object.assign(meta.style, {
      position: "absolute",
      left: "0",
      right: "0",
      bottom: "10px",
      textAlign: "center",
      color: "#d8caa6",
      fontSize: "13px",
    });

    document.body.appendChild(div);
    this.root = div;
    this.img = img;
    this.prevBtn = prev;
    this.nextBtn = next;
    this.closeBtn = close;
    this.counter = meta.querySelector(".lb-counter") as HTMLSpanElement;

    prev.addEventListener("click", () => this.prev());
    next.addEventListener("click", () => this.next());
    close.addEventListener("click", () => this.close());
    div.addEventListener("click", (e) => { if (e.target === div) this.close(); });
    window.addEventListener("keydown", (e) => {
      if (div.style.display !== "block") return;
      if (e.key === "Escape") this.close();
      if (e.key === "ArrowRight") this.next();
      if (e.key === "ArrowLeft") this.prev();
    });
  },
  open(i = 0) {
    this.ensureDom();
    if (!this.root || !this.img || !this.urls.length) return;
    this.index = (i + this.urls.length) % this.urls.length;
    this.img.src = this.urls[this.index];
    this.counter!.textContent = `${this.index + 1} / ${this.urls.length}`;
    this.root.style.display = "block";
    requestAnimationFrame(() => (this.root!.style.opacity = "1"));
    document.body.style.overflow = "hidden";
  },
  close() {
    if (!this.root) return;
    this.root.style.opacity = "0";
    setTimeout(() => (this.root!.style.display = "none"), 180);
    document.body.style.overflow = "";
  },
  next() { this.open(this.index + 1); },
  prev() { this.open(this.index - 1); },
};

async function loadGallery(API: string, userId: string): Promise<Photo[]> {
  const r = await fetch(`${API}/api/users/${encodeURIComponent(userId)}/gallery`);
  if (!r.ok) return [];
  const data = await r.json();
  return normalizePhotoArray(data);
}

/* ------------------ Gallery Renderer ------------------ */
function renderGalleryFromPhotos(photos: Photo[]) {
  galleryGrid.innerHTML = "";
  if (!photos.length) {
    galleryGrid.innerHTML = `<div class="muted">No images yet.</div>`;
    LB.urls = [];
    return;
  }

  LB.urls = photos.map((p) => cacheBust(fullUrl(p.url)));

  // Use classic for-loop to avoid unused param warnings and for perf
  for (let i = 0; i < photos.length; i++) {
    const imgWrap = document.createElement("div");
    Object.assign(imgWrap.style, {
      position: "relative",
      borderRadius: "10px",
      overflow: "hidden",
      border: "1px solid var(--line)",
      background: "rgba(0,0,0,.3)",
    });

    const img = new Image();
    const url = LB.urls[i];
    img.src = url;
    img.alt = "gallery image";
    img.loading = "lazy";
    img.draggable = false; // prevent ghost-drag
    Object.assign(img.style, {
      width: "100%",
      aspectRatio: "1/1",
      objectFit: "cover",
      cursor: "zoom-in",
      display: "block",
    });
    img.addEventListener("click", () => LB.open(i));
    imgWrap.appendChild(img);

    // Reaction bar
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "absolute",
      bottom: "6px",
      right: "6px",
      display: "flex",
      gap: "8px",
      background: "rgba(0,0,0,.45)",
      borderRadius: "8px",
      padding: "4px 6px",
      backdropFilter: "blur(2px)",
      alignItems: "center",
    });

    const likeBtn = document.createElement("button");
    const dislikeBtn = document.createElement("button");
    const commentBtn = document.createElement("button");
    [likeBtn, dislikeBtn, commentBtn].forEach((b) =>
      Object.assign(b.style, {
        background: "none",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
      })
    );

    likeBtn.innerHTML = `<img src="/guildbook/mugup.png" class="mug-icon" alt="like" width="20" height="20">`;
    dislikeBtn.innerHTML = `<img src="/guildbook/mugdown.png" class="mug-icon" alt="dislike" width="20" height="20">`;
    commentBtn.textContent = "💬";

    likeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      likeBtn.querySelector("img")?.classList.toggle("active");
      dislikeBtn.querySelector("img")?.classList.remove("active");
    });
    dislikeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dislikeBtn.querySelector("img")?.classList.toggle("active");
      likeBtn.querySelector("img")?.classList.remove("active");
    });
    commentBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const txt = prompt("Leave a comment on this post:");
      if (txt && txt.trim()) {
        // placeholder: hook up to backend later
        alert(`Your comment: "${txt.trim()}"`);
      }
    });

    bar.append(likeBtn, dislikeBtn, commentBtn);
    imgWrap.appendChild(bar);
    galleryGrid.appendChild(imgWrap);
  }
}

/* --- Add mug glow styles --- */
const mugCss = document.createElement("style");
mugCss.textContent = `
  .mug-icon {
    filter: drop-shadow(0 0 2px rgba(0,0,0,.6));
    transition: transform .15s ease, filter .15s ease;
  }
  .mug-icon.active {
    transform: scale(1.1);
    filter: drop-shadow(0 0 6px #d4a94d);
  }
`;
document.head.appendChild(mugCss);

/* ------------------ Story Modal (for Stories tab) ------------------ */
let modalRoot: HTMLDivElement | null = null;
function ensureModal() {
  if (modalRoot) return modalRoot;
  modalRoot = document.createElement("div");
  modalRoot.id = "storyModal";
  Object.assign(modalRoot.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,.55)",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "9999",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "min(860px,92vw)",
    maxHeight: "82vh",
    overflow: "auto",
    background: "linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.15)),#151515d0",
    border: "1px solid #3b3325",
    borderRadius: "14px",
    padding: "16px 18px 18px",
    position: "relative",
    color: "var(--ink)",
    boxShadow: "0 14px 40px rgba(0,0,0,.6)",
  });

  const close = document.createElement("button");
  close.textContent = "×";
  Object.assign(close.style, {
    position: "absolute",
    top: "8px",
    right: "12px",
    border: "1px solid #3b3325",
    background: "rgba(0,0,0,.35)",
    color: "var(--ink)",
    fontSize: "20px",
    borderRadius: "10px",
    padding: "6px 10px",
    cursor: "pointer",
  });

  const title = document.createElement("h3");
  title.id = "storyModalTitle";
  title.style.margin = "0 0 6px 0";

  const meta = document.createElement("div");
  meta.id = "storyModalMeta";
  meta.style.fontSize = "12px";
  meta.style.color = "var(--muted)";
  meta.style.marginBottom = "10px";

  const img = document.createElement("img");
  img.id = "storyModalImage";
  Object.assign(img.style, {
    maxWidth: "100%",
    borderRadius: "10px",
    border: "1px solid var(--line)",
    margin: "8px 0 10px 0",
    display: "none",
  });

  const body = document.createElement("div");
  body.id = "storyModalBody";
  Object.assign(body.style, {
    whiteSpace: "pre-wrap",
    lineHeight: "1.5",
    color: "#e3decd",
  });

  card.append(close, title, meta, img, body);
  modalRoot.appendChild(card);
  document.body.appendChild(modalRoot);

  const hide = () => {
    modalRoot!.style.display = "none";
    document.body.style.overflow = "";
  };
  close.addEventListener("click", hide);
  modalRoot.addEventListener("click", (e) => { if (e.target === modalRoot) hide(); });
  document.addEventListener("keydown", (e) => { if (modalRoot!.style.display !== "none" && e.key === "Escape") hide(); });

  return modalRoot;
}

function openStoryModal(story: Story) {
  const root = ensureModal();
  const title = root.querySelector<HTMLHeadingElement>("#storyModalTitle")!;
  const meta = root.querySelector<HTMLDivElement>("#storyModalMeta")!;
  const body = root.querySelector<HTMLDivElement>("#storyModalBody")!;
  const img = root.querySelector<HTMLImageElement>("#storyModalImage")!;

  title.textContent = story.title || "(untitled)";
  meta.textContent = story.createdAt ? fmt(story.createdAt) : "";
  body.innerHTML = nl2br(story.text || story.excerpt || "—");

  if (story.imageUrl) {
    img.src = fullUrl(story.imageUrl);
    img.alt = story.title || "story image";
    img.style.display = "";
  } else {
    img.style.display = "none";
  }

  root.style.display = "flex";
  document.body.style.overflow = "hidden";
}

/* ------------------ Companions + Stories ------------------ */
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
      row.innerHTML = `
        <div class="comp-meta">
          <img src="${avatarSrc(u.avatarUrl)}" alt="">
          <div>
            <div class="comp-name">${esc(u.name || u.id)}</div>
            <div class="muted" style="font-size:12px">${esc(u.email || u.id)}</div>
          </div>
        </div>
        <div class="comp-actions">
          <a class="btn ghost" href="/friendprofile.html?user=${encodeURIComponent(u.id)}#gallery">View</a>
        </div>
      `;
      companionsEl.appendChild(row);
    }
  } catch {
    companionsEl.innerHTML = `<div class="muted">Companions unavailable.</div>`;
  }
}

function renderStories(stories: Story[]) {
  sagaList.innerHTML = "";
  if (!stories.length) {
    sagaList.appendChild(el("div", "saga", "No sagas told yet."));
    return;
  }
  stories.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const s of stories) {
    const wrap = el("article", "saga");
    const top = el("div", "top");
    const h3 = el("h3", "", s.title || "(untitled)");
    const when = el("time", "", fmt(s.createdAt));
    top.append(h3, when);
    wrap.append(top);

    const snippet = s.excerpt || (s.text ? s.text.slice(0, 200) + (s.text.length > 200 ? "…" : "") : "");
    if (snippet) wrap.append(el("div", "excerpt", snippet));

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

/* ------------------ MAIN ------------------ */
async function main() {
  const API = pickApiBase();
  const userId = qs("user");
  if (!userId || !API) return;

  try {
    const user = await loadUser(API, userId);
    avatarImg.src = avatarSrc(user.avatarUrl);
    nameH1.textContent = `Saga of ${user.name || "Wanderer"}`;
    emailSmall.textContent = user.email || "";
    if (user.createdAt) joinedRow.textContent = `Joined on ${new Date(user.createdAt).toLocaleDateString()}`;
    if (user.interests) interestsRow.textContent = `Interests: ${user.interests}`;
    if (user.bio) bioRow.textContent = user.bio;

    const stories = await loadStories(API, userId);
    renderStories(stories);

    const photos = await loadGallery(API, userId);
    renderGalleryFromPhotos(photos);

    const hash = (location.hash || "#stories").replace("#", "") as "stories" | "companions" | "gallery";
    showTab(hash);
    let companionsLoaded = false;
    const ensureCompanions = async () => {
      if (!companionsLoaded) {
        companionsLoaded = true;
        await loadCompanions(API, userId);
      }
    };
    if (hash === "companions") ensureCompanions();
    tabLinks.forEach((a) => {
      a.addEventListener("click", () => {
        if (a.dataset.tab === "companions") ensureCompanions();
      });
    });
  } catch (e: any) {
    sagaList.innerHTML = `<div class="saga">Error: ${esc(e?.message || "Failed to load profile")}</div>`;
  }
}

main();



















