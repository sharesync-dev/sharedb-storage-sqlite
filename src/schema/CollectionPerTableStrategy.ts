/**
 * Schema strategy that creates a separate table for each collection.
 * This allows for:
 * - Collection-specific indexes
 * - Field-level encryption configuration per collection
 * - Optimized queries per collection
 * - Better performance for large collections
 * - Relational projections for array fields
 */

import {
  BaseSchemaStrategy,
  SchemaStrategyOptions,
  DatabaseConnection,
  StorageRecord,
  StorageRecords,
  StorageCallback,
  CollectionConfig,
  ArrayProjectionConfig
} from './BaseSchemaStrategy';

export class CollectionPerTableStrategy extends BaseSchemaStrategy {
  protected useEncryption: boolean;
  protected encryptionCallback?: (text: string) => string;
  protected decryptionCallback?: (encrypted: string) => string;
  protected collectionConfig: Record<string, CollectionConfig>;
  protected createdTables: Record<string, boolean> = {};
  protected projectionsByCollection: Record<string, ArrayProjectionConfig[]>;
  protected disableTransactions?: boolean;

  constructor(options: SchemaStrategyOptions = {}) {
    super(options);
    this.useEncryption = options.useEncryption || false;
    this.encryptionCallback = options.encryptionCallback;
    this.decryptionCallback = options.decryptionCallback;
    this.collectionConfig = options.collectionConfig || {};
    this.projectionsByCollection = this.parseProjections(this.collectionConfig);
  }

  /**
   * Parse projections from collection configuration
   */
  protected parseProjections(collectionConfig: Record<string, CollectionConfig>): Record<string, ArrayProjectionConfig[]> {
    const projectionsByCollection: Record<string, ArrayProjectionConfig[]> = {};

    for (const collection in collectionConfig) {
      const config = collectionConfig[collection];
      if (config.projections && Array.isArray(config.projections)) {
        projectionsByCollection[collection] = config.projections.map(projection => {
          // Validate projection configuration
          if (!projection.type || projection.type !== 'array_expansion') {
            throw new Error('Only array_expansion projection type is currently supported');
          }
          if (!projection.targetTable) {
            throw new Error('Projection requires targetTable');
          }
          if (!projection.mapping) {
            throw new Error('Projection requires mapping');
          }
          if (!projection.arrayPath) {
            throw new Error('Array expansion projection requires arrayPath');
          }
          if (!projection.primaryKey || !Array.isArray(projection.primaryKey)) {
            throw new Error('Projection requires primaryKey array');
          }

          return projection;
        });
      }
    }

    return projectionsByCollection;
  }

  /**
   * Initialize the schema - creates meta table, inventory table, and any pre-configured collection tables
   */
  async initializeSchema(db: DatabaseConnection, callback?: StorageCallback): Promise<void> {
    try {
      // Create meta table with sharedb_ prefix
      await this.runAsync(db,
        'CREATE TABLE IF NOT EXISTS sharedb_meta (' +
        'id TEXT PRIMARY KEY, ' +
        'data JSON' +
        ')'
      );

      // Create inventory table with support for both numeric and string versions
      await this.runAsync(db,
        'CREATE TABLE IF NOT EXISTS sharedb_inventory (' +
        'collection TEXT NOT NULL, ' +
        'doc_id TEXT NOT NULL, ' +
        'version_num REAL, ' +  // For numeric versions
        'version_str TEXT, ' +   // For string versions (timestamps)
        'has_pending INTEGER NOT NULL DEFAULT 0, ' +
        'updated_at INTEGER, ' +
        'PRIMARY KEY (collection, doc_id)' +
        ')'
      );

      // Create indexes for inventory table
      await this.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_collection ON sharedb_inventory (collection)');
      await this.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_updated ON sharedb_inventory (updated_at)');

      // Create tables for any pre-configured collections
      const collections = Object.keys(this.collectionConfig);
      for (const collection of collections) {
        await this.createCollectionTable(db, collection);
        await this.createProjectionTables(db, collection);
      }

      this.debug && console.log('[CollectionPerTableStrategy] Schema initialized');
      callback?.();
    } catch (error) {
      console.error('[CollectionPerTableStrategy] Schema initialization error:', error);
      callback?.(error as Error);
    }
  }

  /**
   * Create a table for a specific collection with its indexes
   */
  async createCollectionTable(db: DatabaseConnection, collection: string): Promise<void> {
    const tableName = this.getTableName(collection);
    const config = this.collectionConfig[collection] || {};

    // Create the table first
    await this.runAsync(db,
      'CREATE TABLE IF NOT EXISTS ' + tableName + ' (' +
      'id TEXT PRIMARY KEY, ' +
      'collection TEXT, ' +
      'data JSON' +
      ')'
    );

    // Create indexes sequentially after table is created
    if (config.indexes && config.indexes.length > 0) {
      for (const field of config.indexes) {
        // Sanitize field name for index name (replace dots with underscores)
        const sanitizedField = field.replace(/\./g, '_');
        const indexName = tableName + '_' + sanitizedField + '_idx';
        // Use single quotes for JSON path in SQLite
        await this.runAsync(db,
          'CREATE INDEX IF NOT EXISTS ' + indexName + ' ON ' + tableName +
          ' (json_extract(data, \'$.' + field + '\'))'
        );
      }
    }

    this.createdTables[collection] = true;
    this.debug && console.log('[CollectionPerTableStrategy] Created table for collection:', collection);
  }

  /**
   * Create projection tables for a collection
   */
  async createProjectionTables(db: DatabaseConnection, collection: string): Promise<void> {
    const projections = this.projectionsByCollection[collection];
    if (!projections || projections.length === 0) {
      return;
    }

    for (const projection of projections) {
      // Build CREATE TABLE statement
      const columns: string[] = [];
      for (const targetColumn in projection.mapping) {
        columns.push(targetColumn + ' TEXT');
      }
      columns.push('created_at INTEGER');

      // Add PRIMARY KEY constraint
      const primaryKeyClause = 'PRIMARY KEY (' + projection.primaryKey.join(', ') + ')';

      const createTableSQL = 'CREATE TABLE IF NOT EXISTS ' + projection.targetTable + ' (' +
        columns.join(', ') + ', ' +
        primaryKeyClause +
      ')';

      await this.runAsync(db, createTableSQL);

      // Create indexes for efficient querying
      for (const column of projection.primaryKey) {
        const indexName = 'idx_' + projection.targetTable + '_' + column;
        await this.runAsync(db,
          'CREATE INDEX IF NOT EXISTS ' + indexName + ' ON ' + projection.targetTable + '(' + column + ')'
        );
      }

      this.debug && console.log('[CollectionPerTableStrategy] Created projection table', projection.targetTable);
    }
  }

  /**
   * Update projections when a record is written
   */
  async updateProjections(db: DatabaseConnection, collection: string, newRecord: StorageRecord, oldRecord?: StorageRecord | null): Promise<void> {
    const projections = this.projectionsByCollection[collection];
    if (!projections || projections.length === 0) {
      return;
    }

    for (const projection of projections) {
      if (projection.type === 'array_expansion') {
        await this.updateArrayExpansionProjection(db, projection, newRecord, oldRecord);
      }
    }
  }

  /**
   * Update an array expansion projection
   */
  async updateArrayExpansionProjection(db: DatabaseConnection, projection: ArrayProjectionConfig, newRecord: StorageRecord, oldRecord?: StorageRecord | null): Promise<void> {
    const recordId = newRecord.id;

    // Delete existing projections for this record
    const deleteColumns: string[] = [];
    const deleteValues: any[] = [];
    for (const targetColumn in projection.mapping) {
      const sourcePath = projection.mapping[targetColumn];
      if (sourcePath === 'id' || sourcePath === '') {
        deleteColumns.push(targetColumn + ' = ?');
        deleteValues.push(recordId);
        break; // Only need to match on the record ID column
      }
    }

    if (deleteColumns.length > 0) {
      const deleteSQL = 'DELETE FROM ' + projection.targetTable + ' WHERE ' + deleteColumns.join(' AND ');
      await this.runAsync(db, deleteSQL, deleteValues);
    }

    // Extract array from new record
    const array = this.getNestedValue(newRecord, projection.arrayPath);
    if (!array || !Array.isArray(array)) {
      return; // No array to project
    }

    // Insert new projections
    const now = Date.now();
    for (const element of array) {
      const values: any[] = [];
      const placeholders: string[] = [];

      for (const targetColumn in projection.mapping) {
        const sourcePath = projection.mapping[targetColumn];

        let value: any;
        if (sourcePath === '') {
          // Empty string means use the array element itself
          value = element;
        } else if (sourcePath === 'id') {
          // Special case for record ID
          value = recordId;
        } else {
          // Extract value from the record
          value = this.getNestedValue(newRecord, sourcePath);
        }

        values.push(value);
        placeholders.push('?');
      }

      // Add created_at timestamp
      values.push(now);
      placeholders.push('?');

      const columns = Object.keys(projection.mapping).concat(['created_at']);
      const insertSQL = 'INSERT OR REPLACE INTO ' + projection.targetTable +
        ' (' + columns.join(', ') + ') VALUES (' + placeholders.join(', ') + ')';

      await this.runAsync(db, insertSQL, values);
    }

    this.debug && console.log('[CollectionPerTableStrategy] Updated projections in', projection.targetTable, 'for record', recordId);
  }

  /**
   * Delete projections when a record is deleted
   */
  async deleteProjections(db: DatabaseConnection, collection: string, recordId: string): Promise<void> {
    const projections = this.projectionsByCollection[collection];
    if (!projections || projections.length === 0) {
      return;
    }

    for (const projection of projections) {
      // Find the column that maps to the record ID
      let idColumn: string | null = null;
      for (const targetColumn in projection.mapping) {
        const sourcePath = projection.mapping[targetColumn];
        if (sourcePath === 'id') {
          idColumn = targetColumn;
          break;
        }
      }

      if (idColumn) {
        const deleteSQL = 'DELETE FROM ' + projection.targetTable + ' WHERE ' + idColumn + ' = ?';
        await this.runAsync(db, deleteSQL, [recordId]);
        this.debug && console.log('[CollectionPerTableStrategy] Deleted projections from', projection.targetTable, 'for record', recordId);
      }
    }
  }

  /**
   * Helper to extract nested value from object using dot notation path
   */
  protected getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let value = obj;
    for (const part of parts) {
      if (!value || typeof value !== 'object') return null;
      value = value[part];
    }
    return value;
  }

  /**
   * Helper to run async SQL with consistent promise handling
   */
  protected async runAsync(db: DatabaseConnection, sql: string, params?: any[]): Promise<any> {
    const result = await db.runAsync(sql, params);
    // Handle both promise styles (some adapters return {promise: () => Promise})
    return result && typeof result.promise === 'function' ? result.promise() : result;
  }

  // ... Continue with other methods (writeRecords, readRecord, deleteRecord, etc.)
  // These would be converted from the JavaScript version similarly

  /**
   * Validate that required tables exist
   */
  async validateSchema(db: DatabaseConnection, callback?: StorageCallback<boolean>): Promise<boolean> {
    try {
      const result = await db.getFirstAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sharedb_meta'"
      );
      const isValid = !!result;
      callback?.(null, isValid);
      return isValid;
    } catch (error) {
      callback?.(error as Error, false);
      return false;
    }
  }

  /**
   * Get table name for a collection
   */
  getTableName(collection: string): string {
    if (collection === '__meta__') {
      return 'sharedb_meta';
    }
    if (collection === '__inventory__') {
      return 'sharedb_inventory';
    }
    // Sanitize collection name for use as table name
    return collection.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  // Placeholder implementations for abstract methods
  // These need to be fully implemented based on the JavaScript version

  async writeRecords(db: DatabaseConnection, recordsByType: StorageRecords, callback?: StorageCallback): Promise<void> {
    // TODO: Implement based on JavaScript version
    throw new Error('Method not implemented.');
  }

  async readRecord(db: DatabaseConnection, type: string, collection: string | null, id: string, callback?: StorageCallback<StorageRecord | null>): Promise<StorageRecord | null> {
    // TODO: Implement based on JavaScript version
    throw new Error('Method not implemented.');
  }

  async readAllRecords(db: DatabaseConnection, type: string, collection: string | null, callback?: StorageCallback<StorageRecord[]>): Promise<StorageRecord[]> {
    // TODO: Implement based on JavaScript version
    throw new Error('Method not implemented.');
  }

  async deleteRecord(db: DatabaseConnection, type: string, collection: string | null, id: string, callback?: StorageCallback): Promise<void> {
    // TODO: Implement based on JavaScript version
    throw new Error('Method not implemented.');
  }

  async initializeInventory(db: DatabaseConnection, callback?: StorageCallback<StorageRecord>): Promise<StorageRecord> {
    // Inventory table is created in initializeSchema
    const inventory = {
      id: 'inventory',
      payload: { collections: {} }
    };
    callback?.(null, inventory);
    return inventory;
  }

  async readInventory(db: DatabaseConnection, callback?: StorageCallback<StorageRecord>): Promise<StorageRecord> {
    // TODO: Implement based on JavaScript version
    throw new Error('Method not implemented.');
  }

  async updateInventoryItem(db: DatabaseConnection, collection: string, docId: string, version: number | string, operation: string, callback?: StorageCallback): Promise<void> {
    // TODO: Implement based on JavaScript version
    throw new Error('Method not implemented.');
  }

  getInventoryType(): string {
    return 'table';
  }

  async deleteAllTables(db: DatabaseConnection, callback?: StorageCallback): Promise<void> {
    // TODO: Implement based on JavaScript version
    throw new Error('Method not implemented.');
  }
}