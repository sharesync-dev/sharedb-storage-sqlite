/**
 * Schema strategy that creates a separate table for each collection.
 * This allows for:
 * - Collection-specific indexes
 * - Field-level encryption configuration per collection
 * - Optimized queries per collection
 * - Better performance for large collections
 * - Relational projections for array fields
 */

var BaseSchemaStrategy = require('./base-schema-strategy');
var Formatted = require('../utils/formatted');

module.exports = CollectionPerTableStrategy;

function CollectionPerTableStrategy(options) {
  options = options || {};
  BaseSchemaStrategy.call(this, options);

  this.useEncryption = options.useEncryption || false;
  this.encryptionCallback = options.encryptionCallback;
  this.decryptionCallback = options.decryptionCallback;
  this.collectionConfig = options.collectionConfig || {};
  this.createdTables = {};
  this.projectionsByCollection = this.parseProjections(this.collectionConfig);
  this.disableTransactions = options.disableTransactions;
}

// Inherit from BaseSchemaStrategy
CollectionPerTableStrategy.prototype = Object.create(BaseSchemaStrategy.prototype);
CollectionPerTableStrategy.prototype.constructor = CollectionPerTableStrategy;

/**
 * Parse projections from collection configuration
 */
CollectionPerTableStrategy.prototype.parseProjections = function(collectionConfig) {
  var projectionsByCollection = {};
  // console.log('[CollectionPerTableStrategy.parseProjections] Parsing projections for collections:', Object.keys(collectionConfig));

  for (var collection in collectionConfig) {
    var config = collectionConfig[collection];
    // console.log('[CollectionPerTableStrategy.parseProjections] Collection:', collection, 'has projections:', !!config.projections);
    if (config.projections && Array.isArray(config.projections)) {
      projectionsByCollection[collection] = config.projections.map(function(projection) {
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
};

/**
 * Initialize the schema - creates inventory table and any pre-configured collection tables
 */
CollectionPerTableStrategy.prototype.initializeSchema = function(db, callback) {
  var self = this;

  return Promise.resolve()
    .then(function() {
      // Create inventory table with support for both numeric and string versions
      return self.runAsync(db,
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
    })
    .then(function() {
      // Create indexes for inventory table
      return self.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_collection ON sharedb_inventory (collection)');
    })
    .then(function() {
      return self.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_updated ON sharedb_inventory (updated_at)');
    })
    .then(function() {
      // Create tables for any pre-configured collections
      var collections = Object.keys(self.collectionConfig);
      var promises = [];
      for (var i = 0; i < collections.length; i++) {
        promises.push(self.createCollectionTable(db, collections[i]));
      }
      return Promise.all(promises);
    })
    .then(function() {
      // Create projection tables
      var collections = Object.keys(self.collectionConfig);
      var promises = [];
      for (var i = 0; i < collections.length; i++) {
        promises.push(self.createProjectionTables(db, collections[i]));
      }
      return Promise.all(promises);
    })
    .then(function() {
      self.debug && console.log('[CollectionPerTableStrategy] Schema initialized');
      if (callback) callback(null);
    })
    .catch(function(error) {
      console.error('[CollectionPerTableStrategy] Schema initialization error:', error);
      if (callback) callback(error);
      throw error;
    });
};

/**
 * Create a table for a specific collection with its indexes
 */
CollectionPerTableStrategy.prototype.createCollectionTable = function(db, collection) {
  var self = this;
  var tableName = this.getTableName(collection);
  var config = this.collectionConfig[collection] || {};

  return this.runAsync(db,
    'CREATE TABLE IF NOT EXISTS ' + tableName + ' (' +
    'id TEXT PRIMARY KEY, ' +
    'collection TEXT, ' +
    'data JSON' +
    ')'
  ).then(function() {
    // Create indexes sequentially after table is created
    if (config.indexes && config.indexes.length > 0) {
      var promises = [];
      for (var i = 0; i < config.indexes.length; i++) {
        var field = config.indexes[i];
        // Sanitize field name for index name (replace dots with underscores)
        var sanitizedField = field.replace(/\./g, '_');
        // Use idx_ prefix for consistency with inventory indexes
        var indexName = 'idx_' + tableName + '_' + sanitizedField;
        // Use single quotes for JSON path in SQLite
        promises.push(self.runAsync(db,
          'CREATE INDEX IF NOT EXISTS ' + indexName + ' ON ' + tableName +
          ' (json_extract(data, \'$.' + field + '\'))'
        ));
      }
      return Promise.all(promises);
    }
  }).then(function() {
    self.createdTables[collection] = true;
    self.debug && console.log('[CollectionPerTableStrategy] Created table for collection:', collection);
  });
};

/**
 * Create projection tables for a collection
 */
CollectionPerTableStrategy.prototype.createProjectionTables = function(db, collection) {
  var self = this;
  var projections = this.projectionsByCollection[collection];
  if (!projections || projections.length === 0) {
    return Promise.resolve();
  }

  var promises = [];
  for (var i = 0; i < projections.length; i++) {
    promises.push(this.createProjectionTable(db, projections[i]));
  }
  return Promise.all(promises);
};

/**
 * Create a single projection table
 */
CollectionPerTableStrategy.prototype.createProjectionTable = function(db, projection) {
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

  // Use the projection table name directly without prefix
  var projectionTableName = projection.targetTable;

  var createTableSQL = 'CREATE TABLE IF NOT EXISTS ' + projectionTableName + ' (' +
    columns.join(', ') + ', ' +
    primaryKeyClause +
  ')';

  return this.runAsync(db, createTableSQL)
    .then(function() {
      // Create indexes for primary key columns
      var promises = [];
      for (var i = 0; i < projection.primaryKey.length; i++) {
        var column = projection.primaryKey[i];
        var indexName = 'idx_' + projection.targetTable + '_' + column;
        promises.push(self.runAsync(db,
          'CREATE INDEX IF NOT EXISTS ' + indexName + ' ON ' + projectionTableName + '(' + column + ')'
        ));
      }
      return Promise.all(promises);
    })
    .then(function() {
      // Create any additional custom indexes
      if (projection.indexes) {
        var promises = [];
        for (var i = 0; i < projection.indexes.length; i++) {
          var indexConfig = projection.indexes[i];
          var indexName = indexConfig.name ||
            'idx_' + projection.targetTable + '_' + indexConfig.columns.join('_');
          var uniqueClause = indexConfig.unique ? 'UNIQUE ' : '';
          promises.push(self.runAsync(db,
            'CREATE ' + uniqueClause + 'INDEX IF NOT EXISTS ' + indexName +
            ' ON ' + projectionTableName + '(' + indexConfig.columns.join(', ') + ')'
          ));
        }
        return Promise.all(promises);
      }
    })
    .then(function() {
      self.debug && console.log('[CollectionPerTableStrategy] Created projection table', projectionTableName);
    });
};

/**
 * Helper to run SQL with proper promise handling
 */
CollectionPerTableStrategy.prototype.runAsync = function(db, sql, params) {
  return db.runAsync(sql, params);
};

/**
 * Helper to get first result with proper promise handling
 */
CollectionPerTableStrategy.prototype.getFirstAsync = function(db, sql, params) {
  return db.getFirstAsync(sql, params);
};

/**
 * Helper to get all results with proper promise handling
 */
CollectionPerTableStrategy.prototype.getAllAsync = function(db, sql, params) {
  return db.getAllAsync(sql, params);
};

/**
 * Get the table name for a collection
 */
CollectionPerTableStrategy.prototype.getTableName = function(collection) {
  // console.log('[CollectionPerTableStrategy.getTableName] Called for collection:', collection, 'Strategy:', this.constructor.name);
  if (collection === '__inventory__') {
    return 'sharedb_inventory';
  }
  // Just use the collection name directly without prefix
  // The attachment provides namespace separation when needed
  return collection.replace(/[^a-zA-Z0-9_]/g, '_');
};

/**
 * Validate that the schema exists
 */
CollectionPerTableStrategy.prototype.validateSchema = function(db, callback) {
  var self = this;

  this.getFirstAsync(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='sharedb_inventory'")
    .then(function(result) {
    var isValid = !!result;
    if (callback) callback(null, isValid);
    return isValid;
  }).catch(function(error) {
    if (callback) callback(error, false);
    throw error;
  });
};

/**
 * Write records to the database
 */
CollectionPerTableStrategy.prototype.writeRecords = function(db, recordsByType, callback) {
  var self = this;
  var promises = [];
  var totalCount = 0;

  // Process docs records by collection
  if (recordsByType.docs) {
    var docsToWrite = Array.isArray(recordsByType.docs) ? recordsByType.docs : [recordsByType.docs];

    // Group documents by collection
    var docsByCollection = {};
    for (var i = 0; i < docsToWrite.length; i++) {
      var doc = docsToWrite[i];
      var collection = doc.payload && doc.payload.collection;
      if (!collection) {
        console.warn('[CollectionPerTableStrategy] Document missing collection:', doc.id);
        continue;
      }

      if (!docsByCollection[collection]) {
        docsByCollection[collection] = [];
      }
      docsByCollection[collection].push(doc);
    }

    // Write documents for each collection
    for (var collection in docsByCollection) {
      promises.push(this.writeCollectionRecords(db, collection, docsByCollection[collection]));
      totalCount += docsByCollection[collection].length;
    }
  }

  // Process meta records - inventory is the only "meta" record we handle
  if (recordsByType.meta) {
    var metaRecord = Array.isArray(recordsByType.meta) ? recordsByType.meta[0] : recordsByType.meta;

    // Check if this is the inventory record
    if (metaRecord && metaRecord.id === 'inventory' && metaRecord.payload && metaRecord.payload.collections) {
      // Write inventory to the inventory table
      promises.push(this.writeInventoryFromMeta(db, metaRecord));
      totalCount++;
    }
    // Ignore any other meta records since we don't have a meta table
  }

  Promise.all(promises)
    .then(function() {
      self.debug && console.log('[CollectionPerTableStrategy] Wrote ' + totalCount + ' records');
      if (callback) callback(null);
    })
    .catch(function(error) {
      console.error('[CollectionPerTableStrategy] Write error:', error);
      if (callback) {
        callback(error);
      } else {
        throw error;
      }
    });
};

/**
 * Write records for a specific collection
 */
CollectionPerTableStrategy.prototype.writeCollectionRecords = function(db, collection, records) {
  var self = this;

  // Ensure table exists
  return this.ensureCollectionTable(db, collection)
    .then(function() {
      var promises = [];

      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        promises.push(self.writeCollectionRecord(db, collection, record));
      }

      return Promise.all(promises);
    });
};

/**
 * Write a single collection record
 */
CollectionPerTableStrategy.prototype.writeCollectionRecord = function(db, collection, record) {
  var self = this;
  var tableName = this.getTableName(collection);
  // console.log('[CollectionPerTableStrategy.writeCollectionRecord] Writing to table:', tableName, 'for collection:', collection, 'record id:', record.id);

  // Extract the simple document ID from compound key (collection/id -> id)
  // ShareDB sends compound IDs in the format "collection/docId"
  // We need to store only the docId part in inventory
  var simpleDocId = record.id;
  if (record.id && record.id.indexOf('/') !== -1) {
    // Validate it's a proper compound key and extract parts
    var parts = Formatted.split(record.id);

    // Verify the collection matches
    if (parts.collection !== collection) {
      throw new Error('Collection mismatch in compound key. Expected "' + collection + '/..." but got "' + record.id + '"');
    }

    simpleDocId = parts.docId;
  }

  // Check for existing record first (for projections) - use simple ID
  return this.getFirstAsync(db, 'SELECT data FROM ' + tableName + ' WHERE id = ?', [simpleDocId])
    .then(function(oldRow) {
      var oldRecord = oldRow ? JSON.parse(oldRow.data) : null;

      // Apply encryption if needed
      var recordToStore = self.maybeEncryptRecord(record, collection);

      // Store with simple ID, but keep compound ID in the data
      return self.runAsync(db,
        'INSERT OR REPLACE INTO ' + tableName + ' (id, collection, data) VALUES (?, ?, ?)',
        [simpleDocId, collection, JSON.stringify(recordToStore)]
      ).then(function() {
        // Update projections if configured
        return self.updateProjections(db, collection, record, oldRecord);
      });
    })
    .then(function() {
      // Update inventory with simple ID
      var version = record.payload.v;
      var hasPending = record.payload.pendingOps && record.payload.pendingOps.length > 0;
      return self.updateInventoryForRecord(db, collection, simpleDocId, version, hasPending);
    });
};

/**
 * Update projections when a record is written
 */
CollectionPerTableStrategy.prototype.updateProjections = function(db, collection, newRecord, oldRecord) {
  var self = this;
  var projections = this.projectionsByCollection[collection];
  // console.log('[CollectionPerTableStrategy.updateProjections] Called for collection:', collection);
  // console.log('[CollectionPerTableStrategy.updateProjections] Projections configured:', projections ? projections.length : 0);
  // if (projections && projections.length > 0) {
  //   console.log('[CollectionPerTableStrategy.updateProjections] Projection details:', JSON.stringify(projections, null, 2));
  // }
  if (!projections || projections.length === 0) {
    return Promise.resolve();
  }

  var promises = [];
  for (var i = 0; i < projections.length; i++) {
    var projection = projections[i];
    // console.log('[CollectionPerTableStrategy.updateProjections] Processing projection:', projection.tableName);
    // console.log('[CollectionPerTableStrategy.updateProjections] Projection type:', projection.type);
    // console.log('[CollectionPerTableStrategy.updateProjections] Array path:', projection.arrayPath);
    var arrayValue = this.getValueAtPath(newRecord, projection.arrayPath);
    // console.log('[CollectionPerTableStrategy.updateProjections] Array value:', JSON.stringify(arrayValue));
    if (projection.type === 'array_expansion') {
      promises.push(this.updateArrayExpansionProjection(db, projection, newRecord, oldRecord));
    }
  }
  return Promise.all(promises);
};

/**
 * Update an array expansion projection
 */
CollectionPerTableStrategy.prototype.updateArrayExpansionProjection = function(db, projection, newRecord, oldRecord) {
  var self = this;
  var recordId = newRecord.id;
  var projectionTableName = projection.targetTable;

  // Delete existing projections for this record
  var deleteColumns = [];
  var deleteValues = [];
  for (var targetColumn in projection.mapping) {
    var mappingConfig = projection.mapping[targetColumn];

    // Extract source path from mapping config
    var sourcePath;
    if (typeof mappingConfig === 'string') {
      sourcePath = mappingConfig;
    } else {
      sourcePath = mappingConfig.sourcePath || mappingConfig.source;
    }

    // If source is from root document (not array element), use it as delete condition
    if (sourcePath && sourcePath !== '@element') {
      var value;

      if (sourcePath === 'id') {
        // Special case for document id
        value = recordId;
      } else if (sourcePath.includes('.')) {
        // Path with dots - treat as path from document root
        value = this.getValueAtPath(newRecord, sourcePath);
      } else {
        // Simple identifier without dots - treat as literal value or special case
        value = sourcePath;
      }

      if (value !== undefined) {
        deleteColumns.push(targetColumn + ' = ?');
        deleteValues.push(value);
      }
    }
  }

  var deletePromise;
  if (deleteColumns.length > 0) {
    var deleteSQL = 'DELETE FROM ' + projectionTableName + ' WHERE ' + deleteColumns.join(' AND ');
    deletePromise = this.runAsync(db, deleteSQL, deleteValues);
  } else {
    deletePromise = Promise.resolve();
  }

  return deletePromise.then(function() {
    // Get array from record
    var array = self.getValueAtPath(newRecord, projection.arrayPath);
    if (!Array.isArray(array) || array.length === 0) {
      return;
    }

    // Insert new projections
    var promises = [];
    for (var i = 0; i < array.length; i++) {
      var arrayItem = array[i];

      // Build row for projection table
      var row = {};
      for (var targetColumn in projection.mapping) {
        var mappingConfig = projection.mapping[targetColumn];

        // Extract source path and get value
        var sourcePath;
        if (typeof mappingConfig === 'string') {
          sourcePath = mappingConfig;
        } else {
          sourcePath = mappingConfig.sourcePath || mappingConfig.source;
        }

        var value;
        if (sourcePath === '@element') {
          // Use the array item itself
          value = arrayItem;
        } else if (sourcePath === 'id') {
          // Special case for document id
          value = recordId;
        } else if (sourcePath.includes('.')) {
          // Path with dots - treat as path from document root
          value = self.getValueAtPath(newRecord, sourcePath);
        } else {
          value = sourcePath; // Literal value
        }

        row[targetColumn] = value;
      }

      row.created_at = Date.now();

      // Insert row
      var columns = Object.keys(row);
      var placeholders = columns.map(function() { return '?'; }).join(', ');
      var values = columns.map(function(col) { return row[col]; });

      promises.push(self.runAsync(db,
        'INSERT OR REPLACE INTO ' + projectionTableName +
        ' (' + columns.join(', ') + ') VALUES (' + placeholders + ')',
        values
      ));
    }

    return Promise.all(promises);
  });
};

/**
 * Get value at a path in an object
 */
CollectionPerTableStrategy.prototype.getValueAtPath = function(obj, path) {
  var parts = path.split('.');
  var current = obj;

  for (var i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[parts[i]];
  }

  return current;
};

/**
 * Write inventory data from the meta format to the inventory table
 */
CollectionPerTableStrategy.prototype.writeInventoryFromMeta = function(db, inventoryMeta) {
  var self = this;
  var promises = [];

  // Update inventory items incrementally (don't clear the entire table)
  var collections = inventoryMeta.payload.collections;
  for (var collection in collections) {
    for (var docId in collections[collection]) {
      var item = collections[collection][docId];
      var versionNum = typeof item.v === 'number' ? item.v : null;
      var versionStr = typeof item.v === 'string' ? item.v : null;
      var hasPending = item.p || false;

      // Use INSERT OR REPLACE to update existing entries or add new ones
      promises.push(self.runAsync(db,
        'INSERT OR REPLACE INTO sharedb_inventory (collection, doc_id, version_num, version_str, has_pending, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
        [collection, docId, versionNum, versionStr, hasPending ? 1 : 0, Date.now()]
      ));
    }
  }

  return Promise.all(promises);
};

/**
 * Ensure a collection table exists
 */
CollectionPerTableStrategy.prototype.ensureCollectionTable = function(db, collection) {
  if (this.createdTables[collection]) {
    return Promise.resolve();
  }

  return this.createCollectionTable(db, collection)
    .then(this.createProjectionTables(db, collection));
};

/**
 * Update inventory for a specific record
 */
CollectionPerTableStrategy.prototype.updateInventoryForRecord = function(db, collection, docId, version, hasPending) {
  // Validate and normalize formats
  collection = Formatted.asCollectionName(collection);
  docId = Formatted.asDocId(docId);

  var versionNum = null;
  var versionStr = null;

  if (typeof version === 'number') {
    versionNum = version;
  } else if (typeof version === 'string') {
    versionStr = version;
  }

  return this.runAsync(db,
    'INSERT OR REPLACE INTO sharedb_inventory (collection, doc_id, version_num, version_str, has_pending, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?)',
    [collection, docId, versionNum, versionStr, hasPending ? 1 : 0, Date.now()]
  );
};

/**
 * Read a single record from the database
 */
CollectionPerTableStrategy.prototype.readRecord = function(db, type, collection, id, callback) {
  var self = this;
  var promise;

  if (type === 'meta') {
    // No meta table - return null for meta reads
    promise = Promise.resolve(null);
  } else {
    var tableName = this.getTableName(collection);
    // Use simple ID for querying
    promise = this.getFirstAsync(db, 'SELECT data FROM ' + tableName + ' WHERE id = ?', [id])
      .then(function(row) {
        if (!row) return null;
        var record = JSON.parse(row.data);

        // Decrypt if needed
        if (self.useEncryption && record.encrypted_payload) {
          record = self.maybeDecryptRecord(record, collection);
        }

        return record;
      })
      .catch(function(error) {
        // Table might not exist yet
        if (error.message && error.message.includes('no such table')) {
          return null;
        }
        throw error;
      });
  }

  if (callback) {
    promise
      .then(function(result) { callback(null, result); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Read all records of a given type
 */
CollectionPerTableStrategy.prototype.readAllRecords = function(db, type, collection, callback) {
  var self = this;
  var promise;

  if (type === 'meta') {
    // No meta table - return empty array for meta reads
    promise = Promise.resolve([]);
  } else if (collection) {
    var tableName = this.getTableName(collection);
    promise = this.getAllAsync(db, 'SELECT id, data FROM ' + tableName)
      .then(function(rows) {
        return rows.map(function(row) {
          var record = JSON.parse(row.data);

          // Decrypt if needed
          if (self.useEncryption && record.encrypted_payload) {
            record = self.maybeDecryptRecord(record, collection);
          }

          return record;
        });
      })
      .catch(function(error) {
        // Table might not exist yet
        if (error.message && error.message.includes('no such table')) {
          return [];
        }
        throw error;
      });
  } else {
    // Read from all collection tables (use configured collections as source of truth)
    var configuredCollections = Object.keys(self.collectionConfig);
    var promises = configuredCollections.map(function(collection) {
      var tableName = self.getTableName(collection);
      return self.getAllAsync(db, 'SELECT id, data FROM ' + tableName)
        .catch(function(err) {
          // Table might not exist yet, return empty array
          return [];
        });
    });
    promise = Promise.all(promises)
      .then(function(allResults) {
        var records = [];
        for (var i = 0; i < allResults.length; i++) {
          var rows = allResults[i];
          for (var j = 0; j < rows.length; j++) {
            var record = JSON.parse(rows[j].data);

            // Decrypt if needed
            if (self.useEncryption && record.encrypted_payload) {
              var recordCollection = record.payload && record.payload.collection;
              record = self.maybeDecryptRecord(record, recordCollection);
            }

            records.push(record);
          }
        }
        return records;
      });
  }

  if (callback) {
    promise
      .then(function(result) { callback(null, result); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Read multiple records by ID (bulk operation)
 */
CollectionPerTableStrategy.prototype.readRecordsBulk = function(db, type, collection, ids, callback) {
  var self = this;

  if (!ids || ids.length === 0) {
    if (callback) callback(null, []);
    return Promise.resolve([]);
  }

  var placeholders = ids.map(function() { return '?'; }).join(', ');
  var promise;

  if (type === 'meta') {
    // No meta table - return empty array for meta reads
    promise = Promise.resolve([]);
  } else {
    var tableName = this.getTableName(collection);
    var sql = 'SELECT id, data FROM ' + tableName + ' WHERE id IN (' + placeholders + ')';
    promise = this.getAllAsync(db, sql, ids)
      .then(function(rows) {
        return rows.map(function(row) {
          var record = JSON.parse(row.data);

          // Decrypt if needed
          if (self.useEncryption && record.encrypted_payload) {
            record = self.maybeDecryptRecord(record, collection);
          }

          return record;
        });
      })
      .catch(function(error) {
        // Table might not exist yet
        if (error.message && error.message.includes('no such table')) {
          return [];
        }
        throw error;
      });
  }

  if (callback) {
    promise
      .then(function(result) { callback(null, result); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Delete a record from the database
 */
CollectionPerTableStrategy.prototype.deleteRecord = function(db, type, collection, id, callback) {
  var self = this;
  var promise;

  if (type === 'meta') {
    // No meta table - just resolve for meta deletes
    promise = Promise.resolve();
  } else {
    var tableName = this.getTableName(collection);
    // Use simple ID for deletion
    promise = this.runAsync(db, 'DELETE FROM ' + tableName + ' WHERE id = ?', [id])
      .then(function() {
        // Delete from projections
        return self.deleteFromProjections(db, collection, id);
      })
      .then(function() {
        // Remove from inventory - use simple ID
        return self.runAsync(db,
          'DELETE FROM sharedb_inventory WHERE collection = ? AND doc_id = ?',
          [collection, id]
        );
      })
      .catch(function(error) {
        // Table might not exist yet
        if (error.message && error.message.includes('no such table')) {
          return;
        }
        throw error;
      });
  }

  if (callback) {
    promise
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Delete record from projection tables
 */
CollectionPerTableStrategy.prototype.deleteFromProjections = function(db, collection, recordId) {
  var self = this;
  var projections = this.projectionsByCollection[collection];
  if (!projections || projections.length === 0) {
    return Promise.resolve();
  }

  // For now, we can't easily delete from projections without knowing the original record
  // This would require storing the record ID in projection tables
  // TODO: Consider adding a source_record_id column to projection tables
  return Promise.resolve();
};

/**
 * Helper to encrypt a record if encryption is enabled
 */
CollectionPerTableStrategy.prototype.maybeEncryptRecord = function(record, collection) {
  if (!this.useEncryption || !this.encryptionCallback) {
    return record;
  }

  var config = this.collectionConfig[collection] || {};

  // Field-level encryption
  if (config.encryptedFields && config.encryptedFields.length > 0) {
    // TODO: Implement field-level encryption
    // For now, fall back to full encryption
  }

  // Full record encryption
  return {
    id: record.id,
    collection: collection,
    encrypted_payload: this.encryptionCallback(JSON.stringify(record.payload))
  };
};

/**
 * Helper to decrypt a record if it's encrypted
 */
CollectionPerTableStrategy.prototype.maybeDecryptRecord = function(record, collection) {
  if (!this.useEncryption || !this.decryptionCallback || !record.encrypted_payload) {
    return record;
  }

  return {
    id: record.id,
    payload: JSON.parse(this.decryptionCallback(record.encrypted_payload))
  };
};

/**
 * Initialize inventory
 */
CollectionPerTableStrategy.prototype.initializeInventory = function(db, callback) {
  var promise = this.readInventory(db);

  if (callback) {
    promise
      .then(function(result) { callback(null, result); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Read the entire inventory
 */
CollectionPerTableStrategy.prototype.readInventory = function(db, callback) {
  var promise = this.getAllAsync(db,
    'SELECT collection, doc_id, version_num, version_str, has_pending FROM sharedb_inventory'
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
 * Update inventory for a specific collection/document
 */
CollectionPerTableStrategy.prototype.updateInventoryItem = function(db, collection, docId, version, operation, callback) {
  // Validate and normalize formats
  try {
    collection = Formatted.asCollectionName(collection);
    docId = Formatted.asDocId(docId);
  } catch (error) {
    if (callback) {
      callback(error);
      return;
    }
    return Promise.reject(error);
  }

  var self = this;
  var promise;

  if (operation === 'add' || operation === 'update') {
    promise = this.getFirstAsync(db,
      'SELECT version_num, version_str FROM sharedb_inventory WHERE collection = ? AND doc_id = ?',
      [collection, docId]
    ).then(function(existing) {
      // Check for version regression
      if (existing) {
        var existingVersion = existing.version_num !== null ? existing.version_num : existing.version_str;

        // Check version type compatibility
        if (typeof version !== typeof existingVersion) {
          throw new Error('Version type mismatch for ' + collection + '/' + docId +
            ': trying to use ' + typeof version + ' version ' + version +
            ' but existing version is ' + typeof existingVersion + ' ' + existingVersion);
        }

        // Check for regression
        if (typeof version === 'number' && version < existingVersion) {
          throw new Error('Version regression detected for ' + collection + '/' + docId +
            ': trying to update to version ' + version + ' but current version is ' + existingVersion);
        } else if (typeof version === 'string' && version < existingVersion) {
          throw new Error('Version regression detected for ' + collection + '/' + docId +
            ': trying to update to version ' + version + ' but current version is ' + existingVersion);
        }
      }

      // Update inventory
      return self.updateInventoryForRecord(db, collection, docId, version, false);
    });
  } else if (operation === 'remove') {
    promise = this.runAsync(db,
      'DELETE FROM sharedb_inventory WHERE collection = ? AND doc_id = ?',
      [collection, docId]
    );
  } else {
    promise = Promise.reject(new Error('Unknown inventory operation: ' + operation));
  }

  if (callback) {
    promise
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};

/**
 * Add or update inventory item (upsert)
 */
CollectionPerTableStrategy.prototype.upsertInventoryItem = function(db, collection, docId, version, callback) {
  return this.updateInventoryItem(db, collection, docId, version, 'add', callback);
};

/**
 * Delete inventory item
 */
CollectionPerTableStrategy.prototype.deleteInventoryItem = function(db, collection, docId, callback) {
  return this.updateInventoryItem(db, collection, docId, null, 'remove', callback);
};

/**
 * Get inventory type
 */
CollectionPerTableStrategy.prototype.getInventoryType = function() {
  return 'table';
};

/**
 * Delete all tables created by this schema strategy
 */
CollectionPerTableStrategy.prototype.deleteAllTables = function(db, callback) {
  var self = this;

  var promise = this.getAllAsync(db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).then(function(tables) {
    var promises = [];
    for (var i = 0; i < tables.length; i++) {
      promises.push(self.runAsync(db, 'DROP TABLE IF EXISTS ' + tables[i].name));
    }
    return Promise.all(promises);
  }).then(function() {
    // Clear our created tables cache
    self.createdTables = {};
    self.debug && console.log('[CollectionPerTableStrategy] Deleted all tables');
  });

  if (callback) {
    promise
      .then(function() { callback(null); })
      .catch(function(error) { callback(error); });
  }

  return promise;
};