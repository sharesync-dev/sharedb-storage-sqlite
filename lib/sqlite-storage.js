/**
 * Base SQLite storage implementation for ShareDB
 *
 * This class implements the DurableStorage interface from ShareDB,
 * providing SQLite-based persistence for offline-first applications.
 */

module.exports = SqliteStorage;

function SqliteStorage(options) {
  if (!options.adapter) {
    throw new Error('SqliteStorage requires an adapter');
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
  throw new Error('No schema strategy provided and no default available');
};

/**
 * Initialize the storage system
 */
SqliteStorage.prototype.initialize = function(callback) {
  var self = this;

  if (this.ready) {
    callback(null);
    return;
  }

  if (this.initializationPromise) {
    this.initializationPromise
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
    return;
  }

  this.initializationPromise = this.initializeAsync();
  this.initializationPromise
    .then(function() {
      self.ready = true;
      callback(null);
    })
    .catch(function(error) {
      console.error('[SqliteStorage] Initialization error:', error);
      callback(error);
    });
};

SqliteStorage.prototype.initializeAsync = function() {
  var self = this;
  var startTime = Date.now();

  return this.adapter.connect()
    .then(function() {
      self.debug && console.log('[SqliteStorage] Database connected');
      return self.schemaStrategy.initializeSchema(self.adapter);
    })
    .then(function() {
      self.debug && console.log('[SqliteStorage] Schema initialized');
      return self.schemaStrategy.readInventory(self.adapter);
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
    callback(new Error('Storage not initialized'));
    return;
  }

  // Map storeName to type for schema strategy
  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection = storeName === 'meta' ? null : storeName;

  this.schemaStrategy.readRecord(this.adapter, type, collection, id)
    .then(function(record) {
      callback(null, record ? record.payload : null);
    })
    .catch(function(error) {
      callback(error);
    });
};

/**
 * Read all records from a store
 */
SqliteStorage.prototype.readAllRecords = function(storeName, callback) {
  if (!this.ready) {
    callback(new Error('Storage not initialized'));
    return;
  }

  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection = storeName === 'meta' ? null : storeName;

  this.schemaStrategy.readAllRecords(this.adapter, type, collection)
    .then(function(records) {
      callback(null, records);
    })
    .catch(function(error) {
      callback(error);
    });
};

/**
 * Read multiple records by ID (bulk operation)
 */
SqliteStorage.prototype.readRecordsBulk = function(storeName, ids, callback) {
  var self = this;

  if (!this.ready) {
    callback(new Error('Storage not initialized'));
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

  this.schemaStrategy.readRecordsBulk(this.adapter, 'docs', storeName, ids)
    .then(function(records) {
      callback(null, records);
    })
    .catch(function(error) {
      callback(error);
    });
};

/**
 * Write records to storage
 */
SqliteStorage.prototype.writeRecords = function(records, callback) {
  if (!this.ready) {
    callback(new Error('Storage not initialized'));
    return;
  }

  this.schemaStrategy.writeRecords(this.adapter, records)
    .then(function() {
      callback(null);
    })
    .catch(function(error) {
      callback(error);
    });
};

/**
 * Delete a record from storage
 */
SqliteStorage.prototype.deleteRecord = function(storeName, id, callback) {
  if (!this.ready) {
    callback(new Error('Storage not initialized'));
    return;
  }

  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection = storeName === 'meta' ? null : storeName;

  this.schemaStrategy.deleteRecord(this.adapter, type, collection, id)
    .then(function() {
      callback(null);
    })
    .catch(function(error) {
      callback(error);
    });
};

/**
 * Clear all records from a specific store
 */
SqliteStorage.prototype.clearStore = function(storeName, callback) {
  var self = this;

  if (!this.ready) {
    callback(new Error('Storage not initialized'));
    return;
  }

  if (this.schemaStrategy.clearStore) {
    this.schemaStrategy.clearStore(this.adapter, storeName)
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
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
    callback(new Error('Storage not initialized'));
    return;
  }

  if (this.schemaStrategy.clearAll) {
    this.schemaStrategy.clearAll(this.adapter)
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
  } else {
    // Default: delete all tables
    this.schemaStrategy.deleteAllTables(this.adapter)
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
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
    callback(new Error('Storage not initialized'));
    return;
  }

  this.schemaStrategy.updateInventoryItem(this.adapter, collection, docId, version, operation)
    .then(function() { callback(null); })
    .catch(function(error) { callback(error); });
};

/**
 * Read the full inventory
 */
SqliteStorage.prototype.readInventory = function(callback) {
  if (!this.ready) {
    callback(new Error('Storage not initialized'));
    return;
  }

  this.schemaStrategy.readInventory(this.adapter)
    .then(function(inventory) { callback(null, inventory); })
    .catch(function(error) { callback(error); });
};

/**
 * Delete the database (if supported by adapter)
 */
SqliteStorage.prototype.deleteDatabase = function(callback) {
  this.schemaStrategy.deleteAllTables(this.adapter)
    .then(function() { callback(null); })
    .catch(function(error) { callback(error); });
};