/**
 * @shaxpir/sharedb-storage-sqlite
 *
 * Shared SQLite storage components for ShareDB adapters
 * Provides schema strategies and base classes for SQLite-based
 * offline storage in both Node.js and React Native environments.
 */
export * from './interfaces';
export { SqliteStorage } from './SqliteStorage';
export { BaseSchemaStrategy } from './schema/BaseSchemaStrategy';
export { CollectionPerTableStrategy } from './schema/CollectionPerTableStrategy';
export { AttachedCollectionPerTableStrategy } from './schema/AttachedCollectionPerTableStrategy';
export declare const DefaultSchemaStrategy: any;
export declare const VERSION = "1.0.0";
//# sourceMappingURL=index.d.ts.map