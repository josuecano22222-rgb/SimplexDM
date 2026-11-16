/**
 * SearchManager
 * Enhanced search functionality (Meridian Design - Page 9)
 * Supports: Address, place name, business name, coordinates (ITM/GEO), block/parcel
 */

/** On-screen labels (~sub-mm at equator; matches high-precision GIS expectations). */
const SEARCH_COORD_DISPLAY_DP = 12;
/** Clipboard round-trip (same order as coordinateManager: lat, lon). */
const SEARCH_COORD_COPY_DP = 12;

class SearchManager {
    constructor() {
        this.tilesetViewer = null;
        this.searchModal = null;
        this.currentCity = null;
        this.searchResults = [];
        this._resultCardHideTimer = null;
        this.isSearching = false;
        this.boundDocumentClickHandler = this.handleDocumentClick.bind(this);
        this.init();
    }

    /**
     * Initialize search manager
     */
    init() {
        this.tilesetViewer = window.tilesetViewer;
        this.createSearchModal();
        this.setupEventHandlers();
    }

    /**
     * Create search modal overlay
     */
    createSearchModal() {
        // Remove existing if any
        const existing = document.getElementById('searchModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'searchModal';
        modal.className = 'search-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="search-modal-content">
                <div class="search-modal-header">
                    <h2>Search</h2>
                    <button class="close-btn" id="closeSearchBtn">×</button>
                </div>
                <div class="search-modal-body">
                    <div class="search-input-container">
                        <input type="text" 
                               id="searchInput" 
                               class="search-input-large" 
                               placeholder="Search..."
                               autocomplete="off">
                        <button class="search-submit-btn" id="searchSubmitBtn">
                            <span class="search-icon">🔍</span>
                        </button>
                    </div>
                    <div id="searchStatus" class="tool-status ready">Ready</div>
                    <div id="searchLoading" class="tool-loading-indicator" style="display: none;">
                        <span class="spinner-sm"></span>
                        <span>Searching...</span>
                    </div>

                    <div id="searchResultCard" style="display: none; margin-top: 10px;"></div>
                    
                    <div class="search-options-section">
                        <h3>Search Options:</h3>
                        <ul class="search-options-list">
                            <li>Address, place name, business name...</li>
                            <li>Location (3D/2D coordinates in Geo or ITM grid)</li>
                            <li>Block/Parcel</li>
                        </ul>
                    </div>

                    <div class="search-tip-section">
                        <strong>Tip:</strong> To search in another city, exit to the main search interface or click on the Models Map.
                    </div>

                    <div class="search-results-container" id="searchResultsContainer" style="display: none;">
                        <h3>Search Results</h3>
                        <div class="search-results-list" id="searchResultsList">
                            <!-- Results will be populated here -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.searchModal = modal;
    }

    hideResultCard() {
        const card = document.getElementById('searchResultCard');
        if (card) {
            card.style.display = 'none';
            card.innerHTML = '';
        }
        if (this._resultCardHideTimer) {
            clearTimeout(this._resultCardHideTimer);
            this._resultCardHideTimer = null;
        }
    }

    showResultCard(result) {
        const card = document.getElementById('searchResultCard');
        if (!card) return;

        const rawName = (result?.data?.display_name || result?.name || 'Result').toString();
        const displayName = rawName.length > 60 ? `${rawName.slice(0, 57)}...` : rawName;
        const lat = result?.coordinates?.lat;
        const lon = result?.coordinates?.lon;

        const displayLat = Number.isFinite(lat) ? lat.toFixed(SEARCH_COORD_DISPLAY_DP) : '--';
        const displayLon = Number.isFinite(lon) ? lon.toFixed(SEARCH_COORD_DISPLAY_DP) : '--';

        card.innerHTML = `
            <div style="
                background: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                padding: 10px 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            ">
                <div style="min-width: 0;">
                    <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${displayName.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                    </div>
                    <div style="font-size: calc(12px * var(--ui-fs-mul, 1)); color: var(--text-secondary); margin-top: 3px;" title="Copy uses full precision (${SEARCH_COORD_COPY_DP} dp) for accurate round-trip">
                        ${displayLat}, ${displayLon}
                    </div>
                </div>
                <button class="btn" id="searchCopyCoordsBtn" style="white-space: nowrap;">Copy coordinates</button>
            </div>
        `;
        card.style.display = 'block';

        document.getElementById('searchCopyCoordsBtn')?.addEventListener('click', async () => {
            const text =
                Number.isFinite(lat) && Number.isFinite(lon)
                    ? `${lat.toFixed(SEARCH_COORD_COPY_DP)}, ${lon.toFixed(SEARCH_COORD_COPY_DP)}`
                    : '';
            if (!text) {
                window.notification?.error('No coordinates to copy');
                return;
            }
            try {
                await navigator.clipboard.writeText(text);
                window.notification?.success('Coordinates copied (high precision)');
            } catch {
                try {
                    const el = document.createElement('textarea');
                    el.value = text;
                    document.body.appendChild(el);
                    el.select();
                    document.execCommand('copy');
                    document.body.removeChild(el);
                    window.notification?.success('Coordinates copied');
                } catch {
                    window.notification?.error('Failed to copy coordinates');
                }
            }
        });

        if (this._resultCardHideTimer) clearTimeout(this._resultCardHideTimer);
        this._resultCardHideTimer = setTimeout(() => this.hideResultCard(), 8000);
    }

    flashCoordinateResearchButton() {
        const btn = document.getElementById('coordinateResearchBtn');
        if (!btn) return;
        const original = btn.style.boxShadow;
        btn.style.boxShadow = '0 0 0 3px rgba(66, 133, 244, 0.65)';
        btn.style.transition = 'box-shadow 0.2s ease';
        setTimeout(() => {
            btn.style.boxShadow = original || '';
        }, 1200);
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Close button
        document.addEventListener('click', this.boundDocumentClickHandler);

        // Search input
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            // Search on Enter
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });

            // Search on button click
            document.getElementById('searchSubmitBtn')?.addEventListener('click', () => {
                this.performSearch();
            });
        }
    }

    handleDocumentClick(e) {
        if (e.target.id === 'closeSearchBtn' || (e.target === this.searchModal)) {
            this.hide();
        }
    }

    setStatus(kind, message) {
        const statusEl = document.getElementById('searchStatus');
        if (!statusEl) return;
        statusEl.className = `tool-status ${kind}`;
        statusEl.textContent = message;
    }

    setLoading(isLoading) {
        this.isSearching = isLoading;
        const loadingEl = document.getElementById('searchLoading');
        const submitBtn = document.getElementById('searchSubmitBtn');
        const input = document.getElementById('searchInput');
        if (loadingEl) loadingEl.style.display = isLoading ? 'flex' : 'none';
        if (submitBtn) submitBtn.disabled = isLoading;
        if (input) input.disabled = isLoading;
    }

    /**
     * Show search modal
     */
    show() {
        if (this.searchModal) {
            this.searchModal.style.display = 'flex';
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
            }
        }
    }

    /**
     * Hide search modal
     */
    hide() {
        if (this.searchModal) {
            this.searchModal.style.display = 'none';
        }
    }

    /**
     * Toggle search modal
     */
    toggle() {
        if (this.searchModal && this.searchModal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Perform search
     */
    async performSearch() {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput || this.isSearching) return;

        const query = searchInput.value.trim();
        if (!query) {
            this.setStatus('error', 'Error: Enter a search query.');
            return;
        }

        this.hideResultCard();
        this.setStatus('loading', 'Loading...');
        this.setLoading(true);

        try {
            // Parse query type
            const queryType = this.detectQueryType(query);
            
            // Perform search based on type
            let results = [];
            let nominatimFailed = false;
            switch (queryType) {
                case 'coordinates':
                    results = await this.searchByCoordinates(query);
                    break;
                case 'block_parcel':
                    results = await this.searchByBlockParcel(query);
                    break;
                case 'address':
                default:
                    {
                        const res = await this.searchByAddress(query);
                        if (Array.isArray(res)) {
                            results = res;
                        } else {
                            results = res.results || [];
                            nominatimFailed = !!res.nominatimFailed;
                        }
                    }
                    break;
            }

            if (!results || results.length === 0) {
                if (nominatimFailed) {
                    window.notification?.info(
                        'Search requires internet connection. Use Coordinate Research tool for offline navigation.'
                    );
                    this.flashCoordinateResearchButton();
                    this.setStatus('error', 'Error: Online geocoding unavailable.');
                    return;
                }
                window.notification?.warning(`No results found for: ${query}`);
                this.displayResults([]);
                this.setStatus('ready', 'Done: 0 results.');
                return;
            }

            this.displayResults(results);
            this.setStatus('ready', `Done: ${results.length} result(s).`);
        } catch (error) {
            this.setStatus('error', `Error: ${error?.message || 'Search failed.'}`);
            window.notification?.error(`Search failed: ${error?.message || 'unknown error'}`);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Detect query type - Enhanced to detect all coordinate formats
     */
    detectQueryType(query) {
        if (!query || typeof query !== 'string') return 'address';
        
        const trimmed = query.trim();
        
        // Try parsing with CoordinateConverter if available (supports all formats)
        if (window.CoordinateConverter) {
            const converter = new window.CoordinateConverter();
            
            // Try MGRS format (e.g., "40U EJ 12345 67890")
            if (/^\d{1,2}[A-Z]\s*[A-Z]{2}\s*\d{1,5}\s*\d{1,5}/i.test(trimmed)) {
                const mgrsCoords = converter.mgrsToDD(trimmed);
                if (mgrsCoords) {
                    return 'coordinates';
                }
            }
            
            // Try parsing as coordinate string (DD, DMM, DMS, UTM, pasted map URLs)
            const parsed = converter.parseCoordinateString(trimmed);
            if (parsed) {
                return 'coordinates';
            }
        }
        
        // Check for simple coordinate patterns (comma-separated numbers)
        if (/^-?\d+\.?\d*[\s,]+-?\d+\.?\d*/.test(trimmed)) {
            return 'coordinates';
        }
        
        // Check for DMM format (e.g., "54° 32.72724′ N")
        if (/\d+\s*°\s*\d+\.?\d*\s*['′]/i.test(trimmed)) {
            return 'coordinates';
        }
        
        // Check for DMS format (e.g., "54° 32′ 43.63″ N")
        if (/\d+\s*°\s*\d+\s*['′]\s*\d+\.?\d*\s*["″]/i.test(trimmed)) {
            return 'coordinates';
        }
        
        // Check for UTM format (e.g., "Zone 40N 465000 6035000" or "31U 629580E 5803590N")
        if (/^(?:zone\s*)?\d{1,2}\s*[C-HJ-NP-XNS]\s+\d{5,7}(?:\.\d+)?\s*E?[\s,]+\d{5,8}(?:\.\d+)?\s*N?$/i.test(trimmed)) {
            return 'coordinates';
        }
        
        // Check for block/parcel pattern (e.g., "Block 1234, Parcel 567")
        if (/block|parcel|גוש|חלקה/i.test(trimmed)) {
            return 'block_parcel';
        }
        
        // Default to address/place name
        return 'address';
    }

    /**
     * Search by address, place name, or business name
     * Uses Nominatim (OpenStreetMap) geocoding API for address/place searches
     */
    async searchByAddress(query) {
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return { results: [], nominatimFailed: false };
        }

        const trimmed = query.trim();
        const results = [];

        // First, search in local regions if available
        if (window.regionsManager) {
            const regions = window.regionsManager.getAllRegions();
            const matches = regions.filter(region => 
                region.name && region.name.toLowerCase().includes(trimmed.toLowerCase())
            );
            
            matches.forEach(region => {
                results.push({
                    type: 'region',
                    name: region.name,
                    coordinates: region.coordinates,
                    data: region,
                    source: 'local'
                });
            });
        }

        // Then, try geocoding API (Nominatim - OpenStreetMap)
        try {
            // Use Nominatim geocoding API (free, no API key required)
            // Rate limit: 1 request per second, so we'll use it carefully
            // 1. Offline-first: query local SQLite world + installed region label databases
            if (window.electronAPI?.gis?.labels?.search) {
                try {
                    const activeRegions = Array.isArray(window.labelManager?._activeRegions)
                        ? window.labelManager._activeRegions
                        : [];
                    const localHits = await window.electronAPI.gis.labels.search(
                        trimmed,
                        { maxResults: 8 },
                        activeRegions
                    );
                    if (Array.isArray(localHits)) {
                        localHits.forEach((row) => {
                            const lon = Number(row.lon);
                            const lat = Number(row.lat);
                            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
                            const labelParts = [row.name || row.name_en || row.name_ar];
                            if (row.name_en && row.name_en !== labelParts[0]) labelParts.push(row.name_en);
                            if (row.type) labelParts.push(`(${row.type})`);
                            results.push({
                                type: 'address',
                                name: labelParts.filter(Boolean).join(' · '),
                                coordinates: { lon, lat, height: 0 },
                                data: { ...row, lon, lat },
                                source: 'offline-labels',
                            });
                        });
                    }
                } catch (_) {
                    /* non-fatal; continue to online fallback */
                }
            }

            // 2. Online OpenStreetMap Nominatim lookup (gracefully skipped when offline)
            const encodedQuery = encodeURIComponent(trimmed);
            const url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=5&addressdetails=1`;
            
            const response = await fetch(url);

            if (response.ok) {
                const data = await response.json();
                
                data.forEach(item => {
                    // Extract coordinates
                    const lon = parseFloat(item.lon);
                    const lat = parseFloat(item.lat);
                    
                    if (!isNaN(lon) && !isNaN(lat)) {
                        // Build display name from address components
                        let displayName = item.display_name;
                        if (item.address) {
                            const parts = [];
                            if (item.address.house_number) parts.push(item.address.house_number);
                            if (item.address.road) parts.push(item.address.road);
                            if (item.address.city || item.address.town || item.address.village) {
                                parts.push(item.address.city || item.address.town || item.address.village);
                            }
                            if (item.address.country) parts.push(item.address.country);
                            if (parts.length > 0) {
                                displayName = parts.join(', ');
                            }
                        }

                        results.push({
                            type: 'address',
                            name: displayName,
                            coordinates: {
                                lon: lon,
                                lat: lat,
                                height: 0
                            },
                            data: {
                                ...item,
                                lon,
                                lat
                            },
                            source: 'nominatim'
                        });
                    }
                });
            }
            return { results, nominatimFailed: false };
        } catch (error) {
            // Offline-first: only flag nominatimFailed if offline label DB also produced no results
            return { results, nominatimFailed: results.length === 0 };
        }
        return { results, nominatimFailed: false };
    }

    /**
     * Search by coordinates (supports DD, DMM, DMS, UTM, MGRS, ITM, pasted map URLs)
     */
    async searchByCoordinates(query) {
        if (!query || typeof query !== 'string') return [];
        
        const trimmed = query.trim();
        let lon;
        let lat;
        /** Ellipsoid height (m) only when a third number is present in plain numeric fallback. */
        let explicitHeightM;
        
        // Try parsing with CoordinateConverter if available (supports all formats)
        if (window.CoordinateConverter) {
            const converter = new window.CoordinateConverter();
            
            // Try parsing as MGRS first (e.g., "40U EJ 12345 67890")
            const mgrsCoords = converter.mgrsToDD(trimmed);
            if (mgrsCoords) {
                lon = mgrsCoords.lon;
                lat = mgrsCoords.lat;
            } else {
                // Try parsing as coordinate string (DD, DMM, DMS, pasted map URLs)
                const parsed = converter.parseCoordinateString(trimmed);
                if (parsed) {
                    lon = parsed.lon;
                    lat = parsed.lat;
                }
            }
            
            // Try UTM format if not found yet (e.g., "Zone 40N 465000 6035000")
            if (lon === undefined || lat === undefined) {
                const utmMatch = trimmed.match(/zone\s*(\d{1,2})([NS])\s*(\d+\.?\d*)\s*(\d+\.?\d*)/i);
                if (utmMatch) {
                    const zone = parseInt(utmMatch[1]);
                    const hemisphere = utmMatch[2].toUpperCase();
                    const easting = parseFloat(utmMatch[3]);
                    const northing = parseFloat(utmMatch[4]);
                    if (!isNaN(zone) && !isNaN(easting) && !isNaN(northing)) {
                        const dd = converter.utmToDD(zone, hemisphere, easting, northing);
                        lon = dd.lon;
                        lat = dd.lat;
                    }
                }
            }
        }
        
        // Support compact & verbose UTM coordinates (e.g., "31U 629580 5803590", "Zone 31N 629580E 5803590N")
        if (lon === undefined || lat === undefined) {
            const utmCompact = trimmed.match(
                /^(?:zone\s*)?(\d{1,2})\s*([C-HJ-NP-XNS])\s+(\d{5,7}(?:\.\d+)?)\s*E?[\s,]+(\d{5,8}(?:\.\d+)?)\s*N?$/i
            );
            if (utmCompact && window.CoordinateManager?.utmToWgs84) {
                const decoded = window.CoordinateManager.utmToWgs84(
                    parseInt(utmCompact[1], 10),
                    utmCompact[2],
                    parseFloat(utmCompact[3]),
                    parseFloat(utmCompact[4])
                );
                if (decoded) {
                    lon = decoded.lon;
                    lat = decoded.lat;
                }
            }
        }

        // Fallback: plain numeric pairs (comma/space) when the full parser did not match
        if (lon === undefined || lat === undefined) {
            const parts = trimmed.split(/[,\s]+/).map((p) => p.trim()).filter((p) => p);
            if (parts.length >= 2) {
                const coord1 = parseFloat(parts[0]);
                const coord2 = parseFloat(parts[1]);
                if (parts.length >= 3 && parts[2] !== '') {
                    const h = parseFloat(parts[2]);
                    if (Number.isFinite(h)) explicitHeightM = h;
                }

                if (!isNaN(coord1) && !isNaN(coord2)) {
                    if (this._looksLikeIsraelITM(coord1, coord2)) {
                        const geo = await this._itmToWgs84(coord1, coord2);
                        lon = geo.lon;
                        lat = geo.lat;
                    } else {
                        const pair = this._disambiguateDecimalPair(coord1, coord2);
                        lon = pair.lon;
                        lat = pair.lat;
                    }
                }
            }
        }
        
        // Validate coordinates
        if (lon === undefined || lat === undefined || 
            isNaN(lon) || isNaN(lat) ||
            lon < -180 || lon > 180 || lat < -90 || lat > 90) {
            return [];
        }

        return [{
            type: 'coordinates',
            name: `Location: ${lat.toFixed(SEARCH_COORD_DISPLAY_DP)}°, ${lon.toFixed(SEARCH_COORD_DISPLAY_DP)}°`,
            coordinates: { lon, lat, height: explicitHeightM },
            data: { lon, lat, height: explicitHeightM }
        }];
    }
    
    /**
     * Search regions by query (supports coordinates and text)
     * This method is called from the region search input field
     */
    async searchRegions(query) {
        // Handle empty query - clear search
        if (!query || (typeof query === 'string' && query.trim().length === 0)) {
            if (window.regionsManager) {
                window.regionsManager.clearSearch();
            }
            return [];
        }
        
        const trimmed = query.trim();
        
        // First, try to detect if it's a coordinate
        const queryType = this.detectQueryType(trimmed);
        
        if (queryType === 'coordinates') {
            // Handle coordinate search - supports all formats
            const coordResults = await this.searchByCoordinates(trimmed);
            
            if (coordResults.length > 0 && coordResults[0].coordinates) {
                const { lon, lat, height } = coordResults[0].coordinates;
                await this._flyToSearchCoordinate(lon, lat, height);
            }
            
            return coordResults;
        } else {
            // Handle text search in regions
            if (window.regionsManager) {
                const regions = window.regionsManager.filterRegionsByName(trimmed);
                
                // Update UI if available
                if (window.regionsManagerUI) {
                    window.regionsManagerUI.filteredRegions = regions;
                    window.regionsManagerUI.refresh();
                }
                
                return regions.map(region => ({
                    type: 'region',
                    name: region.name,
                    coordinates: region.coordinates,
                    data: region
                }));
            }
        }
        
        return [];
    }

    /**
     * True if values look like Israel TM (EPSG:2039) easting/northing in meters.
     */
    _looksLikeIsraelITM(e, n) {
        if (!Number.isFinite(e) || !Number.isFinite(n)) return false;
        const ae = Math.abs(e);
        const an = Math.abs(n);
        // Degrees would not be this large in both components; ITM uses ~5e5–3e6+ east/north.
        if (ae < 1000 && an < 1000) return false;
        return ae >= 50000 && ae <= 400000 && an >= 3000000 && an <= 9000000;
    }

    /**
     * Resolve two decimal numbers to WGS84 lat/lon. Matches CoordinateConverter (lat, lon)
     * when ambiguous, and handles lon-first when |first| > 90°.
     */
    _disambiguateDecimalPair(a, b) {
        if (Math.abs(a) > 90) return { lon: a, lat: b };
        if (Math.abs(b) > 90) return { lat: a, lon: b };
        // Israel / Levant: lat ~29–34°N, lon ~34–36°E — disambiguate (lon,lat) vs (lat,lon) pairs.
        const aLat = a >= 29 && a <= 34.2;
        const bLon = b >= 33.4 && b <= 36.5;
        const bLat = b >= 29 && b <= 34.2;
        const aLon = a >= 33.4 && a <= 36.5;
        if (aLat && bLon) return { lat: a, lon: b };
        if (bLat && aLon) return { lat: b, lon: a };
        return { lat: a, lon: b };
    }

    /**
     * Israel TM EPSG:2039 → WGS84 via main-process proj4 (accurate). Falls back to rough formula offline.
     */
    async _itmToWgs84(east, north) {
        if (window.electronAPI?.gis?.crs?.transform) {
            try {
                const res = await window.electronAPI.gis.crs.transform({
                    from: 'EPSG:2039',
                    to: 'EPSG:4326',
                    coords: [east, north]
                });
                const c = res && res.coords;
                if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
                    return { lon: c[0], lat: c[1] };
                }
            } catch (e) {
                console.warn('searchManager: EPSG:2039 transform failed', e);
            }
        }
        return this.convertITMToGEO(east, north);
    }

    /**
     * ITM → GEO fallback only when CRS service is unavailable (large error vs proj4).
     */
    convertITMToGEO(east, north) {
        const lon0 = 35.2045169444444;
        const lat0 = 31.7343936111111;
        const lon = lon0 + (east - 500000) / 111320;
        const lat = lat0 + (north - 500000) / 111320;
        return { lon, lat };
    }

    /**
     * Search by block/parcel
     * Supports Hebrew and English formats
     */
    async searchByBlockParcel(query) {
        if (!query || typeof query !== 'string') return [];

        const trimmed = query.trim();
        
        // Extract block and parcel numbers (supports Hebrew and English)
        const blockMatch = trimmed.match(/(?:block|גוש)\s*:?\s*(\d+)/i);
        const parcelMatch = trimmed.match(/(?:parcel|חלקה)\s*:?\s*(\d+)/i);
        
        const block = blockMatch ? parseInt(blockMatch[1]) : null;
        const parcel = parcelMatch ? parseInt(parcelMatch[1]) : null;

        if (!block && !parcel) {
            // Try to extract numbers if format is unclear
            const numbers = trimmed.match(/\d+/g);
            if (numbers && numbers.length >= 1) {
                const blockNum = numbers[0];
                const parcelNum = numbers.length >= 2 ? numbers[1] : null;
                
                return [{
                    type: 'block_parcel',
                    name: `Block ${blockNum}${parcelNum ? `, Parcel ${parcelNum}` : ''}`,
                    coordinates: null, // Would need database lookup for coordinates
                    data: { 
                        block: parseInt(blockNum), 
                        parcel: parcelNum ? parseInt(parcelNum) : null 
                    },
                    source: 'parsed'
                }];
            }
            return [];
        }

        // Try to find block/parcel in tileset database or regions
        const results = [];
        
        // Search in regions if they have block/parcel data
        if (window.regionsManager) {
            const regions = window.regionsManager.getAllRegions();
            const matches = regions.filter(region => {
                if (block && region.block && region.block === block) {
                    if (!parcel || (region.parcel && region.parcel === parcel)) {
                        return true;
                    }
                }
                return false;
            });

            matches.forEach(region => {
                results.push({
                    type: 'block_parcel',
                    name: `Block ${block || region.block || '--'}, Parcel ${parcel || region.parcel || '--'}`,
                    coordinates: region.coordinates,
                    data: {
                        block: block || region.block,
                        parcel: parcel || region.parcel,
                        region: region
                    },
                    source: 'regions'
                });
            });
        }

        // If no results found, return a placeholder result
        if (results.length === 0) {
            results.push({
                type: 'block_parcel',
                name: `Block ${block || '--'}, Parcel ${parcel || '--'}`,
                coordinates: null,
                data: { block, parcel },
                source: 'parsed',
                note: 'Coordinates not found. Load tileset data with block/parcel information.'
            });
        }

        return results;
    }

    /**
     * Display search results
     */
    displayResults(results) {
        const container = document.getElementById('searchResultsContainer');
        const list = document.getElementById('searchResultsList');
        
        if (!container || !list) return;

        if (results.length === 0) {
            list.innerHTML = '<div class="search-no-results">No results found</div>';
            container.style.display = 'block';
            return;
        }

        list.innerHTML = results.map((result, index) => `
            <div class="search-result-item" data-index="${index}">
                <div class="search-result-icon">${this.getResultIcon(result.type)}</div>
                <div class="search-result-content">
                    <div class="search-result-name">${result.name}</div>
                    ${result.coordinates ? `
                        <div class="search-result-coords">
                            Lon: ${result.coordinates.lon?.toFixed(SEARCH_COORD_DISPLAY_DP) || '--'}, 
                            Lat: ${result.coordinates.lat?.toFixed(SEARCH_COORD_DISPLAY_DP) || '--'}
                        </div>
                    ` : ''}
                </div>
                <button class="search-result-action" data-action="go">Go</button>
            </div>
        `).join('');

        // Add click handlers
        list.querySelectorAll('.search-result-item').forEach((item, index) => {
            const goBtn = item.querySelector('.search-result-action');
            goBtn?.addEventListener('click', async () => {
                await this.navigateToResult(results[index]);
            });
        });

        container.style.display = 'block';
    }

    /**
     * Get icon for result type
     */
    getResultIcon(type) {
        const icons = {
            'coordinates': '📍',
            'region': '🗺️',
            'block_parcel': '🏢',
            'address': '🏠'
        };
        return icons[type] || '📍';
    }

    /**
     * Fly to WGS84 point: ray-pick 3D surface + pin + close orbit (Coordinate Research), or terrain fallback.
     * @param {number|undefined} heightM - Ellipsoid height (m) when user supplied a third number; else sample surface.
     */
    async _flyToSearchCoordinate(lon, lat, heightM) {
        this.tilesetViewer = window.tilesetViewer;
        const viewer = this.tilesetViewer?.viewer;
        if (!viewer || typeof Cesium === 'undefined') return;

        const crm = window.coordinateResearchManager;
        if (crm && typeof crm.flyToLonLatPrecise === 'function') {
            await crm.flyToLonLatPrecise(lon, lat, heightM);
            return;
        }

        const scene = viewer.scene;
        const carto = Cesium.Cartographic.fromDegrees(lon, lat, 0);
        let h = 0;
        if (Number.isFinite(heightM)) {
            h = heightM;
        } else if (typeof scene.sampleHeightMostDetailed === 'function') {
            const s = await scene.sampleHeightMostDetailed([carto]);
            h = (s?.[0]?.height ?? scene.globe.getHeight(carto)) || 0;
        } else {
            h = scene.globe.getHeight(carto) || 0;
        }
        const pos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, h);
        await viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(pos, 3), {
            duration: 1.5,
            offset: new Cesium.HeadingPitchRange(
                0,
                Cesium.Math.toRadians(-38),
                Math.min(900, Math.max(140, h * 0.35 + 180))
            )
        });
    }

    /**
     * Navigate to search result
     */
    async navigateToResult(result) {
        this.tilesetViewer = window.tilesetViewer;
        if (!this.tilesetViewer || !this.tilesetViewer.viewer) return;

        const viewer = this.tilesetViewer.viewer;
        const camera = viewer.camera;

        if (result.coordinates && result.coordinates.lon !== undefined && result.coordinates.lat !== undefined) {
            const { lon, lat, height } = result.coordinates;
            const bbox = result?.data?.boundingbox;
            if (bbox && Array.isArray(bbox) && bbox.length === 4) {
                const west = parseFloat(bbox[2]);
                const south = parseFloat(bbox[0]);
                const east = parseFloat(bbox[3]);
                const north = parseFloat(bbox[1]);
                if ([west, south, east, north].every(v => Number.isFinite(v))) {
                    camera.flyTo({
                        destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
                        duration: 1.5
                    });
                } else {
                    await this._flyToSearchCoordinate(lon, lat, height);
                }
            } else {
                await this._flyToSearchCoordinate(lon, lat, height);
            }

            if (window.navigationManager) {
                setTimeout(() => {
                    window.navigationManager.saveCameraPosition?.();
                }, 2000);
            }

            this.showResultCard(result);
        } else {
            // No coordinates available - show message
            if (window.notification) {
                window.notification.warning(
                    result.note || 'Coordinates not available for this result. ' +
                    'Please load tileset data with block/parcel information.'
                );
            }
        }

        this.hide();
    }

    /**
     * Set current city context
     */
    setCurrentCity(city) {
        this.currentCity = city;
    }

    /**
     * Get current city context
     */
    getCurrentCity() {
        return this.currentCity;
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.searchManager = new SearchManager();
}
