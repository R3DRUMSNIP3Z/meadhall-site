export {};

type Choice = { label: string; to: string };
type Node = { title?: string; text: string[] | string; choices?: Choice[] };
type Story = { start: string; nodes: Record<string, Node> };

const API_BASE =
  (document.querySelector('meta[name="api-base"]') as HTMLMetaElement)?.content ||
  location.origin;

const titleEl = document.getElementById('storyTitle')!;
const nodeEl  = document.getElementById('nodeName')!;
const content = document.getElementById('content')!;
const choicesEl = document.getElementById('choices')!;

init().catch(err => {
  console.error(err);
  content.innerHTML = `<p style="color:#b91c1c">Failed to load story: ${escapeHtml(String((err as any)?.message || err))}</p>`;
});

function resolveSrc(): string {
  const qs = new URLSearchParams(location.search);
  const src = (qs.get('src') || '').trim();
  if (!src) throw new Error('No story specified. Use ?src=/guildbook/yourstory.json');
  return src.startsWith('http') ? src : `${API_BASE}${src.startsWith('/') ? '' : '/'}${src}`;
}

function getStoryKey(srcUrl: string): string {
  let path = srcUrl;
  try { path = new URL(srcUrl, location.origin).pathname; } catch {}
  path = (path.startsWith('/') ? path : '/' + path).toLowerCase();
  return 'mh_story_progress:' + encodeURIComponent(path);
}

async function init() {
  const srcUrl = resolveSrc();
  const story = await fetchJson<Story>(srcUrl);

  // Use catalog title if passed, otherwise node title, otherwise filename
  const qsTitle = new URLSearchParams(location.search).get('title') || '';
  titleEl.textContent = qsTitle || 'Interactive Story';

  const key = getStoryKey(srcUrl);
  const saved = load(key);
  const startNode = saved || story.start;

  renderNode(story, startNode, key);
}

function renderNode(story: Story, id: string, key: string) {
  const node = story.nodes[id];
  if (!node) throw new Error(`Missing node: ${id}`);

  nodeEl.textContent = id;

  // Text
  const lines = Array.isArray(node.text) ? node.text : [node.text];
  content.innerHTML = `
    ${node.title ? `<h2>${escapeHtml(node.title)}</h2>` : ''}
    ${lines.map(t => `<p>${escapeHtml(String(t))}</p>`).join('')}
  `;

  // Choices
  choicesEl.innerHTML = '';
  const choices = node.choices || [];

  if (!choices.length) {
    const done = document.createElement('button');
    done.className = 'choice';
    done.textContent = 'The End • Back to Library';
    done.onclick = () => (location.href = '/library.html');
    choicesEl.appendChild(done);
  } else {
    for (const c of choices) {
      const b = document.createElement('button');
      b.className = 'choice';
      b.textContent = c.label;
      b.onclick = () => {
        save(key, c.to);
        renderNode(story, c.to, key);
      };
      choicesEl.appendChild(b);
    }
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} - ${await r.text().catch(()=>'')}`);
  return await r.json();
}

function save(key: string, nodeId: string) {
  try {
    localStorage.setItem(key, nodeId);
    localStorage.setItem(key + ':updated', new Date().toISOString());
    localStorage.setItem('mh_last_story', key);
  } catch {}
}

function load(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]!));
}
