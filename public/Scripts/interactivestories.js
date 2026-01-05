(() => {
  const state = { all: [], query: '', tag: 'All', page: 1, perPage: 12 };

  const grid = document.getElementById('grid');
  const q = document.getElementById('q');
  const chips = document.getElementById('chips');
  const pager = document.getElementById('pager');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const pageinfo = document.getElementById('pageinfo');

  function readerUrl(item){
    const u = new URL('/story.html', location.origin);
    u.searchParams.set('src', item.src);
    u.searchParams.set('title', item.title || '');
    if (item.cover) u.searchParams.set('cover', item.cover);
    return u.pathname + u.search;
  }

  async function loadCatalog(){
    try{
      const r = await fetch('/guildbook/catalog.json', { cache: 'no-store' });
      if (!r.ok) throw 0;
      const js = await r.json();
      if (!Array.isArray(js)) throw 0;
      return js;
    }catch{
      return [
        {
          id: 'vikingstory',
          title: 'Viking Story Placeholder Name',
          author: 'Lisa',
          tags: ['Interactive','Viking'],
          summary: 'An interactive test story.',
          type: 'interactive',
          src: '/guildbook/vikingstory.json',
          cover: '/guildbook/vikingstory-cover.jpg'
        }
      ];
    }
  }

  function uniqTags(items){
    const set = new Set();
    items.forEach(it => (it.tags || []).forEach(t => set.add(String(t))));
    return ['All', ...Array.from(set).sort((a,b)=>a.localeCompare(b))];
  }

  function matches(it){
    const qv = (state.query || '').trim().toLowerCase();
    const tag = state.tag;
    if (tag !== 'All' && !(it.tags || []).map(String).includes(tag)) return false;
    if (!qv) return true;

    const hay = [
      it.title || '',
      it.author || '',
      (it.tags || []).join(' '),
      it.summary || ''
    ].join(' • ').toLowerCase();

    return hay.includes(qv);
  }

  function paginate(list){
    const start = (state.page - 1) * state.perPage;
    return list.slice(start, start + state.perPage);
  }

  function renderChips(list){
    chips.innerHTML = '';
    list.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (t === state.tag ? ' active' : '');
      b.textContent = t;
      b.onclick = () => { state.tag = t; state.page = 1; draw(); };
      chips.appendChild(b);
    });
  }

  function card(item){
    const el = document.createElement('article');
    el.className = 'card';

    const cover = item.cover
      ? `<img src="${item.cover}" alt="">`
      : `<div style="color:#aa8a28">📖 Mead Hall</div>`;

    const tags = (item.tags || []).map(t => `<span class="t">${t}</span>`).join('');
    const readHref = readerUrl(item);

    el.innerHTML = `
      <div class="cover">${cover}</div>
      <div class="head">
        <h3>${item.title || 'Untitled'}</h3>
        <div class="meta">${item.author ? 'by ' + item.author : ''}</div>
      </div>
      <div class="summary">${item.summary || ''}</div>
      <div class="tagrow">${tags}</div>
      <div class="actions">
        <a class="btn primary" href="${readHref}">Read</a>
      </div>
    `;

    return el;
  }

  function draw(){
    const filtered = state.all.filter(matches);
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.perPage));
    if (state.page > totalPages) state.page = totalPages;

    grid.innerHTML = '';

    if (!filtered.length) {
      grid.innerHTML = `<div class="card empty">No interactive stories match your filters.</div>`;
    } else {
      paginate(filtered).forEach(it => grid.appendChild(card(it)));
    }

    pager.hidden = totalPages <= 1;
    pageinfo.textContent = `${state.page} / ${totalPages}`;
    prev.disabled = state.page <= 1;
    next.disabled = state.page >= totalPages;
  }

  q.addEventListener('input', () => {
    state.query = q.value;
    state.page = 1;
    draw();
  });

  prev.addEventListener('click', () => {
    if (state.page > 1) { state.page--; draw(); }
  });

  next.addEventListener('click', () => {
    state.page++;
    draw();
  });

  (async () => {
    const catalog = await loadCatalog();

    // Only interactive items
    state.all = catalog.filter(it => (it?.type || 'book') === 'interactive' && it?.src);

    renderChips(uniqTags(state.all));

    // Optional query params
    const params = new URLSearchParams(location.search);
    const qParam = params.get('q');
    const tagParam = params.get('tag');
    if (qParam) { q.value = qParam; state.query = qParam; }
    if (tagParam) { state.tag = tagParam; }

    draw();
  })();
})();
