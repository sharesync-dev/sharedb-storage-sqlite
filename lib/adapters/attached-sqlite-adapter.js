const SqliteAdapter = require('../interfaces/sqlite-adapter');

/**
 * AttachedSqliteAdapter - Base class for database attachment support
 * 
 * This adapter manages a primary database connection and attaches additional databases
 * to enable cross-database queries. It wraps an existing adapter implementation and
 * adds ATTACH functionality during connection initialization.
 * 
 * The wrapped adapter handles all actual database operations while this class manages
 * the attachment lifecycle.
 * 
 * @param {SqliteAdapter} wrappedAdapter - The underlying adapter to wrap
 * @param {Object} attachmentConfig - Configuration for database attachments
 * @param {Array} attachmentConfig.attachments - Array of databases to attach
 *   Each attachment should have: { path, alias }
 * @param {boolean} debug - Enable debug logging
 */
function AttachedSqliteAdapter(wrappedAdapter, attachmentConfig, debug) {
  if (!wrappedAdapter) {
    throw new Error('AttachedSqliteAdapter requires a wrapped adapter');
  }
  
  if (!attachmentConfig || !attachmentConfig.attachments) {
    throw new Error('AttachedSqliteAdapter requires attachmentConfig with attachments array');
  }
  
  this.wrappedAdapter = wrappedAdapter;
  this.attachments = attachmentConfig.attachments || [];
  this.debug = debug || false;
  this.attached = false;
}

// Inherit from SqliteAdapter interface
AttachedSqliteAdapter.prototype = Object.create(SqliteAdapter.prototype);
AttachedSqliteAdapter.prototype.constructor = AttachedSqliteAdapter;

/**
 * Connect to the primary database and attach secondary databases
 */
AttachedSqliteAdapter.prototype.connect = function() {
  const adapter = this;
  
  return adapter.wrappedAdapter.connect().then(function() {
    // After primary connection is established, attach secondary databases
    return adapter.attachDatabases();
  });
};

/**
 * Attach all configured databases
 * @private
 */
AttachedSqliteAdapter.prototype.attachDatabases = function() {
  const adapter = this;
  
  if (adapter.attachments.length === 0) {
    adapter.debug && console.log('[AttachedSqliteAdapter] No databases to attach');
    return Promise.resolve();
  }
  
  // Attach databases sequentially to avoid conflicts
  const attachPromises = adapter.attachments.reduce(function(promise, attachment) {
    return promise.then(function() {
      return adapter.attachSingleDatabase(attachment);
    });
  }, Promise.resolve());
  
  return attachPromises.then(function() {
    adapter.attached = true;
    adapter.debug && console.log('[AttachedSqliteAdapter] All databases attached successfully');
  });
};

/**
 * Attach a single database
 * @private
 * @param {Object} attachment - Database attachment config with path and alias
 */
AttachedSqliteAdapter.prototype.attachSingleDatabase = function(attachment) {
  const adapter = this;
  
  if (!attachment.path || !attachment.alias) {
    return Promise.reject(new Error('Attachment must have both path and alias properties'));
  }
  
  // Build ATTACH statement
  const attachSql = `ATTACH DATABASE '${attachment.path}' AS ${attachment.alias}`;
  
  adapter.debug && console.log('[AttachedSqliteAdapter] Attaching database:', attachment.alias, 'from', attachment.path);
  
  // Use runAsync to execute the ATTACH statement
  return adapter.wrappedAdapter.runAsync(attachSql).then(function() {
    adapter.debug && console.log('[AttachedSqliteAdapter] Successfully attached:', attachment.alias);
  }).catch(function(error) {
    console.error('[AttachedSqliteAdapter] Failed to attach database:', attachment.alias, error);
    throw error;
  });
};

/**
 * Disconnect from the database (and implicitly detach all attached databases)
 */
AttachedSqliteAdapter.prototype.disconnect = function() {
  const adapter = this;
  
  // Detaching happens automatically when the connection is closed
  return adapter.wrappedAdapter.disconnect().then(function() {
    adapter.attached = false;
    adapter.debug && console.log('[AttachedSqliteAdapter] Disconnected and detached all databases');
  });
};

/**
 * Execute a SQL statement - delegates to wrapped adapter
 */
AttachedSqliteAdapter.prototype.runAsync = function(sql, params) {
  return this.wrappedAdapter.runAsync(sql, params);
};

/**
 * Get the first row from a SELECT query - delegates to wrapped adapter
 */
AttachedSqliteAdapter.prototype.getFirstAsync = function(sql, params) {
  return this.wrappedAdapter.getFirstAsync(sql, params);
};

/**
 * Get all rows from a SELECT query - delegates to wrapped adapter
 */
AttachedSqliteAdapter.prototype.getAllAsync = function(sql, params) {
  return this.wrappedAdapter.getAllAsync(sql, params);
};

/**
 * Execute multiple SQL statements in a transaction - delegates to wrapped adapter
 */
AttachedSqliteAdapter.prototype.transaction = function(operations) {
  return this.wrappedAdapter.transaction(operations);
};

/**
 * Helper method to check if databases are attached
 */
AttachedSqliteAdapter.prototype.isAttached = function() {
  return this.attached;
};

/**
 * Get list of attached database aliases
 */
AttachedSqliteAdapter.prototype.getAttachedAliases = function() {
  return this.attachments.map(function(attachment) {
    return attachment.alias;
  });
};

module.exports = AttachedSqliteAdapter;