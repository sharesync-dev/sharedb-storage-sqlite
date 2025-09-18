/**
 * ShareDB SQLite Storage Interfaces
 *
 * This module defines the core interfaces for SQLite-based storage implementations
 * that are compatible with ShareDB's DurableStorage interface.
 */

// Import base types from ShareDB
// In practice, consumers will have @shaxpir/sharedb as a peer dependency
export interface DurableStorageCallback<T = any> {
  (error: Error | null, result?: T): void;
}

export interface DurableStorageRecord {
  id: string;
  payload: any;
}

export interface DurableStorageRecords {
  docs?: DurableStorageRecord | DurableStorageRecord[];
  meta?: DurableStorageRecord | DurableStorageRecord[];
}

/**
 * Base DurableStorage interface from ShareDB
 * SQLite implementations must implement this interface
 */
export interface DurableStorage {
  initialize(callback: DurableStorageCallback): void;
  readRecord(storeName: string, id: string, callback: DurableStorageCallback<any>): void;
  readAllRecords(storeName: string, callback: DurableStorageCallback<DurableStorageRecord[]>): void;
  readRecordsBulk?(storeName: string, ids: string[], callback: DurableStorageCallback<DurableStorageRecord[]>): void;
  writeRecords(records: DurableStorageRecords, callback: DurableStorageCallback): void;
  deleteRecord(storeName: string, id: string, callback: DurableStorageCallback): void;
  clearStore(storeName: string, callback: DurableStorageCallback): void;
  clearAll(callback: DurableStorageCallback): void;
  close?(callback: DurableStorageCallback): void;
  isReady?(): boolean;
  ensureReady?(): void;
}

/**
 * SQLite-specific database connection interface
 * Platform adapters (Node.js, React Native) must implement this
 */
export interface SqliteConnection {
  runAsync(sql: string, params?: any[]): Promise<any>;
  getFirstAsync(sql: string, params?: any[]): Promise<any>;
  getAllAsync(sql: string, params?: any[]): Promise<any[]>;
  transaction?<T>(operations: () => Promise<T>): Promise<T>;
}

/**
 * SQLite adapter interface
 * Wraps platform-specific SQLite implementations
 */
export interface SqliteAdapter extends SqliteConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly connected?: boolean;
}

/**
 * Schema strategy configuration
 */
export interface SchemaStrategyOptions {
  useEncryption?: boolean;
  encryptionCallback?: (text: string) => string;
  decryptionCallback?: (encrypted: string) => string;
  debug?: boolean;
  collectionConfig?: Record<string, CollectionConfig>;
  disableTransactions?: boolean;
}

/**
 * Collection configuration for indexes and projections
 */
export interface CollectionConfig {
  indexes: string[];
  encryptedFields: string[];
  projections?: ArrayProjectionConfig[];
}

/**
 * Column mapping configuration for projections
 */
export interface ProjectionColumnMapping {
  source: string | '@element';  // JSON path or '@element' for the array element itself
  dataType?: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB';  // SQLite datatype (default: TEXT)
}

/**
 * Index configuration for projection tables
 */
export interface ProjectionIndexConfig {
  columns: string[];  // Column(s) to index
  unique?: boolean;   // Create a unique index
  name?: string;      // Optional custom index name
}

/**
 * Array projection configuration for relational tables
 */
export interface ArrayProjectionConfig {
  type: 'array_expansion';
  targetTable: string;
  mapping: {
    [targetColumn: string]: string | ProjectionColumnMapping;  // Backwards compatible
  };
  arrayPath: string;
  primaryKey: string[];
  indexes?: ProjectionIndexConfig[];  // Additional indexes beyond the auto-generated PK indexes
}

/**
 * Schema strategy interface
 * Defines how data is organized in SQLite tables
 */
export interface SchemaStrategy {
  initializeSchema(db: SqliteConnection, callback?: DurableStorageCallback): Promise<void>;
  validateSchema(db: SqliteConnection, callback?: DurableStorageCallback<boolean>): Promise<boolean>;
  getTableName(collection: string): string;
  writeRecords(db: SqliteConnection, recordsByType: DurableStorageRecords, callback?: DurableStorageCallback): Promise<void>;
  readRecord(db: SqliteConnection, type: string, collection: string | null, id: string, callback?: DurableStorageCallback<DurableStorageRecord | null>): Promise<DurableStorageRecord | null>;
  readAllRecords(db: SqliteConnection, type: string, collection: string | null, callback?: DurableStorageCallback<DurableStorageRecord[]>): Promise<DurableStorageRecord[]>;
  readRecordsBulk?(db: SqliteConnection, type: string, collection: string, ids: string[], callback?: DurableStorageCallback<DurableStorageRecord[]>): Promise<DurableStorageRecord[]>;
  deleteRecord(db: SqliteConnection, type: string, collection: string | null, id: string, callback?: DurableStorageCallback): Promise<void>;
  clearStore?(db: SqliteConnection, storeName: string, callback?: DurableStorageCallback): Promise<void>;
  clearAll?(db: SqliteConnection, callback?: DurableStorageCallback): Promise<void>;
  initializeInventory(db: SqliteConnection, callback?: DurableStorageCallback<DurableStorageRecord>): Promise<DurableStorageRecord>;
  readInventory(db: SqliteConnection, callback?: DurableStorageCallback<DurableStorageRecord>): Promise<DurableStorageRecord>;
  updateInventoryItem(db: SqliteConnection, collection: string, docId: string, version: number | string, operation: string, callback?: DurableStorageCallback): Promise<void>;
  getInventoryType(): string;
  deleteAllTables(db: SqliteConnection, callback?: DurableStorageCallback): Promise<void>;
}

/**
 * SQLite storage configuration options
 */
export interface SqliteStorageOptions {
  adapter: SqliteAdapter;
  schemaStrategy?: SchemaStrategy;
  debug?: boolean;
}

/**
 * Attachment configuration for multi-database setups
 */
export interface DatabaseAttachment {
  path?: string;
  fileName?: string;
  dirPath?: string;
  alias: string;
  strategy?: SchemaStrategy;
}

/**
 * Main SqliteStorage class
 * Implements DurableStorage interface for ShareDB
 */
export declare class SqliteStorage implements DurableStorage {
  constructor(options: SqliteStorageOptions);
  initialize(callback: DurableStorageCallback): void;
  readRecord(storeName: string, id: string, callback: DurableStorageCallback<any>): void;
  readAllRecords(storeName: string, callback: DurableStorageCallback<DurableStorageRecord[]>): void;
  readRecordsBulk(storeName: string, ids: string[], callback: DurableStorageCallback<DurableStorageRecord[]>): void;
  writeRecords(records: DurableStorageRecords, callback: DurableStorageCallback): void;
  deleteRecord(storeName: string, id: string, callback: DurableStorageCallback): void;
  clearStore(storeName: string, callback: DurableStorageCallback): void;
  clearAll(callback: DurableStorageCallback): void;
  close(callback: DurableStorageCallback): void;
  isReady(): boolean;
}

/**
 * Base schema strategy class
 * Extended by concrete implementations
 */
export declare class BaseSchemaStrategy implements SchemaStrategy {
  constructor(options?: SchemaStrategyOptions);
  initializeSchema(db: SqliteConnection, callback?: DurableStorageCallback): Promise<void>;
  validateSchema(db: SqliteConnection, callback?: DurableStorageCallback<boolean>): Promise<boolean>;
  getTableName(collection: string): string;
  writeRecords(db: SqliteConnection, recordsByType: DurableStorageRecords, callback?: DurableStorageCallback): Promise<void>;
  readRecord(db: SqliteConnection, type: string, collection: string | null, id: string, callback?: DurableStorageCallback<DurableStorageRecord | null>): Promise<DurableStorageRecord | null>;
  readAllRecords(db: SqliteConnection, type: string, collection: string | null, callback?: DurableStorageCallback<DurableStorageRecord[]>): Promise<DurableStorageRecord[]>;
  readRecordsBulk(db: SqliteConnection, type: string, collection: string, ids: string[], callback?: DurableStorageCallback<DurableStorageRecord[]>): Promise<DurableStorageRecord[]>;
  deleteRecord(db: SqliteConnection, type: string, collection: string | null, id: string, callback?: DurableStorageCallback): Promise<void>;
  initializeInventory(db: SqliteConnection, callback?: DurableStorageCallback<DurableStorageRecord>): Promise<DurableStorageRecord>;
  readInventory(db: SqliteConnection, callback?: DurableStorageCallback<DurableStorageRecord>): Promise<DurableStorageRecord>;
  updateInventoryItem(db: SqliteConnection, collection: string, docId: string, version: number | string, operation: string, callback?: DurableStorageCallback): Promise<void>;
  getInventoryType(): string;
  deleteAllTables(db: SqliteConnection, callback?: DurableStorageCallback): Promise<void>;
}

/**
 * Default schema strategy
 * Uses single 'docs' and 'meta' tables for all collections
 * Stores inventory as JSON document in meta table
 */
export declare class DefaultSchemaStrategy extends BaseSchemaStrategy {
  constructor(options?: SchemaStrategyOptions & {
    schemaPrefix?: string;
    collectionMapping?: (collection: string) => string;
  });
}

/**
 * Collection-per-table schema strategy
 * Creates separate tables for each collection with projections
 * Stores inventory in dedicated table with indexes
 */
export declare class CollectionPerTableStrategy extends BaseSchemaStrategy {
  constructor(options?: SchemaStrategyOptions & {
    collectionConfig?: Record<string, CollectionConfig>;
  });
}

/**
 * Attached collection-per-table schema strategy options
 */
export interface AttachedCollectionPerTableStrategyOptions extends SchemaStrategyOptions {
  attachments?: DatabaseAttachment[];
  attachmentAlias?: string;
  createAdapterForPath?: (dbPath: string) => SqliteAdapter;
}

/**
 * Attached collection-per-table schema strategy
 * Similar to CollectionPerTableStrategy but optimized for attached databases
 * Uses different inventory schema for better multi-database support
 */
export declare class AttachedCollectionPerTableStrategy extends CollectionPerTableStrategy {
  readonly attachmentAlias: string | null;
  constructor(options?: AttachedCollectionPerTableStrategyOptions);
  preInitializeDatabase(dbPath: string, createAdapter: (dbPath: string) => SqliteAdapter): Promise<void>;
}

/**
 * Attached SQLite adapter configuration
 */
export interface AttachedSqliteAdapterConfig {
  attachments: DatabaseAttachment[];
}

/**
 * Attached SQLite adapter
 * Decorator that wraps any SqliteAdapter to add database attachment support
 * Enables cross-database queries through SQLite's ATTACH functionality
 */
export declare class AttachedSqliteAdapter implements SqliteAdapter {
  constructor(wrappedAdapter: SqliteAdapter, attachmentConfig: AttachedSqliteAdapterConfig, debug?: boolean);

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runAsync(sql: string, params?: any[]): Promise<any>;
  getFirstAsync(sql: string, params?: any[]): Promise<any>;
  getAllAsync(sql: string, params?: any[]): Promise<any[]>;
  transaction<T>(operations: () => Promise<T>): Promise<T>;

  isAttached(): boolean;
  getAttachedAliases(): string[];
  readonly connected?: boolean;
}

/**
 * JSON Path validation utility
 * Validates that JsonPath expressions in SQL queries follow ShareDB's nested structure
 */
export declare class JsonPathValidator {
  static validateJsonPaths(sql: string): string;
}

/**
 * Version constant
 */
export declare const VERSION: string;