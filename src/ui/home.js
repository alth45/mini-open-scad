import { listFiles, deleteFile } from '../files/file-store.js';
import { escapeHtml } from '../utils.js';

const MAX_VISIBLE = 5;

export function createHomeScreen(containerEl, callbacks) {
    let allFiles = [];
    let showAllFiles = false;

    async function refresh() {
        try {
            allFiles = await listFiles();
        } catch (err) {
            console.error('[home] listFiles failed:', err);
            allFiles = [];
        }
        render();
    }

    function render() {
        containerEl.innerHTML = `
      <div class="home-scroll">
        <div class="home-container">
          <header class="home-header">
            <div class="home-logo"></div>
            <div>
              <h1>Mini OpenSCAD</h1>
              <p class="home-subtitle">Browser-based parametric CAD</p>
            </div>
          </header>

          <section class="home-section">
            <h2 class="home-h2">Menu Utama</h2>
            <div class="home-menu">
              <button class="home-menu-item" data-action="new">
                <span class="home-menu-icon">➕</span>
                <span class="home-menu-content">
                  <span class="home-menu-label">New Project</span>
                  <span class="home-menu-desc">Mulai project baru dari nol</span>
                </span>
              </button>
              <button class="home-menu-item" data-action="import">
                <span class="home-menu-icon">📂</span>
                <span class="home-menu-content">
                  <span class="home-menu-label">Import STL</span>
                  <span class="home-menu-desc">Load file 3D dari disk</span>
                </span>
              </button>
              <button class="home-menu-item" data-action="load-zip">
                <span class="home-menu-icon">📦</span>
                <span class="home-menu-content">
                  <span class="home-menu-label">Load Project (.zip)</span>
                  <span class="home-menu-desc">Buka project dari file backup</span>
                </span>
              </button>
              <button class="home-menu-item" data-action="files">
                <span class="home-menu-icon">📁</span>
                <span class="home-menu-content">
                  <span class="home-menu-label">Files Manager</span>
                  <span class="home-menu-desc">Kelola file STL tersimpan</span>
                </span>
              </button>
              <button class="home-menu-item" data-action="cheat">
                <span class="home-menu-icon">⌨</span>
                <span class="home-menu-content">
                  <span class="home-menu-label">Cheat Sheet</span>
                  <span class="home-menu-desc">Shortcut &amp; referensi sintaks</span>
                </span>
              </button>
            </div>
          </section>

          ${renderFilesSection()}

          <footer class="home-footer">
            <button class="home-skip" data-action="skip">Skip → Langsung ke Editor</button>
          </footer>
        </div>
      </div>
    `;

        attachListeners();
    }

    function renderFilesSection() {
        if (allFiles.length === 0) {
            return `
        <section class="home-section">
          <h2 class="home-h2">📁 Imported Files</h2>
          <div class="home-empty">
            <div class="home-empty-icon">📦</div>
            <div class="home-empty-text">Belum ada file STL</div>
            <div class="home-empty-hint">Import file STL untuk modifikasi model dari Thingiverse / CAD lain</div>
          </div>
        </section>
      `;
        }

        const visible = showAllFiles ? allFiles : allFiles.slice(0, MAX_VISIBLE);
        const remaining = allFiles.length - MAX_VISIBLE;

        return `
      <section class="home-section">
        <h2 class="home-h2">📁 Imported Files (${allFiles.length})</h2>
        <div class="home-files-grid">
          ${visible.map(f => `
            <div class="home-file-card" data-file="${escapeHtml(f.name)}" title="Klik untuk insert import(&quot;${escapeHtml(f.name)}&quot;)">
              <div class="home-file-icon">📦</div>
              <div class="home-file-info">
                <div class="home-file-name">${escapeHtml(f.name)}</div>
                <div class="home-file-meta">${(f.size / 1024).toFixed(1)} KB</div>
              </div>
              <button class="home-file-delete" data-file-delete="${escapeHtml(f.name)}" title="Hapus file">✕</button>
            </div>
          `).join('')}
          ${!showAllFiles && remaining > 0 ? `
            <button class="home-show-more" data-action="show-more">
              <span class="home-show-more-icon">⋯</span>
              <span>Show ${remaining} more</span>
            </button>
          ` : ''}
          ${showAllFiles && allFiles.length > MAX_VISIBLE ? `
            <button class="home-show-more" data-action="show-less">
              <span class="home-show-more-icon">▲</span>
              <span>Show less</span>
            </button>
          ` : ''}
        </div>
      </section>
    `;
    }

    function attachListeners() {
        containerEl.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'show-more') { showAllFiles = true; render(); return; }
                if (action === 'show-less') { showAllFiles = false; render(); return; }
                callbacks.onAction?.(action);
            });
        });

        containerEl.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'show-more') { showAllFiles = true; render(); return; }
                if (action === 'show-less') { showAllFiles = false; render(); return; }
                callbacks.onAction?.(action);
            });
        });

        containerEl.querySelectorAll('.home-file-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.home-file-delete')) return;
                callbacks.onFileInsert?.(card.dataset.file);
            });
        });

        containerEl.querySelectorAll('.home-file-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const name = btn.dataset.fileDelete;
                if (!confirm(`Hapus file '${name}'?`)) return;
                try {
                    await deleteFile(name);
                    await refresh();
                    callbacks.onFileDeleted?.(name);
                } catch (err) {
                    console.error('[home] delete failed:', err);
                }
            });
        });
    }

    return {
        show() { containerEl.classList.remove('hidden'); refresh(); },
        hide() { containerEl.classList.add('hidden'); },
        isVisible() { return !containerEl.classList.contains('hidden'); },
        refresh
    };
}