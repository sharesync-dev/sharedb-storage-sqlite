var BaseSchemaStrategy = require('./base-schema-strategy');
var Formatted = require('../utils/formatted');
var {
  CREATE_TABLE, CREATE_INDEX, DROP_TABLE,
  SELECT, FROM, COLUMN,
  INSERT_OR_REPLACE, INSERT,
  UPDATE,
  DELETE_FROM,
  EQ, IN, PARAM
} = require('@redthreadlabs/squilt');

/**
 * Default schema strategy that implements the original ShareDB storage pattern:
 * - Single 'docs' table for all document collections
 * - Single 'meta' table for inventory and metadata
 * - All-or-nothing encryption (entire payload encrypted)
 */
module.exports = DefaultSchemaStrategy;
function DefaultSchemaStrategy(options) {
  BaseSchemaStrategy.call(this, options);
  options = options || {};
  this.useEncryption = options.useEncryption || false;
  this.encryptionCallback = options.encryptionCallback;
  this.decryptionCallback = options.decryptionCallback;
  // schemaPrefix is optional - use empty string if not provided
  this.schemaPrefix = options.schemaPrefix ? options.schemaPrefix : '';
  this.collectionMapping = options.collectionMapping;

  // Copy any additional options as properties for testing and extensibility
  var knownOptions = ['useEncryption', 'encryptionCallback', 'decryptionCallback', 'schemaPrefix', 'collectionMapping', 'debug'];
  for (var key in options) {
    if (options.hasOwnProperty(key) && !knownOptions.includes(key)) {
      this[key] = options[key];
    }
  }
}

// Inherit from BaseSchemaStrategy
DefaultSchemaStrategy.prototype = Object.create(BaseSchemaStrategy.prototype);
DefaultSchemaStrategy.prototype.constructor = DefaultSchemaStrategy;

/**
 * Helper to get the table name with schema prefix if applicable
 */
DefaultSchemaStrategy.prototype.getPrefixedTableName = function(tableName) {
  return this.schemaPrefix ? this.schemaPrefix + '.' + tableName : tableName;
};

/**
 * Initialize the default schema with 'docs' and 'meta' tables
 */
DefaultSchemaStrategy.prototype.initializeSchema = function(db, callback) {
  var strategy = this;
  var promises = [];

  // Use getTableName to get the correct table names (with mapping if configured)
  // When collectionMapping is used, it expects 'docs' and 'meta' as inputs
  let docsTable, metaTable;

  if (this.collectionMapping && typeof this.collectionMapping === 'function') {
    // When mapping is provided, call it directly with 'docs' and 'meta'
    docsTable = this.collectionMapping('docs');
    metaTable = this.collectionMapping('meta');
    // Add prefix if the mapped names don't already include it
    if (!docsTable.includes('.')) docsTable = this.getPrefixedTableName(docsTable);
    if (!metaTable.includes('.')) metaTable = this.getPrefixedTableName(metaTable);
  } else {
    // Use standard table names with prefix
    docsTable = this.getPrefixedTableName('docs');
    metaTable = this.getPrefixedTableName('meta');
  }

  // Create docs table
  var createDocsSQL = CREATE_TABLE(docsTable)
    .column('id', 'TEXT', { primaryKey: true })
    .column('data', 'TEXT')  // JSON stored as TEXT
    .ifNotExists()
    .toSQL();
  promises.push(db.runAsync(createDocsSQL));

  // Create meta table
  var createMetaSQL = CREATE_TABLE(metaTable)
    .column('id', 'TEXT', { primaryKey: true })
    .column('data', 'TEXT')  // JSON stored as TEXT
    .ifNotExists()
    .toSQL();
  promises.push(db.runAsync(createMetaSQL));

  Promise.all(promises).then(function() {
    strategy.debug && console.log('[DefaultSchemaStrategy] Schema initialized');
    callback && callback();
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Validate that the schema exists
 */
DefaultSchemaStrategy.prototype.validateSchema = function(db, callback) {
  var promises = [];

  // Check if tables exist - use raw SQL for sqlite_master query
  promises.push(db.getFirstAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='docs'"
  ));

  promises.push(db.getFirstAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'"
  ));

  Promise.all(promises).then(function(results) {
    var isValid = results[0] && results[1];
    callback && callback(null, isValid);
  }).catch(function(error) {
    callback && callback(error, false);
  });
};

/**
 * Get table name - always 'docs' for documents, 'meta' for metadata
 */
DefaultSchemaStrategy.prototype.getTableName = function(collection) {
  // If collectionMapping is provided, use it
  if (this.collectionMapping && typeof this.collectionMapping === 'function') {
    // Map the collection name
    var mappedName = this.collectionMapping(collection === '__meta__' ? 'meta' : collection);
    // Return as-is if it already includes a schema prefix (contains a dot)
    return mappedName.includes('.') ? mappedName : this.getPrefixedTableName(mappedName);
  }

  // Otherwise use default strategy: all docs go in 'docs' table regardless of collection
  var baseTableName = collection === '__meta__' ? 'meta' : 'docs';
  return this.getPrefixedTableName(baseTableName);
};

/**
 * Validate and sanitize table name to prevent SQL injection
 */
DefaultSchemaStrategy.prototype.validateTableName = function(tableName) {
  if (tableName !== 'docs' && tableName !== 'meta') {
    throw new Error('Invalid table name: ' + tableName + '. Must be "docs" or "meta"');
  }
  return tableName;
};

/**
 * Write records using the default schema
 */
DefaultSchemaStrategy.prototype.writeRecords = function(db, recordsByType, callback) {
  var strategy = this;
  var promises = [];
  let totalCount = 0;

  // Get table names
  var docsTable = this.getTableName('docs');
  var metaTable = this.getTableName('__meta__');

  // Process docs records
  if (recordsByType.docs) {
    var docsRecords = Array.isArray(recordsByType.docs) ? recordsByType.docs : [recordsByType.docs];
    for (let i = 0; i < docsRecords.length; i++) {
      let record = docsRecords[i];
      // Validate that we have a proper compound ID
      var compoundId = Formatted.asCompoundKey(record.id);
      record = strategy.maybeEncryptRecord(record);

      var insertDocsSQL = INSERT_OR_REPLACE(docsTable, ['id', 'data'], [PARAM('id'), PARAM('data')]).toSQL();
      promises.push(db.runAsync(insertDocsSQL, [compoundId, JSON.stringify(record)]));
      totalCount++;
    }
  }

  // Process meta records
  if (recordsByType.meta) {
    var metaRecords = Array.isArray(recordsByType.meta) ? recordsByType.meta : [recordsByType.meta];
    for (let j = 0; j < metaRecords.length; j++) {
      var metaRecord = metaRecords[j];
      // Validate that we have a proper compound ID
      var compoundId = Formatted.asCompoundKey(metaRecord.id);
      // Meta records are not encrypted in the default strategy
      var insertMetaSQL = INSERT_OR_REPLACE(metaTable, ['id', 'data'], [PARAM('id'), PARAM('data')]).toSQL();
      promises.push(db.runAsync(insertMetaSQL, [compoundId, JSON.stringify(metaRecord.payload)]));
      totalCount++;
    }
  }

  Promise.all(promises).then(function() {
    strategy.debug && console.log('DefaultSchemaStrategy: Wrote ' + totalCount + ' records');
    callback && callback(null);
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Read a single record
 */
DefaultSchemaStrategy.prototype.readRecord = function(db, type, collection, id, callback) {
  var strategy = this;
  var tableName = this.getTableName(type === 'meta' ? '__meta__' : collection);

  // Validate and use the compound ID format
  var compoundId = Formatted.asCompoundKey(id);

  var selectSQL = SELECT(FROM(tableName), COLUMN('data'))
    .where(EQ(COLUMN('id'), PARAM('id')))
    .toSQL();

  db.getFirstAsync(selectSQL, [compoundId]).then(function(row) {
    if (!row) {
      callback && callback(null, null);
      return;
    }

    let record = JSON.parse(row.data);

    // Decrypt if needed (only for docs, not meta)
    if (type === 'docs' && strategy.useEncryption && record.encrypted_payload) {
      record = strategy.maybeDecryptRecord(record);
    }

    callback && callback(null, record);
  }).catch(function(error) {
    // If the table doesn't exist (e.g., after deleteDatabase), treat it as "record not found"
    if (error && error.code === 'SQLITE_ERROR' && error.message && error.message.includes('no such table')) {
      callback && callback(null, null);
    } else {
      callback && callback(error, null);
    }
  });
};

/**
 * Read all records of a type
 */
DefaultSchemaStrategy.prototype.readAllRecords = function(db, type, collection, callback) {
  var strategy = this;
  var tableName = this.getTableName(type === 'meta' ? '__meta__' : collection);

  var selectSQL = SELECT(FROM(tableName), COLUMN('id'), COLUMN('data')).toSQL();

  db.getAllAsync(selectSQL).then(function(rows) {
    var records = [];
    for (let i = 0; i < rows.length; i++) {
      let record = JSON.parse(rows[i].data);

      // Decrypt if needed (only for docs, not meta)
      if (type === 'docs' && strategy.useEncryption && record.encrypted_payload) {
        record = strategy.maybeDecryptRecord(record);
      }

      records.push({
        id:      rows[i].id,
        payload: record.payload || record,
      });
    }

    callback && callback(null, records);
  }).catch(function(error) {
    callback && callback(error, null);
  });
};

/**
 * Read multiple records by ID in a single SQL query (bulk operation)
 */
DefaultSchemaStrategy.prototype.readRecordsBulk = function(db, type, collection, ids, callback) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return callback && callback(null, []);
  }

  var strategy = this;
  var tableName = this.getTableName(type === 'meta' ? '__meta__' : collection);

  // Validate all IDs are proper compound keys
  var validatedIds = ids.map(function(id) {
    return Formatted.asCompoundKey(id);
  });

  // Build IN clause with placeholders
  var placeholders = validatedIds.map(function() { return '?'; }).join(', ');
  var sql = SELECT(FROM(tableName), COLUMN('id'), COLUMN('data')).toSQL() +
    ' WHERE id IN (' + placeholders + ')';

  db.getAllAsync(sql, validatedIds).then(function(rows) {
    var records = [];

    for (let i = 0; i < rows.length; i++) {
      let record = JSON.parse(rows[i].data);

      // Decrypt if needed (only for docs, not meta)
      if (type === 'docs' && strategy.useEncryption && record.encrypted_payload) {
        record = strategy.maybeDecryptRecord(record);
      }

      records.push({
        id:      rows[i].id,
        payload: record.payload || record,
      });
    }

    strategy.debug && console.log('DefaultSchemaStrategy: Bulk read ' + records.length + '/' + ids.length + ' records from ' + tableName);
    callback && callback(null, records);
  }).catch(function(error) {
    strategy.debug && console.error('DefaultSchemaStrategy: Error in bulk read from ' + tableName + ': ' + error);
    callback && callback(error, null);
  });
};

/**
 * Delete a record
 */
DefaultSchemaStrategy.prototype.deleteRecord = function(db, type, collection, id, callback) {
  var strategy = this;
  var tableName = this.getTableName(type === 'meta' ? '__meta__' : collection);

  // Validate and use the compound ID format
  var compoundId = Formatted.asCompoundKey(id);

  var deleteSQL = DELETE_FROM(tableName)
    .where(EQ(COLUMN('id'), PARAM('id')))
    .toSQL();

  db.runAsync(deleteSQL, [compoundId]).then(function() {
    strategy.debug && console.log('DefaultSchemaStrategy: Deleted record ' + id + ' from ' + tableName);
    callback && callback();
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Helper to encrypt a record if encryption is enabled
 */
DefaultSchemaStrategy.prototype.maybeEncryptRecord = function(record) {
  if (!this.useEncryption || !this.encryptionCallback) {
    return record;
  }

  return {
    id:                record.id,
    encrypted_payload: this.encryptionCallback(JSON.stringify(record.payload)),
  };
};

/**
 * Helper to decrypt a record if it's encrypted
 */
DefaultSchemaStrategy.prototype.maybeDecryptRecord = function(record) {
  if (!this.useEncryption || !this.decryptionCallback || !record.encrypted_payload) {
    return record;
  }

  return {
    id:      record.id,
    payload: JSON.parse(this.decryptionCallback(record.encrypted_payload)),
  };
};

/**
 * Get inventory type - JSON for default strategy
 */
DefaultSchemaStrategy.prototype.getInventoryType = function() {
  return this.schemaPrefix ? this.schemaPrefix + '-json' : 'json';
};

/**
 * Initialize inventory as a single JSON document in meta table
 */
DefaultSchemaStrategy.prototype.initializeInventory = function(db, callback) {
  var strategy = this;
  var inventory = {
    id:      'inventory',
    payload: {
      collections: {},
    },
  };

  // Get the meta table name (with mapping if configured)
  var metaTable = this.collectionMapping && typeof this.collectionMapping === 'function'
    ? this.collectionMapping('meta')
    : this.getPrefixedTableName('meta');

  // Check if inventory already exists
  var selectSQL = SELECT(FROM(metaTable), COLUMN('data'))
    .where(EQ(COLUMN('id'), PARAM('id')))
    .toSQL();

  db.getFirstAsync(selectSQL, ['inventory']).then(function(row) {
    if (row) {
      // Inventory exists, return it
      var existing = JSON.parse(row.data);
      callback && callback(null, {
        id:      'inventory',
        payload: existing,
      });
    } else {
      // Create new inventory
      var insertSQL = INSERT(metaTable, ['id', 'data'], [PARAM('id'), PARAM('data')]).toSQL();
      return db.runAsync(insertSQL, ['inventory', JSON.stringify(inventory.payload)]).then(function() {
        callback && callback(null, inventory);
      });
    }
  }).catch(function(error) {
    callback && callback(error, null);
  });
};

/**
 * Read the entire inventory from the JSON document
 */
DefaultSchemaStrategy.prototype.readInventory = function(db, callback) {
  var strategy = this;

  // Get the meta table name (with mapping if configured)
  var metaTable = this.collectionMapping && typeof this.collectionMapping === 'function'
    ? this.collectionMapping('meta')
    : this.getPrefixedTableName('meta');

  var selectSQL = SELECT(FROM(metaTable), COLUMN('data'))
    .where(EQ(COLUMN('id'), PARAM('id')))
    .toSQL();

  db.getFirstAsync(selectSQL, ['inventory']).then(function(row) {
    if (!row) {
      callback && callback(null, {
        id:      'inventory',
        payload: {collections: {}},
      });
      return;
    }

    var inventory = JSON.parse(row.data);
    callback && callback(null, {
      id:      'inventory',
      payload: inventory,
    });
  }).catch(function(error) {
    callback && callback(error, null);
  });
};

/**
 * Update inventory by modifying the JSON document
 */
DefaultSchemaStrategy.prototype.updateInventoryItem = function(db, collection, docId, version, operation, callback) {
  var strategy = this;

  // Validate collection name and document ID
  collection = Formatted.asCollectionName(collection);
  docId = Formatted.asDocId(docId);

  // Read current inventory
  this.readInventory(db, function(error, inventory) {
    if (error) {
      callback && callback(error);
      return;
    }

    var payload = inventory.payload || {collections: {}};

    // Ensure collection exists
    if (!payload.collections[collection]) {
      payload.collections[collection] = {};
    }

    // Update based on operation
    if (operation === 'add' || operation === 'update') {
      payload.collections[collection][docId] = version;
    } else if (operation === 'remove') {
      delete payload.collections[collection][docId];

      // Clean up empty collections
      if (Object.keys(payload.collections[collection]).length === 0) {
        delete payload.collections[collection];
      }
    }

    // Get the meta table name (with mapping if configured)
    var metaTable = strategy.collectionMapping && typeof strategy.collectionMapping === 'function'
      ? strategy.collectionMapping('meta')
      : strategy.getPrefixedTableName('meta');

    // Write updated inventory back
    var updateSQL = UPDATE(metaTable)
      .set('data', PARAM('data'))
      .where(EQ(COLUMN('id'), PARAM('id')))
      .toSQL();

    db.runAsync(updateSQL, [JSON.stringify(payload), 'inventory']).then(function() {
      strategy.debug && console.log('DefaultSchemaStrategy: Updated inventory for ' + collection + '/' + docId);
      callback && callback(null);
    }).catch(function(err) {
      callback && callback(err);
    });
  });
};

/**
 * Delete all tables created by this schema strategy
 */
DefaultSchemaStrategy.prototype.deleteAllTables = function(db, callback) {
  var strategy = this;
  var promises = [];

  // Get table names (with mapping if configured)
  let docsTable, metaTable;
  if (this.collectionMapping && typeof this.collectionMapping === 'function') {
    docsTable = this.collectionMapping('docs');
    metaTable = this.collectionMapping('meta');
  } else {
    docsTable = this.getPrefixedTableName('docs');
    metaTable = this.getPrefixedTableName('meta');
  }

  // Drop the standard tables used by DefaultSchemaStrategy
  promises.push(db.runAsync(DROP_TABLE(metaTable).ifExists().toSQL()));
  promises.push(db.runAsync(DROP_TABLE(docsTable).ifExists().toSQL()));
  promises.push(db.runAsync(DROP_TABLE(this.getPrefixedTableName('inventory')).ifExists().toSQL()));

  Promise.all(promises)
      .then(function() {
        strategy.debug && console.log('DefaultSchemaStrategy: Deleted all tables');
        callback && callback();
      })
      .catch(function(err) {
        callback && callback(err);
      });
};
