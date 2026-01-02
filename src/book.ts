/** Simple “book reader” with RTF→Unicode, cover/front-matter, images & page breaks
 *  + autosave/resume reading
 *  + click-to-turn pages (in addition to buttons + arrow keys)
 *  + mobile-friendly pagination
 *  + safer image token handling
 */
export {};


const API_BASE =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content ||
  location.origin;

// Where to load the story from:
// 1) <meta name="book-src" content="/uploads/samplebook/samplestorythorvald.rtf">
// 2) OR ?book=samplebook  (will try /uploads/samplebook.rtf then .txt)
// 3) OR ?src=/guildbook/whatever.rtf (optional, if you choose to support it later)
function resolveStoryUrl(): string {
  // Primary: meta fallback
  const meta = (document.querySelector('meta[name="book-src"]') as HTMLMetaElement)?.content?.trim();
  if (meta) return meta.startsWith('http') ? meta : `${API_BASE}${meta.startsWith('/') ? '' : '/'}${meta}`;

  // Optional: direct src via querystring (if you want to use it)
  const qs = new URLSearchParams(location.search);
  const src = (qs.get('src') || '').trim();
  if (src) return src.startsWith('http') ? src : `${API_BASE}${src.startsWith('/') ? '' : '/'}${src}`;

  // Legacy: ?book=name → /uploads/name.rtf (fallback to .txt)
  const book = (qs.get('book') || '').trim();
  if (!book) throw new Error('No book specified. Use <meta name="book-src"> or ?book=name (or ?src=...)');

  const tryRtf = `${API_BASE}/uploads/${book}.rtf`;
  const tryTxt = `${API_BASE}/uploads/${book}.txt`;
  // Probe RTF first; fetchText handles 404 fallback.
  return `${tryRtf}||${tryTxt}`; // special two-choice URL
}

const el = {
  title: document.getElementById('bookTitle')!,
  page: document.getElementById('page')!,
  prev: document.getElementById('prevBtn') as HTMLButtonElement,
  next: document.getElementById('nextBtn') as HTMLButtonElement,
  num: document.getElementById('pageNum')!,
  count: document.getElementById('pageCount')!,
};

// Pagination: slightly smaller on mobile
const isMobile = matchMedia('(max-width: 700px)').matches;
const CHARS_PER_PAGE = isMobile ? 1050 : 1450;

let pages: string[] = [];
let idx = 0;

// Progress tracking
let storyUrlResolved = '';
let progressKey = '';

init().catch((err) => {
  console.error(err);
  el.page.innerHTML = `<p style="color:#b91c1c">Failed to load book: ${escapeHtml(
    String((err as any)?.message || err)
  )}</p>`;
});

async function init() {
  const rawUrl = resolveStoryUrl();
  storyUrlResolved = rawUrl;
  progressKey = getBookKey(rawUrl);

  console.log('[Book] apiBase:', API_BASE, 'rawSrc:', rawUrl);

  // Allow "A||B" fallback (rtf first, then txt)
  let raw = '';
  if (rawUrl.includes('||')) {
    const [u1, u2] = rawUrl.split('||');
    try {
      raw = await fetchText(u1);
    } catch {
      raw = await fetchText(u2);
    }
  } else {
    raw = await fetchText(rawUrl);
  }

  const isRtf = /^\s*{\\rtf/i.test(raw);
  let plain = isRtf ? rtfToText(raw) : raw;

  // Extract front-matter and remove directives from the body:
  const fm = extractFrontMatter(plain);
  plain = fm.body;

  // Build the HTML (images + paragraphs + manual page breaks)
  const html = convertTokensToHtml(plain);

  // Paginate
  pages = paginate(html, CHARS_PER_PAGE);
  if (!pages.length) pages = ['(No content)'];

  // Inject a cover page if provided
  if (fm.coverHtml) pages.unshift(fm.coverHtml);

  // Title in the chrome
  el.title.textContent = fm.title || deriveTitleFromUrl(rawUrl);

  // Resume reading (after we know pageCount)
  idx = Math.min(loadProgress(progressKey), pages.length - 1);
  if (!Number.isFinite(idx) || idx < 0) idx = 0;

  el.count.textContent = String(pages.length);
  render();

  // Nav handlers
  el.prev.addEventListener('click', prev);
  el.next.addEventListener('click', next);

  // Arrow keys
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
  });

  // Click-to-turn on the page itself (left/right zones)
  el.page.addEventListener('click', (e) => {
    const rect = el.page.getBoundingClientRect();
    const x = (e as MouseEvent).clientX - rect.left;
    if (x < rect.width * 0.35) prev();
    else if (x > rect.width * 0.65) next();
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
  el.page.innerHTML = pages[idx];
  el.num.textContent = String(idx + 1);
  updateButtons();
  saveProgress(progressKey);
}
function flipRender() {
  el.page.classList.remove('turning');
  void (el.page as HTMLElement).offsetWidth;
  el.page.classList.add('turning');
  render();
}
function updateButtons() {
  el.prev.toggleAttribute('disabled', idx === 0);
  el.next.toggleAttribute('disabled', idx === pages.length - 1);
}

/* ---------------- progress helpers ---------------- */

function getBookKey(storyUrl: string): string {
  // Use the first URL before fallback "||"
  const u = storyUrl.split('||')[0];

  // Normalize to pathname if possible (ignore query/hash)
  let path = u;
  try {
    path = new URL(u, location.origin).pathname;
  } catch {
    // keep as-is if not parseable
  }

  // Ensure stable key even when API_BASE changes
  const stable = path.startsWith('/') ? path : `/${path}`;
  return 'mh_book_progress:' + encodeURIComponent(stable.toLowerCase());
}

function saveProgress(key: string) {
  try {
    localStorage.setItem(key, String(idx));
    localStorage.setItem(key + ':updated', new Date().toISOString());
    // Optional: store the last opened book as well
    localStorage.setItem('mh_last_book', storyUrlResolved.split('||')[0]);
  } catch {
    // ignore storage errors
  }
}

function loadProgress(key: string): number {
  try {
    const v = localStorage.getItem(key);
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/* ---------------- helpers ---------------- */

function deriveTitleFromUrl(u: string): string {
  const path = u.split('?')[0];
  const base = path.split('/').pop() || 'Guild Book';
  return base.replace(/\.(rtf|txt)$/i, '').replace(/[_-]+/g, ' ').toUpperCase();
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} - ${await r.text().catch(() => '')}`);
  return await r.text();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}

/** Turn tokens into HTML paragraphs + image tags + manual break markers. */
function convertTokensToHtml(txt: string): string {
  // [image:/path]  → <img>
  // (keeps absolute URLs or prefixes API_BASE for site paths)
  const withImgs = txt.replace(/\[image:([^\]]+)\]/gi, (_m, p1) => {
    const safe = String(p1 || '').trim();
    if (!safe) return '';

    const full = safe.startsWith('http') ? safe : `${API_BASE}${safe.startsWith('/') ? '' : '/'}${safe}`;

    // Very small safety gate: only allow http(s) URLs.
    // (Blocks odd schemes; images should be http/https in practice.)
    if (!/^https?:\/\//i.test(full)) return '';

    return `\n\n<figure><img src="${full}" alt="illustration"/></figure>\n\n`;
  });

  // [PAGEBREAK] or |PAGEBREAK| → <pagebreak/>
  const withBreaks = withImgs
    .replace(/\[pagebreak\]/gi, '\n\n<pagebreak/>\n\n')
    .replace(/\|pagebreak\|/gi, '\n\n<pagebreak/>\n\n');

  // Turn paragraphs (double newline) into <p> blocks; leave <figure>/<pagebreak/> intact
  return withBreaks
    .split(/\n{2,}/)
    .map((block) => {
      const b = block.trim();
      if (!b) return '';
      if (b.startsWith('<figure>') || b === '<pagebreak/>') return b;
      return `<p>${escapeHtml(b)}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

/** Pagination that also respects <pagebreak/> blocks. */
function paginate(html: string, charsPerPage: number): string[] {
  // split into logical blocks: figure, p, or pagebreak
  const blocks = html.split(/(?=<figure>|<p>|<pagebreak\/>)/i);
  const out: string[] = [];
  let buf: string[] = [];
  let count = 0;

  for (const bRaw of blocks) {
    const b = (bRaw || '').trim();
    if (!b) continue;

    if (b.toLowerCase() === '<pagebreak/>') {
      if (buf.length) out.push(buf.join('\n'));
      buf = [];
      count = 0;
      continue;
    }

    const isImage = /^<figure>/i.test(b);
    const textLen = b.replace(/<[^>]+>/g, '').length;
    const limit = isImage ? Math.floor(charsPerPage * 0.6) : charsPerPage;

    if (count + textLen > limit && buf.length) {
      out.push(buf.join('\n'));
      buf = [b];
      count = textLen;
    } else {
      buf.push(b);
      count += textLen;
    }
  }
  if (buf.length) out.push(buf.join('\n'));
  return out;
}

/* -------- Front-matter: cover/title/subtitle/credit + strip lines from body -------- */

type FrontMatter = {
  coverHtml?: string;
  title?: string;
  subtitle?: string;
  credit?: string;
  body: string; // remaining text without directive lines
};

function extractFrontMatter(src: string): FrontMatter {
  const lines = src.split(/\r?\n/);
  let title = '';
  let subtitle = '';
  let credit = '';
  let cover = '';

  const out: string[] = [];

  const coverRe = /^\s*(?:\[cover\s*:\s*([^\]]+)\]|\|cover\s*=\s*([^|]+)\|)\s*$/i;
  const titleRe = /^\s*(?:\[title\s*:\s*([^\]]+)\]|\|title\s*=\s*([^|]+)\|)\s*$/i;
  const subRe = /^\s*(?:\[subtitle\s*:\s*([^\]]+)\]|\|subtitle\s*=\s*([^|]+)\|)\s*$/i;
  const credRe = /^\s*(?:\[credit\s*:\s*([^\]]+)\]|\|credit\s*=\s*([^|]+)\|)\s*$/i;

  for (const ln of lines) {
    let m: RegExpMatchArray | null;
    if ((m = ln.match(coverRe))) {
      cover = (m[1] || m[2] || '').trim();
      continue;
    }
    if ((m = ln.match(titleRe))) {
      title = (m[1] || m[2] || '').trim();
      continue;
    }
    if ((m = ln.match(subRe))) {
      subtitle = (m[1] || m[2] || '').trim();
      continue;
    }
    if ((m = ln.match(credRe))) {
      credit = (m[1] || m[2] || '').trim();
      continue;
    }
    out.push(ln);
  }

  let coverHtml: string | undefined;
  if (cover || title || subtitle || credit) {
    const full = cover
      ? cover.startsWith('http')
        ? cover
        : `${API_BASE}${cover.startsWith('/') ? '' : '/'}${cover}`
      : '';

    coverHtml = `
      <section class="cover" style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
        ${
          full && /^https?:\/\//i.test(full)
            ? `<img src="${full}" alt="Cover" style="max-width:70%;height:auto;border:1px solid rgba(200,169,107,.45);border-radius:14px;margin:10px auto 18px;display:block"/>`
            : ''
        }
        ${title ? `<h2 style="font-family:'Cinzel',serif;font-size:38px;margin:.2em 0 .2em">${escapeHtml(title)}</h2>` : ''}
        ${subtitle ? `<div style="opacity:.85;margin:.2em 0 .5em">${escapeHtml(subtitle)}</div>` : ''}
        ${credit ? `<div style="opacity:.75;font-size:14px">${escapeHtml(credit)}</div>` : ''}
      </section>
    `;
  }

  return { coverHtml, title, subtitle, credit, body: out.join('\n').trim() };
}

/* ---------------- RTF → Unicode text (drops tables/font runs) ---------------- */

function rtfToText(rtf: string): string {
  let s = rtf.replace(/\r\n?/g, '\n');

  const dropGroups = [
    'fonttbl',
    'colortbl',
    'stylesheet',
    'info',
    'generator',
    'themedata',
    'rsidtbl',
    'listtable',
    'listoverridetable',
    'latentstyles',
    'filetbl',
  ];
  for (const name of dropGroups) s = removeRtfGroup(s, name);
  s = removeStarDestinations(s);
  for (let i = 0; i < 4; i++) s = s.replace(/\{\\f\d+[^{}]*\}/g, '');

  // \uNNNN?  (consume fallback char)
  s = s.replace(/\\u(-?\d+)\??(.)?/g, (_m, n: string) => {
    let code = parseInt(n, 10);
    if (code < 0) code = 65536 + code;
    return String.fromCharCode(code);
  });

  // \'hh  (Windows-1252)
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hh: string) => cp1252ByteToChar(parseInt(hh, 16)));

  s = s.replace(/\\par(d)?\b/g, '\n').replace(/\\line\b/g, '\n').replace(/\\tab\b/g, '  ');

  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  return s;
}

function removeRtfGroup(src: string, name: string): string {
  const needle = '{\\' + name;
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
    const start = out.indexOf('{\\*');
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
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    } else if (ch === '\\') i++;
  }
  return -1;
}

function cp1252ByteToChar(b: number): string {
  if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
  const map: Record<number, string> = {
    0x80: '€',
    0x82: '‚',
    0x83: 'ƒ',
    0x84: '„',
    0x85: '…',
    0x86: '†',
    0x87: '‡',
    0x88: 'ˆ',
    0x89: '‰',
    0x8a: 'Š',
    0x8b: '‹',
    0x8c: 'Œ',
    0x8e: 'Ž',
    0x91: '‘',
    0x92: '’',
    0x93: '“',
    0x94: '”',
    0x95: '•',
    0x96: '–',
    0x97: '—',
    0x98: '˜',
    0x99: '™',
    0x9a: 'š',
    0x9b: '›',
    0x9c: 'œ',
    0x9e: 'ž',
    0x9f: 'Ÿ',
    0xa0: '\u00A0',
  };
  if (map[b]) return map[b];
  if (b >= 0xa1 && b <= 0xff) return String.fromCharCode(b);
  return '';
}











