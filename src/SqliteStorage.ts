/**
 * Base SQLite storage implementation for ShareDB
 *
 * This class implements the DurableStorage interface from ShareDB,
 * providing SQLite-based persistence for offline-first applications.
 */

import {
  DurableStorage,
  DurableStorageCallback,
  DurableStorageRecord,
  DurableStorageRecords,
  SqliteAdapter,
  SchemaStrategy,
  SqliteStorageOptions
} from './interfaces';

export class SqliteStorage implements DurableStorage {
  protected adapter: SqliteAdapter;
  protected schemaStrategy: SchemaStrategy;
  protected ready: boolean = false;
  protected debug: boolean;
  protected initializationPromise?: Promise<void>;

  constructor(options: SqliteStorageOptions) {
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
  protected createDefaultStrategy(): SchemaStrategy {
    throw new Error('No schema strategy provided and no default available');
  }

  /**
   * Initialize the storage system
   */
  initialize(callback: DurableStorageCallback): void {
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

  protected async initializeAsync(): Promise<void> {
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
  readRecord(storeName: string, id: string, callback: DurableStorageCallback<any>): void {
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
  readAllRecords(storeName: string, callback: DurableStorageCallback<DurableStorageRecord[]>): void {
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
  readRecordsBulk?(storeName: string, ids: string[], callback: DurableStorageCallback<DurableStorageRecord[]>): void {
    if (!this.ready) {
      callback(new Error('Storage not initialized'));
      return;
    }

    if (!this.schemaStrategy.readRecordsBulk) {
      // Fall back to individual reads if bulk not supported
      const promises = ids.map(id =>
        this.schemaStrategy.readRecord(this.adapter, 'docs', storeName, id)
      );

      Promise.all(promises)
        .then(records => {
          const validRecords = records.filter(r => r !== null) as DurableStorageRecord[];
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
  writeRecords(records: DurableStorageRecords, callback: DurableStorageCallback): void {
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
  deleteRecord(storeName: string, id: string, callback: DurableStorageCallback): void {
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
  clearStore(storeName: string, callback: DurableStorageCallback): void {
    if (!this.ready) {
      callback(new Error('Storage not initialized'));
      return;
    }

    if (this.schemaStrategy.clearStore) {
      this.schemaStrategy.clearStore(this.adapter, storeName)
        .then(() => callback(null))
        .catch(error => callback(error));
    } else {
      // Default implementation: read all and delete each
      this.readAllRecords(storeName, (error, records) => {
        if (error) {
          callback(error);
          return;
        }

        const deletePromises = (records || []).map(record =>
          new Promise<void>((resolve, reject) => {
            this.deleteRecord(storeName, record.id, err => {
              if (err) reject(err);
              else resolve();
            });
          })
        );

        Promise.all(deletePromises)
          .then(() => callback(null))
          .catch(error => callback(error));
      });
    }
  }

  /**
   * Clear all data from storage
   */
  clearAll(callback: DurableStorageCallback): void {
    if (!this.ready) {
      callback(new Error('Storage not initialized'));
      return;
    }

    if (this.schemaStrategy.clearAll) {
      this.schemaStrategy.clearAll(this.adapter)
        .then(() => callback(null))
        .catch(error => callback(error));
    } else {
      // Default: delete all tables
      this.schemaStrategy.deleteAllTables(this.adapter)
        .then(() => callback(null))
        .catch(error => callback(error));
    }
  }

  /**
   * Close the storage connection
   */
  close?(callback: DurableStorageCallback): void {
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
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Ensure storage is ready (throw if not)
   */
  ensureReady(): void {
    if (!this.ready) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
  }

  /**
   * Update inventory for a specific document
   */
  updateInventory(collection: string, docId: string, version: number | string, operation: string, callback: DurableStorageCallback): void {
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
  readInventory(callback: DurableStorageCallback<DurableStorageRecord>): void {
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
  deleteDatabase?(callback: DurableStorageCallback): void {
    this.schemaStrategy.deleteAllTables(this.adapter)
      .then(() => callback(null))
      .catch(error => callback(error));
  }
}