const BaseSchemaStrategy = require('./base-schema-strategy');
const logger = { info: () => {}, error: () => {} }; // Simple logger stub

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
  const knownOptions = ['useEncryption', 'encryptionCallback', 'decryptionCallback', 'schemaPrefix', 'collectionMapping', 'debug'];
  for (const key in options) {
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
  const strategy = this;
  const promises = [];
  
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
  promises.push(db.runAsync(
      'CREATE TABLE IF NOT EXISTS ' + docsTable + ' (' +
      'id TEXT PRIMARY KEY, ' +
      'data JSON' +
    ')',
  ).promise());

  // Create meta table
  promises.push(db.runAsync(
      'CREATE TABLE IF NOT EXISTS ' + metaTable + ' (' +
      'id TEXT PRIMARY KEY, ' +
      'data JSON' +
    ')',
  ).promise());

  Promise.all(promises).then(function() {
    strategy.debug && logger.info('DefaultSchemaStrategy: Schema initialized');
    callback && callback();
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Validate that the schema exists
 */
DefaultSchemaStrategy.prototype.validateSchema = function(db, callback) {
  const promises = [];

  // Check if tables exist
  promises.push(db.getFirstAsync(
      'SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'docs\'',
  ).promise());

  promises.push(db.getFirstAsync(
      'SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'meta\'',
  ).promise());

  Promise.all(promises).then(function(results) {
    const isValid = results[0] && results[1];
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
    const mappedName = this.collectionMapping(collection === '__meta__' ? 'meta' : collection);
    // Return as-is if it already includes a schema prefix (contains a dot)
    return mappedName.includes('.') ? mappedName : this.getPrefixedTableName(mappedName);
  }
  
  // Otherwise use default strategy: all docs go in 'docs' table regardless of collection
  const baseTableName = collection === '__meta__' ? 'meta' : 'docs';
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
  const strategy = this;
  const promises = [];
  let totalCount = 0;

  // Process docs records
  if (recordsByType.docs) {
    const docsRecords = Array.isArray(recordsByType.docs) ? recordsByType.docs : [recordsByType.docs];
    for (let i = 0; i < docsRecords.length; i++) {
      let record = docsRecords[i];
      record = strategy.maybeEncryptRecord(record);
      promises.push(db.runAsync(
          'INSERT OR REPLACE INTO docs (id, data) VALUES (?, ?)',
          [record.id, JSON.stringify(record)],
      ).promise());
      totalCount++;
    }
  }

  // Process meta records
  if (recordsByType.meta) {
    const metaRecords = Array.isArray(recordsByType.meta) ? recordsByType.meta : [recordsByType.meta];
    for (let j = 0; j < metaRecords.length; j++) {
      const metaRecord = metaRecords[j];
      // Meta records are not encrypted in the default strategy
      promises.push(db.runAsync(
          'INSERT OR REPLACE INTO meta (id, data) VALUES (?, ?)',
          [metaRecord.id, JSON.stringify(metaRecord.payload)],
      ).promise());
      totalCount++;
    }
  }

  Promise.all(promises).then(function() {
    strategy.debug && logger.info('DefaultSchemaStrategy: Wrote ' + totalCount + ' records');
    callback && callback(null);
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Read a single record
 */
DefaultSchemaStrategy.prototype.readRecord = function(db, type, collection, id, callback) {
  const strategy = this;
  const tableName = this.getTableName(type === 'meta' ? 'meta' : 'docs');

  db.getFirstAsync(
      'SELECT data FROM ' + tableName + ' WHERE id = ?',
      [id],
  ).then(function(row) {
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
  const strategy = this;
  const tableName = this.getTableName(type === 'meta' ? 'meta' : 'docs');

  db.getAllAsync(
      'SELECT id, data FROM ' + tableName,
  ).then(function(rows) {
    const records = [];
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

  const strategy = this;
  const tableName = this.getTableName(type === 'meta' ? 'meta' : 'docs');

  // Create placeholders for the IN clause (?, ?, ?, ...)
  const placeholders = ids.map(function() {
    return '?';
  }).join(', ');
  const sql = 'SELECT id, data FROM ' + tableName + ' WHERE id IN (' + placeholders + ')';

  db.getAllAsync(sql, ids).then(function(rows) {
    const records = [];

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

    strategy.debug && logger.info('DefaultSchemaStrategy: Bulk read ' + records.length + '/' + ids.length + ' records from ' + tableName);
    callback && callback(null, records);
  }).catch(function(error) {
    strategy.debug && logger.error('DefaultSchemaStrategy: Error in bulk read from ' + tableName + ': ' + error);
    callback && callback(error, null);
  });
};

/**
 * Delete a record
 */
DefaultSchemaStrategy.prototype.deleteRecord = function(db, type, collection, id, callback) {
  const strategy = this;
  const tableName = this.getTableName(type === 'meta' ? 'meta' : 'docs');

  db.runAsync(
      'DELETE FROM ' + tableName + ' WHERE id = ?',
      [id],
  ).promise().then(function() {
    strategy.debug && logger.info('DefaultSchemaStrategy: Deleted record ' + id + ' from ' + tableName);
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
  const strategy = this;
  const inventory = {
    id:      'inventory',
    payload: {
      collections: {},
    },
  };
  
  // Get the meta table name (with mapping if configured)
  const metaTable = this.collectionMapping && typeof this.collectionMapping === 'function'
    ? this.collectionMapping('meta')
    : this.getPrefixedTableName('meta');

  // Check if inventory already exists
  db.getFirstAsync(
      'SELECT data FROM ' + metaTable + ' WHERE id = ?',
      ['inventory'],
  ).then(function(row) {
    if (row) {
      // Inventory exists, return it
      const existing = JSON.parse(row.data);
      callback && callback(null, {
        id:      'inventory',
        payload: existing,
      });
    } else {
      // Create new inventory
      return db.runAsync(
          'INSERT INTO ' + metaTable + ' (id, data) VALUES (?, ?)',
          ['inventory', JSON.stringify(inventory.payload)],
      ).promise().then(function() {
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
  const strategy = this;
  
  // Get the meta table name (with mapping if configured)
  const metaTable = this.collectionMapping && typeof this.collectionMapping === 'function'
    ? this.collectionMapping('meta')
    : this.getPrefixedTableName('meta');
  
  db.getFirstAsync(
      'SELECT data FROM ' + metaTable + ' WHERE id = ?',
      ['inventory'],
  ).then(function(row) {
    if (!row) {
      callback && callback(null, {
        id:      'inventory',
        payload: {collections: {}},
      });
      return;
    }

    const inventory = JSON.parse(row.data);
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
  const strategy = this;

  // Read current inventory
  this.readInventory(db, function(error, inventory) {
    if (error) {
      callback && callback(error);
      return;
    }

    const payload = inventory.payload || {collections: {}};

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
    const metaTable = strategy.collectionMapping && typeof strategy.collectionMapping === 'function'
      ? strategy.collectionMapping('meta')
      : strategy.getPrefixedTableName('meta');
    
    // Write updated inventory back
    db.runAsync(
        'UPDATE ' + metaTable + ' SET data = ? WHERE id = ?',
        [JSON.stringify(payload), 'inventory'],
    ).promise().then(function() {
      strategy.debug && logger.info('DefaultSchemaStrategy: Updated inventory for ' + collection + '/' + docId);
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
  const strategy = this;
  const promises = [];

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
  promises.push(db.runAsync('DROP TABLE IF EXISTS ' + metaTable));
  promises.push(db.runAsync('DROP TABLE IF EXISTS ' + docsTable));
  promises.push(db.runAsync('DROP TABLE IF EXISTS ' + this.getPrefixedTableName('inventory')));

  Promise.all(promises.map(function(p) {
    return p.promise();
  }))
      .then(function() {
        strategy.debug && logger.info('DefaultSchemaStrategy: Deleted all tables');
        callback && callback();
      })
      .catch(function(err) {
        callback && callback(err);
      });
};
