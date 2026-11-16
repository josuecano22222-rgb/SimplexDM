/**
 * Map toolbar — flyout menus for stack tools, positioning next to triggers.
 * Primary rail + dock buttons are wired by FrontendIntegration; this activates flyouts.
 */

class ToolbarManager {
    constructor() {
        this._openFlyoutId = null;
        this._onDocClick = this._onDocClick.bind(this);
        this._onResize = this._onResize.bind(this);
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._wireFlyouts());
        } else {
            this._wireFlyouts();
        }
    }

    /** Close all nested-toolbar flyouts (public for map toolbar coordinator). */
    closeAllFlyouts() {
        this._closeAllFlyouts();
    }

    _wireFlyouts() {
        const triggers = document.querySelectorAll('[data-flyout-trigger]');
        triggers.forEach((btn) => {
            const panelId = btn.getAttribute('data-flyout-trigger');
            if (!panelId) return;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._toggleFlyout(panelId, btn);
            });
        });
        document.addEventListener('click', this._onDocClick, true);
        window.addEventListener('resize', this._onResize);
    }

    _toggleFlyout(panelId, anchorEl) {
        const panel = document.getElementById(panelId);
        if (!panel || !anchorEl) return;

        const willOpen = panel.hidden || this._openFlyoutId !== panelId;
        this._closeAllFlyouts();

        if (!willOpen) return;

        panel.hidden = false;
        this._openFlyoutId = panelId;
        requestAnimationFrame(() => this._positionFlyout(panel, anchorEl));
        const container = document.getElementById('nestedToolbarContainer');
        if (container) container.setAttribute('aria-hidden', 'false');
    }

    _closeAllFlyouts() {
        document.querySelectorAll('.nested-toolbar-flyout').forEach((el) => {
            el.hidden = true;
        });
        this._openFlyoutId = null;
        const container = document.getElementById('nestedToolbarContainer');
        if (container) container.setAttribute('aria-hidden', 'true');
    }

    _positionFlyout(panel, anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        const margin = 6;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        panel.style.position = 'fixed';
        panel.style.zIndex = window.simplexUILayer
            ? window.simplexUILayer.zIndex('NESTED_FLYOUT')
            : '10060';

        const pw = panel.offsetWidth || 220;
        const ph = panel.offsetHeight || 120;

        let left = rect.right - pw;
        if (left < margin) left = rect.left;
        if (left + pw > vw - margin) left = Math.max(margin, vw - pw - margin);

        let top = rect.bottom + margin;
        if (top + ph > vh - margin) {
            top = rect.top - ph - margin;
        }
        if (top < margin) top = margin;

        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
        panel.style.right = 'auto';
    }

    _onDocClick(e) {
        if (!this._openFlyoutId) return;
        const panel = document.getElementById(this._openFlyoutId);
        if (!panel) return;
        const trigger = document.querySelector(`[data-flyout-trigger="${this._openFlyoutId}"]`);
        if (panel.contains(e.target)) return;
        if (trigger && trigger.contains(e.target)) return;
        this._closeAllFlyouts();
    }

    _onResize() {
        if (!this._openFlyoutId) return;
        const panel = document.getElementById(this._openFlyoutId);
        const trigger = document.querySelector(`[data-flyout-trigger="${this._openFlyoutId}"]`);
        if (panel && trigger && !panel.hidden) {
            this._positionFlyout(panel, trigger);
        }
    }
}

if (typeof window !== 'undefined') {
    window.toolbarManager = new ToolbarManager();
}
