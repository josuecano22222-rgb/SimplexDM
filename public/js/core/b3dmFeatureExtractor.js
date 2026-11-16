/**
 * B3DM & 3D Tiles Binary Feature Extractor (`public/js/core/b3dmFeatureExtractor.js`)
 *
 * Parses Cesium 3D Tiles 1.0 and 1.1 tile payloads (`.b3dm`, `.i3dm`, `.pnts`,
 * `.cmpt`, and `.glb`), decodes Feature Table and Batch Table JSON + binary
 * property buffers, inspects embedded glTF 2.0 metadata (including
 * `EXT_structural_metadata`, `EXT_mesh_features`, and `EXT_feature_metadata`),
 * and extracts live `Cesium3DTileFeature` records from loaded Cesium tiles.
 */
(function (root) {
    'use strict';

    const COMPONENT_TYPES = Object.freeze({
        BYTE: { Ctor: Int8Array, bytes: 1 },
        UNSIGNED_BYTE: { Ctor: Uint8Array, bytes: 1 },
        SHORT: { Ctor: Int16Array, bytes: 2 },
        UNSIGNED_SHORT: { Ctor: Uint16Array, bytes: 2 },
        INT: { Ctor: Int32Array, bytes: 4 },
        UNSIGNED_INT: { Ctor: Uint32Array, bytes: 4 },
        FLOAT: { Ctor: Float32Array, bytes: 4 },
        DOUBLE: { Ctor: Float64Array, bytes: 8 },
    });

    const CONTAINER_COUNTS = Object.freeze({
        SCALAR: 1,
        VEC2: 2,
        VEC3: 3,
        VEC4: 4,
        MAT2: 4,
        MAT3: 9,
        MAT4: 16,
    });

    const GLB_MAGIC = 0x46546c67; // 'glTF'
    const GLB_CHUNK_JSON = 0x4e4f534a; // 'JSON'
    const GLB_CHUNK_BIN = 0x004e4942; // 'BIN\0'

    function toUint8Array(input) {
        if (input instanceof Uint8Array) return input;
        if (input instanceof ArrayBuffer) return new Uint8Array(input);
        if (ArrayBuffer.isView(input)) {
            return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        }
        throw new TypeError('Expected ArrayBuffer or TypedArray tile payload');
    }

    function decodeUtf8(bytes, start, length) {
        if (!length || length <= 0) return '';
        const slice = bytes.subarray(start, start + length);
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8').decode(slice);
        }
        let out = '';
        for (let i = 0; i < slice.length; i++) {
            out += String.fromCharCode(slice[i]);
        }
        return out;
    }

    function parseJsonSection(bytes, offset, byteLength) {
        if (!byteLength || byteLength <= 0) return {};
        const raw = decodeUtf8(bytes, offset, byteLength).replace(/\0+$/g, '').trim();
        if (!raw) return {};
        return JSON.parse(raw);
    }

    function readBinaryProperty(binBytes, descriptor, count) {
        if (!descriptor || typeof descriptor !== 'object' || typeof descriptor.byteOffset !== 'number') {
            return null;
        }
        const compInfo = COMPONENT_TYPES[descriptor.componentType];
        const compCount = CONTAINER_COUNTS[descriptor.type] || 1;
        if (!compInfo || !Number.isInteger(count) || count <= 0) {
            return null;
        }
        const totalElements = count * compCount;
        const requiredBytes = totalElements * compInfo.bytes;
        const start = descriptor.byteOffset;
        if (start < 0 || start + requiredBytes > binBytes.byteLength) {
            return null;
        }
        // Copy into aligned buffer so multi-byte typed arrays never throw RangeError on unaligned offsets
        const aligned = binBytes.slice(start, start + requiredBytes);
        const typed = new compInfo.Ctor(aligned.buffer, aligned.byteOffset, totalElements);

        const values = new Array(count);
        if (compCount === 1) {
            for (let i = 0; i < count; i++) values[i] = typed[i];
        } else {
            for (let i = 0; i < count; i++) {
                const tuple = new Array(compCount);
                const base = i * compCount;
                for (let c = 0; c < compCount; c++) tuple[c] = typed[base + c];
                values[i] = tuple;
            }
        }
        return values;
    }

    function decodeBatchTableFeatures(batchTableJson, batchTableBin, batchLength) {
        const keys = batchTableJson && typeof batchTableJson === 'object'
            ? Object.keys(batchTableJson).filter((k) => k !== 'extensions' && k !== 'extras')
            : [];

        let inferredCount = Number.isInteger(batchLength) && batchLength >= 0 ? batchLength : 0;
        if (inferredCount === 0) {
            for (const k of keys) {
                if (Array.isArray(batchTableJson[k])) {
                    inferredCount = Math.max(inferredCount, batchTableJson[k].length);
                }
            }
        }

        const columns = {};
        const propertySchema = {};
        for (const key of keys) {
            const val = batchTableJson[key];
            if (Array.isArray(val)) {
                columns[key] = val;
                const sample = val.find((v) => v !== null && v !== undefined);
                propertySchema[key] = {
                    encoding: 'json',
                    valueType: sample === undefined ? 'null' : Array.isArray(sample) ? 'array' : typeof sample,
                };
            } else if (val && typeof val === 'object' && typeof val.byteOffset === 'number') {
                const decoded = readBinaryProperty(batchTableBin, val, inferredCount);
                columns[key] = decoded || [];
                propertySchema[key] = {
                    encoding: 'binary',
                    componentType: val.componentType || 'UNKNOWN',
                    type: val.type || 'SCALAR',
                    byteOffset: val.byteOffset,
                };
            }
        }

        const features = new Array(inferredCount);
        for (let i = 0; i < inferredCount; i++) {
            const props = {};
            for (const key of keys) {
                const col = columns[key];
                props[key] = Array.isArray(col) && i < col.length ? col[i] : null;
            }
            features[i] = { batchId: i, properties: props };
        }

        return {
            batchLength: inferredCount,
            propertyNames: keys,
            propertySchema,
            features,
            extensions: batchTableJson?.extensions || null,
        };
    }

    function parseGlbSummary(bytes, offset, byteLength) {
        if (byteLength < 12 || offset + byteLength > bytes.byteLength) {
            return null;
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, byteLength);
        const magic = view.getUint32(0, true);
        if (magic !== GLB_MAGIC) {
            return null;
        }
        const version = view.getUint32(4, true);
        const declaredLength = view.getUint32(8, true);

        let cursor = 12;
        let gltfJson = null;
        let binByteLength = 0;

        while (cursor + 8 <= Math.min(byteLength, declaredLength)) {
            const chunkLen = view.getUint32(cursor, true);
            const chunkType = view.getUint32(cursor + 4, true);
            const dataStart = offset + cursor + 8;
            if (cursor + 8 + chunkLen > byteLength) break;

            if (chunkType === GLB_CHUNK_JSON && !gltfJson) {
                try {
                    gltfJson = parseJsonSection(bytes, dataStart, chunkLen);
                } catch (_) {
                    gltfJson = null;
                }
            } else if (chunkType === GLB_CHUNK_BIN) {
                binByteLength += chunkLen;
            }
            cursor += 8 + chunkLen;
        }

        if (!gltfJson) {
            return { version, byteLength: declaredLength, binByteLength, gltf: null };
        }

        const meshes = Array.isArray(gltfJson.meshes) ? gltfJson.meshes : [];
        const accessors = Array.isArray(gltfJson.accessors) ? gltfJson.accessors : [];
        let primitiveCount = 0;
        let vertexCount = 0;
        let triangleCount = 0;
        let positionBounds = null;

        for (const mesh of meshes) {
            for (const prim of mesh.primitives || []) {
                primitiveCount++;
                const posIdx = prim.attributes?.POSITION;
                if (typeof posIdx === 'number' && accessors[posIdx]) {
                    const acc = accessors[posIdx];
                    vertexCount += Number(acc.count || 0);
                    if (Array.isArray(acc.min) && Array.isArray(acc.max) && acc.min.length >= 3 && acc.max.length >= 3) {
                        if (!positionBounds) {
                            positionBounds = { min: acc.min.slice(0, 3), max: acc.max.slice(0, 3) };
                        } else {
                            for (let axis = 0; axis < 3; axis++) {
                                positionBounds.min[axis] = Math.min(positionBounds.min[axis], acc.min[axis]);
                                positionBounds.max[axis] = Math.max(positionBounds.max[axis], acc.max[axis]);
                            }
                        }
                    }
                }
                const mode = prim.mode === undefined ? 4 : prim.mode; // 4 = TRIANGLES
                if (mode === 4) {
                    if (typeof prim.indices === 'number' && accessors[prim.indices]) {
                        triangleCount += Math.floor(Number(accessors[prim.indices].count || 0) / 3);
                    } else if (typeof posIdx === 'number' && accessors[posIdx]) {
                        triangleCount += Math.floor(Number(accessors[posIdx].count || 0) / 3);
                    }
                }
            }
        }

        const structuralMeta =
            gltfJson.extensions?.EXT_structural_metadata ||
            gltfJson.extensions?.EXT_feature_metadata ||
            null;

        return {
            version,
            byteLength: declaredLength,
            binByteLength,
            asset: gltfJson.asset || null,
            meshCount: meshes.length,
            primitiveCount,
            nodeCount: Array.isArray(gltfJson.nodes) ? gltfJson.nodes.length : 0,
            materialCount: Array.isArray(gltfJson.materials) ? gltfJson.materials.length : 0,
            textureCount: Array.isArray(gltfJson.textures) ? gltfJson.textures.length : 0,
            imageCount: Array.isArray(gltfJson.images) ? gltfJson.images.length : 0,
            vertexCount,
            triangleCount,
            positionBounds,
            extensionsUsed: Array.isArray(gltfJson.extensionsUsed) ? gltfJson.extensionsUsed : [],
            hasStructuralMetadata: Boolean(structuralMeta),
            structuralMetadataClasses: structuralMeta?.schema?.classes
                ? Object.keys(structuralMeta.schema.classes)
                : [],
        };
    }

    class B3DMFeatureExtractor {
        constructor() {
            this.cache = new Map();
            this.maxCacheEntries = 64;
        }

        /**
         * Parse any 3D Tiles binary buffer (`.b3dm`, `.i3dm`, `.pnts`, `.cmpt`, or `.glb`).
         * @param {ArrayBuffer|Uint8Array} buffer
         * @returns {object}
         */
        parseTileBuffer(buffer) {
            const bytes = toUint8Array(buffer);
            if (bytes.byteLength < 12) {
                throw new Error(`Tile buffer too small (${bytes.byteLength} bytes)`);
            }
            const magic = decodeUtf8(bytes, 0, 4);
            switch (magic) {
                case 'b3dm':
                    return this.parseB3dm(bytes);
                case 'i3dm':
                    return this.parseI3dm(bytes);
                case 'pnts':
                    return this.parsePnts(bytes);
                case 'cmpt':
                    return this.parseCmpt(bytes);
                case 'glTF':
                    return this.parseGlb(bytes);
                default:
                    throw new Error(`Unsupported 3D tile magic header: "${magic}"`);
            }
        }

        parseB3dm(input) {
            const bytes = toUint8Array(input);
            if (bytes.byteLength < 28) {
                throw new Error('Invalid B3DM: buffer shorter than 28-byte header');
            }
            const magic = decodeUtf8(bytes, 0, 4);
            if (magic !== 'b3dm') {
                throw new Error(`Invalid B3DM magic: "${magic}"`);
            }
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const version = view.getUint32(4, true);
            const byteLength = view.getUint32(8, true);
            const ftJsonLen = view.getUint32(12, true);
            const ftBinLen = view.getUint32(16, true);
            const btJsonLen = view.getUint32(20, true);
            const btBinLen = view.getUint32(24, true);

            const headerSize = 28;
            const sectionsEnd = headerSize + ftJsonLen + ftBinLen + btJsonLen + btBinLen;
            if (byteLength > bytes.byteLength || sectionsEnd > byteLength) {
                throw new Error('Invalid B3DM: declared section lengths exceed buffer bounds');
            }

            const ftJsonStart = headerSize;
            const ftBinStart = ftJsonStart + ftJsonLen;
            const btJsonStart = ftBinStart + ftBinLen;
            const btBinStart = btJsonStart + btJsonLen;
            const glbStart = btBinStart + btBinLen;
            const glbLen = byteLength - glbStart;

            const featureTable = parseJsonSection(bytes, ftJsonStart, ftJsonLen);
            const featureTableBin = bytes.subarray(ftBinStart, ftBinStart + ftBinLen);
            const batchTableJson = parseJsonSection(bytes, btJsonStart, btJsonLen);
            const batchTableBin = bytes.subarray(btBinStart, btBinStart + btBinLen);

            let batchLength = Number(featureTable.BATCH_LENGTH ?? 0);
            if (
                featureTable.BATCH_LENGTH &&
                typeof featureTable.BATCH_LENGTH === 'object' &&
                typeof featureTable.BATCH_LENGTH.byteOffset === 'number'
            ) {
                const arr = readBinaryProperty(
                    featureTableBin,
                    { type: 'SCALAR', componentType: 'UNSIGNED_INT', byteOffset: featureTable.BATCH_LENGTH.byteOffset },
                    1
                );
                batchLength = arr ? arr[0] : 0;
            }

            let rtcCenter = null;
            if (Array.isArray(featureTable.RTC_CENTER) && featureTable.RTC_CENTER.length === 3) {
                rtcCenter = featureTable.RTC_CENTER.map(Number);
            } else if (featureTable.RTC_CENTER && typeof featureTable.RTC_CENTER.byteOffset === 'number') {
                const decoded = readBinaryProperty(
                    featureTableBin,
                    { type: 'VEC3', componentType: 'FLOAT', byteOffset: featureTable.RTC_CENTER.byteOffset },
                    1
                );
                rtcCenter = decoded ? decoded[0] : null;
            }

            const batchData = decodeBatchTableFeatures(batchTableJson, batchTableBin, batchLength);
            const gltf = glbLen >= 12 ? parseGlbSummary(bytes, glbStart, glbLen) : null;

            return {
                format: 'b3dm',
                version,
                byteLength,
                header: {
                    magic,
                    version,
                    byteLength,
                    featureTableJSONByteLength: ftJsonLen,
                    featureTableBinaryByteLength: ftBinLen,
                    batchTableJSONByteLength: btJsonLen,
                    batchTableBinaryByteLength: btBinLen,
                    glbByteLength: glbLen,
                },
                rtcCenter,
                featureCount: batchData.batchLength,
                propertyNames: batchData.propertyNames,
                propertySchema: batchData.propertySchema,
                features: batchData.features,
                featureTable,
                batchTableExtensions: batchData.extensions,
                gltf,
            };
        }

        parseI3dm(input) {
            const bytes = toUint8Array(input);
            if (bytes.byteLength < 32) {
                throw new Error('Invalid I3DM: buffer shorter than 32-byte header');
            }
            const magic = decodeUtf8(bytes, 0, 4);
            if (magic !== 'i3dm') {
                throw new Error(`Invalid I3DM magic: "${magic}"`);
            }
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const version = view.getUint32(4, true);
            const byteLength = view.getUint32(8, true);
            const ftJsonLen = view.getUint32(12, true);
            const ftBinLen = view.getUint32(16, true);
            const btJsonLen = view.getUint32(20, true);
            const btBinLen = view.getUint32(24, true);
            const gltfFormat = view.getUint32(28, true);

            const headerSize = 32;
            const sectionsEnd = headerSize + ftJsonLen + ftBinLen + btJsonLen + btBinLen;
            if (byteLength > bytes.byteLength || sectionsEnd > byteLength) {
                throw new Error('Invalid I3DM: declared section lengths exceed buffer bounds');
            }

            const ftJsonStart = headerSize;
            const ftBinStart = ftJsonStart + ftJsonLen;
            const btJsonStart = ftBinStart + ftBinLen;
            const btBinStart = btJsonStart + btJsonLen;
            const bodyStart = btBinStart + btBinLen;
            const bodyLen = byteLength - bodyStart;

            const featureTable = parseJsonSection(bytes, ftJsonStart, ftJsonLen);
            const batchTableJson = parseJsonSection(bytes, btJsonStart, btJsonLen);
            const batchTableBin = bytes.subarray(btBinStart, btBinStart + btBinLen);

            const instancesLength = Number(featureTable.INSTANCES_LENGTH ?? 0);
            const batchData = decodeBatchTableFeatures(batchTableJson, batchTableBin, instancesLength);

            let gltf = null;
            let gltfUri = null;
            if (gltfFormat === 1 && bodyLen >= 12) {
                gltf = parseGlbSummary(bytes, bodyStart, bodyLen);
            } else if (gltfFormat === 0 && bodyLen > 0) {
                gltfUri = decodeUtf8(bytes, bodyStart, bodyLen).replace(/\0+$/g, '').trim();
            }

            return {
                format: 'i3dm',
                version,
                byteLength,
                gltfFormat,
                gltfUri,
                instancesLength,
                featureCount: batchData.batchLength || instancesLength,
                propertyNames: batchData.propertyNames,
                propertySchema: batchData.propertySchema,
                features: batchData.features,
                featureTable,
                gltf,
            };
        }

        parsePnts(input) {
            const bytes = toUint8Array(input);
            if (bytes.byteLength < 28) {
                throw new Error('Invalid PNTS: buffer shorter than 28-byte header');
            }
            const magic = decodeUtf8(bytes, 0, 4);
            if (magic !== 'pnts') {
                throw new Error(`Invalid PNTS magic: "${magic}"`);
            }
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const version = view.getUint32(4, true);
            const byteLength = view.getUint32(8, true);
            const ftJsonLen = view.getUint32(12, true);
            const ftBinLen = view.getUint32(16, true);
            const btJsonLen = view.getUint32(20, true);
            const btBinLen = view.getUint32(24, true);

            const headerSize = 28;
            const sectionsEnd = headerSize + ftJsonLen + ftBinLen + btJsonLen + btBinLen;
            if (byteLength > bytes.byteLength || sectionsEnd > byteLength) {
                throw new Error('Invalid PNTS: declared section lengths exceed buffer bounds');
            }

            const ftJsonStart = headerSize;
            const ftBinStart = ftJsonStart + ftJsonLen;
            const btJsonStart = ftBinStart + ftBinLen;
            const btBinStart = btJsonStart + btBinLen;

            const featureTable = parseJsonSection(bytes, ftJsonStart, ftJsonLen);
            const batchTableJson = parseJsonSection(bytes, btJsonStart, btJsonLen);
            const batchTableBin = bytes.subarray(btBinStart, btBinStart + btBinLen);

            const pointsLength = Number(featureTable.POINTS_LENGTH ?? 0);
            const batchLength = Number(featureTable.BATCH_LENGTH ?? 0);
            const batchData = decodeBatchTableFeatures(
                batchTableJson,
                batchTableBin,
                batchLength > 0 ? batchLength : 0
            );

            const semantics = Object.keys(featureTable).filter(
                (k) => !['POINTS_LENGTH', 'BATCH_LENGTH', 'extensions', 'extras'].includes(k)
            );

            return {
                format: 'pnts',
                version,
                byteLength,
                pointsLength,
                batchLength,
                rtcCenter: Array.isArray(featureTable.RTC_CENTER) ? featureTable.RTC_CENTER.map(Number) : null,
                semantics,
                hasColors: Boolean(featureTable.RGB || featureTable.RGBA || featureTable.RGB565 || featureTable.CONSTANT_RGBA),
                hasNormals: Boolean(featureTable.NORMAL || featureTable.NORMAL_OCT16P),
                featureCount: batchData.batchLength || pointsLength,
                propertyNames: batchData.propertyNames,
                propertySchema: batchData.propertySchema,
                features: batchData.features,
                featureTable,
            };
        }

        parseCmpt(input) {
            const bytes = toUint8Array(input);
            if (bytes.byteLength < 16) {
                throw new Error('Invalid CMPT: buffer shorter than 16-byte header');
            }
            const magic = decodeUtf8(bytes, 0, 4);
            if (magic !== 'cmpt') {
                throw new Error(`Invalid CMPT magic: "${magic}"`);
            }
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const version = view.getUint32(4, true);
            const byteLength = view.getUint32(8, true);
            const tilesLength = view.getUint32(12, true);
            if (byteLength > bytes.byteLength) {
                throw new Error('Invalid CMPT: declared byteLength exceeds buffer bounds');
            }

            const innerTiles = [];
            const allFeatures = [];
            const propSet = new Set();
            let cursor = 16;

            for (let i = 0; i < tilesLength && cursor + 12 <= byteLength; i++) {
                const subLen = view.getUint32(cursor + 8, true);
                if (subLen < 12 || cursor + subLen > byteLength) {
                    throw new Error(`Invalid CMPT inner tile #${i} byteLength (${subLen})`);
                }
                const subSlice = bytes.subarray(cursor, cursor + subLen);
                const parsed = this.parseTileBuffer(subSlice);
                innerTiles.push(parsed);
                for (const p of parsed.propertyNames || []) propSet.add(p);
                for (const f of parsed.features || []) {
                    allFeatures.push({ ...f, innerTileIndex: i, innerFormat: parsed.format });
                }
                cursor += subLen;
            }

            return {
                format: 'cmpt',
                version,
                byteLength,
                tilesLength,
                innerTiles,
                featureCount: innerTiles.reduce((sum, t) => sum + (t.featureCount || 0), 0),
                propertyNames: [...propSet],
                features: allFeatures,
            };
        }

        parseGlb(input) {
            const bytes = toUint8Array(input);
            const summary = parseGlbSummary(bytes, 0, bytes.byteLength);
            if (!summary) {
                throw new Error('Invalid GLB binary buffer');
            }
            return {
                format: 'glb',
                version: summary.version,
                byteLength: summary.byteLength,
                featureCount: 0,
                propertyNames: summary.structuralMetadataClasses || [],
                features: [],
                gltf: summary,
            };
        }

        /**
         * Fetch and parse a binary tile from a URL or local filesystem path (via `pathResolver`).
         * @param {string} urlOrPath
         * @param {{ useCache?: boolean }} [opts]
         */
        async extractFromUrl(urlOrPath, opts = {}) {
            if (!urlOrPath || typeof urlOrPath !== 'string') {
                throw new Error('Tile URL or path is required');
            }
            const useCache = opts.useCache !== false;
            if (useCache && this.cache.has(urlOrPath)) {
                return this.cache.get(urlOrPath);
            }

            let resolvedUrl = urlOrPath;
            if (root.pathResolver && typeof root.pathResolver.resolvePath === 'function') {
                resolvedUrl = await root.pathResolver.resolvePath(urlOrPath);
            }

            const resp = await fetch(resolvedUrl);
            if (!resp.ok) {
                throw new Error(`Failed to fetch tile (${resp.status} ${resp.statusText}): ${urlOrPath}`);
            }
            const buf = await resp.arrayBuffer();
            const parsed = this.parseTileBuffer(buf);
            parsed.sourceUrl = urlOrPath;

            if (useCache) {
                if (this.cache.size >= this.maxCacheEntries) {
                    const firstKey = this.cache.keys().next().value;
                    this.cache.delete(firstKey);
                }
                this.cache.set(urlOrPath, parsed);
            }
            return parsed;
        }

        /**
         * Extract batch-table features and structural summary from a live `Cesium3DTile`
         * or `Cesium3DTileContent` (supports composite content recursively).
         * @param {object} tileOrContent
         */
        extractFromCesiumTile(tileOrContent) {
            if (!tileOrContent) return null;
            const content = tileOrContent.content || tileOrContent;
            const uri =
                tileOrContent._contentResource?.url ||
                content?._resource?.url ||
                tileOrContent.contentUri ||
                null;

            const features = [];
            const propSet = new Set();

            const collectContent = (c, depth = 0) => {
                if (!c || depth > 6) return;
                if (Array.isArray(c.innerContents) && c.innerContents.length > 0) {
                    c.innerContents.forEach((inner) => collectContent(inner, depth + 1));
                    return;
                }
                const len = Number(c.featuresLength || 0);
                for (let i = 0; i < len; i++) {
                    try {
                        const feat = c.getFeature(i);
                        if (!feat) continue;
                        const ids = typeof feat.getPropertyIds === 'function' ? feat.getPropertyIds() || [] : [];
                        const props = {};
                        for (const id of ids) {
                            propSet.add(id);
                            props[id] = feat.getProperty(id);
                        }
                        features.push({ batchId: i, properties: props });
                    } catch (_) {
                        /* skip inaccessible feature */
                    }
                }
            };

            collectContent(content);

            return {
                format: this._inferFormatFromUri(uri),
                sourceUrl: uri,
                featureCount: features.length,
                pointsLength: Number(content?.pointsLength || 0),
                trianglesLength: Number(content?.trianglesLength || 0),
                geometryByteLength: Number(content?.geometryByteLength || 0),
                texturesByteLength: Number(content?.texturesByteLength || 0),
                batchTableByteLength: Number(content?.batchTableByteLength || 0),
                geometricError:
                    typeof tileOrContent.geometricError === 'number' ? tileOrContent.geometricError : null,
                propertyNames: [...propSet],
                features,
            };
        }

        /**
         * Compute statistical summary (min/max/mean for numbers, distinct counts for strings)
         * across extracted tile features for the Tile Inspector and Metadata tabs.
         */
        summarizeFeatures(extractionResult) {
            const features = Array.isArray(extractionResult?.features) ? extractionResult.features : [];
            const propertyNames = Array.isArray(extractionResult?.propertyNames)
                ? extractionResult.propertyNames
                : [];
            const stats = {};

            for (const name of propertyNames) {
                let count = 0;
                let nullCount = 0;
                let numCount = 0;
                let min = Infinity;
                let max = -Infinity;
                let sum = 0;
                const distinct = new Set();

                for (const f of features) {
                    const val = f?.properties?.[name];
                    if (val === null || val === undefined) {
                        nullCount++;
                        continue;
                    }
                    count++;
                    if (typeof val === 'number' && Number.isFinite(val)) {
                        numCount++;
                        if (val < min) min = val;
                        if (val > max) max = val;
                        sum += val;
                    }
                    if (distinct.size < 100) {
                        distinct.add(typeof val === 'object' ? JSON.stringify(val) : String(val));
                    }
                }

                stats[name] = {
                    count,
                    nullCount,
                    distinctCount: distinct.size,
                    isNumeric: numCount > 0 && numCount === count,
                    min: numCount > 0 ? min : null,
                    max: numCount > 0 ? max : null,
                    mean: numCount > 0 ? Number((sum / numCount).toFixed(4)) : null,
                    sampleValues: [...distinct].slice(0, 5),
                };
            }

            return {
                format: extractionResult?.format || 'unknown',
                featureCount: extractionResult?.featureCount || features.length,
                propertyCount: propertyNames.length,
                properties: stats,
                gltf: extractionResult?.gltf || null,
            };
        }

        clearCache() {
            this.cache.clear();
        }

        _inferFormatFromUri(uri) {
            if (!uri || typeof uri !== 'string') return 'tile';
            const clean = uri.split('?')[0].toLowerCase();
            for (const ext of ['b3dm', 'i3dm', 'pnts', 'cmpt', 'glb', 'gltf']) {
                if (clean.endsWith(`.${ext}`)) return ext;
            }
            return 'tile';
        }
    }

    const instance = new B3DMFeatureExtractor();

    if (root && typeof root === 'object') {
        root.B3DMFeatureExtractor = B3DMFeatureExtractor;
        root.b3dmFeatureExtractor = instance;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            B3DMFeatureExtractor,
            b3dmFeatureExtractor: instance,
            readBinaryProperty,
            decodeBatchTableFeatures,
            parseGlbSummary,
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
