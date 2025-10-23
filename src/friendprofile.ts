// /src/friendprofile.ts — LIGHTBOX + MUG REACTIONS + COMMENTS (clean build + visible comments + hover tooltips)

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

function n(v: any): number { return Math.max(0, parseInt(String(v), 10) || 0); }
function pluralize(cnt: number, one: string, many?: string) { return `${cnt} ${cnt === 1 ? one : (many || one + 's')}`; }

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

/* === UPDATED: simple auth header helper for reactions/comments */
function authHeaders(): HeadersInit {
  const LS_USER = "mh_user";
  let u: any = null;
  try { u = JSON.parse(localStorage.getItem(LS_USER) || "null"); } catch {}
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (u?.id) h["x-user-id"] = String(u.id);
  return h;
}

/* === UPDATED: assumed endpoints for per-photo reactions and comments
   If your backend paths differ, change these four functions only. */
async function getReactions(API: string, ownerId: string, photoId: string) {
  const url = `${API}/api/users/${encodeURIComponent(ownerId)}/gallery/${encodeURIComponent(photoId)}/reactions`;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) return { up: 0, down: 0, action: "" as "" | "up" | "down" };
  return r.json() as Promise<{ up: number; down: number; action: "" | "up" | "down" }>;
}
async function sendReaction(API: string, ownerId: string, photoId: string, action: "up" | "down" | "clear") {
  const url = `${API}/api/users/${encodeURIComponent(ownerId)}/gallery/${encodeURIComponent(photoId)}/reactions`;
  const r = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify({ action }), credentials: "include" });
  if (!r.ok) throw new Error("reaction failed");
  return r.json() as Promise<{ up: number; down: number; action: "" | "up" | "down" }>;
}
async function getComments(API: string, ownerId: string, photoId: string) {
  const url = `${API}/api/users/${encodeURIComponent(ownerId)}/gallery/${encodeURIComponent(photoId)}/comments`;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) return [] as Array<{ id: string; text: string; createdAt: number | string; user?: { id: string; name: string; avatarUrl?: string } }>;
  return r.json();
}
async function postComment(API: string, ownerId: string, photoId: string, text: string) {
  const url = `${API}/api/users/${encodeURIComponent(ownerId)}/gallery/${encodeURIComponent(photoId)}/comments`;
  const r = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify({ text }), credentials: "include" });
  if (!r.ok) throw new Error("comment failed");
  return r.json() as Promise<{ ok: true; id: string; createdAt: number | string }>;
}

/* === UPDATED: Inject tiny CSS for lightbox sidebar/comments and grid bar counts */
(function injectLocalCss(){
  const css = `
  .pf-grid .bar {position:absolute;bottom:6px;right:6px;display:flex;gap:8px;background:rgba(0,0,0,.45);border-radius:8px;padding:4px 6px;backdrop-filter:blur(2px);align-items:center}
  .pf-grid .act {display:inline-flex;align-items:center;gap:6px;border:none;background:none;color:#e9e4d5;cursor:pointer}
  .pf-grid .cnt {font-weight:700;min-width:1.2ch}
  .lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;opacity:0;transition:opacity .18s ease;z-index:9999}
  .lb-wrap{display:grid;grid-template-columns:minmax(260px,1fr) 380px;width:min(1100px,96vw);height:min(88vh,980px);background:#0b0f12;border:1px solid #3b3325;border-radius:14px;overflow:hidden}
  .lb-stage{position:relative;display:flex;align-items:center;justify-content:center;background:#000}
  .lb-stage img{max-width:100%;max-height:100%;object-fit:contain}
  .lb-side{display:flex;flex-direction:column;background:#0e0e0e}
  .lb-head{display:flex;align-items:center;justify-content:space-between;padding:.55rem .75rem;border-bottom:1px solid #3b3325}
  .lb-reacts{display:flex;align-items:center;gap:8px}
  .lb-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid #3b3325;background:#111;color:#e9e4d5;border-radius:10px;padding:.35rem .55rem;cursor:pointer}
  .lb-btn[aria-pressed="true"]{outline:2px solid #d4a94d}
  .lb-thread{flex:1;overflow:auto;padding:.6rem .75rem;display:flex;flex-direction:column;gap:10px}
  .lb-c{border:1px solid #3b3325;border-radius:10px;padding:.45rem .55rem;background:#0b0b0b}
  .lb-c small{opacity:.7}
  .lb-form{display:flex;gap:6px;padding:.6rem .75rem;border-top:1px solid #3b3325}
  .lb-inp{flex:1;border-radius:10px;border:1px solid #3b3325;background:#0e0e0e;color:#e9e4d5;padding:.5rem}
  .lb-send{border-radius:10px;border:1px solid #3b3325;background:#111;color:#e9e4d5;padding:.5rem .7rem;cursor:pointer}
  `;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
})();

/* ------------------ Lightbox (with comments) ------------------ */
const LB = {
  root: null as HTMLDivElement | null,
  img: null as HTMLImageElement | null,
  likeBtn: null as HTMLButtonElement | null,
  disBtn: null as HTMLButtonElement | null,
  likeCnt: null as HTMLElement | null,
  disCnt: null as HTMLElement | null,
  closeBtn: null as HTMLButtonElement | null,
  thread: null as HTMLDivElement | null,
  form: null as HTMLFormElement | null,
  input: null as HTMLInputElement | null,
  counter: null as HTMLSpanElement | null,
  urls: [] as string[],
  ids: [] as string[], // photo ids in same order as urls
  index: 0,
  ensureDom() {
    if (this.root) return;
    const wrap = document.createElement("div");
    wrap.className = "lightbox";
    wrap.innerHTML = `
      <div class="lb-wrap" role="dialog" aria-modal="true">
        <div class="lb-stage">
          <img alt="Photo" />
        </div>
        <div class="lb-side">
          <div class="lb-head">
            <div class="lb-reacts">
              <button class="lb-btn" id="lbLike" aria-pressed="false" title="0 Likes">👍 <span class="cnt" id="lbLikeCnt">0</span></button>
              <button class="lb-btn" id="lbDis"  aria-pressed="false" title="0 Dislikes">👎 <span class="cnt" id="lbDisCnt">0</span></button>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span id="lbCounter">1 / 1</span>
              <button class="lb-btn" id="lbClose" title="Close">✕</button>
            </div>
          </div>
          <div class="lb-thread" id="lbThread"></div>
          <form class="lb-form" id="lbForm">
            <input class="lb-inp" id="lbInput" placeholder="Write a comment…" autocomplete="off" required />
            <button class="lb-send" id="lbSend" type="submit">Post</button>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    this.root = wrap;
    this.img = wrap.querySelector("img")!;
    this.likeBtn = wrap.querySelector("#lbLike") as HTMLButtonElement;
    this.disBtn = wrap.querySelector("#lbDis") as HTMLButtonElement;
    this.likeCnt = wrap.querySelector("#lbLikeCnt") as HTMLElement;
    this.disCnt = wrap.querySelector("#lbDisCnt") as HTMLElement;
    this.closeBtn = wrap.querySelector("#lbClose") as HTMLButtonElement;
    this.thread = wrap.querySelector("#lbThread") as HTMLDivElement;
    this.form = wrap.querySelector("#lbForm") as HTMLFormElement;
    this.input = wrap.querySelector("#lbInput") as HTMLInputElement;
    this.counter = wrap.querySelector("#lbCounter") as HTMLSpanElement;

    this.closeBtn.addEventListener("click", () => this.close());
    wrap.addEventListener("click", (e) => { if (e.target === wrap) this.close(); });
    window.addEventListener("keydown", (e) => {
      if (wrap.style.display !== "block") return;
      if (e.key === "Escape") this.close();
      if (e.key === "ArrowRight") this.next();
      if (e.key === "ArrowLeft") this.prev();
    });
  },
  setPressed(which: "" | "up" | "down") {
    this.likeBtn!.setAttribute("aria-pressed", which === "up" ? "true" : "false");
    this.disBtn!.setAttribute("aria-pressed", which === "down" ? "true" : "false");
  },
  async open(i = 0) {
    this.ensureDom();
    if (!this.root || !this.img || !this.urls.length) return;
    this.index = (i + this.urls.length) % this.urls.length;
    this.img.src = this.urls[this.index];
    this.counter!.textContent = `${this.index + 1} / ${this.urls.length}`;
    this.root.style.display = "block";
    requestAnimationFrame(() => (this.root!.style.opacity = "1"));
    document.body.style.overflow = "hidden";

    // load reactions + comments for this photo
    try {
      const API = pickApiBase();
      const ownerId = qs("user")!;
      const photoId = this.ids[this.index];
      const r = await getReactions(API, ownerId, photoId);
      this.likeCnt!.textContent = String(n(r.up));
      this.disCnt!.textContent = String(n(r.down));
      this.likeBtn!.title = pluralize(n(r.up), "Like");
      this.disBtn!.title = pluralize(n(r.down), "Dislike");
      this.setPressed(r.action || "");
      await renderComments(API, ownerId, photoId, this.thread!);
    } catch { /* ignore */ }
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

async function renderComments(API: string, ownerId: string, photoId: string, mount: HTMLDivElement) {
  mount.innerHTML = "";
  try {
    const list = await getComments(API, ownerId, photoId);
    if (!list.length) {
      mount.append(el("div", "lb-c", "No comments yet. Be the first!"));
      return;
    }
    for (const c of list) {
      const who = c.user?.name || "skald";
      const when = new Date(Number(c.createdAt || Date.now())).toLocaleString();
      const box = document.createElement("div");
      box.className = "lb-c";
      box.innerHTML = `<div><strong>${esc(who)}</strong> <small>• ${esc(when)}</small></div><div>${nl2br(c.text)}</div>`;
      mount.append(box);
    }
  } catch {
    mount.append(el("div", "lb-c", "Could not load comments."));
  }
}

/* ------------------ Gallery Loader ------------------ */
async function loadGallery(API: string, userId: string): Promise<Photo[]> {
  const r = await fetch(`${API}/api/users/${encodeURIComponent(userId)}/gallery`);
  if (!r.ok) return [];
  const data = await r.json();
  return normalizePhotoArray(data);
}

/* ------------------ Gallery Renderer (with hover tooltips & counts) ------------------ */
function renderGalleryFromPhotos(photos: Photo[]) {
  galleryGrid.innerHTML = "";
  if (!photos.length) {
    galleryGrid.innerHTML = `<div class="muted">No images yet.</div>`;
    LB.urls = [];
    LB.ids = [];
    return;
  }

  LB.urls = photos.map((p) => cacheBust(fullUrl(p.url)));
  LB.ids = photos.map((p) => p.id);

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
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
    img.draggable = false;
    Object.assign(img.style, {
      width: "100%",
      aspectRatio: "1/1",
      objectFit: "cover",
      cursor: "zoom-in",
      display: "block",
    });
    img.addEventListener("click", () => LB.open(i));
    imgWrap.appendChild(img);

    // === UPDATED: Reaction bar with counts + hover titles
    const bar = document.createElement("div");
    bar.className = "bar";

    const likeBtn = document.createElement("button");
    likeBtn.className = "act";
    likeBtn.innerHTML = `👍 <span class="cnt">0</span>`;
    likeBtn.title = "0 Likes";

    const disBtn = document.createElement("button");
    disBtn.className = "act";
    disBtn.innerHTML = `👎 <span class="cnt">0</span>`;
    disBtn.title = "0 Dislikes";

    const cmtBtn = document.createElement("button");
    cmtBtn.className = "act";
    cmtBtn.textContent = "💬";
    cmtBtn.title = "Open comments";

    const likeCntEl = likeBtn.querySelector(".cnt") as HTMLElement;
    const disCntEl = disBtn.querySelector(".cnt") as HTMLElement;

    // Prefetch counts/action (non-blocking)
    (async () => {
      try {
        const API = pickApiBase();
        const ownerId = qs("user")!;
        const r = await getReactions(API, ownerId, p.id);
        likeCntEl.textContent = String(n(r.up));
        disCntEl.textContent = String(n(r.down));
        likeBtn.setAttribute("aria-pressed", r.action === "up" ? "true" : "false");
        disBtn.setAttribute("aria-pressed", r.action === "down" ? "true" : "false");
        likeBtn.title = pluralize(n(r.up), "Like");
        disBtn.title = pluralize(n(r.down), "Dislike");
      } catch {}
    })();

    // Hover updates tooltips
    bar.addEventListener("mouseenter", () => {
      likeBtn.title = pluralize(n(likeCntEl.textContent), "Like");
      disBtn.title = pluralize(n(disCntEl.textContent), "Dislike");
    });

    // Click handlers
    likeBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const API = pickApiBase();
      const ownerId = qs("user")!;
      const pressed = likeBtn.getAttribute("aria-pressed") === "true";
      try {
        const r = await sendReaction(API, ownerId, p.id, pressed ? "clear" : "up");
        likeCntEl.textContent = String(n(r.up));
        disCntEl.textContent = String(n(r.down));
        likeBtn.setAttribute("aria-pressed", pressed ? "false" : "true");
        disBtn.setAttribute("aria-pressed", "false");
        likeBtn.title = pluralize(n(r.up), "Like");
        disBtn.title = pluralize(n(r.down), "Dislike");
      } catch {}
    });

    disBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const API = pickApiBase();
      const ownerId = qs("user")!;
      const pressed = disBtn.getAttribute("aria-pressed") === "true";
      try {
        const r = await sendReaction(API, ownerId, p.id, pressed ? "clear" : "down");
        const upNow = n(r.up), dnNow = n(r.down);
        likeCntEl.textContent = String(upNow);
        disCntEl.textContent = String(dnNow);
        disBtn.setAttribute("aria-pressed", pressed ? "false" : "true");
        likeBtn.setAttribute("aria-pressed", "false");
        likeBtn.title = pluralize(upNow, "Like");
        disBtn.title = pluralize(dnNow, "Dislike");
      } catch {}
    });

    cmtBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); LB.open(i); });

    bar.append(likeBtn, disBtn, cmtBtn);
    imgWrap.appendChild(bar);
    galleryGrid.appendChild(imgWrap);
  }
}

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

    // wire up lightbox reaction + comment form handlers (once DOM exists)
    LB.ensureDom();
    LB.likeBtn!.addEventListener("mouseenter", () => {
      LB.likeBtn!.title = pluralize(n(LB.likeCnt!.textContent), "Like");
    });
    LB.disBtn!.addEventListener("mouseenter", () => {
      LB.disBtn!.title = pluralize(n(LB.disCnt!.textContent), "Dislike");
    });
    LB.likeBtn!.addEventListener("click", async (e) => {
      e.preventDefault();
      const APIb = pickApiBase();
      const ownerId = qs("user")!;
      const photoId = LB.ids[LB.index];
      const pressed = LB.likeBtn!.getAttribute("aria-pressed") === "true";
      try {
        const r = await sendReaction(APIb, ownerId, photoId, pressed ? "clear" : "up");
        LB.likeCnt!.textContent = String(n(r.up));
        LB.disCnt!.textContent  = String(n(r.down));
        LB.setPressed(pressed ? "" : "up");
        LB.likeBtn!.title = pluralize(n(r.up), "Like");
        LB.disBtn!.title  = pluralize(n(r.down), "Dislike");
      } catch {}
    });
    LB.disBtn!.addEventListener("click", async (e) => {
      e.preventDefault();
      const APIb = pickApiBase();
      const ownerId = qs("user")!;
      const photoId = LB.ids[LB.index];
      const pressed = LB.disBtn!.getAttribute("aria-pressed") === "true";
      try {
        const r = await sendReaction(APIb, ownerId, photoId, pressed ? "clear" : "down");
        LB.likeCnt!.textContent = String(n(r.up));
        LB.disCnt!.textContent  = String(n(r.down));
        LB.setPressed(pressed ? "" : "down");
        LB.likeBtn!.title = pluralize(n(r.up), "Like");
        LB.disBtn!.title  = pluralize(n(r.down), "Dislike");
      } catch {}
    });
    LB.form!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const APIb = pickApiBase();
      const ownerId = qs("user")!;
      const photoId = LB.ids[LB.index];
      const txt = LB.input!.value.trim();
      if (!txt) return;
      try {
        await postComment(APIb, ownerId, photoId, txt);
        LB.input!.value = "";
        await renderComments(APIb, ownerId, photoId, LB.thread!);
      } catch {}
    });

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




















