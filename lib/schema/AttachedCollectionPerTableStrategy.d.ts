/**
 * AttachedCollectionPerTableStrategy - Creates collection-specific tables attached to the main database
 * This strategy is designed for environments where you want to keep all ShareDB data in the same
 * database file, but still benefit from collection-specific tables and projections.
 */
import { CollectionPerTableStrategy } from './CollectionPerTableStrategy';
import { SchemaStrategyOptions } from './BaseSchemaStrategy';
import { DatabaseConnection, StorageCallback } from './BaseSchemaStrategy';
export declare class AttachedCollectionPerTableStrategy extends CollectionPerTableStrategy {
    constructor(options?: SchemaStrategyOptions);
    /**
     * Initialize the schema - creates meta table, inventory table, and any pre-configured collection tables
     * This version doesn't use ATTACH DATABASE since everything is in the same database
     */
    initializeSchema(db: DatabaseConnection, callback?: StorageCallback): Promise<void>;
    /**
     * Validate that required tables exist
     * For attached strategy, we check tables in the main database
     */
    validateSchema(db: DatabaseConnection, callback?: StorageCallback<boolean>): Promise<boolean>;
    /**
     * Delete all tables
     * For attached strategy, we drop tables from the main database
     */
    deleteAllTables(db: DatabaseConnection, callback?: StorageCallback): Promise<void>;
    /**
     * Helper to run async SQL with consistent promise handling
     * Override to ensure we're working with the main database
     */
    protected runAsync(db: DatabaseConnection, sql: string, params?: any[]): Promise<any>;
}
//# sourceMappingURL=AttachedCollectionPerTableStrategy.d.ts.map