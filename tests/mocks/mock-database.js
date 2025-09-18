/**
 * Mock database implementation for testing
 */

module.exports = MockDatabase;

function MockDatabase() {
  this.data = new Map();
  this.sqlHistory = [];
  this.reset();
}

MockDatabase.prototype.transaction = function(operations) {
  // Simple mock transaction - just execute the operations
  return operations();
};

MockDatabase.prototype.reset = function() {
  this.data.clear();
  this.sqlHistory = [];
};

MockDatabase.prototype.getSqlHistory = function() {
  return this.sqlHistory;
};

MockDatabase.prototype.runAsync = function(sql, params) {
  var self = this;
  this.sqlHistory.push({ sql: sql, params: params });

  // Simple SQL parsing for testing
  var upperSql = sql.trim().toUpperCase();

  var result;

  if (upperSql.indexOf('CREATE TABLE') === 0) {
    var tableName = this.extractTableName(sql);
    if (tableName && !this.data.has(tableName)) {
      this.data.set(tableName, []);
    }
    result = Promise.resolve({ changes: 0 });
  }
  else if (upperSql.indexOf('INSERT') === 0) {
    var tableName = this.extractTableName(sql);
    if (tableName) {
      var table = this.data.get(tableName) || [];
      var record = this.createRecordFromParams(params || [], sql);
      table.push(record);
      this.data.set(tableName, table);
      result = Promise.resolve({ changes: 1, lastInsertRowid: table.length });
    } else {
      result = Promise.resolve({ changes: 0 });
    }
  }
  else if (upperSql.indexOf('UPDATE') === 0) {
    var tableName = this.extractTableName(sql);
    if (tableName) {
      var table = this.data.get(tableName) || [];
      // For UPDATE queries, update the first matching record
      if (sql.indexOf('WHERE id = ?') !== -1 && params && params.length > 1) {
        var id = params[params.length - 1]; // ID is usually the last param
        for (var i = 0; i < table.length; i++) {
          if (table[i].id === id) {
            // Update the data field
            table[i].data = params[0];
            this.data.set(tableName, table);
            result = Promise.resolve({ changes: 1 });
            break;
          }
        }
        if (!result) {
          result = Promise.resolve({ changes: 0 });
        }
      } else {
        result = Promise.resolve({ changes: 0 });
      }
    } else {
      result = Promise.resolve({ changes: 0 });
    }
  }
  else if (upperSql.indexOf('DELETE') === 0) {
    var tableName = this.extractTableName(sql);
    if (tableName) {
      var table = this.data.get(tableName) || [];
      // Simple deletion - just clear for testing
      this.data.set(tableName, []);
      result = Promise.resolve({ changes: table.length });
    } else {
      result = Promise.resolve({ changes: 0 });
    }
  }
  else if (upperSql.indexOf('DROP TABLE') === 0) {
    var tableName = this.extractTableName(sql);
    if (tableName) {
      this.data.delete(tableName);
      result = Promise.resolve({ changes: 0 });
    } else {
      result = Promise.resolve({ changes: 0 });
    }
  }
  else {
    result = Promise.resolve({ changes: 0 });
  }

  return result;
};

MockDatabase.prototype.getFirstAsync = function(sql, params) {
  this.sqlHistory.push({ sql: sql, params: params });

  var result;

  // Check for sqlite_master queries FIRST
  if (sql.indexOf('sqlite_master') !== -1) {
    // Handle queries with type='table' check
    if (sql.indexOf("type='table'") !== -1) {
      if (sql.indexOf("name='sharedb_meta'") !== -1) {
        result = Promise.resolve(this.data.has('sharedb_meta') ? { name: 'sharedb_meta' } : null);
      }
      else if (sql.indexOf("name='sharedb_inventory'") !== -1) {
        result = Promise.resolve(this.data.has('sharedb_inventory') ? { name: 'sharedb_inventory' } : null);
      }
      else if (sql.indexOf("name='docs'") !== -1) {
        result = Promise.resolve(this.data.has('docs') ? { name: 'docs' } : null);
      }
      else if (sql.indexOf("name='meta'") !== -1) {
        result = Promise.resolve(this.data.has('meta') ? { name: 'meta' } : null);
      }
      else {
        result = Promise.resolve(null);
      }
    }
    // Handle queries without type check (backward compatibility)
    else if (sql.indexOf("name='sharedb_meta'") !== -1) {
      result = Promise.resolve(this.data.has('sharedb_meta') ? { name: 'sharedb_meta' } : null);
    }
    else if (sql.indexOf("name='sharedb_inventory'") !== -1) {
      result = Promise.resolve(this.data.has('sharedb_inventory') ? { name: 'sharedb_inventory' } : null);
    }
    else if (sql.indexOf("name='docs'") !== -1) {
      result = Promise.resolve(this.data.has('docs') ? { name: 'docs' } : null);
    }
    else if (sql.indexOf("name='meta'") !== -1) {
      result = Promise.resolve(this.data.has('meta') ? { name: 'meta' } : null);
    }
    else {
      result = Promise.resolve(null);
    }
  }
  // Handle regular table queries
  else {
    var tableName = this.extractTableName(sql);
    if (tableName) {
      var table = this.data.get(tableName) || [];

      // If there's a WHERE id = ? clause, find by ID
      if (sql.indexOf('WHERE id = ?') !== -1 && params && params.length > 0) {
        var id = params[0];
        for (var i = 0; i < table.length; i++) {
          if (table[i].id === id) {
            // Check if selecting specific field (e.g., SELECT data FROM)
            if (sql.indexOf('SELECT data FROM') !== -1) {
              result = Promise.resolve({ data: table[i].data });
            } else {
              result = Promise.resolve(table[i]);
            }
            break;
          }
        }
        if (!result) {
          result = Promise.resolve(null);
        }
      } else if (table.length > 0) {
        // Check if selecting specific field (e.g., SELECT data FROM)
        if (sql.indexOf('SELECT data FROM') !== -1) {
          result = Promise.resolve({ data: table[0].data });
        } else {
          result = Promise.resolve(table[0]);
        }
      } else {
        result = Promise.resolve(null);
      }
    }
  }

  if (!result) {
    result = Promise.resolve(null);
  }

  return result;
};

MockDatabase.prototype.getAllAsync = function(sql, params) {
  var self = this;
  this.sqlHistory.push({ sql: sql, params: params });

  var result;
  // Mock getting all tables from sqlite_master (check this FIRST before extracting table names)
  if (sql.indexOf('sqlite_master') !== -1) {
    var tables = [];

    // Check if query excludes certain tables
    var excludesMeta = sql.indexOf("NOT IN") !== -1 && sql.indexOf("'sharedb_meta'") !== -1;

    this.data.forEach(function(value, name) {
      // Skip sqlite internal tables
      if (name.indexOf('sqlite_') === 0) {
        return;
      }

      // If query excludes meta/inventory, don't include them
      if (excludesMeta && (name === 'sharedb_meta' || name === 'sharedb_inventory')) {
        return;
      }

      // Include all other tables
      tables.push({ name: name });
    });
    result = Promise.resolve(tables);
  }
  // For regular table queries
  else {
    var tableName = this.extractTableName(sql);
    if (tableName) {
      var table = this.data.get(tableName) || [];

      // Handle WHERE IN clause for bulk queries
      if (sql.indexOf('WHERE id IN') !== -1 && params && params.length > 0) {
        var results = [];
        for (var i = 0; i < table.length; i++) {
          if (params.indexOf(table[i].id) !== -1) {
            results.push(table[i]);
          }
        }
        result = Promise.resolve(results);
      } else {
        result = Promise.resolve(table);
      }
    } else {
      result = Promise.resolve([]);
    }
  }

  return result;
};

MockDatabase.prototype.extractTableName = function(sql) {
  var patterns = [
    /FROM\s+(\w+)/i,
    /INTO\s+(\w+)/i,
    /TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i,
    /TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i,
    /UPDATE\s+(\w+)/i
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = sql.match(patterns[i]);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return null;
};

MockDatabase.prototype.createRecordFromParams = function(params, sql) {
  // Parse column names from SQL if present
  // Example: INSERT INTO table (id, collection, data) VALUES (?, ?, ?)
  var columnMatch = sql ? sql.match(/\(([^)]+)\)\s+VALUES/i) : null;
  var columns = columnMatch ? columnMatch[1].split(',').map(function(c) { return c.trim(); }) : [];

  // Build record based on column order
  var record = {};
  for (var i = 0; i < columns.length && i < params.length; i++) {
    record[columns[i]] = params[i];
  }

  // Ensure basic fields exist
  if (!record.id && params[0]) record.id = params[0];
  if (!record.data && params.length > 1) {
    // Try to find the JSON data parameter
    for (var j = 0; j < params.length; j++) {
      if (typeof params[j] === 'string' && params[j].indexOf('{') === 0) {
        record.data = params[j];
        break;
      }
    }
    if (!record.data) record.data = '{}';
  }

  return record;
};

// Additional helper methods for testing
MockDatabase.prototype.hasTable = function(tableName) {
  return this.data.has(tableName);
};

MockDatabase.prototype.getTables = function() {
  var tables = [];
  this.data.forEach(function(value, name) {
    tables.push(name);
  });
  return tables;
};

MockDatabase.prototype.getTableData = function(tableName) {
  return this.data.get(tableName) || [];
};

MockDatabase.prototype.setTableData = function(tableName, data) {
  this.data.set(tableName, data);
};

// Alias for setTableData to match test expectations
MockDatabase.prototype.setMockData = function(tableName, data) {
  this.setTableData(tableName, data);
};