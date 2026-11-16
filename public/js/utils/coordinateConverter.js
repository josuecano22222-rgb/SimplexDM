/**
 * CoordinateConverter
 * Comprehensive coordinate conversion library supporting:
 * - Decimal Degrees (DD)
 * - Degrees and Decimal Minutes (DMM)
 * - Degrees, Minutes, Seconds (DMS)
 * - UTM (Universal Transverse Mercator)
 * - MGRS (Military Grid Reference System)
 * 
 * All conversions use WGS84 ellipsoid for maximum accuracy
 */

class CoordinateConverter {
    constructor() {
        // WGS84 Ellipsoid parameters
        this.a = 6378137.0; // Semi-major axis (meters)
        this.f = 1 / 298.257223563; // Flattening
        this.e2 = 0.00669438002290; // First eccentricity squared
        this.e = Math.sqrt(this.e2); // First eccentricity
        this.k0 = 0.9996; // UTM scale factor
        
        // MGRS grid square identifiers
        this.mgrsLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I and O excluded
        this.mgrs100kmLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    }

    /**
     * Resolve ambiguous decimal pairs (lat,lon) vs (lon,lat). Matches SearchManager rules for Israel/Levant.
     * @param {number} a - First number
     * @param {number} b - Second number
     * @returns {{ lat: number, lon: number }}
     */
    _disambiguateDecimalPair(a, b) {
        if (Math.abs(a) > 90) return { lon: a, lat: b };
        if (Math.abs(b) > 90) return { lat: a, lon: b };
        const aLat = a >= 29 && a <= 34.2;
        const bLon = b >= 33.4 && b <= 36.5;
        const bLat = b >= 29 && b <= 34.2;
        const aLon = a >= 33.4 && a <= 36.5;
        if (aLat && bLon) return { lat: a, lon: b };
        if (bLat && aLon) return { lat: b, lon: a };
        return { lat: a, lon: b };
    }

    /**
     * Convert Decimal Degrees to Degrees Decimal Minutes
     * @param {number} dd - Decimal degrees
     * @returns {Object} {degrees, minutes}
     */
    ddToDMM(dd) {
        const degrees = Math.floor(Math.abs(dd));
        const minutes = (Math.abs(dd) - degrees) * 60;
        return {
            degrees: dd < 0 ? -degrees : degrees,
            minutes: minutes
        };
    }

    /**
     * Convert Decimal Degrees to Degrees Minutes Seconds
     * @param {number} dd - Decimal degrees
     * @returns {Object} {degrees, minutes, seconds}
     */
    ddToDMS(dd) {
        const degrees = Math.floor(Math.abs(dd));
        const minutesFloat = (Math.abs(dd) - degrees) * 60;
        const minutes = Math.floor(minutesFloat);
        const seconds = (minutesFloat - minutes) * 60;
        return {
            degrees: dd < 0 ? -degrees : degrees,
            minutes: minutes,
            seconds: seconds
        };
    }

    /**
     * Convert Degrees Decimal Minutes to Decimal Degrees
     * @param {number} degrees - Whole degrees
     * @param {number} minutes - Decimal minutes
     * @returns {number} Decimal degrees
     */
    dmmToDD(degrees, minutes) {
        const sign = degrees < 0 ? -1 : 1;
        return sign * (Math.abs(degrees) + minutes / 60);
    }

    /**
     * Convert Degrees Minutes Seconds to Decimal Degrees
     * @param {number} degrees - Whole degrees
     * @param {number} minutes - Whole minutes
     * @param {number} seconds - Decimal seconds
     * @returns {number} Decimal degrees
     */
    dmsToDD(degrees, minutes, seconds) {
        const sign = degrees < 0 ? -1 : 1;
        return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
    }

    /**
     * Format Decimal Degrees as string
     * @param {number} dd - Decimal degrees
     * @param {number} precision - Decimal places (default: 10 for maximum accuracy)
     * @returns {string} Formatted string
     */
    formatDD(dd, precision = 10) {
        return `${dd.toFixed(precision)}°`;
    }

    /**
     * Format Degrees Decimal Minutes as string
     * @param {number} degrees - Whole degrees
     * @param {number} minutes - Decimal minutes
     * @param {string} direction - N/S/E/W
     * @param {number} precision - Decimal places for minutes (default: 8 for maximum accuracy)
     * @returns {string} Formatted string
     */
    formatDMM(degrees, minutes, direction = '', precision = 8) {
        const absDegrees = Math.abs(degrees);
        const dir = direction || (degrees < 0 ? (absDegrees === degrees ? 'S' : 'W') : (absDegrees === degrees ? 'N' : 'E'));
        return `${absDegrees}° ${minutes.toFixed(precision)}′ ${dir}`;
    }

    /**
     * Format Degrees Minutes Seconds as string
     * @param {number} degrees - Whole degrees
     * @param {number} minutes - Whole minutes
     * @param {number} seconds - Decimal seconds
     * @param {string} direction - N/S/E/W
     * @param {number} precision - Decimal places for seconds (default: 6 for maximum accuracy)
     * @returns {string} Formatted string
     */
    formatDMS(degrees, minutes, seconds, direction = '', precision = 6) {
        const absDegrees = Math.abs(degrees);
        const dir = direction || (degrees < 0 ? (absDegrees === degrees ? 'S' : 'W') : (absDegrees === degrees ? 'N' : 'E'));
        return `${absDegrees}° ${minutes}′ ${seconds.toFixed(precision)}″ ${dir}`;
    }

    /**
     * Parse coordinate string in various formats
     * Supports: DD, DMM, DMS formats, common web map URL patterns, and various text formats
     * @param {string} input - Coordinate string
     * @returns {Object|null} {lat, lon} or null if invalid
     */
    parseCoordinateString(input) {
        if (!input || typeof input !== 'string') return null;
        
        const trimmed = input.trim();
        
        // Try common web map URL patterns (lat/lon in query or path)
        const webMapUrlPatterns = [
            /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,  // @lat,lon
            /[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/,  // ?q=lat,lon or &q=lat,lon
            /place\/([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/,  // place/lat,lon
            /maps\/@(-?\d+\.?\d*),(-?\d+\.?\d*),/  // maps/@lat,lon,
        ];
        
        for (const pattern of webMapUrlPatterns) {
            const match = trimmed.match(pattern);
            if (match) {
                const lat = parseFloat(match[1]);
                const lon = parseFloat(match[2]);
                if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                    return { lat, lon };
                }
            }
        }
        
        // Try decimal degrees: optional N/S/E/W between numbers; then comma/space pairs (with Levant disambiguation).
        const ddWithHemi = /(-?\d+\.?\d+)\s*°?\s*([NS]?)\s*,?\s*(-?\d+\.?\d+)\s*°?\s*([EW]?)/i;
        const matchHemi = trimmed.match(ddWithHemi);
        if (matchHemi) {
            const hasLatHemi = matchHemi[2] && /^[NS]$/i.test(matchHemi[2]);
            const hasLonHemi = matchHemi[4] && /^[EW]$/i.test(matchHemi[4]);
            let lat;
            let lon;
            if (hasLatHemi || hasLonHemi) {
                lat = parseFloat(matchHemi[1]);
                lon = parseFloat(matchHemi[3]);
                if (matchHemi[2] && matchHemi[2].toUpperCase() === 'S') lat = -Math.abs(lat);
                if (matchHemi[4] && matchHemi[4].toUpperCase() === 'W') lon = -Math.abs(lon);
            } else {
                const a = parseFloat(matchHemi[1]);
                const b = parseFloat(matchHemi[3]);
                const pair = this._disambiguateDecimalPair(a, b);
                lat = pair.lat;
                lon = pair.lon;
            }
            if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                return { lat, lon };
            }
        }

        const ddComma = /(-?\d+\.?\d+)\s*,\s*(-?\d+\.?\d*)/;
        const ddSpace = /(-?\d+\.?\d+)\s+(-?\d+\.?\d*)/;
        for (const re of [ddComma, ddSpace]) {
            const m = trimmed.match(re);
            if (!m) continue;
            const a = parseFloat(m[1]);
            const b = parseFloat(m[2]);
            if (isNaN(a) || isNaN(b)) continue;
            const { lat, lon } = this._disambiguateDecimalPair(a, b);
            if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                return { lat, lon };
            }
        }

        // Try DMM format: "54° 32.72724′ N, 54° 32.72724′ E"
        const dmmPattern = /(-?\d+)\s*°\s*(\d+\.?\d*)\s*['′]\s*([NS]?)\s*,?\s*(-?\d+)\s*°\s*(\d+\.?\d*)\s*['′]\s*([EW]?)/i;
        const dmmMatch = trimmed.match(dmmPattern);
        if (dmmMatch) {
            let latDeg = parseInt(dmmMatch[1]);
            let latMin = parseFloat(dmmMatch[2]);
            let lonDeg = parseInt(dmmMatch[4]);
            let lonMin = parseFloat(dmmMatch[5]);
            if (dmmMatch[3] && dmmMatch[3].toUpperCase() === 'S') latDeg = -Math.abs(latDeg);
            if (dmmMatch[6] && dmmMatch[6].toUpperCase() === 'W') lonDeg = -Math.abs(lonDeg);
            const lat = this.dmmToDD(latDeg, latMin);
            const lon = this.dmmToDD(lonDeg, lonMin);
            if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                return { lat, lon };
            }
        }

        // Try DMS format: "54° 32′ 43.63″ N, 54° 32′ 43.63″ E"
        const dmsPattern = /(-?\d+)\s*°\s*(\d+)\s*['′]\s*(\d+\.?\d*)\s*["″]\s*([NS]?)\s*,?\s*(-?\d+)\s*°\s*(\d+)\s*['′]\s*(\d+\.?\d*)\s*["″]\s*([EW]?)/i;
        const dmsMatch = trimmed.match(dmsPattern);
        if (dmsMatch) {
            let latDeg = parseInt(dmsMatch[1]);
            let latMin = parseInt(dmsMatch[2]);
            let latSec = parseFloat(dmsMatch[3]);
            let lonDeg = parseInt(dmsMatch[5]);
            let lonMin = parseInt(dmsMatch[6]);
            let lonSec = parseFloat(dmsMatch[7]);
            if (dmsMatch[4] && dmsMatch[4].toUpperCase() === 'S') latDeg = -Math.abs(latDeg);
            if (dmsMatch[8] && dmsMatch[8].toUpperCase() === 'W') lonDeg = -Math.abs(lonDeg);
            const lat = this.dmsToDD(latDeg, latMin, latSec);
            const lon = this.dmsToDD(lonDeg, lonMin, lonSec);
            if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                return { lat, lon };
            }
        }

        // Fallback: split on comma/whitespace (disambiguate lon/lat order when needed)
        const parts = trimmed.split(/[,\s]+/).map((p) => p.trim()).filter((p) => p);
        if (parts.length >= 2) {
            const a = parseFloat(parts[0]);
            const b = parseFloat(parts[1]);
            if (!isNaN(a) && !isNaN(b)) {
                const { lat, lon } = this._disambiguateDecimalPair(a, b);
                if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                    return { lat, lon };
                }
            }
        }

        return null;
    }

    /**
     * Calculate UTM zone from longitude
     * @param {number} lon - Longitude in decimal degrees
     * @returns {number} UTM zone (1-60)
     */
    getUTMZone(lon) {
        return Math.floor((lon + 180) / 6) + 1;
    }

    /**
     * Get UTM hemisphere (N/S) from latitude
     * @param {number} lat - Latitude in decimal degrees
     * @returns {string} 'N' or 'S'
     */
    getUTMHemisphere(lat) {
        return lat >= 0 ? 'N' : 'S';
    }

    /**
     * Convert Decimal Degrees to UTM
     * Uses Transverse Mercator projection
     * @param {number} lat - Latitude in decimal degrees
     * @param {number} lon - Longitude in decimal degrees
     * @returns {Object} {zone, hemisphere, easting, northing}
     */
    ddToUTM(lat, lon) {
        const zone = this.getUTMZone(lon);
        const hemisphere = this.getUTMHemisphere(lat);
        
        // Convert to radians
        const latRad = lat * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;
        const lon0Rad = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180; // Central meridian
        
        // WGS84 parameters
        const a = this.a;
        const e2 = this.e2;
        const e = this.e;
        const k0 = this.k0;
        
        const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
        const T = Math.tan(latRad) * Math.tan(latRad);
        const C = e2 * Math.cos(latRad) * Math.cos(latRad) / (1 - e2);
        const A = Math.cos(latRad) * (lonRad - lon0Rad);
        
        const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * latRad
            - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * latRad)
            + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * latRad)
            - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * latRad));
        
        const M0 = 0; // M at equator
        
        const easting = k0 * N * (A + (1 - T + C) * A * A * A / 6
            + (5 - 18 * T + T * T + 72 * C - 58) * A * A * A * A * A / 120) + 500000;
        
        let northing = k0 * (M - M0 + N * Math.tan(latRad) * (A * A / 2
            + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24
            + (61 - 58 * T + T * T + 600 * C - 330) * A * A * A * A * A * A / 720));
        
        // Adjust northing for southern hemisphere
        if (hemisphere === 'S') {
            northing += 10000000;
        }
        
        return {
            zone: zone,
            hemisphere: hemisphere,
            easting: easting,
            northing: northing
        };
    }

    /**
     * Convert UTM to Decimal Degrees
     * @param {number} zone - UTM zone (1-60)
     * @param {string} hemisphere - 'N' or 'S'
     * @param {number} easting - Easting in meters
     * @param {number} northing - Northing in meters
     * @returns {Object} {lat, lon} in decimal degrees
     */
    utmToDD(zone, hemisphere, easting, northing) {
        // Adjust northing for southern hemisphere
        let adjustedNorthing = northing;
        if (hemisphere === 'S') {
            adjustedNorthing -= 10000000;
        }
        
        const a = this.a;
        const e2 = this.e2;
        const e = this.e;
        const k0 = this.k0;
        const lon0Rad = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
        
        const x = easting - 500000;
        const y = adjustedNorthing / k0;
        
        const M = y;
        const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
        
        const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
        
        let lat1Rad = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu)
            + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu)
            + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);
        
        const N1 = a / Math.sqrt(1 - e2 * Math.sin(lat1Rad) * Math.sin(lat1Rad));
        const T1 = Math.tan(lat1Rad) * Math.tan(lat1Rad);
        const C1 = e2 * Math.cos(lat1Rad) * Math.cos(lat1Rad) / (1 - e2);
        const D = x / N1;
        
        const latRad = lat1Rad - (N1 * Math.tan(lat1Rad) / (k0 * a)) * (D * D / 2
            - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * D * D * D * D / 24
            + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * e2 - 3 * C1 * C1) * D * D * D * D * D * D / 720);
        
        const lonRad = lon0Rad + (D - (1 + 2 * T1 + C1) * D * D * D / 6
            + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(lat1Rad);
        
        return {
            lat: latRad * 180 / Math.PI,
            lon: lonRad * 180 / Math.PI
        };
    }

    /**
     * Get MGRS latitude band letter from latitude
     * @param {number} lat - Latitude in decimal degrees
     * @returns {string} Latitude band letter
     */
    getMGRSLatitudeBand(lat) {
        if (lat < -80 || lat > 84) return '';
        const bandIndex = Math.floor((lat + 80) / 8);
        if (bandIndex < 0 || bandIndex >= this.mgrsLetters.length) return '';
        return this.mgrsLetters[bandIndex];
    }

    /**
     * Get MGRS 100km grid square identifiers
     * @param {number} zone - UTM zone
     * @param {string} latBand - Latitude band letter
     * @param {number} easting - UTM easting
     * @param {number} northing - UTM northing
     * @returns {Object} {eastingLetter, northingLetter}
     */
    getMGRSGridSquare(zone, latBand, easting, northing) {
        // Get 100km grid square
        const easting100km = Math.floor(easting / 100000);
        const northing100km = Math.floor(northing / 100000);
        
        // Easting letter (varies by zone)
        const eastingIndex = (easting100km + (zone - 1) * 2) % 24;
        const eastingLetter = this.mgrs100kmLetters[eastingIndex];
        
        // Northing letter (varies by latitude band)
        const latBandIndex = this.mgrsLetters.indexOf(latBand);
        const northingIndex = (northing100km + latBandIndex * 5) % 20;
        const northingLetter = this.mgrs100kmLetters[northingIndex];
        
        return {
            eastingLetter: eastingLetter,
            northingLetter: northingLetter
        };
    }

    /**
     * Convert Decimal Degrees to MGRS
     * @param {number} lat - Latitude in decimal degrees
     * @param {number} lon - Longitude in decimal degrees
     * @param {number} precision - Precision digits (1-5, default: 5 for 1 meter)
     * @returns {string} MGRS string (e.g., "40U EJ 12345 67890")
     */
    ddToMGRS(lat, lon, precision = 5) {
        const utm = this.ddToUTM(lat, lon);
        const latBand = this.getMGRSLatitudeBand(lat);
        
        if (!latBand) {
            return null; // Outside MGRS coverage
        }
        
        const gridSquare = this.getMGRSGridSquare(utm.zone, latBand, utm.easting, utm.northing);
        
        // Get coordinates within 100km square
        const easting100km = Math.floor(utm.easting / 100000);
        const northing100km = Math.floor(utm.northing / 100000);
        const eastingLocal = Math.floor(utm.easting - easting100km * 100000);
        const northingLocal = Math.floor(utm.northing - northing100km * 100000);
        
        // Format with specified precision
        const eastingStr = eastingLocal.toString().padStart(5, '0').substring(0, precision);
        const northingStr = northingLocal.toString().padStart(5, '0').substring(0, precision);
        
        return `${utm.zone}${latBand} ${gridSquare.eastingLetter}${gridSquare.northingLetter} ${eastingStr} ${northingStr}`;
    }

    /**
     * Parse MGRS string to UTM coordinates
     * @param {string} mgrs - MGRS string (e.g., "40U EJ 12345 67890")
     * @returns {Object|null} {zone, latBand, eastingLetter, northingLetter, easting, northing} or null
     */
    parseMGRS(mgrs) {
        if (!mgrs || typeof mgrs !== 'string') return null;
        
        const trimmed = mgrs.trim().toUpperCase();
        // Pattern: "40U EJ 12345 67890" or "40UEJ1234567890"
        const pattern = /(\d{1,2})([A-Z])\s*([A-Z])([A-Z])\s*(\d{1,5})\s*(\d{1,5})/;
        const match = trimmed.match(pattern);
        
        if (!match) return null;
        
        const zone = parseInt(match[1]);
        const latBand = match[2];
        const eastingLetter = match[3];
        const northingLetter = match[4];
        const eastingStr = match[5].padEnd(5, '0');
        const northingStr = match[6].padEnd(5, '0');
        
        // Convert grid square letters to 100km offsets
        const easting100kmIndex = this.mgrs100kmLetters.indexOf(eastingLetter);
        const northing100kmIndex = this.mgrs100kmLetters.indexOf(northingLetter);
        
        // Calculate 100km square coordinates
        const easting100km = ((easting100kmIndex - (zone - 1) * 2) % 24 + 24) % 24;
        const latBandIndex = this.mgrsLetters.indexOf(latBand);
        const northing100km = ((northing100kmIndex - latBandIndex * 5) % 20 + 20) % 20;
        
        const easting = easting100km * 100000 + parseInt(eastingStr);
        const northing = northing100km * 100000 + parseInt(northingStr);
        
        // Hemisphere from MGRS latitude band (C–M = southern, N–X = northern; I/O omitted)
        const southBands = 'CDEFGHJKLM';
        const hemisphere = southBands.includes(latBand) ? 'S' : 'N';
        
        return {
            zone: zone,
            hemisphere: hemisphere,
            easting: easting,
            northing: northing
        };
    }

    /**
     * Convert MGRS to Decimal Degrees
     * @param {string} mgrs - MGRS string
     * @returns {Object|null} {lat, lon} in decimal degrees or null
     */
    mgrsToDD(mgrs) {
        const utm = this.parseMGRS(mgrs);
        if (!utm) return null;
        
        return this.utmToDD(utm.zone, utm.hemisphere, utm.easting, utm.northing);
    }

    /**
     * Convert coordinates between all formats
     * @param {Object} input - Input coordinates in any format
     * @returns {Object} All coordinate formats
     */
    convertAll(input) {
        let lat, lon;
        
        // Determine input format and convert to DD
        if (input.dd) {
            lat = input.dd.lat;
            lon = input.dd.lon;
        } else if (input.dmm) {
            lat = this.dmmToDD(input.dmm.latDegrees, input.dmm.latMinutes);
            lon = this.dmmToDD(input.dmm.lonDegrees, input.dmm.lonMinutes);
        } else if (input.dms) {
            lat = this.dmsToDD(input.dms.latDegrees, input.dms.latMinutes, input.dms.latSeconds);
            lon = this.dmsToDD(input.dms.lonDegrees, input.dms.lonMinutes, input.dms.lonSeconds);
        } else if (input.utm) {
            const dd = this.utmToDD(input.utm.zone, input.utm.hemisphere, input.utm.easting, input.utm.northing);
            lat = dd.lat;
            lon = dd.lon;
        } else if (input.mgrs) {
            const dd = this.mgrsToDD(input.mgrs);
            if (!dd) return null;
            lat = dd.lat;
            lon = dd.lon;
        } else if (input.lat !== undefined && input.lon !== undefined) {
            lat = input.lat;
            lon = input.lon;
        } else {
            return null;
        }
        
        // Validate coordinates
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            return null;
        }
        
        // Convert to all formats
        const latDMM = this.ddToDMM(lat);
        const lonDMM = this.ddToDMM(lon);
        const latDMS = this.ddToDMS(lat);
        const lonDMS = this.ddToDMS(lon);
        const utm = this.ddToUTM(lat, lon);
        const mgrs = this.ddToMGRS(lat, lon);
        
        return {
            dd: {
                lat: lat,
                lon: lon,
                formatted: `${this.formatDD(lat, 10)}, ${this.formatDD(lon, 10)}`,
                latLonDecimalPair: `${lat.toFixed(10)}, ${lon.toFixed(10)}`
            },
            dmm: {
                latDegrees: latDMM.degrees,
                latMinutes: latDMM.minutes,
                lonDegrees: lonDMM.degrees,
                lonMinutes: lonDMM.minutes,
                formatted: `${this.formatDMM(latDMM.degrees, latDMM.minutes, lat >= 0 ? 'N' : 'S', 8)}, ${this.formatDMM(lonDMM.degrees, lonDMM.minutes, lon >= 0 ? 'E' : 'W', 8)}`
            },
            dms: {
                latDegrees: latDMS.degrees,
                latMinutes: latDMS.minutes,
                latSeconds: latDMS.seconds,
                lonDegrees: lonDMS.degrees,
                lonMinutes: lonDMS.minutes,
                lonSeconds: lonDMS.seconds,
                formatted: `${this.formatDMS(latDMS.degrees, latDMS.minutes, latDMS.seconds, lat >= 0 ? 'N' : 'S', 6)}, ${this.formatDMS(lonDMS.degrees, lonDMS.minutes, lonDMS.seconds, lon >= 0 ? 'E' : 'W', 6)}`
            },
            utm: {
                zone: utm.zone,
                hemisphere: utm.hemisphere,
                easting: utm.easting,
                northing: utm.northing,
                formatted: `Zone ${utm.zone}${utm.hemisphere} ${utm.easting.toFixed(3)} mE, ${utm.northing.toFixed(3)} mN`
            },
            mgrs: {
                value: mgrs,
                formatted: mgrs || 'Outside MGRS coverage'
            }
        };
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.CoordinateConverter = CoordinateConverter;
}
