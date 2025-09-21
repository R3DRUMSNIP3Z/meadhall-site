/**
 * Mead Hall — Guild Book Reader (TypeScript)
 * - Loads story text (RTF or TXT)
 * - Front-matter: [cover:], [title:], [subtitle:], [credit:]
 * - In-body images: [image:/path] -> <img src="{ASSET_BASE}/path">
 * - Manual page breaks: [PAGEBREAK] or |PAGEBREAK|
 * - Simple pagination
 */

/* ============= Meta-driven configuration ============= */

const API_BASE =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content?.trim() || location.origin;

const ASSET_BASE =
  (document.querySelector('meta[name="asset-base"]') as HTMLMetaElement)?.content?.trim() || "";

/** join like URL.resolve but dead-simple and safe for trailing/leading slashes */
function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

/* ============= DOM ============= */

const el = {
  title:  document.getElementById("bookTitle")!,
  page:   document.getElementById("page")!,
  prev:   document.getElementById("prevBtn") as HTMLButtonElement,
  next:   document.getElementById("nextBtn") as HTMLButtonElement,
  num:    document.getElementById("pageNum")!,
  count:  document.getElementById("pageCount")!,
};

/* ============= Pagination ============= */

const CHARS_PER_PAGE = 1450;
let pages: string[] = [];
let idx = 0;

/* ============= Boot ============= */

init().catch(err => {
  console.error(err);
  el.page.innerHTML = `<p style="color:#b91c1c">Failed to load book: ${escapeHtml(String(err?.message || err))}</p>`;
});

async function init() {
  const src = resolveStoryUrl();
  console.log("[Book] apiBase:", API_BASE, "assetBase:", ASSET_BASE || "(none)", "src:", src);

  // Fetch with fallback (A||B)
  let raw = "";
  if (src.includes("||")) {
    const [u1, u2] = src.split("||");
    try { raw = await fetchText(u1); } catch { raw = await fetchText(u2); }
  } else {
    raw = await fetchText(src);
  }

  // RTF -> text
  const isRtf = /^\s*{\\rtf/i.test(raw);
  let plain = isRtf ? rtfToText(raw) : raw;

  // Front-matter
  const fm = extractFrontMatter(plain);
  plain = fm.body;

  // Build HTML: paragraphs + images + pagebreaks
  const html = convertTokensToHtml(plain);

  // Paginate
  pages = paginate(html, CHARS_PER_PAGE);
  if (!pages.length) pages = ["(No content)"];

  // Optional cover page first
  if (fm.coverHtml) pages.unshift(fm.coverHtml);

  // Title
  el.title.textContent = fm.title || deriveTitleFromUrl(src);

  // Render & wire nav
  el.count.textContent = String(pages.length);
  render();

  el.prev.addEventListener("click", prev);
  el.next.addEventListener("click", next);
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  });
  updateButtons();
}

/* ============= URL resolution ============= */

/**
 * Priority:
 *  1) <meta name="book-src" content="...">
 *     - absolute http(s): use as-is
 *     - relative: join with API_BASE (your backend)
 *  2) ?book=name  -> try `${API_BASE}/uploads/${name}.rtf` then `.txt`
 */
function resolveStoryUrl(): string {
  const meta = (document.querySelector('meta[name="book-src"]') as HTMLMetaElement)?.content?.trim();
  if (meta) {
    return /^https?:\/\//i.test(meta) ? meta : joinUrl(API_BASE, meta);
  }

  const qs = new URLSearchParams(location.search);
  const book = (qs.get("book") || "").trim();
  if (!book) throw new Error("No book specified. Use <meta name=\"book-src\"> or ?book=name");

  const tryRtf = joinUrl(API_BASE, `uploads/${book}.rtf`);
  const tryTxt = joinUrl(API_BASE, `uploads/${book}.txt`);
  return `${tryRtf}||${tryTxt}`;
}

/* ============= Navigation/render ============= */

function prev() {
  if (idx <= 0) return;
  idx--;
  flipRender();
}
function next() {
  if (idx >= pages.length - 1) return;
  idx++;
  flipRender();
}
function render() {
  el.page.innerHTML = pages[idx];
  el.num.textContent = String(idx + 1);
  updateButtons();
}
function flipRender() {
  el.page.classList.remove("turning"); void el.page.offsetWidth;
  el.page.classList.add("turning");
  render();
}
function updateButtons() {
  el.prev.toggleAttribute("disabled", idx === 0);
  el.next.toggleAttribute("disabled", idx === pages.length - 1);
}

/* ============= Helpers ============= */

function deriveTitleFromUrl(u: string): string {
  const path = u.split("?")[0];
  const base = path.split("/").pop() || "Guild Book";
  return base.replace(/\.(rtf|txt)$/i, "").replace(/[_-]+/g, " ").toUpperCase();
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    let body = "";
    try { body = await r.text(); } catch {}
    throw new Error(`HTTP ${r.status} - ${body || "Failed to fetch"}`);
  }
  return await r.text();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]!));
}

/**
 * Convert tokens to HTML:
 *  - [image:/path]  -> <img src="{ASSET_BASE}/path">
 *  - [PAGEBREAK] or |PAGEBREAK| -> <pagebreak/>
 *  - paragraphs from double newlines
 */
function convertTokensToHtml(txt: string): string {
    // helper must match the one used for the cover
  const joinUrl = (base: string, p: string) => {
    const b = base.replace(/\/+$/, "");
    const s = p.replace(/^\/+/, "");
    return `${b}/${s}`;
  };
  const resolveAsset = (p: string) => {
    const raw = String(p || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    const assetBase =
      (document.querySelector('meta[name="asset-base"]') as HTMLMetaElement)?.content?.trim() || "";
    const stripped = raw.replace(/^\/?uploads\/+/i, ""); // drop "uploads/" if present
    const base = assetBase || API_BASE;
    return joinUrl(base, stripped);
  };

  const withImgs = txt.replace(/\[image:([^\]]+)\]/gi, (_m, p1) => {
    const full = resolveAsset(p1);
    return `\n\n<figure><img src="${full}" alt="illustration"/></figure>\n\n`;
  });


  const withBreaks = withImgs
    .replace(/\[pagebreak\]/gi, "\n\n<pagebreak/>\n\n")
    .replace(/\|pagebreak\|/gi, "\n\n<pagebreak/>\n\n");

  return withBreaks
    .split(/\n{2,}/)
    .map(b0 => {
      const b = b0.trim();
      if (!b) return "";
      if (b.toLowerCase() === "<pagebreak/>") return b;
      if (/^<figure>/i.test(b)) return b;
      return `<p>${escapeHtml(b)}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

/** pagination that respects <pagebreak/>; images get smaller budget */
function paginate(html: string, charsPerPage: number): string[] {
  const blocks = html.split(/(?=<figure>|<p>|<pagebreak\/>)/i);
  const out: string[] = [];
  let buf: string[] = [];
  let count = 0;

  for (const raw of blocks) {
    const b = (raw || "").trim();
    if (!b) continue;

    if (b.toLowerCase() === "<pagebreak/>") {
      if (buf.length) out.push(buf.join("\n"));
      buf = [];
      count = 0;
      continue;
    }

    const isImage = /^<figure>/i.test(b);
    const textLen = b.replace(/<[^>]+>/g, "").length;
    const limit = isImage ? Math.floor(charsPerPage * 0.6) : charsPerPage;

    if (count + textLen > limit && buf.length) {
      out.push(buf.join("\n"));
      buf = [b];
      count = textLen;
    } else {
      buf.push(b);
      count += textLen;
    }
  }
  if (buf.length) out.push(buf.join("\n"));
  return out;
}

/* ============= Front-matter ============= */

type FrontMatter = {
  coverHtml?: string;
  title?: string;
  subtitle?: string;
  credit?: string;
  body: string;
};

function extractFrontMatter(src: string): FrontMatter {
  const lines = src.split(/\r?\n/);
  let title = "";
  let subtitle = "";
  let credit = "";
  let cover = "";

  const out: string[] = [];

  const coverRe = /^\s*(?:\[cover\s*:\s*([^\]]+)\]|\|cover\s*=\s*([^|]+)\|)\s*$/i;
  const titleRe = /^\s*(?:\[title\s*:\s*([^\]]+)\]|\|title\s*=\s*([^|]+)\|)\s*$/i;
  const subRe   = /^\s*(?:\[subtitle\s*:\s*([^\]]+)\]|\|subtitle\s*=\s*([^|]+)\|)\s*$/i;
  const credRe  = /^\s*(?:\[credit\s*:\s*([^\]]+)\]|\|credit\s*=\s*([^|]+)\|)\s*$/i;

  for (const ln of lines) {
    let m: RegExpMatchArray | null;
    if ((m = ln.match(coverRe))) { cover = (m[1] || m[2] || "").trim(); continue; }
    if ((m = ln.match(titleRe))) { title = (m[1] || m[2] || "").trim(); continue; }
    if ((m = ln.match(subRe)))   { subtitle = (m[1] || m[2] || "").trim(); continue; }
    if ((m = ln.match(credRe)))  { credit = (m[1] || m[2] || "").trim(); continue; }
    out.push(ln);
  }

      let coverHtml: string | undefined;

  // Join base + path with one slash
  const joinUrl = (base: string, p: string) => {
    const b = base.replace(/\/+$/, "");
    const s = p.replace(/^\/+/, "");
    return `${b}/${s}`;
  };

  // Resolve images with preference for asset-base (Vercel), fallback to API_BASE.
  // Also strip a leading "uploads/" segment if present in the path.
  const resolveAsset = (p: string) => {
    const raw = String(p || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;

    const assetBase =
      (document.querySelector('meta[name="asset-base"]') as HTMLMetaElement)?.content?.trim() || "";

    // If the file path starts with "uploads/...", drop that segment so it works with Vercel public/
    const stripped = raw.replace(/^\/?uploads\/+/i, "");
    const base = assetBase || API_BASE;
    return joinUrl(base, stripped);
  };

  if (cover || title || subtitle || credit) {
    const full = resolveAsset(cover);
    coverHtml = `
      <section class="cover" style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
        ${full ? `<img src="${full}" alt="Cover" style="max-width:70%;height:auto;border:1px solid rgba(200,169,107,.45);border-radius:14px;margin:10px auto 18px;display:block"/>` : ""}
        ${title ? `<h2 style="font-family:'Cinzel',serif;font-size:38px;margin:.2em 0 .2em">${escapeHtml(title)}</h2>` : ""}
        ${subtitle ? `<div style="opacity:.85;margin:.2em 0 .5em">${escapeHtml(subtitle)}</div>` : ""}
        ${credit ? `<div style="opacity:.75;font-size:14px">${escapeHtml(credit)}</div>` : ""}
      </section>
    `;
  }



  return { coverHtml, title, subtitle, credit, body: out.join("\n").trim() };
}

/* ============= RTF → text ============= */

function rtfToText(rtf: string): string {
  let s = rtf.replace(/\r\n?/g, "\n");

  const dropGroups = [
    "fonttbl","colortbl","stylesheet","info","generator",
    "themedata","rsidtbl","listtable","listoverridetable",
    "latentstyles","filetbl"
  ];
  for (const name of dropGroups) s = removeRtfGroup(s, name);
  s = removeStarDestinations(s);
  for (let i = 0; i < 4; i++) s = s.replace(/\{\\f\d+[^{}]*\}/g, "");

  // \uNNNN? (consume fallback)
  s = s.replace(/\\u(-?\d+)\??(.)?/g, (_m, n: string) => {
    let code = parseInt(n, 10);
    if (code < 0) code = 65536 + code;
    return String.fromCharCode(code);
  });

  // \'hh (cp1252 bytes)
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hh: string) =>
    cp1252ByteToChar(parseInt(hh, 16))
  );

  s = s
    .replace(/\\par(d)?\b/g, "\n")
    .replace(/\\line\b/g, "\n")
    .replace(/\\tab\b/g, "  ");

  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\n{3,}/g, "\n\n").trim();

  return s;
}

function removeRtfGroup(src: string, name: string): string {
  const needle = "{\\" + name;
  let out = src;
  for (;;) {
    const start = out.indexOf(needle);
    if (start === -1) break;
    const end = findGroupEnd(out, start);
    if (end === -1) break;
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}
function removeStarDestinations(src: string): string {
  let out = src;
  for (;;) {
    const start = out.indexOf("{\\*");
    if (start === -1) break;
    const end = findGroupEnd(out, start);
    if (end === -1) break;
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}
function findGroupEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i + 1; }
    else if (ch === "\\") i++; // skip control char param
  }
  return -1;
}
function cp1252ByteToChar(b: number): string {
  if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
  const map: Record<number,string> = {
    0x80:"€",0x82:"‚",0x83:"ƒ",0x84:"„",0x85:"…",0x86:"†",0x87:"‡",
    0x88:"ˆ",0x89:"‰",0x8a:"Š",0x8b:"‹",0x8c:"Œ",0x8e:"Ž",
    0x91:"‘",0x92:"’",0x93:"“",0x94:"”",0x95:"•",0x96:"–",0x97:"—",
    0x98:"˜",0x99:"™",0x9a:"š",0x9b:"›",0x9c:"œ",0x9e:"ž",0x9f:"Ÿ",
    0xa0:"\u00A0"
  };
  if (map[b]) return map[b];
  if (b >= 0xa1 && b <= 0xff) return String.fromCharCode(b);
  return "";
}









