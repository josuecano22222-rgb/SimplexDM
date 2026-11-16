/**
 * BookmarkManager
 * Enhanced bookmark system with virtual tours (Meridian Design - Page 11)
 * Features: Save camera views, thumbnails, edit names, delete, virtual tours
 */

class BookmarkManager {
    constructor() {
        this.tilesetViewer = null;
        this.navigationManager = null;
        this.bookmarks = [];
        this.currentBookmarkIndex = -1;
        this.isVirtualTourActive = false;
        this.virtualTourInterval = null;
        this.storageKey = 'simplex_bookmarks_v1';
        this.init();
    }

    /**
     * Initialize bookmark manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.navigationManager = window.navigationManager;
        this.loadBookmarks();
        this.createBookmarkUI();
        this.setupEventHandlers();
    }

    /**
     * Load bookmarks from storage
     */
    loadBookmarks() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                this.bookmarks = Array.isArray(parsed)
                    ? parsed.map(b => this._deserializeBookmark(b)).filter(Boolean)
                    : [];
            }
        } catch (error) {
            console.error('Failed to load bookmarks:', error);
            this.bookmarks = [];
        }
    }

    /**
     * Save bookmarks to storage
     */
    saveBookmarks() {
        try {
            const serializable = this.bookmarks.map(b => this._serializeBookmark(b)).filter(Boolean);
            localStorage.setItem(this.storageKey, JSON.stringify(serializable));
        } catch (error) {
            console.error('Failed to save bookmarks:', error);
        }
    }

    _serializeBookmark(bookmark) {
        if (!bookmark) return null;
        const pos = bookmark.position || {};
        const cart = pos.position;
        return {
            id: bookmark.id,
            name: bookmark.name,
            position: {
                position: cart ? { x: cart.x, y: cart.y, z: cart.z } : null,
                heading: pos.heading ?? 0,
                pitch: pos.pitch ?? 0,
                roll: pos.roll ?? 0
            },
            coordinates: bookmark.coordinates,
            thumbnail: bookmark.thumbnail || null,
            createdAt: bookmark.createdAt || new Date().toISOString()
        };
    }

    _deserializeBookmark(raw) {
        if (!raw || !raw.id || !raw.position) return null;
        const p = raw.position.position;
        const cart = p && typeof p.x === 'number'
            ? new Cesium.Cartesian3(p.x, p.y, p.z)
            : null;
        return {
            id: raw.id,
            name: raw.name || 'Bookmark',
            position: {
                position: cart,
                heading: raw.position.heading ?? 0,
                pitch: raw.position.pitch ?? 0,
                roll: raw.position.roll ?? 0
            },
            coordinates: raw.coordinates || null,
            thumbnail: raw.thumbnail || null,
            createdAt: raw.createdAt || new Date().toISOString()
        };
    }

    /**
     * Create bookmark UI elements
     */
    createBookmarkUI() {
        // Bookmark gallery overlay (bottom center)
        const gallery = document.createElement('div');
        gallery.id = 'bookmarkGallery';
        gallery.className = 'bookmark-gallery';
        gallery.style.display = 'none';

        gallery.innerHTML = `
            <div class="bookmark-gallery-header">
                <h3>Bookmarks</h3>
                <button class="bookmark-add-btn" id="addBookmarkBtn" title="Add Bookmark">+</button>
                <button class="bookmark-close-btn" id="closeBookmarkGalleryBtn" title="Close">×</button>
            </div>
            <div class="bookmark-gallery-content" id="bookmarkGalleryContent">
                <!-- Bookmarks will be rendered here -->
            </div>
            <div class="bookmark-gallery-controls">
                <button class="bookmark-control-btn" id="virtualTourBtn" title="Virtual Tour">
                    <span>▶</span> Virtual Tour
                </button>
                <button class="bookmark-control-btn" id="stopTourBtn" title="Stop Tour" style="display: none;">
                    <span>⏹</span> Stop Tour
                </button>
            </div>
        `;

        document.querySelector('.viewer-container')?.appendChild(gallery);

        // Bookmark edit modal
        const editModal = document.createElement('div');
        editModal.id = 'bookmarkEditModal';
        editModal.className = 'bookmark-edit-modal';
        editModal.style.display = 'none';

        editModal.innerHTML = `
            <div class="bookmark-edit-content">
                <div class="bookmark-edit-header">
                    <h3>Edit Bookmark</h3>
                    <button class="close-btn" id="closeBookmarkEditBtn">×</button>
                </div>
                <div class="bookmark-edit-body">
                    <div class="form-group">
                        <label>Bookmark Name</label>
                        <input type="text" id="bookmarkNameInput" class="text-input" placeholder="Enter bookmark name">
                    </div>
                    <div class="form-actions">
                        <button class="btn btn-primary" id="saveBookmarkBtn">Save</button>
                        <button class="btn btn-danger" id="deleteBookmarkBtn">Delete</button>
                        <button class="btn" id="cancelBookmarkEditBtn">Cancel</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(editModal);
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Add bookmark button
        document.getElementById('addBookmarkBtn')?.addEventListener('click', () => {
            this.addBookmark();
        });

        // Close gallery
        document.getElementById('closeBookmarkGalleryBtn')?.addEventListener('click', () => {
            this.hideGallery();
        });

        // Virtual tour buttons
        document.getElementById('virtualTourBtn')?.addEventListener('click', () => {
            this.startVirtualTour();
        });

        document.getElementById('stopTourBtn')?.addEventListener('click', () => {
            this.stopVirtualTour();
        });

        // Edit modal handlers
        document.getElementById('closeBookmarkEditBtn')?.addEventListener('click', () => {
            this.hideEditModal();
        });

        document.getElementById('cancelBookmarkEditBtn')?.addEventListener('click', () => {
            this.hideEditModal();
        });

        document.getElementById('saveBookmarkBtn')?.addEventListener('click', () => {
            this.saveBookmarkEdit();
        });

        document.getElementById('deleteBookmarkBtn')?.addEventListener('click', () => {
            this.deleteCurrentBookmark();
        });
    }

    /**
     * Add new bookmark
     */
    async addBookmark() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        // Get current camera state (precise)
        const position = {
            position: Cesium.Cartesian3.clone(camera.position),
            heading: camera.heading,
            pitch: camera.pitch,
            roll: camera.roll
        };

        // Get cartographic for coordinates
        const cartographic = Cesium.Cartographic.fromCartesian(position.position);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const height = cartographic.height;

        // Generate thumbnail (simplified - capture current view)
        const thumbnail = await this.captureThumbnail();

        // Create bookmark
        const bookmark = {
            id: Date.now().toString(),
            name: `Bookmark ${this.bookmarks.length + 1}`,
            position,
            coordinates: { lon, lat, height },
            thumbnail,
            createdAt: new Date().toISOString()
        };

        this.bookmarks.push(bookmark);
        this.saveBookmarks();
        this.renderGallery();

        if (window.app && typeof window.app.setTransientStatus === 'function') {
            window.app.setTransientStatus(`Bookmark saved — ${bookmark.name}`, 3200);
        }

        // Show edit modal to allow naming
        this.showEditModal(bookmark.id);
    }

    /**
     * Capture thumbnail of current view
     */
    async captureThumbnail() {
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) {
            return null;
        }

        const viewer = this.tilesetViewer.viewer;
        const canvas = viewer.scene.canvas;

        try {
            // Capture canvas as data URL
            return canvas.toDataURL('image/jpeg', 0.8);
        } catch (error) {
            console.error('Failed to capture thumbnail:', error);
            return null;
        }
    }

    /**
     * Render bookmark gallery
     */
    renderGallery() {
        const content = document.getElementById('bookmarkGalleryContent');
        if (!content) return;

        if (this.bookmarks.length === 0) {
            content.innerHTML = `
                <div class="bookmark-empty">
                    <div class="bookmark-empty-icon">🔖</div>
                    <p>No bookmarks saved</p>
                    <p class="bookmark-empty-hint">Click the + button to save your current view</p>
                </div>
            `;
            return;
        }

        content.innerHTML = this.bookmarks.map((bookmark, index) => `
            <div class="bookmark-item" data-bookmark-id="${bookmark.id}" data-index="${index}">
                <div class="bookmark-thumbnail">
                    ${bookmark.thumbnail ? 
                        `<img src="${bookmark.thumbnail}" alt="${bookmark.name}">` : 
                        `<div class="bookmark-thumbnail-placeholder">📷</div>`
                    }
                </div>
                <div class="bookmark-info">
                    <div class="bookmark-name">${bookmark.name}</div>
                    <div class="bookmark-coords">
                        ${bookmark.coordinates.lon.toFixed(8)}, ${bookmark.coordinates.lat.toFixed(8)}
                    </div>
                </div>
                <div class="bookmark-actions">
                    <button class="bookmark-action-btn" data-action="go" title="Go to bookmark">▶</button>
                    <button class="bookmark-action-btn" data-action="edit" title="Edit bookmark">✏️</button>
                </div>
            </div>
        `).join('');

        // Add click handlers
        content.querySelectorAll('.bookmark-item').forEach(item => {
            const bookmarkId = item.dataset.bookmarkId;
            const bookmark = this.bookmarks.find(b => b.id === bookmarkId);

            // Go to bookmark
            item.querySelector('[data-action="go"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToBookmark(bookmarkId, e.shiftKey);
            });

            // Edit bookmark
            item.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showEditModal(bookmarkId);
            });

            // Click on item to go to bookmark
            item.addEventListener('click', (e) => {
                this.goToBookmark(bookmarkId, !!e.shiftKey);
            });
        });
    }

    /**
     * Show bookmark gallery
     */
    showGallery() {
        const gallery = document.getElementById('bookmarkGallery');
        if (gallery) {
            gallery.style.display = 'block';
            this.renderGallery();
        }
    }

    /**
     * Hide bookmark gallery
     */
    hideGallery() {
        const gallery = document.getElementById('bookmarkGallery');
        if (gallery) {
            gallery.style.display = 'none';
        }
        this.stopVirtualTour();
    }

    /**
     * Toggle bookmark gallery
     */
    toggleGallery() {
        const gallery = document.getElementById('bookmarkGallery');
        if (gallery && gallery.style.display === 'none') {
            this.showGallery();
        } else {
            this.hideGallery();
        }
    }

    /**
     * Go to bookmark
     */
    goToBookmark(bookmarkId, isAnimated = false) {
        const bookmark = this.bookmarks.find(b => b.id === bookmarkId);
        if (!bookmark || !this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        const destination = bookmark.position?.position;
        if (!destination) return;

        const orientation = {
            heading: bookmark.position.heading,
            pitch: bookmark.position.pitch,
            roll: bookmark.position.roll
        };

        if (isAnimated) {
            camera.flyTo({
                destination,
                orientation,
                duration: 2.0
            });
        } else {
            camera.setView({
                destination,
                orientation
            });
            viewer.scene.requestRender();
        }

        // Update current bookmark index
        this.currentBookmarkIndex = this.bookmarks.findIndex(b => b.id === bookmarkId);

        if (window.app && typeof window.app.setTransientStatus === 'function') {
            window.app.setTransientStatus(`Bookmark: ${bookmark.name}`, 3500);
        }

        // Save camera position to navigation history
        if (this.navigationManager) {
            if (isAnimated) {
                setTimeout(() => this.navigationManager.saveCameraPosition?.(), 2000);
            } else {
                this.navigationManager.saveCameraPosition?.();
            }
        }
    }

    /**
     * Show edit modal
     */
    showEditModal(bookmarkId) {
        const bookmark = this.bookmarks.find(b => b.id === bookmarkId);
        if (!bookmark) return;

        const modal = document.getElementById('bookmarkEditModal');
        const nameInput = document.getElementById('bookmarkNameInput');

        if (modal && nameInput) {
            nameInput.value = bookmark.name;
            modal.dataset.bookmarkId = bookmarkId;
            modal.style.display = 'flex';
            nameInput.focus();
        }
    }

    /**
     * Hide edit modal
     */
    hideEditModal() {
        const modal = document.getElementById('bookmarkEditModal');
        if (modal) {
            modal.style.display = 'none';
            delete modal.dataset.bookmarkId;
        }
    }

    /**
     * Save bookmark edit
     */
    saveBookmarkEdit() {
        const modal = document.getElementById('bookmarkEditModal');
        const nameInput = document.getElementById('bookmarkNameInput');

        if (!modal || !nameInput) return;

        const bookmarkId = modal.dataset.bookmarkId;
        const bookmark = this.bookmarks.find(b => b.id === bookmarkId);

        if (bookmark) {
            bookmark.name = nameInput.value.trim() || `Bookmark ${this.bookmarks.indexOf(bookmark) + 1}`;
            this.saveBookmarks();
            this.renderGallery();
            this.hideEditModal();

            if (window.notification) {
                window.notification.success(
                    window.appI18n?.nt ? window.appI18n.nt('bookmarkSaved') : 'Bookmark saved'
                );
            }
        }
    }

    /**
     * Delete current bookmark
     */
    deleteCurrentBookmark() {
        const modal = document.getElementById('bookmarkEditModal');
        if (!modal) return;

        const bookmarkId = modal.dataset.bookmarkId;
        const index = this.bookmarks.findIndex(b => b.id === bookmarkId);

        if (index !== -1) {
            this.bookmarks.splice(index, 1);
            this.saveBookmarks();
            this.renderGallery();
            this.hideEditModal();

            if (window.notification) {
                window.notification.success(
                    window.appI18n?.nt ? window.appI18n.nt('bookmarkDeleted') : 'Bookmark deleted'
                );
            }
        }
    }

    /**
     * Start virtual tour
     */
    startVirtualTour() {
        if (this.bookmarks.length < 2) {
            if (window.notification) {
                window.notification.warning(
                    window.appI18n?.nt ? window.appI18n.nt('tourNeedTwo') : 'Need at least 2 bookmarks for virtual tour'
                );
            }
            return;
        }

        this.isVirtualTourActive = true;
        this.currentBookmarkIndex = 0;

        // Update UI
        document.getElementById('virtualTourBtn').style.display = 'none';
        document.getElementById('stopTourBtn').style.display = 'inline-flex';

        // Start tour
        this.playNextBookmark();
    }

    /**
     * Play next bookmark in tour
     */
    playNextBookmark() {
        if (!this.isVirtualTourActive) return;

        if (this.currentBookmarkIndex >= this.bookmarks.length) {
            this.currentBookmarkIndex = 0; // Loop back
        }

        const bookmark = this.bookmarks[this.currentBookmarkIndex];
        this.goToBookmark(bookmark.id, true);

        // Move to next bookmark after delay
        this.currentBookmarkIndex++;
        this.virtualTourInterval = setTimeout(() => {
            this.playNextBookmark();
        }, 5000); // 5 seconds per bookmark
    }

    /**
     * Stop virtual tour
     */
    stopVirtualTour() {
        this.isVirtualTourActive = false;

        if (this.virtualTourInterval) {
            clearTimeout(this.virtualTourInterval);
            this.virtualTourInterval = null;
        }

        // Update UI
        document.getElementById('virtualTourBtn').style.display = 'inline-flex';
        document.getElementById('stopTourBtn').style.display = 'none';
    }

    /**
     * Get all bookmarks
     */
    getAllBookmarks() {
        return this.bookmarks;
    }

    /**
     * Get bookmark by ID
     */
    getBookmark(id) {
        return this.bookmarks.find(b => b.id === id);
    }

    /**
     * Cleanup - stop virtual tour and clear timers
     */
    cleanup() {
        this.stopVirtualTour();
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.bookmarkManager = new BookmarkManager();
}
