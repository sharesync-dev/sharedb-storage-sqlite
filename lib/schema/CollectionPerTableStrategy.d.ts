/**
 * Schema strategy that creates a separate table for each collection.
 * This allows for:
 * - Collection-specific indexes
 * - Field-level encryption configuration per collection
 * - Optimized queries per collection
 * - Better performance for large collections
 * - Relational projections for array fields
 */
import { BaseSchemaStrategy, SchemaStrategyOptions, DatabaseConnection, StorageRecord, StorageRecords, StorageCallback, CollectionConfig, ArrayProjectionConfig } from './BaseSchemaStrategy';
export declare class CollectionPerTableStrategy extends BaseSchemaStrategy {
    protected useEncryption: boolean;
    protected encryptionCallback?: (text: string) => string;
    protected decryptionCallback?: (encrypted: string) => string;
    protected collectionConfig: Record<string, CollectionConfig>;
    protected createdTables: Record<string, boolean>;
    protected projectionsByCollection: Record<string, ArrayProjectionConfig[]>;
    protected disableTransactions?: boolean;
    constructor(options?: SchemaStrategyOptions);
    /**
     * Parse projections from collection configuration
     */
    protected parseProjections(collectionConfig: Record<string, CollectionConfig>): Record<string, ArrayProjectionConfig[]>;
    /**
     * Initialize the schema - creates meta table, inventory table, and any pre-configured collection tables
     */
    initializeSchema(db: DatabaseConnection, callback?: StorageCallback): Promise<void>;
    /**
     * Create a table for a specific collection with its indexes
     */
    createCollectionTable(db: DatabaseConnection, collection: string): Promise<void>;
    /**
     * Create projection tables for a collection
     */
    createProjectionTables(db: DatabaseConnection, collection: string): Promise<void>;
    /**
     * Update projections when a record is written
     */
    updateProjections(db: DatabaseConnection, collection: string, newRecord: StorageRecord, oldRecord?: StorageRecord | null): Promise<void>;
    /**
     * Update an array expansion projection
     */
    updateArrayExpansionProjection(db: DatabaseConnection, projection: ArrayProjectionConfig, newRecord: StorageRecord, oldRecord?: StorageRecord | null): Promise<void>;
    /**
     * Delete projections when a record is deleted
     */
    deleteProjections(db: DatabaseConnection, collection: string, recordId: string): Promise<void>;
    /**
     * Helper to extract nested value from object using dot notation path
     */
    protected getNestedValue(obj: any, path: string): any;
    /**
     * Helper to run async SQL with consistent promise handling
     */
    protected runAsync(db: DatabaseConnection, sql: string, params?: any[]): Promise<any>;
    /**
     * Validate that required tables exist
     */
    validateSchema(db: DatabaseConnection, callback?: StorageCallback<boolean>): Promise<boolean>;
    /**
     * Get table name for a collection
     */
    getTableName(collection: string): string;
    /**
     * Write records to collection-specific tables
     */
    writeRecords(db: DatabaseConnection, recordsByType: StorageRecords, callback?: StorageCallback): Promise<void>;
    /**
     * Read a single record from a collection-specific table
     */
    readRecord(db: DatabaseConnection, type: string, collection: string | null, id: string, callback?: StorageCallback<StorageRecord | null>): Promise<StorageRecord | null>;
    /**
     * Read all records of a given type
     */
    readAllRecords(db: DatabaseConnection, type: string, collection: string | null, callback?: StorageCallback<StorageRecord[]>): Promise<StorageRecord[]>;
    /**
     * Delete a record from a collection-specific table
     */
    deleteRecord(db: DatabaseConnection, type: string, collection: string | null, id: string, callback?: StorageCallback): Promise<void>;
    initializeInventory(db: DatabaseConnection, callback?: StorageCallback<StorageRecord>): Promise<StorageRecord>;
    readInventory(db: DatabaseConnection, callback?: StorageCallback<StorageRecord>): Promise<StorageRecord>;
    upsertInventoryItem(db: DatabaseConnection, collection: string, docId: string, version: number | string, callback?: StorageCallback): Promise<void>;
    deleteInventoryItem(db: DatabaseConnection, collection: string, docId: string, callback?: StorageCallback): Promise<void>;
    /**
     * @deprecated Use upsertInventoryItem or deleteInventoryItem instead
     */
    updateInventoryItem(db: DatabaseConnection, collection: string, docId: string, version: number | string, operation: string, callback?: StorageCallback): Promise<void>;
    getInventoryType(): string;
    deleteAllTables(db: DatabaseConnection, callback?: StorageCallback): Promise<void>;
    /**
     * Ensure a collection table exists before writing to it
     */
    ensureCollectionTable(db: DatabaseConnection, collection: string): Promise<void>;
}
//# sourceMappingURL=CollectionPerTableStrategy.d.ts.map