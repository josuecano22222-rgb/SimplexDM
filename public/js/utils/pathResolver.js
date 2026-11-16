/**
 * PathResolver
 * Resolves and normalizes Windows paths, POSIX paths, relative paths, and HTTP URLs
 * for 3D Tiles and offline geospatial assets.
 */

const UNIX_FS_PREFIXES = [
    '/home/',
    '/Users/',
    '/var/',
    '/tmp/',
    '/private/',
    '/opt/',
    '/mnt/',
    '/media/',
    '/Volumes/',
    '/srv/',
    '/run/',
    '/root/',
];

class PathResolver {
    constructor() {
        this.baseUrl = null;
        this.fileHandleRegistry = null;
    }

    async init(fileHandleRegistry) {
        this.fileHandleRegistry = fileHandleRegistry;

        const hasHttpOrigin =
            typeof window !== 'undefined' &&
            typeof window.location?.origin === 'string' &&
            /^https?:\/\//i.test(window.location.origin);

        if (
            window.electronAPI?.isElectron === true &&
            typeof window.electronAPI.getServerPort === 'function'
        ) {
            try {
                const rawPort = await window.electronAPI.getServerPort();
                const portNum = Number(rawPort);
                const port =
                    Number.isFinite(portNum) && portNum > 0
                        ? portNum
                        : parseInt(window.location.port, 10) || 8000;
                this.baseUrl = `http://localhost:${port}`;
            } catch (_) {
                this.baseUrl = hasHttpOrigin ? window.location.origin : '';
            }
        } else {
            this.baseUrl = hasHttpOrigin ? window.location.origin : '';
        }
    }

    /**
     * Normalize filesystem/relative path separators while keeping URL schemes intact.
     */
    normalizePath(inputPath) {
        if (!inputPath || typeof inputPath !== 'string') return inputPath;
        if (this.isHttpUrl(inputPath) || inputPath.startsWith('blob:') || inputPath.startsWith('data:')) {
            return inputPath;
        }

        // Preserve UNC prefix `\\server\share`
        const isUnc = inputPath.startsWith('\\\\');
        let p = inputPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        if (isUnc) {
            p = '//' + p.replace(/^\/+/, '');
        }
        return p;
    }

    isWindowsPath(inputPath) {
        return (
            typeof inputPath === 'string' &&
            (/^[A-Za-z]:/.test(inputPath) || inputPath.startsWith('\\\\') || inputPath.startsWith('//'))
        );
    }

    isUnixFilesystemPath(inputPath) {
        if (typeof inputPath !== 'string' || !inputPath.startsWith('/')) return false;
        return UNIX_FS_PREFIXES.some((prefix) => inputPath.startsWith(prefix));
    }

    isAbsoluteFilesystemPath(inputPath) {
        return this.isWindowsPath(inputPath) || this.isUnixFilesystemPath(inputPath);
    }

    isHttpUrl(inputPath) {
        return typeof inputPath === 'string' && /^https?:\/\//i.test(inputPath);
    }

    isRelativePath(inputPath) {
        if (typeof inputPath !== 'string' || !inputPath) return false;
        return (
            inputPath.startsWith('./') ||
            inputPath.startsWith('../') ||
            (!this.isWindowsPath(inputPath) && !this.isHttpUrl(inputPath) && !inputPath.startsWith('/'))
        );
    }

    /**
     * Join path or URL segments cleanly without corrupting `http://`, `C:/`, or leading `/`.
     */
    join(...segments) {
        const filtered = segments.filter((s) => typeof s === 'string' && s.length > 0);
        if (filtered.length === 0) return '';
        const first = filtered[0];

        if (this.isHttpUrl(first)) {
            let base = first.endsWith('/') ? first : `${first}/`;
            for (let i = 1; i < filtered.length; i++) {
                const seg = filtered[i].replace(/\\/g, '/').replace(/^\/+/, '');
                base = new URL(seg, base.endsWith('/') ? base : `${base}/`).toString();
            }
            return base;
        }

        const leadingSlash = first.startsWith('/');
        const joined = filtered
            .map((s, idx) => {
                const norm = s.replace(/\\/g, '/');
                if (idx === 0) return norm.replace(/\/+$/, '');
                return norm.replace(/^\/+|\/+$/g, '');
            })
            .filter(Boolean)
            .join('/');

        return this.resolveDotSegments(leadingSlash && !joined.startsWith('/') ? `/${joined}` : joined);
    }

    resolveDotSegments(p) {
        const driveMatch = /^([A-Za-z]:)(\/.*)?$/.exec(p);
        const prefix = driveMatch ? `${driveMatch[1]}/` : p.startsWith('/') ? '/' : '';
        const rest = driveMatch ? driveMatch[2] || '' : p;
        const out = [];
        for (const seg of rest.split('/')) {
            if (!seg || seg === '.') continue;
            if (seg === '..') {
                if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
                else if (!prefix) out.push('..');
            } else {
                out.push(seg);
            }
        }
        return prefix + out.join('/');
    }

    /**
     * Resolve a relative path against a base URL (including `/file?path=...`), Windows path, or POSIX path.
     */
    resolveRelativePath(relPath, basePath) {
        const base = basePath || (this.baseUrl ? `${this.baseUrl}/` : '');
        const cleanRel = String(relPath || '').replace(/\\/g, '/');

        // Special case: base URL is `/file?path=<absFileOrDir>`
        if (this.isHttpUrl(base)) {
            try {
                const u = new URL(base);
                if (u.pathname === '/file' && u.searchParams.has('path')) {
                    const fsBase = this.normalizePath(u.searchParams.get('path') || '');
                    const fsDir = /\.[a-z0-9]{1,8}$/i.test(fsBase) ? this.getDirectory(fsBase) : fsBase;
                    const combined = this.join(fsDir, cleanRel);
                    return `${u.origin}/file?path=${encodeURIComponent(combined)}`;
                }
                return new URL(cleanRel, base).toString();
            } catch (_) {
                /* fall through */
            }
        }

        const normBase = this.normalizePath(base);
        const baseDir = normBase.endsWith('/') ? normBase.slice(0, -1) : this.getDirectory(normBase);
        const combined = this.join(baseDir, cleanRel);
        if (this.isAbsoluteFilesystemPath(combined) && this.baseUrl) {
            return `${this.baseUrl}/file?path=${encodeURIComponent(combined)}`;
        }
        return combined;
    }

    /**
     * Resolve a filesystem path, relative path, or URL to a fetchable HTTP URL (or `{ type: 'fileHandle' }`).
     */
    async resolvePath(inputPath, basePath = null) {
        if (!inputPath || typeof inputPath !== 'string' || !inputPath.trim()) {
            const error = new Error('Path is required. Please provide a valid file path or URL.');
            error.code = 'PATH_REQUIRED';
            if (window.notification) {
                window.notification.error(
                    window.appI18n?.nt ? window.appI18n.nt('pathRequired') : 'Please provide a file path or URL.'
                );
            }
            throw error;
        }

        const trimmed = inputPath.trim();
        if (!this.baseUrl) {
            this.baseUrl =
                window.location && window.location.origin && window.location.origin !== 'null'
                    ? window.location.origin
                    : 'http://localhost:8000';
        }

        if (this.isHttpUrl(trimmed) || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
            return trimmed;
        }

        const normalized = this.normalizePath(trimmed);

        // Windows drive/UNC path or POSIX absolute filesystem path -> fileHandle or `/file?path=`
        if (this.isAbsoluteFilesystemPath(normalized)) {
            if (this.fileHandleRegistry && typeof this.fileHandleRegistry.getHandle === 'function') {
                const handle = this.fileHandleRegistry.getHandle(normalized);
                if (handle) {
                    return { type: 'fileHandle', path: normalized, handle };
                }
            }
            return `${this.baseUrl}/file?path=${encodeURIComponent(normalized)}`;
        }

        // Explicit relative path (`./` or `../`)
        if (normalized.startsWith('./') || normalized.startsWith('../')) {
            if (basePath) {
                return this.resolveRelativePath(normalized, basePath);
            }
            const cleanRel = normalized.replace(/^(?:\.\.?\/)+/, '');
            return `${this.baseUrl}/data/${cleanRel}`;
        }

        // Web root path (`/data/...`, `/lib/...`, `/file?...`)
        if (normalized.startsWith('/')) {
            return `${this.baseUrl}${normalized}`;
        }

        // Relative path with an explicit basePath
        if (basePath) {
            return this.resolveRelativePath(normalized, basePath);
        }

        // Already prefixed with `data/` -> avoid doubling `/data/data/...`
        if (normalized.toLowerCase().startsWith('data/')) {
            return `${this.baseUrl}/${normalized}`;
        }

        return `${this.baseUrl}/data/${normalized}`;
    }

    getFilename(inputPath) {
        if (!inputPath) return '';
        const normalized = this.normalizePath(String(inputPath));
        const parts = normalized.split('/');
        return parts[parts.length - 1] || normalized;
    }

    getDirectory(inputPath) {
        if (!inputPath) return '';
        const normalized = this.normalizePath(String(inputPath));
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash === -1) return '';
        if (lastSlash === 0) return '/';
        if (/^[A-Za-z]:$/.test(normalized.substring(0, lastSlash))) {
            return normalized.substring(0, lastSlash + 1);
        }
        return normalized.substring(0, lastSlash);
    }

    getTilesetName(url) {
        if (!url || typeof url !== 'string') return '';
        const pickReadable = (parts, fallback) => {
            if (!parts.length) return fallback;
            const last = parts[parts.length - 1];
            if (last.toLowerCase() === 'tileset.json' && parts.length >= 2) {
                return parts[parts.length - 2];
            }
            return last;
        };
        try {
            if (this.isHttpUrl(url)) {
                const parsed = new URL(url);
                const pathParam = parsed.searchParams.get('path');
                if (pathParam) {
                    const norm = this.normalizePath(pathParam);
                    return pickReadable(norm.split('/').filter(Boolean), pathParam);
                }
                const parts = parsed.pathname.split('/').filter(Boolean);
                return pickReadable(parts, url);
            }
        } catch (_) {
            /* fallback */
        }
        const cleanUrl = this.normalizePath(url.split('?')[0].split('#')[0]);
        const parts = cleanUrl.split('/').filter(Boolean);
        return parts[parts.length - 1] || url;
    }
}

window.PathResolver = PathResolver;
window.pathResolver = new PathResolver();
