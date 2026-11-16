/**
 * PathResolver
 * Handles path resolution and normalization for various path formats
 */

class PathResolver {
    constructor() {
        this.baseUrl = null;
        this.fileHandleRegistry = null;
    }

    /**
     * Initialize with dependencies
     */
    async init(fileHandleRegistry) {
        this.fileHandleRegistry = fileHandleRegistry;
        
        // Get server port from electron API or detect from current URL
        if (window.electronAPI) {
            try {
                const rawPort = await window.electronAPI.getServerPort();
                const portNum = Number(rawPort);
                const port =
                    Number.isFinite(portNum) && portNum > 0
                        ? portNum
                        : parseInt(window.location.port, 10) || 8000;
                this.baseUrl = `http://localhost:${port}`;
            } catch (e) {
                // Fallback: use current origin (works for both localhost and web)
                this.baseUrl = window.location.origin;
            }
        } else {
            // Web mode: use current origin (works for localhost, IP addresses, and domains)
            this.baseUrl = window.location.origin;
        }
        
        console.log('PathResolver initialized with baseUrl:', this.baseUrl);
    }

    /**
     * Normalize path (convert backslashes to forward slashes)
     */
    normalizePath(path) {
        if (!path) return path;
        
        // Convert backslashes to forward slashes
        path = path.replace(/\\/g, '/');
        
        // Remove duplicate slashes
        path = path.replace(/\/+/g, '/');
        
        // Handle Windows drive letters
        const driveMatch = path.match(/^([A-Za-z]:)/);
        if (driveMatch) {
            return driveMatch[1] + path.substring(2);
        }
        
        return path;
    }

    /**
     * Check if path is a Windows absolute path
     */
    isWindowsPath(path) {
        return /^[A-Za-z]:/.test(path);
    }

    /**
     * Check if path is an HTTP URL
     */
    isHttpUrl(path) {
        return /^https?:\/\//.test(path);
    }

    /**
     * Check if path is relative
     */
    isRelativePath(path) {
        return path.startsWith('./') || path.startsWith('../') || 
               (!this.isWindowsPath(path) && !this.isHttpUrl(path) && !path.startsWith('/'));
    }

    /**
     * Resolve relative path against base URL
     */
    resolveRelativePath(path, basePath) {
        if (!basePath) {
            basePath = this.baseUrl;
        }
        
        // If basePath is a file, get its directory
        if (basePath.includes('/') && !basePath.endsWith('/')) {
            const lastSlash = basePath.lastIndexOf('/');
            basePath = basePath.substring(0, lastSlash + 1);
        }
        
        // Resolve relative path
        const parts = basePath.split('/').filter(p => p);
        const pathParts = path.split('/').filter(p => p);
        
        for (const part of pathParts) {
            if (part === '.') {
                continue;
            } else if (part === '..') {
                parts.pop();
            } else {
                parts.push(part);
            }
        }
        
        return parts.join('/');
    }

    /**
     * Resolve path to usable URL
     */
    async resolvePath(path, basePath = null) {
        if (!path) {
            const error = new Error('Path is required. Please provide a valid file path or URL.');
            error.code = 'PATH_REQUIRED';
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('pathRequired') : 'Please provide a file path or URL.'
                );
            }
            throw error;
        }
        
        // Ensure baseUrl is initialized
        if (!this.baseUrl) {
            // Try to initialize on the fly if not already done
            this.baseUrl = window.location.origin;
            console.warn('PathResolver.resolvePath called before init(), using current origin:', this.baseUrl);
        }
        
        // If it's already an HTTP URL, return as-is (before normalization)
        if (this.isHttpUrl(path)) {
            return path;
        }
        
        // Normalize path (only for non-HTTP paths)
        path = this.normalizePath(path);
        
        // If it's a Windows path, check for file handle first
        if (this.isWindowsPath(path)) {
            if (this.fileHandleRegistry) {
                const handle = this.fileHandleRegistry.getHandle(path);
                if (handle) {
                    // Return a special marker that indicates file handle usage
                    return { type: 'fileHandle', path, handle };
                }
            }
            
            // For Windows paths, always use /file endpoint to serve arbitrary file paths
            // This ensures external files (outside app directory) are properly served
            // Encode the path to handle special characters and spaces
            const encodedPath = encodeURIComponent(path);
            return `${this.baseUrl}/file?path=${encodedPath}`;
        }
        
        // If it's a relative path (starts with ./ or ../)
        if (path.startsWith('./') || path.startsWith('../')) {
            if (basePath) {
                return this.resolveRelativePath(path, basePath);
            } else {
                // Remove leading ./ or ../
                const cleanPath = path.replace(/^\.\.?\//, '');
                return `${this.baseUrl}/data/${cleanPath}`;
            }
        }
        
        // If it doesn't start with / and isn't Windows path, treat as relative to data
        if (!path.startsWith('/') && !this.isWindowsPath(path)) {
            return `${this.baseUrl}/data/${path}`;
        }
        
        // If it starts with /, treat as absolute from server root
        if (path.startsWith('/')) {
            return `${this.baseUrl}${path}`;
        }
        
        // Default: treat as relative to data directory
        return `${this.baseUrl}/data/${path}`;
    }

    /**
     * Extract filename from path
     */
    getFilename(path) {
        const normalized = this.normalizePath(path);
        const parts = normalized.split('/');
        return parts[parts.length - 1] || path;
    }

    /**
     * Extract directory from path
     */
    getDirectory(path) {
        const normalized = this.normalizePath(path);
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash === -1) return '';
        return normalized.substring(0, lastSlash);
    }

    /**
     * Get tileset name from URL (extracts filename, handles query parameters)
     * @param {string} url - URL or path to extract name from
     * @returns {string} Tileset name
     */
    getTilesetName(url) {
        if (!url) return '';
        
        // Remove query parameters and hash
        const cleanUrl = url.split('?')[0].split('#')[0];
        
        // Extract filename from path
        const parts = cleanUrl.split('/');
        return parts[parts.length - 1] || url;
    }
}

// Export singleton instance
window.pathResolver = new PathResolver();
