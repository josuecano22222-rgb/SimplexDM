/**
 * ModelsMapManager
 * City/location selection interface (Meridian Design - Page 10)
 * Provides map and list of available cities/locations
 */

class ModelsMapManager {
    constructor() {
        this.modal = null;
        this.selectedCity = null;
        this.cities = [];
        /** @type {Cesium.Viewer|null} */
        this._miniMapViewer = null;
        /** @type {Cesium.Entity[]} */
        this._miniMapEntities = [];
        this.init();
    }

    /**
     * Initialize models map manager
     */
    async init() {
        await this.loadCities();
        this.createModal();
        this.setupEventHandlers();
    }

    /**
     * Default cities; optionally overridden by `data/config/app-config.json` → `modelsMap.cities`
     */
    getDefaultCities() {
        return [
            { id: 'tel-aviv', name: 'Tel Aviv-Yafo', coordinates: { lon: 34.7818, lat: 32.0853 } },
            { id: 'jerusalem', name: 'Jerusalem', coordinates: { lon: 35.2137, lat: 31.7683 } },
            { id: 'haifa', name: 'Haifa', coordinates: { lon: 34.9896, lat: 32.7940 } },
            { id: 'rishon', name: 'Rishon LeZion', coordinates: { lon: 34.8015, lat: 31.9730 } },
            { id: 'petah-tikva', name: 'Petah Tikva', coordinates: { lon: 34.8888, lat: 32.0892 } },
            { id: 'ashdod', name: 'Ashdod', coordinates: { lon: 34.6553, lat: 31.8044 } },
            { id: 'netanya', name: 'Netanya', coordinates: { lon: 34.8598, lat: 32.3320 } },
            { id: 'beer-sheva', name: 'Beer Sheva', coordinates: { lon: 34.7915, lat: 31.2529 } },
            { id: 'holon', name: 'Holon', coordinates: { lon: 34.7794, lat: 32.0103 } },
            { id: 'bnei-brak', name: 'Bnei Brak', coordinates: { lon: 34.8338, lat: 32.0900 } },
            { id: 'ramat-gan', name: 'Ramat Gan', coordinates: { lon: 34.8142, lat: 32.0820 } },
            { id: 'rehovot', name: 'Rehovot', coordinates: { lon: 34.8183, lat: 31.8948 } },
            { id: 'bat-yam', name: 'Bat Yam', coordinates: { lon: 34.7503, lat: 32.0132 } },
            { id: 'ashkelon', name: 'Ashkelon', coordinates: { lon: 34.5717, lat: 31.6688 } },
            { id: 'kfar-saba', name: 'Kfar Saba', coordinates: { lon: 34.9066, lat: 32.1750 } },
            { id: 'herzliya', name: 'Herzliya', coordinates: { lon: 34.8442, lat: 32.1624 } },
            { id: 'hadera', name: 'Hadera', coordinates: { lon: 34.9200, lat: 32.4411 } },
            { id: 'modiin', name: 'Modiin', coordinates: { lon: 35.0015, lat: 31.8986 } },
            { id: 'lod', name: 'Lod', coordinates: { lon: 34.8950, lat: 31.9517 } },
            { id: 'ramla', name: 'Ramla', coordinates: { lon: 34.8667, lat: 31.9253 } }
        ];
    }

    /**
     * Load cities from config when present; otherwise use defaults
     */
    async loadCities() {
        this.cities = this.getDefaultCities();
        try {
            const res = await fetch('data/config/app-config.json', { cache: 'no-store' });
            if (!res.ok) return;
            const j = await res.json();
            if (j.modelsMap && Array.isArray(j.modelsMap.cities) && j.modelsMap.cities.length > 0) {
                const normalized = j.modelsMap.cities
                    .map((c) => {
                        if (!c || !c.id || !c.name) return null;
                        const lon = c.coordinates?.lon ?? c.lon ?? c.longitude;
                        const lat = c.coordinates?.lat ?? c.lat ?? c.latitude;
                        if (typeof lon !== 'number' || typeof lat !== 'number') return null;
                        return { id: String(c.id), name: String(c.name), coordinates: { lon, lat } };
                    })
                    .filter(Boolean);
                if (normalized.length > 0) {
                    this.cities = normalized;
                }
            }
        } catch (e) {
            console.warn('ModelsMapManager: could not load app-config cities', e);
        }
    }

    /**
     * Build or refresh the Cesium overview map in the modal
     */
    ensureMiniMap() {
        if (this._miniMapViewer || typeof Cesium === 'undefined') return;
        const container = document.getElementById('modelsMapView');
        if (!container) return;

        container.innerHTML = '';
        const opts = {
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            fullscreenButton: false,
            vrButton: false,
            selectionIndicator: false,
            infoBox: false,
            terrainProvider: new Cesium.EllipsoidTerrainProvider(),
            shouldAnimate: false
        };
        try {
            opts.imageryProvider = new Cesium.OpenStreetMapImageryProvider({
                url: 'https://a.tile.openstreetmap.org/'
            });
        } catch (_) {
            opts.imageryProvider = false;
        }

        try {
            this._miniMapViewer = new Cesium.Viewer(container, opts);
        } catch (e) {
            console.warn('ModelsMapManager: mini map viewer failed', e);
            container.innerHTML =
                '<div class="map-placeholder"><div class="map-icon">🗺️</div><p>Map unavailable</p></div>';
            return;
        }

        if (opts.imageryProvider === false && this._miniMapViewer.scene?.globe) {
            this._miniMapViewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#1a2332');
        }

        this.syncMiniMapMarkers();
    }

    syncMiniMapMarkers() {
        if (!this._miniMapViewer) return;
        const viewer = this._miniMapViewer;
        this._miniMapEntities.forEach((e) => viewer.entities.remove(e));
        this._miniMapEntities = [];

        this.cities.forEach((city) => {
            const ent = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(city.coordinates.lon, city.coordinates.lat, 0),
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.fromCssColorString('#00b9ff'),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2
                },
                label: {
                    text: city.name,
                    font: '12px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -8),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
            });
            ent._cityId = city.id;
            this._miniMapEntities.push(ent);
        });

        if (this.cities.length > 0) {
            const positions = this.cities.map((c) =>
                Cesium.Cartesian3.fromDegrees(c.coordinates.lon, c.coordinates.lat, 0)
            );
            const bs = Cesium.BoundingSphere.fromPoints(positions);
            viewer.camera.flyToBoundingSphere(bs, { duration: 0 });
        }
    }

    /**
     * Create models map modal
     */
    createModal() {
        // Remove existing if any
        const existing = document.getElementById('modelsMapModal');
        if (existing) {
            existing.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'modelsMapModal';
        modal.className = 'models-map-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="models-map-content">
                <div class="models-map-header">
                    <h2>Models Map</h2>
                    <button class="close-btn" id="closeModelsMapBtn">×</button>
                </div>
                <div class="models-map-body">
                    <div class="models-map-description">
                        Clicking the button will open a list of all the cities we have.
                    </div>
                    
                    <div class="models-map-container">
                        <div class="models-map-left">
                            <div class="models-map-view" id="modelsMapView" aria-label="Cities overview map"></div>
                        </div>
                        
                        <div class="models-map-right">
                            <div class="city-list-header">
                                <h3>Available Cities</h3>
                                <input type="text" 
                                       id="citySearchInput" 
                                       class="city-search-input" 
                                       placeholder="Search cities...">
                            </div>
                            <div class="city-list" id="cityList">
                                <!-- Cities will be populated here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;
        this.renderCityList();
    }

    /**
     * Render city list
     */
    renderCityList(filter = '') {
        const cityList = document.getElementById('cityList');
        if (!cityList) return;

        const filtered = this.cities.filter(city =>
            city.name.toLowerCase().includes(filter.toLowerCase())
        );

        cityList.innerHTML = filtered.map(city => `
            <div class="city-item" data-city-id="${city.id}">
                <div class="city-icon">📍</div>
                <div class="city-info">
                    <div class="city-name">${city.name}</div>
                    <div class="city-coords">
                        ${city.coordinates.lon.toFixed(8)}, ${city.coordinates.lat.toFixed(8)}
                    </div>
                </div>
                <button class="city-select-btn" data-city-id="${city.id}">Select</button>
            </div>
        `).join('');

        // Add click handlers
        cityList.querySelectorAll('.city-item, .city-select-btn').forEach(element => {
            element.addEventListener('click', (e) => {
                const cityId = element.dataset.cityId || element.closest('.city-item')?.dataset.cityId;
                if (cityId) {
                    this.selectCity(cityId);
                }
            });
        });
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Close button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'closeModelsMapBtn' || (e.target === this.modal)) {
                this.hide();
            }
        });

        // City search
        const citySearchInput = document.getElementById('citySearchInput');
        if (citySearchInput) {
            citySearchInput.addEventListener('input', (e) => {
                this.renderCityList(e.target.value);
            });
        }
    }

    /**
     * Show models map modal
     */
    show() {
        if (this.modal) {
            this.modal.style.display = 'flex';
            this.renderCityList();
            this.ensureMiniMap();
            if (this._miniMapViewer) {
                this.syncMiniMapMarkers();
                try {
                    this._miniMapViewer.resize();
                    this._miniMapViewer.scene.requestRender();
                } catch (_) { /* ignore */ }
            }
        }
    }

    /**
     * Hide models map modal
     */
    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    /**
     * Toggle models map modal
     */
    toggle() {
        if (this.modal && this.modal.style.display === 'none') {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Select city
     */
    selectCity(cityId) {
        const city = this.cities.find(c => c.id === cityId);
        if (!city) return;

        this.selectedCity = city;

        // Update search manager context
        if (window.searchManager) {
            window.searchManager.setCurrentCity(city);
        }

        // Navigate to city
        this.navigateToCity(city);

        // Show notification
        if (window.notification) {
            window.notification.success(`Selected city: ${city.name}`);
        }

        this.hide();
    }

    /**
     * Navigate to selected city
     */
    navigateToCity(city) {
        if (!window.tilesetViewer || !window.tilesetViewer.viewer) return;

        const viewer = window.tilesetViewer.viewer;
        const camera = viewer.camera;

        const destination = Cesium.Cartesian3.fromDegrees(
            city.coordinates.lon,
            city.coordinates.lat,
            5000 // Default altitude
        );

        camera.flyTo({
            destination: destination,
            orientation: {
                heading: 0,
                pitch: -0.5,
                roll: 0
            },
            duration: 2.0
        });

        // Save camera position
        if (window.navigationManager) {
            setTimeout(() => {
                window.navigationManager.saveCameraPosition();
            }, 2000);
        }
    }

    /**
     * Get selected city
     */
    getSelectedCity() {
        return this.selectedCity;
    }

    /**
     * Get all cities
     */
    getAllCities() {
        return this.cities;
    }
}

// Initialize when available
if (typeof window !== 'undefined') {
    window.modelsMapManager = new ModelsMapManager();
}
