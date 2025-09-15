/**
 * Base SQLite storage implementation for ShareDB
 *
 * This class implements the DurableStorage interface from ShareDB,
 * providing SQLite-based persistence for offline-first applications.
 */
import { DurableStorage, DurableStorageCallback, DurableStorageRecord, DurableStorageRecords, SqliteAdapter, SchemaStrategy, SqliteStorageOptions } from './interfaces';
export declare class SqliteStorage implements DurableStorage {
    protected adapter: SqliteAdapter;
    protected schemaStrategy: SchemaStrategy;
    protected ready: boolean;
    protected debug: boolean;
    protected initializationPromise?: Promise<void>;
    constructor(options: SqliteStorageOptions);
    /**
     * Create a default schema strategy if none provided
     * Subclasses can override this to provide platform-specific defaults
     */
    protected createDefaultStrategy(): SchemaStrategy;
    /**
     * Initialize the storage system
     */
    initialize(callback: DurableStorageCallback): void;
    protected initializeAsync(): Promise<void>;
    /**
     * Read a single record from storage
     */
    readRecord(storeName: string, id: string, callback: DurableStorageCallback<any>): void;
    /**
     * Read all records from a store
     */
    readAllRecords(storeName: string, callback: DurableStorageCallback<DurableStorageRecord[]>): void;
    /**
     * Read multiple records by ID (bulk operation)
     */
    readRecordsBulk?(storeName: string, ids: string[], callback: DurableStorageCallback<DurableStorageRecord[]>): void;
    /**
     * Write records to storage
     */
    writeRecords(records: DurableStorageRecords, callback: DurableStorageCallback): void;
    /**
     * Delete a record from storage
     */
    deleteRecord(storeName: string, id: string, callback: DurableStorageCallback): void;
    /**
     * Clear all records from a specific store
     */
    clearStore(storeName: string, callback: DurableStorageCallback): void;
    /**
     * Clear all data from storage
     */
    clearAll(callback: DurableStorageCallback): void;
    /**
     * Close the storage connection
     */
    close?(callback: DurableStorageCallback): void;
    /**
     * Check if storage is ready
     */
    isReady(): boolean;
    /**
     * Ensure storage is ready (throw if not)
     */
    ensureReady(): void;
    /**
     * Update inventory for a specific document
     */
    updateInventory(collection: string, docId: string, version: number | string, operation: string, callback: DurableStorageCallback): void;
    /**
     * Read the full inventory
     */
    readInventory(callback: DurableStorageCallback<DurableStorageRecord>): void;
    /**
     * Delete the database (if supported by adapter)
     */
    deleteDatabase?(callback: DurableStorageCallback): void;
}
//# sourceMappingURL=SqliteStorage.d.ts.map