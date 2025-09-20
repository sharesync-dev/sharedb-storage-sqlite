/**
 * AttachedCollectionPerTableStrategy - Creates collection-specific tables attached to the main database
 * This strategy is designed for environments where you want to keep all ShareDB data in the same
 * database file, but still benefit from collection-specific tables and projections.
 */

var CollectionPerTableStrategy = require('./collection-per-table-strategy');
var Formatted = require('../utils/formatted');

module.exports = AttachedCollectionPerTableStrategy;

function AttachedCollectionPerTableStrategy(options) {
  options = options || {};
  CollectionPerTableStrategy.call(this, options);

  // Store the attachment alias for prefixing table names
  this.attachmentAlias = options.attachmentAlias || null;

  // Initialize created tables tracking
  this.createdTables = {};
}

// Inherit from CollectionPerTableStrategy
AttachedCollectionPerTableStrategy.prototype = Object.create(CollectionPerTableStrategy.prototype);
AttachedCollectionPerTableStrategy.prototype.constructor = AttachedCollectionPerTableStrategy;

/**
 * Override getTableName to add attachment alias prefix if configured
 */
AttachedCollectionPerTableStrategy.prototype.getTableName = function(collection) {
  // console.log('[AttachedCollectionPerTableStrategy.getTableName] Called for collection:', collection, 'attachmentAlias:', this.attachmentAlias);
  var baseTableName;

  if (collection === '__inventory__') {
    baseTableName = 'sharedb_inventory';
  } else {
    // For attached strategy, use the collection name directly as the table name
    // The attachment alias provides the namespace separation
    baseTableName = collection.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  // Add attachment alias prefix if configured
  if (this.attachmentAlias) {
    return this.attachmentAlias + '.' + baseTableName;
  }

  // When no attachment alias, just return the base table name
  // (used during pre-initialization when working directly with the database)
  return baseTableName;
};

/**
 * Initialize the schema - creates inventory table and any pre-configured collection tables
 * This version creates tables in the attached database if attachmentAlias is set
 */
AttachedCollectionPerTableStrategy.prototype.initializeSchema = function(db, callback) {
  var self = this;
  var inventoryTable = self.getTableName('__inventory__');

  return Promise.resolve()
    .then(function() {
      // Create inventory table - matches CollectionPerTableStrategy schema
      return self.runAsync(db,
        'CREATE TABLE IF NOT EXISTS ' + inventoryTable + ' (' +
        'collection TEXT NOT NULL, ' +
        'doc_id TEXT NOT NULL, ' +
        'version_num REAL, ' +  // For numeric versions
        'version_str TEXT, ' +   // For string versions (timestamps)
        'has_pending INTEGER NOT NULL DEFAULT 0, ' +
        'updated_at INTEGER, ' +
        'PRIMARY KEY (collection, doc_id)' +
        ')'
      );
    })
    .then(function() {
      // Create indexes on inventory
      // SQLite doesn't allow database-qualified table names in CREATE INDEX
      // The index is created in the same database as the table automatically
      if (self.attachmentAlias) {
        // For attached databases, we need to create the index without the database prefix
        // The index will be created in the attached database because that's where the table is
        return self.runAsync(db, 'CREATE INDEX IF NOT EXISTS ' + self.attachmentAlias + '.idx_inventory_collection ON sharedb_inventory(collection)');
      } else {
        return self.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_collection ON sharedb_inventory(collection)');
      }
    })
    .then(function() {
      if (self.attachmentAlias) {
        return self.runAsync(db, 'CREATE INDEX IF NOT EXISTS ' + self.attachmentAlias + '.idx_inventory_updated ON sharedb_inventory(updated_at)');
      } else {
        return self.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_updated ON sharedb_inventory(updated_at)');
      }
    })
    .then(function() {
      // Create pre-configured collection tables and their projections
      if (self.collectionConfig) {
        var promises = [];
        var collections = Object.keys(self.collectionConfig);
        for (var i = 0; i < collections.length; i++) {
          promises.push(self.createCollectionTable(db, collections[i]));
        }
        return Promise.all(promises);
      }
    })
    .then(function() {
      // Create projection tables
      if (self.collectionConfig) {
        var promises = [];
        var collections = Object.keys(self.collectionConfig);
        for (var i = 0; i < collections.length; i++) {
          promises.push(self.createProjectionTables(db, collections[i]));
        }
        return Promise.all(promises);
      }
    })
    .then(function() {
      if (callback) callback(null);
    })
    .catch(function(error) {
      if (callback) {
        callback(error);
      } else {
        throw error;
      }
    });
};

/**
 * Validate that required tables exist
 * For attached strategy, we check tables in the appropriate database
 */
AttachedCollectionPerTableStrategy.prototype.validateSchema = function(db, callback) {
  var self = this;
  var sqliteMaster = this.attachmentAlias ? this.attachmentAlias + '.sqlite_master' : 'sqlite_master';

  var promise = db.getFirstAsync(
    "SELECT name FROM " + sqliteMaster + " WHERE type='table' AND name='sharedb_inventory'"
  ).then(function(result) {
    var inventoryExists = result;
    var isValid = !!inventoryExists;
    return isValid;
  });

  if (callback) {
    promise
      .then(function(isValid) { callback(null, isValid); })
      .catch(function(error) { callback(error, false); });
  }

  return promise;
};

/**
 * Delete all tables
 * For attached strategy, we drop tables from the appropriate database
 */
AttachedCollectionPerTableStrategy.prototype.deleteAllTables = function(db, callback) {
  var self = this;
  var sqliteMaster = this.attachmentAlias ? this.attachmentAlias + '.sqlite_master' : 'sqlite_master';

  var promise = db.getAllAsync(
    "SELECT name FROM " + sqliteMaster + " WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).then(function(tables) {
    var promises = [];
    for (var i = 0; i < tables.length; i++) {
      var tableName = self.attachmentAlias ? self.attachmentAlias + '.' + tables[i].name : tables[i].name;
      promises.push(self.runAsync(db, 'DROP TABLE IF EXISTS ' + tableName));
    }
    return Promise.all(promises);
  }).then(function() {
    // Clear the created tables tracking
    self.createdTables = {};
  });

  if (callback) {
    promise
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Override updateInventoryForRecord to use prefixed inventory table
 */
AttachedCollectionPerTableStrategy.prototype.updateInventoryForRecord = function(db, collection, docId, version, hasPending) {
  // Validate and normalize formats
  collection = Formatted.asCollectionName(collection);
  docId = Formatted.asDocId(docId);

  var inventoryTable = this.getTableName('__inventory__');
  var versionNum = null;
  var versionStr = null;

  // Determine if version is numeric or string
  if (typeof version === 'number') {
    versionNum = version;
  } else {
    versionStr = version;
  }

  return this.runAsync(db,
    'INSERT OR REPLACE INTO ' + inventoryTable + ' (collection, doc_id, version_num, version_str, has_pending, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?)',
    [collection, docId, versionNum, versionStr, hasPending ? 1 : 0, Date.now()]
  );
};

/**
 * Override readInventory to use prefixed inventory table
 */
AttachedCollectionPerTableStrategy.prototype.readInventory = function(db, callback) {
  var inventoryTable = this.getTableName('__inventory__');

  var promise = this.getAllAsync(db,
    'SELECT collection, doc_id, version_num, version_str, has_pending FROM ' + inventoryTable
  ).then(function(rows) {
    var collections = {};

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!collections[row.collection]) {
        collections[row.collection] = {};
      }

      // Store as object with version and pending flag
      var inventoryItem = {
        v: row.version_num !== null ? row.version_num : row.version_str,
        p: row.has_pending === 1
      };

      collections[row.collection][row.doc_id] = inventoryItem;
    }

    return {
      id: 'inventory',
      payload: { collections: collections }
    };
  }).catch(function(error) {
    // If table doesn't exist, return empty inventory
    if (error.message && error.message.includes('no such table')) {
      return {
        id: 'inventory',
        payload: { collections: {} }
      };
    }
    throw error;
  });

  if (callback) {
    promise
      .then(function(result) { callback(null, result); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Override updateInventoryItem to use prefixed inventory table
 */
AttachedCollectionPerTableStrategy.prototype.updateInventoryItem = function(db, collection, docId, version, operation, callback) {
  var self = this;
  var inventoryTable = this.getTableName('__inventory__');
  var promise;

  if (operation === 'add') {
    // Check if version exists
    promise = this.getFirstAsync(db,
      'SELECT version_num, version_str FROM ' + inventoryTable + ' WHERE collection = ? AND doc_id = ?',
      [collection, docId]
    ).then(function(row) {
      if (row) {
        // Update existing entry
        return self.updateInventoryForRecord(db, collection, docId, version, false);
      } else {
        // Insert new entry
        return self.updateInventoryForRecord(db, collection, docId, version, false);
      }
    });
  } else if (operation === 'remove') {
    promise = this.runAsync(db,
      'DELETE FROM ' + inventoryTable + ' WHERE collection = ? AND doc_id = ?',
      [collection, docId]
    );
  } else {
    promise = Promise.reject(new Error('Invalid operation: ' + operation));
  }

  if (callback) {
    promise
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Override createCollectionTable to handle indexes for attached databases
 */
AttachedCollectionPerTableStrategy.prototype.createCollectionTable = function(db, collection) {
  var self = this;
  var tableName = this.getTableName(collection);
  var config = this.collectionConfig && this.collectionConfig[collection] || {};

  return this.runAsync(db,
    'CREATE TABLE IF NOT EXISTS ' + tableName + ' (' +
    'id TEXT PRIMARY KEY, ' +
    'collection TEXT, ' +
    'data JSON' +
    ')'
  ).then(function() {
    // Mark table as created
    self.createdTables[collection] = true;

    // Create indexes if configured
    if (config.indexes && config.indexes.length > 0) {
      var promises = [];
      for (var i = 0; i < config.indexes.length; i++) {
        var field = config.indexes[i];
        // Sanitize field name for index name (replace dots with underscores)
        var sanitizedField = field.replace(/\./g, '_');
        // For attached databases, prefix the index name with the alias
        // Use idx_ prefix for consistency with inventory indexes
        var indexName = self.attachmentAlias
          ? self.attachmentAlias + '.idx_' + tableName.split('.').pop() + '_' + sanitizedField
          : 'idx_' + tableName.split('.').pop() + '_' + sanitizedField;
        // The table name in the ON clause needs to be unqualified for attached databases
        var onTable = self.attachmentAlias ? tableName.split('.').pop() : tableName;
        promises.push(self.runAsync(db,
          'CREATE INDEX IF NOT EXISTS ' + indexName +
          ' ON ' + onTable +
          ' ((json_extract(data, \'$.' + field + '\')))'
        ));
      }
      return Promise.all(promises);
    }
  });
};

/**
 * Override createProjectionTable to add attachment alias prefix
 */
AttachedCollectionPerTableStrategy.prototype.createProjectionTable = function(db, projection) {
  var self = this;

  // Build CREATE TABLE statement
  var columns = [];
  for (var targetColumn in projection.mapping) {
    var mappingConfig = projection.mapping[targetColumn];

    // Determine SQL datatype
    var dataType = 'TEXT'; // default
    if (typeof mappingConfig === 'object' && mappingConfig.dataType) {
      dataType = mappingConfig.dataType;
    }

    columns.push(targetColumn + ' ' + dataType);
  }
  columns.push('created_at INTEGER');

  // Add PRIMARY KEY constraint
  var primaryKeyClause = 'PRIMARY KEY (' + projection.primaryKey.join(', ') + ')';

  // Add attachment alias prefix if configured
  var projectionTableName = projection.targetTable;
  if (this.attachmentAlias) {
    projectionTableName = this.attachmentAlias + '.' + projection.targetTable;
  }

  var createTableSQL = 'CREATE TABLE IF NOT EXISTS ' + projectionTableName + ' (' +
    columns.join(', ') + ', ' +
    primaryKeyClause +
  ')';

  return this.runAsync(db, createTableSQL).then(function() {
    // Create indexes if specified
    if (projection.indexes && projection.indexes.length > 0) {
      var promises = [];
      for (var i = 0; i < projection.indexes.length; i++) {
        var index = projection.indexes[i];
        var indexName = self.attachmentAlias
          ? self.attachmentAlias + '.idx_' + projection.targetTable + '_' + index.columns.join('_')
          : 'idx_' + projection.targetTable + '_' + index.columns.join('_');
        var onTable = self.attachmentAlias ? projection.targetTable : projectionTableName;
        var indexSQL = 'CREATE INDEX IF NOT EXISTS ' + indexName +
          ' ON ' + onTable + ' (' + index.columns.join(', ') + ')';
        promises.push(self.runAsync(db, indexSQL));
      }
      return Promise.all(promises);
    }
  });
};

/**
 * Helper to run async SQL with consistent promise handling
 */
AttachedCollectionPerTableStrategy.prototype.runAsync = function(db, sql, params) {
  return db.runAsync(sql, params || []);
};

/**
 * Helper to get all results with consistent promise handling
 */
AttachedCollectionPerTableStrategy.prototype.getAllAsync = function(db, sql, params) {
  return db.getAllAsync(sql, params || []);
};

/**
 * Helper to get first result with consistent promise handling
 */
AttachedCollectionPerTableStrategy.prototype.getFirstAsync = function(db, sql, params) {
  return db.getFirstAsync(sql, params || []);
};

/**
 * Pre-initialize a database with the necessary schema and indexes
 * This is called before attaching databases to ensure they have the proper structure
 * @param {string} dbPath - Path to the database to initialize
 * @param {Function} createAdapter - Factory function to create an adapter for the database
 * @returns {Promise} Promise that resolves when initialization is complete
 */
AttachedCollectionPerTableStrategy.prototype.preInitializeDatabase = function(dbPath, createAdapter) {
  var self = this;

  // Create an adapter for the database
  var adapter = createAdapter(dbPath);

  // Save the attachment alias and temporarily clear it
  // During pre-initialization, we're working directly with the database file
  // before it's attached, so we don't use the alias prefix
  var savedAlias = self.attachmentAlias;
  self.attachmentAlias = null;

  return adapter.connect()
    .then(function() {
      // Initialize the schema without the attachment alias
      // This will create inventory table, indexes, and collection tables
      return self.initializeSchema(adapter);
    })
    .then(function() {
      // Restore the attachment alias
      self.attachmentAlias = savedAlias;
      return adapter.disconnect();
    })
    .catch(function(error) {
      // Restore the attachment alias even on error
      self.attachmentAlias = savedAlias;
      // Always try to disconnect even on error
      return adapter.disconnect().then(function() {
        throw error;
      });
    });
};