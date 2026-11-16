/**
 * FileEditor
 * Text file editing functionality
 */

class FileEditor {
    constructor() {
        this.currentFile = null;
        this.isDirty = false;
        this.fileManager = null;
    }

    /**
     * Initialize with dependencies
     */
    init(fileManager) {
        this.fileManager = fileManager;
        this.setupEditor();
    }

    /**
     * Set up editor element
     */
    setupEditor() {
        // Editor will be set up by FileEditorUI
    }

    /**
     * Open file
     */
    async openFile(pathOrHandle) {
        try {
            const content = await this.fileManager.readFile(pathOrHandle);
            this.currentFile = pathOrHandle;
            this.isDirty = false;
            return content;
        } catch (error) {
            console.error('Failed to open file:', error);
            throw error;
        }
    }

    /**
     * Save file
     */
    async saveFile(content) {
        if (!this.currentFile) {
            throw new Error('No file open');
        }

        try {
            // If currentFile is a handle, use it directly
            if (this.currentFile && typeof this.currentFile !== 'string') {
                await this.fileManager.writeFile(this.currentFile, content);
            } else {
                throw new Error('File handle required for saving');
            }

            this.isDirty = false;
            return true;
        } catch (error) {
            console.error('Failed to save file:', error);
            throw error;
        }
    }

    /**
     * Format JSON
     */
    formatJSON(jsonString) {
        try {
            const obj = JSON.parse(jsonString);
            return JSON.stringify(obj, null, 2);
        } catch (error) {
            throw new Error('Invalid JSON: ' + error.message);
        }
    }

    /**
     * Validate JSON
     */
    validateJSON(jsonString) {
        try {
            JSON.parse(jsonString);
            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                error: error.message,
                position: error.message.match(/position (\d+)/)?.[1]
            };
        }
    }

    /**
     * Mark as dirty
     */
    markDirty() {
        this.isDirty = true;
    }

    /**
     * Check if file is dirty
     */
    isFileDirty() {
        return this.isDirty;
    }

    /**
     * Close current file
     */
    closeFile() {
        if (this.isDirty) {
            // Prompt user to save
            return false;
        }
        this.currentFile = null;
        this.isDirty = false;
        return true;
    }
}

// Export singleton instance
window.fileEditor = new FileEditor();
