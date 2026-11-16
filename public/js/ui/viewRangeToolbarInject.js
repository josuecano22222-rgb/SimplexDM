/**
 * After Ion measure UI mounts: ensure .cesium-measure-toolbar attachment helpers (Tools.md §5 — drawCylinder).
 */
(function () {
    'use strict';

    function scheduleInject(viewer) {
        if (!viewer) return;
        const tick = () => {
            if (window.smart3dToolbarWireup) {
                window.smart3dToolbarWireup.ensureMeasureToolbar(viewer);
                window.smart3dToolbarWireup.ensureDrawCylinder(viewer);
                window.applyToolbarTopOffset && window.applyToolbarTopOffset();
            }
        };
        tick();
        let n = 0;
        const id = window.setInterval(() => {
            n += 1;
            tick();
            if (n > 60) window.clearInterval(id);
        }, 300);
    }

    window.viewRangeToolbarInject = { scheduleInject: scheduleInject };
})();
