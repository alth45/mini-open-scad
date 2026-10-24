/* ============================================================
   Cheat Sheet — modal referensi lengkap
   ============================================================ */

const SHORTCUTS = {
  global: [
    { keys: ['Ctrl', 'Enter'], desc: 'Render sekarang' },
    { keys: ['Ctrl', 'S'], desc: 'Save ke localStorage' },
    { keys: ['Ctrl', 'Z'], desc: 'Undo' },
    { keys: ['Ctrl', 'Y'], desc: 'Redo (atau Ctrl+Shift+Z)' },
    { keys: ['Ctrl', 'Shift', 'R'], desc: 'Hard refresh browser' },
    { keys: ['?'], desc: 'Toggle cheat sheet ini' },
    { keys: ['Esc'], desc: 'Tutup modal / cancel' }
  ],
  editor: [
    { keys: ['Tab'], desc: 'Indent 2 spasi' },
    { keys: ['Ctrl', 'Enter'], desc: 'Render dari mana saja' },
    { keys: ['Ctrl', 'S'], desc: 'Save paksa' },
    { keys: ['Ctrl', 'Z'], desc: 'Undo (per burst typing)' },
    { keys: ['Ctrl', 'Y'], desc: 'Redo' }
  ],
  viewer: [
    { keys: ['Drag kiri'], desc: 'Rotate kamera' },
    { keys: ['Drag kanan'], desc: 'Pan kamera' },
    { keys: ['Scroll'], desc: 'Zoom in/out' },
    { keys: ['⟲ Reset'], desc: 'Kembali ke fit-to-model' }
  ]
};

const SYNTAX = [
  {
    title: 'Primitives 3D',
    items: [
      { name: 'cube', code: 'cube(size = 10, center = true);\ncube([x, y, z]);', desc: 'Box dari origin (atau center)' },
      { name: 'sphere', code: 'sphere(r = 5, $fn = 64);\nsphere(d = 10);', desc: 'Bola di origin' },
      { name: 'cylinder', code: 'cylinder(h = 20, r = 5);\ncylinder(h = 20, r1 = 3, r2 = 8);\ncylinder(h = 20, d = 10);', desc: 'Silinder / kerucut (Z-up, dasar di z=0)' },
      { name: 'polyhedron', code: 'polyhedron(\n  points = [[0,0,0],[10,0,0],[0,10,0]],\n  faces = [[0,1,2]]\n);', desc: 'Mesh manual dari vertex + face' }
    ]
  },
  {
    title: 'Primitives 2D',
    items: [
      { name: 'circle', code: 'circle(r = 5);\ncircle(r = 5, $fn = 6);   // hexagon', desc: 'Lingkaran / polygon N-sisi' },
      { name: 'square', code: 'square(size = 10, center = true);\nsquare([w, h]);', desc: 'Persegi / kotak 2D' },
      { name: 'polygon', code: 'polygon(points = [[0,0],[10,0],[5,8]]);', desc: 'Polygon dari array titik' }
    ]
  },
  {
    title: 'Transforms',
    items: [
      { name: 'translate', code: 'translate([10, 0, 5]) child();', desc: 'Geser objek' },
      { name: 'rotate', code: 'rotate([rx, ry, rz]) child();   // derajat\nrotate(45) child();            // Z saja', desc: 'Rotasi (derajat, urutan Z-Y-X)' },
      { name: 'scale', code: 'scale([2, 2, 0.5]) child();\nscale(2) child();', desc: 'Skala per-sumbu atau seragam' },
      { name: 'mirror', code: 'mirror([1, 0, 0]) child();', desc: 'Mirror terhadap plane normal v' },
      { name: 'resize', code: 'resize([30, 20, 10]) child();\nresize([20, 20, 10], auto = true) child();', desc: 'Scale agar bbox = target' },
      { name: 'multmatrix', code: 'multmatrix([\n  [1,0,0,10], [0,1,0,0], [0,0,1,0], [0,0,0,1]\n]) child();', desc: 'Transform 4×4 bebas' },
      { name: 'color', code: 'color("red") child();\ncolor([0.2, 0.8, 0.4]) child();\ncolor("#3b82f6") child();', desc: 'Warna mesh' }
    ]
  },
  {
    title: 'Boolean (CSG)',
    items: [
      { name: 'union', code: 'union() { a(); b(); }', desc: 'Gabung (default saat tanpa operator)' },
      { name: 'difference', code: 'difference() { a(); b(); }  // a - b', desc: 'Kurangi (b dilubangkan dari a)' },
      { name: 'intersection', code: 'intersection() { a(); b(); }', desc: 'Irisan (hanya area overlap)' },
      { name: 'hull', code: 'hull() { a(); b(); }', desc: 'Convex hull dari semua child (2D & 3D)' },
      { name: 'minkowski', code: 'minkowski() { a(); b(); }', desc: 'Minkowski sum (approx untuk convex)' }
    ]
  },
  {
    title: 'Extrusions & Offsets',
    items: [
      { name: 'linear_extrude', code: 'linear_extrude(height = 5) child2D();', desc: '2D → 3D dengan extrude tegak lurus' },
      { name: 'rotate_extrude', code: 'rotate_extrude(angle = 360) child2D();', desc: 'Revolve 2D di sumbu Y → torus/vase' },
      { name: 'offset (2D)', code: 'offset(r = 2) child2D();      // round\noffset(delta = 2) child2D();  // miter', desc: 'Grow/shrink shape 2D' },
      { name: 'offset (3D)', code: 'offset(r = 2, $fn = 16) child3D();\noffset(delta = 2) child3D();', desc: 'Expand via Minkowski (convex only)' }
    ]
  },
  {
    title: 'Control Flow',
    items: [
      { name: 'for', code: 'for (i = [0 : 10]) child(i);\nfor (i = [0 : 2 : 10]) child(i);\nfor (v = [1, 2, 3]) child(v);\nfor (x = [0:1], y = [0:1]) child([x,y]);', desc: 'Loop range, vector, atau multi-iterator (Cartesian)' },
      { name: 'if / else', code: 'if (cond) a();\nif (cond) a(); else b();', desc: 'Kondisional' },
      { name: 'module', code: 'module name(args) { body; }\nname(arg);', desc: 'Fungsi penggambar (bisa dipanggil berulang)' },
      { name: 'function', code: 'function f(x) = x * 2;\nf(5);   // 10', desc: 'Fungsi return nilai' },
      { name: 'children', code: 'module wrapper() { children(); }\nwrapper() cube(10);', desc: 'Akses child yang di-pass (children(i), children([0:1]))' },
      { name: '$children', code: 'echo("total:", $children);', desc: 'Jumlah child yang diterima module' }
    ]
  },
  {
    title: 'Expressions',
    items: [
      { name: 'List comprehension', code: '[for (i = [0 : 5]) i * 2]\n[for (i = [0 : 10]) if (i % 2 == 0) i]', desc: 'Generate array dengan loop' },
      { name: 'Range', code: '[0 : 10]       // 0, 1, ..., 10\n[0 : 2 : 10]   // 0, 2, ..., 10', desc: 'Range dengan step' },
      // { name: 'Ternary', code: 'x > 0 ? "pos" : "neg"', desc: 'Kondisional ekspresi' },
      { name: 'let()', code: 'let(a = 10, b = a * 2) a + b   // 30\n[for (i = [0:5]) let(x = i * 2) x * x]', desc: 'Variabel lokal dalam ekspresi' },
      { name: 'Vector ops', code: '[1, 2, 3] + 10   // [11, 12, 13]\n[1, 2, 3] * 2    // [2, 4, 6]', desc: 'Operasi elementwise' },
      { name: 'Ternary', code: 'x > 0 ? "positive" : "negative"\n$fn = $preview ? 24 : 96;', desc: 'Kondisional: (cond) ? then : else' },
      { name: '$preview', code: '// true saat edit (cepat)\n// false untuk export (final)\n$fn = $preview ? 24 : 96;', desc: 'Boolean otomatis — true di live editor' },
    ]
  },
  {
    title: 'Modifiers',
    items: [
      { name: '* (disable)', code: '*cube(10);   // disembunyikan', desc: 'Sembunyikan objek' },
      { name: '! (show only)', code: '!cube(10);  // hanya ini yang tampil', desc: 'Isolasi objek untuk debug' },
      { name: '$fn', code: '$fn = 64;\nsphere(r = 5, $fn = 32);', desc: 'Jumlah segmen (smooth vs low-poly)' }
    ]
  },
  {
    title: 'Utilities',
    items: [
      { name: 'echo', code: 'echo("x =", 42, [1,2,3]);', desc: 'Print ke console' },
      { name: 'assert', code: 'assert(cond, "message");', desc: 'Hentikan render jika gagal' },
      { name: 'Math', code: 'sin(30)    // 0.5 (derajat)\ncos(60)    // 0.5\nsqrt(16)   // 4\nabs(-5)    // 5\nfloor(3.7) // 3\nround(3.5) // 4', desc: 'Fungsi matematika (sudut dalam derajat)' },
      { name: 'PI', code: 'sphere(r = 10);\ncircumference = 2 * PI * 10;', desc: 'Konstanta π' }
    ]
  },
  {
    title: 'Parameters UI',
    items: [
      { name: 'Slider', code: '// @param size {slider 10 100 50} Size', desc: 'Range numeric dengan UI slider' },
      { name: 'Enum', code: '// @param shape {enum cube sphere cylinder} Shape', desc: 'Dropdown pilihan' },
      { name: 'String', code: '// @param name {string world} Name', desc: 'Text input' },
      { name: 'Bool', code: '// @param solid {bool true} Solid?', desc: 'Checkbox on/off' },
      { name: 'Color', code: '// @param col {color #3b82f6} Color', desc: 'Color picker' }
    ]
  }
];

/* ============================================================
   Render helpers
   ============================================================ */

const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function renderKbd(keys) {
  return keys.map(k => `<kbd>${esc(k)}</kbd>`).join(' ');
}

function renderShortcutRow(row) {
  return `<div class="cheat-row">
    <div class="cheat-keys">${renderKbd(row.keys)}</div>
    <div class="cheat-desc">${esc(row.desc)}</div>
  </div>`;
}

function renderSyntaxRow(item) {
  const search = (item.name + ' ' + item.desc + ' ' + item.code).toLowerCase();
  return `<div class="cheat-syntax-item" data-search="${esc(search)}">
    <div class="cheat-syntax-header">
      <code class="cheat-name">${esc(item.name)}</code>
      <span class="cheat-syntax-desc">${esc(item.desc)}</span>
    </div>
    <pre class="cheat-code">${esc(item.code)}</pre>
  </div>`;
}

function buildHTML() {
  const shortcutsHTML = Object.entries(SHORTCUTS).map(([section, rows]) => {
    const title = section === 'global' ? 'Umum' :
      section === 'editor' ? 'Di Editor' :
        section === 'viewer' ? 'Di Viewport 3D' : section;
    return `<div class="cheat-section">
      <h3 class="cheat-h3">${esc(title)}</h3>
      <div class="cheat-rows">${rows.map(renderShortcutRow).join('')}</div>
    </div>`;
  }).join('');

  const syntaxHTML = SYNTAX.map(section => `
    <div class="cheat-section" data-section-search="${esc((section.title + ' ' + section.items.map(i => i.name + ' ' + i.desc).join(' ')).toLowerCase())}">
      <h3 class="cheat-h3">${esc(section.title)}</h3>
      <div class="cheat-syntax-items">${section.items.map(renderSyntaxRow).join('')}</div>
    </div>
  `).join('');

  return `
    <div class="cheat-header">
      <div class="cheat-title">⌨ Cheat Sheet</div>
      <input id="cheatSearch" class="cheat-search" type="search" placeholder="Cari (mis. cube, rotate, for)…" autocomplete="off">
      <button class="modal-x" id="cheatClose">✕</button>
    </div>
    <div class="cheat-body" id="cheatBody">
      <div class="cheat-columns">
        <div class="cheat-col">
          <h2 class="cheat-h2">Keyboard Shortcuts</h2>
          ${shortcutsHTML}
        </div>
        <div class="cheat-col">
          <h2 class="cheat-h2">Referensi Bahasa</h2>
          <div id="cheatSyntaxContainer">${syntaxHTML}</div>
        </div>
      </div>
      <div class="cheat-empty hidden" id="cheatEmpty">
        Tidak ada hasil untuk "<span id="cheatEmptyQ"></span>"
      </div>
    </div>
    <div class="cheat-footer">
      Tekan <kbd>?</kbd> lagi atau <kbd>Esc</kbd> untuk tutup · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> render
    </div>
  `;
}

/* ============================================================
   Filter
   ============================================================ */

function setupSearch(modalEl) {
  const search = modalEl.querySelector('#cheatSearch');
  const empty = modalEl.querySelector('#cheatEmpty');
  const emptyQ = modalEl.querySelector('#cheatEmptyQ');

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    const syntaxItems = modalEl.querySelectorAll('.cheat-syntax-item');
    const syntaxSections = modalEl.querySelectorAll('[data-section-search]');
    const shortcutSections = modalEl.querySelectorAll('.cheat-rows');

    if (!q) {
      syntaxItems.forEach(el => el.classList.remove('cheat-hidden'));
      syntaxSections.forEach(el => el.classList.remove('cheat-hidden'));
      shortcutSections.forEach(el => el.closest('.cheat-section').classList.remove('cheat-hidden'));
      empty.classList.add('hidden');
      return;
    }

    let anyVisible = false;

    // Filter syntax items
    syntaxItems.forEach(el => {
      const hay = el.dataset.search || '';
      const match = hay.includes(q);
      el.classList.toggle('cheat-hidden', !match);
      if (match) anyVisible = true;
    });

    // Sembunyikan section jika semua child-nya hidden
    syntaxSections.forEach(sec => {
      const items = sec.querySelectorAll('.cheat-syntax-item');
      const visible = Array.from(items).some(i => !i.classList.contains('cheat-hidden'));
      sec.classList.toggle('cheat-hidden', !visible);
    });

    // Filter shortcut rows (cari di .cheat-desc & .cheat-keys)
    modalEl.querySelectorAll('.cheat-row').forEach(row => {
      const text = row.textContent.toLowerCase();
      const match = text.includes(q);
      row.classList.toggle('cheat-hidden', !match);
      if (match) anyVisible = true;
    });

    // Sembunyikan section shortcut jika semua row-nya hidden
    modalEl.querySelectorAll('.cheat-section').forEach(sec => {
      const rows = sec.querySelectorAll('.cheat-row');
      if (rows.length > 0) {
        const visible = Array.from(rows).some(r => !r.classList.contains('cheat-hidden'));
        sec.classList.toggle('cheat-hidden', !visible);
      }
    });

    // Empty state
    empty.classList.toggle('hidden', anyVisible);
    emptyQ.textContent = q;
  });
}

/* ============================================================
   Public API
   ============================================================ */

export function createCheatSheet(containerEl) {
  let isOpen = false;
  let built = false;

  function ensureBuilt() {
    if (built) return;
    containerEl.innerHTML = buildHTML();
    setupSearch(containerEl);
    containerEl.querySelector('#cheatClose').addEventListener('click', close);
    built = true;
  }

  function open() {
    ensureBuilt();
    containerEl.classList.remove('hidden');
    isOpen = true;
    // focus search setelah render
    setTimeout(() => {
      const s = containerEl.querySelector('#cheatSearch');
      if (s) { s.value = ''; s.dispatchEvent(new Event('input')); s.focus(); }
    }, 20);
  }

  function close() {
    containerEl.classList.add('hidden');
    isOpen = false;
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  // Close on backdrop click
  containerEl.addEventListener('click', (e) => {
    if (e.target === containerEl) close();
  });

  return {
    open,
    close,
    toggle,
    isOpen: () => isOpen
  };
}