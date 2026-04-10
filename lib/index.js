/**
 * @sharesync/sharedb-storage-sqlite
 *
 * Shared SQLite storage components for ShareDB adapters
 * Provides schema strategies and base classes for SQLite-based
 * offline storage in both Node.js and React Native environments.
 */

// Export base storage class
exports.SqliteStorage = require('./sqlite-storage');

// Export schema strategies
exports.BaseSchemaStrategy = require('./schema/base-schema-strategy');
exports.DefaultSchemaStrategy = require('./schema/default-schema-strategy');
exports.CollectionPerTableStrategy = require('./schema/collection-per-table-strategy');
exports.AttachedCollectionPerTableStrategy = require('./schema/attached-collection-per-table-strategy');

// Export adapters and interfaces
exports.SqliteAdapter = require('./interfaces/sqlite-adapter');
exports.AttachedSqliteAdapter = require('./adapters/attached-sqlite-adapter');

// Export utilities
exports.JsonPathValidator = require('./utils/json-path-validator');

// Version
exports.VERSION = '1.4.0';