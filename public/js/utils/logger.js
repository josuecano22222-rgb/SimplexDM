/**
 * Logger
 * Centralized logging system with levels and production mode support
 * Replaces console.log with structured logging
 */

class Logger {
    constructor() {
        this.level = 'info'; // 'debug', 'info', 'warn', 'error'
        this.enableConsole = true;
        this.enableProductionLogging = false;
        this.logHistory = [];
        this.maxHistorySize = 500; // Increased for better debugging
        // Packaged Electron loads from http://127.0.0.1 — still production unless dev mode.
        const electronDev = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.isDev === true;
        const host = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
        const isLocalHost = host === 'localhost' || host === '127.0.0.1';
        this.isProduction = electronDev
            ? false
            : (typeof window !== 'undefined' && window.electronAPI
                ? true
                : !isLocalHost);
        this.performanceTimings = new Map(); // Track performance metrics
        this.moduleLoggers = new Map(); // Module-specific loggers
        this.errorCounts = new Map(); // Track error frequencies
    }

    /**
     * Set log level
     * @param {string} level - Log level: 'debug', 'info', 'warn', 'error'
     */
    setLevel(level) {
        const validLevels = ['debug', 'info', 'warn', 'error'];
        if (validLevels.includes(level)) {
            this.level = level;
        }
    }

    /**
     * Enable/disable console logging
     * @param {boolean} enabled - Whether to enable console logging
     */
    setConsoleEnabled(enabled) {
        this.enableConsole = enabled;
    }

    /**
     * Enable/disable production logging
     * @param {boolean} enabled - Whether to log in production
     */
    setProductionLogging(enabled) {
        this.enableProductionLogging = enabled;
    }

    /**
     * Log debug message
     */
    debug(...args) {
        this._log('debug', args);
    }

    /**
     * Log info message
     */
    info(...args) {
        this._log('info', args);
    }

    /**
     * Log warning message
     */
    warn(...args) {
        this._log('warn', args);
    }

    /**
     * Log error message
     */
    error(...args) {
        this._log('error', args);
    }

    /**
     * Internal log method
     * @private
     */
    _log(level, args) {
        // Check if we should log this level
        if (!this._shouldLog(level)) {
            return;
        }

        // Create log entry
        const entry = {
            level,
            message: args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' '),
            timestamp: Date.now(),
            stack: level === 'error' ? new Error().stack : undefined
        };

        // Add to history
        this.logHistory.push(entry);
        if (this.logHistory.length > this.maxHistorySize) {
            this.logHistory.shift();
        }

        // Console logging
        if (this.enableConsole && (!this.isProduction || this.enableProductionLogging)) {
            const consoleMethod = console[level] || console.log;
            consoleMethod(`[${level.toUpperCase()}]`, ...args);
        }
    }

    /**
     * Check if we should log this level
     * @private
     */
    _shouldLog(level) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const currentLevel = levels[this.level] || 1;
        const messageLevel = levels[level] || 1;
        return messageLevel >= currentLevel;
    }

    /**
     * Get log history
     * @param {string} level - Filter by level (optional)
     * @param {number} limit - Maximum number of entries
     * @returns {Array} Log entries
     */
    getHistory(level = null, limit = null) {
        let entries = [...this.logHistory];
        
        if (level) {
            entries = entries.filter(entry => entry.level === level);
        }

        if (limit) {
            entries = entries.slice(-limit);
        }

        return entries;
    }

    /**
     * Clear log history
     */
    clearHistory() {
        this.logHistory = [];
    }

    /**
     * Export logs as JSON
     * @returns {string} JSON string
     */
    exportLogs() {
        return JSON.stringify(this.logHistory, null, 2);
    }

    /**
     * Start performance timing
     * @param {string} label - Timing label
     * @returns {string} Timing ID
     */
    startTiming(label) {
        const id = `timing_${Date.now()}_${Math.random()}`;
        this.performanceTimings.set(id, {
            label,
            start: performance.now()
        });
        return id;
    }

    /**
     * End performance timing and log
     * @param {string} id - Timing ID
     * @param {string} level - Log level (default: 'debug')
     */
    endTiming(id, level = 'debug') {
        const timing = this.performanceTimings.get(id);
        if (!timing) {
            this.warn(`Timing ${id} not found`);
            return;
        }

        const duration = performance.now() - timing.start;
        this.performanceTimings.delete(id);
        
        this._log(level, [`[PERF] ${timing.label}: ${duration.toFixed(2)}ms`]);
        return duration;
    }

    /**
     * Get module-specific logger
     * @param {string} moduleName - Module name
     * @returns {Object} Module logger with prefixed methods
     */
    getModuleLogger(moduleName) {
        if (!this.moduleLoggers.has(moduleName)) {
            const moduleLogger = {
                debug: (...args) => this._log('debug', [`[${moduleName}]`, ...args]),
                info: (...args) => this._log('info', [`[${moduleName}]`, ...args]),
                warn: (...args) => this._log('warn', [`[${moduleName}]`, ...args]),
                error: (...args) => {
                    // Track error frequency
                    const errorKey = `${moduleName}:${args[0]}`;
                    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
                    this._log('error', [`[${moduleName}]`, ...args]);
                },
                timing: (label) => this.startTiming(`${moduleName}:${label}`),
                endTiming: (id, level) => this.endTiming(id, level)
            };
            this.moduleLoggers.set(moduleName, moduleLogger);
        }
        return this.moduleLoggers.get(moduleName);
    }

    /**
     * Log error with context
     * @param {Error} error - Error object
     * @param {Object} context - Additional context
     * @param {string} module - Module name
     */
    logError(error, context = {}, module = 'Unknown') {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            name: error.name,
            context: context,
            module: module,
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };

        // Track error frequency
        const errorKey = `${module}:${error.message}`;
        this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

        this._log('error', [`[${module}] Error:`, errorInfo]);

        // In production, could send to error tracking service
        if (this.isProduction && this.enableProductionLogging) {
            // Could send to Sentry, LogRocket, etc.
            this.sendToErrorService(errorInfo);
        }
    }

    /**
     * Send error to external error tracking service
     * @private
     */
    sendToErrorService(errorInfo) {
        // Placeholder for error tracking service integration
        // Example: Sentry, LogRocket, etc.
        console.warn('Error tracking service not configured');
    }

    /**
     * Get error statistics
     * @returns {Object} Error statistics
     */
    getErrorStats() {
        const stats = {
            totalErrors: 0,
            uniqueErrors: this.errorCounts.size,
            errorFrequency: {},
            recentErrors: this.getHistory('error', 10)
        };

        this.errorCounts.forEach((count, key) => {
            stats.totalErrors += count;
            stats.errorFrequency[key] = count;
        });

        return stats;
    }

    /**
     * Get performance statistics
     * @returns {Object} Performance statistics
     */
    getPerformanceStats() {
        const timings = Array.from(this.performanceTimings.values());
        return {
            activeTimings: timings.length,
            timings: timings.map(t => ({
                label: t.label,
                duration: performance.now() - t.start
            }))
        };
    }

    /**
     * Clear all logs and statistics
     */
    clearAll() {
        this.logHistory = [];
        this.performanceTimings.clear();
        this.errorCounts.clear();
    }
}

// Export singleton instance
if (typeof window !== 'undefined') {
    window.logger = window.logger || new Logger();
    
    // Set default level based on environment
    if (window.logger.isProduction) {
        window.logger.setLevel('warn'); // Only warnings and errors in production
        window.logger.setProductionLogging(false);
    } else {
        window.logger.setLevel('debug'); // All logs in development
    }
}
