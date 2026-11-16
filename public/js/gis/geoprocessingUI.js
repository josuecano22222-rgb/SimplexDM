/**
 * GeoprocessingUI
 * Minimal toolbox UI wired to main-process worker jobs.
 */
class GeoprocessingUI {
    constructor() {
        this.modal = null;
        this.projectPath = null;
    }

    init() {
        window.addEventListener('simplex:projectChanged', () => {
            this.projectPath = window.projectManager?.currentProjectPath || null;
        });
        this._ensureModal();
        this._wireKeyboard();
    }

    _ensureModal() {
        if (document.getElementById('geoprocessModal')) return;
        const modal = document.createElement('div');
        modal.id = 'geoprocessModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
          <div class="modal-content dashboard-content" style="max-width: 720px;">
            <div class="modal-header">
              <h2>Geoprocessing</h2>
              <button class="close-btn" id="closeGeoprocessBtn">×</button>
            </div>
            <div style="padding: 16px;">
              <div class="form-group">
                <label>Input Layer</label>
                <select id="geoprocessInputLayer" class="select-input"></select>
              </div>
              <div class="form-group">
                <label>Operation</label>
                <select id="geoprocessOp" class="select-input">
                  <option value="buffer">Buffer</option>
                  <option value="dissolve">Dissolve</option>
                  <option value="union">Union</option>
                </select>
              </div>
              <div class="form-group" id="geoprocessDistanceGroup">
                <label>Buffer Distance (degrees, stage-1)</label>
                <input id="geoprocessDistance" class="text-input" value="0.001" />
              </div>
              <div class="form-group">
                <label>Output Layer ID</label>
                <input id="geoprocessOutputLayer" class="text-input" placeholder="e.g., roads_buffer" />
              </div>
              <div class="form-actions">
                <button class="btn btn-primary" id="runGeoprocessBtn">Run</button>
              </div>
              <div id="geoprocessResult" style="margin-top:12px;color:var(--text-secondary);"></div>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        this.modal = modal;

        modal.querySelector('#closeGeoprocessBtn')?.addEventListener('click', () => this.hide());
        modal.querySelector('#geoprocessOp')?.addEventListener('change', () => {
            const op = modal.querySelector('#geoprocessOp')?.value;
            const grp = modal.querySelector('#geoprocessDistanceGroup');
            if (grp) grp.style.display = op === 'buffer' ? 'block' : 'none';
        });
        modal.querySelector('#runGeoprocessBtn')?.addEventListener('click', () => this.run());
    }

    async show() {
        this._ensureModal();
        await this._populateLayers();
        this.modal.style.display = 'flex';
    }

    hide() {
        if (this.modal) this.modal.style.display = 'none';
    }

    async _populateLayers() {
        const sel = this.modal.querySelector('#geoprocessInputLayer');
        if (!sel) return;
        sel.innerHTML = '';
        await window.layerStore?.refresh();
        for (const l of window.layerStore.layers.filter(l => l.type === 'vector')) {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.name;
            sel.appendChild(opt);
        }
    }

    async run() {
        const projectPath = window.projectManager?.currentProjectPath;
        if (!projectPath) {
            window.notification?.warning('Open a project first');
            return;
        }
        const inputLayerId = this.modal.querySelector('#geoprocessInputLayer')?.value;
        const op = this.modal.querySelector('#geoprocessOp')?.value;
        const outputLayerId = this.modal.querySelector('#geoprocessOutputLayer')?.value || '';
        const dist = Number(this.modal.querySelector('#geoprocessDistance')?.value || 0);
        const resultEl = this.modal.querySelector('#geoprocessResult');
        if (resultEl) resultEl.textContent = 'Running...';
        try {
            const res = await window.electronAPI.gis.geoprocess.run(projectPath, {
                op,
                inputLayerId,
                outputLayerId: outputLayerId || undefined,
                distance: dist
            });
            if (resultEl) resultEl.textContent = `Done. Output: ${res.outputLayerId}`;
            await window.layerStore?.refresh();
            await window.layerRuntime?.reloadAll();
            window.notification?.success('Geoprocessing complete');
        } catch (e) {
            if (resultEl) resultEl.textContent = `Error: ${e.message}`;
            window.errorHandler?.handle(e, { component: 'GeoprocessingUI', action: 'run' }, true);
        }
    }

    _wireKeyboard() {
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
                this.show().catch(() => {});
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.geoprocessingUI = window.geoprocessingUI || new GeoprocessingUI();
}

