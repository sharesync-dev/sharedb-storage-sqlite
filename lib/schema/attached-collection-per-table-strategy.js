/**
 * AttachedCollectionPerTableStrategy - Creates collection-specific tables attached to the main database
 * This strategy is designed for environments where you want to keep all ShareDB data in the same
 * database file, but still benefit from collection-specific tables and projections.
 */

var CollectionPerTableStrategy = require('./collection-per-table-strategy');

module.exports = AttachedCollectionPerTableStrategy;

function AttachedCollectionPerTableStrategy(options) {
  options = options || {};
  CollectionPerTableStrategy.call(this, options);
}

// Inherit from CollectionPerTableStrategy
AttachedCollectionPerTableStrategy.prototype = Object.create(CollectionPerTableStrategy.prototype);
AttachedCollectionPerTableStrategy.prototype.constructor = AttachedCollectionPerTableStrategy;

/**
 * Initialize the schema - creates meta table, inventory table, and any pre-configured collection tables
 * This version doesn't use ATTACH DATABASE since everything is in the same database
 */
AttachedCollectionPerTableStrategy.prototype.initializeSchema = function(db, callback) {
  var self = this;

  return Promise.resolve()
    .then(function() {
      // Create meta table
      return self.runAsync(db,
        'CREATE TABLE IF NOT EXISTS sharedb_meta (' +
        'id TEXT PRIMARY KEY, ' +
        'data TEXT NOT NULL' +
        ')'
      );
    })
    .then(function() {
      // Create inventory table
      return self.runAsync(db,
        'CREATE TABLE IF NOT EXISTS sharedb_inventory (' +
        'doc_id TEXT NOT NULL, ' +
        'collection TEXT NOT NULL, ' +
        'version INTEGER NOT NULL, ' +
        'last_operation TEXT NOT NULL, ' +
        'updated_at INTEGER DEFAULT (strftime(\'%s\', \'now\') * 1000), ' +
        'PRIMARY KEY (doc_id, collection)' +
        ')'
      );
    })
    .then(function() {
      // Create indexes on inventory
      return self.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_collection ON sharedb_inventory(collection)');
    })
    .then(function() {
      return self.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_updated ON sharedb_inventory(updated_at)');
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
      if (callback) callback(error);
      throw error;
    });
};

/**
 * Validate that required tables exist
 * For attached strategy, we check tables in the main database
 */
AttachedCollectionPerTableStrategy.prototype.validateSchema = function(db, callback) {
  var promise = Promise.all([
    db.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sharedb_meta'"
    ),
    db.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sharedb_inventory'"
    )
  ]).then(function(results) {
    var metaExists = results[0];
    var inventoryExists = results[1];
    var isValid = !!(metaExists && inventoryExists);
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
 * For attached strategy, we drop tables from the main database
 */
AttachedCollectionPerTableStrategy.prototype.deleteAllTables = function(db, callback) {
  var self = this;

  var promise = db.getAllAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'sharedb_%' OR name LIKE 'projection_%')"
  ).then(function(tables) {
    var promises = [];
    for (var i = 0; i < tables.length; i++) {
      promises.push(self.runAsync(db, 'DROP TABLE IF EXISTS ' + tables[i].name));
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
 * Helper to run async SQL with consistent promise handling
 * Override to ensure we're working with the main database
 */
AttachedCollectionPerTableStrategy.prototype.runAsync = function(db, sql, params) {
  return db.runAsync(sql, params || []);
};