/**
 * Base class for SQLite schema strategies.
 * Schema strategies define how data is organized in SQLite tables,
 * how encryption is applied, and how queries are optimized.
 *
 * All schema strategies must extend this base class and implement
 * the required methods.
 */

module.exports = BaseSchemaStrategy;

function BaseSchemaStrategy(options) {
  this.options = options || {};
  this.debug = this.options.debug || false;
}

/**
 * Initialize the schema (create tables, indexes, etc.)
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.initializeSchema = function(db, callback) {
  throw new Error('initializeSchema must be implemented by subclass');
};

/**
 * Validate that the schema exists and is compatible
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.validateSchema = function(db, callback) {
  throw new Error('validateSchema must be implemented by subclass');
};

/**
 * Get the table name for a given collection
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.getTableName = function(collection) {
  throw new Error('getTableName must be implemented by subclass');
};

/**
 * Write records to the database
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.writeRecords = function(db, recordsByType, callback) {
  throw new Error('writeRecords must be implemented by subclass');
};

/**
 * Read a single record from the database
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.readRecord = function(db, type, collection, id, callback) {
  throw new Error('readRecord must be implemented by subclass');
};

/**
 * Read all records of a given type
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.readAllRecords = function(db, type, collection, callback) {
  throw new Error('readAllRecords must be implemented by subclass');
};

/**
 * Delete a record from the database
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.deleteRecord = function(db, type, collection, id, callback) {
  throw new Error('deleteRecord must be implemented by subclass');
};

/**
 * Determine if a specific field should be encrypted
 */
BaseSchemaStrategy.prototype.shouldEncryptField = function(collection, fieldPath) {
  // Default: no field-level encryption
  return false;
};

/**
 * Apply encryption strategy to a record
 */
BaseSchemaStrategy.prototype.encryptRecord = function(record, collection, encryptCallback) {
  // Default implementation: encrypt entire payload if encryption is enabled
  if (!encryptCallback) return record;

  return {
    id: record.id,
    encrypted_payload: encryptCallback(JSON.stringify(record.payload))
  };
};

/**
 * Apply decryption strategy to a record
 */
BaseSchemaStrategy.prototype.decryptRecord = function(record, collection, decryptCallback) {
  // Default implementation: decrypt entire payload if encrypted
  if (!decryptCallback || !record.encrypted_payload) return record;

  return {
    id: record.id,
    payload: JSON.parse(decryptCallback(record.encrypted_payload))
  };
};

/**
 * Create indexes for optimized queries
 */
BaseSchemaStrategy.prototype.createIndexes = function(db, collection, callback) {
  // Default: no additional indexes
  if (callback) callback(null);
  return Promise.resolve();
};

/**
 * Migrate schema from one version to another
 */
BaseSchemaStrategy.prototype.migrateSchema = function(db, fromVersion, toVersion, callback) {
  // Default: no migration needed
  if (callback) callback(null);
  return Promise.resolve();
};

/**
 * Initialize the inventory storage
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.initializeInventory = function(db, callback) {
  throw new Error('initializeInventory must be implemented by subclass');
};

/**
 * Read the entire inventory
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.readInventory = function(db, callback) {
  throw new Error('readInventory must be implemented by subclass');
};

/**
 * Add or update inventory for a specific collection/document
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.upsertInventoryItem = function(db, collection, docId, version, callback) {
  throw new Error('upsertInventoryItem must be implemented by subclass');
};

/**
 * Remove a document from inventory
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.deleteInventoryItem = function(db, collection, docId, callback) {
  throw new Error('deleteInventoryItem must be implemented by subclass');
};

/**
 * Update inventory for a specific collection/document
 * @deprecated Use upsertInventoryItem or deleteInventoryItem instead
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.updateInventoryItem = function(db, collection, docId, version, operation, callback) {
  throw new Error('updateInventoryItem must be implemented by subclass');
};

/**
 * Get inventory representation type
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.getInventoryType = function() {
  throw new Error('getInventoryType must be implemented by subclass');
};

/**
 * Delete all tables created by this schema strategy
 * Must be implemented by subclasses
 */
BaseSchemaStrategy.prototype.deleteAllTables = function(db, callback) {
  throw new Error('deleteAllTables must be implemented by subclass');
};

/**
 * Read multiple records by ID in a single SQL query (bulk operation)
 * Optional - subclasses can override to provide optimized bulk reading
 */
BaseSchemaStrategy.prototype.readRecordsBulk = function(db, type, collection, ids, callback) {
  // Default implementation: fall back to individual reads
  var self = this;
  var promises = ids.map(function(id) {
    return new Promise(function(resolve, reject) {
      self.readRecord(db, type, collection, id, function(err, record) {
        if (err) reject(err);
        else resolve(record);
      });
    });
  });

  return Promise.all(promises)
    .then(function(records) {
      if (callback) callback(null, records.filter(function(r) { return r !== null; }));
      return records.filter(function(r) { return r !== null; });
    })
    .catch(function(error) {
      if (callback) callback(error);
      throw error;
    });
};