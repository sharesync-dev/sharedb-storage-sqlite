/**
 * SQL.js test adapter - Uses real SQLite engine via sql.js
 * Provides the same interface as MockDatabase but with a real SQL engine
 */

var initSqlJs = require('sql.js');

module.exports = SqlJsTestAdapter;

function SqlJsTestAdapter() {
  this.db = null;
  this.SQL = null; // Store the SQL constructor
  this.sqlHistory = [];
  this.initialized = false;
  this.initPromise = null;
}

/**
 * Initialize the database asynchronously
 * This needs to be called before any database operations
 */
SqlJsTestAdapter.prototype.init = function() {
  if (this.initPromise) {
    return this.initPromise;
  }

  var self = this;
  this.initPromise = initSqlJs().then(function(SQL) {
    self.SQL = SQL; // Store the SQL constructor
    self.db = new SQL.Database();
    self.initialized = true;
    return self;
  });

  return this.initPromise;
};

/**
 * Ensure database is initialized before operations
 */
SqlJsTestAdapter.prototype.ensureInitialized = function() {
  if (!this.initialized) {
    throw new Error('SqlJsTestAdapter must be initialized with .init() before use');
  }
};

/**
 * Execute a transaction
 */
SqlJsTestAdapter.prototype.transaction = function(operations) {
  this.ensureInitialized();

  // sql.js doesn't have explicit transaction support in the same way
  // but we can simulate it with BEGIN/COMMIT
  try {
    this.db.run('BEGIN TRANSACTION');
    var result = operations();
    this.db.run('COMMIT');
    return result;
  } catch (error) {
    this.db.run('ROLLBACK');
    throw error;
  }
};

/**
 * Reset the database - close and create a new one
 */
SqlJsTestAdapter.prototype.reset = function() {
  this.ensureInitialized();

  if (this.db) {
    this.db.close();
  }

  // Create a new database instance using stored SQL constructor
  this.db = new this.SQL.Database();
  this.sqlHistory = [];
};

/**
 * Get SQL history for debugging
 */
SqlJsTestAdapter.prototype.getSqlHistory = function() {
  return this.sqlHistory;
};

/**
 * Run a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.)
 */
SqlJsTestAdapter.prototype.runAsync = function(sql, params) {
  this.ensureInitialized();

  var self = this;
  this.sqlHistory.push({ sql: sql, params: params });

  return new Promise(function(resolve, reject) {
    try {
      // Run the statement
      var stmt = self.db.prepare(sql);
      stmt.run(params || []);
      stmt.free();

      // Get the number of changes (for compatibility with MockDatabase)
      var changes = self.db.getRowsModified();

      // Get last insert rowid
      var lastInsertResult = self.db.exec('SELECT last_insert_rowid() as id');
      var lastInsertRowid = lastInsertResult.length > 0 && lastInsertResult[0].values.length > 0
        ? lastInsertResult[0].values[0][0]
        : 0;

      resolve({
        changes: changes,
        lastInsertRowid: lastInsertRowid
      });
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Get the first row from a SELECT query
 */
SqlJsTestAdapter.prototype.getFirstAsync = function(sql, params) {
  this.ensureInitialized();

  var self = this;
  this.sqlHistory.push({ sql: sql, params: params });

  return new Promise(function(resolve, reject) {
    try {
      var stmt = self.db.prepare(sql);
      stmt.bind(params || []);

      if (stmt.step()) {
        var row = stmt.getAsObject();
        stmt.free();
        resolve(row);
      } else {
        stmt.free();
        resolve(null);
      }
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Get all rows from a SELECT query
 */
SqlJsTestAdapter.prototype.getAllAsync = function(sql, params) {
  this.ensureInitialized();

  var self = this;
  this.sqlHistory.push({ sql: sql, params: params });

  return new Promise(function(resolve, reject) {
    try {
      var stmt = self.db.prepare(sql);
      stmt.bind(params || []);

      var rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();

      resolve(rows);
    } catch (error) {
      reject(error);
    }
  });
};

// Helper methods for testing (same as MockDatabase)

/**
 * Check if a table exists
 */
SqlJsTestAdapter.prototype.hasTable = function(tableName) {
  this.ensureInitialized();

  var result = this.db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName]
  );
  return result.length > 0 && result[0].values.length > 0;
};

/**
 * Get list of all tables
 */
SqlJsTestAdapter.prototype.getTables = function() {
  this.ensureInitialized();

  var result = this.db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );

  if (result.length === 0) return [];

  return result[0].values.map(function(row) {
    return row[0];
  });
};

/**
 * Get all data from a table (for testing)
 */
SqlJsTestAdapter.prototype.getTableData = function(tableName) {
  this.ensureInitialized();

  try {
    var result = this.db.exec('SELECT * FROM ' + tableName);
    if (result.length === 0) return [];

    // Convert result format to array of objects
    var columns = result[0].columns;
    var values = result[0].values;

    return values.map(function(row) {
      var obj = {};
      for (var i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i];
      }
      return obj;
    });
  } catch (error) {
    // Table doesn't exist
    return [];
  }
};

/**
 * Set mock data for a table (creates table and inserts data)
 * This is for backward compatibility with tests using setMockData
 */
SqlJsTestAdapter.prototype.setTableData = function(tableName, data) {
  this.ensureInitialized();

  if (!data || data.length === 0) return;

  // Drop table if it exists
  this.db.run('DROP TABLE IF EXISTS ' + tableName);

  // Create table based on first row's keys
  var firstRow = data[0];
  var columns = Object.keys(firstRow);

  var createSQL = 'CREATE TABLE ' + tableName + ' (';
  var columnDefs = columns.map(function(col) {
    // Make 'id' the primary key if it exists
    if (col === 'id') {
      return col + ' TEXT PRIMARY KEY';
    }
    return col + ' TEXT';
  });
  createSQL += columnDefs.join(', ') + ')';

  this.db.run(createSQL);

  // Insert data
  var insertSQL = 'INSERT INTO ' + tableName + ' (' + columns.join(', ') + ') VALUES (' +
    columns.map(function() { return '?'; }).join(', ') + ')';

  var stmt = this.db.prepare(insertSQL);
  for (var i = 0; i < data.length; i++) {
    var values = columns.map(function(col) {
      var value = data[i][col];
      // Handle JSON values
      if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value);
      }
      return value;
    });
    stmt.run(values);
  }
  stmt.free();
};

// Alias for backward compatibility
SqlJsTestAdapter.prototype.setMockData = function(tableName, data) {
  return this.setTableData(tableName, data);
};