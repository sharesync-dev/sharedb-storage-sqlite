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

  /**
   * Write records to collection-specific tables
   */
  async writeRecords(db: DatabaseConnection, recordsByType: StorageRecords, callback?: StorageCallback): Promise<void> {
    try {
      // Process docs records
      if (recordsByType.docs) {
        // Handle different formats of docs
        let recordsByCollection: Record<string, StorageRecord[]> = {};

        if (typeof recordsByType.docs === 'object' && !Array.isArray(recordsByType.docs) && !(recordsByType.docs as any).id) {
          // docs is already a dictionary of collections
          recordsByCollection = recordsByType.docs as Record<string, StorageRecord[]>;
        } else {
          // docs is a single record or array of records
          const docsRecords = Array.isArray(recordsByType.docs) ? recordsByType.docs : [recordsByType.docs as StorageRecord];

          // Group records by collection
          for (const record of docsRecords) {
            const collection = record.collection || record.payload?.collection;
            if (!collection) {
              throw new Error('Record missing required collection field');
            }
            if (!recordsByCollection[collection]) {
              recordsByCollection[collection] = [];
            }
            recordsByCollection[collection].push(record);
          }
        }

        // Write to each collection's table
        for (const [collection, records] of Object.entries(recordsByCollection)) {
          // Ensure table exists
          await this.ensureCollectionTable(db, collection);
          const tableName = this.getTableName(collection);

          for (const record of records) {
            // Write record
            await this.runAsync(db,
              'INSERT OR REPLACE INTO ' + tableName + ' (id, collection, data) VALUES (?, ?, ?)',
              [record.id, collection, JSON.stringify(record)]
            );

            // Update projections
            await this.updateProjections(db, collection, record, null);

            // Update inventory
            const version = record.payload?.v || 1;
            const hasPending = (record.payload?.pendingOps || record.payload?.inflightOp) ? 1 : 0;

            if (typeof version === 'string') {
              await this.runAsync(db,
                'INSERT OR REPLACE INTO sharedb_inventory (collection, doc_id, version_num, version_str, has_pending, updated_at) VALUES (?, ?, NULL, ?, ?, ?)',
                [collection, record.id, version, hasPending, Date.now()]
              );
            } else {
              await this.runAsync(db,
                'INSERT OR REPLACE INTO sharedb_inventory (collection, doc_id, version_num, version_str, has_pending, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
                [collection, record.id, version, hasPending, Date.now()]
              );
            }
          }
        }
      }

      // Process meta records
      if (recordsByType.meta) {
        const metaRecords = Array.isArray(recordsByType.meta) ? recordsByType.meta : [recordsByType.meta];
        for (const metaRecord of metaRecords) {
          await this.runAsync(db,
            'INSERT OR REPLACE INTO sharedb_meta (id, data) VALUES (?, ?)',
            [metaRecord.id, JSON.stringify(metaRecord.payload)]
          );
        }
      }

      callback?.();
    } catch (error) {
      callback?.(error as Error);
    }
  }

  /**
   * Read a single record from a collection-specific table
   */
  async readRecord(db: DatabaseConnection, type: string, collection: string | null, id: string, callback?: StorageCallback<StorageRecord | null>): Promise<StorageRecord | null> {
    try {
      if (type === 'meta') {
        const row = await db.getFirstAsync('SELECT data FROM sharedb_meta WHERE id = ?', [id]);
        if (!row) {
          callback?.(null, null);
          return null;
        }
        const record = { id, payload: JSON.parse(row.data) };
        callback?.(null, record);
        return record;
      } else {
        // For docs, if collection is not specified, look it up from inventory
        if (!collection || collection === 'docs') {
          const inventoryRow = await db.getFirstAsync(
            'SELECT collection FROM sharedb_inventory WHERE doc_id = ?',
            [id]
          );
          if (!inventoryRow) {
            callback?.(null, null);
            return null;
          }
          collection = inventoryRow.collection;
        }

        const tableName = this.getTableName(collection!);
        const row = await db.getFirstAsync('SELECT data FROM ' + tableName + ' WHERE id = ?', [id]);
        if (!row) {
          callback?.(null, null);
          return null;
        }

        const record = JSON.parse(row.data);
        callback?.(null, record);
        return record;
      }
    } catch (error) {
      callback?.(error as Error, null);
      return null;
    }
  }

  /**
   * Read all records of a given type
   */
  async readAllRecords(db: DatabaseConnection, type: string, collection: string | null, callback?: StorageCallback<StorageRecord[]>): Promise<StorageRecord[]> {
    try {
      if (type === 'meta') {
        const rows = await db.getAllAsync('SELECT id, data FROM sharedb_meta');
        const records = rows.map(row => ({
          id: row.id,
          payload: JSON.parse(row.data)
        }));
        callback?.(null, records);
        return records;
      } else if (collection && collection !== 'docs') {
        const tableName = this.getTableName(collection);
        const rows = await db.getAllAsync('SELECT id, data FROM ' + tableName);
        const records = rows.map(row => JSON.parse(row.data));
        callback?.(null, records);
        return records;
      } else {
        // Read from all collection tables
        const inventory = await db.getAllAsync('SELECT DISTINCT collection FROM sharedb_inventory');
        const allRecords: StorageRecord[] = [];

        for (const item of inventory) {
          const tableName = this.getTableName(item.collection);
          const rows = await db.getAllAsync('SELECT data FROM ' + tableName);
          const records = rows.map(row => JSON.parse(row.data));
          allRecords.push(...records);
        }

        callback?.(null, allRecords);
        return allRecords;
      }
    } catch (error) {
      callback?.(error as Error, []);
      return [];
    }
  }

  /**
   * Delete a record from a collection-specific table
   */
  async deleteRecord(db: DatabaseConnection, type: string, collection: string | null, id: string, callback?: StorageCallback): Promise<void> {
    try {
      if (type === 'meta') {
        await this.runAsync(db, 'DELETE FROM sharedb_meta WHERE id = ?', [id]);
      } else {
        // For docs, if collection is not specified, look it up from inventory
        if (!collection || collection === 'docs') {
          const inventoryRow = await db.getFirstAsync(
            'SELECT collection FROM sharedb_inventory WHERE doc_id = ?',
            [id]
          );
          if (!inventoryRow) {
            callback?.();
            return;
          }
          collection = inventoryRow.collection;
        }

        const tableName = this.getTableName(collection!);
        await this.runAsync(db, 'DELETE FROM ' + tableName + ' WHERE id = ?', [id]);

        // Delete projections
        await this.deleteProjections(db, collection!, id);

        // Delete from inventory
        await this.runAsync(db, 'DELETE FROM sharedb_inventory WHERE doc_id = ?', [id]);
      }

      callback?.();
    } catch (error) {
      callback?.(error as Error);
    }
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
    try {
      const rows = await db.getAllAsync(
        'SELECT collection, doc_id, version_num, version_str, has_pending FROM sharedb_inventory ORDER BY collection, doc_id'
      );

      const inventory: any = { collections: {} };

      for (const row of rows) {
        if (!inventory.collections[row.collection]) {
          inventory.collections[row.collection] = {};
        }
        // Use whichever version type is not null
        const version = row.version_str !== null ? row.version_str : row.version_num;
        const hasPending = row.has_pending === 1;

        inventory.collections[row.collection][row.doc_id] = {
          v: version,
          p: hasPending
        };
      }

      const result = {
        id: 'inventory',
        payload: inventory
      };

      callback?.(null, result);
      return result;
    } catch (error) {
      callback?.(error as Error);
      throw error;
    }
  }

  async updateInventoryItem(db: DatabaseConnection, collection: string, docId: string, version: number | string, operation: string, callback?: StorageCallback): Promise<void> {
    try {
      const now = Date.now();

      if (operation === 'add' || operation === 'update') {
        // Check for version type consistency
        const existing = await db.getFirstAsync(
          'SELECT version_num, version_str FROM sharedb_inventory WHERE collection = ? AND doc_id = ?',
          [collection, docId]
        );

        if (existing) {
          const existingIsString = (existing.version_str !== null);
          const newIsString = (typeof version === 'string');

          if (existingIsString !== newIsString) {
            throw new Error(
              `Version type mismatch: Cannot store ${collection}/${docId} with ${typeof version} version ${version} when existing version is ${existingIsString ? 'string' : 'number'}`
            );
          }
        }

        // Insert or update with appropriate version column
        if (typeof version === 'string') {
          await this.runAsync(db,
            'INSERT OR REPLACE INTO sharedb_inventory (collection, doc_id, version_num, version_str, has_pending, updated_at) VALUES (?, ?, NULL, ?, 0, ?)',
            [collection, docId, version, now]
          );
        } else {
          await this.runAsync(db,
            'INSERT OR REPLACE INTO sharedb_inventory (collection, doc_id, version_num, version_str, has_pending, updated_at) VALUES (?, ?, ?, NULL, 0, ?)',
            [collection, docId, version, now]
          );
        }
      } else if (operation === 'remove') {
        // Delete inventory item
        await this.runAsync(db,
          'DELETE FROM sharedb_inventory WHERE collection = ? AND doc_id = ?',
          [collection, docId]
        );
      } else {
        throw new Error('Invalid inventory operation: ' + operation);
      }

      callback?.();
    } catch (error) {
      callback?.(error as Error);
    }
  }

  getInventoryType(): string {
    return 'table';
  }

  async deleteAllTables(db: DatabaseConnection, callback?: StorageCallback): Promise<void> {
    try {
      // Drop the standard meta and inventory tables
      await this.runAsync(db, 'DROP TABLE IF EXISTS sharedb_meta');
      await this.runAsync(db, 'DROP TABLE IF EXISTS sharedb_inventory');

      // Get all collection-specific table names and drop them
      const tables = await db.getAllAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('sharedb_meta', 'sharedb_inventory')"
      );

      for (const table of tables) {
        if (!table.name.startsWith('sqlite_')) {
          await this.runAsync(db, 'DROP TABLE IF EXISTS ' + table.name);
        }
      }

      this.debug && console.log('[CollectionPerTableStrategy] Deleted all tables');
      callback?.();
    } catch (error) {
      callback?.(error as Error);
    }
  }

  /**
   * Ensure a collection table exists before writing to it
   */
  async ensureCollectionTable(db: DatabaseConnection, collection: string): Promise<void> {
    if (this.createdTables[collection]) {
      return;
    }

    await this.createCollectionTable(db, collection);
  }
}