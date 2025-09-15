/**
 * @shaxpir/sharedb-storage-sqlite
 *
 * Shared SQLite storage components for ShareDB adapters
 * Provides schema strategies and base classes for SQLite-based
 * offline storage in both Node.js and React Native environments.
 */

// Export all interfaces
export * from './interfaces';

// Export base storage class
export { SqliteStorage } from './SqliteStorage';

// Export schema strategies
export { BaseSchemaStrategy } from './schema/BaseSchemaStrategy';
export { CollectionPerTableStrategy } from './schema/CollectionPerTableStrategy';
export { AttachedCollectionPerTableStrategy } from './schema/AttachedCollectionPerTableStrategy';
// export { DefaultSchemaStrategy } from './schema/DefaultSchemaStrategy';

// Export utilities and helpers
// export * from './utils';

// Version
export const VERSION = '1.0.0';