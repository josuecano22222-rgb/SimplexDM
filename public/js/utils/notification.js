/**
 * Notification
 * Handles user notifications (toast, modal, alerts)
 */

function _notice(key) {
    if (typeof window !== 'undefined' && window.appI18n && typeof window.appI18n.t === 'function') {
        const v = window.appI18n.t('ui.notice.' + key);
        if (v && v !== 'ui.notice.' + key) return v;
    }
    const fallbacks = {
        close: 'Close',
        ok: 'OK',
        cancel: 'Cancel',
        alertTitle: 'Alert',
        confirmTitle: 'Confirm',
        proInfo: 'PRO'
    };
    return fallbacks[key] || key;
}

class Notification {
    constructor() {
        this.notifications = [];
        this.container = null;
        this.init();
    }

    /**
     * Initialize notification container
     */
    init() {
        // Create notification container if it doesn't exist
        if (!document.getElementById('notificationContainer')) {
            this.container = document.createElement('div');
            this.container.id = 'notificationContainer';
            this.container.className = 'notification-container';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('notificationContainer');
        }
    }

    /**
     * Show toast notification
     */
    toast(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification toast notification-${type}`;
        notification.textContent = message;
        
        // Add icon based on type
        const icon = this.getIcon(type);
        if (icon) {
            notification.innerHTML = `${icon} ${message}`;
        }
        
        this.container.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after duration
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);
        
        return notification;
    }

    /**
     * Show success notification
     */
    success(message, duration = 3000) {
        return this.toast(message, 'success', duration);
    }

    /**
     * Show error notification
     */
    error(message, duration = 5000) {
        return this.toast(message, 'error', duration);
    }

    /**
     * Show warning notification
     */
    warning(message, duration = 4000) {
        return this.toast(message, 'warning', duration);
    }

    /**
     * Show info notification
     */
    info(message, duration = 3000) {
        return this.toast(message, 'info', duration);
    }

    /**
     * Show modal dialog
     */
    modal(title, message, options = {}) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'notification-modal';
            const closeLbl = _notice('close');
            const okLbl = _notice('ok');
            modal.innerHTML = `
                <div class="notification-modal-content">
                    <div class="notification-modal-header">
                        <h3>${title}</h3>
                        ${options.closable !== false ? `<button type="button" class="notification-modal-close" data-action="close" aria-label="${closeLbl.replace(/"/g, '&quot;')}">×</button>` : ''}
                    </div>
                    <div class="notification-modal-body">
                        ${message}
                    </div>
                    <div class="notification-modal-footer">
                        ${options.buttons ? options.buttons.map(btn => 
                            `<button type="button" class="btn ${btn.class || ''}" data-action="${btn.action}">${btn.label}</button>`
                        ).join('') : `<button type="button" class="btn btn-primary" data-action="ok">${okLbl}</button>`}
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);

            if (typeof options.onMount === 'function') {
                try {
                    options.onMount(modal);
                } catch (e) {
                    console.warn('notification.modal onMount:', e);
                }
            }

            let settled = false;
            const onEscape = (e) => {
                if (e.key !== 'Escape' || options.closable === false) return;
                finish('close');
            };

            /** Resolve first so callers can read inputs; remove overlay on the next microtask. */
            const finish = (action) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onEscape);
                resolve(action);
                queueMicrotask(() => {
                    if (modal.parentNode) modal.parentNode.removeChild(modal);
                });
            };

            document.addEventListener('keydown', onEscape);

            if (options.closable !== false) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) finish('close');
                });
            }

            modal.querySelectorAll('.notification-modal-footer button[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.currentTarget.dataset.action;
                    finish(action);
                });
            });

            const closeBtn = modal.querySelector('.notification-modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => finish('close'));
            }
        });
    }

    /**
     * Show alert (blocking)
     */
    alert(message, title) {
        return this.modal(title != null ? title : _notice('alertTitle'), message, {
            buttons: [{ label: _notice('ok'), action: 'ok', class: 'btn-primary' }],
            closable: false
        });
    }

    /**
     * Show confirm dialog
     */
    confirm(message, title) {
        return this.modal(title != null ? title : _notice('confirmTitle'), message, {
            buttons: [
                { label: _notice('cancel'), action: 'cancel', class: 'btn' },
                { label: _notice('ok'), action: 'ok', class: 'btn-primary' }
            ],
            closable: true
        });
    }

    /**
     * Get icon for notification type
     */
    getIcon(type) {
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        return icons[type] || '';
    }
}

// Toast & modal visuals live in public/css/main.css (.notification-container, .notification-modal, …)

// Export singleton instance
window.notification = new Notification();
