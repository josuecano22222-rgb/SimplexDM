/**
 * ViewControls
 * Camera view controls
 */

class ViewControls {
    constructor() {
        this.tilesetViewer = null;
        this.navigationManager = null;
        this.init();
    }

    /**
     * Initialize with dependencies
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.navigationManager = window.navigationManager;
        this.setupEventHandlers();
    }

    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        document.getElementById('homeBtn')?.addEventListener('click', () => {
            this.home();
        });
        document.getElementById('backBtn')?.addEventListener('click', () => {
            this.back();
        });
        document.getElementById('forwardBtn')?.addEventListener('click', () => {
            this.forward();
        });
        document.getElementById('northBtn')?.addEventListener('click', () => {
            this.pointToNorth();
        });
        document.getElementById('topViewBtn')?.addEventListener('click', () => {
            this.topView();
        });
        document.getElementById('flyAroundBtn')?.addEventListener('click', () => {
            this.flyAround();
        });
    }

    /**
     * Home view
     */
    async home() {
        if (this.navigationManager) {
            await this.navigationManager.home();
        }
    }

    /**
     * Navigate back
     */
    back() {
        if (this.navigationManager) {
            this.navigationManager.navigateBack();
        }
    }

    /**
     * Navigate forward
     */
    forward() {
        if (this.navigationManager) {
            this.navigationManager.navigateForward();
        }
    }

    /**
     * Point to north
     */
    pointToNorth() {
        if (this.navigationManager) {
            this.navigationManager.pointToNorth();
        }
    }

    /**
     * Top view
     */
    topView() {
        if (this.navigationManager) {
            this.navigationManager.topView();
        }
    }

    /**
     * Fly around
     */
    flyAround() {
        if (this.navigationManager) {
            this.navigationManager.flyAround();
        }
    }
}

// Export singleton instance
window.viewControls = new ViewControls();
