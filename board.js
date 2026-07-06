/* ============================================================================
   BOARD  —  Power-BI-style canvas engine
   Fixed 1600×900 board scaled to fit the stage. Tiles are free-positioned,
   draggable, resizable, addable from the palette, removable, and persisted.
   ============================================================================ */
(function () {

  const BOARD_W = 1600, BOARD_H = 900, GRID = 8, MIN_W = 168, MIN_H = 96;

  // localStorage key — bump the suffix when the tile schema changes
  const KEY = 'obesity-board-v4';

  // Default tile layout (used when no saved state exists or after Reset)
  const DEFAULT = [
    { type: 'kpi-avg',  x: 24,   y: 24,  w: 372, h: 150 },
    { type: 'kpi-high', x: 412,  y: 24,  w: 372, h: 150 },
    { type: 'kpi-low',  x: 800,  y: 24,  w: 372, h: 150 },
    { type: 'kpi-gap',  x: 1188, y: 24,  w: 388, h: 150 },
    { type: 'map',      x: 24,   y: 190, w: 760, h: 424 },
    { type: 'trend',    x: 800,  y: 190, w: 776, h: 203 },
    { type: 'scatter',  x: 800,  y: 405, w: 776, h: 209 },
    { type: 'gap',      x: 24,   y: 630, w: 500, h: 246 },
    { type: 'corr',     x: 540,  y: 630, w: 392, h: 246 },
    { type: 'atrisk',   x: 948,  y: 630, w: 300, h: 246 },
    { type: 'rules',    x: 1264, y: 630, w: 312, h: 246 },
  ];

  let tiles = [];
  let ctx   = { year: 2024 };   // shared context passed to every chart render fn
  let mode  = 'edit';
  let uid   = 1;
  let addCascade = 0;

  const board = document.getElementById('board');
  const stage = document.getElementById('stage');

  // Persistence

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ tiles, year: ctx.year, mode }));
    } catch (e) {}
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.tiles) && s.tiles.length) {
        tiles    = s.tiles.map(t => ({ ...t, id: 't' + (uid++) }));
        ctx.year = s.year || 2024;
        mode     = s.mode || 'edit';
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Grid helpers

  function snap(v)            { return Math.round(v / GRID) * GRID; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // Board scaling
  // The 1600×900 board is CSS-scaled (not resized) to always fill the stage,
  // so Plotly charts never need to re-render on window resize.

  let scale = 1;

  function fit() {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    scale = Math.min(sw / BOARD_W, sh / BOARD_H);
    board.style.transform = `translate(-50%,-50%) scale(${scale})`;
  }

  // Tile rendering

  function makeTile(t) {
    const meta = CHARTS[t.type];
    if (!meta) return;

    const el = document.createElement('div');
    el.className    = 'tile tile-' + meta.kind;
    el.dataset.id   = t.id;
    el.style.left   = t.x + 'px';
    el.style.top    = t.y + 'px';
    el.style.width  = t.w + 'px';
    el.style.height = t.h + 'px';

    // Tag KPI tiles so charts.js can find them by type for year-sync updates
    if (t.type.startsWith('kpi-')) {
      el.dataset.kpi = t.type;
    }

    el.innerHTML = `
      <div class="tbar">
        <div class="tbar-l"><span class="tname">${meta.name}</span></div>
        <div class="tbar-r">
          <span class="ttool">${meta.tool}</span>
          <button class="tx" title="Remove">✕</button>
        </div>
      </div>
      <div class="tbody">${meta.desc ? `<span class="tdesc">${meta.desc}</span>` : ''}</div>
      <div class="tgrip"></div>`;

    board.appendChild(el);

    const body  = el.querySelector('.tbody');
    t._el   = el;
    t._body = body;

    renderBody(t);

    // Remove button
    el.querySelector('.tx').addEventListener('click', e => {
      e.stopPropagation();
      removeTile(t.id);
    });

    // Drag via the title bar
    enableDrag(t, el.querySelector('.tbar'));

    // Resize via the corner grip
    enableResize(t, el.querySelector('.tgrip'));

    // Bring tile to front when clicked
    el.addEventListener('pointerdown', () => bringFront(el));
  }

  function renderBody(t) {
    const meta = CHARTS[t.type];
    t._body.innerHTML = '';

    if (meta.kind === 'plot') {
      // Plot tiles get a dedicated child div so Plotly can manage its own DOM
      const c = document.createElement('div');
      c.className = 'plot';
      t._body.appendChild(c);
      requestAnimationFrame(() => meta.render(c, ctx));
    } else {
      // KPI and insight tiles render directly into .tbody
      meta.render(t._body, ctx);
    }
  }

  let zTop = 10;
  function bringFront(el) { el.style.zIndex = (++zTop); }

  function removeTile(id) {
    const i = tiles.findIndex(t => t.id === id);
    if (i < 0) return;
    tiles[i]._el.remove();
    tiles.splice(i, 1);
    save();
  }

  function addTile(type) {
    const meta = CHARTS[type];
    const base = 40 + (addCascade % 6) * 28;
    addCascade++;

    const t = {
      id:   't' + (uid++),
      type,
      x:    snap(base),
      y:    snap(base + 60),
      w:    meta.w,
      h:    meta.h,
    };
    t.x = clamp(t.x, 0, BOARD_W - t.w);
    t.y = clamp(t.y, 0, BOARD_H - t.h);

    tiles.push(t);
    makeTile(t);
    bringFront(t._el);
    save();
  }

  // Drag

  function enableDrag(t, handle) {
    handle.addEventListener('pointerdown', e => {
      if (mode !== 'edit') return;
      if (e.target.closest('.tx')) return;   // don't start drag on the × button
      e.preventDefault();

      const sx = e.clientX, sy = e.clientY;
      const ox = t.x,       oy = t.y;
      t._el.classList.add('dragging');

      function move(ev) {
        const dx = (ev.clientX - sx) / scale;
        const dy = (ev.clientY - sy) / scale;
        t.x = clamp(snap(ox + dx), 0, BOARD_W - t.w);
        t.y = clamp(snap(oy + dy), 0, BOARD_H - t.h);
        t._el.style.left = t.x + 'px';
        t._el.style.top  = t.y + 'px';
      }

      function up() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup',   up);
        t._el.classList.remove('dragging');
        save();
      }

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup',   up);
    });
  }

  // Resize
  function enableResize(t, grip) {
    grip.addEventListener('pointerdown', e => {
      if (mode !== 'edit') return;
      e.preventDefault();
      e.stopPropagation();

      const sx = e.clientX, sy = e.clientY;
      const ow = t.w,       oh = t.h;
      t._el.classList.add('resizing');

      function move(ev) {
        const dx = (ev.clientX - sx) / scale;
        const dy = (ev.clientY - sy) / scale;
        t.w = clamp(snap(ow + dx), MIN_W, BOARD_W - t.x);
        t.h = clamp(snap(oh + dy), MIN_H, BOARD_H - t.y);
        t._el.style.width  = t.w + 'px';
        t._el.style.height = t.h + 'px';
      }

      function up() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup',   up);
        t._el.classList.remove('resizing');
        renderBody(t);   // re-render chart at the new size
        save();
      }

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup',   up);
    });
  }

  // View / Edit mode
  function applyMode() {
    document.body.dataset.mode = mode;
    const btn = document.getElementById('modeBtn');
    btn.textContent  = mode === 'edit' ? 'View' : 'Edit';
    btn.dataset.next = mode === 'edit' ? 'view' : 'edit';
    if (mode === 'view') document.getElementById('palette').classList.remove('open');
  }

  function toggleMode() {
    mode = mode === 'edit' ? 'view' : 'edit';
    applyMode();
    save();
  }

  // Palette
  function buildPalette() {
    const list = document.getElementById('palette-list');
    list.innerHTML = '';
    for (const [key, meta] of Object.entries(CHARTS)) {
      const b = document.createElement('button');
      b.className = 'pitem';
      b.innerHTML = `
        <span class="pi-ic pi-${meta.kind}"></span>
        <span class="pi-tx">
          <span class="pi-n">${meta.name}</span>
          <span class="pi-t">${meta.tool}</span>
        </span>
        <span class="pi-add">＋</span>`;
      b.addEventListener('click', () => addTile(key));
      list.appendChild(b);
    }
  }

  // Full board render
  // Removes all existing tile elements and rebuilds from the tiles array.
  // Exposed globally so charts.js (palette changes) can call it.

  function render() {
    board.querySelectorAll('.tile').forEach(n => n.remove());
    tiles.forEach(makeTile);
  }
  window.__rerenderBoard = render;

  // Init
  function init() {
    // Restore saved layout or fall back to DEFAULT
    if (!load()) {
      tiles = DEFAULT.map(t => ({ ...t, id: 't' + (uid++) }));
    }

    buildPalette();
    render();
    applyMode();
    fit();

    window.addEventListener('resize', fit);

    document.getElementById('modeBtn').addEventListener('click', toggleMode);

    document.getElementById('palClose').addEventListener('click', () => {
      document.getElementById('palette').classList.remove('open');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();