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