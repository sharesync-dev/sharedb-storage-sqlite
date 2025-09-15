/**
 * @shaxpir/sharedb-storage-sqlite
 *
 * Shared SQLite storage components for ShareDB adapters
 * Provides schema strategies and base classes for SQLite-based
 * offline storage in both Node.js and React Native environments.
 */

// Export schema strategies (all use constructor function pattern)
exports.BaseSchemaStrategy = require('./schema/base-schema-strategy');
exports.DefaultSchemaStrategy = require('./schema/default-schema-strategy');
exports.CollectionPerTableStrategy = require('./schema/collection-per-table-strategy');
exports.AttachedCollectionPerTableStrategy = require('./schema/attached-collection-per-table-strategy');

// Export utilities and version
exports.VERSION = '1.1.2';