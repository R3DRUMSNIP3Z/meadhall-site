// /src/meadhall.ts
import {
  getGlobalHistory,
  openGlobalStream,
  sendGlobalMessage,
  startGlobalPolling,
  API_BASE as BASE_FROM_HELPER,
} from "./chatGlobal";

// Resolve API base primarily from <meta>, else fall back to helper default.
function pickApiBase(): string {
  const meta = (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim() || "";
  return meta || BASE_FROM_HELPER;
}
const API_BASE = pickApiBase();

/* ---------------- Chat core ---------------- */
const LS_KEY_MAIN = "mh_user";
const LS_KEY_FALLBACK = "user";
const DEFAULT_AVATAR = "/logo/logo-512.png";
const GIPHY_KEY = "lRzzm6u7tXqFCuDcHfuZ56RyNDMiZKar"; // your key

type SafeUser = { id?: string | null; name?: string; avatarUrl?: string; email?: string };
type GlobalUser = { id: string | null; name: string; avatarUrl: string | null };
type GlobalMsg = { id: string; text: string; createdAt: number; user: GlobalUser };

function getUser(): SafeUser | null {
  try {
    const raw = localStorage.getItem(LS_KEY_MAIN) || localStorage.getItem(LS_KEY_FALLBACK) || "null";
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function setUser(u: SafeUser) {
  localStorage.setItem(LS_KEY_MAIN, JSON.stringify(u));
  localStorage.removeItem(LS_KEY_FALLBACK);
}
async function loadUserFresh(u: SafeUser | null) {
  if (!API_BASE || !u?.id) return u;
  try {
    const r = await fetch(`${API_BASE}/api/users/${u.id}`);
    if (!r.ok) throw new Error(await r.text());
    const fresh = (await r.json()) as SafeUser;
    setUser(fresh);
    return fresh;
  } catch {
    return u;
  }
}

let CURRENT_USER = getUser();
(async () => {
  if (CURRENT_USER?.id) CURRENT_USER = await loadUserFresh(CURRENT_USER);
})();

/* ---- DOM ---- */
const chatBox = document.getElementById("chatBox")!;
const input = document.getElementById("chatInput") as HTMLInputElement;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;

/* Safety: ensure hidden picker never blocks input clicks */
const pickerEl = document.getElementById("picker");
if (pickerEl) {
  pickerEl.style.display = "none";
  // If hidden, ignore pointer events entirely
  const obs = new MutationObserver(() => {
    if (pickerEl.style.display === "none") pickerEl.style.pointerEvents = "none";
    else pickerEl.style.pointerEvents = "auto";
  });
  obs.observe(pickerEl, { attributes: true, attributeFilter: ["style"] });
}

/* ---------------- DUPLICATE GUARD ---------------- */
const seen = new Set<string>();

// Render http(s) links + data:image URLs
function parseMessage(text: string) {
  return String(text).replace(
    /(?:https?:\/\/\S+|data:image\/(?:png|webp|gif);base64,[A-Za-z0-9+/=]+)/gi,
    (u) => {
      const isImage =
        /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(u) ||
        /giphy\.com/i.test(u) ||
        /^data:image\/(?:png|webp|gif);base64,/i.test(u);
      if (isImage) {
        return `<img src="${u}" style="max-width:220px;display:block;margin-top:6px;border-radius:8px;border:1px solid #3b3325;"/>`;
      }
      return `<a href="${u}" target="_blank" rel="noopener">${u}</a>`;
    }
  );
}

function renderMsg(msg: GlobalMsg) {
  if (msg?.id && seen.has(msg.id)) return;
  if (msg?.id) seen.add(msg.id);

  const u = msg.user || ({} as GlobalUser);
  const displayName = u.name || "skald";
  const avatarUrl = u.avatarUrl || DEFAULT_AVATAR;
  const profileLink = u.id ? `/profile/${u.id}` : "/account.html";

  const row = document.createElement("div");
  row.className = "msg";
  row.innerHTML = `
    <img class="avatar" src="${avatarUrl}" alt="${displayName}" onclick="window.location='${profileLink}'"/>
    <div class="bubble">
      <div class="meta">${displayName}</div>
      ${parseMessage(msg.text || "")}
    </div>
  `;
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function renderSystem(text: string) {
  const p = document.createElement("div");
  p.className = "sys";
  p.textContent = text;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
}

/* ---- history + live stream ---- */
let lastId = "";
(async () => {
  try {
    const list = await getGlobalHistory(lastId);
    for (const m of list) {
      renderMsg(m as GlobalMsg);
      if (m.id) lastId = m.id;
    }
  } catch {
    renderSystem("⚠️ Could not load history.");
  }

  if ("EventSource" in window) {
    openGlobalStream(
      (m) => {
        renderMsg(m as GlobalMsg);
        if ((m as GlobalMsg).id) lastId = (m as GlobalMsg).id;
      },
      () => renderSystem("Connected to the mead fire."),
      () => renderSystem("⚠️ Stream error — falling back if needed")
    );
  } else {
    const ref = { current: lastId };
    startGlobalPolling(ref, (batch) =>
      batch.forEach((m: GlobalMsg) => {
        renderMsg(m);
        ref.current = m.id || ref.current;
      })
    );
    renderSystem("⚠️ No EventSource — using polling.");
  }
})();

/* ---- send ---- */
sendBtn.onclick = async () => {
  const text = input.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  try {
    await sendGlobalMessage(CURRENT_USER?.id ?? null, text);
    input.value = "";
    // no local echo; SSE/poll brings it back (de-duped)
  } catch {
    renderSystem("⚠️ Message failed to send.");
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
};

/* ---------------- Picker ---------------- */
const picker = document.getElementById("picker")!;
const toggleBtn = document.getElementById("emojiGifBtn") as HTMLButtonElement;

const tabs = Array.from(picker.querySelectorAll(".picker-tab")) as HTMLButtonElement[];
const panes = Array.from(picker.querySelectorAll(".picker-body")) as HTMLElement[];
const searchInput = document.getElementById("pickerSearch") as HTMLInputElement;
const uploadStickerBtn = document.getElementById("uploadStickerBtn") as HTMLButtonElement;
const emojiPane = document.getElementById("emojiPane") as any;

const LS_RECENT_EMOJI = "mh_recent_emoji";
const LS_RECENT_GIFS = "mh_recent_gifs";
const LS_RECENT_STICK = "mh_recent_stickers";

const recentEmoji = document.getElementById("recentEmoji")!;
const recentGifs = document.getElementById("recentGifs")!;
const recentStickers = document.getElementById("recentStickers")!;

function loadLS<T = any>(k: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(k) || "[]");
  } catch {
    return [];
  }
}
function saveLS(k: string, a: any[], cap = 24) {
  localStorage.setItem(k, JSON.stringify(a.slice(0, cap)));
}
function addRecent(k: string, val: string) {
  const a = loadLS<string>(k);
  const i = a.indexOf(val);
  if (i !== -1) a.splice(i, 1);
  a.unshift(val);
  saveLS(k, a);
}
function twemojiCode(emoji: string) {
  return Array.from(emoji).map((ch) => ch.codePointAt(0)!.toString(16)).join("-");
}

function renderRecents(container: HTMLElement, items: string[], type: "gif" | "emoji" = "gif") {
  container.innerHTML = "";
  items.forEach((it) => {
    const img = document.createElement("img");
    img.src = type === "emoji" ? `https://twemoji.maxcdn.com/v/latest/svg/${twemojiCode(it)}.svg` : it;
    img.alt = type === "emoji" ? it : "recent";
    (img.style as any).height = "40px";
    img.onclick = () => {
      input.value += type === "emoji" ? it : " " + it;
      picker.style.display = "none";
      input.focus();
    };
    container.appendChild(img);
  });
}

tabs.forEach((btn) => {
  btn.onclick = () => {
    tabs.forEach((b) => b.classList.toggle("active", b === btn));
    const tab = btn.dataset.tab;
    panes.forEach((p) => (p.style.display = p.dataset.pane === tab ? "flex" : "none"));
    searchInput.value = "";
    if (tab === "gifs") loadGIFs("trending");
    if (tab === "stickers") loadStickers("trending");
  };
});

toggleBtn.onclick = () => {
  picker.style.display = picker.style.display === "none" ? "block" : "none";
  if (picker.style.display === "block") {
    renderRecents(recentEmoji, loadLS(LS_RECENT_EMOJI), "emoji");
    renderRecents(recentGifs, loadLS(LS_RECENT_GIFS), "gif");
    renderRecents(recentStickers, loadLS(LS_RECENT_STICK), "gif");
    loadGIFs("trending");
    loadStickers("trending");
  }
};
document.addEventListener(
  "click",
  (e) => {
    if (!picker.contains(e.target as Node) && e.target !== toggleBtn) picker.style.display = "none";
  },
  true
);

// Emoji picker behavior (custom element)
emojiPane?.addEventListener?.("emoji-click", (e: any) => {
  const ch = e.detail.unicode;
  input.value += ch;
  addRecent(LS_RECENT_EMOJI, ch);
  picker.style.display = "none";
  input.focus();
});

/* ---- custom emoji clicks (insert as image URL) ---- */
const customWrap = document.getElementById("customEmojis");
if (customWrap) {
  customWrap.querySelectorAll("img").forEach((img) => {
    img.addEventListener("click", () => {
      input.value += " " + (img as HTMLImageElement).src;
      addRecent(LS_RECENT_STICK, (img as HTMLImageElement).src);
      picker.style.display = "none";
      input.focus();
    });
  });
}

/* ---------------- GIPHY via REST (no SDK) ---------------- */
const gifCache = new Map<string, { at: number; urls: string[] }>();
const stickerCache = new Map<string, { at: number; urls: string[] }>();
function putCache(map: Map<string, any>, key: string, urls: string[]) {
  map.set(key, { at: Date.now(), urls });
}
function getCache(map: Map<string, any>, key: string, maxAge = 5 * 60 * 1000) {
  const hit = map.get(key);
  return hit && Date.now() - hit.at < maxAge ? (hit.urls as string[]) : null;
}

const GIF_GRID = document.getElementById("gifGrid")!;
const STICKER_GRID = document.getElementById("stickerGrid")!;
const GIF_CHIPS = document.getElementById("gifChips")!;
const STICKER_CHIPS = document.getElementById("stickerChips")!;
const GIF_ERR = document.getElementById("gifError")!;
const STICK_ERR = document.getElementById("stickerError")!;
const CATS = ["Trending", "Haha", "Sad", "Love", "Reaction", "Sports", "TV"];

function renderChips(container: HTMLElement, onPick: (c: string) => void) {
  container.innerHTML = "";
  CATS.forEach((c, i) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (i === 0 ? " active" : "");
    chip.textContent = c;
    chip.onclick = () => {
      Array.from(container.children).forEach((n) => n.classList.remove("active"));
      chip.classList.add("active");
      onPick(c.toLowerCase());
    };
    container.appendChild(chip);
  });
}
renderChips(GIF_CHIPS, (cat) => loadGIFs(cat));
renderChips(STICKER_CHIPS, (cat) => loadStickers(cat));

async function giphyFetch(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("giphy " + r.status);
  return r.json();
}

async function loadGIFs(topic = "trending") {
  GIF_GRID.innerHTML = "";
  (GIF_ERR as HTMLElement).style.display = "none";
  const q = searchInput.value.trim();
  const key = q ? `gif:q:${q}` : `gif:${topic}`;
  const cached = getCache(gifCache, key);
  if (cached) return renderGifList(cached);

  try {
    let url: string;
    if (q)
      url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(
        q
      )}&limit=18&rating=pg-13`;
    else if (topic === "trending")
      url = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=18&rating=pg-13`;
    else
      url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(
        topic
      )}&limit=18&rating=pg-13`;

    const js = await giphyFetch(url);
    const urls = (js.data || [])
      .map((it: any) => it.images?.downsized?.url || it.images?.original?.url)
      .filter(Boolean);
    if (!urls.length) throw 0;
    putCache(gifCache, key, urls);
    renderGifList(urls);
  } catch {
    (GIF_ERR as HTMLElement).textContent = "No GIFs found or network blocked.";
    (GIF_ERR as HTMLElement).style.display = "block";
  }
}
function renderGifList(urls: string[]) {
  GIF_GRID.innerHTML = "";
  urls.forEach((u) => addGifThumb(GIF_GRID, u));
}

async function loadStickers(topic = "trending") {
  STICKER_GRID.innerHTML = "";
  (STICK_ERR as HTMLElement).style.display = "none";
  const q = searchInput.value.trim();
  const key = q ? `sticker:q:${q}` : `sticker:${topic}`;
  const cached = getCache(stickerCache, key);
  if (cached) return renderStickerList(cached);

  try {
    let url: string;
    if (q)
      url = `https://api.giphy.com/v1/stickers/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(
        q
      )}&limit=18&rating=pg-13`;
    else if (topic === "trending")
      url = `https://api.giphy.com/v1/stickers/trending?api_key=${GIPHY_KEY}&limit=18&rating=pg-13`;
    else
      url = `https://api.giphy.com/v1/stickers/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(
        topic
      )}&limit=18&rating=pg-13`;

    const js = await giphyFetch(url);
    const urls = (js.data || [])
      .map((it: any) => it.images?.fixed_height?.url || it.images?.original?.url)
      .filter(Boolean);
    if (!urls.length) throw 0;
    putCache(stickerCache, key, urls);
    renderStickerList(urls);
  } catch {
    (STICK_ERR as HTMLElement).textContent = "No stickers found or network blocked.";
    (STICK_ERR as HTMLElement).style.display = "block";
  }
}
function renderStickerList(urls: string[]) {
  STICKER_GRID.innerHTML = "";
  urls.forEach((u) => addStickerThumb(STICKER_GRID, u));
}

function addGifThumb(container: HTMLElement, url: string) {
  const img = document.createElement("img");
  img.src = url;
  img.alt = "gif";
  (img.style as any).maxHeight = "90px";
  img.onclick = () => {
    input.value += " " + url;
    addRecent(LS_RECENT_GIFS, url);
    picker.style.display = "none";
    input.focus();
  };
  container.appendChild(img);
}
function addStickerThumb(container: HTMLElement, url: string) {
  const img = document.createElement("img");
  img.src = url;
  img.alt = "sticker";
  (img.style as any).maxHeight = "100px";
  img.onclick = () => {
    input.value += " " + url;
    addRecent(LS_RECENT_STICK, url);
    picker.style.display = "none";
    input.focus();
  };
  container.appendChild(img);
}

// Search trigger
searchInput.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key !== "Enter") return;
  const active = (document.querySelector(".picker-tab.active") as HTMLElement)?.dataset.tab;
  if (active === "gifs") loadGIFs("search");
  if (active === "stickers") loadStickers("search");
  if (active === "emoji") {
    const box = (emojiPane?.shadowRoot as ShadowRoot | undefined)?.querySelector('input[type="search"]') as
      | HTMLInputElement
      | undefined;
    if (box) {
      box.value = (e.target as HTMLInputElement).value;
      box.dispatchEvent(new Event("input"));
    }
  }
});

/* -------- Sticker editor (upload/drag-drop) -------- */
const stickerModal = document.getElementById("stickerModal")!;
const closeSticker = document.getElementById("closeSticker") as HTMLButtonElement;
const stickerFile = document.getElementById("stickerFile") as HTMLInputElement;
const stickerCanvas = document.getElementById("stickerCanvas") as HTMLCanvasElement;
const dropZone = document.getElementById("stickerDrop")!;
const sctx = stickerCanvas.getContext("2d")!;
const cropSquareBtn = document.getElementById("cropSquareBtn") as HTMLButtonElement;
const fit512Btn = document.getElementById("fit512Btn") as HTMLButtonElement;
const bgWhiteBtn = document.getElementById("bgWhiteBtn") as HTMLButtonElement;
const bgTransparentBtn = document.getElementById("bgTransparentBtn") as HTMLButtonElement;
const saveStickerBtn = document.getElementById("saveStickerBtn") as HTMLButtonElement;

let bmp: ImageBitmap | null = null;

function openEditor(autoPick = false) {
  stickerModal.style.display = "flex";
  sctx.clearRect(0, 0, stickerCanvas.width, stickerCanvas.height);
  if (autoPick) stickerFile.click();
}
function closeEditor() {
  stickerModal.style.display = "none";
  bmp = null;
  stickerFile.value = "";
}

// simple guidance + size helpers
function alertStickerRules() {
  alert(
    "Sticker tips:\n• Canvas is 512×512 px (auto).\n• Upload PNG/JPG/WebP/GIF.\n• Recommended output ≤ 500 KB.\nUse Square/Resize if needed."
  );
}
function tooLargeBytes(bytes: number) {
  return bytes > 500 * 1024;
}
function dataUrlBytes(dataUrl: string) {
  try {
    return atob(dataUrl.split(",")[1]).length;
  } catch {
    return Infinity;
  }
}

uploadStickerBtn.onclick = () => {
  tabs.forEach((t) => t.classList.remove("active"));
  (document.querySelector('[data-tab="stickers"]') as HTMLElement).classList.add("active");
  panes.forEach((p) => (p.style.display = p.dataset.pane === "stickers" ? "flex" : "none"));
  alertStickerRules();
  openEditor(true);
};
closeSticker.onclick = closeEditor;

stickerFile.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return alert("Choose an image file (png/jpg/webp/gif).");
  if (file.size > 5 * 1024 * 1024) return alert("Image is > 5 MB. Pick a smaller image.");

  try {
    bmp = await loadBitmap(file);
    if (bmp.width < 64 || bmp.height < 64) alert("This image is very small (<64px). It may look blurry as a sticker.");
    drawFit(bmp);
  } catch {}
});
dropZone.addEventListener("dragover", (e) => e.preventDefault());
dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  const f = (e.dataTransfer?.files || [])[0];
  if (!f) return;
  if (!f.type.startsWith("image/")) return alert("Drop an image file (png/jpg/webp/gif).");
  if (f.size > 5 * 1024 * 1024) return alert("Image is > 5 MB. Pick a smaller image.");
  bmp = await loadBitmap(f);
  if (bmp.width < 64 || bmp.height < 64) alert("This image is very small (<64px). It may look blurry as a sticker.");
  drawFit(bmp);
});

async function loadBitmap(fileOrUrl: File | string) {
  const src = fileOrUrl instanceof File ? URL.createObjectURL(fileOrUrl) : String(fileOrUrl);
  const img = new Image();
  (img as any).crossOrigin = "anonymous";
  img.src = src;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("image load failed"));
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return await createImageBitmap(c);
}

function drawFit(bitmap: ImageBitmap, bg: "transparent" | "white" = "transparent") {
  const W = 512,
    H = 512;
  sctx.clearRect(0, 0, W, H);
  if (bg === "white") {
    sctx.fillStyle = "#fff";
    sctx.fillRect(0, 0, W, H);
  }
  const r = Math.min(W / bitmap.width, H / bitmap.height);
  const w = Math.round(bitmap.width * r),
    h = Math.round(bitmap.height * r);
  const x = Math.floor((W - w) / 2),
    y = Math.floor((H - h) / 2);
  sctx.drawImage(bitmap, x, y, w, h);
}
cropSquareBtn.onclick = async () => {
  if (!bmp) return;
  const s = Math.min(bmp.width, bmp.height),
    sx = Math.floor((bmp.width - s) / 2),
    sy = Math.floor((bmp.height - s) / 2);
  const off = document.createElement("canvas");
  off.width = s;
  off.height = s;
  off.getContext("2d")!.drawImage(bmp, sx, sy, s, s, 0, 0, s, s);
  bmp = await createImageBitmap(off);
  drawFit(bmp);
};
fit512Btn.onclick = () => {
  if (bmp) drawFit(bmp);
};
bgWhiteBtn.onclick = () => {
  if (bmp) drawFit(bmp, "white");
};
bgTransparentBtn.onclick = () => {
  if (bmp) drawFit(bmp, "transparent");
};

saveStickerBtn.onclick = () => {
  if (!bmp) return alert("Load an image first.");
  const dataUrl = stickerCanvas.toDataURL("image/png");
  const bytes = dataUrlBytes(dataUrl);
  if (tooLargeBytes(bytes)) {
    const kb = Math.round(bytes / 102.4) / 10;
    if (!confirm(`Sticker is about ${kb} KB. Save anyway?`)) return;
  }
  addRecent(LS_RECENT_STICK, dataUrl);
  input.value += " " + dataUrl;
  picker.style.display = "none";
  closeEditor();
  input.focus();
};
