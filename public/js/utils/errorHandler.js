/**
 * ErrorHandler
 * Centralized error handling and recovery system
 * Provides consistent error handling, logging, and user feedback
 */

class ErrorHandler {
    constructor() {
        this.errorCallbacks = new Set();
        this.errorHistory = [];
        this.maxHistorySize = 100;
        this.suppressConsoleInProduction = false;
    }

    /**
     * Handle an error with context
     * @param {Error|string} error - Error object or error message
     * @param {Object} context - Context information (component, action, etc.)
     * @param {boolean} showNotification - Whether to show user notification
     * @returns {Object} Error info object
     */
    handle(error, context = {}, showNotification = true) {
        const errorInfo = this._createErrorInfo(error, context);
        
        // Add to history
        this.errorHistory.push(errorInfo);
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }

        // Log error
        this._logError(errorInfo);

        // Show user notification if requested
        if (showNotification && window.notification) {
            const userMessage = this._getUserFriendlyMessage(errorInfo);
            window.notification.error(userMessage);
        }

        // Notify error callbacks
        this._notifyCallbacks(errorInfo);

        return errorInfo;
    }

    /**
     * Handle async operation with automatic error handling
     * @param {Function} asyncFn - Async function to execute
     * @param {Object} context - Context information
     * @param {Object} options - Options {showNotification, onError, retry}
     * @returns {Promise} Promise that resolves with result or rejects with handled error
     */
    async handleAsync(asyncFn, context = {}, options = {}) {
        const {
            showNotification = true,
            onError = null,
            retry = { enabled: false, maxAttempts: 3, delay: 1000 }
        } = options;

        let attempts = 0;
        const maxAttempts = retry.enabled ? retry.maxAttempts : 1;

        while (attempts < maxAttempts) {
            try {
                const result = await asyncFn();
                return result;
            } catch (error) {
                attempts++;
                const errorInfo = this.handle(error, context, showNotification && attempts >= maxAttempts);

                // Call custom error handler if provided
                if (onError) {
                    try {
                        await onError(errorInfo, attempts);
                    } catch (handlerError) {
                        console.error('Error in custom error handler:', handlerError);
                    }
                }

                // Retry logic
                if (attempts < maxAttempts && retry.enabled) {
                    await this._delay(retry.delay * attempts); // Exponential backoff
                    continue;
                }

                // All retries exhausted or retry disabled
                throw errorInfo;
            }
        }
    }

    /**
     * Register error callback
     * @param {Function} callback - Callback function(errorInfo)
     * @returns {Function} Unregister function
     */
    onError(callback) {
        if (typeof callback !== 'function') {
            console.warn('ErrorHandler.onError: Callback must be a function');
            return () => {};
        }

        this.errorCallbacks.add(callback);
        return () => this.errorCallbacks.delete(callback);
    }

    /**
     * Get error history
     * @param {number} limit - Maximum number of errors to return
     * @returns {Array} Array of error info objects
     */
    getHistory(limit = null) {
        if (limit === null) {
            return [...this.errorHistory];
        }
        return this.errorHistory.slice(-limit);
    }

    /**
     * Clear error history
     */
    clearHistory() {
        this.errorHistory = [];
    }

    /**
     * Create error info object
     * @private
     */
    _createErrorInfo(error, context) {
        let errorObj;
        if (error instanceof Error) {
            errorObj = error;
        } else if (error && typeof error === 'object' && typeof error.message === 'string') {
            // handleAsync rethrows errorInfo objects: { message, error, context, stack, ... }
            errorObj = error.error instanceof Error ? error.error : new Error(error.message);
            if (error.stack && !errorObj.stack) errorObj.stack = error.stack;
        } else {
            errorObj = new Error(
                typeof error === 'string' ? error : JSON.stringify(error)
            );
        }
        const stack = errorObj.stack || 'No stack trace available';

        return {
            error: errorObj,
            message: errorObj.message,
            stack,
            timestamp: Date.now(),
            context: {
                component: context.component || 'Unknown',
                action: context.action || 'Unknown',
                ...context
            },
            userAgent: navigator.userAgent,
            url: window.location.href
        };
    }

    /**
     * Log error
     * @private
     */
    _logError(errorInfo) {
        // Use logger if available
        if (window.logger) {
            window.logger.logError(
                errorInfo.error,
                errorInfo.context,
                errorInfo.context.component || 'Unknown'
            );
        } else {
            // Fallback to console
            if (this.suppressConsoleInProduction && window.location.hostname !== 'localhost') {
                return; // Don't log in production
            }

            console.error('Error:', {
                message: errorInfo.message,
                context: errorInfo.context,
                stack: errorInfo.stack
            });
        }
    }

    /**
     * Get user-friendly error message
     * @private
     */
    _getUserFriendlyMessage(errorInfo) {
        const { message, context } = errorInfo;

        // Map common errors to user-friendly messages
        const errorMessages = {
            'NetworkError': 'Network connection failed. Please check your internet connection.',
            'Failed to fetch': 'Unable to connect to server. Please try again.',
            'Viewer not initialized': '3D viewer is not ready. Please wait a moment.',
            'File handle not found': 'File not found. Please select a valid file.',
            'CesiumJS loading timeout': '3D engine failed to load. Please refresh the page.',
            'ENOENT': 'File not found. Please check the file path.',
            'EACCES': 'Permission denied. Please check file permissions.',
            'timeout': 'Operation timed out. Please try again.',
            'aborted': 'Operation was cancelled.',
            'TypeError': 'Invalid operation. Please try again.',
            'ReferenceError': 'Application error. Please refresh the page.'
        };

        // Check for known error patterns
        for (const [pattern, friendlyMessage] of Object.entries(errorMessages)) {
            if (message.includes(pattern) || errorInfo.error?.name === pattern) {
                return friendlyMessage;
            }
        }

        // Default message
        return context.action 
            ? `${context.action} failed: ${message}`
            : `An error occurred: ${message}`;
    }

    /**
     * Get error statistics
     * @returns {Object} Error statistics
     */
    getErrorStats() {
        const stats = {
            totalErrors: this.errorHistory.length,
            errorsByComponent: {},
            errorsByAction: {},
            recentErrors: this.getHistory(10)
        };

        this.errorHistory.forEach(errorInfo => {
            const component = errorInfo.context.component || 'Unknown';
            const action = errorInfo.context.action || 'Unknown';
            
            stats.errorsByComponent[component] = (stats.errorsByComponent[component] || 0) + 1;
            stats.errorsByAction[action] = (stats.errorsByAction[action] || 0) + 1;
        });

        return stats;
    }

    /**
     * Notify error callbacks
     * @private
     */
    _notifyCallbacks(errorInfo) {
        for (const callback of this.errorCallbacks) {
            try {
                callback(errorInfo);
            } catch (error) {
                console.error('Error in error callback:', error);
            }
        }
    }

    /**
     * Delay helper for retries
     * @private
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
if (typeof window !== 'undefined') {
    window.errorHandler = window.errorHandler || new ErrorHandler();
}
