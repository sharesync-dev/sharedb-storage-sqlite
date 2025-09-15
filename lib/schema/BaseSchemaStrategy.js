"use strict";
/**
 * Base class for SQLite schema strategies.
 * Schema strategies define how data is organized in SQLite tables,
 * how encryption is applied, and how queries are optimized.
 *
 * All schema strategies must extend this base class and implement
 * the required methods.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSchemaStrategy = void 0;
class BaseSchemaStrategy {
    constructor(options = {}) {
        this.options = options;
        this.debug = options.debug || false;
    }
    /**
     * Determine if a specific field should be encrypted
     */
    shouldEncryptField(collection, fieldPath) {
        // Default: no field-level encryption
        return false;
    }
    /**
     * Apply encryption strategy to a record
     */
    encryptRecord(record, collection, encryptCallback) {
        // Default implementation: encrypt entire payload if encryption is enabled
        if (!encryptCallback)
            return record;
        return {
            id: record.id,
            encrypted_payload: encryptCallback(JSON.stringify(record.payload)),
        };
    }
    /**
     * Apply decryption strategy to a record
     */
    decryptRecord(record, collection, decryptCallback) {
        // Default implementation: decrypt entire payload if encrypted
        if (!decryptCallback || !record.encrypted_payload)
            return record;
        return {
            id: record.id,
            payload: JSON.parse(decryptCallback(record.encrypted_payload)),
        };
    }
    /**
     * Create indexes for optimized queries
     */
    async createIndexes(db, collection, callback) {
        // Default: no additional indexes
        callback?.();
    }
    /**
     * Migrate schema from one version to another
     */
    async migrateSchema(db, fromVersion, toVersion, callback) {
        // Default: no migration needed
        callback?.();
    }
}
exports.BaseSchemaStrategy = BaseSchemaStrategy;
//# sourceMappingURL=BaseSchemaStrategy.js.map