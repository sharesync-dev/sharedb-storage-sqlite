/**
 * Base class for SQLite schema strategies.
 * Schema strategies define how data is organized in SQLite tables,
 * how encryption is applied, and how queries are optimized.
 *
 * All schema strategies must extend this base class and implement
 * the required methods.
 */

export interface DatabaseConnection {
  runAsync(sql: string, params?: any[]): Promise<any>;
  getFirstAsync(sql: string, params?: any[]): Promise<any>;
  getAllAsync(sql: string, params?: any[]): Promise<any[]>;
  transaction<T>(operations: () => Promise<T>): Promise<T>;
}

export interface StorageRecord {
  id: string;
  payload?: any;
  collection?: string;
  encrypted_payload?: string;
}

export interface StorageRecords {
  docs?: StorageRecord | StorageRecord[] | Record<string, StorageRecord[]>;
  meta?: StorageRecord | StorageRecord[];
}

export type StorageCallback<T = any> = (error?: Error | null, result?: T) => void;

export interface SchemaStrategyOptions {
  useEncryption?: boolean;
  encryptionCallback?: (text: string) => string;
  decryptionCallback?: (encrypted: string) => string;
  debug?: boolean;
  collectionConfig?: Record<string, CollectionConfig>;
}

export interface ArrayProjectionConfig {
  type: 'array_expansion';
  targetTable: string;
  mapping: {
    [targetColumn: string]: string; // JSON path or empty for array element
  };
  arrayPath: string;
  primaryKey: string[];
}

export interface CollectionConfig {
  indexes?: string[];
  encryptedFields?: string[];
  projections?: ArrayProjectionConfig[];
}

export abstract class BaseSchemaStrategy {
  protected options: SchemaStrategyOptions;
  protected debug: boolean;

  constructor(options: SchemaStrategyOptions = {}) {
    this.options = options;
    this.debug = options.debug || false;
  }

  /**
   * Initialize the schema (create tables, indexes, etc.)
   */
  abstract initializeSchema(db: DatabaseConnection, callback?: StorageCallback): Promise<void>;

  /**
   * Validate that the schema exists and is compatible
   */
  abstract validateSchema(db: DatabaseConnection, callback?: StorageCallback<boolean>): Promise<boolean>;

  /**
   * Get the table name for a given collection
   */
  abstract getTableName(collection: string): string;

  /**
   * Write records to the database
   */
  abstract writeRecords(db: DatabaseConnection, recordsByType: StorageRecords, callback?: StorageCallback): Promise<void>;

  /**
   * Read a single record from the database
   */
  abstract readRecord(
    db: DatabaseConnection,
    type: string,
    collection: string | null,
    id: string,
    callback?: StorageCallback<StorageRecord | null>
  ): Promise<StorageRecord | null>;

  /**
   * Read all records of a given type
   */
  abstract readAllRecords(
    db: DatabaseConnection,
    type: string,
    collection: string | null,
    callback?: StorageCallback<StorageRecord[]>
  ): Promise<StorageRecord[]>;

  /**
   * Delete a record from the database
   */
  abstract deleteRecord(
    db: DatabaseConnection,
    type: string,
    collection: string | null,
    id: string,
    callback?: StorageCallback
  ): Promise<void>;

  /**
   * Determine if a specific field should be encrypted
   */
  shouldEncryptField(collection: string, fieldPath: string): boolean {
    // Default: no field-level encryption
    return false;
  }

  /**
   * Apply encryption strategy to a record
   */
  encryptRecord(record: StorageRecord, collection: string, encryptCallback?: (text: string) => string): StorageRecord {
    // Default implementation: encrypt entire payload if encryption is enabled
    if (!encryptCallback) return record;

    return {
      id: record.id,
      encrypted_payload: encryptCallback(JSON.stringify(record.payload)),
    };
  }

  /**
   * Apply decryption strategy to a record
   */
  decryptRecord(record: StorageRecord, collection: string, decryptCallback?: (encrypted: string) => string): StorageRecord {
    // Default implementation: decrypt entire payload if encrypted
    if (!decryptCallback || !record.encrypted_payload) return record;

    return {
      id: record.id,
      payload: JSON.parse(decryptCallback(record.encrypted_payload)),
    };
  }

  /**
   * Create indexes for optimized queries
   */
  async createIndexes(db: DatabaseConnection, collection: string, callback?: StorageCallback): Promise<void> {
    // Default: no additional indexes
    callback?.();
  }

  /**
   * Migrate schema from one version to another
   */
  async migrateSchema(db: DatabaseConnection, fromVersion: number, toVersion: number, callback?: StorageCallback): Promise<void> {
    // Default: no migration needed
    callback?.();
  }

  /**
   * Initialize the inventory storage
   */
  abstract initializeInventory(db: DatabaseConnection, callback?: StorageCallback<StorageRecord>): Promise<StorageRecord>;

  /**
   * Read the entire inventory
   */
  abstract readInventory(db: DatabaseConnection, callback?: StorageCallback<StorageRecord>): Promise<StorageRecord>;

  /**
   * Update inventory for a specific collection/document
   */
  abstract updateInventoryItem(
    db: DatabaseConnection,
    collection: string,
    docId: string,
    version: number | string,
    operation: string,
    callback?: StorageCallback
  ): Promise<void>;

  /**
   * Get inventory representation type
   */
  abstract getInventoryType(): string;

  /**
   * Delete all tables created by this schema strategy
   */
  abstract deleteAllTables(db: DatabaseConnection, callback?: StorageCallback): Promise<void>;

  /**
   * Read multiple records by ID in a single SQL query (bulk operation)
   */
  readRecordsBulk?(
    db: DatabaseConnection,
    type: string,
    collection: string,
    ids: string[],
    callback?: StorageCallback<StorageRecord[]>
  ): Promise<StorageRecord[]>;
}