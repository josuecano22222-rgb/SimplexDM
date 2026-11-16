/**
 * MetadataManager
 * Feature and tile metadata display
 */

class MetadataManager {
    constructor() {
        this.currentMetadata = null;
    }

    /**
     * Display feature metadata
     */
    displayFeatureMetadata(properties, feature) {
        this.currentMetadata = { properties, feature };
        
        const container = document.getElementById('metadataContent');
        if (!container) return;

        let html = '<div class="metadata-list">';
        
        for (const [key, value] of Object.entries(properties)) {
            html += `<div class="metadata-item">`;
            html += `<strong>${key}:</strong> `;
            html += `<span>${this.formatValue(value)}</span>`;
            html += `</div>`;
        }
        
        html += '</div>';
        container.innerHTML = html;
    }

    /**
     * Format value for display
     */
    formatValue(value) {
        if (value === null || value === undefined) {
            return '<em>null</em>';
        }
        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }
        return String(value);
    }
}

// Export singleton instance
window.metadataManager = new MetadataManager();
