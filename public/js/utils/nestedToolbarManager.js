/**
 * Nested Toolbar Manager
 * Manages nested toolbars that open from existing buttons
 * Supports show/hide functionality when selecting different sections
 */

class NestedToolbarManager {
    constructor() {
        this.activeToolbars = new Map(); // Map<parentButtonId, toolbarElement>
        this.toolbarConfigs = new Map(); // Map<parentButtonId, config>
        this.currentSection = null;
        this.boundOutsideClickHandler = this.handleOutsideClick.bind(this);
    }

    /**
     * Register a nested toolbar configuration
     * @param {string} parentButtonId - ID of the parent button that opens the toolbar
     * @param {Object} config - Toolbar configuration
     * @param {Array} config.items - Array of toolbar items {icon, label, action, id}
     * @param {string} config.position - 'below' or 'right' (default: 'below')
     * @param {string} config.section - Section name for show/hide control
     */
    registerToolbar(parentButtonId, config) {
        this.toolbarConfigs.set(parentButtonId, config);
    }

    /**
     * Create and show a nested toolbar
     * @param {string} parentButtonId - ID of the parent button
     * @param {HTMLElement} parentButton - The parent button element
     */
    showToolbar(parentButtonId, parentButton) {
        // Hide other toolbars in the same section
        this.hideToolbarsInSection(this.currentSection);

        const config = this.toolbarConfigs.get(parentButtonId);
        if (!config) return;

        // Remove existing toolbar if any
        this.hideToolbar(parentButtonId);

        // Create toolbar element
        const toolbar = document.createElement('div');
        toolbar.className = `nested-toolbar nested-toolbar-${config.position || 'below'}`;
        toolbar.id = `nestedToolbar-${parentButtonId}`;
        toolbar.dataset.section = config.section || 'default';
        toolbar.dataset.parentId = parentButtonId;

        // Create toolbar items
        const itemsHtml = config.items.map(item => `
            <div class="nested-toolbar-item" 
                 data-action="${item.action || ''}" 
                 data-id="${item.id || ''}"
                 title="${item.label || ''}">
                <div class="nested-toolbar-icon">${item.icon || ''}</div>
                ${item.label ? `<div class="nested-toolbar-label">${item.label}</div>` : ''}
            </div>
        `).join('');

        toolbar.innerHTML = itemsHtml;

        // Position toolbar relative to parent button
        const parentRect = parentButton.getBoundingClientRect();
        const position = config.position || 'below';
        
        if (position === 'below') {
            toolbar.style.top = `${parentRect.bottom + 5}px`;
            toolbar.style.left = `${parentRect.left}px`;
        } else if (position === 'right') {
            toolbar.style.top = `${parentRect.top}px`;
            toolbar.style.left = `${parentRect.right + 5}px`;
        }

        // Add to document
        document.body.appendChild(toolbar);

        // Attach click handlers
        toolbar.querySelectorAll('.nested-toolbar-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = item.dataset.action;
                const id = item.dataset.id;
                
                // Highlight selected item
                toolbar.querySelectorAll('.nested-toolbar-item').forEach(i => {
                    i.classList.remove('active');
                });
                item.classList.add('active');

                // Execute action
                if (config.onItemClick) {
                    config.onItemClick(action, id, item);
                }
                
                // Dispatch event
                window.dispatchEvent(new CustomEvent('nestedToolbarItemClick', {
                    detail: { parentButtonId, action, id, item }
                }));
            });
        });

        // Store reference
        this.activeToolbars.set(parentButtonId, toolbar);

        // Add click outside handler
        setTimeout(() => {
            document.removeEventListener('click', this.boundOutsideClickHandler, true);
            document.addEventListener('click', this.boundOutsideClickHandler, true);
        }, 0);
    }

    /**
     * Hide a specific toolbar
     * @param {string} parentButtonId - ID of the parent button
     */
    hideToolbar(parentButtonId) {
        const toolbar = this.activeToolbars.get(parentButtonId);
        if (toolbar) {
            toolbar.remove();
            this.activeToolbars.delete(parentButtonId);
        }
    }

    /**
     * Hide all toolbars in a section
     * @param {string} section - Section name
     */
    hideToolbarsInSection(section) {
        if (!section) return;

        this.activeToolbars.forEach((toolbar, parentId) => {
            if (toolbar.dataset.section === section) {
                this.hideToolbar(parentId);
            }
        });
    }

    /**
     * Hide all toolbars
     */
    hideAllToolbars() {
        this.activeToolbars.forEach((toolbar, parentId) => {
            this.hideToolbar(parentId);
        });
        document.removeEventListener('click', this.boundOutsideClickHandler, true);
    }

    /**
     * Handle clicks outside toolbars
     */
    handleOutsideClick(event) {
        let clickedInsideToolbar = false;
        
        this.activeToolbars.forEach(toolbar => {
            if (toolbar.contains(event.target)) {
                clickedInsideToolbar = true;
            }
        });

        // Check if clicked on a parent button
        const parentButtons = document.querySelectorAll('[data-nested-toolbar]');
        parentButtons.forEach(btn => {
            if (btn.contains(event.target)) {
                clickedInsideToolbar = true;
            }
        });

        if (!clickedInsideToolbar) {
            this.hideAllToolbars();
        }
    }

    /**
     * Set current section (for show/hide control)
     * @param {string} section - Section name
     */
    setSection(section) {
        if (this.currentSection === section) return;
        
        const oldSection = this.currentSection;
        this.currentSection = section;

        // Hide toolbars from old section
        this.hideToolbarsInSection(oldSection);

        // Dispatch event
        window.dispatchEvent(new CustomEvent('sectionChanged', {
            detail: { oldSection, newSection: section }
        }));
    }

    /**
     * Toggle toolbar visibility
     * @param {string} parentButtonId - ID of the parent button
     * @param {HTMLElement} parentButton - The parent button element
     */
    toggleToolbar(parentButtonId, parentButton) {
        const toolbar = this.activeToolbars.get(parentButtonId);
        if (toolbar) {
            this.hideToolbar(parentButtonId);
        } else {
            this.showToolbar(parentButtonId, parentButton);
        }
    }
}

// Initialize singleton
if (typeof window !== 'undefined') {
    window.nestedToolbarManager = new NestedToolbarManager();
}
