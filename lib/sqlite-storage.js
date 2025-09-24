/**
 * Base SQLite storage implementation for ShareDB
 *
 * This class implements the DurableStorage interface from ShareDB,
 * providing SQLite-based persistence for offline-first applications.
 */

var errors = require('./utils/errors');
var ERROR_CODES = errors.ERROR_CODES;
var wrapError = errors.wrapError;
var wrapCallback = errors.wrapCallback;
var Formatted = require('./utils/formatted');

module.exports = SqliteStorage;

function SqliteStorage(options) {
  if (!options.adapter) {
    throw errors.createShareDBError('SqliteStorage requires an adapter', ERROR_CODES.NO_ADAPTER);
  }

  this.adapter = options.adapter;
  this.schemaStrategy = options.schemaStrategy || this.createDefaultStrategy();
  this.debug = options.debug || false;
  this.ready = false;
  this.initializationPromise = null;
}

/**
 * Create a default schema strategy if none provided
 * Subclasses can override this to provide platform-specific defaults
 */
SqliteStorage.prototype.createDefaultStrategy = function() {
  throw errors.createShareDBError('No schema strategy provided and no default available', ERROR_CODES.INVALID_SCHEMA_STRATEGY);
};

/**
 * Initialize the storage system
 */
SqliteStorage.prototype.initialize = function(callback) {
  var self = this;

  if (this.ready) {
    // If already initialized, read and return current inventory
    this.schemaStrategy.readInventory(this.adapter, wrapCallback(callback, ERROR_CODES.DB_QUERY_FAILED));
    return;
  }

  if (this.initializationPromise) {
    this.initializationPromise
      .then(function(inventory) { callback(null, inventory); })
      .catch(function(error) { callback(error); });
    return;
  }

  this.initializationPromise = this.initializeAsync();
  this.initializationPromise
    .then(function(inventory) {
      self.ready = true;
      callback(null, inventory);
    })
    .catch(function(error) {
      console.error('[SqliteStorage] Initialization error:', error);
      callback(wrapError(error, ERROR_CODES.NOT_INITIALIZED));
    });
};

SqliteStorage.prototype.initializeAsync = function() {
  var self = this;
  var startTime = Date.now();

  return this.adapter.connect()
    .then(function() {
      self.debug && console.log('[SqliteStorage] Database connected');
      return new Promise(function(resolve, reject) {
        self.schemaStrategy.initializeSchema(self.adapter, function(error) {
          if (error) reject(error);
          else resolve();
        });
      });
    })
    .then(function() {
      self.debug && console.log('[SqliteStorage] Schema initialized');
      return new Promise(function(resolve, reject) {
        self.schemaStrategy.readInventory(self.adapter, function(error, inventory) {
          if (error) reject(error);
          else resolve(inventory);
        });
      });
    })
    .then(function(inventory) {
      self.debug && console.log('[SqliteStorage] Inventory loaded');
      var elapsed = Date.now() - startTime;
      self.debug && console.log('[SqliteStorage] Initialized in ' + elapsed + 'ms');
      return inventory;
    });
};

/**
 * Read a single record from storage
 */
SqliteStorage.prototype.readRecord = function(storeName, id, callback) {
  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  // Map storeName to type for schema strategy
  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection;
  var docId;

  if (storeName === 'meta') {
    collection = null;
    docId = id;
  } else if (storeName === 'docs' && id.indexOf('/') !== -1) {
    // When storeName is 'docs' and id contains a slash, it's a compound key
    // Split it into collection and simple ID
    try {
      var parts = Formatted.split(id);
      collection = parts.collection;
      docId = parts.docId;
    } catch (error) {
      // Invalid compound key format
      callback(wrapError(error, ERROR_CODES.UNKNOWN));
      return;
    }
  } else {
    // Invalid usage - DurableStore should only call with 'meta' or 'docs' with compound keys
    var errorMsg = 'Invalid readRecord call: storeName=' + storeName + ', id=' + id +
                   '. Expected either storeName="meta" or storeName="docs" with compound key (collection/id)';
    callback(errors.createShareDBError(errorMsg, ERROR_CODES.UNKNOWN));
    return;
  }

  this.schemaStrategy.readRecord(this.adapter, type, collection, docId, function(error, record) {
    if (error) {
      callback(wrapError(error, ERROR_CODES.RECORD_NOT_FOUND));
    } else {
      // Return with standard error-first callback pattern
      callback(null, record ? record.payload : null);
    }
  });
};

/**
 * Read all records from a store
 */
SqliteStorage.prototype.readAllRecords = function(storeName, callback) {
  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection = storeName === 'meta' ? null : storeName;

  this.schemaStrategy.readAllRecords(this.adapter, type, collection, wrapCallback(callback, ERROR_CODES.DB_QUERY_FAILED));
};

/**
 * Read multiple records by ID (bulk operation)
 */
SqliteStorage.prototype.readRecordsBulk = function(storeName, ids, callback) {
  var self = this;

  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  if (!this.schemaStrategy.readRecordsBulk) {
    // Fall back to individual reads if bulk not supported
    var promises = ids.map(function(id) {
      return self.schemaStrategy.readRecord(self.adapter, 'docs', storeName, id);
    });

    Promise.all(promises)
      .then(function(records) {
        var validRecords = records.filter(function(r) { return r !== null; });
        callback(null, validRecords);
      })
      .catch(function(error) {
        callback(error);
      });
    return;
  }

  this.schemaStrategy.readRecordsBulk(this.adapter, 'docs', storeName, ids, wrapCallback(callback, ERROR_CODES.BULK_READ_FAILED));
};

/**
 * Write records to storage
 */
SqliteStorage.prototype.writeRecords = function(records, callback) {
  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  this.schemaStrategy.writeRecords(this.adapter, records, wrapCallback(callback, ERROR_CODES.WRITE_FAILED));
};

/**
 * Delete a record from storage
 */
SqliteStorage.prototype.deleteRecord = function(storeName, id, callback) {
  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection = storeName === 'meta' ? null : storeName;

  this.schemaStrategy.deleteRecord(this.adapter, type, collection, id, wrapCallback(callback, ERROR_CODES.DELETE_FAILED));
};

/**
 * Clear all records from a specific store
 */
SqliteStorage.prototype.clearStore = function(storeName, callback) {
  var self = this;

  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  if (this.schemaStrategy.clearStore) {
    this.schemaStrategy.clearStore(this.adapter, storeName, wrapCallback(callback, ERROR_CODES.CLEAR_FAILED));
  } else {
    // Default implementation: read all and delete each
    this.readAllRecords(storeName, function(error, records) {
      if (error) {
        callback(error);
        return;
      }

      var deletePromises = (records || []).map(function(record) {
        return new Promise(function(resolve, reject) {
          self.deleteRecord(storeName, record.id, function(err) {
            if (err) reject(err);
            else resolve();
          });
        });
      });

      Promise.all(deletePromises)
        .then(function() { callback(null); })
        .catch(function(error) { callback(error); });
    });
  }
};

/**
 * Clear all data from storage
 */
SqliteStorage.prototype.clearAll = function(callback) {
  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  if (this.schemaStrategy.clearAll) {
    this.schemaStrategy.clearAll(this.adapter, wrapCallback(callback, ERROR_CODES.CLEAR_FAILED));
  } else {
    // Default: delete all tables
    this.schemaStrategy.deleteAllTables(this.adapter, wrapCallback(callback, ERROR_CODES.CLEAR_FAILED));
  }
};

/**
 * Close the storage connection
 */
SqliteStorage.prototype.close = function(callback) {
  var self = this;

  this.adapter.disconnect()
    .then(function() {
      self.ready = false;
      callback(null);
    })
    .catch(function(error) {
      callback(error);
    });
};

/**
 * Check if storage is ready
 */
SqliteStorage.prototype.isReady = function() {
  return this.ready;
};

/**
 * Ensure storage is ready (throw if not)
 */
SqliteStorage.prototype.ensureReady = function() {
  if (!this.ready) {
    throw new Error('Storage not initialized. Call initialize() first.');
  }
};

/**
 * Update inventory for a specific document
 */
SqliteStorage.prototype.updateInventory = function(collection, docId, version, operation, callback) {
  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  this.schemaStrategy.updateInventoryItem(this.adapter, collection, docId, version, operation, wrapCallback(callback, ERROR_CODES.WRITE_FAILED));
};

/**
 * Read the full inventory
 */
SqliteStorage.prototype.readInventory = function(callback) {
  if (!this.ready) {
    callback(errors.createShareDBError('Storage not initialized', ERROR_CODES.NOT_INITIALIZED));
    return;
  }

  this.schemaStrategy.readInventory(this.adapter, wrapCallback(callback, ERROR_CODES.DB_QUERY_FAILED));
};

/**
 * Delete the database (if supported by adapter)
 */
SqliteStorage.prototype.deleteDatabase = function(callback) {
  this.schemaStrategy.deleteAllTables(this.adapter, callback);
};