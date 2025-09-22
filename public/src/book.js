/* Simple book reader with RTF→Unicode, cover/front-matter, images & page breaks */

/* -------- Config from <meta> tags -------- */
const API_BASE =
  (document.querySelector('meta[name="api-base"]')?.getAttribute('content') || '').trim() ||
  location.origin;

const ASSET_BASE =
  (document.querySelector('meta[name="asset-base"]')?.getAttribute('content') || '').trim() ||
  "/guildbook/";

function assetUrl(p) {
  const s = String(p || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${location.origin}${s}`;
  const base = ASSET_BASE.startsWith("http")
    ? ASSET_BASE.replace(/\/+$/, "")
    : `${location.origin}${ASSET_BASE.startsWith("/") ? "" : "/"}${ASSET_BASE}`.replace(/\/+$/, "");
  return `${base}/${s}`.replace(/(?<!:)\/{2,}/g, "/");
}

/* Where to load the story from via <meta name="book-src"> or ?book=NAME */
function resolveStoryUrl() {
  const meta = (document.querySelector('meta[name="book-src"]')?.getAttribute('content') || '').trim();
  if (meta) {
    if (/^https?:\/\//i.test(meta)) return meta;
    if (meta.startsWith("/")) return `${location.origin}${meta}`;
    return `${location.origin}/${meta}`;
  }

  const qs = new URLSearchParams(location.search);
  const book = (qs.get("book") || "").trim();
  if (!book) throw new Error('No book specified. Use <meta name="book-src"> or ?book=name');

  const base = ASSET_BASE.startsWith("http")
    ? ASSET_BASE.replace(/\/+$/, "")
    : `${location.origin}${ASSET_BASE.startsWith("/") ? "" : "/"}${ASSET_BASE}`.replace(/\/+$/, "");

  // Special syntax: try .rtf first, then .txt if the first fetch fails
  return `${base}/${book}.rtf||${base}/${book}.txt`;
}

/* -------- DOM refs -------- */
const el = {
  title:  document.getElementById("bookTitle"),
  page:   document.getElementById("page"),
  prev:   document.getElementById("prevBtn"),
  next:   document.getElementById("nextBtn"),
  num:    document.getElementById("pageNum"),
  count:  document.getElementById("pageCount"),
};

const CHARS_PER_PAGE = 1450;

let pages = [];
let idx = 0;

/* -------- Boot -------- */
init().catch(err => {
  console.error(err);
  if (el.page) {
    el.page.innerHTML = `<p style="color:#b91c1c">Failed to load book: ${escapeHtml(String(err.message || err))}</p>`;
  }
});

async function init() {
  const rawUrl = resolveStoryUrl();
  console.log("[Book] apiBase:", API_BASE, "assetBase:", ASSET_BASE, "rawSrc:", rawUrl);

  let raw = "";
  if (rawUrl.includes("||")) {
    const [u1, u2] = rawUrl.split("||");
    try { raw = await fetchText(u1); }
    catch { raw = await fetchText(u2); }
  } else {
    raw = await fetchText(rawUrl);
  }

  const isRtf = /^\s*{\\rtf/i.test(raw);
  let plain = isRtf ? rtfToText(raw) : raw;

  const fm = extractFrontMatter(plain);
  plain = fm.body;

  const html = convertTokensToHtml(plain);

  pages = paginate(html, CHARS_PER_PAGE);
  if (!pages.length) pages = ["(No content)"];

  if (fm.coverHtml) pages.unshift(fm.coverHtml);

  if (el.title) el.title.textContent = fm.title || deriveTitleFromUrl(rawUrl);
  if (el.count) el.count.textContent = String(pages.length);
  render();

  if (el.prev) el.prev.addEventListener("click", prev);
  if (el.next) el.next.addEventListener("click", next);
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  });
  updateButtons();
}

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
  if (el.page) el.page.innerHTML = pages[idx];
  if (el.num) el.num.textContent = String(idx + 1);
  updateButtons();
}
function flipRender() {
  if (!el.page) return;
  el.page.classList.remove("turning"); void el.page.offsetWidth;
  el.page.classList.add("turning");
  render();
}
function updateButtons() {
  if (el.prev) el.prev.toggleAttribute("disabled", idx === 0);
  if (el.next) el.next.toggleAttribute("disabled", idx === pages.length - 1);
}

function deriveTitleFromUrl(u) {
  const path = u.split("?")[0];
  const base = path.split("/").pop() || "Guild Book";
  return base.replace(/\.(rtf|txt)$/i, "").replace(/[_-]+/g, " ").toUpperCase();
}

async function fetchText(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} - ${await r.text().catch(()=> "")}`);
  return await r.text();
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

/* -------- Text → HTML blocks -------- */
/** Turn tokens into HTML paragraphs + image tags + manual break markers. */
function convertTokensToHtml(txt) {
  const withImgs = txt.replace(/\[image:([^\]]+)\]/gi, (_m, p1) => {
    const safe = String(p1 || "").trim();
    const full = assetUrl(safe);
    return `\n\n<figure><img src="${full}" alt="illustration"/></figure>\n\n`;
  });

  const withBreaks = withImgs
    .replace(/\[pagebreak\]/gi, "\n\n<pagebreak/>\n\n")
    .replace(/\|pagebreak\|/gi, "\n\n<pagebreak/>\n\n");

  return withBreaks
    .split(/\n{2,}/)
    .map(block => {
      const b = block.trim();
      if (!b) return "";
      if (b.startsWith("<figure>") || b === "<pagebreak/>") return b;
      return `<p>${escapeHtml(b)}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

/** Pagination that also respects <pagebreak/> blocks. */
function paginate(html, charsPerPage) {
  const blocks = html.split(/(?=<figure>|<p>|<pagebreak\/>)/i);
  const out = [];
  let buf = [];
  let count = 0;

  for (const bRaw of blocks) {
    const b = (bRaw || "").trim();
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

/* -------- Front matter -------- */
function extractFrontMatter(src) {
  const lines = src.split(/\r?\n/);
  let title = "";
  let subtitle = "";
  let credit = "";
  let cover = "";

  const out = [];

  const coverRe = /^\s*(?:\[cover\s*:\s*([^\]]+)\]|\|cover\s*=\s*([^|]+)\|)\s*$/i;
  const titleRe = /^\s*(?:\[title\s*:\s*([^\]]+)\]|\|title\s*=\s*([^|]+)\|)\s*$/i;
  const subRe   = /^\s*(?:\[subtitle\s*:\s*([^\]]+)\]|\|subtitle\s*=\s*([^|]+)\|)\s*$/i;
  const credRe  = /^\s*(?:\[credit\s*:\s*([^\]]+)\]|\|credit\s*=\s*([^|]+)\|)\s*$/i;

  for (const ln of lines) {
    let m;
    if ((m = ln.match(coverRe))) { cover = (m[1] || m[2] || "").trim(); continue; }
    if ((m = ln.match(titleRe))) { title = (m[1] || m[2] || "").trim(); continue; }
    if ((m = ln.match(subRe)))   { subtitle = (m[1] || m[2] || "").trim(); continue; }
    if ((m = ln.match(credRe)))  { credit = (m[1] || m[2] || "").trim(); continue; }
    out.push(ln);
  }

  let coverHtml;
  if (cover || title || subtitle || credit) {
    const full = cover ? assetUrl(cover) : "";
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

/* -------- RTF → Unicode text -------- */
function rtfToText(rtf) {
  let s = rtf.replace(/\r\n?/g, "\n");
  const dropGroups = [
    "fonttbl","colortbl","stylesheet","info","generator",
    "themedata","rsidtbl","listtable","listoverridetable",
    "latentstyles","filetbl"
  ];
  for (const name of dropGroups) s = removeRtfGroup(s, name);
  s = removeStarDestinations(s);
  for (let i = 0; i < 4; i++) s = s.replace(/\{\\f\d+[^{}]*\}/g, "");

  // \uN fallback decoding
  s = s.replace(/\\u(-?\d+)\??(.)?/g, (_m, n) => {
    let code = parseInt(n, 10);
    if (code < 0) code = 65536 + code;
    return String.fromCharCode(code);
  });

  // \'hh CP1252 bytes
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hh) =>
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
function removeRtfGroup(src, name) {
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
function removeStarDestinations(src) {
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
function findGroupEnd(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i + 1; }
    else if (ch === "\\") i++;
  }
  return -1;
}
function cp1252ByteToChar(b) {
  if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
  const map = {
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