/**
 * Binds the offline raster basemap selector (data/tiles vs data/pro) to TilesetViewer.
 * 2D imagery only — separate from 3D Tiles.
 */
(function () {
    function bind() {
        const sel = document.getElementById('offlineRasterSourceSelect');
        if (!sel || sel.dataset.bound === '1') return;
        sel.dataset.bound = '1';

        sel.addEventListener('change', () => {
            const v = sel.value;
            if (window.tilesetViewer && typeof window.tilesetViewer.setOfflineRasterSource === 'function') {
                void window.tilesetViewer.setOfflineRasterSource(v);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
