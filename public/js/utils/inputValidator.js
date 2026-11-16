/**
 * InputValidator
 * Centralized input validation utilities
 * Provides validation functions for common input types
 */

class InputValidator {
    constructor() {
        this.validationRules = new Map();
        this.setupDefaultRules();
    }

    /**
     * Setup default validation rules
     */
    setupDefaultRules() {
        // URL validation
        this.validationRules.set('url', {
            pattern: /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i,
            message: 'Please enter a valid URL'
        });

        // File path validation (Windows and Unix)
        this.validationRules.set('filePath', {
            pattern: /^([a-zA-Z]:)?([\\\/]?[a-zA-Z0-9_.-]+)+[\\\/]?$/,
            message: 'Please enter a valid file path'
        });

        // JSON file path
        this.validationRules.set('jsonPath', {
            pattern: /^([a-zA-Z]:)?([\\\/]?[a-zA-Z0-9_.-]+)+\.json$/i,
            message: 'Please enter a valid JSON file path'
        });

        // Coordinate validation (longitude)
        this.validationRules.set('longitude', {
            validate: (value) => {
                const num = parseFloat(value);
                return !isNaN(num) && num >= -180 && num <= 180;
            },
            message: 'Longitude must be between -180 and 180'
        });

        // Coordinate validation (latitude)
        this.validationRules.set('latitude', {
            validate: (value) => {
                const num = parseFloat(value);
                return !isNaN(num) && num >= -90 && num <= 90;
            },
            message: 'Latitude must be between -90 and 90'
        });

        // Height/elevation validation
        this.validationRules.set('height', {
            validate: (value) => {
                const num = parseFloat(value);
                return !isNaN(num) && num >= -10000 && num <= 10000;
            },
            message: 'Height must be between -10,000 and 10,000 meters'
        });

        // Year validation
        this.validationRules.set('year', {
            validate: (value) => {
                const num = parseInt(value);
                return !isNaN(num) && num >= 1900 && num <= 2100;
            },
            message: 'Year must be between 1900 and 2100'
        });

        // Non-empty string
        this.validationRules.set('required', {
            validate: (value) => {
                return value !== null && value !== undefined && String(value).trim().length > 0;
            },
            message: 'This field is required'
        });

        // Positive number
        this.validationRules.set('positive', {
            validate: (value) => {
                const num = parseFloat(value);
                return !isNaN(num) && num > 0;
            },
            message: 'Must be a positive number'
        });
    }

    /**
     * Validate input value against rule
     * @param {string} value - Value to validate
     * @param {string} ruleName - Rule name
     * @returns {Object} {valid: boolean, message: string}
     */
    validate(value, ruleName) {
        const rule = this.validationRules.get(ruleName);
        if (!rule) {
            return { valid: true, message: '' };
        }

        let valid = false;

        if (rule.pattern) {
            valid = rule.pattern.test(value);
        } else if (rule.validate) {
            valid = rule.validate(value);
        }

        return {
            valid,
            message: valid ? '' : rule.message
        };
    }

    /**
     * Validate multiple rules
     * @param {string} value - Value to validate
     * @param {Array<string>} rules - Array of rule names
     * @returns {Object} {valid: boolean, messages: Array<string>}
     */
    validateMultiple(value, rules) {
        const messages = [];
        let allValid = true;

        for (const ruleName of rules) {
            const result = this.validate(value, ruleName);
            if (!result.valid) {
                allValid = false;
                messages.push(result.message);
            }
        }

        return {
            valid: allValid,
            messages
        };
    }

    /**
     * Sanitize string input (prevent XSS)
     * @param {string} input - Input string
     * @returns {string} Sanitized string
     */
    sanitizeString(input) {
        if (typeof input !== 'string') {
            return String(input);
        }

        // Remove potentially dangerous characters
        return input
            .replace(/[<>]/g, '') // Remove < and >
            .replace(/javascript:/gi, '') // Remove javascript: protocol
            .replace(/on\w+=/gi, '') // Remove event handlers
            .trim();
    }

    /**
     * Validate and sanitize URL
     * @param {string} url - URL to validate
     * @returns {Object} {valid: boolean, sanitized: string, message: string}
     */
    validateAndSanitizeUrl(url) {
        if (!url || typeof url !== 'string') {
            return { valid: false, sanitized: '', message: 'URL is required' };
        }

        const sanitized = url.trim();
        const result = this.validate(sanitized, 'url');

        // Also check for file:// protocol (allowed for local files)
        if (!result.valid && !sanitized.startsWith('file://') && !sanitized.startsWith('http://') && !sanitized.startsWith('https://')) {
            // Might be a file path, check that
            const pathResult = this.validate(sanitized, 'filePath');
            if (pathResult.valid) {
                return { valid: true, sanitized, message: '' };
            }
        }

        return {
            valid: result.valid || sanitized.startsWith('file://'),
            sanitized,
            message: result.message
        };
    }

    /**
     * Validate file path
     * @param {string} path - File path
     * @returns {Object} {valid: boolean, message: string}
     */
    validateFilePath(path) {
        if (!path || typeof path !== 'string') {
            return { valid: false, message: 'File path is required' };
        }

        const trimmed = path.trim();
        if (trimmed.length === 0) {
            return { valid: false, message: 'File path cannot be empty' };
        }

        // Check for path traversal attempts
        if (trimmed.includes('..') || trimmed.includes('//')) {
            return { valid: false, message: 'Invalid file path: path traversal not allowed' };
        }

        return { valid: true, message: '' };
    }

    /**
     * Validate coordinates
     * @param {number} lon - Longitude
     * @param {number} lat - Latitude
     * @param {number} height - Height (optional)
     * @returns {Object} {valid: boolean, messages: Array<string>}
     */
    validateCoordinates(lon, lat, height = null) {
        const messages = [];
        let valid = true;

        const lonResult = this.validate(lon, 'longitude');
        if (!lonResult.valid) {
            valid = false;
            messages.push(`Longitude: ${lonResult.message}`);
        }

        const latResult = this.validate(lat, 'latitude');
        if (!latResult.valid) {
            valid = false;
            messages.push(`Latitude: ${latResult.message}`);
        }

        if (height !== null) {
            const heightResult = this.validate(height, 'height');
            if (!heightResult.valid) {
                valid = false;
                messages.push(`Height: ${heightResult.message}`);
            }
        }

        return { valid, messages };
    }

    /**
     * Add custom validation rule
     * @param {string} name - Rule name
     * @param {Object} rule - Rule object {pattern?: RegExp, validate?: Function, message: string}
     */
    addRule(name, rule) {
        this.validationRules.set(name, rule);
    }

    /**
     * Get validation rule
     * @param {string} name - Rule name
     * @returns {Object|null} Rule object or null
     */
    getRule(name) {
        return this.validationRules.get(name) || null;
    }
}

// Export singleton instance
window.inputValidator = new InputValidator();
