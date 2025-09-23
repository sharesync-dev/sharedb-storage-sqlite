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

  console.log('[AttachedSqliteAdapter] Attaching database:', attachment.alias, 'from', attachment.path);

  // Use runAsync to execute the ATTACH statement
  return adapter.wrappedAdapter.runAsync(attachSql).then(function() {
    console.log('[AttachedSqliteAdapter] Successfully attached:', attachment.alias);

    // Verify the attachment by checking pragma_database_list
    return adapter.wrappedAdapter.getAllAsync("PRAGMA database_list").then(function(databases) {
      console.log('[AttachedSqliteAdapter] Current attached databases:', databases);
      const found = databases.some(function(db) {
        return db.name === attachment.alias;
      });
      if (!found) {
        throw new Error('Database attachment verification failed for: ' + attachment.alias);
      }
    });
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
 * Verify attachments are present and re-attach if needed
 * @private
 */
AttachedSqliteAdapter.prototype.ensureAttached = function() {
  const adapter = this;

  // Check if we have attachments to verify
  if (!adapter.attachments || adapter.attachments.length === 0) {
    return Promise.resolve();
  }

  // Check current attached databases
  return adapter.wrappedAdapter.getAllAsync("PRAGMA database_list").then(function(databases) {
    const attachedNames = databases.map(function(db) { return db.name; });

    // Check if all required attachments are present
    const missingAttachments = adapter.attachments.filter(function(attachment) {
      return !attachedNames.includes(attachment.alias);
    });

    if (missingAttachments.length > 0) {
      console.log('[AttachedSqliteAdapter] Missing attachments detected:',
        missingAttachments.map(function(a) { return a.alias; }).join(', '));
      console.log('[AttachedSqliteAdapter] Re-attaching databases...');

      // Re-attach missing databases
      const reattachPromises = missingAttachments.reduce(function(promise, attachment) {
        return promise.then(function() {
          return adapter.attachSingleDatabase(attachment);
        });
      }, Promise.resolve());

      return reattachPromises;
    }

    return Promise.resolve();
  }).catch(function(error) {
    console.error('[AttachedSqliteAdapter] Error checking attachments:', error);
    // Try to re-attach all databases
    return adapter.attachDatabases();
  });
};

/**
 * Execute a SQL statement - delegates to wrapped adapter
 * Ensures attachments are present before execution
 */
AttachedSqliteAdapter.prototype.runAsync = function(sql, params) {
  const adapter = this;

  // For queries that might reference attached databases, ensure they're attached
  if (sql && (sql.includes('.') || sql.toUpperCase().includes('ATTACH'))) {
    return adapter.ensureAttached().then(function() {
      return adapter.wrappedAdapter.runAsync(sql, params);
    });
  }

  return adapter.wrappedAdapter.runAsync(sql, params);
};

/**
 * Get the first row from a SELECT query - delegates to wrapped adapter
 * Ensures attachments are present before execution
 */
AttachedSqliteAdapter.prototype.getFirstAsync = function(sql, params) {
  const adapter = this;

  // For queries that might reference attached databases, ensure they're attached
  if (sql && sql.includes('.')) {
    return adapter.ensureAttached().then(function() {
      return adapter.wrappedAdapter.getFirstAsync(sql, params);
    });
  }

  return adapter.wrappedAdapter.getFirstAsync(sql, params);
};

/**
 * Get all rows from a SELECT query - delegates to wrapped adapter
 * Ensures attachments are present before execution
 */
AttachedSqliteAdapter.prototype.getAllAsync = function(sql, params) {
  const adapter = this;

  // For queries that might reference attached databases, ensure they're attached
  if (sql && sql.includes('.')) {
    return adapter.ensureAttached().then(function() {
      return adapter.wrappedAdapter.getAllAsync(sql, params);
    });
  }

  return adapter.wrappedAdapter.getAllAsync(sql, params);
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