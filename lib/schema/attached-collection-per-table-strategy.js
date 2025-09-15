const CollectionPerTableStrategy = require('./collection-per-table-strategy');

/**
 * AttachedCollectionPerTableStrategy - Schema strategy for attached databases
 * 
 * This strategy extends CollectionPerTableStrategy to work with attached databases.
 * It automatically prefixes all table names with the attachment alias, ensuring that
 * all ShareDB operations reference the correct attached database.
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.attachmentAlias - The alias used in ATTACH DATABASE statement (e.g., 'sharedb')
 * @param {boolean} options.useEncryption - Enable encryption support
 * @param {Function} options.encryptionCallback - Encryption function
 * @param {Function} options.decryptionCallback - Decryption function
 * @param {Object} options.collectionConfig - Collection-specific configuration
 * @param {boolean} options.debug - Enable debug logging
 * @param {Function} options.createAdapterForPath - Function to create a database adapter for a given path
 */
function AttachedCollectionPerTableStrategy(options) {
  options = options || {};
  
  if (!options.attachmentAlias) {
    throw new Error('AttachedCollectionPerTableStrategy requires attachmentAlias option');
  }
  
  // Call parent constructor
  CollectionPerTableStrategy.call(this, options);
  
  // Store the attachment alias for prefixing
  this.attachmentAlias = options.attachmentAlias;
  this.debug = options.debug || false;
  this.createAdapterForPath = options.createAdapterForPath;
}

// Inherit from CollectionPerTableStrategy
AttachedCollectionPerTableStrategy.prototype = Object.create(CollectionPerTableStrategy.prototype);
AttachedCollectionPerTableStrategy.prototype.constructor = AttachedCollectionPerTableStrategy;

/**
 * Override getTableName to add attachment alias prefix
 * @param {string} collection - The collection name
 * @returns {string} The prefixed table name
 */
AttachedCollectionPerTableStrategy.prototype.getTableName = function(collection) {
  // Get base table name from parent
  const baseTableName = CollectionPerTableStrategy.prototype.getTableName.call(this, collection);
  
  // Only add attachment alias prefix if we have one
  if (this.attachmentAlias) {
    const prefixedTableName = this.attachmentAlias + '.' + baseTableName;
    this.debug && console.log('[AttachedCollectionPerTableStrategy] Table name for', collection, ':', prefixedTableName);
    return prefixedTableName;
  } else {
    // When attachmentAlias is null (during pre-initialization), use base name
    return baseTableName;
  }
};

/**
 * Override initializeSchema to work with attached database
 * Creates tables in the attached database instead of primary
 */
AttachedCollectionPerTableStrategy.prototype.initializeSchema = async function(db, callback) {
  const strategy = this;
  
  // Helper function to handle both promise styles
  const runAsyncWrapper = function(sql) {
    const result = db.runAsync(sql);
    // If it returns an object with promise() method, use it; otherwise it's already a promise
    return result && typeof result.promise === 'function' ? result.promise() : result;
  };
  
  try {
    // First, ensure the attached database is properly initialized with indexes
    // This is critical for performance and must be done in the database's own context
    await strategy.ensureAttachedDatabaseInitialized(db);
    
    // Now proceed with normal schema initialization
    // Create meta table with sharedb_ prefix in attached database if it doesn't exist
    await runAsyncWrapper(
      'CREATE TABLE IF NOT EXISTS ' + strategy.attachmentAlias + '.sharedb_meta (' +
      'id TEXT PRIMARY KEY, ' +
      'data JSON' +
      ')'
    );
    
    // Create inventory table in attached database if it doesn't exist
    await runAsyncWrapper(
      'CREATE TABLE IF NOT EXISTS ' + strategy.attachmentAlias + '.sharedb_inventory (' +
      'collection TEXT NOT NULL, ' +
      'doc_id TEXT NOT NULL, ' +
      'version_num REAL, ' +
      'version_str TEXT, ' +
      'has_pending INTEGER NOT NULL DEFAULT 0, ' +
      'updated_at INTEGER, ' +
      'PRIMARY KEY (collection, doc_id)' +
      ')'
    );
    
    // Create tables for any pre-configured collections
    const collections = Object.keys(strategy.collectionConfig);
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      await strategy.createCollectionTable(db, collection);
      // Create projection tables if configured
      await strategy.createProjectionTablesAttached(db, collection);
    }
    
    strategy.debug && console.log('[AttachedCollectionPerTableStrategy] Schema initialized in attached database:', strategy.attachmentAlias);
    callback && callback();
  } catch (error) {
    console.error('[AttachedCollectionPerTableStrategy] Schema initialization error:', error);
    callback && callback(error);
  }
};

/**
 * Pre-initialize a database before attachment
 * This creates all tables and indexes directly in the database before it's attached
 * @param {string} databasePath - Path to the database to initialize
 * @param {Function} createAdapter - Function that creates an adapter for the database path
 * @returns {Promise} Resolves when initialization is complete
 */
AttachedCollectionPerTableStrategy.prototype.preInitializeDatabase = async function(databasePath, createAdapter) {
  const strategy = this;
  
  strategy.debug && console.log('[AttachedCollectionPerTableStrategy] Pre-initializing database:', databasePath);
  
  try {
    // Create a direct adapter to the database (not attached)
    const directAdapter = createAdapter(databasePath);
    
    // Connect to the database
    await directAdapter.connect();
    
    // Temporarily disable the attachment alias to work directly with the database
    const originalAlias = strategy.attachmentAlias;
    strategy.attachmentAlias = null;
    
    // Also temporarily replace createCollectionTable to use the base implementation
    const originalCreateCollectionTable = strategy.createCollectionTable;
    strategy.createCollectionTable = CollectionPerTableStrategy.prototype.createCollectionTable;
    
    try {
      // Create a wrapper that matches what the schema strategy expects
      // Some strategies expect runAsync to return {promise: () => Promise}
      const dbWrapper = {
        runAsync: function(sql, params) {
          const promise = directAdapter.runAsync(sql, params);
          // Return object with promise() method if the strategy expects it
          return {
            promise: function() {
              return promise;
            }
          };
        },
        getFirstAsync: function(sql, params) {
          return directAdapter.getFirstAsync(sql, params);
        },
        getAllAsync: function(sql, params) {
          return directAdapter.getAllAsync(sql, params);
        },
        transaction: function(operations) {
          return directAdapter.transaction(operations);
        }
      };
      
      // Initialize the schema directly (without prefix since we're connected directly)
      await new Promise((resolve, reject) => {
        // Call the parent class's initializeSchema, not our overridden version
        CollectionPerTableStrategy.prototype.initializeSchema.call(strategy, dbWrapper, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // Verify indexes were created
      const indexes = await directAdapter.getAllAsync(
        "SELECT name FROM sqlite_master WHERE type='index'"
      );
      
      strategy.debug && console.log(
        '[AttachedCollectionPerTableStrategy] Pre-initialization complete. Created indexes:', 
        indexes.map(i => i.name)
      );
      
      // Restore the attachment alias and method
      strategy.attachmentAlias = originalAlias;
      strategy.createCollectionTable = originalCreateCollectionTable;
      
      // Disconnect from the database
      await directAdapter.disconnect();
      
      return { success: true, indexes: indexes.map(i => i.name) };
    } catch (error) {
      // Make sure to restore the alias and method even if there's an error
      strategy.attachmentAlias = originalAlias;
      strategy.createCollectionTable = originalCreateCollectionTable;
      throw error;
    }
  } catch (error) {
    console.error('[AttachedCollectionPerTableStrategy] Pre-initialization error:', error);
    throw error;
  }
};

/**
 * Ensure the attached database has all necessary indexes
 * This verifies that indexes exist (they should have been created during pre-initialization)
 * @private
 */
AttachedCollectionPerTableStrategy.prototype.ensureAttachedDatabaseInitialized = async function(db) {
  const strategy = this;
  
  try {
    // Check if indexes exist in the attached database
    const existingIndexes = await db.getAllAsync(
      'SELECT name FROM ' + strategy.attachmentAlias + '.sqlite_master WHERE type=\'index\''
    );
    const indexNames = new Set(existingIndexes.map(i => i.name));
    
    // Check for required inventory indexes
    const requiredIndexes = ['idx_inventory_collection', 'idx_inventory_updated'];
    const missingIndexes = requiredIndexes.filter(idx => !indexNames.has(idx));
    
    // Check for collection indexes
    for (const collection of Object.keys(strategy.collectionConfig)) {
      const config = strategy.collectionConfig[collection];
      const tableName = CollectionPerTableStrategy.prototype.getTableName.call(this, collection);
      
      if (config.indexes && config.indexes.length > 0) {
        for (const field of config.indexes) {
          const sanitizedField = field.replace(/\./g, '_');
          const indexName = tableName + '_' + sanitizedField + '_idx';
          
          if (!indexNames.has(indexName)) {
            missingIndexes.push(indexName);
          }
        }
      }
    }
    
    if (missingIndexes.length > 0) {
      // Indexes are missing - this database wasn't properly initialized
      // We should try to initialize it now
      strategy.debug && console.log(
        '[AttachedCollectionPerTableStrategy] Missing indexes detected:', 
        missingIndexes
      );
      
      // Check if we have a way to create an adapter for pre-initialization
      if (strategy.createAdapterForPath && strategy.attachmentPath) {
        console.log('[AttachedCollectionPerTableStrategy] Attempting to pre-initialize database...');
        
        // We need to detach, initialize, and re-attach
        // This is complex and should be handled at a higher level
        console.warn(
          '[AttachedCollectionPerTableStrategy] Database needs initialization.',
          'Missing indexes:', missingIndexes.join(', ')
        );
      }
    } else {
      strategy.debug && console.log(
        '[AttachedCollectionPerTableStrategy] All required indexes found:', 
        Array.from(indexNames)
      );
    }
  } catch (error) {
    console.error('[AttachedCollectionPerTableStrategy] Error checking indexes:', error);
    // Don't fail initialization, but log the issue
  }
};

/**
 * Create projection tables for a collection in the attached database
 * @param {Object} db - Database connection
 * @param {String} collection - Collection name
 * @returns {Promise}
 */
AttachedCollectionPerTableStrategy.prototype.createProjectionTablesAttached = async function(db, collection) {
  const strategy = this;
  const projections = this.projectionsByCollection && this.projectionsByCollection[collection];
  if (!projections || projections.length === 0) {
    return;
  }

  for (const projection of projections) {
    // Build CREATE TABLE statement with attachment prefix
    const columns = [];
    for (const targetColumn in projection.mapping) {
      columns.push(targetColumn + ' TEXT');
    }
    columns.push('created_at INTEGER');

    // Add PRIMARY KEY constraint
    const primaryKeyClause = 'PRIMARY KEY (' + projection.primaryKey.join(', ') + ')';

    const fullTableName = strategy.attachmentAlias + '.' + projection.targetTable;
    const createTableSQL = 'CREATE TABLE IF NOT EXISTS ' + fullTableName + ' (' +
      columns.join(', ') + ', ' +
      primaryKeyClause +
    ')';

    const runAsyncWrapper = function(sql) {
      const result = db.runAsync(sql);
      return result && typeof result.promise === 'function' ? result.promise() : result;
    };

    await runAsyncWrapper(createTableSQL);

    // Create indexes for efficient querying
    for (const column of projection.primaryKey) {
      const indexName = 'idx_' + projection.targetTable + '_' + column;
      await runAsyncWrapper(
        'CREATE INDEX IF NOT EXISTS ' + strategy.attachmentAlias + '.' + indexName +
        ' ON ' + projection.targetTable + '(' + column + ')'
      );
    }

    strategy.debug && console.log('[AttachedCollectionPerTableStrategy] Created projection table', fullTableName);
  }
};

/**
 * Override createCollectionTable to work with attached database
 */
AttachedCollectionPerTableStrategy.prototype.createCollectionTable = async function(db, collection) {
  const strategy = this;
  const tableName = this.getTableName(collection); // This will include the prefix
  const config = this.collectionConfig[collection] || {};
  
  // Helper function to handle both promise styles
  const runAsyncWrapper = function(sql) {
    const result = db.runAsync(sql);
    return result && typeof result.promise === 'function' ? result.promise() : result;
  };
  
  // Create the table in attached database
  // For collection tables, use the simple table name within the attached database
  const simpleTableName = CollectionPerTableStrategy.prototype.getTableName.call(this, collection);
  
  // Use the appropriate table name based on whether we're in attachment mode
  const fullTableName = strategy.attachmentAlias 
    ? strategy.attachmentAlias + '.' + simpleTableName 
    : simpleTableName;
  
  await runAsyncWrapper(
    'CREATE TABLE IF NOT EXISTS ' + fullTableName + ' (' +
    'id TEXT PRIMARY KEY, ' +
    'collection TEXT, ' +
    'data JSON' +
    ')'
  );
  
  // Verify that indexes exist for this collection
  // Indexes must be created in the ShareDB database before attachment
  if (config.indexes && config.indexes.length > 0) {
    const expectedIndexes = config.indexes.map(field => {
      const sanitizedField = field.replace(/\./g, '_');
      return simpleTableName + '_' + sanitizedField + '_idx';
    });
    
    strategy.debug && console.log(
      '[AttachedCollectionPerTableStrategy] Collection', collection,
      'expects indexes:', expectedIndexes,
      '- these should be created using sharedb-initializer before attachment'
    );
  }
  
  strategy.createdTables[collection] = true;
  strategy.debug && console.log('[AttachedCollectionPerTableStrategy] Created table in attached database:', tableName);
};

/**
 * Override validateSchema to check tables in attached database
 */
AttachedCollectionPerTableStrategy.prototype.validateSchema = function(db, callback) {
  const strategy = this;
  
  // Check meta table exists in attached database
  const sql = 'SELECT name FROM ' + strategy.attachmentAlias + 
              '.sqlite_master WHERE type=\'table\' AND name=\'sharedb_meta\'';
  
  db.getFirstAsync(sql).then(function(result) {
    callback && callback(null, !!result);
  }).catch(function(error) {
    callback && callback(error, false);
  });
};

/**
 * Override updateArrayExpansionProjection to work with attached database
 * @param {Object} db - Database connection
 * @param {Object} projection - Projection configuration
 * @param {Object} newRecord - The new record
 * @param {Object} oldRecord - The old record (null for new)
 * @returns {Promise}
 */
AttachedCollectionPerTableStrategy.prototype.updateArrayExpansionProjection = async function(db, projection, newRecord, oldRecord) {
  const strategy = this;

  // Extract the array from the record using the arrayPath
  const getNestedValue = function(obj, path) {
    const parts = path.split('.');
    let value = obj;
    for (const part of parts) {
      if (!value || typeof value !== 'object') return null;
      value = value[part];
    }
    return value;
  };

  const recordId = newRecord.id;
  const fullTableName = strategy.attachmentAlias + '.' + projection.targetTable;

  // Delete existing projections for this record
  const deleteColumns = [];
  const deleteValues = [];
  for (const targetColumn in projection.mapping) {
    const sourcePath = projection.mapping[targetColumn];
    if (sourcePath === 'id' || sourcePath === '') {
      deleteColumns.push(targetColumn + ' = ?');
      deleteValues.push(recordId);
      break; // Only need to match on the record ID column
    }
  }

  if (deleteColumns.length > 0) {
    const deleteSQL = 'DELETE FROM ' + fullTableName + ' WHERE ' + deleteColumns.join(' AND ');
    const runAsyncWrapper = function(sql, params) {
      const result = db.runAsync(sql, params);
      return result && typeof result.promise === 'function' ? result.promise() : result;
    };
    await runAsyncWrapper(deleteSQL, deleteValues);
  }

  // Extract array from new record
  const array = getNestedValue(newRecord, projection.arrayPath);
  if (!array || !Array.isArray(array)) {
    return; // No array to project
  }

  // Insert new projections
  const now = Date.now();
  for (const element of array) {
    const values = [];
    const placeholders = [];

    for (const targetColumn in projection.mapping) {
      const sourcePath = projection.mapping[targetColumn];

      let value;
      if (sourcePath === '') {
        // Empty string means use the array element itself
        value = element;
      } else if (sourcePath === 'id') {
        // Special case for record ID
        value = recordId;
      } else {
        // Extract value from the record
        value = getNestedValue(newRecord, sourcePath);
      }

      values.push(value);
      placeholders.push('?');
    }

    // Add created_at timestamp
    values.push(now);
    placeholders.push('?');

    const columns = Object.keys(projection.mapping).concat(['created_at']);
    const insertSQL = 'INSERT OR REPLACE INTO ' + fullTableName +
      ' (' + columns.join(', ') + ') VALUES (' + placeholders.join(', ') + ')';

    const runAsyncWrapper = function(sql, params) {
      const result = db.runAsync(sql, params);
      return result && typeof result.promise === 'function' ? result.promise() : result;
    };
    await runAsyncWrapper(insertSQL, values);
  }

  strategy.debug && console.log('[AttachedCollectionPerTableStrategy] Updated projections in', fullTableName, 'for record', recordId);
};

/**
 * Override deleteProjections to work with attached database
 * @param {Object} db - Database connection
 * @param {String} collection - Collection name
 * @param {String} recordId - The record ID being deleted
 * @returns {Promise}
 */
AttachedCollectionPerTableStrategy.prototype.deleteProjections = async function(db, collection, recordId) {
  const strategy = this;
  const projections = this.projectionsByCollection && this.projectionsByCollection[collection];
  if (!projections || projections.length === 0) {
    return;
  }

  for (const projection of projections) {
    // Find the column that maps to the record ID
    let idColumn = null;
    for (const targetColumn in projection.mapping) {
      const sourcePath = projection.mapping[targetColumn];
      if (sourcePath === 'id') {
        idColumn = targetColumn;
        break;
      }
    }

    if (idColumn) {
      const fullTableName = strategy.attachmentAlias + '.' + projection.targetTable;
      const deleteSQL = 'DELETE FROM ' + fullTableName + ' WHERE ' + idColumn + ' = ?';
      const runAsyncWrapper = function(sql, params) {
        const result = db.runAsync(sql, params);
        return result && typeof result.promise === 'function' ? result.promise() : result;
      };
      await runAsyncWrapper(deleteSQL, [recordId]);
      strategy.debug && console.log('[AttachedCollectionPerTableStrategy] Deleted projections from', fullTableName, 'for record', recordId);
    }
  }
};

/**
 * Override readInventory to read from attached database
 */
AttachedCollectionPerTableStrategy.prototype.readInventory = function(db, callback) {
  const strategy = this;
  
  db.getAllAsync(
    'SELECT collection, doc_id, version_num, version_str, has_pending FROM ' + 
    strategy.attachmentAlias + '.sharedb_inventory ORDER BY collection, doc_id'
  ).then(function(rows) {
    const inventory = {collections: {}};
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
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
    
    callback && callback(null, {
      id: 'inventory',
      payload: inventory
    });
  }).catch(function(error) {
    callback && callback(error, null);
  });
};

/**
 * Override deleteAllTables to work with attached database
 */
AttachedCollectionPerTableStrategy.prototype.deleteAllTables = function(db, callback) {
  const strategy = this;
  const promises = [];
  
  // Drop the standard meta and inventory tables in attached database
  promises.push(db.runAsync('DROP TABLE IF EXISTS ' + strategy.attachmentAlias + '.sharedb_meta'));
  promises.push(db.runAsync('DROP TABLE IF EXISTS ' + strategy.attachmentAlias + '.sharedb_inventory'));
  
  // Get all collection-specific table names in attached database and drop them
  db.getAllAsync(
    'SELECT name FROM ' + strategy.attachmentAlias + 
    '.sqlite_master WHERE type=\'table\' AND name NOT IN (\'sharedb_meta\', \'sharedb_inventory\')'
  ).then(function(tables) {
    // Drop each collection table
    for (let i = 0; i < tables.length; i++) {
      const tableName = tables[i].name;
      // Skip system tables
      if (tableName.startsWith('sqlite_')) continue;
      promises.push(db.runAsync('DROP TABLE IF EXISTS ' + strategy.attachmentAlias + '.' + tableName));
    }
    
    return Promise.all(promises);
  }).then(function() {
    strategy.debug && console.log('[AttachedCollectionPerTableStrategy] Deleted all tables in attached database:', strategy.attachmentAlias);
    callback && callback();
  }).catch(function(err) {
    callback && callback(err);
  });
};

module.exports = AttachedCollectionPerTableStrategy;