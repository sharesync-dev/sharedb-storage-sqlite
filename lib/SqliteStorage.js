"use strict";
/**
 * Base SQLite storage implementation for ShareDB
 *
 * This class implements the DurableStorage interface from ShareDB,
 * providing SQLite-based persistence for offline-first applications.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteStorage = void 0;
class SqliteStorage {
    constructor(options) {
        this.ready = false;
        if (!options.adapter) {
            throw new Error('SqliteStorage requires an adapter');
        }
        this.adapter = options.adapter;
        this.schemaStrategy = options.schemaStrategy || this.createDefaultStrategy();
        this.debug = options.debug || false;
    }
    /**
     * Create a default schema strategy if none provided
     * Subclasses can override this to provide platform-specific defaults
     */
    createDefaultStrategy() {
        throw new Error('No schema strategy provided and no default available');
    }
    /**
     * Initialize the storage system
     */
    initialize(callback) {
        if (this.ready) {
            callback(null);
            return;
        }
        if (this.initializationPromise) {
            this.initializationPromise
                .then(() => callback(null))
                .catch(error => callback(error));
            return;
        }
        this.initializationPromise = this.initializeAsync();
        this.initializationPromise
            .then(() => {
            this.ready = true;
            callback(null);
        })
            .catch(error => {
            console.error('[SqliteStorage] Initialization error:', error);
            callback(error);
        });
    }
    async initializeAsync() {
        const startTime = Date.now();
        // Connect to database
        await this.adapter.connect();
        this.debug && console.log('[SqliteStorage] Database connected');
        // Initialize schema
        await this.schemaStrategy.initializeSchema(this.adapter);
        this.debug && console.log('[SqliteStorage] Schema initialized');
        // Read initial inventory
        const inventory = await this.schemaStrategy.readInventory(this.adapter);
        this.debug && console.log('[SqliteStorage] Inventory loaded');
        const elapsed = Date.now() - startTime;
        this.debug && console.log(`[SqliteStorage] Initialized in ${elapsed}ms`);
    }
    /**
     * Read a single record from storage
     */
    readRecord(storeName, id, callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        // Map storeName to type for schema strategy
        const type = storeName === 'meta' ? 'meta' : 'docs';
        const collection = storeName === 'meta' ? null : storeName;
        this.schemaStrategy.readRecord(this.adapter, type, collection, id)
            .then(record => {
            callback(null, record?.payload);
        })
            .catch(error => {
            callback(error);
        });
    }
    /**
     * Read all records from a store
     */
    readAllRecords(storeName, callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        const type = storeName === 'meta' ? 'meta' : 'docs';
        const collection = storeName === 'meta' ? null : storeName;
        this.schemaStrategy.readAllRecords(this.adapter, type, collection)
            .then(records => {
            callback(null, records);
        })
            .catch(error => {
            callback(error);
        });
    }
    /**
     * Read multiple records by ID (bulk operation)
     */
    readRecordsBulk(storeName, ids, callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        if (!this.schemaStrategy.readRecordsBulk) {
            // Fall back to individual reads if bulk not supported
            const promises = ids.map(id => this.schemaStrategy.readRecord(this.adapter, 'docs', storeName, id));
            Promise.all(promises)
                .then(records => {
                const validRecords = records.filter(r => r !== null);
                callback(null, validRecords);
            })
                .catch(error => {
                callback(error);
            });
            return;
        }
        this.schemaStrategy.readRecordsBulk(this.adapter, 'docs', storeName, ids)
            .then(records => {
            callback(null, records);
        })
            .catch(error => {
            callback(error);
        });
    }
    /**
     * Write records to storage
     */
    writeRecords(records, callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        this.schemaStrategy.writeRecords(this.adapter, records)
            .then(() => {
            callback(null);
        })
            .catch(error => {
            callback(error);
        });
    }
    /**
     * Delete a record from storage
     */
    deleteRecord(storeName, id, callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        const type = storeName === 'meta' ? 'meta' : 'docs';
        const collection = storeName === 'meta' ? null : storeName;
        this.schemaStrategy.deleteRecord(this.adapter, type, collection, id)
            .then(() => {
            callback(null);
        })
            .catch(error => {
            callback(error);
        });
    }
    /**
     * Clear all records from a specific store
     */
    clearStore(storeName, callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        if (this.schemaStrategy.clearStore) {
            this.schemaStrategy.clearStore(this.adapter, storeName)
                .then(() => callback(null))
                .catch(error => callback(error));
        }
        else {
            // Default implementation: read all and delete each
            this.readAllRecords(storeName, (error, records) => {
                if (error) {
                    callback(error);
                    return;
                }
                const deletePromises = (records || []).map(record => new Promise((resolve, reject) => {
                    this.deleteRecord(storeName, record.id, err => {
                        if (err)
                            reject(err);
                        else
                            resolve();
                    });
                }));
                Promise.all(deletePromises)
                    .then(() => callback(null))
                    .catch(error => callback(error));
            });
        }
    }
    /**
     * Clear all data from storage
     */
    clearAll(callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        if (this.schemaStrategy.clearAll) {
            this.schemaStrategy.clearAll(this.adapter)
                .then(() => callback(null))
                .catch(error => callback(error));
        }
        else {
            // Default: delete all tables
            this.schemaStrategy.deleteAllTables(this.adapter)
                .then(() => callback(null))
                .catch(error => callback(error));
        }
    }
    /**
     * Close the storage connection
     */
    close(callback) {
        this.adapter.disconnect()
            .then(() => {
            this.ready = false;
            callback(null);
        })
            .catch(error => {
            callback(error);
        });
    }
    /**
     * Check if storage is ready
     */
    isReady() {
        return this.ready;
    }
    /**
     * Ensure storage is ready (throw if not)
     */
    ensureReady() {
        if (!this.ready) {
            throw new Error('Storage not initialized. Call initialize() first.');
        }
    }
    /**
     * Update inventory for a specific document
     */
    updateInventory(collection, docId, version, operation, callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        this.schemaStrategy.updateInventoryItem(this.adapter, collection, docId, version, operation)
            .then(() => callback(null))
            .catch(error => callback(error));
    }
    /**
     * Read the full inventory
     */
    readInventory(callback) {
        if (!this.ready) {
            callback(new Error('Storage not initialized'));
            return;
        }
        this.schemaStrategy.readInventory(this.adapter)
            .then(inventory => callback(null, inventory))
            .catch(error => callback(error));
    }
    /**
     * Delete the database (if supported by adapter)
     */
    deleteDatabase(callback) {
        this.schemaStrategy.deleteAllTables(this.adapter)
            .then(() => callback(null))
            .catch(error => callback(error));
    }
}
exports.SqliteStorage = SqliteStorage;
//# sourceMappingURL=SqliteStorage.js.map