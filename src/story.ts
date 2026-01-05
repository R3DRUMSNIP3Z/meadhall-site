/* story.ts — Interactive story runner (JSON nodes + choices)
   - Loads story JSON from /guildbook/*.json (frontend) or absolute URLs
   - Renders title + text + clickable choices
   - Saves progress in localStorage
   - Supports optional cover/title/subtitle/credit like book.ts (via URL params or JSON meta)
*/

export {}; // IMPORTANT: make this file a module (prevents TS global collisions)

/* ---------------- Config ---------------- */

const el = {
  title:  document.getElementById('bookTitle') as HTMLElement | null, // reuse your header id if you want
  page:   document.getElementById('page') as HTMLElement | null,      // reuse your page container
  prev:   document.getElementById('prevBtn') as HTMLButtonElement | null,
  next:   document.getElementById('nextBtn') as HTMLButtonElement | null,
  num:    document.getElementById('pageNum') as HTMLElement | null,
  count:  document.getElementById('pageCount') as HTMLElement | null,
};

const qs = new URLSearchParams(location.search);
const qsSrc   = (qs.get('src') || '').trim();
const qsTitle = (qs.get('title') || '').trim();
const qsCover = (qs.get('cover') || '').trim();

/* ---------------- Types ---------------- */

type Choice = {
  label: string;
  to: string;
  // optional conditions (future-proof)
  if?: string;
};

type StoryNode = {
  title?: string;
  chapter?: string;
  text: string[] | string;
  image?: string;      // optional image url/path
  choices?: Choice[];
  // optional: end flag
  end?: boolean;
};

type StoryMeta = {
  title?: string;
  subtitle?: string;
  credit?: string;
  cover?: string;
};

type Story = {
  start: string;
  meta?: StoryMeta;
  nodes: Record<string, StoryNode>;
};

/* ---------------- Boot ---------------- */

init().catch(err => {
  console.error(err);
  const msg = String((err as any)?.message || err || 'Unknown error');
  const where = el.page || document.body;
  where.innerHTML = `<p style="color:#b91c1c">Failed to load story: ${escapeHtml(msg)}</p>`;
});

async function init() {
  const src = resolveStorySrc();
  const storyUrl = toAbsoluteStoryUrl(src);

  // Load JSON
  const story = await fetchJson<Story>(storyUrl);

  // Determine title/cover (URL params win over JSON)
  const metaTitle = qsTitle || story.meta?.title || '';
  const metaCover = qsCover || story.meta?.cover || '';

  // Init header chrome
  if (el.title) el.title.textContent = metaTitle || 'Interactive Story';

  // Restore progress
  const savedNodeId = getSavedNodeId(src);
  const startId = savedNodeId || story.start;

  // Optional cover page: show once per story if not progressed
  const hasProgress = !!savedNodeId;
  if (!hasProgress && metaCover) {
    renderCover(metaTitle || 'Interactive Story', story.meta?.subtitle || '', story.meta?.credit || '', metaCover, () => {
      gotoNode(story, startId, src);
    });
    // page count UI for cover+story "pages" feel
    setPager(1, 2);
  } else {
    gotoNode(story, startId, src);
  }

  // Wire nav buttons as "Back/Forward" through history
  wireHistoryNav(src);
}

/* ---------------- URL + Storage ---------------- */

function resolveStorySrc(): string {
  if (!qsSrc) throw new Error('No story specified. Use ?src=/guildbook/yourstory.json');
  return qsSrc;
}

function progressKey(src: string): string {
  let path = src;
  try { path = new URL(src, location.origin).pathname; } catch {}
  path = (path.startsWith('/') ? path : '/' + path).toLowerCase();
  return 'mh_story_progress:' + encodeURIComponent(path);
}

function getSavedNodeId(src: string): string {
  return localStorage.getItem(progressKey(src)) || '';
}

function saveNodeId(src: string, nodeId: string) {
  localStorage.setItem(progressKey(src), nodeId);
  localStorage.setItem(progressKey(src) + ':updated', new Date().toISOString());
  // helpful for library "continue"
  localStorage.setItem('mh_last_story_src', src);
}

/* ---------------- Fetch helpers ---------------- */

// IMPORTANT: Story JSON under /guildbook should be fetched from the FRONTEND origin (Vercel).
// Do NOT prefix API_BASE for /guildbook/* assets.
function toAbsoluteStoryUrl(src: string): string {
  const s = (src || '').trim();
  if (!s) throw new Error('Missing story src');

  // absolute URL provided
  if (/^https?:\/\//i.test(s)) return s;

  // If it starts with "/", treat as a frontend/site asset
  if (s.startsWith('/')) return `${location.origin}${s}`;

  // Otherwise treat relative as frontend asset
  return `${location.origin}/${s}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} - ${t || r.statusText}`);
  }
  return await r.json();
}

/* ---------------- Rendering ---------------- */

function renderCover(title: string, subtitle: string, credit: string, coverSrc: string, onStart: () => void) {
  const host = ensureHost();
  const coverUrl = toAbsoluteAssetUrl(coverSrc);

  host.innerHTML = `
    <section class="cover" style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
      ${coverUrl ? `<img src="${coverUrl}" alt="Cover" style="max-width:70%;height:auto;border:1px solid rgba(200,169,107,.45);border-radius:14px;margin:10px auto 18px;display:block"/>` : ''}
      ${title ? `<h2 style="font-family:'Cinzel',serif;font-size:38px;margin:.2em 0 .2em">${escapeHtml(title)}</h2>` : ''}
      ${subtitle ? `<div style="opacity:.85;margin:.2em 0 .5em">${escapeHtml(subtitle)}</div>` : ''}
      ${credit ? `<div style="opacity:.75;font-size:14px">${escapeHtml(credit)}</div>` : ''}
      <div style="margin-top:18px">
        <button id="startStoryBtn" style="background:#d4a94d;color:#0b0e10;border:1px solid #3b3325;border-radius:10px;padding:10px 16px;font-weight:800;cursor:pointer">
          Start
        </button>
      </div>
    </section>
  `;

  const btn = document.getElementById('startStoryBtn') as HTMLButtonElement | null;
  btn?.addEventListener('click', onStart);
}

function gotoNode(story: Story, nodeId: string, src: string) {
  if (!story.nodes[nodeId]) {
    throw new Error(`Missing node "${nodeId}" in story JSON`);
  }

  saveNodeId(src, nodeId);

  // push history state so prev/next buttons can work
  history.pushState({ nodeId }, '', updateUrlNode(nodeId));

  renderNode(story, nodeId, src);
}

function renderNode(story: Story, nodeId: string, src: string) {
  const host = ensureHost();
  const node = story.nodes[nodeId];

  const title = node.title || '';
  const chapter = node.chapter || '';
  const lines = Array.isArray(node.text) ? node.text : [node.text];
  const img = node.image ? toAbsoluteAssetUrl(node.image) : '';

  const textHtml = lines
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('\n');

  const choices = (node.choices || []).filter(c => c && c.label && c.to);

  const choicesHtml = choices.length
    ? `
      <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
        ${choices.map(c => `
          <button class="choiceBtn" data-to="${escapeHtmlAttr(c.to)}"
            style="text-align:left;background:#0f1113;color:#e9e4d5;border:1px solid rgba(200,169,107,.45);border-radius:12px;padding:10px 12px;cursor:pointer;font-weight:700">
            ${escapeHtml(c.label)}
          </button>
        `).join('')}
      </div>
    `
    : (node.end ? `<div style="margin-top:14px;opacity:.8">— The End —</div>` : '');

  host.innerHTML = `
    ${chapter ? `<div class="chapter" style="text-transform:uppercase;letter-spacing:.08em;font-size:12px;opacity:.8">${escapeHtml(chapter)}</div>` : ''}
    ${title ? `<h2 style="font-family:'Cinzel',serif;margin:.2em 0 .6em;font-size:28px;">${escapeHtml(title)}</h2>` : ''}
    ${img ? `<figure><img src="${img}" alt="illustration" style="display:block;max-width:100%;height:auto;border-radius:12px;border:1px solid rgba(200,169,107,.45);margin:10px auto"/></figure>` : ''}
    ${textHtml}
    ${choicesHtml}
  `;

  // hook choice buttons
  host.querySelectorAll<HTMLButtonElement>('.choiceBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const to = btn.getAttribute('data-to') || '';
      if (!to) return;
      gotoNode(story, to, src);
      setPager(2, 2); // we treat story as page 2 when cover exists; harmless otherwise
    });
  });

  // set chrome title if present
  if (el.title) {
    const base = qsTitle || story.meta?.title || 'Interactive Story';
    el.title.textContent = base;
  }

  // display page counters as "node count" vibe (optional)
  const keys = Object.keys(story.nodes);
  const pos = Math.max(0, keys.indexOf(nodeId));
  setPager(pos + 1, Math.max(1, keys.length));
}

/* ---------------- History nav (optional) ---------------- */

function wireHistoryNav(_src: string) {
  // If your UI has left/right arrows (prevBtn/nextBtn), let them do browser back/forward.
  el.prev?.addEventListener('click', () => history.back());
  el.next?.addEventListener('click', () => history.forward());

  // Keyboard arrows too
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') history.back();
    if (e.key === 'ArrowRight') history.forward();
  });

  window.addEventListener('popstate', () => {
    // Minimal: we render on gotoNode() pushes.
    // If you want perfect popstate re-render later, store story in a module variable and rerender here.
  });
}

/* ---------------- Small utilities ---------------- */

function ensureHost(): HTMLElement {
  // Reuse your existing book.html layout:
  // <article id="page"> ... </article>
  if (el.page) return el.page;
  // Fallback if ids differ
  const fallback = document.getElementById('story') as HTMLElement | null;
  if (fallback) return fallback;
  throw new Error('Missing story container. Expected #page or #story.');
}

function setPager(n: number, total: number) {
  if (el.num) el.num.textContent = String(n);
  if (el.count) el.count.textContent = String(total);
}

function updateUrlNode(nodeId: string): string {
  const u = new URL(location.href);
  u.searchParams.set('node', nodeId);
  return u.pathname + u.search;
}

function toAbsoluteAssetUrl(src: string): string {
  const s = (src || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return `${location.origin}${s}`;
  return `${location.origin}/${s}`;
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]!));
}
function escapeHtmlAttr(s: string) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

