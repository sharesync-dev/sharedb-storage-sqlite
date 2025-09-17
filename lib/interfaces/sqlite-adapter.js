/**
 * SqliteAdapter Interface
 * 
 * This interface defines the contract for SQLite database adapters.
 * Each adapter manages exactly one database connection with no cross-database awareness.
 * The interface is deliberately minimal and focused on single-database operations.
 * 
 * Key principles:
 * - Pure single-database operations only
 * - No ShareDB-specific methods
 * - No complex configuration options
 * - Consistent interface across React Native and Node.js
 */

/**
 * Base SqliteAdapter interface that all implementations must follow
 * 
 * @interface SqliteAdapter
 */
function SqliteAdapter() {
  // Interface definition - to be implemented by concrete classes
}

/**
 * Connect to the database
 * @returns {Promise<void>}
 */
SqliteAdapter.prototype.connect = function() {
  throw new Error('connect() must be implemented by subclass');
};

/**
 * Disconnect from the database
 * @returns {Promise<void>}
 */
SqliteAdapter.prototype.disconnect = function() {
  throw new Error('disconnect() must be implemented by subclass');
};

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.)
 * Returns an object with a promise() method to match schema strategy expectations
 * 
 * @param {string} sql - The SQL statement to execute
 * @param {Array} [params] - Parameters for the SQL statement
 * @returns {Object} Object with promise() method that returns Promise<{lastID?: number, changes?: number}>
 */
SqliteAdapter.prototype.runAsync = function(sql, params) {
  throw new Error('runAsync() must be implemented by subclass');
};

/**
 * Get the first row from a SELECT query
 * Returns a promise directly to match schema strategy expectations
 * 
 * @param {string} sql - The SQL query to execute
 * @param {Array} [params] - Parameters for the SQL query
 * @returns {Promise<any>} Promise that resolves to the first row or null
 */
SqliteAdapter.prototype.getFirstAsync = function(sql, params) {
  throw new Error('getFirstAsync() must be implemented by subclass');
};

/**
 * Get all rows from a SELECT query
 * Returns a promise directly to match schema strategy expectations
 * 
 * @param {string} sql - The SQL query to execute
 * @param {Array} [params] - Parameters for the SQL query
 * @returns {Promise<Array>} Promise that resolves to array of rows
 */
SqliteAdapter.prototype.getAllAsync = function(sql, params) {
  throw new Error('getAllAsync() must be implemented by subclass');
};

/**
 * Execute multiple SQL statements in a transaction
 * 
 * @param {Function} operations - Function containing the operations to execute in a transaction
 * @returns {Promise} Promise that resolves with the transaction result
 */
SqliteAdapter.prototype.transaction = function(operations) {
  throw new Error('transaction() must be implemented by subclass');
};

module.exports = SqliteAdapter;